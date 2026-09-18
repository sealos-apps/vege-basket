import assert from 'node:assert/strict'
import test from 'node:test'
import { parseLegacyPlatformConfig } from './platform-legacy-config.ts'

test('legacy import preserves aliases, nullish signing fallback, and effective defaults', () => {
  const imported = parseLegacyPlatformConfig({
    APP_ENCRYPTION_KEYS: 'root-key-ring-material',
    OSS_UI_DOWNLOAD_EXPIRE_SECONDS: '600',
    OSS_UI_MIDDLEWARE_ROOT: 'custom/middleware',
    VEGES_ADMIN_USERNAMES: ' Admin, OPS@example.com,admin ',
  }, 'page_kinds: {}\nrules: {}\n')
  assert.deepEqual(imported.adminUsernames, ['admin', 'ops@example.com'])
  assert.equal(imported.config.packages.downloadExpireSeconds, 600)
  assert.deepEqual(imported.config.packages.legacyMiddlewareRoots, [
    'custom/middleware',
    'offline/sealos-pro/',
  ])
  assert.equal(imported.legacyTodoImageUrlSecret, 'root-key-ring-material')
  assert.equal(imported.config.ai.rateLimit, 5)
})

test('explicit empty todo image secret does not fall back', () => {
  const imported = parseLegacyPlatformConfig({
    APP_ENCRYPTION_KEYS: 'root-key-ring-material',
    TODO_IMAGE_URL_SECRET: '',
  }, 'page_kinds: {}\nrules: {}\n')
  assert.equal(imported.legacyTodoImageUrlSecret, '')
})

test('legacy import reports unimplemented and unknown keys without values', () => {
  const imported = parseLegacyPlatformConfig({
    FEISHU_ENCRYPT_KEY: 'secret',
    UNKNOWN_SETTING: 'also-secret',
  }, 'page_kinds: {}\nrules: {}\n')
  assert.deepEqual(imported.ignoredUnimplementedKeys, ['FEISHU_ENCRYPT_KEY'])
  assert.deepEqual(imported.unknownKeys, ['UNKNOWN_SETTING'])
})

test('legacy webhook settings are ignored during platform import', () => {
  const imported = parseLegacyPlatformConfig({
    FEISHU_WEBHOOK_USER_EMAIL: 'legacy@example.com',
    FEISHU_WEBHOOK_BASIC_USER: 'legacy-user',
    FEISHU_WEBHOOK_BASIC_PASSWORD: 'legacy-password',
  }, 'page_kinds: {}\nrules: {}\n')
  assert.equal('webhookUsername' in imported, false)
  assert.equal('webhookUserId' in imported.config.feishu, false)
  assert.equal('webhookBasicUser' in imported.config.feishu, false)
  assert.equal('webhookBasicPassword' in imported.config.feishu, false)
})
