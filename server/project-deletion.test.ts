import assert from 'node:assert/strict'
import test from 'node:test'
import type { PoolClient, QueryResult } from 'pg'

import { deleteOwnedProjectWithAiCleanup } from './project-deletion.ts'

type ProjectDeletionClient = Pick<PoolClient, 'query'>

function queryResult(rows: Array<{ id?: string; owner_user_id?: string; organization_id?: null }> = []): QueryResult<{ id?: string; owner_user_id?: string; organization_id?: null }> {
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
      if (text.includes('select user_id as owner_user_id')) return queryResult([{ owner_user_id: '9', organization_id: null }])
      return text.includes('select id from projects') || text.includes('delete from projects')
        ? queryResult([{ id: '17' }])
        : queryResult()
    },
  } as unknown as ProjectDeletionClient

  assert.equal(await deleteOwnedProjectWithAiCleanup(client, 17, 9), true)
  assert.equal(queries[0].text, 'begin')
  assert.equal(queries.at(-1)?.text, 'commit')
  const cleanup = queries.findIndex(({ text }) => text.includes('delete from ai_todo_proposal_batches'))
  const deletion = queries.findIndex(({ text }) => text.includes('delete from projects'))
  assert.ok(cleanup > 0 && deletion > cleanup)
  assert.match(queries[cleanup].text, /b\.source_turn_id = t\.id/u)
  assert.match(queries[cleanup].text, /b\.status = 'pending'/u)
  assert.deepEqual(queries[cleanup].params, [17])
  assert.deepEqual(queries[deletion].params, [17, 9])

})

test('rolls back project deletion when pending proposal cleanup fails', async () => {
  const queries: string[] = []
  const client = {
    query: async (text: string) => {
      queries.push(text.trim())
      if (text.includes('delete from ai_todo_proposal_batches')) throw new Error('cleanup failed')
      if (text.includes('select user_id as owner_user_id')) return queryResult([{ owner_user_id: '9', organization_id: null }])
      if (text.includes('select id from projects')) return queryResult([{ id: '17' }])
      return queryResult()
    },
  } as unknown as ProjectDeletionClient

  await assert.rejects(
    deleteOwnedProjectWithAiCleanup(client, 17, 9),
    /cleanup failed/u,
  )
  assert.equal(queries.at(-1), 'rollback')
})
