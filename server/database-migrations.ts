import crypto from 'node:crypto'
import fs from 'node:fs'
import bcrypt from 'bcryptjs'
import type { PoolClient } from 'pg'
import { pool } from './db.ts'
import { initializeProjectModulesWithClient } from './project-modules.ts'
import { schemaSql } from './schema.ts'

export type DatabaseMigrationPhase = 'waiting' | 'running' | 'completed' | 'failed'

export type DatabaseMigrationStatus = {
  completedAt?: string
  errorCode?: string
  phase: DatabaseMigrationPhase
  startedAt?: string
}

const migrationId = '20260922_schema_v10'
const migrationName = '缺陷发现难度与加密评定依据'
const migrationChecksum = crypto.createHash('sha256').update(schemaSql).digest('hex')
const bootstrapPasswordFile = '/run/secrets/veges-bootstrap-admin-password/password'
let status: DatabaseMigrationStatus = { phase: 'waiting' }
let stopRequested = false

const retryableConnectionMessages = new Set([
  'Connection terminated',
  'Connection terminated due to connection timeout',
  'Connection terminated unexpectedly',
])

function hasRetryableConnectionMessage(error: unknown) {
  if (!(error instanceof Error)) return false
  if (retryableConnectionMessages.has(error.message)) return true
  return hasRetryableConnectionMessage(error.cause)
}

export function databaseMigrationErrorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code?: unknown }).code || 'DATABASE_MIGRATION_FAILED')
  }
  if (hasRetryableConnectionMessage(error)) return 'DATABASE_CONNECTION_FAILED'
  return 'DATABASE_MIGRATION_FAILED'
}

export function getDatabaseMigrationStatus(): DatabaseMigrationStatus {
  return { ...status }
}

async function ensureBuiltinAdmin(client: PoolClient) {
  try {
    await client.query('begin')
    await client.query(
      'select pg_advisory_xact_lock(hashtextextended($1::text, 0))',
      ['veges:platform-administration'],
    )
    const builtin = await client.query<{ id: string }>(
      `select users.id
         from users
         join platform_admin_grants grant_row on grant_row.user_id = users.id
        where users.is_builtin_admin and grant_row.grant_kind = 'builtin'
        for update of users`,
    )
    const admins = await client.query<{
      account_status: string
      grant_kind: 'builtin' | 'managed' | null
      id: string
      is_builtin_admin: boolean
      password_hash: string
    }>(
      `select users.id, users.password_hash, users.account_status, users.is_builtin_admin,
              grant_row.grant_kind
         from users
         left join platform_admin_grants grant_row on grant_row.user_id = users.id
        where lower(btrim(users.email)) = 'admin'
        for update of users`,
    )
    if (builtin.rows.length > 1 || admins.rows.length > 1) {
      throw Object.assign(new Error('内置 admin 账号存在冲突。'), { code: 'BUILTIN_ADMIN_CONFLICT' })
    }
    const existing = admins.rows[0]
    if (builtin.rows[0] && Number(builtin.rows[0].id) !== Number(existing?.id)) {
      throw Object.assign(new Error('内置超级管理员不是 admin 账号。'), { code: 'BUILTIN_ADMIN_CONFLICT' })
    }
    if (existing && (existing.account_status !== 'active' || !existing.password_hash)) {
      throw Object.assign(new Error('现有 admin 账号已停用或没有有效密码。'), { code: 'BUILTIN_ADMIN_INVALID' })
    }

    let userId: number
    if (existing) {
      userId = Number(existing.id)
      if (!existing.is_builtin_admin || existing.grant_kind !== 'builtin') {
        await client.query(
          `update users
              set is_builtin_admin = true, registration_source = 'builtin'
            where id = $1`,
          [userId],
        )
        if (existing.grant_kind === 'managed') {
          await client.query(
            `update platform_admin_grants
                set grant_kind = 'builtin', source = 'bootstrap', granted_by_user_id = null
              where user_id = $1`,
            [userId],
          )
        } else {
          await client.query(
            `insert into platform_admin_grants (user_id, grant_kind, source)
             values ($1, 'builtin', 'bootstrap')`,
            [userId],
          )
        }
      }
    } else {
      const password = String(process.env.VEGES_BOOTSTRAP_ADMIN_PASSWORD ?? (
        fs.existsSync(bootstrapPasswordFile) ? fs.readFileSync(bootstrapPasswordFile, 'utf8').trim() : ''
      ))
      if (password.length < 12) {
        throw Object.assign(
          new Error('新部署需要至少 12 位的 VEGES_BOOTSTRAP_ADMIN_PASSWORD。'),
          { code: 'BOOTSTRAP_ADMIN_PASSWORD_REQUIRED' },
        )
      }
      const passwordHash = await bcrypt.hash(password, 12)
      userId = Number((await client.query<{ id: string }>(
        `insert into users
          (email, display_name, password_hash, account_status, is_builtin_admin, registration_source)
         values ('admin', 'admin', $1, 'active', true, 'builtin') returning id`,
        [passwordHash],
      )).rows[0].id)
      await client.query(
        `insert into platform_admin_grants (user_id, grant_kind, source)
         values ($1, 'builtin', 'bootstrap')`,
        [userId],
      )
    }
    await client.query(
      `insert into user_roles (user_id, role) values ($1, 'developer')
       on conflict do nothing`,
      [userId],
    )
    await client.query(
      `insert into platform_user_permission_versions (user_id, revision)
       values ($1, 1) on conflict (user_id) do nothing`,
      [userId],
    )
    await client.query(
      `insert into platform_bootstrap_receipts (step, source)
       values ('builtin_admin', 'bootstrap')
       on conflict (step) do update set source = excluded.source, completed_at = now()`,
    )
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    delete process.env.VEGES_BOOTSTRAP_ADMIN_PASSWORD
  }
}

