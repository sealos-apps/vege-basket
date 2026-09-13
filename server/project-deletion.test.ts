import assert from 'node:assert/strict'
import test from 'node:test'
import type { PoolClient, QueryResult } from 'pg'

import { deleteOwnedProjectWithAiCleanup } from './project-deletion.ts'

type ProjectDeletionClient = Pick<PoolClient, 'query'>

function queryResult<T extends Record<string, unknown>>(rows: T[] = []): QueryResult<T> {
  return {
    command: '',
    fields: [],
    oid: 0,
    rowCount: rows.length,
    rows,
  }
}

test('deletes pending AI proposal batches before deleting the owned project', async () => {
  const queries: Array<{ params: unknown[]; text: string }> = []
  const client = {
    query: async (text: string, params: unknown[] = []) => {
      queries.push({ params, text })
      return text.includes('select user_id as owner_user_id')
        ? queryResult([{ owner_user_id: '9', organization_id: null }])
        : text.includes('select id from projects') || text.includes('delete from projects')
          ? queryResult([{ id: '17' }])
        : queryResult()
    },
  } as unknown as ProjectDeletionClient

  assert.equal(await deleteOwnedProjectWithAiCleanup(client, 17, 9), true)
  assert.deepEqual(queries.map(({ text }) => text.trim().split(/\s+/u)[0]), [
    'begin',
    'select',
    'select',
    'select',
    'select',
    'delete',
    'select',
    'delete',
    'commit',
  ])
  assert.match(queries[1].text, /select user_id as owner_user_id/u)
  assert.match(queries[2].text, /pg_advisory_xact_lock/u)
  assert.match(queries[3].text, /for update/u)
  assert.match(queries[4].text, /ai_conversations/u)
  assert.match(queries[4].text, /for update/u)
  assert.match(queries[5].text, /b\.source_turn_id = t\.id/u)
  assert.match(queries[5].text, /c\.project_id = p\.id/u)
  assert.match(queries[5].text, /b\.status = 'pending'/u)
  assert.deepEqual(queries[5].params, [17])
  assert.match(queries[6].text, /for update/u)
  assert.match(queries[7].text, /delete from projects/u)
})

test('rolls back project deletion when pending proposal cleanup fails', async () => {
  const queries: string[] = []
  const client = {
    query: async (text: string) => {
      queries.push(text.trim())
      if (text.includes('delete from ai_todo_proposal_batches')) throw new Error('cleanup failed')
      if (text.includes('select user_id as owner_user_id')) {
        return queryResult([{ owner_user_id: '9', organization_id: null }])
      }
      return queryResult()
    },
  } as unknown as ProjectDeletionClient

  await assert.rejects(
    deleteOwnedProjectWithAiCleanup(client, 17, 9),
    /cleanup failed/u,
  )
  assert.equal(queries.at(-1), 'rollback')
})
