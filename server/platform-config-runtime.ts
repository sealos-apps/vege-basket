import crypto from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { NextFunction, Request, Response } from 'express'
import type { PoolClient } from 'pg'
import { pool, query } from './db.ts'
import {
  getCurrentPlatformConfig,
  getCurrentPlatformRevision,
  type VersionedPlatformConfig,
} from './platform-config-store.ts'
import { getPlatformOperationalRevision } from './platform-maintenance.ts'

const requestConfig = new AsyncLocalStorage<VersionedPlatformConfig>()
const instanceId = crypto.randomUUID()
let activeConfig: VersionedPlatformConfig | null = null
let refreshPromise: Promise<VersionedPlatformConfig> | null = null
let listener: PoolClient | null = null
let reconcileTimer: NodeJS.Timeout | null = null
let heartbeatTimer: NodeJS.Timeout | null = null
let stopped = false
let activeErrorCode = ''

async function recordRuntimeStatus(config: VersionedPlatformConfig | null, errorCode = '') {
  await query(
    `with current_status as (
       insert into platform_config_runtime_status
         (instance_id, process_kind, applied_revision, operational_revision, heartbeat_at, error_code)
       values ($1::uuid, 'api', $2, $3, clock_timestamp(), $4)
       on conflict (instance_id) do update
         set applied_revision = excluded.applied_revision,
             operational_revision = excluded.operational_revision,
             heartbeat_at = excluded.heartbeat_at,
             error_code = excluded.error_code
       returning instance_id
     )
     delete from platform_config_runtime_status
      where instance_id <> (select instance_id from current_status)
        and heartbeat_at < clock_timestamp() - interval '5 minutes'`,
    [instanceId, config?.revision ?? null, getPlatformOperationalRevision(), errorCode],
  )
}

export async function refreshPlatformConfig(force = false) {
  void force
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    try {
      const loaded = await getCurrentPlatformConfig()
      if (!loaded) throw Object.assign(new Error('平台配置尚未初始化。'), { code: 'PLATFORM_CONFIG_NOT_INITIALIZED' })
      if (!activeConfig || loaded.revision >= activeConfig.revision) activeConfig = loaded
      activeErrorCode = ''
      await recordRuntimeStatus(activeConfig)
      return activeConfig
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : 'PLATFORM_CONFIG_LOAD_FAILED'
      activeErrorCode = code
      await recordRuntimeStatus(activeConfig, code).catch(() => undefined)
      throw error
    } finally {
      refreshPromise = null
    }
  })()
  return refreshPromise
}

export async function ensureCurrentPlatformConfig() {
  const revision = await getCurrentPlatformRevision()
  if (!activeConfig || activeConfig.revision !== revision) return refreshPlatformConfig(true)
  return activeConfig
}

export function getPlatformConfigSnapshot() {
  const snapshot = requestConfig.getStore() ?? activeConfig
  if (!snapshot) throw Object.assign(new Error('平台配置尚未加载。'), { code: 'PLATFORM_CONFIG_NOT_LOADED' })
  return snapshot
}

export function getOptionalPlatformConfigSnapshot() {
  return requestConfig.getStore() ?? activeConfig ?? undefined
}

export async function platformConfigRequestMiddleware(
  _request: Request,
  _response: Response,
  next: NextFunction,
) {
  try {
    const snapshot = await ensureCurrentPlatformConfig()
    requestConfig.run(snapshot, next)
  } catch (error) {
    next(error)
  }
}

export async function withCurrentPlatformConfig<T>(operation: (snapshot: VersionedPlatformConfig) => Promise<T>) {
  const snapshot = await ensureCurrentPlatformConfig()
  return requestConfig.run(snapshot, () => operation(snapshot))
}

async function connectListener() {
  if (stopped || listener) return
  const client = await pool.connect()
  try {
    client.on('notification', (message) => {
      if (message.channel === 'veges_platform_config') void refreshPlatformConfig(true).catch(() => undefined)
    })
    client.on('error', () => {
      if (listener === client) listener = null
      client.release(true)
      if (!stopped) setTimeout(() => void connectListener().catch(() => undefined), 1_000).unref()
    })
    await client.query('listen veges_platform_config')
    listener = client
    await refreshPlatformConfig(true).catch((error) => {
      if (!(error && typeof error === 'object' && 'code' in error &&
        (error as { code?: unknown }).code === 'PLATFORM_CONFIG_NOT_INITIALIZED')) throw error
    })
  } catch (error) {
    if (listener === client) listener = null
    client.release(true)
    throw error
  }
}

export async function startPlatformConfigRuntime() {
  stopped = false
  await connectListener()
  reconcileTimer = setInterval(() => void ensureCurrentPlatformConfig().catch(() => undefined), 5_000)
  reconcileTimer.unref()
  heartbeatTimer = setInterval(() => void recordRuntimeStatus(activeConfig, activeErrorCode).catch(() => undefined), 15_000)
  heartbeatTimer.unref()
}

export async function stopPlatformConfigRuntime() {
  stopped = true
  if (reconcileTimer) clearInterval(reconcileTimer)
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  reconcileTimer = null
  heartbeatTimer = null
  if (listener) {
    const client = listener
    listener = null
    await client.query('unlisten veges_platform_config').catch(() => undefined)
    client.release()
  }
  await query('delete from platform_config_runtime_status where instance_id = $1::uuid', [instanceId])
    .catch(() => undefined)
}

export async function listPlatformRuntimeStatus() {
  const [revision, instances] = await Promise.all([
    getCurrentPlatformRevision(),
    query<{
      applied_revision: string | null
      error_code: string
      heartbeat_at: Date
      instance_id: string
      operational_revision: string
      process_kind: 'api'
      offline: boolean
    }>(
      `select instance_id, process_kind, applied_revision, operational_revision, heartbeat_at, error_code,
              heartbeat_at < clock_timestamp() - interval '45 seconds' as offline
         from platform_config_runtime_status
        where heartbeat_at >= clock_timestamp() - interval '5 minutes'
        order by started_at`,
    ),
  ])
  return {
    activeRevision: revision,
    cronJob: { mode: 'load-on-run' as const },
    instances: instances.rows.map((row) => ({
      appliedRevision: row.applied_revision ? Number(row.applied_revision) : null,
      errorCode: row.error_code || undefined,
      heartbeatAt: row.heartbeat_at.toISOString(),
      instanceId: row.instance_id,
      operationalRevision: Number(row.operational_revision),
      processKind: row.process_kind,
      status: row.offline
        ? 'offline' as const
        : row.error_code
          ? 'error' as const
          : Number(row.applied_revision ?? 0) !== revision
            ? 'loading' as const
            : 'applied' as const,
    })),
  }
}
