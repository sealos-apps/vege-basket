export const notificationRefreshIntervalMs = 15_000
export const authContextRefreshIntervalMs = 15_000
export const workspaceRefreshIntervalMs = 15_000
export const workspaceCatalogRefreshIntervalMs = 30_000

const refreshFailureBackoffBaseMs = 1_000
const refreshFailureBackoffMaxMs = 60_000

export function startVisibleRefreshSchedule(options: {
  clearInterval: (handle: number) => void
  isVisible: () => boolean
  minRefreshGapMs?: number
  now?: () => number
  onFocus: (listener: () => void) => () => void
  onVisibilityChange: (listener: () => void) => () => void
  refresh: () => void | Promise<boolean | void>
  refreshImmediately?: boolean
  setInterval: (listener: () => void, delay: number) => number
  intervalMs?: number
}) {
  let refreshInFlight = false
  let failureCount = 0
  let blockedUntil = 0
  let lastRefreshStartedAt = Number.NEGATIVE_INFINITY
  const now = options.now ?? Date.now

  const registerFailure = () => {
    failureCount += 1
    const delay = Math.min(
      refreshFailureBackoffMaxMs,
      refreshFailureBackoffBaseMs * 2 ** (failureCount - 1),
    )
    blockedUntil = now() + delay
  }

  const refreshIfVisible = () => {
    const currentTime = now()
    if (
      !options.isVisible() ||
      refreshInFlight ||
      currentTime < blockedUntil ||
      currentTime - lastRefreshStartedAt < (options.minRefreshGapMs ?? 0)
    ) return
    lastRefreshStartedAt = currentTime

    let result: void | Promise<boolean | void>
    try {
      result = options.refresh()
    } catch {
      registerFailure()
      return
    }

    if (!result || typeof result.then !== 'function') return

    refreshInFlight = true
    Promise.resolve(result).then(
      (successful) => {
        refreshInFlight = false
        if (successful === false) {
          registerFailure()
        } else {
          failureCount = 0
          blockedUntil = 0
        }
      },
      () => {
        refreshInFlight = false
        registerFailure()
      },
    )
  }
  const interval = options.setInterval(refreshIfVisible, options.intervalMs ?? notificationRefreshIntervalMs)
  const removeFocusListener = options.onFocus(refreshIfVisible)
  const removeVisibilityListener = options.onVisibilityChange(refreshIfVisible)
  if (options.refreshImmediately) refreshIfVisible()

  return () => {
    options.clearInterval(interval)
    removeFocusListener()
    removeVisibilityListener()
  }
}
