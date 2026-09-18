import type express from 'express'
import { Router } from 'express'
import {
  getOffboardingPreview,
  offboardUser,
  updateManagedAccountStatus,
} from './account-offboarding.ts'
import { query } from './db.ts'
import {
  hasVerifiedFeishuIdentity,
  isPlatformAdmin,
  PlatformAdminError,
  updateManagedUserPermissions,
} from './platform-admins.ts'
import type { UserAccountStatus } from '../shared/user-lifecycle.ts'

export const userRoles = ['developer', 'tester', 'organization_admin'] as const
export type UserRole = (typeof userRoles)[number]
export const switchableUserRoles = ['developer', 'tester'] as const
export type SwitchableUserRole = (typeof switchableUserRoles)[number]

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

type SessionRoleRow = {
  account_status: UserAccountStatus
  active_role: UserRole
  email: string
  user_id: string
}

function getToken(request: express.Request) {
  const header = request.headers.authorization
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
}

export function isUserRole(value: unknown): value is UserRole {
  return userRoles.includes(value as UserRole)
}

export function isSwitchableUserRole(value: unknown): value is SwitchableUserRole {
  return switchableUserRoles.includes(value as SwitchableUserRole)
}

export function getSwitchableUserRoles(roles: readonly UserRole[]): SwitchableUserRole[] {
  if (roles.includes('organization_admin')) return [...switchableUserRoles]
  return switchableUserRoles.filter((role) => roles.includes(role))
}

export function canAssumeUserRole(roles: readonly UserRole[], role: SwitchableUserRole) {
  return roles.includes(role) || roles.includes('organization_admin')
}

export async function ensureDefaultUserRole(userId: number) {
  await query(
    `
    insert into user_roles (user_id, role)
    select $1, 'developer'
    where not exists (select 1 from user_roles where user_id = $1)
    on conflict do nothing
    `,
    [userId],
  )
}

export async function getUserRoleContext(userId: number, token: string) {
  await ensureDefaultUserRole(userId)
  const [rolesResult, sessionResult] = await Promise.all([
    query<{ role: UserRole }>('select role from user_roles where user_id = $1 order by role', [userId]),
    query<{ active_role: UserRole }>(
      'select active_role from sessions where token = $1 and user_id = $2 and expires_at > now()',
      [token, userId],
    ),
  ])
  const roles = rolesResult.rows.map((row) => row.role)
  const availableRoles = getSwitchableUserRoles(roles)
  const requestedActiveRole = sessionResult.rows[0]?.active_role
  const activeRole = isSwitchableUserRole(requestedActiveRole) && availableRoles.includes(requestedActiveRole)
    ? requestedActiveRole
    : availableRoles[0] ?? 'developer'
  if (requestedActiveRole !== activeRole && token) {
    await query('update sessions set active_role = $1 where token = $2 and user_id = $3', [activeRole, token, userId])
  }
  return {
    activeRole,
    isSystemAdmin: await isPlatformAdmin(userId),
    roles,
  }
}

export async function getAuthenticatedRoleSession(request: express.Request) {
  const token = getToken(request)
  if (!token) return null
  const result = await query<SessionRoleRow>(
    `
    select s.user_id, s.active_role, u.email, u.account_status
    from sessions s
    join users u on u.id = s.user_id
    where s.token = $1 and s.expires_at > now() and u.account_status = 'active'
    `,
    [token],
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    activeRole: row.active_role,
    token,
    userId: Number(row.user_id),
    username: row.email,
  }
}

export async function requirePlatformAdminSession(request: express.Request, response: express.Response) {
  const session = await getAuthenticatedRoleSession(request)
  if (!session) {
    response.status(401).json({ error: 'Unauthorized' })
    return null
  }
  if (!(await isPlatformAdmin(session.userId))) {
    response.status(403).json({ error: '需要超级管理员权限。', code: 'PLATFORM_ADMIN_REQUIRED' })
    return null
  }
  return session
}

export async function requireActiveRole(
  request: express.Request,
  response: express.Response,
  expectedRole: SwitchableUserRole,
) {
  const session = await getAuthenticatedRoleSession(request)
  if (!session) {
    response.status(401).json({ error: 'Unauthorized' })
    return null
  }
  const assigned = await query<{ assigned: boolean }>(
    `select exists(
      select 1 from user_roles
      where user_id = $1 and role in ($2, 'organization_admin')
    ) as assigned`,
    [session.userId, expectedRole],
  )
  if (session.activeRole !== expectedRole || !assigned.rows[0]?.assigned) {
    response.status(403).json({ error: `Active ${expectedRole} role is required` })
    return null
  }
  return session
}

