import type { AuthUser, UserRole } from './api'

export const userRoleLabel: Record<UserRole, string> = {
  developer: '开发工程师',
  organization_admin: '组织管理员',
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
export function getSelectableWorkspaceRoles(roles: readonly UserRole[]): UserRole[] {
  const businessRoles = getSwitchableUserRoles(roles)
  return hasOrganizationAdminRole(roles)
    ? [...businessRoles, 'organization_admin']
    : businessRoles
}

export function getActiveWorkspaceRole(
  user: Pick<AuthUser, 'activeRole' | 'roles'>,
  view: string,
): UserRole {
  return view === 'organization' && hasOrganizationAdminRole(user.roles)
    ? 'organization_admin'
    : user.activeRole
}
