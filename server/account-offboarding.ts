import type { PoolClient } from 'pg'
import { decryptText, encryptText, keyedDigest } from './crypto.ts'
import { pool, query } from './db.ts'
import type { UserAccountStatus } from '../shared/user-lifecycle.ts'
import { formatTestSpaceReference } from '../shared/test-space-reference.ts'
import { lockPlatformAdministration, requirePlatformAdminWithClient } from './platform-admins.ts'

export type OffboardingAdmin = {
  displayName: string
  id: number
  username: string
}

export type OffboardingPreview = {
  user: {
    accountStatus: UserAccountStatus
    displayName: string
    id: number
    username: string
  }
  organizations: Array<{
    admins: OffboardingAdmin[]
    bugCount: number
    id: number
    name: string
    ownedProjects: Array<{ id: number; name: string }>
    ownedTestSpaces: Array<{ id: number; name: string }>
    openTodoCount: number
  }>
}

export type OffboardingSelection = {
  organizationId: number
  targetAdminUserId: number
}

export type AccountOffboardingNotificationEvent = {
  notificationId: number
  recipientUserId: number
}

type AccountOffboardingNotificationOrganization = {
  bugCount: number
  name: string
  projectNames: string[]
  testSpaceNames: string[]
  transferredTodoCount: number
}

let accountOffboardingNotificationHandler: ((event: AccountOffboardingNotificationEvent) => void) | undefined

export function configureAccountOffboardingNotifications(
  handler: (event: AccountOffboardingNotificationEvent) => void,
) {
  accountOffboardingNotificationHandler = handler
}

export type OffboardingResult = {
  accountStatus: 'departed'
  bugCount: number
  offboardingId: string
  organizations: Array<{
    bugCount: number
    id: number
    openTodoCount: number
    transferredTodoCount: number
    unassignedTodoCount: number
    transferredProjectCount: number
    transferredTestSpaceCount: number
  }>
  permissionVersion: number
  replayed: boolean
}

function positiveId(value: unknown) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function operationError(message: string, status = 409) {
  return Object.assign(new Error(message), { status })
}

async function lockProject(client: PoolClient, projectId: number) {
  await client.query(
    'select pg_advisory_xact_lock(hashtextextended($1::text, 0))',
    [`ai-project:${projectId}`],
  )
}

async function insertTodoActivity(
  client: PoolClient,
  actorUserId: number,
  assigneeUserId: number | null,
  todo: { due_date: Date; id: string; priority: string; project_id: string; title: string },
) {
  await client.query(
    `insert into todo_activity_events
      (project_id, todo_id, actor_user_id, assignee_user_id, event_type, title, due_date, priority)
     values ($1, $2, $3, $4, 'assigned', $5, $6, $7)`,
    [
      todo.project_id,
      todo.id,
      actorUserId,
      assigneeUserId,
      encryptText(todo.title),
      todo.due_date,
      todo.priority,
    ],
  )
}

