import type { NextFunction, Request, Response } from 'express'
import type { PoolClient } from 'pg'
import { normalizePlatformPublicOrigin } from '../shared/platform-callback-urls.ts'
import { getDatabaseMigrationStatus } from './database-migrations.ts'
import { pool, query } from './db.ts'
import { validatePackageRulesYaml } from './package-rules-validator.ts'
import { lockPlatformAdministration, requirePlatformAdminWithClient } from './platform-admins.ts'
import { getCurrentPlatformConfig, platformMutationDigest } from './platform-config-store.ts'

type OperationalState = {
  enabledAt?: string
  maintenanceEnabled: boolean
  maintenanceMessage: string
  revision: number
  updatedAt?: string
}

const defaultState: OperationalState = {
  maintenanceEnabled: true,
  maintenanceMessage: '平台正在准备服务。',
  revision: 0,
}

let activeState = defaultState
let configInitialized = false
let listener: PoolClient | null = null
let reconcileTimer: NodeJS.Timeout | null = null
let stopped = false

export class PlatformMaintenanceError extends Error {
  readonly blockers?: string[]
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 409, blockers?: string[]) {
    super(message)
    this.name = 'PlatformMaintenanceError'
    this.blockers = blockers
    this.code = code
    this.status = status
  }
}

function toState(row: {
  enabled_at: Date | null
  maintenance_enabled: boolean
  maintenance_message: string
  revision: string
  updated_at: Date
}): OperationalState {
  return {
    enabledAt: row.enabled_at?.toISOString(),
    maintenanceEnabled: row.maintenance_enabled,
    maintenanceMessage: row.maintenance_message,
    revision: Number(row.revision),
    updatedAt: row.updated_at.toISOString(),
  }
}

export async function refreshPlatformOperationalState() {
  const result = await query<{
    config_initialized: boolean
    enabled_at: Date | null
    maintenance_enabled: boolean
    maintenance_message: string
    revision: string
    updated_at: Date
  }>(
    `select state.maintenance_enabled, state.maintenance_message, state.revision,
            state.enabled_at, state.updated_at,
            exists(select 1 from platform_config_state config_state
                    where config_state.singleton = true and config_state.active_revision is not null) as config_initialized
       from platform_operational_state state
      where state.singleton = true`,
  )
  if (!result.rows[0]) throw new PlatformMaintenanceError('PLATFORM_OPERATIONAL_STATE_MISSING', '平台运行状态尚未初始化。', 503)
  activeState = toState(result.rows[0])
  configInitialized = result.rows[0].config_initialized
  return activeState
}

export function getPlatformOperationalRevision() {
  return activeState.revision
}

export function getPublicPlatformStatus() {
  const migration = getDatabaseMigrationStatus()
  const systemReasons: string[] = []
  if (migration.phase !== 'completed') systemReasons.push(
    migration.errorCode === 'DATABASE_CONNECTION_FAILED'
      ? '数据库连接不可用'
      : migration.phase === 'failed' ? '数据库迁移失败' : '数据库正在迁移',
  )
  if (migration.phase === 'completed' && !configInitialized) systemReasons.push('平台尚未完成初始配置')
  const active = activeState.maintenanceEnabled || systemReasons.length > 0
  return {
    configInitialized,
    maintenance: {
      active,
      manual: activeState.maintenanceEnabled,
      message: activeState.maintenanceMessage || systemReasons[0] || '',
      revision: activeState.revision,
      systemForced: systemReasons.length > 0,
      systemReasons,
    },
    migration,
  }
}

export type PlatformLoginAccess = 'blocked' | 'builtin-admin-only' | 'open' | 'platform-admin-only'

export function platformLoginAccess(status: {
  maintenance: { active: boolean; systemForced: boolean }
  migration: { phase: string }
}): PlatformLoginAccess {
  if (!status.maintenance.active) return 'open'
  if (status.migration.phase !== 'completed') return 'blocked'
  return status.maintenance.systemForced ? 'builtin-admin-only' : 'platform-admin-only'
}

function isAlwaysAllowed(request: Request) {
  if (request.path === '/health' || request.path === '/ready' || request.path === '/platform-status') return true
  if (getDatabaseMigrationStatus().phase !== 'completed') return false
  if (request.path === '/platform-info') return true
  if (request.path === '/auth/login' || request.path === '/auth/logout') return true
  if (request.path === '/auth/feishu/oauth/url' || request.path === '/auth/feishu/oauth/callback') return true
  if ((request.path === '/auth/me' || request.path === '/auth/context') && request.method === 'GET') return true
  return [
    '/admin/platform-config',
    '/admin/platform-security',
    '/admin/platform-maintenance',
    '/admin/platform-migrations',
    '/admin/platform-mutations',
    '/admin/platform-admins',
    '/admin/users',
    '/admin/organizations',
  ].some((prefix) => request.path === prefix || request.path.startsWith(`${prefix}/`))
}

