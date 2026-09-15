type PoolErrorSource = {
  on: (event: 'error', listener: (error: unknown) => void) => unknown
}

type PoolErrorReporter = (message: string) => void

type DatabasePoolCounts = {
  idleCount: number
  totalCount: number
  waitingCount: number
}

type DatabasePoolEnvironment = Record<string, string | undefined>

export type DatabasePoolSettings = {
  connectionTimeoutMillis: number
  idleTimeoutMillis: number
  max: number
}

const DEFAULT_POOL_MAX = 10
const DEFAULT_CONNECTION_TIMEOUT_MILLIS = 3_000
const DEFAULT_IDLE_TIMEOUT_MILLIS = 30_000
export const DATABASE_SLOW_QUERY_MILLIS = 500

export function createConcurrencyLimiter(maxConcurrent: number) {
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new Error('Concurrency limit must be a positive integer')
  }
  let active = 0
  const waiting: Array<() => void> = []

  const acquire = async () => {
    if (active < maxConcurrent) {
      active += 1
      return
    }
    await new Promise<void>((resolve) => waiting.push(resolve))
  }

  const release = () => {
    const next = waiting.shift()
    if (next) {
      next()
      return
    }
    active -= 1
  }

  return async function limit<T>(operation: () => Promise<T>) {
    await acquire()
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

function boundedInteger(
  environment: DatabasePoolEnvironment,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
) {
  const raw = environment[name]?.trim()
  if (!raw) return defaultValue
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

export function databasePoolSettings(
  environment: DatabasePoolEnvironment = process.env,
): DatabasePoolSettings {
  return {
    connectionTimeoutMillis: boundedInteger(
      environment,
      'DB_POOL_CONNECTION_TIMEOUT_MS',
      DEFAULT_CONNECTION_TIMEOUT_MILLIS,
      100,
      60_000,
    ),
    idleTimeoutMillis: boundedInteger(
      environment,
      'DB_POOL_IDLE_TIMEOUT_MS',
      DEFAULT_IDLE_TIMEOUT_MILLIS,
      1_000,
      600_000,
    ),
    max: boundedInteger(environment, 'DB_POOL_MAX', DEFAULT_POOL_MAX, 1, 100),
  }
}

export function databasePoolCounts(pool: DatabasePoolCounts) {
  return `total=${pool.totalCount} idle=${pool.idleCount} waiting=${pool.waitingCount}`
}

export function databasePoolErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'UNKNOWN'
  const code = String(error.code ?? '').trim()
  return /^[A-Z0-9_]{1,32}$/u.test(code) ? code : 'UNKNOWN'
}

export function registerDatabasePoolErrorHandler(
  pool: PoolErrorSource,
  report: PoolErrorReporter = (message) => console.error(message),
) {
  pool.on('error', (error) => {
    report(`[database] discarded an idle PostgreSQL connection after ${databasePoolErrorCode(error)}`)
  })
}

export function reportSlowDatabaseQuery(
  pool: DatabasePoolCounts,
  elapsedMillis: number,
  report: PoolErrorReporter = (message) => console.warn(message),
) {
  if (elapsedMillis < DATABASE_SLOW_QUERY_MILLIS && pool.waitingCount === 0) return
  report(`[database] query duration_ms=${Math.round(elapsedMillis)} ${databasePoolCounts(pool)}`)
}
