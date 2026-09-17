import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { platformManagementSchemaSql } from './platform-management-schema.ts'
import { schemaSql } from './schema.ts'

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))

test('startup schema contains the platform management migration', () => {
  assert.ok(schemaSql.includes(platformManagementSchemaSql))
  assert.match(schemaSql, /create table if not exists platform_config_versions/u)
  assert.match(schemaSql, /create constraint trigger assert_builtin_admin_user_consistency/u)
})

test('versioned platform management migration matches startup schema', () => {
  const migration = fs.readFileSync(
    path.join(serverDirectory, 'migrations/20260917_platform_management.sql'),
    'utf8',
  )
  assert.equal(migration.trim(), platformManagementSchemaSql.trim())
})

test('platform configuration history is immutable and builtin admin is protected', () => {
  assert.match(platformManagementSchemaSql, /before update or delete on platform_config_versions/u)
  assert.match(platformManagementSchemaSql, /before update or delete on users/u)
  assert.match(platformManagementSchemaSql, /before update or delete on platform_admin_grants/u)
  assert.match(platformManagementSchemaSql, /where is_builtin_admin/u)
})

test('organization foreign-key normalization skips constraints already using restrict', () => {
  assert.match(platformManagementSchemaSql, /constraint_value\.confdeltype <> 'r'/u)
  assert.match(platformManagementSchemaSql, /before delete on organizations/u)
})
