import type { PlatformConfig } from './platform-config-schema.ts'
import type {
  PlatformConfigChange,
  PlatformConfigChangeGroup,
  PlatformConfigSection,
} from '../shared/platform-config.ts'

type FieldKind = PlatformConfigChange['kind']

type FieldDefinition = {
  field: string
  format?: (value: unknown) => string
  kind?: FieldKind
  label: string
  section: PlatformConfigSection
}

const sectionLabels: Record<PlatformConfigSection | 'system', string> = {
  general: '平台信息',
  ai: '全局 AI',
  email: '邮箱配置',
  storage: '对象存储',
  packages: '包市场规则',
  feishu: '飞书对接',
  github: 'GitHub Actions',
  system: '后台兼容配置',
}

function enabled(value: unknown) {
  return value ? '启用' : '停用'
}

function megabytes(value: unknown) {
  return `${Number(value) / (1024 * 1024)} MB`
}

function durationMs(value: unknown) {
  const milliseconds = Number(value)
  if (milliseconds % 60_000 === 0) return `${milliseconds / 60_000} 分钟`
  if (milliseconds % 1_000 === 0) return `${milliseconds / 1_000} 秒`
  return `${milliseconds} 毫秒`
}

function durationSeconds(value: unknown) {
  const seconds = Number(value)
  if (seconds % 86_400 === 0) return `${seconds / 86_400} 天`
  if (seconds % 3_600 === 0) return `${seconds / 3_600} 小时`
  if (seconds % 60 === 0) return `${seconds / 60} 分钟`
  return `${seconds} 秒`
}

function emailSecurity(value: unknown) {
  return value === 'starttls' ? 'STARTTLS' : '隐式 TLS'
}

const fields: FieldDefinition[] = [
  { section: 'general', field: 'displayName', label: '平台名称' },
  { section: 'general', field: 'publicUrl', label: '公网地址' },
  { section: 'ai', field: 'apiBase', label: '接口地址' },
  { section: 'ai', field: 'apiKey', label: '接口密钥', kind: 'secret' },
  { section: 'ai', field: 'model', label: '模型' },
  { section: 'ai', field: 'rateLimit', label: '每用户请求上限' },
  { section: 'ai', field: 'globalRateLimit', label: '全局请求上限' },
  { section: 'ai', field: 'rateWindowMs', label: '限流窗口', format: durationMs },
  { section: 'ai', field: 'maxMessageLength', label: '单次输入字符数' },
  { section: 'ai', field: 'maxContextChars', label: '上下文字符数' },
  { section: 'email', field: 'enabled', label: '启用邮件发送', format: enabled },
  { section: 'email', field: 'host', label: '邮件服务器' },
  { section: 'email', field: 'port', label: '端口' },
  { section: 'email', field: 'security', label: '连接安全', format: emailSecurity },
  { section: 'email', field: 'username', label: '登录账号' },
  { section: 'email', field: 'password', label: '登录密码', kind: 'secret' },
  { section: 'email', field: 'fromName', label: '发件人名称' },
  { section: 'email', field: 'fromAddress', label: '发件地址' },
  { section: 'storage', field: 'endpoint', label: '服务地址' },
  { section: 'storage', field: 'bucket', label: '存储桶' },
  { section: 'storage', field: 'accessKeyId', label: '访问账号', kind: 'secret' },
  { section: 'storage', field: 'accessKeySecret', label: '访问密钥', kind: 'secret' },
  { section: 'storage', field: 'uploadMaxBytes', label: '附件大小', format: megabytes },
  { section: 'storage', field: 'objectPrefix', label: '对象前缀' },
  { section: 'storage', field: 'urlSecret', label: '附件签名密钥', kind: 'secret' },
  { section: 'packages', field: 'downloadExpireSeconds', label: '下载链接有效期', format: durationSeconds },
  { section: 'packages', field: 'rulesYaml', label: '规则内容', kind: 'long-text' },
  { section: 'feishu', field: 'appId', label: 'App ID' },
  { section: 'feishu', field: 'appSecret', label: 'App Secret', kind: 'secret' },
  { section: 'feishu', field: 'verificationToken', label: '验证令牌', kind: 'secret' },
  { section: 'feishu', field: 'deliveryEnabled', label: '启用业务通知', format: enabled },
  { section: 'github', field: 'repositoryUrl', label: '仓库地址' },
  { section: 'github', field: 'workflowFile', label: '工作流文件' },
  { section: 'github', field: 'branch', label: '默认分支' },
  { section: 'github', field: 'downloadExpireSeconds', label: '下载链接有效期', format: durationSeconds },
  { section: 'github', field: 'token', label: '访问令牌', kind: 'secret' },
]

