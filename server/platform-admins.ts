import type { PoolClient } from 'pg'
import { pool, query } from './db.ts'
import { encryptText, keyedDigest } from './crypto.ts'

type AssignableRole = 'developer' | 'tester' | 'organization_admin'
type RegistrationSource = 'builtin' | 'feishu' | 'legacy_unknown'

export const platformAdministrationLockKey = 'veges:platform-administration'

export function hasVerifiedFeishuIdentity(input: {
  feishuUserId: string
  registrationSource: RegistrationSource
  verifiedAt: Date | null
}) {
  if (!input.feishuUserId.startsWith('ou_')) return false
  return Boolean(input.verifiedAt) || input.registrationSource === 'legacy_unknown'
}

export class PlatformAdminError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 409) {
    super(message)
    this.name = 'PlatformAdminError'
    this.code = code
    this.status = status
  }
}

export async function lockPlatformAdministration(client: PoolClient) {
  await client.query(
    'select pg_advisory_xact_lock(hashtextextended($1::text, 0))',
    [platformAdministrationLockKey],
  )
}

export async function isPlatformAdmin(userId: number) {
  const result = await query<{ allowed: boolean }>(
    `select exists(
       select 1 from platform_admin_grants grant_row
       join users on users.id = grant_row.user_id
       where grant_row.user_id = $1 and users.account_status = 'active'
     ) as allowed`,
    [userId],
  )
  return result.rows[0]?.allowed === true
}

export async function requirePlatformAdminWithClient(client: PoolClient, userId: number) {
  const result = await client.query<{ allowed: boolean }>(
    `select exists(
       select 1 from platform_admin_grants grant_row
       join users on users.id = grant_row.user_id
       where grant_row.user_id = $1 and users.account_status = 'active'
     ) as allowed`,
    [userId],
  )
  if (!result.rows[0]?.allowed) {
    throw new PlatformAdminError('PLATFORM_ADMIN_REQUIRED', '需要超级管理员权限。', 403)
  }
}

export async function listPlatformAdmins() {
  const result = await query<{
    account_status: string
    display_name: string
    email: string
    grant_kind: 'builtin' | 'managed'
    granted_at: Date
    id: string
    source: string
  }>(
    `select users.id, users.email, users.display_name, users.account_status,
            grant_row.grant_kind, grant_row.source, grant_row.granted_at
       from platform_admin_grants grant_row
       join users on users.id = grant_row.user_id
      order by grant_row.grant_kind, lower(coalesce(nullif(users.display_name, ''), users.email)), users.id`,
  )
  return result.rows.map((row) => ({
    accountStatus: row.account_status,
    canRevoke: row.grant_kind !== 'builtin',
    displayName: row.display_name || row.email,
    grantKind: row.grant_kind,
    grantedAt: row.granted_at.toISOString(),
    id: Number(row.id),
    source: row.source,
    username: row.email,
  }))
}