export function platformMaintenanceMiddleware(request: Request, response: Response, next: NextFunction) {
  const status = getPublicPlatformStatus()
  if (!status.maintenance.active || isAlwaysAllowed(request)) {
    next()
    return
  }
  response.setHeader('Retry-After', '5')
  response.status(503).json({
    code: 'PLATFORM_MAINTENANCE',
    error: status.maintenance.message || '平台正在维护，请稍后重试。',
    maintenance: status.maintenance,
  })
}

async function connectListener() {
  if (stopped || listener) return
  const client = await pool.connect()
  try {
    client.on('notification', (message) => {
      if (message.channel === 'veges_platform_operation') void refreshPlatformOperationalState().catch(() => undefined)
    })
    client.on('error', () => {
      if (listener === client) listener = null
      client.release(true)
      if (!stopped) setTimeout(() => void connectListener().catch(() => undefined), 1_000).unref()
    })
    await client.query('listen veges_platform_operation')
    listener = client
  } catch (error) {
    if (listener === client) listener = null
    client.release(true)
    throw error
  }
}

export async function startPlatformMaintenanceRuntime() {
  stopped = false
  await refreshPlatformOperationalState()
  await connectListener()
  reconcileTimer = setInterval(() => void refreshPlatformOperationalState().catch(() => undefined), 5_000)
  reconcileTimer.unref()
}

export async function stopPlatformMaintenanceRuntime() {
  stopped = true
  if (reconcileTimer) clearInterval(reconcileTimer)
  reconcileTimer = null
  if (listener) {
    const client = listener
    listener = null
    await client.query('unlisten veges_platform_operation').catch(() => undefined)
    client.release()
  }
}

async function disableBlockers() {
  const blockers: string[] = []
  if (getDatabaseMigrationStatus().phase !== 'completed') blockers.push('数据库迁移尚未完成')
  const current = await getCurrentPlatformConfig()
  if (!current) return [...blockers, '平台尚未保存任何配置版本']
  const config = current.config
  if (!normalizePlatformPublicOrigin(config.general.publicUrl)) blockers.push('公网地址未完成有效配置')
  if (!(config.storage.endpoint && config.storage.bucket && config.storage.accessKeyId &&
        config.storage.accessKeySecret && config.storage.urlSecret)) {
    blockers.push('对象存储核心凭据未完整配置')
  }
  if (!(config.feishu.appId && config.feishu.appSecret && config.feishu.verificationToken && config.feishu.oauthStateSecret)) {
    blockers.push('飞书登录核心凭据未完整配置')
  }
  const rules = validatePackageRulesYaml(config.packages.rulesYaml)
  if (!rules.valid) blockers.push('包市场规则未通过校验')
  const instances = await query<{
    applied_revision: string | null
    error_code: string
    heartbeat_at: Date
  }>(
    `select applied_revision, error_code, heartbeat_at
       from platform_config_runtime_status
      where heartbeat_at >= clock_timestamp() - interval '45 seconds'`,
  )
  if (instances.rows.length === 0) blockers.push('没有在线 API 实例')
  if (instances.rows.some((row) => row.error_code || Number(row.applied_revision ?? 0) !== current.revision)) {
    blockers.push('尚有在线 API 实例未加载当前配置')
  }
  return blockers
}

