import type { PoolClient } from 'pg'
import {
  lockOrganizationResourceManager,
  lockResourceManager,
} from './resource-management.ts'
import { encryptText } from './crypto.ts'

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

async function lockOrganizationRecipient(
  client: PoolClient,
  organizationId: number,
  userId: number,
) {
  const target = await client.query(
    `select membership.user_id
       from organization_memberships membership
       join users user_account
         on user_account.id = membership.user_id
        and user_account.account_status = 'active'
       join user_roles role
         on role.user_id = membership.user_id
        and role.role in ('tester', 'organization_admin')
      where membership.organization_id = $1
        and membership.user_id = $2
        and membership.status = 'active'
      for share of membership, user_account, role`,
    [organizationId, userId],
  )
  if (!target.rows[0]) {
    failure('新所有者必须是具有测试空间资格的当前组织成员。')
  }
}

async function applyTestSpaceOwnership(
  client: PoolClient,
  spaceId: number,
  previousOwnerId: number,
  targetId: number,
  actorUserId: number,
) {
  const previousOwner = await client.query(
    `update test_space_memberships
        set access_level = 'editor'
      where test_space_id = $1 and user_id = $2
        and status = 'active' and access_level = 'owner'
      returning user_id`,
    [spaceId, previousOwnerId],
  )
  if (!previousOwner.rows[0]) {
    failure('当前所有者的空间成员资格已变化，请刷新后重试。')
  }
  await client.query(
    `insert into test_space_memberships
      (test_space_id, user_id, access_level, status, invited_by_user_id, accepted_at, declined_at)
     values ($1, $2, 'owner', 'active', $3, now(), null)
     on conflict (test_space_id, user_id) do update
       set access_level = 'owner', status = 'active',
           invited_by_user_id = excluded.invited_by_user_id,
           accepted_at = now(), declined_at = null`,
    [spaceId, targetId, actorUserId],
  )
  const space = await client.query(
    `update test_spaces set owner_user_id = $1, updated_at = now()
      where id = $2 and owner_user_id = $3
      returning id`,
    [targetId, spaceId, previousOwnerId],
  )
  if (!space.rows[0]) failure('测试空间所有者已变化，请刷新后重试。')
  await client.query(
    `update test_space_invite_links
        set revoked_at = now()
      where test_space_id = $1 and revoked_at is null`,
    [spaceId],
  )
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

/** Organization management transfers immediately after one explicit administrator confirmation. */
export async function transferOrganizationTestSpaceOwnership(
  client: PoolClient,
  organizationId: number,
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
  if (!resource || resource.organizationId !== organizationId) {
    failure('组织测试空间不存在。', 404)
  }
  if (!await lockOrganizationResourceManager(client, organizationId, requesterId)) {
    failure('需要组织 Owner/Admin 身份及组织管理员角色。', 403)
  }
  if (resource.ownerUserId === targetId) {
    failure('新所有者已经是当前空间所有者。', 400)
  }
  await lockOrganizationRecipient(client, organizationId, targetId)
  await client.query(
    `update test_space_transfer_requests
        set status = 'cancelled', responded_at = now()
      where test_space_id = $1 and status = 'pending'`,
    [spaceId],
  )
  await applyTestSpaceOwnership(
    client,
    spaceId,
    resource.ownerUserId,
    targetId,
    requesterId,
  )
  await client.query(
    `insert into organization_audit_events
      (organization_id, actor_user_id, action, subject_type, subject_id, detail)
     values ($1, $2, 'test_space.transfer.direct', 'test_space', $3, $4)`,
    [
      organizationId,
      requesterId,
      String(spaceId),
      encryptText(JSON.stringify({ from: resource.ownerUserId, to: targetId })),
    ],
  )
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
    await applyTestSpaceOwnership(
      client,
      Number(initial.test_space_id),
      resource.ownerUserId,
      userId,
      Number(initial.requested_by_user_id),
    )
  }
  await client.query(
    `update test_space_transfer_requests set status=$1,responded_at=now() where id=$2`,
    [action === 'accept' ? 'accepted' : 'declined', transferId],
  )
}
