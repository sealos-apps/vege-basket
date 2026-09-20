import crypto from 'node:crypto'
import {
  createDefaultPlatformConfig,
  parsePlatformConfig,
  type PlatformConfig,
} from './platform-config-schema.ts'

export const legacyBusinessConfigKeys = [
  'APP_PUBLIC_URL',
  'VEGES_ADMIN_USERNAMES',
  'AI_API_BASE',
  'AI_API_KEY',
  'AI_MODEL',
  'AI_RATE_LIMIT',
  'AI_GLOBAL_RATE_LIMIT',
  'AI_RATE_WINDOW_MS',
  'AI_MAX_MESSAGE_LENGTH',
  'AI_MAX_CONTEXT_CHARS',
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'FEISHU_VERIFICATION_TOKEN',
  'FEISHU_OAUTH_REDIRECT_URI',
  'FEISHU_OAUTH_STATE_SECRET',
  'FEISHU_WEBHOOK_USER_EMAIL',
  'FEISHU_WEBHOOK_BASIC_USER',
  'FEISHU_WEBHOOK_BASIC_PASSWORD',
  'FEISHU_DELIVERY_ENABLED',
  'FEISHU_AI_CHAT_ENABLED',
  'OSS_ENDPOINT',
  'OSS_ACCESS_KEY_ID',
  'OSS_ACCESS_KEY_SECRET',
  'OSS_BUCKET',
  'TODO_IMAGE_UPLOAD_MAX_BYTES',
  'TODO_IMAGE_OBJECT_PREFIX',
  'TODO_IMAGE_URL_SECRET',
  'PACKAGE_MARKET_RULES_FILE',
  'PACKAGE_MARKET_MIDDLEWARE_ROOT',
  'PACKAGE_MARKET_BASE_OBJECT_TEMPLATE',
  'PACKAGE_MARKET_BASE_LIST_PREFIX_TEMPLATE',
  'PACKAGE_MARKET_DOWNLOAD_EXPIRE_SECONDS',
  'GITHUB_ACTIONS_TOKEN',
  'IMAGE_SYNC_DOWNLOAD_EXPIRE_SECONDS',
  'OSS_UI_DOWNLOAD_EXPIRE_SECONDS',
  'OSS_UI_MIDDLEWARE_ROOT',
  'OSS_UI_BASE_OBJECT_TEMPLATE',
  'OSS_UI_BASE_LIST_PREFIX_TEMPLATE',
  'TRIAL_COMBO_PACKAGE_RULES_FILE',
  'FEISHU_DELIVERY_INTERVAL_MS',
  'FEISHU_ENCRYPT_KEY',
] as const

export const startupConfigKeys = [
  'DATABASE_URL',
  'APP_ENCRYPTION_KEYS',
  'APP_ENCRYPTION_ACTIVE_KEY_ID',
  'PORT',
  'DB_POOL_MAX',
  'DB_POOL_CONNECTION_TIMEOUT_MS',
  'DB_POOL_IDLE_TIMEOUT_MS',
  'NODE_ENV',
  'DOTENV_CONFIG_PATH',
] as const

export type LegacyPlatformImport = {
  adminUsernames: string[]
  config: PlatformConfig
  ignoredUnimplementedKeys: string[]
  legacyTodoImageUrlSecret: string
  unknownKeys: string[]
}

function stringValue(env: Record<string, string>, key: string, fallback = '') {
  return key in env ? String(env[key]).trim() : fallback
}

function numberValue(env: Record<string, string>, key: string, fallback: number) {
  if (!(key in env) || String(env[key]).trim() === '') return fallback
  const parsed = Number(env[key])
  if (!Number.isSafeInteger(parsed)) throw new Error(`${key} 必须是整数。`)
  return parsed
}