const hiddenFields = [
  'packages.legacyMiddlewareRoots',
  'packages.legacyBaseObjectTemplate',
  'packages.legacyBaseListPrefixTemplate',
  'feishu.aiChatEnabled',
  'feishu.oauthStateSecret',
  'github.enabled',
] as const

function rawValue(config: PlatformConfig, section: PlatformConfigSection, field: string) {
  return (config[section] as unknown as Record<string, unknown>)[field]
}

function rawPathValue(config: PlatformConfig, path: string) {
  const [section, field] = path.split('.') as [PlatformConfigSection, string]
  return rawValue(config, section, field)
}

function comparable(value: unknown) {
  return JSON.stringify(value)
}

function ordinaryDisplay(value: unknown, format?: (value: unknown) => string) {
  if (format) return format(value)
  if (Array.isArray(value)) return value.length > 0 ? value.join('、') : '未配置'
  const text = String(value ?? '')
  return text || '未配置'
}

function secretDisplay(before: unknown, after: unknown) {
  const beforeConfigured = String(before ?? '').length > 0
  const afterConfigured = String(after ?? '').length > 0
  if (!beforeConfigured && afterConfigured) return { before: '未配置', after: '已设置' }
  if (beforeConfigured && !afterConfigured) return { before: '已配置', after: '已清除' }
  return { before: '已配置', after: '已替换' }
}

export function platformConfigsEqual(left: PlatformConfig, right: PlatformConfig) {
  return comparable(left) === comparable(right)
}

export function diffPlatformConfigs(
  before: PlatformConfig | null,
  after: PlatformConfig,
): PlatformConfigChange[] {
  const changes: PlatformConfigChange[] = []
  for (const definition of fields) {
    const beforeValue = before ? rawValue(before, definition.section, definition.field) : undefined
    const afterValue = rawValue(after, definition.section, definition.field)
    if (before && comparable(beforeValue) === comparable(afterValue)) continue
    const kind = definition.kind ?? 'value'
    const displayed = kind === 'secret'
      ? secretDisplay(beforeValue, afterValue)
      : {
          before: before ? ordinaryDisplay(beforeValue, definition.format) : '未配置',
          after: ordinaryDisplay(afterValue, definition.format),
        }
    changes.push({
      ...displayed,
      field: `${definition.section}.${definition.field}`,
      kind,
      label: definition.label,
      section: definition.section,
      sectionLabel: sectionLabels[definition.section],
    })
  }

  const hiddenChanged = hiddenFields.filter((path) => (
    !before || comparable(rawPathValue(before, path)) !== comparable(rawPathValue(after, path))
  ))
  if (hiddenChanged.length > 0) {
    changes.push({
      after: `已更新 ${hiddenChanged.length} 项`,
      before: before ? '原后台配置' : '未初始化',
      field: 'system.compatibility',
      kind: 'hidden',
      label: '后台兼容配置',
      section: 'system',
      sectionLabel: sectionLabels.system,
    })
  }
  return changes
}

export function groupPlatformConfigChanges(changes: PlatformConfigChange[]): PlatformConfigChangeGroup[] {
  const groups = new Map<string, PlatformConfigChangeGroup>()
  for (const change of changes) {
    const existing = groups.get(change.section)
    if (existing) {
      existing.changes.push(change)
      existing.count += 1
    } else {
      groups.set(change.section, {
        changes: [change],
        count: 1,
        section: change.section,
        sectionLabel: change.sectionLabel,
      })
    }
  }
  return [...groups.values()]
}

export function platformConfigSourceLabel(source: string) {
  if (source === 'bootstrap') return '初始化配置'
  if (source === 'env_import') return '环境配置导入'
  if (source === 'restore') return '恢复历史版本'
  if (source === 'maintenance') return '系统维护'
  return '修改配置'
}
