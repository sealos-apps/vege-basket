import type {
  PlatformConfigChangeGroup,
  PlatformConfigHistoryItem,
} from '../shared/platform-config'

export type {
  PlatformConfigChange,
  PlatformConfigChangeGroup,
  PlatformConfigHistoryItem,
} from '../shared/platform-config'

export type SecretState = {
  configured: boolean
  revealable: boolean
}

export type PlatformConfig = {
  schemaVersion: 1
  general: { displayName: string; publicUrl: string }
  ai: {
    apiBase: string
    apiKey: SecretState
    model: string
    rateLimit: number
    globalRateLimit: number
    rateWindowMs: number
    maxMessageLength: number
    maxContextChars: number
  }
  email: {
    enabled: boolean
    host: string
    port: number
    security: 'implicit-tls' | 'starttls'
    username: string
    password: SecretState
    fromName: string
    fromAddress: string
  }
  storage: {
    endpoint: string
    bucket: string
    accessKeyId: SecretState
    accessKeySecret: SecretState
    uploadMaxBytes: number
    objectPrefix: string
    urlSecret: SecretState
  }
  packages: {
    downloadExpireSeconds: number
    rulesYaml: string
  }
  feishu: {
    appId: string
    appSecret: SecretState
    verificationToken: SecretState
    deliveryEnabled: boolean
  }
  github: {
    token: SecretState
    repositoryUrl: string
    workflowFile: string
    branch: string
    downloadExpireSeconds: number
  }
}

export type PlatformConfigResponse = {
  config: PlatformConfig
  initialized: boolean
  revision: number
}

export type PlatformConfigHistoryDetail = {
  changesFromCurrent: PlatformConfigChangeGroup[]
  changesFromPrevious: PlatformConfigChangeGroup[]
  currentRevision: number
  previousRevision: number | null
  restoredFromRevision: number | null
  version: Pick<PlatformConfigHistoryItem, 'createdAt' | 'createdBy' | 'revision' | 'source' | 'sourceLabel'>
}

export type PlatformOrganization = {
  blockers: Array<{ count: number; type: string }>
  canDelete: boolean
  checkedAt: string
  id: number
  memberCount: number
  name: string
  owner: { displayName: string; id: number; username: string }
  projectCount: number
  testSpaceCount: number
}

export type PlatformAdmin = {
  accountStatus: string
  canRevoke: boolean
  displayName: string
  grantKind: 'builtin' | 'managed'
  grantedAt: string
  id: number
  source: string
  username: string
}

export type PlatformConfigSection = keyof Omit<PlatformConfig, 'schemaVersion'>

export type PlatformRuntimeStatus = {
  activeRevision: number
  cronJob: { mode: 'load-on-run' }
  instances: Array<{
    appliedRevision: number | null
    errorCode?: string
    heartbeatAt: string
    instanceId: string
    operationalRevision: number
    processKind: 'api'
    status: 'applied' | 'error' | 'loading' | 'offline'
  }>
}

export type PlatformStatus = {
  configInitialized: boolean
  maintenance: {
    active: boolean
    manual: boolean
    message: string
    revision: number
    systemForced: boolean
    systemReasons: string[]
  }
  migration: {
    completedAt?: string
    errorCode?: string
    phase: 'waiting' | 'running' | 'completed' | 'failed'
    startedAt?: string
  }
}

export type PlatformMaintenanceRecord = {
  durationSeconds?: number
  endedAt?: string
  endedBy?: {
    displayName: string
    id: number
    username: string
  }
  id: number
  message: string
  startedAt: string
  startedBy?: {
    displayName: string
    id: number
    username: string
  }
  status: 'active' | 'completed'
}

export type PlatformMaintenanceHistory = {
  nextCursor?: number
  records: PlatformMaintenanceRecord[]
}

export type ApplicationMigration = {
  appliedAt: string
  checksum: string
  durationMs: number
  id: string
  kind: 'data' | 'schema'
  name: string
}

export type PlatformSecurityStatus = {
  activeKeyId: string
  algorithm: 'AES-256-GCM'
  applicationEncryption: {
    configurationHistory: boolean
    sensitiveBusinessText: boolean
  }
  configured: boolean
  lastInspection: null | {
    createdAt: string
    recordedBy: string
    result: {
      encryptedFieldCount?: number
      legacyPlaintextCount?: number
      referencedKeyIds?: string[]
      summary?: string
    }
    status: 'failed' | 'passed'
  }
  retainedKeyIds: string[]
  retainedVerificationSecrets: Array<{ keyId: string; purposeCount: number }>
}
