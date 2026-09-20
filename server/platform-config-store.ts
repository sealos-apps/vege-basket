import type { QueryResultRow } from 'pg'
import { decryptText, encryptText, keyedDigest } from './crypto.ts'
import { pool, query } from './db.ts'
import { lockPlatformAdministration, requirePlatformAdminWithClient } from './platform-admins.ts'
import {
  createDefaultPlatformConfig,
  mergePlatformConfigSection,
  parsePlatformConfig,
  platformConfigSchemaVersion,
  type PlatformConfig,
} from './platform-config-schema.ts'
import type { PlatformConfigSection } from '../shared/platform-config.ts'
import { assertPlatformConfigTransitionAllowed } from './platform-config-transition.ts'
import {
  diffPlatformConfigs,
  groupPlatformConfigChanges,
  platformConfigsEqual,
  platformConfigSourceLabel,
} from './platform-config-history.ts'

export type VersionedPlatformConfig = {
  config: PlatformConfig
  createdAt: string
  revision: number
  source: string
}

type QueryExecutor = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>
}

type ConfigVersionRow = {
  created_at: Date
  payload_encrypted: string
  revision: string
  schema_version: number
  source: string
}

type ConfigHistoryRow = ConfigVersionRow & {
  audit_before_revision: string | null
  audit_target_id: string | null
  audit_target_type: string | null
  created_by: string | null
}

export class PlatformConfigStoreError extends Error {
  readonly code: string
  readonly status: number

  constructor(
    code: string,
    message: string,
    status = 409,
  ) {
    super(message)
    this.name = 'PlatformConfigStoreError'
    this.code = code
    this.status = status
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    )
  }
  return value
}

export function platformMutationDigest(value: unknown) {
  return keyedDigest(JSON.stringify(stableValue(value)))
}

