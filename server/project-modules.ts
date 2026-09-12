import type { Pool, PoolClient } from 'pg'
import { decryptText, encryptText, isEncryptedText, keyedDigest } from './crypto.ts'
import { projectModulesFinalizeSql } from './schema.ts'
import { normalizeProjectModuleName, projectModuleAvailability } from '../shared/project-modules.ts'

type ModuleClient = Pick<PoolClient, 'query'>

export class ProjectModuleError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 409) {
    super(message)
    this.code = code
    this.status = status
  }
}

export function requireProjectModuleName(value: unknown) {
  const name = normalizeProjectModuleName(value)
  if (name === null) {
    throw new ProjectModuleError('PROJECT_MODULE_NAME_INVALID', '模块名称须包含 1–40 个字符。', 400)
  }
  return name
}

export function parseProjectModuleId(value: unknown): number | null {
  if (value == null || value === '') return null
  if ((typeof value !== 'number' && typeof value !== 'string') || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) {
    throw new ProjectModuleError('PROJECT_MODULE_INVALID', '请选择有效的项目模块。', 400)
  }
  return Number(value)
}

// Exact, case-sensitive names use a domain-separated digest. Retain the original
// lookup key across encryption-key rotation so all replicas enforce one uniqueness domain.
export function projectModuleNameLookup(name: string, keyId: string) {
  return keyedDigest(JSON.stringify(['project-module-name', name]), keyId)
}

async function lookupKeyId(client: ModuleClient) {
  const result = await client.query<{ lookup_key_id: string }>(
    'select lookup_key_id from project_module_settings where id = 1',
  )
  if (!result.rows[0]) throw new Error('Project module migration has not completed')
  return result.rows[0].lookup_key_id
}

export async function lockOrganizationModuleCatalog(client: ModuleClient, organizationId: number) {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1::text, 0))', [`organization-modules:${organizationId}`])
  const organization = await client.query<{ id: string }>(
    'select id from organizations where id = $1 for key share', [organizationId],
  )
  if (!organization.rows[0]) throw new ProjectModuleError('ORGANIZATION_NOT_FOUND', '组织不存在或已删除。', 404)
}

export async function lockProjectModules(client: ModuleClient, projectId: number) {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1::text, 0))', [`ai-project:${projectId}`])
}

export async function lockOrganizationModuleProjects(client: ModuleClient, organizationId: number) {
  const projects = await client.query<{ id: string }>(
    'select id from projects where organization_id = $1 order by id', [organizationId],
  )
  for (const project of projects.rows) await lockProjectModules(client, Number(project.id))
}

export async function listOrganizationProjectModules(client: ModuleClient, organizationId: number) {
  const result = await client.query<{
    id: string; name: string; enabled: boolean; created_at: Date; updated_at: Date; usage_count: number
  }>(
    `select module.id, module.name, module.enabled, module.created_at, module.updated_at,
       (select count(t.id)::int
          from project_modules pm
          join projects p on p.id = pm.project_id and p.organization_id = module.organization_id
          left join todos t on t.project_module_id = pm.id
         where pm.organization_module_id = module.id) as usage_count
       from organization_project_modules module
     where module.organization_id = $1 order by module.created_at, module.id`, [organizationId],
  )
  return result.rows.map(row => ({
    id: Number(row.id), name: decryptText(row.name), enabled: row.enabled,
    usageCount: Number(row.usage_count ?? 0),
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  }))
}

// Caller holds the organization catalog lock, followed by the affected project locks.
// The project-local ID remains the stable foreign key for todos and AI proposals.
export async function syncOrganizationProjectModules(
  client: ModuleClient,
  organizationId: number,
  projectId: number | null = null,
) {
  await client.query(
    `insert into project_modules (project_id, organization_module_id, name, name_lookup)
     select p.id, module.id, module.name, module.name_lookup
     from projects p
     join organization_project_modules module on module.organization_id = p.organization_id
     where p.organization_id = $1::bigint and ($2::bigint is null or p.id = $2::bigint)
     order by p.id, module.id
     on conflict (project_id, name_lookup) do update
       set organization_module_id = excluded.organization_module_id, name = excluded.name
       where project_modules.organization_module_id is null
          or project_modules.organization_module_id = excluded.organization_module_id`,
    [organizationId, projectId],
  )
}

