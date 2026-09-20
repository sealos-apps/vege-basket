import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  parseOrganizationContext,
  serializeOrganizationContext,
} from '../shared/organization-context.ts'

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const appCssSource = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')
const weeklyReportSource = readFileSync(
  new URL('../src/components/weekly-report-workbench.tsx', import.meta.url),
  'utf8',
)
const testWorkbenchSource = readFileSync(
  new URL('../src/components/test-workbench.tsx', import.meta.url),
  'utf8',
)

test('parses only canonical organization contexts', () => {
  assert.equal(parseOrganizationContext('personal'), null)
  assert.equal(parseOrganizationContext(' 12 '), 12)
  assert.equal(parseOrganizationContext(''), undefined)
  assert.equal(parseOrganizationContext('0'), undefined)
  assert.equal(parseOrganizationContext('01'), undefined)
  assert.equal(parseOrganizationContext('1.5'), undefined)
  assert.equal(parseOrganizationContext(['12']), undefined)
})

test('serializes personal and organization contexts for API requests', () => {
  assert.equal(serializeOrganizationContext(null), 'personal')
  assert.equal(serializeOrganizationContext(12), '12')
})

test('personal and organization navigation keep their distinct daily work entries', () => {
  assert.match(appSource, /selectedOrganizationId !== null \? \(\s*<NavButton active=\{view === 'weekly_report'\}/u)
  assert.match(appSource, /selectedOrganizationId === null \? \(\s*<NavButton active=\{view === 'inbox'\}/u)
  assert.match(appSource, /selectedOrganizationId === null \? \(\s*<NavButton\s+active=\{view === 'ai'\}/u)
  assert.match(appSource, /selectedOrganizationId !== null \? \(\s*<NavGroup label="协作与交付"/u)
  assert.match(appSource, /function canAccessOrganizationManagement\(user: Pick<AuthUser, 'roles'>\)/u)
  assert.match(appSource, /return hasOrganizationAdminRole\(user\.roles\)/u)
  assert.match(appSource, /if \(view === 'organization'\) return canAccessOrganizationManagement\(user\)/u)
  assert.doesNotMatch(appSource, /nav-group-organization/u)
  assert.match(appSource, /<MyWorkWorkbench\s+key=\{selectedOrganizationId \?\? 'personal'\}\s+organizationId=\{selectedOrganizationId\}\s+projects=\{scopedProjects\}/u)
  assert.match(appSource, /nextOrganizationId !== null && \(view === 'inbox' \|\| view === 'ai'\)/u)
})

test('organization management is selected through roles in both account menus', () => {
  const accountMenuStart = appSource.indexOf('function AccountMenu(')
  assert.ok(accountMenuStart >= 0)
  const accountMenuSource = appSource.slice(accountMenuStart)
  const roleSelector = accountMenuSource.indexOf('<UserSwitch /> 选择角色')
  const organizationEntry = accountMenuSource.indexOf('<Buildings /> 组织管理')
  const platformEntry = accountMenuSource.indexOf('<ShieldCheck /> 平台管理')
  assert.ok(roleSelector >= 0)
  assert.equal(organizationEntry, -1)
  assert.equal(platformEntry, -1)
  assert.match(accountMenuSource, /activeView: View/u)
  assert.match(accountMenuSource, /data-active=\{activeView === 'changelog' \? 'true' : undefined\}/u)
  assert.match(accountMenuSource, /aria-current=\{activeView === 'changelog' \? 'page' : undefined\}/u)
  assert.match(accountMenuSource, /availableRoles\.length > 1/u)
  assert.match(accountMenuSource, /getSelectableWorkspaceRoles\(user\.roles, user\.isSystemAdmin\)/u)
  assert.match(accountMenuSource, /getActiveWorkspaceRole\(user, activeView\)/u)
  assert.match(accountMenuSource, /onSelect=\{\(\) => onRoleChange\(role\)\}/u)
  assert.match(accountMenuSource, /disabled=\{roleSelectionBusy\}/u)
  assert.match(appSource, /if \(role === 'platform_admin'\) \{[\s\S]*?setView\('platform'\)[\s\S]*?return/u)
  assert.doesNotMatch(accountMenuSource, /返回工作区/u)
  assert.match(accountMenuSource, /data-active=\{activeRole === role \? 'true' : undefined\}/u)
  assert.equal((appSource.match(/activeView=\{view\}/gu) ?? []).length, 2)
  assert.match(appSource, /if \(role === 'organization_admin'\) \{[\s\S]*?setView\('organization'\)[\s\S]*?return/u)
  assert.equal((appSource.match(/onRoleChange=\{\(role\) => void changeActiveUserRole\(role\)\}/gu) ?? []).length, 2)
  assert.doesNotMatch(appSource, /onOpenOrganization/u)
  assert.doesNotMatch(appSource, /onOpenPlatform/u)
  assert.doesNotMatch(appSource, /organizationReturnViewRef/u)
  assert.doesNotMatch(appSource, /closeOrganizationManagement/u)
  assert.match(appCssSource, /:is\(\.account-menu-content, \.account-role-submenu\) \.account-menu-item\[data-active='true'\]/u)
  assert.match(appCssSource, /:is\(\.account-menu-content, \.account-role-submenu\) \.account-menu-item\[data-highlighted\]/u)
  assert.match(appCssSource, /\.account-role-submenu \.account-menu-item:focus-visible/u)
  assert.match(appCssSource, /\.account-menu-sub-trigger\[data-state='open'\]/u)
})

test('weekly reports inherit their host organization context and preserve drafts before context changes', () => {
  assert.match(appSource, /ref=\{weeklyReportWorkbenchRef\}/u)
  assert.match(appSource, /organizationId=\{selectedOrganizationId\}/u)
  assert.match(appSource, /weeklyReportWorkbenchRef\.current\?\.prepareOrganizationChange\(\)/u)
  assert.match(appSource, /setSelectedOrganizationId\(targetOrganizationId\)/u)
  assert.match(appSource, /organizations\.some\(\(organization\) => organization\.id === targetOrganizationId\)/u)
  assert.match(weeklyReportSource, /organizationId: number \| null/u)
  assert.match(weeklyReportSource, /useImperativeHandle\(ref, \(\) => \(\{ prepareOrganizationChange \}\)/u)
  assert.match(weeklyReportSource, /当前测试空间未关联组织/u)
  assert.doesNotMatch(weeklyReportSource, /fetchOrganizations/u)
  assert.doesNotMatch(weeklyReportSource, /aria-label="选择组织"/u)
  assert.match(testWorkbenchSource, /activeWeeklyReportOrganizationId = activeManagedSpace\?\.organizationId \?\? null/u)
  assert.match(testWorkbenchSource, /ref=\{weeklyReportWorkbenchRef\}/u)
  assert.match(testWorkbenchSource, /organizationId=\{activeWeeklyReportOrganizationId\}/u)
  assert.match(
    testWorkbenchSource,
    /tab === 'weekly_report' && activeWeeklyReportOrganizationId !== nextOrganizationId/u,
  )
  assert.match(testWorkbenchSource, /weeklyReportWorkbenchRef\.current\?\.prepareOrganizationChange\(\)/u)
})
