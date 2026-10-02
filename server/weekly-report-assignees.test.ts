import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const schemaSource = readFileSync(new URL('./schema.ts', import.meta.url), 'utf8')
const migrationSource = readFileSync(
  new URL('./migrations/20260908_weekly_report_assignees.sql', import.meta.url),
  'utf8',
)
const assignmentsMigrationSource = readFileSync(
  new URL('./migrations/20261002_weekly_report_assignments.sql', import.meta.url),
  'utf8',
)
const organizationsSource = readFileSync(new URL('./organizations.ts', import.meta.url), 'utf8')
const platformOrganizationsSource = readFileSync(new URL('./platform-organizations.ts', import.meta.url), 'utf8')
const weeklyReportsSource = readFileSync(new URL('./weekly-reports.ts', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8')
const organizationWorkbenchSource = readFileSync(
  new URL('../src/components/organization-workbench.tsx', import.meta.url),
  'utf8',
)
const organizationWorkbenchStyles = readFileSync(
  new URL('../src/components/organization-workbench.css', import.meta.url),
  'utf8',
)
const weeklyReportWorkbenchSource = readFileSync(
  new URL('../src/components/weekly-report-workbench.tsx', import.meta.url),
  'utf8',
)

test('organization memberships require an explicit report persona assignment', () => {
  assert.match(schemaSource, /weekly_report_required boolean not null default false/u)
  assert.match(schemaSource, /weekly_report_profiles text\[\] not null default '\{\}'::text\[\]/u)
  assert.match(assignmentsMigrationSource, /weekly_report_profiles text\[\] not null default '\{\}'::text\[\]/u)
  assert.match(
    schemaSource,
    /set weekly_report_profiles = '\{\}'::text\[\],[\s\S]+weekly_report_required = false[\s\S]+lower\(users\.email\) = 'admin'/u,
  )
  assert.match(migrationSource, /organization_memberships/u)
  assert.match(organizationsSource, /select \$1, \$2, 'member', 'active', false/u)
  assert.match(platformOrganizationsSource, /'owner', 'active', false/u)
  assert.equal(
    organizationsSource.match(
      /weekly_report_required = excluded\.weekly_report_required/gu,
    )?.length,
    3,
  )
})

test('weekly-report rule updates validate and replace the long-lived assignee list transactionally', () => {
  const routeStart = organizationsSource.indexOf(
    "router.patch('/organizations/:organizationId/weekly-report-rules'",
  )
  const routeEnd = organizationsSource.indexOf(
    "router.delete('/organizations/:organizationId'",
    routeStart,
  )
  const routeSource = organizationsSource.slice(routeStart, routeEnd)

  assert.ok(routeStart >= 0)
  assert.ok(routeEnd > routeStart)
  assert.match(routeSource, /weeklyReportAssignments/u)
  assert.match(routeSource, /membership\.status = 'active'/u)
  assert.match(routeSource, /lower\(users\.email\) <> 'admin'/u)
  assert.match(routeSource, /for update of membership/u)
  assert.match(
    routeSource,
    /set weekly_report_profiles = coalesce\(assignment\.profiles, '\{\}'::text\[\]\),\s+weekly_report_required = assignment\.user_id is not null/u,
  )
  assert.match(routeSource, /await client\.query\('commit'\)/u)
  assert.match(routeSource, /weeklyReportAssignments: assignments/u)
})

test('personal weekly-report mutations require a current assignee before writing or calling AI', () => {
  const saveStart = weeklyReportsSource.indexOf('async function saveDraft')
  const saveEnd = weeklyReportsSource.indexOf('async function getWeeklyReport', saveStart)
  const submitStart = weeklyReportsSource.indexOf('async function submitWeeklyReport')
  const submitEnd = weeklyReportsSource.indexOf('function shiftDate', submitStart)
  const generateStart = weeklyReportsSource.indexOf(
    "router.post('/weekly-reports/:organizationId/:weekStart/generate'",
  )
  const generateEnd = weeklyReportsSource.indexOf(
    "router.post('/weekly-reports/:organizationId/:weekStart/submit'",
    generateStart,
  )
  const generateSource = weeklyReportsSource.slice(generateStart, generateEnd)

  assert.match(weeklyReportsSource.slice(saveStart, saveEnd), /requireWeeklyReportAssignee/u)
  assert.match(weeklyReportsSource.slice(submitStart, submitEnd), /requireWeeklyReportAssignee/u)
  assert.ok(generateSource.indexOf('requireWeeklyReportAssignee') >= 0)
  assert.ok(
    generateSource.indexOf('requireWeeklyReportAssignee')
      < generateSource.indexOf('dependencies.generateWeeklyReport'),
  )
  const legacyRoute = organizationsSource.slice(organizationsSource.indexOf("router.put('/organizations/:organizationId/weekly-reports/:weekStart'"), organizationsSource.indexOf("router.post('/organizations/:organizationId/weekly-summaries"))
  assert.match(legacyRoute, /requireSession/u)
  assert.match(legacyRoute, /response.status\(410\)/u)
  assert.doesNotMatch(legacyRoute, /insert into|update organization_weekly_reports/u)
})

test('collection, reminders, and organization summaries use only current assignees', () => {
  const collectionStart = weeklyReportsSource.indexOf('async function loadCollection')
  const collectionEnd = weeklyReportsSource.indexOf('function buildReminderCard', collectionStart)
  const reminderStart = weeklyReportsSource.indexOf(
    "router.post('/organizations/:organizationId/weekly-report-reminders/:weekStart'",
  )
  const summaryStart = organizationsSource.indexOf(
    "router.post('/organizations/:organizationId/weekly-summaries/:weekStart'",
  )
  const summaryEnd = organizationsSource.indexOf(
    "router.post('/integrations/feishu/card-actions'",
    summaryStart,
  )

  assert.match(
    weeklyReportsSource.slice(collectionStart, collectionEnd),
    /membership\.weekly_report_required = true/u,
  )
  assert.match(
    weeklyReportsSource.slice(reminderStart),
    /membership\.weekly_report_required = true/u,
  )
  assert.match(
    organizationsSource.slice(summaryStart, summaryEnd),
    /= any\(membership\.weekly_report_profiles\)/u,
  )
  assert.match(
    organizationsSource,
    /r\.report_profile = any\(report_membership\.weekly_report_profiles\)/u,
  )
  assert.match(
    organizationWorkbenchSource,
    /weeklyCollection\?\.members\.some\(member => member\.revision != null\)/u,
  )
})

test('the client saves assignees and keeps non-assignees on a read-only history surface', () => {
  assert.match(apiSource, /weeklyReportAssignments: Array/u)
  assert.match(organizationWorkbenchSource, /填写成员/u)
  assert.match(organizationWorkbenchSource, /weeklyReportAssignments/u)
  assert.match(organizationWorkbenchSource, /setWeeklyReportAssignments\(\[\]\)/u)
  assert.match(weeklyReportWorkbenchSource, /detail\.weeklyReportProfiles/u)
  assert.match(weeklyReportWorkbenchSource, /canEdit = Boolean\(canWriteWeeklyReport && !report\?\.readOnlyReason && structuredDocument\)/u)
  assert.match(weeklyReportWorkbenchSource, /<WeeklyReportForm\b[^>]*disabled=\{!canEdit \|\| busy\}/u)
  assert.match(weeklyReportWorkbenchSource, /当前无需填写本组织周报/u)
})

test('ordered assignees are stored atomically and unselected memberships lose their position', () => {
  assert.match(schemaSource, /weekly_report_sort_order integer\s+check \(weekly_report_sort_order >= 0\)/u)
  const orderMigration = readFileSync(
    new URL('./migrations/20260910_weekly_report_assignee_order.sql', import.meta.url), 'utf8',
  )
  assert.match(orderMigration, /add column if not exists weekly_report_sort_order integer/u)
  assert.match(organizationsSource,
    /weekly_report_sort_order = assignment\.sort_order/u)
  assert.equal(organizationsSource.match(/weekly_report_sort_order = null/gu)?.length, 3)
})

test('configuration and collection share saved order, name fallback, and a stable ID tie breaker', () => {
  assert.match(organizationsSource,
    /order by m\.weekly_report_sort_order asc nulls last,\s+lower\(coalesce\(nullif\(u\.display_name, ''\), u\.email\)\), m\.user_id/u)
  assert.match(weeklyReportsSource,
    /order by membership\.weekly_report_sort_order asc nulls last,\s+lower\(coalesce\(nullif\(users\.display_name, ''\), users\.email\)\), membership\.user_id/u)
  assert.match(organizationWorkbenchSource, /setWeeklyReportAssignments\(detail\.weeklyReportAssignments\)/u)
})

test('the rule editor combines assignment and ordering in one list while search preserves selected order', () => {
  assert.match(organizationWorkbenchSource, /const selectedWeeklyReportAssignees = weeklyReportAssignments\.flatMap/u)
  assert.match(organizationWorkbenchSource,
    /const visibleUnselectedWeeklyReportAssignees = visibleWeeklyReportAssigneeCandidates\.filter\(\s*\(member\) => !weeklyReportAssignments\.some/u)
  assert.equal(organizationWorkbenchSource.match(/className="organization-weekly-assignee-list"/gu)?.length, 1)
  assert.doesNotMatch(organizationWorkbenchSource, /organization-weekly-assignee-order/u)
  assert.match(organizationWorkbenchSource,
    /selectedWeeklyReportAssignees\.map[\s\S]+visibleUnselectedWeeklyReportAssignees\.map/u)
  assert.match(organizationWorkbenchSource, /checked\s+disabled=\{busy\}/u)
  assert.match(organizationWorkbenchSource, /checked=\{false\}\s+disabled=\{busy \|\| memberWeeklyReportProfiles\(member\)\.length === 0\}/u)
  assert.equal(organizationWorkbenchSource.match(/htmlFor=\{`weekly-report-assignee-\$\{member\.id\}`\}/gu)?.length, 2)
  assert.match(organizationWorkbenchSource, /function toggleWeeklyReportProfile/u)
  assert.match(organizationWorkbenchSource, /index === 0[\s\S]+index === selectedWeeklyReportAssignees\.length - 1/u)
})

test('weekly report rules use an inline page and avoid nested scrolling in the member list', () => {
  const listStart = organizationWorkbenchStyles.indexOf('.organization-weekly-assignee-list {')
  const listEnd = organizationWorkbenchStyles.indexOf('.organization-weekly-assignee-list > li', listStart)

  assert.ok(listStart >= 0)
  assert.ok(listEnd > listStart)
  const listStyles = organizationWorkbenchStyles.slice(listStart, listEnd)
  assert.match(organizationWorkbenchSource, /className="organization-weekly-rules-page"/u)
  assert.doesNotMatch(organizationWorkbenchSource, /<DialogContent className="organization-weekly-rules-dialog"/u)
  assert.doesNotMatch(listStyles, /max-height/u)
  assert.doesNotMatch(listStyles, /overflow-y/u)
})

test('personal weekly reports are isolated by profile and deletion preserves submitted audit history', () => {
  assert.match(schemaSource, /idx_organization_weekly_reports_active_profile[\s\S]+organization_id, user_id, week_start, report_profile/u)
  assert.match(schemaSource, /where deleted_at is null and report_profile is not null/u)
  assert.match(schemaSource, /idx_organization_weekly_reports_active_legacy/u)
  assert.match(weeklyReportsSource, /report_profile = \$4::text/u)
  assert.match(weeklyReportsSource, /router\.delete\('\/weekly-reports\/:organizationId\/:weekStart'/u)
  assert.match(weeklyReportsSource, /getWeeklyReportWindow\(\{ rules, weekStart: dateOnly\(report\.week_start\) \}\)/u)
  assert.match(weeklyReportsSource, /set deleted_at = clock_timestamp\(\), deleted_by_user_id = \$1/u)
  assert.match(weeklyReportsSource, /set stale = true, stale_at = clock_timestamp\(\)/u)
  assert.match(weeklyReportsSource, /delete from organization_weekly_reports where id = \$1/u)
  assert.match(weeklyReportsSource, /if \(params\.profile\) \{[\s\S]+requireWeeklyReportAssignee\(client, params\.organizationId, params\.userId, params\.profile\)/u)
  assert.match(weeklyReportsSource, /profile_slot\.profile as slot_profile/u)
  assert.doesNotMatch(weeklyReportWorkbenchSource, /weekly-report-profile-tabs/u)
  assert.match(weeklyReportWorkbenchSource, /撤回并删除/u)
  assert.match(weeklyReportWorkbenchSource, /删除草稿/u)
  assert.match(weeklyReportWorkbenchSource, /deletePersonalWeeklyReport\(organizationId, item\.weekStart/u)
  assert.match(weeklyReportWorkbenchSource, /item\.reportProfile \?\? 'legacy'/u)
  assert.doesNotMatch(weeklyReportWorkbenchSource, /历史周报不可删除/u)
  assert.match(weeklyReportsSource, /requested !== 'legacy'/u)
  assert.match(weeklyReportsSource, /report_profile is not distinct from \$4::text/u)
  const deleteRouteStart = weeklyReportsSource.indexOf("router.delete('/weekly-reports/:organizationId/:weekStart'")
  assert.ok(deleteRouteStart >= 0)
  assert.match(weeklyReportsSource.slice(deleteRouteStart, deleteRouteStart + 900), /requestedDeletionProfile\(request, session\.activeRole\)/u)
  assert.match(weeklyReportsSource, /candidate !== activeRole && activeRole !== 'organization_admin'/u)
  assert.match(weeklyReportsSource, /generationFacts = await loadGenerationFacts\([\s\S]*?normalizedWeekStart,[\s\S]*?profile,/u)
  assert.match(weeklyReportsSource, /历史周报只读/u)
})
