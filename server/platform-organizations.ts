import type { PoolClient } from 'pg'
import { blindIndex, decryptText, encryptText } from './crypto.ts'
import { pool, query } from './db.ts'
import { normalizeOrganizationName } from './organization-policy.ts'
import {
  hasVerifiedFeishuIdentity,
  lockPlatformAdministration,
  requirePlatformAdminWithClient,
} from './platform-admins.ts'
import { platformMutationDigest } from './platform-config-store.ts'
import {
  lockOrganizationModuleCatalog,
  lockOrganizationModuleProjects,
} from './project-modules.ts'

export type OrganizationDeletionBlocker = {
  count: number
  type: string
}

export class PlatformOrganizationError extends Error {
  readonly blockers?: OrganizationDeletionBlocker[]
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 409, blockers?: OrganizationDeletionBlocker[]) {
    super(message)
    this.name = 'PlatformOrganizationError'
    this.blockers = blockers
    this.code = code
    this.status = status
  }
}

async function organizationBlockers(client: PoolClient, organizationId: number, ownerUserId: number) {
  const result = await client.query<{ blocker_type: string; count: string }>(
    `select blocker_type, count(*)::text as count
       from (
         select 'members' as blocker_type from organization_memberships
          where organization_id = $1
            and not (user_id = $2 and access_role = 'owner' and status = 'active')
         union all select 'projects' from projects where organization_id = $1
         union all select 'testSpaces' from test_spaces where organization_id = $1
         union all select 'invitations' from organization_invitations where organization_id = $1
         union all select 'inviteLinks' from organization_invite_links where organization_id = $1
         union all select 'weeklyReports' from organization_weekly_reports where organization_id = $1
         union all select 'weeklySummaries' from organization_weekly_summaries where organization_id = $1
         union all select 'weeklyReminders' from organization_weekly_report_reminders where organization_id = $1
         union all select 'projectModules' from organization_project_modules where organization_id = $1
         union all select 'testEnvironments' from test_environments where organization_id = $1
         union all select 'featureSettings' from organization_feature_settings where organization_id = $1
         union all select 'packageChannelPolicies' from organization_package_market_channel_policies where organization_id = $1
         union all select 'packageSelections' from organization_package_market_selections where organization_id = $1
         union all select 'packageSelectionPolicies' from organization_package_market_selection_policies where organization_id = $1
         union all select 'packageSelectionRules' from organization_package_market_selection_rules where organization_id = $1
         union all select 'packageRuleOverrides' from organization_package_market_rule_overrides where organization_id = $1
         union all select 'projectTransfers' from project_transfer_requests where organization_id = $1
         union all select 'testSpaceTransfers' from test_space_transfer_requests where organization_id = $1
         union all select 'offboardingTransfers' from account_offboarding_asset_transfers where organization_id = $1
       ) blockers
      group by blocker_type
      order by blocker_type`,
    [organizationId, ownerUserId],
  )
  return result.rows.map((row) => ({ count: Number(row.count), type: row.blocker_type }))
}

async function organizationCounts(organizationId: number) {
  const result = await query<{
    member_count: string
    project_count: string
    test_space_count: string
  }>(
    `select
       (select count(*) from organization_memberships where organization_id = $1)::text as member_count,
       (select count(*) from projects where organization_id = $1)::text as project_count,
       (select count(*) from test_spaces where organization_id = $1)::text as test_space_count`,
    [organizationId],
  )
  return {
    memberCount: Number(result.rows[0]?.member_count ?? 0),
    projectCount: Number(result.rows[0]?.project_count ?? 0),
    testSpaceCount: Number(result.rows[0]?.test_space_count ?? 0),
  }
}

