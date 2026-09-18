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

export function isPlatformConfigSection(value: unknown): value is PlatformConfigSection {
  return platformConfigSections.includes(value as PlatformConfigSection)
}

export function isPlatformSecretField(value: string): value is PlatformSecretField {
  const [section, field, extra] = value.split('.')
  if (extra || !(section in platformSecretFields)) return false
  return (platformSecretFields[section as PlatformSecretSection] as readonly string[]).includes(field)
}
