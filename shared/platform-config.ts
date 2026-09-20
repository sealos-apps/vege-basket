export const platformConfigSections = [
  'general',
  'ai',
  'email',
  'storage',
  'packages',
  'feishu',
  'github',
] as const

export type PlatformConfigSection = (typeof platformConfigSections)[number]

export const platformSecretFields = {
  ai: ['apiKey'],
  email: ['password'],
  feishu: ['appSecret', 'verificationToken'],
  github: ['token'],
  storage: ['accessKeyId', 'accessKeySecret', 'urlSecret'],
} as const

export type PlatformSecretSection = keyof typeof platformSecretFields

export type PlatformSecretField = {
  [Section in PlatformSecretSection]: `${Section}.${(typeof platformSecretFields)[Section][number]}`
}[PlatformSecretSection]

export type ConfiguredSecret = {
  configured: boolean
  revealable: boolean
}

export type PlatformConfigRuntimeInstance = {
  appliedRevision: number | null
  errorCode?: string
  heartbeatAt: string
  instanceId: string
  processKind: 'api'
  status: 'applied' | 'error' | 'loading' | 'offline'
}

export type PlatformConfigRuntimeStatus = {
  activeRevision: number
  cronJob: {
    mode: 'load-on-run'
  }
  instances: PlatformConfigRuntimeInstance[]
}

export type PlatformConfigChange = {
  after: string
  before: string
  field: string
  kind: 'hidden' | 'long-text' | 'secret' | 'value'
  label: string
  section: PlatformConfigSection | 'system'
  sectionLabel: string
}

export type PlatformConfigChangeGroup = {
  changes: PlatformConfigChange[]
  count: number
  section: PlatformConfigSection | 'system'
  sectionLabel: string
}

export type PlatformConfigHistoryItem = {
  changeCount: number
  changedSections: Array<{
    count: number
    section: PlatformConfigSection | 'system'
    sectionLabel: string
  }>
  createdAt: string
  createdBy: string
  restoredFromRevision: number | null
  revision: number
  source: string
  sourceLabel: string
}

export type PlatformConfigRevisionProgress = {
  appliedCount: number
  errorCount: number
  onlineCount: number
  state: 'applied' | 'error' | 'loading' | 'offline' | 'superseded'
  targetRevision: number
}

export type PlatformConfigRuntimeOverallStatus = 'applied' | 'error' | 'loading' | 'offline'

export function platformConfigRuntimeOverallStatus(
  runtime: PlatformConfigRuntimeStatus,
): PlatformConfigRuntimeOverallStatus {
  const onlineInstances = runtime.instances.filter((instance) => instance.status !== 'offline')
  if (onlineInstances.length === 0) return 'offline'
  if (onlineInstances.some((instance) => instance.status === 'error')) return 'error'
  if (onlineInstances.some((instance) => instance.status === 'loading')) return 'loading'
  return 'applied'
}

export function platformConfigRevisionProgress(
  runtime: PlatformConfigRuntimeStatus,
  targetRevision: number,
): PlatformConfigRevisionProgress {
  const onlineInstances = runtime.instances.filter((instance) => instance.status !== 'offline')
  const appliedCount = onlineInstances.filter((instance) => (
    instance.status === 'applied' && instance.appliedRevision === targetRevision
  )).length
  const errorCount = onlineInstances.filter((instance) => instance.status === 'error').length
  const state = runtime.activeRevision > targetRevision
    ? 'superseded'
    : onlineInstances.length === 0
      ? 'offline'
      : errorCount > 0
        ? 'error'
        : runtime.activeRevision === targetRevision && appliedCount === onlineInstances.length
          ? 'applied'
          : 'loading'
  return {
    appliedCount,
    errorCount,
    onlineCount: onlineInstances.length,
    state,
    targetRevision,
  }
}

export function platformConfigSectionHasDraftChanges(
  loaded: Record<string, unknown>,
  draft: Record<string, unknown>,
  section: PlatformConfigSection,
  secretDrafts: Record<string, string | undefined>,
) {
  if (JSON.stringify(loaded[section]) !== JSON.stringify(draft[section])) return true
  return Object.entries(secretDrafts).some(([path, value]) => (
    path.startsWith(`${section}.`) && Boolean(value)
  ))
}

export function isPlatformConfigSection(value: unknown): value is PlatformConfigSection {
  return platformConfigSections.includes(value as PlatformConfigSection)
}

export function isPlatformSecretField(value: string): value is PlatformSecretField {
  const [section, field, extra] = value.split('.')
  if (extra || !(section in platformSecretFields)) return false
  return (platformSecretFields[section as PlatformSecretSection] as readonly string[]).includes(field)
}
