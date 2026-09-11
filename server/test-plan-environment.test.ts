import assert from 'node:assert/strict'
import test from 'node:test'
import type { PoolClient } from 'pg'
import { resolvePlanEnvironment } from './test-plan-environment.ts'
import { decryptText, encryptText, isEncryptedText } from './crypto.ts'

process.env.APP_ENCRYPTION_ACTIVE_KEY_ID = 'plan-environment-test'
process.env.APP_ENCRYPTION_KEYS = `plan-environment-test:${Buffer.alloc(32, 42).toString('base64')}`

const legacy = { environment: 'historical', environment_access_url: '', test_environment_id: null, status: 'draft' }
function client(rows: unknown[] = []) {
  const calls: unknown[][] = []
  return {
    calls,
    db: { query: async (...args: unknown[]) => { calls.push(args); return { rows } } } as unknown as PoolClient,
  }
}

test('new plans require a positive environment ID', async () => {
  const { db, calls } = client()
  for (const id of [undefined, null, '', '1', 0, -1, 1.5]) {
    await assert.rejects(resolvePlanEnvironment(db, 7, id), /请选择/)
  }
  assert.equal(calls.length, 0)
})

test('legacy plans keep their environment when not changed', async () => {
  const { db, calls } = client()
  assert.deepEqual(await resolvePlanEnvironment(db, 7, undefined, legacy), legacy)
  assert.equal(calls.length, 0)
})

test('executing plans reject environment changes before looking up an environment', async () => {
  const { db, calls } = client()
  await assert.rejects(resolvePlanEnvironment(db, 7, 2, { ...legacy, status: 'in_progress' }), /不能更换/)
  assert.equal(calls.length, 0)
})

test('unchanged environment retains its historical snapshot even after configuration removal', async () => {
  const { db, calls } = client()
  const snapshot = { ...legacy, test_environment_id: '2', status: 'completed' }
  assert.deepEqual(await resolvePlanEnvironment(db, 7, 2, snapshot), snapshot)
  assert.equal(calls.length, 0)
})

test('environment lookup is scoped and locks the assignment as well as its configuration', async () => {
  const { db, calls } = client()
  await assert.rejects(resolvePlanEnvironment(db, 7, 2), /未分配/)
  assert.deepEqual(calls[0][1], [7, 2])
  assert.match(String(calls[0][0]), /for share of a, e/)
})

test('configured environment names and URLs become independent encrypted snapshots', async () => {
  const name = encryptText('Staging')
  const accessUrl = encryptText('https://staging.example.com')
  const { db } = client([{ id: '2', name, access_url: accessUrl }])
  const snapshot = await resolvePlanEnvironment(db, 7, 2)
  assert.equal(snapshot.test_environment_id, '2')
  assert.equal(decryptText(snapshot.environment), 'Staging')
  assert.equal(decryptText(snapshot.environment_access_url), 'https://staging.example.com')
  assert.ok(isEncryptedText(snapshot.environment_access_url))
  assert.notEqual(snapshot.environment, name)
})
