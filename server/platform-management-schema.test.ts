import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { platformManagementSchemaSql } from './platform-management-schema.ts'
import { platformMaintenanceHistorySchemaSql } from './platform-maintenance-history-schema.ts'
import { platformMaintenanceSchemaSql } from './platform-maintenance-schema.ts'
import { schemaSql } from './schema.ts'

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))

test('startup schema contains the platform management migration', () => {
  assert.ok(schemaSql.includes(platformManagementSchemaSql))
  assert.match(schemaSql, /create table if not exists platform_config_versions/u)
  assert.match(schemaSql, /create constraint trigger assert_builtin_admin_user_consistency/u)
  assert.doesNotMatch(platformManagementSchemaSql, /platform_instance_settings/u)
})

test('startup schema contains the platform maintenance migration', () => {
  assert.ok(schemaSql.includes(platformMaintenanceSchemaSql))
  assert.match(platformMaintenanceSchemaSql, /create table if not exists application_migrations/u)
  assert.match(platformMaintenanceSchemaSql, /create table if not exists platform_operational_state/u)
  const migration = fs.readFileSync(
    path.join(serverDirectory, 'migrations/20260919_platform_maintenance.sql'),
    'utf8',
  )
  assert.equal(migration.trim(), platformMaintenanceSchemaSql.trim())
})

test('startup schema contains the forward-only platform maintenance history migration', () => {
  assert.ok(schemaSql.includes(platformMaintenanceHistorySchemaSql))
  assert.match(platformMaintenanceHistorySchemaSql, /create table if not exists platform_maintenance_periods/u)
  assert.match(platformMaintenanceHistorySchemaSql, /duration_seconds bigint/u)
  assert.match(platformMaintenanceHistorySchemaSql, /where ended_at is null/u)
  const migration = fs.readFileSync(
    path.join(serverDirectory, 'migrations/20260919_platform_maintenance_history.sql'),
    'utf8',
  )
  assert.equal(migration.trim(), platformMaintenanceHistorySchemaSql.trim())
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
