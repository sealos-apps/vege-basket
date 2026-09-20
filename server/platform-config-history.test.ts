import assert from 'node:assert/strict'
import test from 'node:test'
import { createDefaultPlatformConfig } from './platform-config-schema.ts'
import {
  diffPlatformConfigs,
  groupPlatformConfigChanges,
  platformConfigsEqual,
  platformConfigSourceLabel,
} from './platform-config-history.ts'

test('platform configuration history reports actual formatted field changes', () => {
  const before = createDefaultPlatformConfig()
  const after = structuredClone(before)
  after.general.publicUrl = 'https://veges.example.com'
  after.storage.uploadMaxBytes = 20 * 1024 * 1024
  after.github.downloadExpireSeconds = 3_600

  const changes = diffPlatformConfigs(before, after)
  assert.deepEqual(changes.map(({ after: value, field }) => ({ field, value })), [
    { field: 'general.publicUrl', value: 'https://veges.example.com' },
    { field: 'storage.uploadMaxBytes', value: '20 MB' },
    { field: 'github.downloadExpireSeconds', value: '1 小时' },
  ])
  assert.equal(groupPlatformConfigChanges(changes).length, 3)
})

test('platform configuration history never serializes secret values', () => {
  const before = createDefaultPlatformConfig()
  before.ai.apiKey = 'previous-private-key'
  const after = structuredClone(before)
  after.ai.apiKey = 'replacement-private-key'
  after.storage.accessKeyId = 'new-private-account'

  const serialized = JSON.stringify(diffPlatformConfigs(before, after))
  assert.equal(serialized.includes('previous-private-key'), false)
  assert.equal(serialized.includes('replacement-private-key'), false)
  assert.equal(serialized.includes('new-private-account'), false)
  assert.match(serialized, /已替换/u)
  assert.match(serialized, /已设置/u)
})

test('hidden compatibility changes collapse into one safe history entry', () => {
  const before = createDefaultPlatformConfig()
  const after = structuredClone(before)
  after.feishu.oauthStateSecret = 'private-oauth-state'
  after.feishu.aiChatEnabled = true

  const changes = diffPlatformConfigs(before, after)
  assert.equal(changes.length, 1)
  assert.equal(changes[0].field, 'system.compatibility')
  assert.equal(changes[0].after, '已更新 2 项')
  assert.equal(JSON.stringify(changes).includes('private-oauth-state'), false)
})

test('canonical configuration equality and source labels are stable', () => {
  const config = createDefaultPlatformConfig()
  assert.equal(platformConfigsEqual(config, structuredClone(config)), true)
  assert.equal(platformConfigSourceLabel('bootstrap'), '初始化配置')
  assert.equal(platformConfigSourceLabel('env_import'), '环境配置导入')
  assert.equal(platformConfigSourceLabel('restore'), '恢复历史版本')
  assert.equal(platformConfigSourceLabel('maintenance'), '系统维护')
  assert.equal(platformConfigSourceLabel('platform'), '修改配置')
})