export async function getOffboardingPreview(userId: number): Promise<OffboardingPreview | null> {
  const user = await query<{
    account_status: UserAccountStatus
    display_name: string
    email: string
    id: string
  }>(
    'select id, email, display_name, account_status from users where id = $1',
    [userId],
  )
  const userRow = user.rows[0]
  if (!userRow) return null

  const memberships = await query<{ id: string; name: string }>(
    `select organization.id, organization.name
     from organization_memberships membership
     join organizations organization on organization.id = membership.organization_id
     where membership.user_id = $1 and membership.status = 'active'
     order by organization.id`,
    [userId],
  )

  const organizations = await Promise.all(memberships.rows.map(async (membership) => {
    const organizationId = Number(membership.id)
    const [admins, ownedProjects, ownedTestSpaces, todos, bugs] = await Promise.all([
      query<{ display_name: string; email: string; id: string }>(
        `select u.id, u.email, u.display_name
         from organization_memberships membership
         join users u on u.id = membership.user_id
         join user_roles role on role.user_id = u.id and role.role = 'organization_admin'
         where membership.organization_id = $1
           and membership.status = 'active'
         and u.account_status = 'active'
           and u.id <> $2
         group by u.id, u.email, u.display_name
         order by lower(coalesce(nullif(u.display_name, ''), u.email)), u.id`,
        [organizationId, userId],
      ),
      query<{ id: string; name: string }>(
        `select id, name from projects
         where organization_id = $1 and user_id = $2
         order by id`,
        [organizationId, userId],
      ),
      query<{ id: string; name: string }>(
        `select id, name from test_spaces
         where organization_id = $1 and owner_user_id = $2
         order by id`,
        [organizationId, userId],
      ),
      query<{ count: string }>(
        `select count(*)::text as count
         from todos t join projects p on p.id = t.project_id
         where p.organization_id = $1 and t.assignee_user_id = $2 and t.done = false`,
        [organizationId, userId],
      ),
      query<{ count: string }>(
        `select count(*)::text as count
         from test_bugs bug join test_spaces space on space.id = bug.test_space_id
         where space.organization_id = $1
           and bug.assignee_user_id = $2
           and bug.status not in ('closed', 'rejected')`,
        [organizationId, userId],
      ),
    ])
    return {
      admins: admins.rows.map((row) => ({
        displayName: row.display_name || row.email,
        id: Number(row.id),
        username: row.email,
      })),
      bugCount: Number(bugs.rows[0]?.count ?? 0),
      id: organizationId,
      name: decryptText(membership.name),
      ownedProjects: ownedProjects.rows.map((row) => ({ id: Number(row.id), name: decryptText(row.name) })),
      ownedTestSpaces: ownedTestSpaces.rows.map((row) => ({ id: Number(row.id), name: decryptText(row.name) })),
      openTodoCount: Number(todos.rows[0]?.count ?? 0),
    }
  }))

  return {
    user: {
      accountStatus: userRow.account_status,
      displayName: userRow.display_name || userRow.email,
      id: Number(userRow.id),
      username: userRow.email,
    },
    organizations,
  }
}

