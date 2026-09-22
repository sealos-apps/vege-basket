import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import express from 'express'
import { pool } from './db.ts'
import { testWorkbenchRouter } from './test-workbench.ts'

// Exercise the real HTTP guards with a fully stubbed pool: no PostgreSQL connection or writes.
test('discovery assessment HTTP guards reject invalid and unauthorized mutations before writing', async (t) => {
  let actorId = 42
  let activeRole = 'tester'
  let editor = true
  let lockedReporterId = '42'
  let lockedDifficulty = 'medium'
  let lockedReason = ''
  const statements: string[] = []
  const query = async (sql: string) => {
    const statement = sql.replace(/\s+/gu, ' ').trim()
    statements.push(statement)
    let rows: unknown[] = []
    if (statement.includes('from sessions s')) {
      rows = [{ user_id: String(actorId), active_role: activeRole, email: 'tester@example.invalid', account_status: 'active' }]
    } else if (statement.startsWith('select exists( select 1 from user_roles')) {
      rows = [{ assigned: true }]
    } else if (statement.includes("coalesce(m.access_level, 'viewer')")) {
      rows = [{ access_level: editor ? 'editor' : 'viewer' }]
    } else if (statement.startsWith('select access_level from test_space_memberships')) {
      rows = editor ? [{ access_level: 'editor' }] : []
    } else if (statement.startsWith('select id from test_spaces')) {
      rows = [{ id: '7' }]
    } else if (statement.includes('from test_bugs where')) {
      const locked = statement.endsWith('for update')
      rows = [{
        reporter_user_id: locked ? lockedReporterId : '42', assignee_user_id: null,
        discovery_difficulty: locked ? lockedDifficulty : 'medium',
        discovery_difficulty_reason: locked ? lockedReason : '',
        title: 'Example', severity: 'major', priority: 'medium', status: 'new',
        environment: '', reproduction_steps: '', expected_result: '', actual_result: '',
        test_case_id: null, test_subject_id: null, organization_module_id: null,
        test_plan_id: null, test_plan_case_id: null, test_environment_id: null,
      }]
    } else if (!['begin', 'rollback', 'commit'].includes(statement)) {
      throw new Error(`Unexpected query in guard test: ${statement}`)
    }
    return { rows, rowCount: rows.length }
  }
  t.mock.method(pool, 'query', query)
  t.mock.method(pool, 'connect', async () => ({ query, release() {} }))
  const app = express()
  app.use(express.json())
  app.use('/api', testWorkbenchRouter)
  const server = app.listen(0, '127.0.0.1')
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}/api/test-spaces/7/bugs`
  const request = async (method: 'POST' | 'PATCH', body: unknown, authenticated = true) => {
    statements.length = 0
    const response = await fetch(`${base}${method === 'PATCH' ? '/8' : ''}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer fixture-only' } : {}) },
      body: JSON.stringify(body),
    })
    await response.json()
    assert.equal(statements.some(statement => /^(insert|update|delete) /iu.test(statement)), false)
    return { status: response.status }
  }

  await t.test('create rejects missing, fourth, null and high-without-evidence inputs', async () => {
    for (const input of [{}, { discoveryDifficulty: 'pending' }, { discoveryDifficulty: null }, { discoveryDifficulty: 'high' }]) {
      assert.equal((await request('POST', { title: 'Example', ...input })).status, 400)
      assert.equal(statements.includes('begin'), false)
    }
  })
  await t.test('authentication and tester/editor permissions remain required', async () => {
    assert.equal((await request('POST', { title: 'Example', discoveryDifficulty: 'low' }, false)).status, 401)
    activeRole = 'developer'
    assert.equal((await request('PATCH', { discoveryDifficulty: 'low' })).status, 403)
    activeRole = 'tester'
    editor = false
    assert.equal((await request('PATCH', { discoveryDifficulty: 'low' })).status, 403)
    editor = true
  })
  await t.test('both fields are creator-only, including reason-only edits', async () => {
    actorId = 99
    for (const input of [{ discoveryDifficulty: 'low' }, { discoveryDifficultyReason: 'change' }]) {
      assert.equal((await request('PATCH', input)).status, 403)
      assert.equal(statements.includes('begin'), false)
    }
    actorId = 42
  })
  await t.test('creator authority is checked again after taking the row lock', async () => {
    lockedReporterId = '99'
    assert.equal((await request('PATCH', { discoveryDifficulty: 'low' })).status, 403)
    assert.ok(statements.includes('rollback'))
    lockedReporterId = '42'
  })
  await t.test('high without evidence fails inside the transaction before the first write', async () => {
    assert.equal((await request('PATCH', { discoveryDifficulty: 'high' })).status, 400)
    assert.ok(statements.includes('rollback'))
    assert.ok(statements.some(statement => statement.includes('from test_bugs where') && statement.endsWith('for update')))
  })
  await t.test('reason-only edits validate the locked latest level, not the pre-lock snapshot', async () => {
    lockedDifficulty = 'high'
    lockedReason = 'Concurrent requests lose an update'
    assert.equal((await request('PATCH', { discoveryDifficultyReason: '  ' })).status, 400)
    assert.ok(statements.includes('rollback'))
  })
})
