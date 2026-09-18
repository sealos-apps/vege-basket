import crypto from 'node:crypto'
import {
  isPlatformSecretField,
  platformSecretFields,
  type ConfiguredSecret,
  type PlatformConfigSection,
} from '../shared/platform-config.ts'
import { normalizeOssEndpoint } from './oss-endpoint.ts'

export const platformConfigSchemaVersion = 1

const maxPackageRulesBytes = 256 * 1024
const defaultGithubRepositoryUrl = 'https://github.com/sealos-apps/sealos-pro'
const defaultGithubWorkflowFile = 'sync-images-tar-oss.yml'

export type PlatformConfig = {
  ai: {
    apiBase: string
    apiKey: string
    globalRateLimit: number
    maxContextChars: number
    maxMessageLength: number
    model: string
    rateLimit: number
    rateWindowMs: number
  }
  email: {
    enabled: boolean
    fromAddress: string
    fromName: string
    host: string
    password: string
    port: number
    security: 'implicit-tls' | 'starttls'
    username: string
  }
  feishu: {
    aiChatEnabled: boolean
    appId: string
    appSecret: string
    deliveryEnabled: boolean
    oauthStateSecret: string
    verificationToken: string
  }
  general: {
    displayName: string
    publicUrl: string
  }
  github: {
    branch: string
    downloadExpireSeconds: number
    enabled: boolean
    repositoryUrl: string
    token: string
    workflowFile: string
  }
  packages: {
    downloadExpireSeconds: number
    legacyBaseListPrefixTemplate: string
    legacyBaseObjectTemplate: string
    legacyMiddlewareRoots: string[]
    rulesYaml: string
  }
  schemaVersion: 1
  storage: {
    accessKeyId: string
    accessKeySecret: string
    bucket: string
    endpoint: string
    objectPrefix: string
    uploadMaxBytes: number
    urlSecret: string
  }
}

export type MaskedPlatformConfig = Omit<PlatformConfig, 'ai' | 'email' | 'feishu' | 'github' | 'packages' | 'storage'> & {
  ai: Omit<PlatformConfig['ai'], 'apiKey'> & { apiKey: ConfiguredSecret }
  email: Omit<PlatformConfig['email'], 'password'> & { password: ConfiguredSecret }
  feishu: Omit<PlatformConfig['feishu'], 'aiChatEnabled' | 'appSecret' | 'oauthStateSecret' | 'verificationToken'> & {
    appSecret: ConfiguredSecret
    verificationToken: ConfiguredSecret
  }
  github: Omit<PlatformConfig['github'], 'enabled' | 'token'> & { token: ConfiguredSecret }
  packages: Pick<PlatformConfig['packages'], 'downloadExpireSeconds' | 'rulesYaml'>
  storage: Omit<PlatformConfig['storage'], 'accessKeyId' | 'accessKeySecret' | 'urlSecret'> & {
    accessKeyId: ConfiguredSecret
    accessKeySecret: ConfiguredSecret
    urlSecret: ConfiguredSecret
  }
}

const editableSectionFields: Record<PlatformConfigSection, readonly string[]> = {
  general: ['displayName', 'publicUrl'],
  ai: ['apiBase', 'model', 'rateLimit', 'globalRateLimit', 'rateWindowMs', 'maxMessageLength', 'maxContextChars'],
  email: ['enabled', 'host', 'port', 'security', 'username', 'fromName', 'fromAddress'],
  storage: ['endpoint', 'bucket', 'uploadMaxBytes', 'objectPrefix'],
  packages: ['downloadExpireSeconds', 'rulesYaml'],
  feishu: ['appId', 'deliveryEnabled'],
  github: ['repositoryUrl', 'workflowFile', 'branch', 'downloadExpireSeconds'],
}

export const corruptedOAuthStateSecret = '[object Object]'

export class PlatformConfigValidationError extends Error {
  readonly code = 'PLATFORM_CONFIG_INVALID'
  readonly issues: string[]

  constructor(issues: string[]) {
    super(issues[0] ?? '平台配置无效。')
    this.name = 'PlatformConfigValidationError'
    this.issues = issues
  }
}

function stringValue(value: unknown) {
  return String(value ?? '').trim()
}

function booleanValue(value: unknown, path: string, issues: string[]) {
  if (typeof value === 'boolean') return value
  issues.push(`${path} 必须是布尔值。`)
  return false
}

