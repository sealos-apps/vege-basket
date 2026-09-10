import type express from 'express'
import { Router } from 'express'
import {
  getOffboardingPreview,
  offboardUser,
  updateManagedAccountStatus,
} from './account-offboarding.ts'
import { pool, query } from './db.ts'
import type { UserAccountStatus } from '../shared/user-lifecycle.ts'

export const userRoles = ['developer', 'tester', 'organization_admin'] as const
export type UserRole = (typeof userRoles)[number]
export const switchableUserRoles = ['developer', 'tester'] as const
export type SwitchableUserRole = (typeof switchableUserRoles)[number]

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

export function isSystemAdmin(username: string) {
  const configured = String(process.env.VEGES_ADMIN_USERNAMES || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  return configured.includes(username.trim().toLowerCase())
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

export async function getUserRoleContext(userId: number, token: string, username: string) {
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
    isSystemAdmin: isSystemAdmin(username),
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
    if (!isSystemAdmin(session.username)) {
      response.status(403).json({ error: 'System administrator access is required' })
      return
    }
    const result = await query<{
      display_name: string
      email: string
      id: string
      account_status: UserAccountStatus
      roles: UserRole[]
    }>(
      `
      select u.id, u.email, u.display_name, u.account_status,
        coalesce(array_agg(ur.role order by ur.role) filter (where ur.role is not null), '{}') as roles
      from users u
      left join user_roles ur on ur.user_id = u.id
      group by u.id
      order by lower(coalesce(nullif(u.display_name, ''), u.email)), u.id
      `,
    )
    response.json({
      users: result.rows.map((row) => ({
        displayName: row.display_name || row.email,
        id: Number(row.id),
        accountStatus: row.account_status,
        roles: row.roles,
        username: row.email,
      })),
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
    if (!isSystemAdmin(session.username)) {
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
    if (!isSystemAdmin(session.username)) {
      response.status(403).json({ error: 'System administrator access is required' })
      return
    }
    const userId = Number(request.params.userId)
    const selections = Array.isArray(request.body?.selections)
      ? request.body.selections.map((selection: { organizationId?: unknown; targetAdminUserId?: unknown }) => ({
        organizationId: Number(selection.organizationId),
        targetAdminUserId: Number(selection.targetAdminUserId),
      }))
      : []
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      response.status(400).json({ error: 'Valid user is required' })
      return
    }
    response.json(await offboardUser(userId, session.userId, selections))
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
    if (!isSystemAdmin(session.username)) {
      response.status(403).json({ error: 'System administrator access is required' })
      return
    }
    const userId = Number(request.params.userId)
    const status = request.body?.status
    if (!Number.isSafeInteger(userId) || userId <= 0 || (status !== 'active' && status !== 'disabled')) {
      response.status(400).json({ error: 'Valid user and account status are required' })
      return
    }
    response.json({ accountStatus: await updateManagedAccountStatus(userId, session.userId, status) })
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
    if (!isSystemAdmin(session.username)) {
      response.status(403).json({ error: 'System administrator access is required' })
      return
    }
    const userId = Number(request.params.userId)
    const roles: UserRole[] = Array.isArray(request.body.roles)
      ? Array.from(new Set((request.body.roles as unknown[]).filter(isUserRole)))
      : []
    if (!Number.isSafeInteger(userId) || userId <= 0 || roles.length === 0) {
      response.status(400).json({ error: 'At least one valid role is required' })
      return
    }

    const client = await pool.connect()
    try {
      await client.query('begin')
      const existingUser = await client.query('select id from users where id = $1 for update', [userId])
      if (!existingUser.rows[0]) {
        await client.query('rollback')
        response.status(404).json({ error: 'User not found' })
        return
      }
      await client.query('delete from user_roles where user_id = $1', [userId])
      for (const role of roles) {
        await client.query('insert into user_roles (user_id, role) values ($1, $2)', [userId, role])
      }
      const availableRoles = getSwitchableUserRoles(roles)
      await client.query(
        `update sessions set active_role = $1 where user_id = $2 and active_role <> all($3::text[])`,
        [availableRoles[0] ?? 'developer', userId, availableRoles],
      )
      await client.query('commit')
      response.json({ roles })
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  } catch (error) {
    next(error)
  }
})