export async function updatePlatformMaintenance(input: {
  actorUserId: number
  enabled: boolean
  expectedRevision: number
  message: string
  requestId: string
}) {
  const digest = platformMutationDigest({
    enabled: input.enabled,
    expectedRevision: input.expectedRevision,
    message: input.message,
  })
  const client = await pool.connect()
  try {
    await client.query('begin')
    await lockPlatformAdministration(client)
    await requirePlatformAdminWithClient(client, input.actorUserId)
    const receipt = await client.query<{
      request_digest: string
      result_changed: boolean
      result_enabled: boolean
      result_revision: string
    }>(
      `select request_digest, result_enabled, result_revision, result_changed
         from platform_operational_mutation_receipts
        where actor_user_id = $1 and request_id = $2::uuid for update`,
      [input.actorUserId, input.requestId],
    )
    if (receipt.rows[0]) {
      if (receipt.rows[0].request_digest !== digest) {
        throw new PlatformMaintenanceError('REQUEST_ID_CONFLICT', '该请求编号已用于其他维护状态变更。')
      }
      await client.query('commit')
      return {
        changed: receipt.rows[0].result_changed,
        enabled: receipt.rows[0].result_enabled,
        replayed: true,
        revision: Number(receipt.rows[0].result_revision),
      }
    }
    const state = await client.query<{
      enabled_at: Date | null
      enabled_by_user_id: string | null
      maintenance_enabled: boolean
      maintenance_message: string
      revision: string
    }>(
      `select maintenance_enabled, maintenance_message, revision, enabled_at, enabled_by_user_id
         from platform_operational_state where singleton = true for update`,
    )
    const current = state.rows[0]
    if (!current || Number(current.revision) !== input.expectedRevision) {
      throw new PlatformMaintenanceError('PLATFORM_MAINTENANCE_VERSION_CONFLICT', '维护状态已更新，请刷新后重试。')
    }
    if (!input.enabled) {
      const blockers = await disableBlockers()
      if (blockers.length > 0) {
        throw new PlatformMaintenanceError(
          'PLATFORM_MAINTENANCE_DISABLE_BLOCKED',
          '当前条件不允许结束维护模式。',
          409,
          blockers,
        )
      }
    }
    const normalizedMessage = input.message.trim().slice(0, 500)
    const changed = current.maintenance_enabled !== input.enabled ||
      current.maintenance_message !== normalizedMessage
    const revision = changed ? Number(current.revision) + 1 : Number(current.revision)
    if (changed) {
      const changedAt = (await client.query<{ changed_at: Date }>(
        'select clock_timestamp() as changed_at',
      )).rows[0].changed_at
      if (!current.maintenance_enabled && input.enabled) {
        await client.query(
          `insert into platform_maintenance_periods
            (message, started_by_user_id, started_at, start_revision)
           values ($1::text, $2::bigint, $3::timestamptz, $4::bigint)`,
          [normalizedMessage, input.actorUserId, changedAt, revision],
        )
      } else if (current.maintenance_enabled && input.enabled) {
        const updatedPeriod = await client.query(
          `update platform_maintenance_periods
              set message = $1::text
            where ended_at is null`,
          [normalizedMessage],
        )
        if (updatedPeriod.rowCount === 0 && current.enabled_by_user_id !== null) {
          await client.query(
            `insert into platform_maintenance_periods
              (message, started_by_user_id, started_at, start_revision)
             values ($1::text, $2::bigint, $3::timestamptz, $4::bigint)`,
            [
              normalizedMessage,
              Number(current.enabled_by_user_id ?? input.actorUserId),
              current.enabled_at ?? changedAt,
              Number(current.revision),
            ],
          )
        }
      } else if (current.maintenance_enabled && !input.enabled) {
        const closedPeriod = await client.query(
          `update platform_maintenance_periods
              set ended_by_user_id = $1::bigint,
                  ended_at = $2::timestamptz,
                  duration_seconds = greatest(
                    0::numeric,
                    floor(extract(epoch from ($2::timestamptz - started_at)))
                  )::bigint,
                  end_revision = $3::bigint
            where ended_at is null`,
          [input.actorUserId, changedAt, revision],
        )
        if (closedPeriod.rowCount === 0 && current.enabled_by_user_id !== null) {
          const startedAt = current.enabled_at ?? changedAt
          await client.query(
            `insert into platform_maintenance_periods
              (message, started_by_user_id, started_at, ended_by_user_id, ended_at,
               duration_seconds, start_revision, end_revision)
             values (
               $1::text, $2::bigint, $3::timestamptz, $4::bigint, $5::timestamptz,
               greatest(0::numeric, floor(extract(epoch from ($5::timestamptz - $3::timestamptz))))::bigint,
               $6::bigint, $7::bigint
             )`,
            [
              current.maintenance_message,
              Number(current.enabled_by_user_id ?? input.actorUserId),
              startedAt,
              input.actorUserId,
              changedAt,
              Number(current.revision),
              revision,
            ],
          )
        }
      }
      await client.query(
        `update platform_operational_state
            set maintenance_enabled = $1::boolean, maintenance_message = $2::text, revision = $3::bigint,
                enabled_by_user_id = case
                  when $1::boolean and maintenance_enabled then enabled_by_user_id
                  when $1::boolean then $4::bigint
                  else null::bigint
                end,
                enabled_at = case
                  when $1::boolean and maintenance_enabled then enabled_at
                  when $1::boolean then $5::timestamptz
                  else null::timestamptz
                end,
                updated_by_user_id = $4::bigint, updated_at = $5::timestamptz
          where singleton = true`,
        [input.enabled, normalizedMessage, revision, input.actorUserId, changedAt],
      )
      const action = current.maintenance_enabled === input.enabled
        ? 'platform.maintenance_message_updated'
        : input.enabled
          ? 'platform.maintenance_enabled'
          : 'platform.maintenance_disabled'
      await client.query(
        `insert into platform_audit_events
          (actor_user_id, action, section, target_type, target_id, changed_fields, request_id)
         values ($1, $2, 'maintenance', 'platform', 'singleton', $3::text[], $4::uuid)`,
        [input.actorUserId, action,
          current.maintenance_enabled === input.enabled
            ? ['maintenanceMessage']
            : ['maintenanceEnabled', 'maintenanceMessage'], input.requestId],
      )
      await client.query(`select pg_notify('veges_platform_operation', $1)`, [String(revision)])
    }
    await client.query(
      `insert into platform_operational_mutation_receipts
        (actor_user_id, request_id, request_digest, result_revision, result_enabled, result_changed)
       values ($1, $2::uuid, $3, $4, $5, $6)`,
      [input.actorUserId, input.requestId, digest, revision, input.enabled, changed],
    )
    await client.query('commit')
    if (changed) await refreshPlatformOperationalState()
    return { changed, enabled: input.enabled, replayed: false, revision }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function listPlatformMaintenanceHistory(input: {
  beforeId?: number
  limit: number
}) {
  const limit = Math.min(Math.max(Math.trunc(input.limit), 1), 100)
  const result = await query<{
    duration_seconds: string | null
    ended_at: Date | null
    ended_by_display_name: string | null
    ended_by_user_id: string | null
    ended_by_username: string | null
    id: string
    message: string
    started_at: Date
    started_by_display_name: string | null
    started_by_user_id: string | null
    started_by_username: string | null
  }>(
    `select period.id, period.message, period.started_at, period.ended_at, period.duration_seconds,
            started_user.id as started_by_user_id, started_user.email as started_by_username,
            started_user.display_name as started_by_display_name,
            ended_user.id as ended_by_user_id, ended_user.email as ended_by_username,
            ended_user.display_name as ended_by_display_name
       from platform_maintenance_periods period
       left join users started_user on started_user.id = period.started_by_user_id
       left join users ended_user on ended_user.id = period.ended_by_user_id
      where ($1::bigint is null or period.id < $1::bigint)
      order by period.id desc
      limit $2::integer`,
    [input.beforeId ?? null, limit + 1],
  )
  const hasMore = result.rows.length > limit
  const rows = hasMore ? result.rows.slice(0, limit) : result.rows
  const actor = (id: string | null, username: string | null, displayName: string | null) => (
    id ? {
      displayName: displayName || username || '未知账号',
      id: Number(id),
      username: username ?? '',
    } : undefined
  )
  return {
    nextCursor: hasMore && rows.length > 0 ? Number(rows.at(-1)?.id) : undefined,
    records: rows.map((row) => ({
      durationSeconds: row.duration_seconds === null ? undefined : Number(row.duration_seconds),
      endedAt: row.ended_at?.toISOString(),
      endedBy: actor(row.ended_by_user_id, row.ended_by_username, row.ended_by_display_name),
      id: Number(row.id),
      message: row.message,
      startedAt: row.started_at.toISOString(),
      startedBy: actor(row.started_by_user_id, row.started_by_username, row.started_by_display_name),
      status: row.ended_at ? 'completed' as const : 'active' as const,
    })),
  }
}

export async function listApplicationMigrations() {
  const result = await query<{
    applied_at: Date
    checksum: string
    duration_ms: number
    migration_id: string
    migration_kind: 'data' | 'schema'
    migration_name: string
  }>(
    `select migration_id, migration_name, migration_kind, checksum, applied_at, duration_ms
       from application_migrations order by applied_at desc, migration_id desc`,
  )
  return result.rows.map((row) => ({
    appliedAt: row.applied_at.toISOString(),
    checksum: row.checksum,
    durationMs: row.duration_ms,
    id: row.migration_id,
    kind: row.migration_kind,
    name: row.migration_name,
  }))
}

export function isMaintenanceRequestId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
}
