import type { AuthUser, UserRole } from './api'

export type WorkspaceIdentity = UserRole | 'platform_admin'

export const userRoleLabel: Record<WorkspaceIdentity, string> = {
  developer: '开发工程师',
  organization_admin: '组织管理员',
  platform_admin: '超级管理员',
  tester: '测试工程师',
}

export type SwitchableUserRole = Exclude<UserRole, 'organization_admin'>

export const switchableUserRoles: SwitchableUserRole[] = ['developer', 'tester']

export function hasOrganizationAdminRole(roles: readonly UserRole[]) {
  return roles.includes('organization_admin')
}

export function getSwitchableUserRoles(roles: readonly UserRole[]): SwitchableUserRole[] {
  if (hasOrganizationAdminRole(roles)) return [...switchableUserRoles]
  return switchableUserRoles.filter((role) => roles.includes(role))
}

// Workspace identities include management; the server session keeps its business persona.
export function getSelectableWorkspaceRoles(
  roles: readonly UserRole[],
  isSystemAdmin = false,
): WorkspaceIdentity[] {
  const businessRoles = getSwitchableUserRoles(roles)
  const identities: WorkspaceIdentity[] = hasOrganizationAdminRole(roles)
    ? [...businessRoles, 'organization_admin']
    : businessRoles
  if (isSystemAdmin) identities.push('platform_admin')
  return identities
}

export function getActiveWorkspaceRole(
  user: Pick<AuthUser, 'activeRole' | 'roles'> & Partial<Pick<AuthUser, 'isSystemAdmin'>>,
  view: string,
): WorkspaceIdentity {
  if (view === 'platform' && user.isSystemAdmin) return 'platform_admin'
  if (view === 'organization' && hasOrganizationAdminRole(user.roles)) return 'organization_admin'
  return user.activeRole
}
