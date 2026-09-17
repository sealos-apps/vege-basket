import { getPlatformConfigSnapshot } from './platform-config-runtime.ts'

export function platformAiEnvironment(): Record<string, string> {
  const ai = getPlatformConfigSnapshot().config.ai
  return {
    AI_API_BASE: ai.apiBase,
    AI_API_KEY: ai.apiKey,
    AI_MODEL: ai.model,
    AI_RATE_LIMIT: String(ai.rateLimit),
    AI_GLOBAL_RATE_LIMIT: String(ai.globalRateLimit),
    AI_RATE_WINDOW_MS: String(ai.rateWindowMs),
    AI_MAX_MESSAGE_LENGTH: String(ai.maxMessageLength),
    AI_MAX_CONTEXT_CHARS: String(ai.maxContextChars),
  }
}

export function platformFeishuConfig() {
  return getPlatformConfigSnapshot().config.feishu
}

export function platformStorageConfig() {
  return getPlatformConfigSnapshot().config.storage
}

export function platformPackageConfig() {
  return getPlatformConfigSnapshot().config.packages
}

export function platformGithubConfig() {
  return getPlatformConfigSnapshot().config.github
}

export function platformPublicUrl() {
  return getPlatformConfigSnapshot().config.general.publicUrl
}
