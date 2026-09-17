import type { QueryResultRow } from 'pg'
import { decryptText, encryptText, keyedDigest } from './crypto.ts'
import { pool, query } from './db.ts'
import { lockPlatformAdministration, requirePlatformAdminWithClient } from './platform-admins.ts'
import {
  createDefaultPlatformConfig,
  corruptedOAuthStateSecret,
  mergePlatformConfigSection,
  parsePlatformConfig,
  platformConfigSchemaVersion,
  type PlatformConfig,
} from './platform-config-schema.ts'
import type { PlatformConfigSection } from '../shared/platform-config.ts'
import { assertPlatformConfigTransitionAllowed } from './platform-config-transition.ts'

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

export async function assertPlatformBootstrapIntegrity() {
  const result = await query<{
    builtin_count: string
    callbacks_ready: boolean
    config_ready: boolean
  }>(
    `select
       (select count(*)::text from users
         join platform_admin_grants grant_row on grant_row.user_id = users.id
        where users.is_builtin_admin and lower(btrim(users.email)) = 'admin'
          and users.account_status = 'active' and users.password_hash <> ''
          and users.registration_source = 'builtin' and grant_row.grant_kind = 'builtin') as builtin_count,
       exists(select 1 from platform_instance_settings where singleton = true) as callbacks_ready,
       exists(select 1 from platform_config_state where singleton = true and active_revision is not null) as config_ready`,
  )
  const state = result.rows[0]
  if (Number(state?.builtin_count) !== 1) {
    throw Object.assign(new Error('内置 admin 超级管理员未正确初始化。'), { code: 'BUILTIN_ADMIN_NOT_INITIALIZED' })
  }
  if (!state?.callbacks_ready) {
    throw Object.assign(new Error('固定回调地址未初始化。'), { code: 'PLATFORM_CALLBACKS_NOT_INITIALIZED' })
  }
  if (!state?.config_ready) {
    throw Object.assign(new Error('平台配置未初始化。'), { code: 'PLATFORM_CONFIG_NOT_INITIALIZED' })
  }
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
    const receipt = await client.query<{ request_digest: string; result_revision: string | null }>(
      `select request_digest, result_revision
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
      return { replayed: true, revision: Number(receipt.rows[0].result_revision) }
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
    const changedFields = [
      ...Object.keys(input.fields && typeof input.fields === 'object' ? input.fields : {}),
      ...Object.keys(input.secretActions && typeof input.secretActions === 'object' ? input.secretActions : {}),
    ].map((field) => `${input.section}.${field}`)
    if (current?.config.feishu.oauthStateSecret === corruptedOAuthStateSecret &&
        nextConfig.feishu.oauthStateSecret !== corruptedOAuthStateSecret) {
      changedFields.push('feishu.oauthStateSecret')
    }
    await client.query(
      `insert into platform_audit_events
        (actor_user_id, action, section, before_revision, after_revision, changed_fields, request_id)
       values ($1, 'platform_config.saved', $2, $3, $4, $5::text[], $6::uuid)`,
      [input.actorUserId, input.section, currentRevision || null, revision, changedFields, input.requestId],
    )
    await client.query(`select pg_notify('veges_platform_config', $1)`, [String(revision)])
    await client.query('commit')
    return { replayed: false, revision }
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
  const result = await query<{
    created_at: Date
    created_by: string | null
    revision: string
    source: string
  }>(
    `select version.revision, version.source, version.created_at,
            coalesce(nullif(users.display_name, ''), users.email) as created_by
       from platform_config_versions version
       left join users on users.id = version.created_by_user_id
      order by version.revision desc
      limit $1`,
    [Math.min(Math.max(limit, 1), 100)],
  )
  return result.rows.map((row) => ({
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by ?? '系统',
    revision: Number(row.revision),
    source: row.source,
  }))
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
    const existingReceipt = await client.query<{ request_digest: string; result_revision: string | null }>(
      `select request_digest, result_revision from platform_config_mutation_receipts
        where actor_user_id = $1 and request_id = $2::uuid for update`,
      [input.actorUserId, input.requestId],
    )
    if (existingReceipt.rows[0]) {
      if (existingReceipt.rows[0].request_digest !== digest) {
        throw new PlatformConfigStoreError('REQUEST_ID_CONFLICT', '该请求编号已用于其他配置变更。')
      }
      await client.query('commit')
      return { replayed: true, revision: Number(existingReceipt.rows[0].result_revision) }
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
        (actor_user_id, action, section, before_revision, after_revision, changed_fields, request_id)
       values ($1, 'platform_config.restored', 'history', $2, $3, array['*'], $4::uuid)`,
      [input.actorUserId, currentRevision || null, revision, input.requestId],
    )
    await client.query(`select pg_notify('veges_platform_config', $1)`, [String(revision)])
    await client.query('commit')
    return { replayed: false, revision }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function getPlatformInstanceSettings() {
  const result = await query<{
    event_callback_url_encrypted: string
    oauth_redirect_url_encrypted: string
  }>(
    `select event_callback_url_encrypted, oauth_redirect_url_encrypted
       from platform_instance_settings where singleton = true`,
  )
  const row = result.rows[0]
  return row ? {
    eventCallbackUrl: decryptText(row.event_callback_url_encrypted),
    oauthRedirectUrl: decryptText(row.oauth_redirect_url_encrypted),
  } : null
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