function parseStoredConfig(row: ConfigVersionRow): VersionedPlatformConfig {
  if (row.schema_version !== platformConfigSchemaVersion) {
    throw new PlatformConfigStoreError(
      'PLATFORM_CONFIG_SCHEMA_UNSUPPORTED',
      `不支持的平台配置版本：${row.schema_version}。`,
      503,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(decryptText(row.payload_encrypted))
  } catch {
    throw new PlatformConfigStoreError('PLATFORM_CONFIG_DECRYPT_FAILED', '平台配置无法解密。', 503)
  }
  return {
    config: parsePlatformConfig(parsed),
    createdAt: row.created_at.toISOString(),
    revision: Number(row.revision),
    source: row.source,
  }
}

function receiptChanged(action: string) {
  return !action.startsWith('noop:')
}

function explicitRestoreRevision(row: ConfigHistoryRow) {
  if (row.audit_target_type !== 'platform_config_revision') return null
  const revision = Number(row.audit_target_id)
  return Number.isSafeInteger(revision) && revision > 0 ? revision : null
}

function inferredRestoreRevision(
  row: ConfigHistoryRow,
  version: VersionedPlatformConfig,
  candidates: VersionedPlatformConfig[],
) {
  const explicit = explicitRestoreRevision(row)
  if (explicit) return explicit
  if (row.source !== 'restore') return null
  const matches = candidates.filter((candidate) => (
    candidate.revision < version.revision && platformConfigsEqual(candidate.config, version.config)
  ))
  return matches.length === 1 ? matches[0].revision : null
}

async function currentConfigWith(executor: QueryExecutor) {
  const result = await executor.query<ConfigVersionRow>(
    `select version.revision, version.schema_version, version.payload_encrypted,
            version.source, version.created_at
       from platform_config_state state
       join platform_config_versions version on version.revision = state.active_revision
      where state.singleton = true`,
  )
  return result.rows[0] ? parseStoredConfig(result.rows[0]) : null
}

async function retainDisplacedTodoImageUrlSecret(
  executor: QueryExecutor,
  current: VersionedPlatformConfig | null,
  nextConfig: PlatformConfig,
) {
  const previousSecret = current?.config.storage.urlSecret ?? ''
  if (!previousSecret || previousSecret === nextConfig.storage.urlSecret) return
  await executor.query(
    `insert into platform_security_secrets
      (purpose, key_id, secret_encrypted, legacy_verify_only, retired_at)
     values ('todo_image_url', $1, $2, true, now())
     on conflict (purpose, key_id) do nothing`,
    [`config-revision-${current!.revision}`, encryptText(previousSecret)],
  )
}

export async function getCurrentPlatformConfig(): Promise<VersionedPlatformConfig | null> {
  return currentConfigWith({ query })
}

export async function getPlatformConfigByRevision(revision: number): Promise<VersionedPlatformConfig | null> {
  if (!Number.isSafeInteger(revision) || revision <= 0) return null
  const result = await query<ConfigVersionRow>(
    `select revision, schema_version, payload_encrypted, source, created_at
       from platform_config_versions where revision = $1`,
    [revision],
  )
  return result.rows[0] ? parseStoredConfig(result.rows[0]) : null
}

export async function getCurrentPlatformRevision() {
  const result = await query<{ active_revision: string | null }>(
    'select active_revision from platform_config_state where singleton = true',
  )
  return result.rows[0]?.active_revision ? Number(result.rows[0].active_revision) : 0
}

export async function savePlatformConfigSection(input: {
  actorUserId: number
  expectedRevision: number
  fields: unknown
  requestId: string
  secretActions: unknown
  section: PlatformConfigSection
}) {
  const digest = platformMutationDigest({
    expectedRevision: input.expectedRevision,
    fields: input.fields,
    secretActions: input.secretActions,
    section: input.section,
  })
  const client = await pool.connect()
  try {
    await client.query('begin')
    await lockPlatformAdministration(client)
    await requirePlatformAdminWithClient(client, input.actorUserId)
    const receipt = await client.query<{ action: string; request_digest: string; result_revision: string | null }>(
      `select action, request_digest, result_revision
         from platform_config_mutation_receipts
        where actor_user_id = $1 and request_id = $2::uuid
        for update`,
      [input.actorUserId, input.requestId],
    )
    if (receipt.rows[0]) {
      if (receipt.rows[0].request_digest !== digest) {
        throw new PlatformConfigStoreError('REQUEST_ID_CONFLICT', '该请求编号已用于其他配置变更。')
      }
      await client.query('commit')
      return {
        changed: receiptChanged(receipt.rows[0].action),
        replayed: true,
        revision: Number(receipt.rows[0].result_revision),
      }
    }

    const state = await client.query<{ active_revision: string | null }>(
      'select active_revision from platform_config_state where singleton = true for update',
    )
    const currentRevision = state.rows[0]?.active_revision ? Number(state.rows[0].active_revision) : 0
    if (currentRevision !== input.expectedRevision) {
      throw new PlatformConfigStoreError('PLATFORM_CONFIG_VERSION_CONFLICT', '平台配置已更新，请刷新后重试。')
    }
    const current = await currentConfigWith(client)
    const nextConfig = mergePlatformConfigSection(
      current?.config ?? createDefaultPlatformConfig(),
      input.section,
      input.fields,
      input.secretActions,
    )
    const changes = diffPlatformConfigs(current?.config ?? null, nextConfig)
    if (current && changes.length === 0) {
      await client.query(
        `insert into platform_config_mutation_receipts
          (actor_user_id, request_id, action, request_digest, result_revision)
         values ($1, $2::uuid, $3, $4, $5)`,
        [input.actorUserId, input.requestId, `noop:save:${input.section}`, digest, currentRevision],
      )
      await client.query('commit')
      return { changed: false, replayed: false, revision: currentRevision }
    }
    if (current) await assertPlatformConfigTransitionAllowed(client, current.config, nextConfig)
    await retainDisplacedTodoImageUrlSecret(client, current, nextConfig)
    const inserted = await client.query<{ revision: string }>(
      `insert into platform_config_versions
        (schema_version, payload_encrypted, created_by_user_id, source)
       values ($1, $2, $3, 'platform')
       returning revision`,
      [platformConfigSchemaVersion, encryptText(JSON.stringify(nextConfig)), input.actorUserId],
    )
    const revision = Number(inserted.rows[0].revision)
    await client.query(
      `update platform_config_state
          set active_revision = $1, updated_at = now()
        where singleton = true`,
      [revision],
    )
    await client.query(
      `insert into platform_config_mutation_receipts
        (actor_user_id, request_id, action, request_digest, result_revision)
       values ($1, $2::uuid, $3, $4, $5)`,
      [input.actorUserId, input.requestId, `save:${input.section}`, digest, revision],
    )
    await client.query(
      `insert into platform_audit_events
        (actor_user_id, action, section, before_revision, after_revision, changed_fields, request_id)
       values ($1, 'platform_config.saved', $2, $3, $4, $5::text[], $6::uuid)`,
      [
        input.actorUserId,
        input.section,
        currentRevision || null,
        revision,
        changes.map((change) => change.field),
        input.requestId,
      ],
    )
    await client.query(`select pg_notify('veges_platform_config', $1)`, [String(revision)])
    await client.query('commit')
    return { changed: true, replayed: false, revision }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function revealCurrentPlatformSecret(input: {
  actorUserId: number
  expectedRevision: number
  field: string
}) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await lockPlatformAdministration(client)
    await requirePlatformAdminWithClient(client, input.actorUserId)
    const current = await currentConfigWith(client)
    if (!current || current.revision !== input.expectedRevision) {
      throw new PlatformConfigStoreError('PLATFORM_CONFIG_VERSION_CONFLICT', '平台配置已更新，请刷新后重试。')
    }
    const { revealPlatformSecret } = await import('./platform-config-schema.ts')
    const value = revealPlatformSecret(current.config, input.field)
    if (value === null) {
      throw new PlatformConfigStoreError('SECRET_FIELD_NOT_REVEALABLE', '该字段不允许查看。', 403)
    }
    await client.query(
      `insert into platform_audit_events
        (actor_user_id, action, section, target_type, target_id, before_revision, after_revision, changed_fields)
       values ($1, 'platform_secret.revealed', split_part($2, '.', 1), 'secret', $2, $3, $3, array[$2])`,
      [input.actorUserId, input.field, current.revision],
    )
    await client.query('commit')
    return { configured: value.length > 0, revision: current.revision, value }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function getPlatformConfigHistory(limit = 50) {
  const boundedLimit = Math.min(Math.max(limit, 1), 100)
  const result = await query<ConfigHistoryRow>(
    `select version.revision, version.schema_version, version.payload_encrypted,
            version.source, version.created_at,
            coalesce(nullif(users.display_name, ''), users.email) as created_by,
            audit.before_revision as audit_before_revision,
            audit.target_type as audit_target_type,
            audit.target_id as audit_target_id
       from platform_config_versions version
       left join users on users.id = version.created_by_user_id
       left join lateral (
         select event.before_revision, event.target_type, event.target_id
           from platform_audit_events event
          where event.after_revision = version.revision
            and event.action in ('platform_config.saved', 'platform_config.restored')
          order by event.id desc
          limit 1
       ) audit on true
      order by version.revision desc
      limit $1`,
    [boundedLimit + 1],
  )
  const versions = result.rows.map(parseStoredConfig)
  return result.rows.slice(0, boundedLimit).map((row, index) => {
    const version = versions[index]
    const previous = versions[index + 1] ?? null
    const groups = groupPlatformConfigChanges(diffPlatformConfigs(previous?.config ?? null, version.config))
    return {
      changeCount: groups.reduce((sum, group) => sum + group.count, 0),
      changedSections: groups.map(({ count, section, sectionLabel }) => ({ count, section, sectionLabel })),
      createdAt: row.created_at.toISOString(),
      createdBy: row.created_by ?? '系统',
      restoredFromRevision: inferredRestoreRevision(row, version, versions.slice(index + 1)),
      revision: version.revision,
      source: row.source,
      sourceLabel: platformConfigSourceLabel(row.source),
    }
  })
}

export async function getPlatformConfigHistoryDetail(revision: number) {
  if (!Number.isSafeInteger(revision) || revision <= 0) return null
  const result = await query<ConfigHistoryRow>(
    `select version.revision, version.schema_version, version.payload_encrypted,
            version.source, version.created_at,
            coalesce(nullif(users.display_name, ''), users.email) as created_by,
            audit.before_revision as audit_before_revision,
            audit.target_type as audit_target_type,
            audit.target_id as audit_target_id
       from platform_config_versions version
       left join users on users.id = version.created_by_user_id
       left join lateral (
         select event.before_revision, event.target_type, event.target_id
           from platform_audit_events event
          where event.after_revision = version.revision
            and event.action in ('platform_config.saved', 'platform_config.restored')
          order by event.id desc
          limit 1
       ) audit on true
      where version.revision = $1`,
    [revision],
  )
  const row = result.rows[0]
  if (!row) return null
  const version = parseStoredConfig(row)
  const auditBeforeRevision = row.audit_before_revision ? Number(row.audit_before_revision) : null
  const previousResult = await query<ConfigVersionRow>(
    auditBeforeRevision
      ? `select revision, schema_version, payload_encrypted, source, created_at
           from platform_config_versions where revision = $1`
      : `select revision, schema_version, payload_encrypted, source, created_at
           from platform_config_versions where revision < $1 order by revision desc limit 1`,
    [auditBeforeRevision ?? revision],
  )
  const previous = previousResult.rows[0] ? parseStoredConfig(previousResult.rows[0]) : null
  const current = await getCurrentPlatformConfig()
  let restoredFromRevision = explicitRestoreRevision(row)
  if (!restoredFromRevision && row.source === 'restore') {
    const candidates = await query<ConfigVersionRow>(
      `select revision, schema_version, payload_encrypted, source, created_at
         from platform_config_versions
        where revision < $1
        order by revision desc
        limit 101`,
      [revision],
    )
    restoredFromRevision = inferredRestoreRevision(
      row,
      version,
      candidates.rows.map(parseStoredConfig),
    )
  }
  return {
    changesFromCurrent: groupPlatformConfigChanges(diffPlatformConfigs(current?.config ?? null, version.config)),
    changesFromPrevious: groupPlatformConfigChanges(diffPlatformConfigs(previous?.config ?? null, version.config)),
    currentRevision: current?.revision ?? 0,
    previousRevision: previous?.revision ?? null,
    restoredFromRevision,
    version: {
      createdAt: row.created_at.toISOString(),
      createdBy: row.created_by ?? '系统',
      revision: version.revision,
      source: row.source,
      sourceLabel: platformConfigSourceLabel(row.source),
    },
  }
}

export async function restorePlatformConfig(input: {
  actorUserId: number
  expectedRevision: number
  requestId: string
  targetRevision: number
}) {
  const digest = platformMutationDigest({
    expectedRevision: input.expectedRevision,
    targetRevision: input.targetRevision,
  })
  const client = await pool.connect()
  try {
    await client.query('begin')
    await lockPlatformAdministration(client)
    await requirePlatformAdminWithClient(client, input.actorUserId)
    const existingReceipt = await client.query<{ action: string; request_digest: string; result_revision: string | null }>(
      `select action, request_digest, result_revision from platform_config_mutation_receipts
        where actor_user_id = $1 and request_id = $2::uuid for update`,
      [input.actorUserId, input.requestId],
    )
    if (existingReceipt.rows[0]) {
      if (existingReceipt.rows[0].request_digest !== digest) {
        throw new PlatformConfigStoreError('REQUEST_ID_CONFLICT', '该请求编号已用于其他配置变更。')
      }
      await client.query('commit')
      return {
        changed: receiptChanged(existingReceipt.rows[0].action),
        replayed: true,
        revision: Number(existingReceipt.rows[0].result_revision),
      }
    }
    const state = await client.query<{ active_revision: string | null }>(
      'select active_revision from platform_config_state where singleton = true for update',
    )
    const currentRevision = state.rows[0]?.active_revision ? Number(state.rows[0].active_revision) : 0
    if (currentRevision !== input.expectedRevision) {
      throw new PlatformConfigStoreError('PLATFORM_CONFIG_VERSION_CONFLICT', '平台配置已更新，请刷新后重试。')
    }
    const target = await client.query<ConfigVersionRow>(
      `select revision, schema_version, payload_encrypted, source, created_at
         from platform_config_versions where revision = $1`,
      [input.targetRevision],
    )
    if (!target.rows[0]) throw new PlatformConfigStoreError('PLATFORM_CONFIG_VERSION_NOT_FOUND', '目标配置版本不存在。', 404)
    const targetConfig = parseStoredConfig(target.rows[0]).config
    const current = await currentConfigWith(client)
    const changes = diffPlatformConfigs(current?.config ?? null, targetConfig)
    if (current && changes.length === 0) {
      await client.query(
        `insert into platform_config_mutation_receipts
          (actor_user_id, request_id, action, request_digest, result_revision)
         values ($1, $2::uuid, 'noop:restore', $3, $4)`,
        [input.actorUserId, input.requestId, digest, currentRevision],
      )
      await client.query('commit')
      return { changed: false, replayed: false, revision: currentRevision }
    }
    if (current) await assertPlatformConfigTransitionAllowed(client, current.config, targetConfig)
    await retainDisplacedTodoImageUrlSecret(client, current, targetConfig)
    const inserted = await client.query<{ revision: string }>(
      `insert into platform_config_versions
        (schema_version, payload_encrypted, created_by_user_id, source)
       values ($1, $2, $3, 'restore') returning revision`,
      [platformConfigSchemaVersion, encryptText(JSON.stringify(targetConfig)), input.actorUserId],
    )
    const revision = Number(inserted.rows[0].revision)
    await client.query(
      `update platform_config_state set active_revision = $1, updated_at = now()
        where singleton = true`,
      [revision],
    )
    await client.query(
      `insert into platform_config_mutation_receipts
        (actor_user_id, request_id, action, request_digest, result_revision)
       values ($1, $2::uuid, 'restore', $3, $4)`,
      [input.actorUserId, input.requestId, digest, revision],
    )
    await client.query(
      `insert into platform_audit_events
        (actor_user_id, action, section, target_type, target_id,
         before_revision, after_revision, changed_fields, request_id)
       values ($1, 'platform_config.restored', 'history', 'platform_config_revision', $2,
               $3, $4, $5::text[], $6::uuid)`,
      [
        input.actorUserId,
        String(input.targetRevision),
        currentRevision || null,
        revision,
        changes.map((change) => change.field),
        input.requestId,
      ],
    )
    await client.query(`select pg_notify('veges_platform_config', $1)`, [String(revision)])
    await client.query('commit')
    return { changed: true, replayed: false, revision }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function getLegacyPlatformSecrets(purpose: string) {
  const result = await query<{ secret_encrypted: string }>(
    `select secret_encrypted from platform_security_secrets
      where purpose = $1 and legacy_verify_only = true
      order by created_at desc`,
    [purpose],
  )
  return result.rows.map((row) => decryptText(row.secret_encrypted))
}

export async function markPlatformStorageUsed(revision: number) {
  await query(
    `insert into platform_storage_usage (singleton, first_used_revision)
     values (true, $1) on conflict (singleton) do nothing`,
    [revision],
  )
}

export async function recordPlatformSecretRevealFailure(actorUserId: number, field: string, code: string) {
  await query(
    `insert into platform_audit_events
      (actor_user_id, action, section, target_type, target_id, detail_encrypted)
     values ($1, 'platform_secret.reveal_failed', split_part($2, '.', 1), 'secret', $2, $3)`,
    [actorUserId, field, encryptText(JSON.stringify({ code }))],
  )
}
