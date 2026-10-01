/* Explicitly opt in with VEGES_INTEGRATION_DATABASE_URL.
 * This acceptance test owns one temporary schema and drops only that schema.
 */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import pg from 'pg'
import { schemaSql } from './schema.ts'
import { createDefaultPlatformConfig } from './platform-config-schema.ts'

const sourceUrl = process.env.VEGES_INTEGRATION_DATABASE_URL
if (!sourceUrl) throw new Error('VEGES_INTEGRATION_DATABASE_URL must explicitly authorize the integration database')

const schema = `veges_config_restart_${crypto.randomBytes(8).toString('hex')}`
const databaseUrl = new URL(sourceUrl)
databaseUrl.searchParams.set('options', `-c search_path=${schema}`)
const control = new pg.Pool({ connectionString: sourceUrl, max: 1 })
const db = new pg.Pool({ connectionString: databaseUrl.toString(), max: 3 })
const encryptionKey = crypto.randomBytes(32).toString('base64')
const encryptionKeyId = 'restart-test'
const encryptionKeys = `${encryptionKeyId}:${encryptionKey}`
const bootstrapPassword = 'restart-retention-test-password'
const displayName = '重启保留验收配置'
process.env.APP_ENCRYPTION_ACTIVE_KEY_ID = encryptionKeyId
process.env.APP_ENCRYPTION_KEYS = encryptionKeys

async function availablePort() {
  const listener = net.createServer().listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const port = (listener.address() as net.AddressInfo).port
  await new Promise<void>((resolve) => listener.close(() => resolve()))
  return port
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  await exited
}

async function startAndReadConfig() {
  const port = await availablePort()
  const logPath = `.context/platform-config-restart-${port}.log`
  fs.mkdirSync('.context', { recursive: true })
  const log = fs.openSync(logPath, 'w', 0o600)
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl.toString(),
      PORT: String(port),
      APP_ENCRYPTION_ACTIVE_KEY_ID: encryptionKeyId,
      APP_ENCRYPTION_KEYS: encryptionKeys,
      VEGES_BOOTSTRAP_ADMIN_PASSWORD: bootstrapPassword,
      NODE_ENV: 'test',
    },
    stdio: ['ignore', log, log],
  })
  fs.closeSync(log)
  try {
    let ready = false
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) {
        const output = fs.readFileSync(logPath, 'utf8').slice(-4_000)
        throw new Error(`API exited during restart acceptance: ${output}`)
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/ready`)
        if (response.ok) {
          ready = true
          break
        }
      } catch {
        // The listener is intentionally started before migrations complete.
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    assert.equal(ready, true, 'API must become ready within 20 seconds')
    const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: bootstrapPassword }),
    })
    assert.equal(login.status, 200)
    const auth = await login.json() as { token: string }
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/platform-config`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
    assert.equal(response.status, 200)
    const payload = await response.json() as { config: { general: { displayName: string } }; initialized: boolean; revision: number }
    assert.equal(payload.initialized, true)
    assert.equal(payload.config.general.displayName, displayName)
    return { child, logPath, revision: payload.revision }
  } catch (error) {
    await stop(child).catch(() => undefined)
    throw error
  }
}

try {
  await control.query(`create schema "${schema}"`)
  await db.query(schemaSql)
  const { encryptText } = await import('./crypto.ts')
  await db.query(`create table ai_settings (id integer primary key, marker text not null)`)
  await db.query(`insert into ai_settings (id, marker) values (1, 'must-survive-startup')`)

  const config = createDefaultPlatformConfig()
  config.general.displayName = displayName
  const encryptedPayload = encryptText(JSON.stringify({ ...config, schemaVersion: 1 }))
  const version = await db.query<{ revision: string }>(
    `insert into platform_config_versions
      (schema_version, payload_encrypted, created_by_user_id, source)
     values (1, $1, null, 'env_import') returning revision`,
    [encryptedPayload],
  )
  const revision = Number(version.rows[0].revision)
  await db.query('update platform_config_state set active_revision = $1 where singleton = true', [revision])

  const first = await startAndReadConfig()
  assert.equal(first.revision, revision)
  await stop(first.child)
  const second = await startAndReadConfig()
  assert.equal(second.revision, revision)
  await stop(second.child)

  const stored = await db.query<{ payload_encrypted: string; schema_version: number }>(
    'select schema_version, payload_encrypted from platform_config_versions where revision = $1',
    [revision],
  )
  assert.equal(stored.rows.length, 1)
  assert.equal(stored.rows[0].schema_version, 1)
  assert.equal(stored.rows[0].payload_encrypted, encryptedPayload)
  assert.equal((await db.query('select marker from ai_settings where id = 1')).rows[0].marker, 'must-survive-startup')
  assert.equal((await db.query('select count(*)::int as count from platform_config_versions')).rows[0].count, 1)
  assert.equal((await db.query("select count(*)::int as count from application_migrations where migration_id = '20261002_schema_v12'")).rows[0].count, 1)
  console.log('Platform configuration restart acceptance passed: v1 snapshot readable after two API starts, revision and ciphertext retained, legacy table preserved.')
} finally {
  await control.query(`drop schema if exists "${schema}" cascade`).catch(() => undefined)
  await db.end()
  await control.end()
}