export async function createOrganizationProjectModule(client: ModuleClient, organizationId: number, name: string) {
  name = requireProjectModuleName(name)
  const lookup = projectModuleNameLookup(name, await lookupKeyId(client))
  const result = await client.query<{ id: string }>(
    `insert into organization_project_modules (organization_id, name, name_lookup)
     values ($1, $2, $3) on conflict (organization_id, name_lookup) do nothing returning id`,
    [organizationId, encryptText(name), lookup],
  )
  if (!result.rows[0]) throw new ProjectModuleError('PROJECT_MODULE_NAME_CONFLICT', '此模块已存在，请使用其他名称或启用已有模块。')
  await syncOrganizationProjectModules(client, organizationId)
  return Number(result.rows[0].id)
}

export function normalizeOrganizationModuleUpdate(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProjectModuleError('PROJECT_MODULE_UPDATE_INVALID', '请提供模块名称或启用状态。', 400)
  }
  const input = value as Record<string, unknown>
  const keys = Object.keys(input)
  if (!keys.length || keys.some(key => key !== 'name' && key !== 'enabled') || ('enabled' in input && typeof input.enabled !== 'boolean')) {
    throw new ProjectModuleError('PROJECT_MODULE_UPDATE_INVALID', '请提供有效的模块名称或启用状态。', 400)
  }
  return { name: 'name' in input ? requireProjectModuleName(input.name) : undefined, enabled: input.enabled as boolean | undefined }
}

export async function updateOrganizationProjectModule(
  client: ModuleClient,
  organizationId: number,
  moduleId: number,
  input: ReturnType<typeof normalizeOrganizationModuleUpdate>,
) {
  const existing = await client.query<{ name: string; name_lookup: string; enabled: boolean }>(
    `select name, name_lookup, enabled from organization_project_modules
     where id = $1 and organization_id = $2 for update`, [moduleId, organizationId],
  )
  const module = existing.rows[0]
  if (!module) throw new ProjectModuleError('PROJECT_MODULE_NOT_FOUND', '项目模块不存在。', 404)
  if (input.enabled === false && module.enabled) {
    const usage = await client.query<{ usage_count: number }>(
      `select count(t.id)::int as usage_count
         from project_modules pm
         join projects p on p.id = pm.project_id and p.organization_id = $2::bigint
         left join todos t on t.project_module_id = pm.id
        where pm.organization_module_id = $1::bigint`, [moduleId, organizationId],
    )
    const usageCount = Number(usage.rows[0]?.usage_count ?? 0)
    if (usageCount > 0) throw new ProjectModuleError(
      'PROJECT_MODULE_IN_USE', `模块仍被 ${usageCount} 个任务使用，无法停用。请先调整任务归属。`,
    )
  }
  const lookup = input.name === undefined ? module.name_lookup : projectModuleNameLookup(input.name, await lookupKeyId(client))
  if (lookup !== module.name_lookup) {
    const conflict = await client.query(
      `select 1 from organization_project_modules
       where organization_id = $1::bigint and name_lookup = $2::text and id <> $3::bigint
       union all
       select 1 from project_modules pm join projects p on p.id = pm.project_id
       where p.organization_id = $1::bigint and pm.name_lookup = $2::text
         and pm.organization_module_id is distinct from $3::bigint
       limit 1`, [organizationId, lookup, moduleId],
    )
    if (conflict.rows.length) throw new ProjectModuleError('PROJECT_MODULE_NAME_CONFLICT', '组织或项目中的历史模块已使用此名称，请使用其他名称。')
  }
  const encryptedName = input.name === undefined ? module.name : encryptText(input.name)
  await client.query(
    `update organization_project_modules set name = $1, name_lookup = $2, enabled = $3, updated_at = now()
     where id = $4 and organization_id = $5`,
    [encryptedName, lookup, input.enabled ?? module.enabled, moduleId, organizationId],
  )
  if (input.name !== undefined) {
    await client.query(
      `update project_modules pm set name = $1, name_lookup = $2
       from projects p where pm.organization_module_id = $3
         and p.id = pm.project_id and p.organization_id = $4`,
      [encryptedName, lookup, moduleId, organizationId],
    )
  }
}

