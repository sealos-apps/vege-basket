import assert from 'node:assert/strict'
import test from 'node:test'
import { pool } from './db.ts'
import { getMyWork } from './my-work.ts'

function row(index: number) {
  return {
    kind: 'todo', source_id: String(index + 1), project_id: '1', organization_id: '1',
    project_name: 'Project', context_name: null, context_version_label: null,
    creator_name: index < 500 ? 'First creator' : 'Later creator', can_complete: false,
    title: index < 500 ? 'Earlier item' : 'Search target', status: 'assigned', priority: 'medium',
    offboarding_transferred_from_name: null, due_at: null, updated_at: new Date('2026-09-22'), relation: 'assignee',
  }
}

test('reads beyond 500 rows in bounded batches and releases the read-only snapshot', async (t) => {
  const statements: string[] = []
  let offset = 0
  let released = false
  t.mock.method(pool, 'connect', async () => ({
    query: async (sql: string, params?: unknown[]) => {
      statements.push(sql)
      if (sql.startsWith('declare')) {
        assert.deepEqual(params, [7, 'all', null, 'due_desc', null, 1])
        return { rows: [] }
      }
      if (sql.startsWith('FETCH')) {
        const rows = Array.from({ length: Math.min(200, 625 - offset) }, (_, index) => row(offset + index))
        offset += rows.length
        return { rows }
      }
      return { rows: [] }
    },
    release: () => { released = true },
  }))
  const page = await getMyWork(7, 1, { q: 'Search target', status: 'all', limit: 20, cursor: '20' })
  assert.equal(page.total, 125)
  assert.equal(page.offset, 20)
  assert.equal(page.items.length, 20)
  assert.equal(page.items[0].sourceId, 521)
  assert.equal(page.nextCursor, '40')
  assert.deepEqual(page.filterOptions.creators, ['Later creator'])
  assert.equal(statements[0], 'BEGIN READ ONLY')
  assert.equal(statements.at(-1), 'COMMIT')
  assert.equal(statements.filter((sql) => sql === 'FETCH FORWARD 200 FROM my_work_rows').length, 5)
  assert.equal(released, true)
})

test('rolls back and releases a failed read without returning a partial page', async (t) => {
  const statements: string[] = []
  let released = false
  t.mock.method(pool, 'connect', async () => ({
    query: async (sql: string) => {
      statements.push(sql)
      if (sql.startsWith('FETCH')) throw new Error('read failed')
      return { rows: [] }
    },
    release: () => { released = true },
  }))
  await assert.rejects(getMyWork(7, null, {}), /read failed/)
  assert.equal(statements.at(-1), 'ROLLBACK')
  assert.equal(statements.includes('COMMIT'), false)
  assert.equal(released, true)
})

test('discards a connection when rollback fails and preserves the original read error', async (t) => {
  let discarded = false
  t.mock.method(pool, 'connect', async () => ({
    query: async (sql: string) => {
      if (sql.startsWith('FETCH')) throw new Error('original read failure')
      if (sql === 'ROLLBACK') throw new Error('connection lost')
      return { rows: [] }
    },
    release: (destroy: boolean) => { discarded = destroy },
  }))
  await assert.rejects(getMyWork(7, null, {}), /original read failure/)
  assert.equal(discarded, true)
})
