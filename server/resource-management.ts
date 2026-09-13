import type { PoolClient } from 'pg'

export type ManagedResource = {
  ownerUserId: number
  organizationId: number | null
}

/** Call inside the mutation transaction; role removal must wait for this lock. */
export async function lockOrganizationResourceManager(
  client: Pick<PoolClient, 'query'>,
  organizationId: number,
  userId: number,
) {
  const result = await client.query(
    `select membership.user_id
     from organization_memberships membership
     join user_roles role on role.user_id = membership.user_id
       and role.role = 'organization_admin'
     where membership.organization_id = $1 and membership.user_id = $2
       and membership.status = 'active' and membership.access_role in ('owner', 'admin')
     for share of membership, role`,
    [organizationId, userId],
  )
  return Boolean(result.rows[0])
}

/** This grants resource administration, never business-content owner access. */
export async function lockResourceManager(
  client: Pick<PoolClient, 'query'>,
  kind: 'project' | 'test-space',
  resourceId: number,
  userId: number,
  targetOrganizationId?: number | null,
): Promise<ManagedResource | null> {
  if (!Number.isSafeInteger(resourceId) || resourceId <= 0) return null
  const resourceSql = kind === 'project'
    ? 'select user_id as owner_user_id, organization_id from projects where id = $1'
    : 'select owner_user_id, organization_id from test_spaces where id = $1'
  const snapshot = await client.query<{ organization_id: string | null }>(resourceSql, [resourceId])
  if (!snapshot.rows[0]) return null
  const organizationIds = [...new Set([snapshot.rows[0].organization_id, targetOrganizationId]
    .filter((id) => id != null).map(Number))].sort((a, b) => a - b)
  if (organizationIds.length) {
    await client.query('select id from organizations where id = any($1::bigint[]) order by id for share', [organizationIds])
  }
  if (kind === 'project') {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`ai-project:${resourceId}`])
  }
  const result = await client.query<{ owner_user_id: string; organization_id: string | null }>(
    `${resourceSql} for update`,
    [resourceId],
  )
  const row = result.rows[0]
  if (!row || row.organization_id !== snapshot.rows[0].organization_id) return null
  const resource = {
    ownerUserId: Number(row.owner_user_id),
    organizationId: row.organization_id === null ? null : Number(row.organization_id),
  }
  if (resource.ownerUserId === userId) return resource
  return resource.organizationId !== null
    && await lockOrganizationResourceManager(client, resource.organizationId, userId)
    ? resource
    : null
}
