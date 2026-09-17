export type AiRateLimitConfig = {
  globalLimit: number
  perUserLimit: number
  windowMs: number
}

export type AiConcurrencyLimitConfig = {
  globalLimit: number
  perUserLimit: number
}

const defaultGlobalLimit = 30
const defaultPerUserLimit = 5
const defaultWindowMs = 60_000

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function readAiRateLimitConfig(
  environment: Record<string, string | undefined> = process.env,
): AiRateLimitConfig {
  return {
    globalLimit: positiveInteger(environment.AI_GLOBAL_RATE_LIMIT, defaultGlobalLimit),
    perUserLimit: positiveInteger(environment.AI_RATE_LIMIT, defaultPerUserLimit),
    windowMs: positiveInteger(environment.AI_RATE_WINDOW_MS, defaultWindowMs),
  }
}

export function createAiRateLimiter<Key = number>(
  initialConfig: AiRateLimitConfig,
  now: () => number = Date.now,
) {
  let config = initialConfig
  const userRequests = new Map<Key, number[]>()
  let globalRequests: number[] = []

  function currentRequests(userId: Key) {
    const currentTime = now()
    const windowStart = currentTime - config.windowMs
    const recentUserRequests = (userRequests.get(userId) ?? [])
      .filter((requestTime) => requestTime > windowStart)
    globalRequests = globalRequests.filter((requestTime) => requestTime > windowStart)
    userRequests.set(userId, recentUserRequests)
    return { currentTime, recentUserRequests }
  }

  function hasCapacity(userId: Key) {
    const { recentUserRequests } = currentRequests(userId)
    return recentUserRequests.length < config.perUserLimit &&
      globalRequests.length < config.globalLimit
  }

  return {
    updateConfig(nextConfig: AiRateLimitConfig) {
      config = nextConfig
    },
    canAllow(userId: Key) {
      return hasCapacity(userId)
    },
    allow(userId: Key) {
      const { currentTime, recentUserRequests } = currentRequests(userId)

      if (
        recentUserRequests.length >= config.perUserLimit ||
        globalRequests.length >= config.globalLimit
      ) {
        return false
      }

      recentUserRequests.push(currentTime)
      globalRequests.push(currentTime)
      userRequests.set(userId, recentUserRequests)
      return true
    },
  }
}

export function createAiConcurrencyLimiter<Key = number>(config: AiConcurrencyLimitConfig) {
  if (
    !Number.isSafeInteger(config.globalLimit) ||
    config.globalLimit <= 0 ||
    !Number.isSafeInteger(config.perUserLimit) ||
    config.perUserLimit <= 0
  ) {
    throw new Error('AI concurrency limits must be positive integers')
  }
  const activeByUser = new Map<Key, number>()
  let activeGlobal = 0

  return {
    acquire(userId: Key) {
      const activeForUser = activeByUser.get(userId) ?? 0
      if (activeForUser >= config.perUserLimit || activeGlobal >= config.globalLimit) return null
      activeByUser.set(userId, activeForUser + 1)
      activeGlobal += 1
      let released = false
      return () => {
        if (released) return
        released = true
        activeGlobal -= 1
        const remaining = (activeByUser.get(userId) ?? 1) - 1
        if (remaining > 0) activeByUser.set(userId, remaining)
        else activeByUser.delete(userId)
      }
    },
  }
}
