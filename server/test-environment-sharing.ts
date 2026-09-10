import type { PoolClient } from 'pg'

/** Bulk sync requires an exclusive organization lock. Space mutations pass their
 * locked space ID so concurrent moves cannot resurrect another space's old binding. */
export async function shareOrganizationTestEnvironments(
  client: Pick<PoolClient, 'query'>,
  organizationId: number,
  spaceId?: number,
) {
  await client.query(
    `insert into test_environment_spaces (test_environment_id, test_space_id)
     select environment.id, space.id
     from test_environments environment
     join test_spaces space on space.organization_id = environment.organization_id
     where environment.organization_id = $1 and ($2::bigint is null or space.id = $2::bigint)
     order by environment.id, space.id
     on conflict (test_environment_id, test_space_id) do nothing`,
    [organizationId, spaceId ?? null],
  )
}