function integerValue(
  value: unknown,
  path: string,
  issues: string[],
  minimum: number,
  maximum: number,
) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    issues.push(`${path} 必须是 ${minimum} 到 ${maximum} 之间的整数。`)
    return minimum
  }
  return number
}

function objectValue(value: unknown, path: string, issues: string[]) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  issues.push(`${path} 必须是对象。`)
  return {} as Record<string, unknown>
}

function strictKeys(value: Record<string, unknown>, expected: readonly string[], path: string, issues: string[]) {
  const expectedSet = new Set(expected)
  for (const key of Object.keys(value)) {
    if (!expectedSet.has(key)) issues.push(`${path}.${key} 不是支持的字段。`)
  }
}

function parseHttpsOrigin(value: unknown, path: string, issues: string[], allowLocalHttp = false) {
  const raw = stringValue(value)
  if (!raw) return ''
  try {
    const url = new URL(raw)
    const localHttp = allowLocalHttp && url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname.toLowerCase())
    if (
      (url.protocol !== 'https:' && !localHttp) ||
      url.username || url.password || url.search || url.hash ||
      (url.pathname && url.pathname !== '/')
    ) throw new Error('invalid origin')
    return url.origin
  } catch {
    issues.push(`${path} 必须是无账号、路径、查询参数和片段的 HTTPS 地址。`)
    return ''
  }
}

function normalizeObjectPrefix(value: unknown, path: string, issues: string[]) {
  const prefix = stringValue(value).replace(/^\/+|\/+$/g, '')
  if (!prefix || prefix.includes('..') || prefix.includes('\\') ||
    [...prefix].some((character) => character.charCodeAt(0) < 32)) {
    issues.push(`${path} 必须是安全的相对对象前缀。`)
  }
  return prefix
}

function normalizeNetworkHostname(value: unknown, path: string, issues: string[]) {
  const raw = stringValue(value)
  if (!raw) return ''
  try {
    const url = new URL(`smtp://${raw}`)
    if (
      !url.hostname || url.username || url.password || url.port ||
      url.pathname !== '' || url.search || url.hash
    ) throw new Error('invalid hostname')
    return url.hostname
  } catch {
    issues.push(`${path} 必须是不含协议、端口、路径或账号信息的主机名或 IP 地址。`)
    return ''
  }
}

function normalizeGithubRepository(value: unknown, path: string, issues: string[]) {
  const raw = stringValue(value).replace(/\.git$/i, '')
  try {
    const url = new URL(raw)
    const segments = url.pathname.split('/').filter(Boolean)
    if (
      url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' ||
      url.username || url.password || url.search || url.hash || segments.length !== 2
    ) throw new Error('invalid repository')
    return `https://github.com/${segments[0]}/${segments[1]}`
  } catch {
    issues.push(`${path} 必须是 github.com 上的 HTTPS 仓库地址。`)
    return defaultGithubRepositoryUrl
  }
}

function normalizeGithubName(value: unknown, path: string, issues: string[], workflow = false) {
  const normalized = stringValue(value)
  const pattern = workflow
    ? /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}\.ya?ml$/u
    : /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/u
  if (!pattern.test(normalized) || normalized.includes('..') || normalized.startsWith('/')) {
    issues.push(`${path} 格式无效。`)
  }
  return normalized
}

export function createDefaultPlatformConfig(): PlatformConfig {
  return {
    schemaVersion: platformConfigSchemaVersion,
    general: { displayName: 'Veges', publicUrl: '' },
    ai: {
      apiBase: '',
      apiKey: '',
      model: '',
      rateLimit: 5,
      globalRateLimit: 30,
      rateWindowMs: 60_000,
      maxMessageLength: 2_000,
      maxContextChars: 12_000,
    },
    email: {
      enabled: false,
      host: '',
      port: 465,
      security: 'implicit-tls',
      username: '',
      password: '',
      fromName: '',
      fromAddress: '',
    },
    storage: {
      endpoint: '',
      bucket: '',
      accessKeyId: '',
      accessKeySecret: '',
      uploadMaxBytes: 10 * 1024 * 1024,
      objectPrefix: 'todo-images',
      urlSecret: '',
    },
    packages: {
      downloadExpireSeconds: 30 * 60,
      rulesYaml: '',
      legacyMiddlewareRoots: ['offline/sealos-pro/'],
      legacyBaseObjectTemplate: '',
      legacyBaseListPrefixTemplate: '',
    },
    feishu: {
      appId: '',
      appSecret: '',
      verificationToken: '',
      deliveryEnabled: true,
      aiChatEnabled: false,
      oauthStateSecret: '',
    },
    github: {
      enabled: false,
      token: '',
      repositoryUrl: defaultGithubRepositoryUrl,
      workflowFile: defaultGithubWorkflowFile,
      branch: 'main',
      downloadExpireSeconds: 30 * 60,
    },
  }
}

