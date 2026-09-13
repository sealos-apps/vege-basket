import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError } from '../src/api-error.ts'
import { createResumableAction, isUncertainActionError, reconcileAction } from '../src/confirmed-action.ts'

function httpError(status: number) {
  return new ApiError('请求失败', { method: 'DELETE', path: '/fixture', responseBody: {}, status, statusText: 'Failed' })
}

test('a lost mutation response is reconciled by one read, without repeating the write', async () => {
  let writes = 0
  let reads = 0
  const state = await reconcileAction(async () => { writes++; throw new TypeError('Failed to fetch') }, async () => { reads++; return { deleted: true } }, (result) => result.deleted)
  assert.equal(state.deleted, true)
  assert.equal(writes, 1)
  assert.equal(reads, 1)
})

test('permission and conflict failures remain definitive and do not trigger a read or a retry', async () => {
  for (const status of [400, 401, 403, 404, 409, 429]) {
    const error = httpError(status)
    let reads = 0
    await assert.rejects(reconcileAction(async () => { throw error }, async () => { reads++; return true }, Boolean), (caught) => caught === error)
    assert.equal(reads, 0)
  }
})

test('gateway failures and request timeouts are uncertain outcomes', () => {
  for (const status of [408, 500, 502, 503, 504]) assert.equal(isUncertainActionError(httpError(status)), true)
  assert.equal(isUncertainActionError(new DOMException('timeout', 'TimeoutError')), true)
})

test('unchanged or unavailable reads preserve the original uncertain failure', async () => {
  const error = new TypeError('response lost')
  for (const read of [async () => false, async (): Promise<boolean> => { throw httpError(503) }]) {
    await assert.rejects(reconcileAction(async () => { throw error }, read, Boolean), (caught) => caught === error)
  }
})

test('successful writes do not require a follow-up read', async () => {
  assert.equal(await reconcileAction(async () => true, async () => { throw new Error('must not read') }, Boolean), true)
})

test('a partial batch retries only the failed and subsequent steps', async () => {
  const calls: number[] = []
  let reject = true
  const action = createResumableAction([
    async () => { calls.push(1); return true },
    async () => { calls.push(2); if (reject) throw httpError(409); return true },
    async () => { calls.push(3); return true },
  ])
  await assert.rejects(action.run())
  assert.equal(action.completed, 1)
  reject = false
  assert.equal(await action.run(), true)
  assert.deepEqual(calls, [1, 2, 2, 3])
  assert.equal(await action.run(), true)
  assert.deepEqual(calls, [1, 2, 2, 3])
})

test('false is not a successful step, and double clicks share one in-flight run', async () => {
  let calls = 0
  let finish!: (success: boolean) => void
  const action = createResumableAction([() => { calls++; return new Promise((resolve) => { finish = resolve }) }])
  const first = action.run()
  assert.equal(action.run(), first)
  finish(false)
  assert.equal(await first, false)
  assert.equal(action.completed, 0)
  const retry = action.run()
  finish(true)
  assert.equal(await retry, true)
  assert.equal(calls, 2)
})
