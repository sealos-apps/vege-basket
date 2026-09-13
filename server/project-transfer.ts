import type { PoolClient } from 'pg'
import { lockResourceManager } from './resource-management.ts'

/** Read the immutable project ID before locking the project and then the request. */
export async function lockTransferProject(client: Pick<PoolClient, 'query'>, transferId: number) {
  const result = await client.query<{ project_id: string; organization_id: string | null }>(
    `select transfer.project_id, project.organization_id
     from project_transfer_requests transfer join projects project on project.id = transfer.project_id
     where transfer.id = $1`, [transferId],
  )
  const snapshot = result.rows[0]
  if (!snapshot) return false
  if (snapshot.organization_id !== null) {
    await client.query('select id from organizations where id = $1 for share', [snapshot.organization_id])
  }
  await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`ai-project:${snapshot.project_id}`])
  const project = await client.query<{ organization_id: string | null }>(
    'select organization_id from projects where id = $1 for update', [snapshot.project_id],
  )
  return Boolean(project.rows[0] && project.rows[0].organization_id === snapshot.organization_id)
}

export async function canCompleteProjectTransfer(
  client: Pick<PoolClient, 'query'>,
  transfer: { projectId: number; organizationId: number; requestedByUserId: number; previousOwnerUserId: number },
) {
  const access = await lockResourceManager(client, 'project', transfer.projectId, transfer.requestedByUserId)
  return Boolean(access && access.ownerUserId === transfer.previousOwnerUserId
    && (transfer.requestedByUserId === transfer.previousOwnerUserId
      || access.organizationId === transfer.organizationId))
}
