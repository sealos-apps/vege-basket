import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  createConcurrencyLimiter,
  databasePoolCounts,
  databasePoolErrorCode,
  databasePoolSettings,
  registerDatabasePoolErrorHandler,
  reportSlowDatabaseQuery,
} from './database-pool-policy.ts'

test('idle PostgreSQL client errors are handled without terminating the process', () => {
  const pool = new EventEmitter()
  const messages: string[] = []
  registerDatabasePoolErrorHandler(pool, (message) => messages.push(message))

  assert.doesNotThrow(() => {
    pool.emit('error', Object.assign(new Error('read timed out'), { code: 'ETIMEDOUT' }))
  })
  assert.deepEqual(messages, [
    '[database] discarded an idle PostgreSQL connection after ETIMEDOUT',
  ])
})

test('database pool diagnostics expose only bounded error codes', () => {
  assert.equal(databasePoolErrorCode({ code: 'ECONNRESET' }), 'ECONNRESET')
  assert.equal(databasePoolErrorCode({ code: 'credential=value' }), 'UNKNOWN')
  assert.equal(databasePoolErrorCode(new Error('contains sensitive details')), 'UNKNOWN')
})

test('database pool settings use bounded workload defaults', () => {
  assert.deepEqual(databasePoolSettings({}), {
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 30_000,
    max: 10,
  })
  assert.deepEqual(databasePoolSettings({
    DB_POOL_CONNECTION_TIMEOUT_MS: '5000',
    DB_POOL_IDLE_TIMEOUT_MS: '45000',
    DB_POOL_MAX: '12',
  }), {
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 45_000,
    max: 12,
  })
})

test('database pool settings reject invalid connection budgets', () => {
  assert.throws(() => databasePoolSettings({ DB_POOL_MAX: '0' }), /DB_POOL_MAX/u)
  assert.throws(
    () => databasePoolSettings({ DB_POOL_CONNECTION_TIMEOUT_MS: 'forever' }),
    /DB_POOL_CONNECTION_TIMEOUT_MS/u,
  )
})

test('database pool diagnostics report counts without query content', () => {
  const pool = { idleCount: 3, totalCount: 10, waitingCount: 2 }
  const messages: string[] = []
  assert.equal(databasePoolCounts(pool), 'total=10 idle=3 waiting=2')
  reportSlowDatabaseQuery(pool, 25, (message) => messages.push(message))
  assert.deepEqual(messages, ['[database] query duration_ms=25 total=10 idle=3 waiting=2'])

  reportSlowDatabaseQuery({ ...pool, waitingCount: 0 }, 499, (message) => messages.push(message))
  assert.equal(messages.length, 1)
})

test('query concurrency limiter transfers released slots without exceeding its budget', async () => {
  const limit = createConcurrencyLimiter(2)
  let active = 0
  let peak = 0
  const releases: Array<() => void> = []
  const operations = Array.from({ length: 6 }, (_, index) => limit(async () => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise<void>((resolve) => releases.push(resolve))
    active -= 1
    return index
  }))

  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(active, 2)
  while (releases.length > 0 || active > 0) {
    releases.splice(0).forEach((release) => release())
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  assert.deepEqual(await Promise.all(operations), [0, 1, 2, 3, 4, 5])
  assert.equal(peak, 2)
  assert.throws(() => createConcurrencyLimiter(0), /positive integer/u)
})
