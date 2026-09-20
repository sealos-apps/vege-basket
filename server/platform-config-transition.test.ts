import assert from 'node:assert/strict'
import test from 'node:test'
import { createDefaultPlatformConfig } from './platform-config-schema.ts'
import {
  assertPlatformConfigTransitionAllowed,
  changesConfiguredFeishuApp,
  changesConfiguredStorageLocation,
} from './platform-config-transition.ts'

test('storage location remains editable until endpoint and bucket are configured', () => {
  const current = createDefaultPlatformConfig()
  const next = createDefaultPlatformConfig()
  next.storage.objectPrefix = 'new-prefix'
  assert.equal(changesConfiguredStorageLocation(current, next), false)
})

test('configured storage location requires a migration before direct changes', () => {
  const current = createDefaultPlatformConfig()
  current.storage.endpoint = 'https://oss-cn-hangzhou.aliyuncs.com'
  current.storage.bucket = 'veges'
  const next = structuredClone(current)
  next.storage.objectPrefix = 'new-prefix'
  assert.equal(changesConfiguredStorageLocation(current, next), true)
  assert.equal(changesConfiguredStorageLocation(current, structuredClone(current)), false)
})

test('configured storage location can be corrected while no storage-backed data exists', async () => {
  const current = createDefaultPlatformConfig()
  current.storage.endpoint = 'https://oss-cn-hangzhou.aliyuncs.com'
  current.storage.bucket = 'veges'
  const next = structuredClone(current)
  next.storage.objectPrefix = 'corrected-prefix'
  const queries: string[] = []
  const client = {
    query: async (sql: string) => {
      queries.push(sql)
      return { rows: [{ used: false }] }
    },
  }
  await assertPlatformConfigTransitionAllowed(client as never, current, next)
  assert.equal(queries.length, 1)
})

test('configured storage location stays immutable after recorded use', async () => {
  const current = createDefaultPlatformConfig()
  current.storage.endpoint = 'https://oss-cn-hangzhou.aliyuncs.com'
  current.storage.bucket = 'veges'
  const next = structuredClone(current)
  next.storage.bucket = 'other'
  const client = { query: async () => ({ rows: [{ used: true }] }) }
  await assert.rejects(
    assertPlatformConfigTransitionAllowed(client as never, current, next),
    { code: 'STORAGE_MIGRATION_REQUIRED' },
  )
})

test('only changes to an already configured Feishu app need usage checks', () => {
  const current = createDefaultPlatformConfig()
  const next = structuredClone(current)
  next.feishu.appId = 'cli_first'
  assert.equal(changesConfiguredFeishuApp(current, next), false)
  current.feishu.appId = 'cli_old'
  assert.equal(changesConfiguredFeishuApp(current, next), true)
})