/** Management screens do not change the session's business persona.
 * Resource handlers still perform their own ownership/organization authorization.
 */
export async function requireTestSpaceManagementSession(request: express.Request, response: express.Response) {
  const session = await getAuthenticatedRoleSession(request)
  if (!session) {
    response.status(401).json({ error: 'Unauthorized' })
    return null
  }
  const assigned = await query<{ allowed: boolean }>(
    `select exists(select 1 from user_roles where user_id = $1
      and (role = 'organization_admin' or (role = 'tester' and $2::text = 'tester'))) as allowed`,
    [session.userId, session.activeRole],
  )
  if (!assigned.rows[0]?.allowed) {
    response.status(403).json({ error: 'Test-space management role is required' })
    return null
  }
  return session
}

export const roleRouter = Router()

roleRouter.post('/auth/active-role', async (request, response, next) => {
  try {
    const session = await getAuthenticatedRoleSession(request)
    if (!session) {
      response.status(401).json({ error: 'Unauthorized' })
      return
    }
    const role = request.body.role
    if (!isSwitchableUserRole(role)) {
      response.status(400).json({ error: 'Invalid role' })
      return
    }
    const assigned = await query<{ assigned: boolean }>(
      `select exists(
        select 1 from user_roles
        where user_id = $1 and role in ($2, 'organization_admin')
      ) as assigned`,
      [session.userId, role],
    )
    if (!assigned.rows[0]?.assigned) {
      response.status(403).json({ error: 'Role is not assigned to this account' })
      return
    }
    await query('update sessions set active_role = $1 where token = $2 and user_id = $3', [
      role,
      session.token,
      session.userId,
    ])
    response.json({ activeRole: role })
  } catch (error) {
    next(error)
  }
})

roleRouter.get('/admin/users', async (request, response, next) => {
  try {
    const session = await getAuthenticatedRoleSession(request)
    if (!session) {
      response.status(401).json({ error: 'Unauthorized' })
      return
    }
    if (!(await isPlatformAdmin(session.userId))) {
      response.status(403).json({ error: 'System administrator access is required' })
      return
    }
    const result = await query<{
      display_name: string
      email: string
      id: string
      account_status: UserAccountStatus
      feishu_identity_verified_at: Date | null
      feishu_user_id: string
      grant_kind: 'builtin' | 'managed' | null
      is_builtin_admin: boolean
      permission_version: string
      registration_source: 'builtin' | 'feishu' | 'legacy_unknown'
      roles: UserRole[]
    }>(
      `
      select u.id, u.email, u.display_name, u.account_status,
        u.is_builtin_admin, u.registration_source, u.feishu_identity_verified_at, u.feishu_user_id,
        grant_row.grant_kind, coalesce(version.revision, 0)::text as permission_version,
        coalesce(array_agg(ur.role order by ur.role) filter (where ur.role is not null), '{}') as roles
      from users u
      left join user_roles ur on ur.user_id = u.id
      left join platform_admin_grants grant_row on grant_row.user_id = u.id
      left join platform_user_permission_versions version on version.user_id = u.id
      group by u.id, grant_row.grant_kind, version.revision
      order by lower(coalesce(nullif(u.display_name, ''), u.email)), u.id
      `,
    )
    response.json({
      users: result.rows.map((row) => {
        const feishuIdentityVerified = hasVerifiedFeishuIdentity({
          feishuUserId: row.feishu_user_id,
          registrationSource: row.registration_source,
          verifiedAt: row.feishu_identity_verified_at,
        })
        return {
          displayName: row.display_name || row.email,
          id: Number(row.id),
          accountStatus: row.account_status,
          feishuIdentityVerified,
          isBuiltinAdmin: row.is_builtin_admin,
          permissionVersion: Number(row.permission_version),
          platformAdmin: Boolean(row.grant_kind),
          platformAdminEligible: row.account_status === 'active' && !row.grant_kind &&
            (row.is_builtin_admin || feishuIdentityVerified),
          platformAdminKind: row.grant_kind,
          registrationSource: row.registration_source,
          roles: row.roles,
          username: row.email,
        }
      }),
    })
  } catch (error) {
    next(error)
  }
})