export async function checkPlatformOrganizationDeletion(organizationId: number) {
  const client = await pool.connect()
  try {
    await client.query('begin read only')
    const organization = await client.query<{
      id: string
      name: string
      owner_user_id: string
    }>(
      `select id, name, owner_user_id from organizations where id = $1`,
      [organizationId],
    )
    const row = organization.rows[0]
    if (!row) throw new PlatformOrganizationError('ORGANIZATION_NOT_FOUND', '组织不存在。', 404)
    const blockers = await organizationBlockers(client, organizationId, Number(row.owner_user_id))
    await client.query('commit')
    return {
      blockers,
      canDelete: blockers.length === 0,
      checkedAt: new Date().toISOString(),
      id: organizationId,
      name: decryptText(row.name),
    }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function listPlatformOrganizations(input: {
  page: number
  pageSize: number
  search: string
}) {
  const result = await query<{
    id: string
    name: string
    owner_display_name: string
    owner_email: string
    owner_user_id: string
  }>(
    `select organization.id, organization.name, organization.owner_user_id,
            owner.email as owner_email, owner.display_name as owner_display_name
       from organizations organization
       join users owner on owner.id = organization.owner_user_id
      order by organization.id desc`,
  )
  const search = input.search.trim().toLocaleLowerCase('zh-CN')
  const matching = result.rows.filter((row) => {
    if (!search) return true
    return decryptText(row.name).toLocaleLowerCase('zh-CN').includes(search) ||
      (row.owner_display_name || row.owner_email).toLocaleLowerCase('zh-CN').includes(search)
  })
  const start = (input.page - 1) * input.pageSize
  const selected = matching.slice(start, start + input.pageSize)
  const organizations = await Promise.all(selected.map(async (row) => {
    const id = Number(row.id)
    const [deletion, counts] = await Promise.all([
      checkPlatformOrganizationDeletion(id),
      organizationCounts(id),
    ])
    return {
      ...counts,
      blockers: deletion.blockers,
      canDelete: deletion.canDelete,
      checkedAt: deletion.checkedAt,
      id,
      name: decryptText(row.name),
      owner: {
        displayName: row.owner_display_name || row.owner_email,
        id: Number(row.owner_user_id),
        username: row.owner_email,
      },
    }
  }))
  return { organizations, page: input.page, pageSize: input.pageSize, total: matching.length }
}

export async function createPlatformOrganization(input: {
  actorUserId: number
  name: unknown
  ownerUserId: number
  requestId: string
}) {
  const name = normalizeOrganizationName(input.name)
  if (!name) throw new PlatformOrganizationError('ORGANIZATION_NAME_INVALID', '请输入有效的组织名称。', 400)
  const digest = platformMutationDigest({ name, ownerUserId: input.ownerUserId })
  const client = await pool.connect()
  try {
    await client.query('begin')
    await lockPlatformAdministration(client)
    await requirePlatformAdminWithClient(client, input.actorUserId)
    const receipt = await client.query<{ request_digest: string; result_encrypted: string }>(
      `select request_digest, result_encrypted
         from platform_organization_mutation_receipts
        where actor_user_id = $1 and request_id = $2::uuid for update`,
      [input.actorUserId, input.requestId],
    )
    if (receipt.rows[0]) {
      if (receipt.rows[0].request_digest !== digest) {
        throw new PlatformOrganizationError('REQUEST_ID_CONFLICT', '该请求编号已用于其他组织操作。')
      }
      await client.query('commit')
      return JSON.parse(decryptText(receipt.rows[0].result_encrypted)) as { id: number; name: string }
    }
    const owner = await client.query<{
      account_status: string
      feishu_identity_verified_at: Date | null
      feishu_user_id: string
      is_builtin_admin: boolean
      registration_source: 'builtin' | 'feishu' | 'legacy_unknown'
    }>(
      `select account_status, feishu_user_id, feishu_identity_verified_at, is_builtin_admin, registration_source
         from users where id = $1 for update`,
      [input.ownerUserId],
    )
    const ownerRow = owner.rows[0]
    if (!ownerRow || ownerRow.account_status !== 'active' || (!ownerRow.is_builtin_admin &&
      !hasVerifiedFeishuIdentity({
        feishuUserId: ownerRow.feishu_user_id,
        registrationSource: ownerRow.registration_source,
        verifiedAt: ownerRow.feishu_identity_verified_at,
      }))) throw new PlatformOrganizationError('ORGANIZATION_OWNER_INELIGIBLE', '所有者必须是有效的飞书用户或内置 admin。')
    const created = await client.query<{ id: string }>(
      `insert into organizations (owner_user_id, name, name_lookup, created_by_user_id)
       values ($1, $2, $3, $4) returning id`,
      [input.ownerUserId, encryptText(name), blindIndex(name), input.actorUserId],
    )
    const organizationId = Number(created.rows[0].id)
    await client.query(
      `insert into user_roles (user_id, role) values ($1, 'organization_admin')
       on conflict (user_id, role) do nothing`,
      [input.ownerUserId],
    )
    await client.query(
      `insert into platform_user_permission_versions (user_id, revision, updated_at)
       values ($1, 1, now())
       on conflict (user_id) do update
         set revision = platform_user_permission_versions.revision + 1, updated_at = now()`,
      [input.ownerUserId],
    )
    await client.query(
      `insert into organization_memberships
        (organization_id, user_id, access_role, status, weekly_report_required, invited_by_user_id)
       values ($1, $2, 'owner', 'active', $3, $4)`,
      [organizationId, input.ownerUserId, !ownerRow.is_builtin_admin, input.actorUserId],
    )
    await client.query(
      `insert into organization_audit_events
        (organization_id, original_organization_id, organization_name_snapshot,
         actor_user_id, action, subject_type, subject_id, detail)
       values ($1, $1, $2, $3, 'organization.created', 'organization', $1::text, $2)`,
      [organizationId, encryptText(name), input.actorUserId],
    )
    const result = { id: organizationId, name }
    await client.query(
      `insert into platform_organization_mutation_receipts
        (actor_user_id, request_id, action, organization_id, request_digest, result_encrypted)
       values ($1, $2::uuid, 'create', $3, $4, $5)`,
      [input.actorUserId, input.requestId, organizationId, digest, encryptText(JSON.stringify(result))],
    )
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    if (!(error instanceof PlatformOrganizationError) &&
      error && typeof error === 'object' && 'code' in error && String(error.code) === '23505') {
      throw new PlatformOrganizationError('ORGANIZATION_NAME_CONFLICT', '组织名称已存在。', 409)
    }
    throw error
  } finally {
    client.release()
  }
}

export async function deletePlatformOrganization(input: {
  actorUserId: number
  confirmationName: unknown
  organizationId: number
  requestId: string
}) {
  const confirmationName = normalizeOrganizationName(input.confirmationName)
  const digest = platformMutationDigest({ confirmationName, organizationId: input.organizationId })
  const client = await pool.connect()
  try {
    await client.query('begin')
    await lockPlatformAdministration(client)
    await requirePlatformAdminWithClient(client, input.actorUserId)
    const receipt = await client.query<{ request_digest: string; result_encrypted: string }>(
      `select request_digest, result_encrypted
         from platform_organization_mutation_receipts
        where actor_user_id = $1 and request_id = $2::uuid for update`,
      [input.actorUserId, input.requestId],
    )
    if (receipt.rows[0]) {
      if (receipt.rows[0].request_digest !== digest) {
        throw new PlatformOrganizationError('REQUEST_ID_CONFLICT', '该请求编号已用于其他组织操作。')
      }
      await client.query('commit')
      return JSON.parse(decryptText(receipt.rows[0].result_encrypted)) as { deleted: true; id: number }
    }
    await lockOrganizationModuleCatalog(client, input.organizationId)
    await lockOrganizationModuleProjects(client, input.organizationId)
    const organization = await client.query<{ name: string; owner_user_id: string }>(
      `select name, owner_user_id from organizations where id = $1 for update`,
      [input.organizationId],
    )
    const row = organization.rows[0]
    if (!row) throw new PlatformOrganizationError('ORGANIZATION_NOT_FOUND', '组织不存在。', 404)
    const name = decryptText(row.name)
    if (confirmationName !== name) {
      throw new PlatformOrganizationError('ORGANIZATION_CONFIRMATION_MISMATCH', '请输入完整组织名称确认删除。', 400)
    }
    const blockers = await organizationBlockers(client, input.organizationId, Number(row.owner_user_id))
    if (blockers.length > 0) {
      throw new PlatformOrganizationError('ORGANIZATION_NOT_EMPTY', '组织仍有数据，不能删除。', 409, blockers)
    }
    const result = { deleted: true as const, id: input.organizationId }
    await client.query(
      `insert into platform_organization_mutation_receipts
        (actor_user_id, request_id, action, organization_id, request_digest, result_encrypted)
       values ($1, $2::uuid, 'delete', $3, $4, $5)`,
      [input.actorUserId, input.requestId, input.organizationId, digest, encryptText(JSON.stringify(result))],
    )
    await client.query(
      `insert into organization_audit_events
        (organization_id, original_organization_id, organization_name_snapshot,
         actor_user_id, action, subject_type, subject_id, detail)
       values ($1, $1, $2, $3, 'organization.deleted', 'organization', $1::text, '')`,
      [input.organizationId, row.name, input.actorUserId],
    )
    await client.query(
      `delete from organization_memberships
        where organization_id = $1 and user_id = $2
          and access_role = 'owner' and status = 'active'`,
      [input.organizationId, Number(row.owner_user_id)],
    )
    await client.query('delete from organizations where id = $1', [input.organizationId])
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