export async function deleteOrganizationProjectModule(client: ModuleClient, organizationId: number, moduleId: number) {
  const existing = await client.query<{ enabled: boolean }>(
    `select enabled from organization_project_modules
     where id = $1 and organization_id = $2 for update`, [moduleId, organizationId],
  )
  const module = existing.rows[0]
  if (!module) throw new ProjectModuleError('PROJECT_MODULE_NOT_FOUND', '项目模块不存在。', 404)
  if (module.enabled) throw new ProjectModuleError('PROJECT_MODULE_ENABLED', '请先停用模块后再删除。')
  await client.query(
    `update project_modules pm set organization_module_id = null
       from projects p
      where pm.organization_module_id = $1::bigint and p.id = pm.project_id
        and p.organization_id = $2::bigint`, [moduleId, organizationId],
  )
  await client.query(
    'delete from organization_project_modules where id = $1 and organization_id = $2',
    [moduleId, organizationId],
  )
}

export async function detachOrganizationProjectModules(client: ModuleClient, organizationId: number) {
  await client.query(
    `update project_modules pm set name = module.name, name_lookup = module.name_lookup,
       organization_module_id = null
     from organization_project_modules module, projects p
     where pm.organization_module_id = module.id and module.organization_id = $1::bigint
       and p.id = pm.project_id and p.organization_id = $1::bigint`, [organizationId],
  )
}

export async function requirePersonalProjectModuleManagement(client: ModuleClient, projectId: number, userId: number) {
  const project = await client.query<{ organization_id: string | null; user_id: string }>(
    'select organization_id, user_id from projects where id = $1 for update', [projectId],
  )
  if (!project.rows[0]) throw new ProjectModuleError('PROJECT_NOT_FOUND', '项目不存在。', 404)
  if (Number(project.rows[0].user_id) !== userId) throw new ProjectModuleError('PROJECT_MODULE_FORBIDDEN', '仅项目 Owner 可以管理个人项目模块。', 403)
  if (project.rows[0].organization_id !== null) throw new ProjectModuleError(
    'PROJECT_MODULES_MANAGED_BY_ORGANIZATION', '项目模块由组织统一管理，请在组织设置中配置。',
  )
}

export async function createPersonalProjectModule(client: ModuleClient, projectId: number, name: string) {
  name = requireProjectModuleName(name)
  const lookup = projectModuleNameLookup(name, await lookupKeyId(client))
  await client.query(
    `insert into project_modules (project_id, name, name_lookup) values ($1, $2, $3)
     on conflict (project_id, name_lookup) do nothing`, [projectId, encryptText(name), lookup],
  )
}

// Caller holds the project advisory lock. Preserve a disabled/legacy association
// only when it is the locked todo's unchanged value, never for a new todo/proposal.
export async function resolveProjectModuleId(
  client: ModuleClient,
  projectId: number,
  value: unknown,
  currentModuleId: number | null = null,
) {
  const moduleId = parseProjectModuleId(value)
  if (moduleId === null) return null
  const result = await client.query<{
    organization_id: string | null; organization_module_id: string | null
  }>(
    `select p.organization_id, pm.organization_module_id from project_modules pm
     join projects p on p.id = pm.project_id where pm.id = $1 and pm.project_id = $2
     for share of p, pm`, [moduleId, projectId],
  )
  const row = result.rows[0]
  if (!row) throw new ProjectModuleError('PROJECT_MODULE_INVALID', '模块不属于当前项目，请重新选择。', 400)
  if (row.organization_id === null) return moduleId
  const catalog = row.organization_module_id ? await client.query<{ organization_id: string; enabled: boolean }>(
    'select organization_id, enabled from organization_project_modules where id = $1 for share', [row.organization_module_id],
  ) : null
  const module = catalog?.rows[0]
  const availability = projectModuleAvailability(Number(row.organization_id), module ? Number(module.organization_id) : null, module?.enabled ?? false)
  if (availability.selectable || currentModuleId === moduleId) return moduleId
  throw new ProjectModuleError('PROJECT_MODULE_UNAVAILABLE', '此模块已停用或不属于组织目录，请刷新后重新选择。')
}

