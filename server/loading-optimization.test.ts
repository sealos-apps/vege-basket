import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const organizationClientSource = readFileSync(
  new URL('../src/components/organization-workbench.tsx', import.meta.url),
  'utf8',
)
const organizationServerSource = readFileSync(new URL('./organizations.ts', import.meta.url), 'utf8')
const testClientSource = readFileSync(
  new URL('../src/components/test-workbench.tsx', import.meta.url),
  'utf8',
)
const testClientApiSource = readFileSync(new URL('../src/test-workbench-api.ts', import.meta.url), 'utf8')
const testServerSource = readFileSync(new URL('./test-workbench.ts', import.meta.url), 'utf8')

test('role and view changes do not invalidate unrelated application data', () => {
  assert.doesNotMatch(appSource, /workspaceHydratedRef/u)
  assert.match(
    appSource,
    /\[applyCanonicalAiTurnOutcome, authUserId, loggedIn, replaceAiConversationTurns\]/u,
  )
  assert.match(appSource, /\[authUserId, loggedIn, organizationRefreshVersion\]/u)
  assert.match(appSource, /initialOrganizations=\{organizations\}/u)
})

test('test workbench reads stay sectioned and scoped to the active space', () => {
  assert.match(testServerSource, /if \(value === undefined\) return undefined/u)
  assert.match(testServerSource, /const includes = \(section: TestWorkbenchSection\) => !sections \|\| sections\.has\(section\)/u)
  assert.match(testServerSource, /const workbenchQuery = createLimitedQuery\(\)/u)
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
  assert.match(testClientSource, /invalidateWorkbenchScope\('bugs', notification\.testSpaceId\)/u)
  assert.match(testClientSource, /activatedScopeKeyRef\.current !== scopeKey/u)
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