async function runMigrationAttempt() {
  const startedAt = status.startedAt ?? new Date().toISOString()
  status = status.errorCode
    ? { ...status, phase: 'waiting', startedAt }
    : { phase: 'running', startedAt }
  let client: PoolClient | null = null
  let locked = false
  try {
    client = await pool.connect()
    status = { phase: 'running', startedAt }
    while (!locked && !stopRequested) {
      const lock = await client.query<{ acquired: boolean }>(
        'select pg_try_advisory_lock(hashtextextended($1::text, 0)) as acquired',
        ['veges:database-migrations'],
      )
      locked = lock.rows[0]?.acquired === true
      if (!locked) {
        status = { ...status, phase: 'waiting' }
        await new Promise<void>((resolve) => setTimeout(resolve, 1_000))
      }
    }
    if (!locked) return false
    status = { ...status, phase: 'running' }
    await client.query(`
      create table if not exists application_migrations (
        migration_id text primary key,
        migration_name text not null,
        migration_kind text not null check (migration_kind in ('schema', 'data')),
        checksum text not null,
        applied_at timestamptz not null default now(),
        duration_ms integer not null check (duration_ms >= 0)
      )
    `)
    const applied = await client.query<{ checksum: string }>(
      'select checksum from application_migrations where migration_id = $1',
      [migrationId],
    )
    if (applied.rows[0] && applied.rows[0].checksum !== migrationChecksum) {
      throw Object.assign(
        new Error('数据库迁移内容已变更，请新增迁移版本。'),
        { code: 'DATABASE_MIGRATION_CHECKSUM_MISMATCH' },
      )
    }
    if (!applied.rows[0]) {
      const startedAt = Date.now()
      await client.query('begin')
      try {
        await client.query(schemaSql)
        await client.query('commit')
      } catch (error) {
        await client.query('rollback')
        throw error
      }
      await initializeProjectModulesWithClient(client)
      await client.query(
        `insert into application_migrations
          (migration_id, migration_name, migration_kind, checksum, duration_ms)
         values ($1, $2, 'schema', $3, $4)`,
        [migrationId, migrationName, migrationChecksum, Date.now() - startedAt],
      )
    }
    await ensureBuiltinAdmin(client)
    status = { ...status, completedAt: new Date().toISOString(), phase: 'completed' }
    return true
  } catch (error) {
    status = { ...status, errorCode: databaseMigrationErrorCode(error), phase: 'failed' }
    throw error
  } finally {
    if (locked && client) {
      await client.query('select pg_advisory_unlock(hashtextextended($1::text, 0))', ['veges:database-migrations'])
        .catch(() => undefined)
    }
    client?.release()
  }
}

export function isRetryableDatabaseConnectionError(error: unknown) {
  const code = databaseMigrationErrorCode(error)
  return code.startsWith('08') || [
    '3D000',
    '53300',
    '57P03',
    'ECONNREFUSED',
    'ENETUNREACH',
    'ENOTFOUND',
    'ETIMEDOUT',
  ].includes(code) || hasRetryableConnectionMessage(error)
}

export async function runAutomaticDatabaseMigrations() {
  stopRequested = false
  while (!stopRequested) {
    try {
      if (await runMigrationAttempt()) return
    } catch (error) {
      if (!isRetryableDatabaseConnectionError(error)) throw error
      status = {
        errorCode: databaseMigrationErrorCode(error),
        phase: 'waiting',
        startedAt: status.startedAt,
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 2_000))
    }
  }
}

export function stopAutomaticDatabaseMigrations() {
  stopRequested = true
}