export async function setManagedPlatformAdmin(input: {
  actorUserId: number
  enabled: boolean
  expectedVersion: number
  requestId: string
  targetUserId: number
}) {
  const digest = keyedDigest(JSON.stringify({
    enabled: input.enabled,
    expectedVersion: input.expectedVersion,
    targetUserId: input.targetUserId,
  }))
  const client = await pool.connect()
  try {
    await client.query('begin')
    await lockPlatformAdministration(client)
    await requirePlatformAdminWithClient(client, input.actorUserId)
    const receipt = await client.query<{
      action: string
      request_digest: string
      result_revision: string
      target_user_id: string
    }>(
      `select action, request_digest, result_revision, target_user_id
         from platform_user_mutation_receipts
        where actor_user_id = $1 and request_id = $2::uuid for update`,
      [input.actorUserId, input.requestId],
    )
    if (receipt.rows[0]) {
      if (
        receipt.rows[0].action !== 'platform-admin' ||
        receipt.rows[0].request_digest !== digest ||
        Number(receipt.rows[0].target_user_id) !== input.targetUserId
      ) {
        throw new PlatformAdminError('REQUEST_ID_CONFLICT', '该请求编号已用于其他权限变更。')
      }
      await client.query('commit')
      return {
        enabled: input.enabled,
        replayed: true,
        version: Number(receipt.rows[0].result_revision),
      }
    }
    const target = await client.query<{
      account_status: string
      feishu_identity_verified_at: Date | null
      feishu_user_id: string
      is_builtin_admin: boolean
      registration_source: RegistrationSource
      revision: string
    }>(
      `select users.account_status, users.feishu_user_id,
              users.feishu_identity_verified_at, users.is_builtin_admin, users.registration_source,
              coalesce(version.revision, 0)::text as revision
         from users
         left join platform_user_permission_versions version on version.user_id = users.id
        where users.id = $1
        for update of users`,
      [input.targetUserId],
    )
    const row = target.rows[0]
    if (!row) throw new PlatformAdminError('USER_NOT_FOUND', '用户不存在。', 404)
    if (Number(row.revision) !== input.expectedVersion) {
      throw new PlatformAdminError('USER_PERMISSION_VERSION_CONFLICT', '用户权限已更新，请刷新后重试。')
    }
    if (row.is_builtin_admin && !input.enabled) {
      throw new PlatformAdminError('BUILTIN_ADMIN_PROTECTED', '内置 admin 的超级管理员权限不可移除。')
    }
    if (input.enabled && !row.is_builtin_admin && (
      row.account_status !== 'active' || !hasVerifiedFeishuIdentity({
        feishuUserId: row.feishu_user_id,
        registrationSource: row.registration_source,
        verifiedAt: row.feishu_identity_verified_at,
      })
    )) {
      throw new PlatformAdminError('PLATFORM_ADMIN_TARGET_INELIGIBLE', '只能授权已核实飞书身份的有效用户。')
    }
    if (input.enabled) {
      await client.query(
        `insert into platform_admin_grants
          (user_id, grant_kind, source, granted_by_user_id)
         values ($1, 'managed', 'platform', $2)
         on conflict (user_id) do nothing`,
        [input.targetUserId, input.actorUserId],
      )
    } else {
      await client.query(
        `delete from platform_admin_grants where user_id = $1 and grant_kind = 'managed'`,
        [input.targetUserId],
      )
    }
    const version = await client.query<{ revision: string }>(
      `insert into platform_user_permission_versions (user_id, revision, updated_at)
       values ($1, 1, now())
       on conflict (user_id) do update
         set revision = platform_user_permission_versions.revision + 1, updated_at = now()
       returning revision`,
      [input.targetUserId],
    )
    const response = { enabled: input.enabled, replayed: false, version: Number(version.rows[0].revision) }
    await client.query(
      `insert into platform_user_mutation_receipts
        (actor_user_id, request_id, action, target_user_id, request_digest, result_revision, result_encrypted)
       values ($1, $2::uuid, 'platform-admin', $3, $4, $5, $6)`,
      [
        input.actorUserId,
        input.requestId,
        input.targetUserId,
        digest,
        version.rows[0].revision,
        encryptText(JSON.stringify(response)),
      ],
    )
    await client.query(
      `insert into platform_audit_events
        (actor_user_id, action, target_type, target_id, changed_fields, request_id)
       values ($1, $2, 'user', $3::text, array['platformAdmin'], $4::uuid)`,
      [
        input.actorUserId,
        input.enabled ? 'platform_admin.granted' : 'platform_admin.revoked',
        input.targetUserId,
        input.requestId,
      ],
    )
    await client.query('commit')
    return response
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function updateManagedUserPermissions(input: {
  actorUserId: number
  expectedVersion: number
  platformAdmin: boolean
  requestId: string
  roles: AssignableRole[]
  targetUserId: number
}) {
  const roles = [...new Set(input.roles)].sort()
  const digest = keyedDigest(JSON.stringify({
    expectedVersion: input.expectedVersion,
    platformAdmin: input.platformAdmin,
    roles,
    targetUserId: input.targetUserId,
  }))
  const client = await pool.connect()
  try {
    await client.query('begin')
    await lockPlatformAdministration(client)
    await requirePlatformAdminWithClient(client, input.actorUserId)
    const receipt = await client.query<{
      action: string
      request_digest: string
      result_revision: string
      target_user_id: string
    }>(
      `select action, request_digest, result_revision, target_user_id
         from platform_user_mutation_receipts
        where actor_user_id = $1 and request_id = $2::uuid for update`,
      [input.actorUserId, input.requestId],
    )
    if (receipt.rows[0]) {
      if (
        receipt.rows[0].action !== 'permissions' ||
        receipt.rows[0].request_digest !== digest ||
        Number(receipt.rows[0].target_user_id) !== input.targetUserId
      ) {
        throw new PlatformAdminError('REQUEST_ID_CONFLICT', '该请求编号已用于其他权限变更。')
      }
      await client.query('commit')
      return { platformAdmin: input.platformAdmin, replayed: true, roles, version: Number(receipt.rows[0].result_revision) }
    }

    const target = await client.query<{
      account_status: string
      feishu_identity_verified_at: Date | null
      feishu_user_id: string
      grant_kind: 'builtin' | 'managed' | null
      is_builtin_admin: boolean
      registration_source: RegistrationSource
      revision: string
    }>(
      `select users.account_status, users.feishu_user_id,
              users.feishu_identity_verified_at, users.is_builtin_admin, users.registration_source,
              grant_row.grant_kind, coalesce(version.revision, 0)::text as revision
         from users
         left join platform_admin_grants grant_row on grant_row.user_id = users.id
         left join platform_user_permission_versions version on version.user_id = users.id
        where users.id = $1 for update of users`,
      [input.targetUserId],
    )
    const row = target.rows[0]
    if (!row) throw new PlatformAdminError('USER_NOT_FOUND', '用户不存在。', 404)
    if (Number(row.revision) !== input.expectedVersion) {
      throw new PlatformAdminError('USER_PERMISSION_VERSION_CONFLICT', '用户权限已更新，请刷新后重试。')
    }
    if (row.is_builtin_admin && !input.platformAdmin) {
      throw new PlatformAdminError('BUILTIN_ADMIN_PROTECTED', '内置 admin 的超级管理员权限不可移除。')
    }
    if (input.platformAdmin && !row.is_builtin_admin && (
      row.account_status !== 'active' || !hasVerifiedFeishuIdentity({
        feishuUserId: row.feishu_user_id,
        registrationSource: row.registration_source,
        verifiedAt: row.feishu_identity_verified_at,
      })
    )) {
      throw new PlatformAdminError('PLATFORM_ADMIN_TARGET_INELIGIBLE', '只能授权已核实飞书身份的有效用户。')
    }

    await client.query('delete from user_roles where user_id = $1', [input.targetUserId])
    for (const role of roles) {
      await client.query('insert into user_roles (user_id, role) values ($1, $2)', [input.targetUserId, role])
    }
    const switchableRoles = roles.includes('organization_admin')
      ? ['developer', 'tester']
      : roles.filter((role): role is 'developer' | 'tester' => role !== 'organization_admin')
    await client.query(
      `update sessions set active_role = $1 where user_id = $2 and active_role <> all($3::text[])`,
      [switchableRoles[0] ?? 'developer', input.targetUserId, switchableRoles],
    )

    if (input.platformAdmin && !row.grant_kind) {
      await client.query(
        `insert into platform_admin_grants
          (user_id, grant_kind, source, granted_by_user_id)
         values ($1, 'managed', 'platform', $2)`,
        [input.targetUserId, input.actorUserId],
      )
    } else if (!input.platformAdmin && row.grant_kind === 'managed') {
      await client.query(
        `delete from platform_admin_grants where user_id = $1 and grant_kind = 'managed'`,
        [input.targetUserId],
      )
    }

    const version = Number((await client.query<{ revision: string }>(
      `insert into platform_user_permission_versions (user_id, revision, updated_at)
       values ($1, 1, now())
       on conflict (user_id) do update
         set revision = platform_user_permission_versions.revision + 1, updated_at = now()
       returning revision`,
      [input.targetUserId],
    )).rows[0].revision)
    const response = { platformAdmin: input.platformAdmin, replayed: false, roles, version }
    await client.query(
      `insert into platform_user_mutation_receipts
        (actor_user_id, request_id, action, target_user_id, request_digest, result_revision, result_encrypted)
       values ($1, $2::uuid, 'permissions', $3, $4, $5, $6)`,
      [input.actorUserId, input.requestId, input.targetUserId, digest, version, encryptText(JSON.stringify(response))],
    )
    await client.query(
      `insert into platform_audit_events
        (actor_user_id, action, target_type, target_id, changed_fields, request_id)
       values ($1, 'user.permissions_updated', 'user', $2::text, array['roles', 'platformAdmin'], $3::uuid)`,
      [input.actorUserId, input.targetUserId, input.requestId],
    )
    await client.query('commit')
    return response
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
