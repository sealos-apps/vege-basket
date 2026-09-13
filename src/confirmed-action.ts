import { ApiError } from './api-error'

export type ActionReconciliation = 'succeeded' | 'unchanged' | 'unknown'

export function isUncertainActionError(error: unknown) {
  if (error instanceof ApiError) return error.status >= 500 || error.status === 408
  return (
    error instanceof TypeError || error instanceof SyntaxError ||
    (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
  )
}

/** A read can recover a lost response, but must never repeat the write. */
export async function reconcileAction<T>(
  write: () => Promise<T>,
  read: () => Promise<T>,
  matches: (result: T) => boolean,
): Promise<T> {
  try {
    return await write()
  } catch (error) {
    if (!isUncertainActionError(error)) throw error
    try {
      const current = await read()
      if (matches(current)) return current
    } catch {
      // Keep the original uncertain result; a failed read is not a failed write.
    }
    throw error
  }
}

/** Keep committed steps when a confirmed multi-request action is retried. */
export function createResumableAction(steps: readonly (() => Promise<boolean>)[]) {
  let completed = 0
  let running: Promise<boolean> | undefined
  async function execute() {
    while (completed < steps.length) {
      if (!await steps[completed]()) return false
      completed += 1
    }
    return true
  }
  return {
    get completed() { return completed },
    run(): Promise<boolean> {
      if (!running) running = execute().finally(() => { running = undefined })
      return running
    },
  }
}
