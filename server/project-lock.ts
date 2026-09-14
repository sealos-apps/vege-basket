import type { PoolClient } from 'pg'

export async function lockProjectMutation(
  client: Pick<PoolClient, 'query'>,
  projectId: number,
) {
  await client.query(
    'select pg_advisory_xact_lock(hashtextextended($1::text, 0))',
    [`ai-project:${projectId}`],
  )
}