function booleanValue(env: Record<string, string>, key: string, fallback: boolean) {
  if (!(key in env) || String(env[key]).trim() === '') return fallback
  const value = String(env[key]).trim().toLowerCase()
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${key} 必须是 true 或 false。`)
}

function firstDefined(env: Record<string, string>, keys: string[], fallback = '') {
  for (const key of keys) {
    if (key in env) return String(env[key]).trim()
  }
  return fallback
}

function listValues(values: string[]) {
  return [...new Set(values.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean))]
}

export function parseLegacyPlatformConfig(
  env: Record<string, string>,
  rulesYaml: string,
): LegacyPlatformImport {
  const defaults = createDefaultPlatformConfig()
  const known = new Set<string>([...legacyBusinessConfigKeys, ...startupConfigKeys])
  const adminUsernames = [...new Set(
    listValues([stringValue(env, 'VEGES_ADMIN_USERNAMES')])
      .map((username) => username.toLowerCase()),
  )]
  const legacyMiddlewareRoots = listValues([
    stringValue(env, 'PACKAGE_MARKET_MIDDLEWARE_ROOT'),
    stringValue(env, 'OSS_UI_MIDDLEWARE_ROOT'),
    ...defaults.packages.legacyMiddlewareRoots,
  ])
  const legacyTodoImageUrlSecret = firstDefined(env, [
    'TODO_IMAGE_URL_SECRET',
    'FEISHU_OAUTH_STATE_SECRET',
    'APP_ENCRYPTION_KEYS',
  ])
  const oauthStateSecret = stringValue(env, 'FEISHU_OAUTH_STATE_SECRET') ||
    stringValue(env, 'FEISHU_APP_SECRET') || stringValue(env, 'APP_ENCRYPTION_KEYS') ||
    crypto.randomBytes(32).toString('base64url')
  const config = parsePlatformConfig({
    ...defaults,
    general: {
      ...defaults.general,
      publicUrl: stringValue(env, 'APP_PUBLIC_URL'),
    },
    ai: {
      apiBase: stringValue(env, 'AI_API_BASE'),
      apiKey: stringValue(env, 'AI_API_KEY'),
      model: stringValue(env, 'AI_MODEL'),
      rateLimit: numberValue(env, 'AI_RATE_LIMIT', defaults.ai.rateLimit),
      globalRateLimit: numberValue(env, 'AI_GLOBAL_RATE_LIMIT', defaults.ai.globalRateLimit),
      rateWindowMs: numberValue(env, 'AI_RATE_WINDOW_MS', defaults.ai.rateWindowMs),
      maxMessageLength: numberValue(env, 'AI_MAX_MESSAGE_LENGTH', defaults.ai.maxMessageLength),
      maxContextChars: numberValue(env, 'AI_MAX_CONTEXT_CHARS', defaults.ai.maxContextChars),
    },
    storage: {
      endpoint: stringValue(env, 'OSS_ENDPOINT'),
      bucket: stringValue(env, 'OSS_BUCKET'),
      accessKeyId: stringValue(env, 'OSS_ACCESS_KEY_ID'),
      accessKeySecret: stringValue(env, 'OSS_ACCESS_KEY_SECRET'),
      uploadMaxBytes: numberValue(env, 'TODO_IMAGE_UPLOAD_MAX_BYTES', defaults.storage.uploadMaxBytes),
      objectPrefix: stringValue(env, 'TODO_IMAGE_OBJECT_PREFIX', defaults.storage.objectPrefix),
      urlSecret: crypto.randomBytes(32).toString('base64url'),
    },
    packages: {
      downloadExpireSeconds: numberValue(
        env,
        'PACKAGE_MARKET_DOWNLOAD_EXPIRE_SECONDS',
        numberValue(env, 'OSS_UI_DOWNLOAD_EXPIRE_SECONDS', defaults.packages.downloadExpireSeconds),
      ),
      rulesYaml,
      legacyMiddlewareRoots,
      legacyBaseObjectTemplate: firstDefined(env, [
        'PACKAGE_MARKET_BASE_OBJECT_TEMPLATE',
        'OSS_UI_BASE_OBJECT_TEMPLATE',
      ]),
      legacyBaseListPrefixTemplate: firstDefined(env, [
        'PACKAGE_MARKET_BASE_LIST_PREFIX_TEMPLATE',
        'OSS_UI_BASE_LIST_PREFIX_TEMPLATE',
      ]),
    },
    feishu: {
      appId: stringValue(env, 'FEISHU_APP_ID'),
      appSecret: stringValue(env, 'FEISHU_APP_SECRET'),
      verificationToken: stringValue(env, 'FEISHU_VERIFICATION_TOKEN'),
      deliveryEnabled: booleanValue(env, 'FEISHU_DELIVERY_ENABLED', defaults.feishu.deliveryEnabled),
      aiChatEnabled: booleanValue(env, 'FEISHU_AI_CHAT_ENABLED', defaults.feishu.aiChatEnabled),
      oauthStateSecret,
    },
    github: {
      ...defaults.github,
      enabled: Boolean(stringValue(env, 'GITHUB_ACTIONS_TOKEN')),
      token: stringValue(env, 'GITHUB_ACTIONS_TOKEN'),
      downloadExpireSeconds: numberValue(
        env,
        'IMAGE_SYNC_DOWNLOAD_EXPIRE_SECONDS',
        defaults.github.downloadExpireSeconds,
      ),
    },
  })
  return {
    adminUsernames,
    config,
    ignoredUnimplementedKeys: ['FEISHU_DELIVERY_INTERVAL_MS', 'FEISHU_ENCRYPT_KEY']
      .filter((key) => key in env),
    legacyTodoImageUrlSecret,
    unknownKeys: Object.keys(env).filter((key) => !known.has(key)).sort(),
  }
}