export function parsePlatformConfig(value: unknown): PlatformConfig {
  const issues: string[] = []
  const root = objectValue(value, 'config', issues)
  strictKeys(root, ['schemaVersion', 'general', 'ai', 'email', 'storage', 'packages', 'feishu', 'github'], 'config', issues)
  if (root.schemaVersion !== platformConfigSchemaVersion) {
    issues.push(`config.schemaVersion 必须是 ${platformConfigSchemaVersion}。`)
  }

  const general = objectValue(root.general, 'general', issues)
  strictKeys(general, ['displayName', 'publicUrl'], 'general', issues)
  const displayName = stringValue(general.displayName)
  if (!displayName || displayName.length > 80) issues.push('general.displayName 长度必须为 1 到 80 个字符。')

  const ai = objectValue(root.ai, 'ai', issues)
  strictKeys(ai, ['apiBase', 'apiKey', 'model', 'rateLimit', 'globalRateLimit', 'rateWindowMs', 'maxMessageLength', 'maxContextChars'], 'ai', issues)
  const aiApiBase = stringValue(ai.apiBase)
  const aiModel = stringValue(ai.model)
  if (aiApiBase) parseHttpsOrigin(aiApiBase, 'ai.apiBase', issues)
  if ((aiApiBase || stringValue(ai.apiKey) || aiModel) && !(aiApiBase && stringValue(ai.apiKey) && aiModel)) {
    issues.push('AI 地址、密钥和模型必须同时配置。')
  }

  const email = objectValue(root.email, 'email', issues)
  strictKeys(email, ['enabled', 'host', 'port', 'security', 'username', 'password', 'fromName', 'fromAddress'], 'email', issues)
  const emailEnabled = booleanValue(email.enabled, 'email.enabled', issues)
  const emailHost = normalizeNetworkHostname(email.host, 'email.host', issues)
  const emailSecurity = email.security === 'implicit-tls' || email.security === 'starttls'
    ? email.security
    : 'implicit-tls'
  if (email.security !== emailSecurity) issues.push('email.security 必须是 implicit-tls 或 starttls。')
  if (emailEnabled && ![
    emailHost, email.username, email.password, email.fromAddress,
  ].every((item) => stringValue(item))) issues.push('启用邮箱时必须完整配置服务器、账号、密码和发件地址。')

  const storage = objectValue(root.storage, 'storage', issues)
  strictKeys(storage, ['endpoint', 'bucket', 'accessKeyId', 'accessKeySecret', 'uploadMaxBytes', 'objectPrefix', 'urlSecret'], 'storage', issues)
  const rawStorageEndpoint = stringValue(storage.endpoint)
  let storageEndpoint = ''
  if (rawStorageEndpoint) {
    try {
      storageEndpoint = normalizeOssEndpoint(rawStorageEndpoint)
    } catch (error) {
      issues.push(error instanceof Error ? error.message : 'storage.endpoint 格式无效。')
    }
  }
  const bucket = stringValue(storage.bucket)
  if (bucket && !/^[a-z0-9][a-z0-9-]{1,62}$/u.test(bucket)) issues.push('storage.bucket 格式无效。')
  const storageCredentialValues = [
    storageEndpoint,
    bucket,
    stringValue(storage.accessKeyId),
    stringValue(storage.accessKeySecret),
  ]
  if (storageCredentialValues.some(Boolean) &&
      !(storageCredentialValues.every(Boolean) && stringValue(storage.urlSecret))) {
    issues.push('对象存储地址、存储桶、访问账号、访问密钥和附件签名密钥必须同时配置。')
  }

  const packages = objectValue(root.packages, 'packages', issues)
  strictKeys(packages, ['downloadExpireSeconds', 'rulesYaml', 'legacyMiddlewareRoots', 'legacyBaseObjectTemplate', 'legacyBaseListPrefixTemplate'], 'packages', issues)
  const rulesYaml = String(packages.rulesYaml ?? '')
  if (Buffer.byteLength(rulesYaml, 'utf8') > maxPackageRulesBytes) issues.push('packages.rulesYaml 不能超过 256 KiB。')
  const legacyMiddlewareRoots = Array.isArray(packages.legacyMiddlewareRoots)
    ? packages.legacyMiddlewareRoots.map(stringValue).filter(Boolean)
    : []
  if (!Array.isArray(packages.legacyMiddlewareRoots)) issues.push('packages.legacyMiddlewareRoots 必须是数组。')

  const feishu = objectValue(root.feishu, 'feishu', issues)
  // Deprecated webhook fields remain accepted so immutable historical versions stay readable.
  strictKeys(feishu, ['appId', 'appSecret', 'verificationToken', 'webhookUserId', 'webhookBasicUser', 'webhookBasicPassword', 'deliveryEnabled', 'aiChatEnabled', 'oauthStateSecret'], 'feishu', issues)
  const feishuIdentity = [stringValue(feishu.appId), stringValue(feishu.appSecret)]
  if (feishuIdentity.some(Boolean) && !feishuIdentity.every(Boolean)) issues.push('飞书 App ID 和 App Secret 必须同时配置。')

  const github = objectValue(root.github, 'github', issues)
  strictKeys(github, ['enabled', 'token', 'repositoryUrl', 'workflowFile', 'branch', 'downloadExpireSeconds'], 'github', issues)
  const githubEnabled = booleanValue(github.enabled, 'github.enabled', issues)

  const config: PlatformConfig = {
    schemaVersion: platformConfigSchemaVersion,
    general: {
      displayName,
      publicUrl: parseHttpsOrigin(general.publicUrl, 'general.publicUrl', issues, true),
    },
    ai: {
      apiBase: aiApiBase,
      apiKey: stringValue(ai.apiKey),
      model: aiModel,
      rateLimit: integerValue(ai.rateLimit, 'ai.rateLimit', issues, 1, 10_000),
      globalRateLimit: integerValue(ai.globalRateLimit, 'ai.globalRateLimit', issues, 1, 100_000),
      rateWindowMs: integerValue(ai.rateWindowMs, 'ai.rateWindowMs', issues, 1_000, 86_400_000),
      maxMessageLength: integerValue(ai.maxMessageLength, 'ai.maxMessageLength', issues, 1, 1_000_000),
      maxContextChars: integerValue(ai.maxContextChars, 'ai.maxContextChars', issues, 1, 10_000_000),
    },
    email: {
      enabled: emailEnabled,
      host: emailHost,
      port: integerValue(email.port, 'email.port', issues, 1, 65_535),
      security: emailSecurity,
      username: stringValue(email.username),
      password: String(email.password ?? ''),
      fromName: stringValue(email.fromName),
      fromAddress: stringValue(email.fromAddress),
    },
    storage: {
      endpoint: storageEndpoint,
      bucket,
      accessKeyId: stringValue(storage.accessKeyId),
      accessKeySecret: String(storage.accessKeySecret ?? ''),
      uploadMaxBytes: integerValue(storage.uploadMaxBytes, 'storage.uploadMaxBytes', issues, 1, 1024 * 1024 * 1024),
      objectPrefix: normalizeObjectPrefix(storage.objectPrefix, 'storage.objectPrefix', issues),
      urlSecret: String(storage.urlSecret ?? ''),
    },
    packages: {
      downloadExpireSeconds: integerValue(packages.downloadExpireSeconds, 'packages.downloadExpireSeconds', issues, 1, 365 * 24 * 60 * 60),
      rulesYaml,
      legacyMiddlewareRoots,
      legacyBaseObjectTemplate: String(packages.legacyBaseObjectTemplate ?? ''),
      legacyBaseListPrefixTemplate: String(packages.legacyBaseListPrefixTemplate ?? ''),
    },
    feishu: {
      appId: stringValue(feishu.appId),
      appSecret: String(feishu.appSecret ?? ''),
      verificationToken: String(feishu.verificationToken ?? ''),
      deliveryEnabled: booleanValue(feishu.deliveryEnabled, 'feishu.deliveryEnabled', issues),
      aiChatEnabled: booleanValue(feishu.aiChatEnabled, 'feishu.aiChatEnabled', issues),
      oauthStateSecret: String(feishu.oauthStateSecret ?? ''),
    },
    github: {
      enabled: githubEnabled,
      token: String(github.token ?? ''),
      repositoryUrl: normalizeGithubRepository(github.repositoryUrl, 'github.repositoryUrl', issues),
      workflowFile: normalizeGithubName(github.workflowFile, 'github.workflowFile', issues, true),
      branch: normalizeGithubName(github.branch, 'github.branch', issues),
      downloadExpireSeconds: integerValue(github.downloadExpireSeconds, 'github.downloadExpireSeconds', issues, 1, 365 * 24 * 60 * 60),
    },
  }
  if (issues.length > 0) throw new PlatformConfigValidationError(issues)
  return config
}

