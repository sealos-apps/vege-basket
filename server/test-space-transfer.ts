import type { PoolClient } from 'pg'
import { lockResourceManager } from './resource-management.ts'

export class TestSpaceTransferError extends Error {
  readonly status: number
  constructor(message: string, status = 409) {
    super(message)
    this.status = status
  }
}
function failure(message: string, status = 409): never {
  throw new TestSpaceTransferError(message, status)
}
async function lockRecipient(
  client: PoolClient,
  spaceId: number,
  userId: number,
  organizationId: number | null,
) {
  if (organizationId !== null) {
    const org = await client.query(
      `select user_id from organization_memberships where organization_id=$1 and user_id=$2 and status='active' for share`,
      [organizationId, userId],
    )
    if (!org.rows[0]) failure('接收人必须仍是当前组织成员。')
  }
  const member = await client.query(
    `select m.user_id from test_space_memberships m join users u on u.id=m.user_id
    join user_roles role on role.user_id=u.id and role.role in ('tester','organization_admin')
    where m.test_space_id=$1 and m.user_id=$2 and m.status='active' and u.account_status='active' for share of m,u,role`,
    [spaceId, userId],
  )
  if (!member.rows[0]) failure('只能转移给当前测试空间已加入的成员。')
}
export async function requestTestSpaceOwnership(
  client: PoolClient,
  spaceId: number,
  requesterId: number,
  targetId: number,
) {
  const resource = await lockResourceManager(
    client,
    'test-space',
    spaceId,
    requesterId,
  )
  if (!resource) failure('无权管理此测试空间。', 404)
  if (resource.ownerUserId === targetId)
    failure('接收人已经是空间所有者。', 400)
  await lockRecipient(client, spaceId, targetId, resource.organizationId)
  await client.query(
    `update test_space_transfer_requests set status='cancelled', responded_at=now() where test_space_id=$1 and status='pending'`,
    [spaceId],
  )
  const result = await client.query<{ id: string }>(
    `insert into test_space_transfer_requests
    (test_space_id,organization_id,requested_by_user_id,previous_owner_user_id,target_user_id)
    values($1,$2,$3,$4,$5) returning id`,
    [
      spaceId,
      resource.organizationId,
      requesterId,
      resource.ownerUserId,
      targetId,
    ],
  )
  return Number(result.rows[0].id)
}
export async function respondTestSpaceOwnership(
  client: PoolClient,
  transferId: number,
  userId: number,
  action: 'accept' | 'decline',
) {
  const snapshot = await client.query<{
    test_space_id: string
    organization_id: string | null
    requested_by_user_id: string
  }>(
    `select test_space_id,organization_id,requested_by_user_id from test_space_transfer_requests where id=$1 and target_user_id=$2`,
    [transferId, userId],
  )
  const initial = snapshot.rows[0]
  if (!initial) failure('转移申请不存在。', 404)
  // This locks current organization then space and revalidates the initiator.
  const resource = await lockResourceManager(
    client,
    'test-space',
    Number(initial.test_space_id),
    Number(initial.requested_by_user_id),
  )
  const result = await client.query<{
    previous_owner_user_id: string
    organization_id: string | null
    status: string
    valid: boolean
  }>(
    `select previous_owner_user_id,organization_id,status,expires_at>clock_timestamp() as valid from test_space_transfer_requests where id=$1 and target_user_id=$2 for update`,
    [transferId, userId],
  )
  const transfer = result.rows[0]
  if (!transfer || transfer.status !== 'pending' || !transfer.valid)
    failure('转移申请已处理或已过期。')
  if (action === 'accept') {
    if (
      !resource ||
      resource.ownerUserId !== Number(transfer.previous_owner_user_id) ||
      resource.organizationId !==
        (transfer.organization_id === null
          ? null
          : Number(transfer.organization_id))
    )
      failure('所有者、组织归属或发起人权限已变化，请重新发起转移。')
    await lockRecipient(
      client,
      Number(initial.test_space_id),
      userId,
      resource.organizationId,
    )
    await client.query(
      `update test_space_memberships set access_level='editor' where test_space_id=$1 and user_id=$2`,
      [initial.test_space_id, resource.ownerUserId],
    )
    await client.query(
      `update test_space_memberships set access_level='owner' where test_space_id=$1 and user_id=$2 and status='active'`,
      [initial.test_space_id, userId],
    )
    await client.query(
      `update test_spaces set owner_user_id=$1,updated_at=now() where id=$2`,
      [userId, initial.test_space_id],
    )
    await client.query(
      `update test_space_invite_links set revoked_at=now() where test_space_id=$1 and revoked_at is null`,
      [initial.test_space_id],
    )
  }
  await client.query(
    `update test_space_transfer_requests set status=$1,responded_at=now() where id=$2`,
    [action === 'accept' ? 'accepted' : 'declined', transferId],
  )
}
