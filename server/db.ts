import 'dotenv/config'
import pg from 'pg'
import type { QueryResultRow } from 'pg'
import {
  createConcurrencyLimiter,
  databasePoolSettings,
  registerDatabasePoolErrorHandler,
  reportSlowDatabaseQuery,
} from './database-pool-policy.ts'

const { Pool } = pg

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required')
}

export const pool = new Pool({
  connectionString: databaseUrl,
  ...databasePoolSettings(),
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
})

registerDatabasePoolErrorHandler(pool)

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
) {
  const startedAt = performance.now()
  try {
    return await pool.query<T>(text, params)
  } finally {
    reportSlowDatabaseQuery(pool, performance.now() - startedAt)
  }
}

export function createLimitedQuery(maxConcurrent = 4) {
  const limit = createConcurrencyLimiter(maxConcurrent)

  return async function limitedQuery<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ) {
    return limit(() => query<T>(text, params))
  }
}
