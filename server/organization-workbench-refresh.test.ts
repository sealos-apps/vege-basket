import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workbenchSource = readFileSync(
  new URL('../src/components/organization-workbench.tsx', import.meta.url),
  'utf8',
)
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const workbenchCssSource = readFileSync(
  new URL('../src/components/organization-workbench.css', import.meta.url),
  'utf8',
)
const packageWorkbenchSource = readFileSync(
  new URL('../src/components/project-package-workbench.tsx', import.meta.url),
  'utf8',
)

test('organization weekly collection does not reload from whole detail object refreshes', () => {
  assert.match(workbenchSource, /const weeklyOrganizationId = detail\?\.id \?\? 0/u)
  assert.match(workbenchSource, /const canManageWeeklyReports = detail\?\.canManageWeeklyReports \?\? false/u)
  assert.match(workbenchSource, /fetchWeeklyReportCollection\(weeklyOrganizationId, weekStart\)/u)
  assert.match(workbenchSource, /\}, \[canManageWeeklyReports, weekStart, weeklyOrganizationId\]\)/u)
  assert.match(workbenchSource, /\[backgroundRefreshVersion, loadWeeklyCollection, tab, weeklyCollectionRefresh\]/u)
  assert.match(workbenchSource, /weeklyCollectionLoading && !weeklyCollection/u)
  assert.doesNotMatch(workbenchSource, /weeklyCollectionLoading \? <EmptyRow/u)
})

test('organization detail loading cannot render the empty organization state early', () => {
  assert.match(workbenchSource, /const \[detailLoading, setDetailLoading\] = useState\(false\)/u)
  assert.match(workbenchSource, /setDetailLoading\(nextId !== 0\)/u)
  assert.match(
    workbenchSource,
    /if \(\(!detail \|\| detail\.id !== selectedOrganizationId\) && \(loading \|\| detailLoading\)\)/u,
  )
  assert.match(workbenchSource, /if \(!detail \|\| detail\.id !== selectedOrganizationId\)/u)
})

test('organization management replaces the workspace navigation in the existing sidebar', () => {
  assert.match(appSource, /view === 'organization'[\s\S]*?ref=\{setOrganizationSidebarHost\}/u)
  assert.match(appSource, /sidebarNavigationHost=\{organizationSidebarHost\}/u)
  assert.match(appSource, /ref=\{view === 'organization' \? setOrganizationTopbarHost : undefined\}/u)
  assert.match(appSource, /topbarActionHost=\{organizationTopbarHost\}/u)
  assert.match(appSource, /onRoleChange=\{\(role\) => void changeActiveUserRole\(role\)\}/u)
  assert.doesNotMatch(appSource, /onCloseOrganization/u)
  assert.match(workbenchSource, /createPortal\([\s\S]*?organization-sidebar-panel[\s\S]*?sidebarNavigationHost/u)
  assert.match(workbenchSource, /createPortal\([\s\S]*?organization-topbar-controls[\s\S]*?topbarActionHost/u)
  assert.match(workbenchSource, /aria-label="组织管理导航"/u)
  assert.match(workbenchSource, /className="organization-topbar-switcher" aria-label="选择组织"/u)
  assert.match(workbenchSource, /id: 'settings', label: '组织设置'/u)
  assert.match(workbenchSource, /item\.id !== 'settings' \|\| selectedDetail\?\.canManage/u)
  assert.match(workbenchSource, /tab === 'settings'[\s\S]*?organization-settings-page/u)
  assert.doesNotMatch(workbenchSource, /organization-sidebar-back/u)
  assert.doesNotMatch(workbenchSource, /organization-sidebar-switcher/u)
  assert.doesNotMatch(workbenchSource, /organization-settings-dialog/u)
  assert.doesNotMatch(workbenchSource, /organizationTabs\.slice/u)
  assert.doesNotMatch(workbenchSource, /className="organization-tabs-row"/u)
  assert.match(
    workbenchCssSource,
    /\.organization-sidebar-nav\s*\{[\s\S]*?align-content: start;/u,
  )
})

test('global package market uses the selected sidebar organization as its only context', () => {
  assert.match(appSource, /const activePackageMarketOrganization = selectedOrganizationId == null/u)
  assert.match(
    appSource,
    /organization\.id === selectedOrganizationId && organization\.packageMarketEnabled/u,
  )
  assert.match(appSource, /const packageMarketVisible = activePackageMarketOrganization !== null/u)
  assert.match(appSource, /view === 'package_market' && !packageMarketVisible/u)
  assert.match(
    appSource,
    /\}, \[authUserId, loggedIn, organizationRefreshVersion\]\)/u,
  )
  assert.match(
    appSource,
    /<PackageMarketBrowser[\s\S]*?organizationId=\{activePackageMarketOrganization\.id\}/u,
  )
  assert.doesNotMatch(appSource, /packageMarketOrganizations/u)
  assert.doesNotMatch(appSource, /loadPackageMarketOrganizations/u)

  assert.match(packageWorkbenchSource, /organizationId: number/u)
  assert.match(
    packageWorkbenchSource,
    /loadMarketRulesRef\.current\(\{ organizationId: contextOrganizationId \}\)/u,
  )
  assert.match(packageWorkbenchSource, /const requestContext: PackageMarketRequestContext = \{ organizationId \}/u)
  assert.match(packageWorkbenchSource, /void loadMarketContext\(organizationId, requestId\)/u)
  assert.match(packageWorkbenchSource, /contextOrganizationId !== currentOrganizationIdRef\.current/u)
  assert.doesNotMatch(packageWorkbenchSource, /组织上下文/u)
  assert.doesNotMatch(packageWorkbenchSource, /marketOrganizationId/u)
  assert.doesNotMatch(packageWorkbenchSource, /onLoadPackageMarketOrganizations/u)
})

test('organization weekly reports use the previous week until its deadline', () => {
  assert.match(workbenchSource, /getWeeklyReportTargetWeekStart\(\{ now, rules, weekStartsOn \}\)/u)
  assert.match(workbenchSource, /const weekStart = reportWeekStart\(/u)
})

test('organization overview renders every current Bug status as user-facing Chinese', () => {
  assert.match(workbenchSource, /pending_confirmation: '待确认'/u)
})

test('organization weekly reminders stay outside the native disclosure trigger', () => {
  const summaryStart = workbenchSource.indexOf('<summary>')
  const summaryEnd = workbenchSource.indexOf('</summary>', summaryStart)

  assert.notEqual(summaryStart, -1)
  assert.notEqual(summaryEnd, -1)
  assert.doesNotMatch(workbenchSource.slice(summaryStart, summaryEnd), /<Button/u)
  assert.match(workbenchSource, /className="organization-weekly-reminder"/u)
})

test('organization workbench uses readable scoped colors for secondary and status text', () => {
  assert.match(workbenchCssSource, /--organization-muted-readable:\s*var\(--muted-text\)/u)
  assert.match(workbenchCssSource, /--organization-danger-readable:/u)
  assert.match(workbenchCssSource, /--organization-positive-readable:/u)
  assert.match(workbenchCssSource, /--organization-warning-readable:/u)
  assert.match(
    workbenchCssSource,
    /\.organization-package-market-component-status\.available\s*\{[^}]*color:\s*var\(--organization-positive-readable\)/su,
  )
  assert.match(
    workbenchCssSource,
    /\.organization-package-market-dependency-type\s*\{[^}]*color:\s*var\(--organization-warning-readable\)/su,
  )
})
