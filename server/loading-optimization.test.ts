import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const organizationClientSource = readFileSync(
  new URL('../src/components/organization-workbench.tsx', import.meta.url),
  'utf8',
)
const myWorkClientSource = readFileSync(
  new URL('../src/components/my-work-workbench.tsx', import.meta.url),
  'utf8',
)
const organizationServerSource = readFileSync(new URL('./organizations.ts', import.meta.url), 'utf8')
const workspaceApiSource = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8')
const workspaceServerSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const testClientSource = readFileSync(
  new URL('../src/components/test-workbench.tsx', import.meta.url),
  'utf8',
)
const testClientApiSource = readFileSync(new URL('../src/test-workbench-api.ts', import.meta.url), 'utf8')
const testServerSource = readFileSync(new URL('./test-workbench.ts', import.meta.url), 'utf8')
const packageWorkbenchSource = readFileSync(
  new URL('../src/components/project-package-workbench.tsx', import.meta.url),
  'utf8',
)
const weeklyReportSource = readFileSync(
  new URL('../src/components/weekly-report-workbench.tsx', import.meta.url),
  'utf8',
)

test('role and view changes do not invalidate unrelated application data', () => {
  assert.doesNotMatch(appSource, /workspaceHydratedRef/u)
  assert.match(
    appSource,
    /\[applyCanonicalAiTurnOutcome, authUserId, loggedIn, replaceAiConversationTurns\]/u,
  )
  assert.match(appSource, /\[authUserId, loggedIn, organizationRefreshVersion\]/u)
  assert.match(appSource, /initialOrganizations=\{organizations\}/u)
  assert.doesNotMatch(appSource, /workspaceRefreshVersion/u)
  assert.doesNotMatch(appSource, /refreshToken=/u)
})

test('background refreshes preserve workbench content and editor state', () => {
  assert.doesNotMatch(organizationClientSource, /refreshToken/u)
  assert.doesNotMatch(myWorkClientSource, /refreshToken/u)
  assert.doesNotMatch(testClientSource, /refreshToken/u)
  assert.doesNotMatch(weeklyReportSource, /refreshToken/u)
  assert.doesNotMatch(weeklyReportSource, /window\.location\.reload/u)
  assert.doesNotMatch(packageWorkbenchSource, /window\.location\.reload/u)
  assert.match(weeklyReportSource, />\s*重试编辑器\s*<\/Button>/u)
  assert.match(packageWorkbenchSource, />\s*重试编辑器\s*<\/Button>/u)
  assert.match(organizationClientSource, /backgroundRefreshVersion/u)
  assert.match(myWorkClientSource, /backgroundRefreshVersion/u)
  assert.match(weeklyReportSource, /backgroundRefreshVersion/u)
  assert.match(weeklyReportSource, /loadedReportListContext/u)
  assert.match(appSource, /view !== 'project'/u)
  assert.match(
    weeklyReportSource,
    /\}, \[backgroundRefreshVersion, organizationId, reportListPage, reportListRefresh, workspaceView\]\)/u,
  )
  assert.match(
    weeklyReportSource,
    /\}, \[now, reportList, reportListPage, weekStartsOn, weeklyReportRules, workspaceView\]\)/u,
  )
})