function secretState(value: string, revealable = true): ConfiguredSecret {
  return { configured: value.length > 0, revealable: value.length > 0 && revealable }
}

export function maskPlatformConfig(config: PlatformConfig): MaskedPlatformConfig {
  return {
    ...config,
    ai: { ...config.ai, apiKey: secretState(config.ai.apiKey) },
    email: { ...config.email, password: secretState(config.email.password) },
    storage: {
      ...config.storage,
      accessKeyId: secretState(config.storage.accessKeyId),
      accessKeySecret: secretState(config.storage.accessKeySecret),
      urlSecret: secretState(config.storage.urlSecret),
    },
    feishu: {
      appId: config.feishu.appId,
      appSecret: secretState(config.feishu.appSecret),
      deliveryEnabled: config.feishu.deliveryEnabled,
      verificationToken: secretState(config.feishu.verificationToken),
    },
    github: {
      branch: config.github.branch,
      downloadExpireSeconds: config.github.downloadExpireSeconds,
      repositoryUrl: config.github.repositoryUrl,
      token: secretState(config.github.token),
      workflowFile: config.github.workflowFile,
    },
    packages: {
      downloadExpireSeconds: config.packages.downloadExpireSeconds,
      rulesYaml: config.packages.rulesYaml,
    },
  }
}