roleRouter.get('/admin/users/:userId/offboarding-preview', async (request, response, next) => {
  try {
    const session = await getAuthenticatedRoleSession(request)
    if (!session) {
      response.status(401).json({ error: 'Unauthorized' })
      return
    }
    if (!(await isPlatformAdmin(session.userId))) {
      response.status(403).json({ error: 'System administrator access is required' })
      return
    }
    const userId = Number(request.params.userId)
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      response.status(400).json({ error: 'Valid user is required' })
      return
    }
    const preview = await getOffboardingPreview(userId)
    if (!preview) {
      response.status(404).json({ error: 'User not found' })
      return
    }
    response.json(preview)
  } catch (error) {
    next(error)
  }
})

roleRouter.post('/admin/users/:userId/offboard', async (request, response, next) => {
  try {
    const session = await getAuthenticatedRoleSession(request)
    if (!session) {
      response.status(401).json({ error: 'Unauthorized' })
      return
    }
    if (!(await isPlatformAdmin(session.userId))) {
      response.status(403).json({ error: 'System administrator access is required' })
      return
    }
    const userId = Number(request.params.userId)
    const expectedVersion = Number(request.body?.expectedVersion)
    const requestId = String(request.body?.requestId ?? '')
    const selections = Array.isArray(request.body?.selections)
      ? request.body.selections.map((selection: { organizationId?: unknown; targetAdminUserId?: unknown }) => ({
        organizationId: Number(selection.organizationId),
        targetAdminUserId: Number(selection.targetAdminUserId),
      }))
      : []
    if (!Number.isSafeInteger(userId) || userId <= 0 ||
        !Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || !uuidPattern.test(requestId)) {
      response.status(400).json({ error: 'Valid user is required' })
      return
    }
    response.json(await offboardUser({
      actorUserId: session.userId,
      expectedVersion,
      requestId,
      selections,
      userId,
    }))
  } catch (error) {
    next(error)
  }
})

roleRouter.patch('/admin/users/:userId/status', async (request, response, next) => {
  try {
    const session = await getAuthenticatedRoleSession(request)
    if (!session) {
      response.status(401).json({ error: 'Unauthorized' })
      return
    }
    if (!(await isPlatformAdmin(session.userId))) {
      response.status(403).json({ error: 'System administrator access is required' })
      return
    }
    const userId = Number(request.params.userId)
    const status = request.body?.status
    const expectedVersion = Number(request.body?.expectedVersion)
    const requestId = String(request.body?.requestId ?? '')
    if (!Number.isSafeInteger(userId) || userId <= 0 || (status !== 'active' && status !== 'disabled') ||
        !Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || !uuidPattern.test(requestId)) {
      response.status(400).json({ error: 'Valid user and account status are required' })
      return
    }
    response.json(await updateManagedAccountStatus({
      actorUserId: session.userId,
      expectedVersion,
      requestId,
      status,
      userId,
    }))
  } catch (error) {
    next(error)
  }
})

roleRouter.patch('/admin/users/:userId/roles', async (request, response, next) => {
  try {
    const session = await getAuthenticatedRoleSession(request)
    if (!session) {
      response.status(401).json({ error: 'Unauthorized' })
      return
    }
    if (!(await isPlatformAdmin(session.userId))) {
      response.status(403).json({ error: 'System administrator access is required' })
      return
    }
    const userId = Number(request.params.userId)
    const roles: UserRole[] = Array.isArray(request.body.roles)
      ? Array.from(new Set((request.body.roles as unknown[]).filter(isUserRole)))
      : []
    const expectedVersion = Number(request.body?.expectedVersion)
    const platformAdmin = request.body?.platformAdmin
    const requestId = String(request.body?.requestId ?? '')
    if (
      !Number.isSafeInteger(userId) || userId <= 0 || roles.length === 0 ||
      !Number.isSafeInteger(expectedVersion) || expectedVersion < 0 ||
      typeof platformAdmin !== 'boolean' || !uuidPattern.test(requestId)
    ) {
      response.status(400).json({ error: 'At least one valid role is required' })
      return
    }
    response.json(await updateManagedUserPermissions({
      actorUserId: session.userId,
      expectedVersion,
      platformAdmin,
      requestId,
      roles,
      targetUserId: userId,
    }))
  } catch (error) {
    if (error instanceof PlatformAdminError) {
      response.status(error.status).json({ error: error.message, code: error.code })
      return
    }
    next(error)
  }
})
