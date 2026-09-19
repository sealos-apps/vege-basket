import assert from 'node:assert/strict'
import test from 'node:test'
import {
  databaseMigrationErrorCode,
  isRetryableDatabaseConnectionError,
} from './database-migrations.ts'

test('retries PostgreSQL connection termination errors without misreporting a schema failure', () => {
  for (const message of [
    'Connection terminated',
    'Connection terminated due to connection timeout',
    'Connection terminated unexpectedly',
  ]) {
    const error = new Error(message)
    assert.equal(databaseMigrationErrorCode(error), 'DATABASE_CONNECTION_FAILED')
    assert.equal(isRetryableDatabaseConnectionError(error), true)
  }
})

test('recognizes a nested PostgreSQL connection termination error', () => {
  const error = new Error('Pool connection failed', {
    cause: new Error('Connection terminated unexpectedly'),
  })
  assert.equal(databaseMigrationErrorCode(error), 'DATABASE_CONNECTION_FAILED')
  assert.equal(isRetryableDatabaseConnectionError(error), true)
})

test('does not retry a migration contract failure', () => {
  const error = Object.assign(new Error('数据库迁移内容已变更'), {
    code: 'DATABASE_MIGRATION_CHECKSUM_MISMATCH',
  })
  assert.equal(databaseMigrationErrorCode(error), 'DATABASE_MIGRATION_CHECKSUM_MISMATCH')
  assert.equal(isRetryableDatabaseConnectionError(error), false)
})