export async function backfillProjectModuleNames(client: ModuleClient) {
  const keyId = await lookupKeyId(client)
  const result = await client.query<{ id: string; project_id: string; name: string; name_lookup: string | null }>(
    'select id, project_id, name, name_lookup from project_modules order by project_id, id for update',
  )
  const seen = new Map<string, string>()
  for (const row of result.rows) {
    const name = requireProjectModuleName(decryptText(row.name))
    const lookup = projectModuleNameLookup(name, keyId)
    const group = `${row.project_id}:${lookup}`
    const duplicateId = seen.get(group)
    if (duplicateId) {
      await client.query('update todos set project_module_id = $1 where project_module_id = $2', [duplicateId, row.id])
      await client.query('update ai_todo_proposals set project_module_id = $1 where project_module_id = $2', [duplicateId, row.id])
      await client.query('delete from project_modules where id = $1', [row.id])
      continue
    }
    seen.set(group, row.id)
    if (row.name_lookup !== lookup || !isEncryptedText(row.name)) {
      await client.query('update project_modules set name = $1, name_lookup = $2 where id = $3', [encryptText(name), lookup, row.id])
    }
  }
  const organizationModules = await client.query<{ id: string; name: string }>('select id, name from organization_project_modules order by id for update')
  for (const row of organizationModules.rows) {
    if (!isEncryptedText(row.name)) await client.query('update organization_project_modules set name = $1 where id = $2', [encryptText(row.name), row.id])
  }
}

// Startup runs this after schemaSql and before accepting requests. GET never writes.
// The singleton receipt makes the name-union import one-time, including after restarts.
export async function initializeProjectModules(pool: Pick<Pool, 'connect'>, encryptExisting = false) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('select pg_advisory_xact_lock(hashtextextended($1::text, 0))', ['project-modules-migration-v1'])
    await client.query(
      `insert into project_module_settings (id, lookup_key_id) values (1, $1) on conflict (id) do nothing`,
      [process.env.APP_ENCRYPTION_ACTIVE_KEY_ID?.trim()],
    )
    const settings = await client.query<{ initialized_at: Date | null; lookup_key_id: string }>('select initialized_at, lookup_key_id from project_module_settings where id = 1 for update')
    // Fail closed if a still-required index key has been removed from the key ring.
    projectModuleNameLookup('', settings.rows[0].lookup_key_id)
    if (!settings.rows[0].initialized_at || encryptExisting) {
      await client.query('lock table project_modules, organization_project_modules in share row exclusive mode')
      await backfillProjectModuleNames(client)
      if (!settings.rows[0].initialized_at) {
        await client.query(
          `insert into organization_project_modules (organization_id, name, name_lookup)
           select distinct on (p.organization_id, pm.name_lookup) p.organization_id, pm.name, pm.name_lookup
           from project_modules pm join projects p on p.id = pm.project_id
           where p.organization_id is not null
           order by p.organization_id, pm.name_lookup, pm.id
           on conflict (organization_id, name_lookup) do nothing`,
        )
        const organizations = await client.query<{ id: string }>('select id from organizations order by id')
        for (const organization of organizations.rows) await syncOrganizationProjectModules(client, Number(organization.id))
        await client.query(projectModulesFinalizeSql)
        await client.query('update project_module_settings set initialized_at = now() where id = 1')
      }
    }
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
