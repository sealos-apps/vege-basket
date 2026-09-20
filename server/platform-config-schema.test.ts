import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import {
  createDefaultPlatformConfig,
  maskPlatformConfig,
  mergePlatformConfigSection,
  parsePlatformConfig,
  PlatformConfigValidationError,
  revealPlatformSecret,
} from './platform-config-schema.ts'

test('platform config defaults preserve the current effective limits', () => {
  const config = parsePlatformConfig(createDefaultPlatformConfig())
  assert.equal(config.ai.rateLimit, 5)
  assert.equal(config.ai.globalRateLimit, 30)
  assert.equal(config.ai.rateWindowMs, 60_000)
  assert.equal(config.ai.maxMessageLength, 2_000)
  assert.equal(config.ai.maxContextChars, 12_000)
  assert.equal(config.storage.uploadMaxBytes, 10 * 1024 * 1024)
  assert.equal(config.storage.objectPrefix, 'todo-images')
  assert.equal(config.packages.downloadExpireSeconds, 1_800)
})

test('platform config rejects partial credentials and unknown fields', () => {
  const config = createDefaultPlatformConfig()
  assert.throws(
    () => parsePlatformConfig({
      ...config,
      ai: { ...config.ai, apiBase: 'https://api.example.com' },
      unexpected: true,
    }),
    (error: unknown) => error instanceof PlatformConfigValidationError &&
      error.issues.some((issue) => issue.includes('unexpected')) &&
      error.issues.some((issue) => issue.includes('必须同时配置')),
  )
})

test('configured object storage requires its signing secret', () => {
  const config = createDefaultPlatformConfig()
  Object.assign(config.storage, {
    accessKeyId: 'account',
    accessKeySecret: 'credential',
    bucket: 'veges-assets',
    endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
  })
  assert.throws(() => parsePlatformConfig(config), PlatformConfigValidationError)
  config.storage.urlSecret = 'signing-secret'
  assert.doesNotThrow(() => parsePlatformConfig(config))
})

test('platform config restricts callback-like URLs and GitHub targets', () => {
  const config = createDefaultPlatformConfig()
  assert.throws(
    () => parsePlatformConfig({
      ...config,
      general: { ...config.general, publicUrl: 'https://user@example.com/path' },
      github: { ...config.github, repositoryUrl: 'https://git.example.com/owner/repo' },
    }),
    PlatformConfigValidationError,
  )
})

test('platform public address permits local IPv4 and IPv6 loopback origins', () => {
  for (const publicUrl of ['http://127.0.0.1:5173', 'http://[::1]:5173']) {
    const config = createDefaultPlatformConfig()
    config.general.publicUrl = publicUrl
    assert.equal(parsePlatformConfig(config).general.publicUrl, publicUrl)
  }
})

test('masked config never serializes secret values', () => {
  const config = createDefaultPlatformConfig()
  config.ai.apiBase = 'https://api.example.com'
  config.ai.apiKey = 'ai-secret'
  config.ai.model = 'model'
  config.feishu.oauthStateSecret = 'hidden-state-secret'
  const masked = maskPlatformConfig(parsePlatformConfig(config))
  const serialized = JSON.stringify(masked)
  assert.equal(masked.ai.apiKey.configured, true)
  assert.equal('oauthStateSecret' in masked.feishu, false)
  assert.equal('aiChatEnabled' in masked.feishu, false)
  assert.equal('legacyMiddlewareRoots' in masked.packages, false)
  assert.equal('enabled' in masked.github, false)
  assert.equal(serialized.includes('ai-secret'), false)
  assert.equal(serialized.includes('hidden-state-secret'), false)
})

test('section updates reject hidden, secret, and unknown ordinary fields', () => {
  const config = createDefaultPlatformConfig()
  config.feishu.oauthStateSecret = 'state-secret'

  for (const fields of [
    { oauthStateSecret: '[object Object]' },
    { appSecret: 'plain-text-secret' },
    { aiChatEnabled: true },
    { unsupported: true },
  ]) {
    assert.throws(
      () => mergePlatformConfigSection(config, 'feishu', fields, {}),
      PlatformConfigValidationError,
    )
  }
  assert.equal(config.feishu.oauthStateSecret, 'state-secret')
})

test('saving any section rotates the known corrupted OAuth state marker', () => {
  const config = createDefaultPlatformConfig()
  config.feishu.oauthStateSecret = '[object Object]'
  const repaired = mergePlatformConfigSection(config, 'general', { displayName: 'Veges' }, {})
  assert.notEqual(repaired.feishu.oauthStateSecret, '[object Object]')
  assert.ok(repaired.feishu.oauthStateSecret.length >= 32)
})

test('bootstrap authentication remains reachable before the first platform config exists', () => {
  const source = fs.readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
  const middlewareStart = source.indexOf("app.use('/api', (request, response, next) => {")
  const middlewareEnd = source.indexOf("app.use('/api', roleRouter)", middlewareStart)
  const middleware = source.slice(middlewareStart, middlewareEnd)
  assert.match(middleware, /request\.path === '\/auth\/login'/u)
  assert.match(middleware, /request\.path === '\/auth\/me' && request\.method === 'GET'/u)
})

test('section updates keep, replace, and clear secrets explicitly', () => {
  const config = createDefaultPlatformConfig()
  config.github.token = 'old-token'
  config.github.enabled = true

  const kept = mergePlatformConfigSection(config, 'github', { branch: 'release' }, {
    token: { action: 'keep' },
  })
  assert.equal(kept.github.token, 'old-token')
  assert.equal(kept.github.branch, 'release')

  const replaced = mergePlatformConfigSection(kept, 'github', {}, {
    token: { action: 'replace', value: 'new-token' },
  })
  assert.equal(revealPlatformSecret(replaced, 'github.token'), 'new-token')

  const cleared = mergePlatformConfigSection(replaced, 'github', {}, { token: { action: 'clear' } })
  assert.equal(cleared.github.token, '')
  assert.throws(
    () => mergePlatformConfigSection(cleared, 'github', { enabled: false }, {}),
    PlatformConfigValidationError,
  )
})

test('platform secret replacements require at least eight characters', () => {
  const config = createDefaultPlatformConfig()
  assert.throws(
    () => mergePlatformConfigSection(config, 'github', {}, {
      token: { action: 'replace', value: 'short' },
    }),
    (error: unknown) => error instanceof PlatformConfigValidationError &&
      error.issues.includes('github.token 的凭据替换值必须至少 8 位。'),
  )
})