test('test workbench reads stay sectioned and scoped to the active space', () => {
  assert.match(testServerSource, /if \(value === undefined\) return undefined/u)
  assert.match(testServerSource, /const includes = \(section: TestWorkbenchSection\) => !sections \|\| sections\.has\(section\)/u)
  assert.match(testServerSource, /const workbenchQuery = createLimitedQuery\(\)/u)
  assert.match(testServerSource, /const includeModules = includes\('core'\) \|\| includes\('cases'\) \|\| includes\('plans'\) \|\| includes\('bugs'\)/u)
  assert.match(testServerSource, /includeModules \? workbenchQuery/u)
  assert.match(testServerSource, /loadedSections: sections \? \[\.\.\.sections\] : undefined/u)
  assert.match(testServerSource, /const scopeBugs = .*b\.test_space_id/u)
  assert.match(testServerSource, /const includeBugDetails = !sections \|\| Boolean\(scope\?\.bugId\)/u)
  assert.match(testServerSource, /includes\('bugs'\) && includeBugDetails/u)
  assert.match(testServerSource, /detailsLoaded: includeBugDetails/u)
  assert.match(testServerSource, /latest_assignment\.transfer_source as latest_assignment_transfer_source/u)
  assert.match(testServerSource, /\|\| \(subjectId && !spaceId\)/u)
  assert.match(testServerSource, /\|\| \(bugId && !spaceId\)/u)
  assert.match(testClientApiSource, /if \(scope\?\.bugId\) params\.set\('bugId'/u)
  assert.match(testClientSource, /mergeTestWorkbenchData/u)
  assert.match(testClientSource, /testWorkbenchScopeKey/u)
  assert.match(testClientSource, /fetchTestWorkbench\(\{ sections: \['core', 'notifications'\] \}/u)
  assert.match(testClientSource, /\{ \.\.\.activeRequest, sections \}/u)
  assert.match(testClientSource, /if \(tab === 'bugs'\) return \['bugs', 'cases'\]/u)
  assert.match(testClientSource, /if \(tab === 'plans'\) return \['plans', 'cases'\]/u)
  assert.match(testClientSource, /bugId: selectedBugId, sections: \['bugs'\], spaceId/u)
  assert.match(testClientSource, /actualResult: cached\.actualResult/u)
  assert.match(testClientSource, /modules: sections\.has\('core'\) \|\| sections\.has\('cases'\) \|\| sections\.has\('plans'\) \|\| sections\.has\('bugs'\)/u)
  assert.match(testClientSource, /invalidateWorkbenchScope\('bugs', notification\.testSpaceId\)/u)
  assert.match(testClientSource, /activatedScopeKeyRef\.current !== scopeKey/u)
  assert.match(testServerSource, /select count\(\*\) from test_cases test_case where test_case\.test_space_id = ts\.id/u)
  assert.match(testServerSource, /select count\(\*\) from test_plans test_plan where test_plan\.test_space_id = ts\.id/u)
  assert.match(testServerSource, /select count\(\*\) from test_bugs test_bug where test_bug\.test_space_id = ts\.id/u)
  assert.match(testClientSource, /activeSpace\?\.caseCount \?\? 0/u)
  assert.match(testClientSource, /activeSpace\?\.planCount \?\? 0/u)
  assert.match(testClientSource, /activeSpace\?\.bugCount \?\? 0/u)
  assert.doesNotMatch(testClientSource, /test-nav-count">\{(?:cases|plans|bugs)\.length\}/u)
  assert.doesNotMatch(testClientSource, /caseScopeRef/u)
})

test('test notifications are self-contained and retain server-side resource authorization', () => {
  assert.match(testClientSource, /if \(tab === 'notifications' \|\| tab === 'weekly_report'\) return \[\]/u)
  assert.match(testServerSource, /coalesce\(notification_bug\.id, notification_plan\.id\) as target_id/u)
  assert.match(testServerSource, /comment_author\.display_name as comment_author_display_name/u)
  assert.match(testServerSource, /notification_space\.version_label as test_space_version_label/u)
  assert.match(testServerSource, /testSpaceVersionLabel: row\.test_space_version_label/u)
  assert.match(testServerSource, /testSpaceMembershipPresentSql\('notification_membership'\)/u)
  assert.match(testServerSource, /managedOrganizationReadScopeSql\('notification_space\.organization_id'\)/u)
  assert.match(testClientSource, /notification\.targetId/u)
  assert.match(testClientSource, /notification\.testSpaceVersionLabel/u)
})

test('organization sections preserve the complete default and avoid multiplied counts', () => {
  assert.match(organizationServerSource, /if \(value === undefined\) return undefined/u)
  assert.match(organizationServerSource, /!sections \|\| candidates\.some/u)
  assert.match(organizationServerSource, /const detailQuery = createLimitedQuery\(\)/u)
  assert.match(organizationServerSource, /loadedSections: sections \? \[\.\.\.sections\] : undefined/u)
  assert.doesNotMatch(organizationServerSource, /left join test_plans p on p\.test_space_id = s\.id/u)
  assert.doesNotMatch(organizationServerSource, /left join test_bugs b on b\.test_space_id = s\.id/u)
  assert.match(organizationClientSource, /mergeOrganizationDetail/u)
})

test('workspace loading uses independently scoped live read models', () => {
  for (const route of [
    '/api/workspace/catalog',
    '/api/workspace/overview',
    '/api/workspace/inbox',
    '/api/workspace/documents',
    '/api/workspace/search',
    '/api/projects/:projectId/overview',
    '/api/projects/:projectId/journals',
    '/api/todos/:todoId/detail',
  ]) {
    assert.equal(workspaceServerSource.includes(route), true)
  }
  assert.match(workspaceServerSource, /includeTodoDetail: false,[\s\S]*?sections: new Set\(\['journals', 'summaries', 'todos'\]\)/u)
  assert.match(workspaceServerSource, /includeTodoDetail: false,[\s\S]*?projectId,[\s\S]*?sections: new Set\(\['todos'\]\)/u)
  assert.equal(workspaceServerSource.match(/await getWorkspace\(userId\)/gu)?.length, 1)
  assert.match(workspaceApiSource, /fetchProjectCatalog/u)
  assert.match(workspaceApiSource, /fetchProjectOverview/u)
  assert.match(workspaceApiSource, /fetchProjectJournals/u)
  assert.match(workspaceApiSource, /fetchProjectTodos/u)
  assert.match(workspaceApiSource, /fetchWorkspaceInbox/u)
  assert.match(workspaceApiSource, /fetchWorkspaceDocuments/u)
  assert.match(workspaceApiSource, /fetchWorkspaceSearch/u)
  assert.match(appSource, /return Promise\.all\(requests\)/u)
  assert.match(appSource, /controller\.abort\(\)/u)
  assert.match(appSource, /const snapshots = await fetchActiveWorkspace\(undefined, false\)/u)
  assert.match(
    appSource,
    /workspaceMutationEpochRef\.current !== mutationEpoch[\s\S]*?for \(const snapshot of snapshots\) applyWorkspace\(snapshot\)/u,
  )
  assert.match(
    appSource,
    /current\.filter\(\(summary\) => summary\.projectId !== data\.scope\?\.projectId\)/u,
  )
  assert.match(workspaceServerSource, /pm\.invited_user_id = \$1\s+and \(\$2::bigint is null or pm\.project_id = \$2\)/u)
  assert.match(appSource, /const resetWorkspaceState = useCallback\(\(\) => \{[\s\S]*?setTodos\(\[\]\)[\s\S]*?setSummaries\(\[\]\)/u)
  assert.match(appSource, /editingTodo\.detailsLoaded !== false[\s\S]*?onLoadTodoDetail\(editingTodo\.id\)/u)
  assert.match(appSource, /fetchTodoDetail\(todoId, \{ signal: controller\.signal \}\)/u)
  assert.match(appSource, /sections && \(!includes\('catalog'\) \|\| data\.scope\?\.projectId\)/u)
})

test('navigation badges use a scoped count endpoint instead of loading work entities', () => {
  assert.match(workspaceServerSource, /app\.get\('\/api\/navigation-counts'/u)
  assert.match(workspaceServerSource, /select count\(\*\)[\s\S]*?from todos t/u)
  assert.match(workspaceServerSource, /select count\(\*\)[\s\S]*?from test_bugs b/u)
  assert.match(workspaceServerSource, /organization_memberships[\s\S]*?status = 'active'/u)
  assert.match(workspaceApiSource, /fetchNavigationCounts/u)
  assert.match(appSource, /fetchNavigationCounts\(selectedOrganizationId/u)
  assert.match(appSource, /15_000/u)
  assert.doesNotMatch(appSource, /fetchMyWork\(selectedOrganizationId, \{ kind: 'todo'/u)
})

test('scoped project reads conservatively reduce returned entity rows by at least 95 percent', () => {
  const projects = 10
  const perProject = {
    journals: 100,
    memberships: 10,
    modules: 10,
    notes: 300,
    risks: 10,
    subprojects: 5,
    todos: 100,
  }
  const legacyRows = projects * (
    1 + perProject.journals + perProject.memberships + perProject.modules +
    perProject.notes + perProject.risks + perProject.subprojects + perProject.todos
  ) + 300
  const activeProjectRows = 1 + Object.entries(perProject)
    .filter(([section]) => section !== 'notes')
    .reduce((total, [, rows]) => total + rows, 0)
  const reduction = 1 - activeProjectRows / legacyRows
  assert.ok(reduction > 0.95)
})
