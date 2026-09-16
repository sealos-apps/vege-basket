import assert from 'node:assert/strict'
import test from 'node:test'

import { replaceItemByIdInPlace } from '../src/test-workbench-cache.ts'
import { fetchTestWorkbench } from '../src/test-workbench-api.ts'

const emptyWorkbench = {
  bugs: [],
  cases: [],
  departedUserIds: [],
  folders: [],
  modules: [],
  notifications: [],
  planCases: [],
  plans: [],
  spaces: [],
  subjects: [],
  testEnvironments: [],
  users: [],
}

test('test workbench client serializes section and resource scopes', async (context) => {
  const originalFetch = globalThis.fetch
  context.after(() => {
    globalThis.fetch = originalFetch
  })
  const requests: string[] = []
  globalThis.fetch = async (input) => {
    requests.push(String(input))
    return Response.json(emptyWorkbench)
  }

  await fetchTestWorkbench({ sections: ['bugs', 'cases'], spaceId: 7 })
  await fetchTestWorkbench({ bugId: 42, sections: ['bugs'], spaceId: 7 })
  await fetchTestWorkbench({ sections: ['cases'], spaceId: 7, subjectId: 9 })

  assert.deepEqual(requests, [
    '/api/test-workbench?spaceId=7&sections=bugs%2Ccases',
    '/api/test-workbench?bugId=42&spaceId=7&sections=bugs',
    '/api/test-workbench?spaceId=7&subjectId=9&sections=cases',
  ])
  assert.equal(requests.some((request) => request === '/api/test-workbench'), false)
})

test('test workbench client forwards cancellation to superseded reads', async (context) => {
  const originalFetch = globalThis.fetch
  context.after(() => {
    globalThis.fetch = originalFetch
  })
  let receivedSignal: AbortSignal | null | undefined
  globalThis.fetch = async (_input, init) => {
    receivedSignal = init?.signal
    return Response.json(emptyWorkbench)
  }
  const controller = new AbortController()

  await fetchTestWorkbench({ sections: ['plans'], spaceId: 3 }, { signal: controller.signal })

  assert.equal(receivedSignal, controller.signal)
})

test('loading Bug details replaces the cached item without changing list order', () => {
  const current = [
    { detailsLoaded: false, id: 3 },
    { detailsLoaded: false, id: 2 },
    { detailsLoaded: false, id: 1 },
  ]

  const merged = replaceItemByIdInPlace(current, [{ detailsLoaded: true, id: 2 }], 2)

  assert.deepEqual(merged.map((bug) => bug.id), [3, 2, 1])
  assert.equal(merged[1]?.detailsLoaded, true)
})