export function revealPlatformSecret(config: PlatformConfig, field: string) {
  if (!isPlatformSecretField(field)) return null
  const [section, name] = field.split('.') as [keyof typeof platformSecretFields, string]
  return String((config[section] as unknown as Record<string, unknown>)[name] ?? '')
}

export function mergePlatformConfigSection(
  current: PlatformConfig,
  section: PlatformConfigSection,
  fields: unknown,
  secretActions: unknown,
) {
  const issues: string[] = []
  const input = objectValue(fields, section, issues)
  strictKeys(input, editableSectionFields[section], section, issues)
  if (issues.length > 0) throw new PlatformConfigValidationError(issues)
  const candidate = structuredClone(current)
  if (!candidate.feishu.oauthStateSecret || candidate.feishu.oauthStateSecret === corruptedOAuthStateSecret) {
    candidate.feishu.oauthStateSecret = crypto.randomBytes(32).toString('base64url')
  }
  const sectionTarget = candidate[section] as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(input)) sectionTarget[key] = value

  if (!secretActions || typeof secretActions !== 'object' || Array.isArray(secretActions)) {
    throw new PlatformConfigValidationError([`${section} 的凭据操作必须是对象。`])
  }
  const actions = secretActions as Record<string, unknown>
  for (const [key, rawAction] of Object.entries(actions)) {
    const field = `${section}.${key}`
    if (!isPlatformSecretField(field)) throw new PlatformConfigValidationError([`${field} 不是可编辑凭据。`])
    const action = objectValue(rawAction, field, [])
    if (action.action === 'keep') continue
    if (action.action === 'clear') {
      sectionTarget[key] = ''
      continue
    }
    if (action.action === 'replace') {
      if (typeof action.value !== 'string' || action.value.length < 8) {
        throw new PlatformConfigValidationError([`${field} 的凭据替换值必须至少 8 位。`])
      }
      sectionTarget[key] = action.value
      continue
    }
    throw new PlatformConfigValidationError([`${field} 的凭据操作无效。`])
  }
  return parsePlatformConfig(candidate)
}