export async function offboardUser(input: {
  actorUserId: number
  expectedVersion: number
  requestId: string
  selections: OffboardingSelection[]
  userId: number
}): Promise<OffboardingResult> {
  const { actorUserId, expectedVersion, requestId, selections, userId } = input
  if (userId === actorUserId) throw operationError('Super administrator cannot offboard the current account', 400)
  const normalizedSelections = new Map<number, number>()
  for (const selection of selections) {
    const organizationId = positiveId(selection.organizationId)
    const targetAdminUserId = positiveId(selection.targetAdminUserId)
    if (!organizationId || !targetAdminUserId || targetAdminUserId === userId) {
      throw operationError('Every organization must have a valid receiving administrator', 400)
    }
    if (normalizedSelections.has(organizationId)) {
      throw operationError('Each organization can only have one receiving administrator', 400)
    }
    normalizedSelections.set(organizationId, targetAdminUserId)
  }
  const requestDigest = keyedDigest(JSON.stringify({
    expectedVersion,
    selections: [...normalizedSelections.entries()].sort(([left], [right]) => left - right),
    userId,
  }))

  const client = await pool.connect()
  try {
    await client.query('begin')
    await lockPlatformAdministration(client)
    await requirePlatformAdminWithClient(client, actorUserId)
    const receipt = await client.query<{
      action: string
      request_digest: string
      result_encrypted: string | null
      target_user_id: string
    }>(
      `select action, request_digest, result_encrypted, target_user_id
         from platform_user_mutation_receipts
        where actor_user_id = $1 and request_id = $2::uuid for update`,
      [actorUserId, requestId],
    )
    if (receipt.rows[0]) {
      if (
        receipt.rows[0].action !== 'offboard' ||
        receipt.rows[0].request_digest !== requestDigest ||
        Number(receipt.rows[0].target_user_id) !== userId
      ) {
        throw operationError('该请求编号已用于其他用户操作。')
      }
      if (!receipt.rows[0].result_encrypted) throw operationError('用户操作回执不完整。', 500)
      const result = JSON.parse(decryptText(receipt.rows[0].result_encrypted)) as OffboardingResult
      await client.query('commit')
      return { ...result, replayed: true }
    }
    const lockedUser = await client.query<{
      account_status: UserAccountStatus
      display_name: string
      email: string
      is_builtin_admin: boolean
      revision: string
    }>(
      `select users.email, users.display_name, users.account_status, users.is_builtin_admin,
              coalesce(version.revision, 0)::text as revision
         from users
         left join platform_user_permission_versions version on version.user_id = users.id
        where users.id = $1 for update of users`,
      [userId],
    )
    if (!lockedUser.rows[0]) throw operationError('User not found', 404)
    if (lockedUser.rows[0].is_builtin_admin) {
      throw operationError('内置 admin 不可办理离职。')
    }
    if (Number(lockedUser.rows[0].revision) !== expectedVersion) {
      throw operationError('用户权限已更新，请刷新后重试。')
    }
    if (lockedUser.rows[0].account_status === 'departed') {
      throw operationError('This account has already completed offboarding')
    }
    const departedUserName = lockedUser.rows[0].display_name || lockedUser.rows[0].email

    const activeMemberships = await client.query<{ id: string; name: string }>(
      `select organization.id, organization.name
       from organization_memberships membership
       join organizations organization on organization.id = membership.organization_id
       where membership.user_id = $1 and membership.status = 'active'
       order by organization.id
       for update of membership, organization`,
      [userId],
    )
    const activeOrganizationIds = activeMemberships.rows.map((row) => Number(row.id))
    if (activeOrganizationIds.length !== normalizedSelections.size ||
      activeOrganizationIds.some((id) => !normalizedSelections.has(id))) {
      throw operationError('Organization membership changed. Refresh the offboarding preview and try again')
    }

    for (const organizationId of activeOrganizationIds) {
      const targetAdminUserId = normalizedSelections.get(organizationId)!
      const target = await client.query<{ id: string }>(
        `select u.id
         from users u
         join user_roles role on role.user_id = u.id and role.role = 'organization_admin'
         join organization_memberships membership
           on membership.user_id = u.id
          and membership.organization_id = $1
          and membership.status = 'active'
         where u.id = $2 and u.account_status = 'active'
         limit 1
         for update of u, role, membership`,
        [organizationId, targetAdminUserId],
      )
      if (!target.rows[0]) throw operationError('Selected receiving administrator is no longer eligible')
    }

    const offboarding = await client.query<{ id: string }>(
      `insert into account_offboarding_records (user_id, actor_user_id, organization_targets)
       values ($1, $2, $3::jsonb)
       returning id`,
      [userId, actorUserId, JSON.stringify(Object.fromEntries(normalizedSelections))],
    )
    const offboardingId = offboarding.rows[0].id
    const organizationResults: OffboardingResult['organizations'] = []
    const notificationOrganizationsByRecipient = new Map<number, AccountOffboardingNotificationOrganization[]>()
    let totalBugs = 0

    for (const organizationId of activeOrganizationIds) {
      const targetAdminUserId = normalizedSelections.get(organizationId)!
      let transferredProjectCount = 0
      let transferredTestSpaceCount = 0
      let transferredTodoCount = 0
      let unassignedTodoCount = 0

      const organization = await client.query<{ owner_user_id: string }>(
        `select owner_user_id from organizations where id = $1 for update`,
        [organizationId],
      )
      if (!organization.rows[0]) throw operationError('Organization not found')
      if (Number(organization.rows[0].owner_user_id) === userId) {
        await client.query(
          `update organizations set owner_user_id = $1, updated_at = now() where id = $2`,
          [targetAdminUserId, organizationId],
        )
        await client.query(
          `update organization_memberships
           set access_role = 'owner'
           where organization_id = $1 and user_id = $2 and status = 'active'`,
          [organizationId, targetAdminUserId],
        )
      }

      const projects = await client.query<{ id: string; name: string }>(
        `select id, name from projects where organization_id = $1 and user_id = $2 order by id for update`,
        [organizationId, userId],
      )
      for (const project of projects.rows) {
        const projectId = Number(project.id)
        await lockProject(client, projectId)
        await client.query(
          `update projects set user_id = $1, updated_at = now() where id = $2 and user_id = $3`,
          [targetAdminUserId, projectId, userId],
        )
        await client.query(
          `update project_memberships set owner_user_id = $1 where project_id = $2`,
          [targetAdminUserId, projectId],
        )
        await client.query(
          `insert into account_offboarding_asset_transfers
            (offboarding_id, organization_id, asset_type, asset_id, previous_owner_user_id, next_owner_user_id, action)
           values ($1, $2, 'project', $3, $4, $5, 'transferred')`,
          [offboardingId, organizationId, projectId, userId, targetAdminUserId],
        )
        transferredProjectCount += 1
      }

      const spaces = await client.query<{ id: string; name: string; version_label: string | null }>(
        `select id, name, version_label from test_spaces where organization_id = $1 and owner_user_id = $2 order by id for update`,
        [organizationId, userId],
      )
      for (const space of spaces.rows) {
        const spaceId = Number(space.id)
        await client.query(
          `update test_spaces set owner_user_id = $1, updated_at = now() where id = $2 and owner_user_id = $3`,
          [targetAdminUserId, spaceId, userId],
        )
        await client.query(
          `update test_space_invite_links set owner_user_id = $1 where test_space_id = $2`,
          [targetAdminUserId, spaceId],
        )
        await client.query(
          `insert into test_space_memberships
            (test_space_id, user_id, access_level, status, invited_by_user_id, accepted_at)
           values ($1, $2, 'owner', 'active', $2, now())
           on conflict (test_space_id, user_id) do update
             set access_level = 'owner', status = 'active', accepted_at = now(), declined_at = null`,
          [spaceId, targetAdminUserId],
        )
        await client.query(
          `insert into account_offboarding_asset_transfers
            (offboarding_id, organization_id, asset_type, asset_id, previous_owner_user_id, next_owner_user_id, action)
           values ($1, $2, 'test_space', $3, $4, $5, 'transferred')`,
          [offboardingId, organizationId, spaceId, userId, targetAdminUserId],
        )
        transferredTestSpaceCount += 1
      }

      const projectRows = await client.query<{ id: string }>(
        `select id from projects where organization_id = $1 order by id for update`,
        [organizationId],
      )
      for (const project of projectRows.rows) {
        const projectId = Number(project.id)
        await lockProject(client, projectId)
        const eligible = await client.query<{ allowed: boolean }>(
          `select exists(
             select 1 from projects where id = $1 and user_id = $2
             union all
             select 1 from project_memberships
              where project_id = $1 and invited_user_id = $2 and status = 'active'
           ) as allowed`,
          [projectId, targetAdminUserId],
        )
        const todos = await client.query<{
          due_date: Date
          id: string
          priority: string
          project_id: string
          title: string
        }>(
          `select id, project_id, title, due_date, priority
           from todos
           where project_id = $1 and assignee_user_id = $2 and done = false
           order by id for update`,
          [projectId, userId],
        )
        for (const todo of todos.rows) {
          if (eligible.rows[0]?.allowed) {
            await client.query(
              `update todos
               set assignee_user_id = $1, assigned_by_user_id = $2, assigned_at = now(), updated_at = now()
               where id = $3`,
              [targetAdminUserId, actorUserId, todo.id],
            )
            await insertTodoActivity(client, actorUserId, targetAdminUserId, todo)
            await client.query(
              `insert into account_offboarding_asset_transfers
                (offboarding_id, organization_id, asset_type, asset_id, previous_assignee_user_id, next_assignee_user_id, action)
               values ($1, $2, 'todo', $3, $4, $5, 'transferred')`,
              [offboardingId, organizationId, todo.id, userId, targetAdminUserId],
            )
            transferredTodoCount += 1
          } else {
            await client.query(
              `update todos
               set assignee_user_id = null, assigned_by_user_id = null, assigned_at = null, updated_at = now()
               where id = $1`,
              [todo.id],
            )
            await insertTodoActivity(client, actorUserId, null, todo)
            await client.query(
              `insert into account_offboarding_asset_transfers
                (offboarding_id, organization_id, asset_type, asset_id, previous_assignee_user_id, action)
               values ($1, $2, 'todo', $3, $4, 'unassigned')`,
              [offboardingId, organizationId, todo.id, userId],
            )
            unassignedTodoCount += 1
          }
        }
        await client.query(
          `delete from todo_watchers
           where user_id = $1 and todo_id in (select id from todos where project_id = $2)`,
          [userId, projectId],
        )
        await client.query(
          `update todos set watcher_user_id = null, watched_by_user_id = null, watched_at = null
           where project_id = $1 and watcher_user_id = $2`,
          [projectId, userId],
        )
        await client.query(
          `update todos set reviewer_user_id = null where project_id = $1 and reviewer_user_id = $2`,
          [projectId, userId],
        )
        await client.query(
          `update project_package_events
           set assignee_user_id = null, assigned_by_user_id = null, assigned_at = null
           where project_id = $1 and assignee_user_id = $2`,
          [projectId, userId],
        )
        await client.query(
          `delete from project_memberships where project_id = $1 and invited_user_id = $2`,
          [projectId, userId],
        )
      }

      const bugs = await client.query<{
        assignee_user_id: string
        id: string
        status: string
        test_space_id: string
      }>(
        `select bug.id, bug.assignee_user_id, bug.status, bug.test_space_id
         from test_bugs bug
         join test_spaces space on space.id = bug.test_space_id
         where space.organization_id = $1
           and bug.assignee_user_id = $2
           and bug.status not in ('closed', 'rejected')
         order by bug.id for update of bug`,
        [organizationId, userId],
      )
      for (const bug of bugs.rows) {
        await client.query(
          `update test_bugs set assignee_user_id = $1, status = 'pending_confirmation', updated_at = now() where id = $2`,
          [targetAdminUserId, bug.id],
        )
        await client.query(
          `insert into test_bug_events
            (test_bug_id, event_type, actor_user_id, previous_status, next_status, assignee_user_id, transfer_source)
           values ($1, 'transferred', $2, $3, 'pending_confirmation', $4, 'offboarding')`,
          [bug.id, actorUserId, bug.status, targetAdminUserId],
        )
        await client.query(
          `insert into test_bug_events
            (test_bug_id, event_type, actor_user_id, previous_status, next_status)
           values ($1, 'status_changed', $2, $3, 'pending_confirmation')`,
          [bug.id, actorUserId, bug.status],
        )
        await client.query(
          `insert into test_bug_comments (test_bug_id, author_user_id, content, kind)
           values ($1, $2, $3, 'transfer')`,
          [bug.id, actorUserId, encryptText(`该 Bug 已因成员 ${departedUserName} 离职转移给组织管理员。`)],
        )
        await client.query(
          `insert into account_offboarding_asset_transfers
            (offboarding_id, organization_id, asset_type, asset_id, previous_assignee_user_id, next_assignee_user_id, action)
           values ($1, $2, 'test_bug', $3, $4, $5, 'transferred')`,
          [offboardingId, organizationId, bug.id, userId, targetAdminUserId],
        )
        totalBugs += 1
      }

      await client.query(
        `delete from test_space_memberships
         where user_id = $1 and test_space_id in (select id from test_spaces where organization_id = $2)`,
        [userId, organizationId],
      )
      await client.query(
        `update organization_memberships set status = 'removed', removed_at = now()
         where organization_id = $1 and user_id = $2 and status = 'active'`,
        [organizationId, userId],
      )
      await client.query(
        `insert into organization_audit_events
          (organization_id, actor_user_id, action, subject_type, subject_id, detail)
         values ($1, $2, 'member.departed', 'user', $3, $4)`,
        [organizationId, actorUserId, String(userId), encryptText(JSON.stringify({ targetAdminUserId }))],
      )
      organizationResults.push({
        bugCount: bugs.rows.length,
        id: organizationId,
        openTodoCount: transferredTodoCount + unassignedTodoCount,
        transferredTodoCount,
        unassignedTodoCount,
        transferredProjectCount,
        transferredTestSpaceCount,
      })
      const notificationOrganizations = notificationOrganizationsByRecipient.get(targetAdminUserId) ?? []
      notificationOrganizations.push({
        bugCount: bugs.rows.length,
        name: decryptText(activeMemberships.rows.find((membership) => Number(membership.id) === organizationId)!.name),
        projectNames: projects.rows.map((project) => decryptText(project.name)),
        testSpaceNames: spaces.rows.map((space) => formatTestSpaceReference(
          decryptText(space.name),
          space.version_label ? decryptText(space.version_label) : undefined,
        )),
        transferredTodoCount,
      })
      notificationOrganizationsByRecipient.set(targetAdminUserId, notificationOrganizations)
    }

    await client.query(
      `delete from platform_admin_grants where user_id = $1 and grant_kind = 'managed'`,
      [userId],
    )
    const permissionVersion = Number((await client.query<{ revision: string }>(
      `insert into platform_user_permission_versions (user_id, revision, updated_at)
       values ($1, 1, now())
       on conflict (user_id) do update
         set revision = platform_user_permission_versions.revision + 1, updated_at = now()
       returning revision`,
      [userId],
    )).rows[0].revision)
    await client.query(
      `update users
       set account_status = 'departed', departed_at = now(), departed_by_user_id = $1,
           disabled_at = coalesce(disabled_at, now()), disabled_by_user_id = coalesce(disabled_by_user_id, $1)
       where id = $2`,
      [actorUserId, userId],
    )
    await client.query('delete from sessions where user_id = $1', [userId])
    await client.query(
      `update account_offboarding_records set summary = $1::jsonb where id = $2`,
      [JSON.stringify({ organizations: organizationResults, bugCount: totalBugs }), offboardingId],
    )
    const notificationIds: AccountOffboardingNotificationEvent[] = []
    for (const [recipientUserId, organizations] of notificationOrganizationsByRecipient) {
      const notification = await client.query<{ id: string }>(
        `insert into account_offboarding_notifications
          (offboarding_id, recipient_user_id, summary)
         values ($1, $2, $3)
         returning id`,
        [offboardingId, recipientUserId, encryptText(JSON.stringify({ departedUserName, organizations }))],
      )
      notificationIds.push({ notificationId: Number(notification.rows[0].id), recipientUserId })
    }
    const result: OffboardingResult = {
      accountStatus: 'departed',
      bugCount: totalBugs,
      offboardingId,
      organizations: organizationResults,
      permissionVersion,
      replayed: false,
    }
    await client.query(
      `insert into platform_user_mutation_receipts
        (actor_user_id, request_id, action, target_user_id, request_digest, result_revision, result_encrypted)
       values ($1, $2::uuid, 'offboard', $3, $4, $5, $6)`,
      [actorUserId, requestId, userId, requestDigest, permissionVersion, encryptText(JSON.stringify(result))],
    )
    await client.query(
      `insert into platform_audit_events
        (actor_user_id, action, target_type, target_id, changed_fields, request_id)
       values ($1, 'user.offboarded', 'user', $2::text,
               array['accountStatus', 'platformAdmin', 'memberships'], $3::uuid)`,
      [actorUserId, userId, requestId],
    )
    await client.query('commit')
    for (const event of notificationIds) accountOffboardingNotificationHandler?.(event)
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function updateManagedAccountStatus(input: {
  actorUserId: number
  expectedVersion: number
  requestId: string
  status: 'active' | 'disabled'
  userId: number
}) {
  const requestDigest = keyedDigest(JSON.stringify({
    expectedVersion: input.expectedVersion,
    status: input.status,
    userId: input.userId,
  }))
  const client = await pool.connect()
  try {
    await client.query('begin')
    await lockPlatformAdministration(client)
    await requirePlatformAdminWithClient(client, input.actorUserId)
    const receipt = await client.query<{
      action: string
      request_digest: string
      result_encrypted: string | null
      target_user_id: string
    }>(
      `select action, request_digest, result_encrypted, target_user_id
         from platform_user_mutation_receipts
        where actor_user_id = $1 and request_id = $2::uuid for update`,
      [input.actorUserId, input.requestId],
    )
    if (receipt.rows[0]) {
      if (
        receipt.rows[0].action !== 'status' ||
        receipt.rows[0].request_digest !== requestDigest ||
        Number(receipt.rows[0].target_user_id) !== input.userId
      ) {
        throw operationError('该请求编号已用于其他用户操作。')
      }
      if (!receipt.rows[0].result_encrypted) throw operationError('用户操作回执不完整。', 500)
      const replayed = JSON.parse(decryptText(receipt.rows[0].result_encrypted)) as {
        accountStatus: UserAccountStatus
        permissionVersion: number
      }
      await client.query('commit')
      return { ...replayed, replayed: true }
    }
    const target = await client.query<{
      account_status: UserAccountStatus
      is_builtin_admin: boolean
      revision: string
    }>(
      `select users.account_status, users.is_builtin_admin,
              coalesce(version.revision, 0)::text as revision
         from users
         left join platform_user_permission_versions version on version.user_id = users.id
        where users.id = $1 for update of users`,
      [input.userId],
    )
    if (!target.rows[0] || target.rows[0].account_status === 'departed') {
      throw operationError('User not found or has already departed', 404)
    }
    if (target.rows[0].is_builtin_admin) throw operationError('内置 admin 不可禁用。')
    if (Number(target.rows[0].revision) !== input.expectedVersion) {
      throw operationError('用户权限已更新，请刷新后重试。')
    }
    const result = await client.query<{ account_status: UserAccountStatus }>(
      `update users
       set account_status = $1::text,
           disabled_at = case when $1::text = 'disabled' then coalesce(disabled_at, now()) else null::timestamptz end,
           disabled_by_user_id = case when $1::text = 'disabled' then $2::bigint else null::bigint end
       where id = $3::bigint
       returning account_status`,
      [input.status, input.actorUserId, input.userId],
    )
    if (input.status === 'disabled') {
      await client.query('delete from sessions where user_id = $1', [input.userId])
    }
    const permissionVersion = Number((await client.query<{ revision: string }>(
      `insert into platform_user_permission_versions (user_id, revision, updated_at)
       values ($1, 1, now())
       on conflict (user_id) do update
         set revision = platform_user_permission_versions.revision + 1, updated_at = now()
       returning revision`,
      [input.userId],
    )).rows[0].revision)
    const response = { accountStatus: result.rows[0].account_status, permissionVersion, replayed: false }
    await client.query(
      `insert into platform_user_mutation_receipts
        (actor_user_id, request_id, action, target_user_id, request_digest, result_revision, result_encrypted)
       values ($1, $2::uuid, 'status', $3, $4, $5, $6)`,
      [
        input.actorUserId,
        input.requestId,
        input.userId,
        requestDigest,
        permissionVersion,
        encryptText(JSON.stringify(response)),
      ],
    )
    await client.query(
      `insert into platform_audit_events
        (actor_user_id, action, target_type, target_id, changed_fields, request_id)
       values ($1, $2, 'user', $3::text, array['accountStatus'], $4::uuid)`,
      [
        input.actorUserId,
        input.status === 'active' ? 'user.enabled' : 'user.disabled',
        input.userId,
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
