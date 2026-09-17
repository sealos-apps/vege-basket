import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  getActiveWorkspaceRole,
  getSelectableWorkspaceRoles,
  hasOrganizationAdminRole,
} from '../src/user-roles.ts'
import type { AuthUser, UserRole } from '../src/api.ts'
import {
  canAssumeUserRole,
  getSwitchableUserRoles,
  isUserRole,
  isSwitchableUserRole,
} from './roles.ts'

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const roleSelectionSource = readFileSync(
  new URL('../src/components/user-role-dialogs.tsx', import.meta.url),
  'utf8',
).split('export function UserRoleManagementDialog')[0]

test('organization administrator is an additive capability, not a switchable role', () => {
  assert.equal(isSwitchableUserRole('organization_admin'), false)
  assert.deepEqual(
    getSwitchableUserRoles(['organization_admin']),
    ['developer', 'tester'],
  )
})

test('login and account identity selection share role-based workspace options', () => {
  assert.match(roleSelectionSource, /getSelectableWorkspaceRoles\(user\.roles\)\.map/u)
  assert.match(appSource, /getSelectableWorkspaceRoles\(user\.roles\)/u)
  assert.doesNotMatch(appSource, /onOpenOrganization/u)
})

test('management identity is available only with the assigned organization administrator role', () => {
  const cases: [UserRole[], UserRole[]][] = [
    [['developer'], ['developer']],
    [['tester'], ['tester']],
    [['developer', 'tester'], ['developer', 'tester']],
    [['organization_admin'], ['developer', 'tester', 'organization_admin']],
    [['tester', 'organization_admin'], ['developer', 'tester', 'organization_admin']],
    [[], []],
  ]
  for (const [roles, expected] of cases) {
    assert.deepEqual(getSelectableWorkspaceRoles(roles), expected)
  }
})

test('system administrator status does not expose an unassigned management identity', () => {
  const user: Pick<AuthUser, 'activeRole' | 'roles' | 'isSystemAdmin'> = {
    activeRole: 'developer', roles: ['developer'], isSystemAdmin: true,
  }
  assert.equal(hasOrganizationAdminRole(user.roles), false)
  assert.deepEqual(getSelectableWorkspaceRoles(user.roles), ['developer'])
  assert.equal(getActiveWorkspaceRole(user, 'organization'), 'developer')
})

test('management identity follows the authorized view without changing the session persona', () => {
  for (const activeRole of ['developer', 'tester'] as const) {
    const user = { activeRole, roles: ['organization_admin'] as UserRole[] }
    assert.equal(getActiveWorkspaceRole(user, 'organization'), 'organization_admin')
    assert.equal(getActiveWorkspaceRole(user, 'search'), activeRole)
    assert.equal(user.activeRole, activeRole)
    assert.equal(getActiveWorkspaceRole({ ...user, roles: [activeRole] }, 'organization'), activeRole)
  }
})

test('organization administrator can assume every business role', () => {
  assert.equal(canAssumeUserRole(['organization_admin'], 'developer'), true)
  assert.equal(canAssumeUserRole(['organization_admin'], 'tester'), true)
  assert.equal(canAssumeUserRole(['tester'], 'developer'), false)
})

test('developer navigation keeps the test workbench hidden until the tester persona is active', () => {
  assert.match(
    appSource,
    /const canNavigateToTestWorkbench = authUser\?\.activeRole === 'tester'/u,
  )
  assert.match(appSource, /if \(view === 'testing'\) return user\.activeRole === 'tester'/u)
})

test('delivery is no longer an account role', () => {
  assert.equal(isUserRole('delivery'), false)
  assert.equal(isSwitchableUserRole('delivery'), false)
})
