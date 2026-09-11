import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const schemaSource = readFileSync(new URL('./schema.ts', import.meta.url), 'utf8')
const migrationSource = readFileSync(
  new URL('./migrations/20260908_weekly_report_assignees.sql', import.meta.url),
  'utf8',
)
const organizationsSource = readFileSync(new URL('./organizations.ts', import.meta.url), 'utf8')
const weeklyReportsSource = readFileSync(new URL('./weekly-reports.ts', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8')
const organizationWorkbenchSource = readFileSync(
  new URL('../src/components/organization-workbench.tsx', import.meta.url),
  'utf8',
)
const weeklyReportWorkbenchSource = readFileSync(
  new URL('../src/components/weekly-report-workbench.tsx', import.meta.url),
  'utf8',
)

test('organization memberships default to requiring weekly reports while the reserved admin does not', () => {
  assert.match(schemaSource, /weekly_report_required boolean not null default true/u)
  assert.match(migrationSource, /weekly_report_required boolean not null default true/u)
  assert.match(
    schemaSource,
    /set weekly_report_required = false[\s\S]+lower\(users\.email\) = 'admin'/u,
  )
  assert.match(
    migrationSource,
    /set weekly_report_required = false[\s\S]+lower\(users\.email\) = 'admin'/u,
  )
  assert.match(
    organizationsSource,
    /select \$1, \$2, 'member', 'active', lower\(email\) <> 'admin'/u,
  )
  assert.match(organizationsSource, /ownerUsername !== 'admin'/u)
  assert.match(organizationsSource, /username !== 'admin'/u)
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
  assert.match(routeSource, /weeklyReportAssigneeIds/u)
  assert.match(routeSource, /membership\.status = 'active'/u)
  assert.match(routeSource, /lower\(users\.email\) <> 'admin'/u)
  assert.match(routeSource, /for update of membership/u)
  assert.match(
    routeSource,
    /set weekly_report_required = \(membership\.user_id = any\(\$2::bigint\[\]\)\)/u,
  )
  assert.match(routeSource, /await client\.query\('commit'\)/u)
  assert.match(routeSource, /weeklyReportAssigneeUserIds: assigneeIds/u)
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
  assert.match(
    organizationsSource,
    /router\.put\('\/organizations\/:organizationId\/weekly-reports\/:weekStart'[\s\S]+if \(!membership\.rows\[0\]\.weekly_report_required\)/u,
  )
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
    /membership\.weekly_report_required = true/u,
  )
  assert.match(
    organizationsSource,
    /report_membership\.weekly_report_required = true/u,
  )
  assert.match(
    organizationWorkbenchSource,
    /weeklyCollection\?\.members\.some\(\(member\) => member\.revision != null\)/u,
  )
})

test('the client saves assignees and keeps non-assignees on a read-only history surface', () => {
  assert.match(apiSource, /weeklyReportAssigneeUserIds: number\[\]/u)
  assert.match(organizationWorkbenchSource, /填写成员/u)
  assert.match(organizationWorkbenchSource, /weeklyReportAssigneeUserIds/u)
  assert.match(organizationWorkbenchSource, /setWeeklyReportAssigneeUserIds\(\[\]\)/u)
  assert.match(weeklyReportWorkbenchSource, /detail\.canWriteWeeklyReport/u)
  assert.match(weeklyReportWorkbenchSource, /readOnly=\{!canWriteWeeklyReport\}/u)
  assert.match(weeklyReportWorkbenchSource, /当前无需填写本组织周报/u)
})

test('ordered assignees are stored atomically and unselected memberships lose their position', () => {
  assert.match(schemaSource, /weekly_report_sort_order integer\s+check \(weekly_report_sort_order >= 0\)/u)
  const orderMigration = readFileSync(
    new URL('./migrations/20260910_weekly_report_assignee_order.sql', import.meta.url), 'utf8',
  )
  assert.match(orderMigration, /add column if not exists weekly_report_sort_order integer/u)
  assert.match(organizationsSource,
    /set weekly_report_required = \(membership\.user_id = any\(\$2::bigint\[\]\)\),\s+weekly_report_sort_order = array_position\(\$2::bigint\[\], membership\.user_id\) - 1/u)
  assert.equal(organizationsSource.match(/weekly_report_sort_order = null/gu)?.length, 3)
})

test('configuration and collection share saved order, name fallback, and a stable ID tie breaker', () => {
  assert.match(organizationsSource,
    /order by m\.weekly_report_sort_order asc nulls last,\s+lower\(coalesce\(nullif\(u\.display_name, ''\), u\.email\)\), m\.user_id/u)
  assert.match(weeklyReportsSource,
    /order by membership\.weekly_report_sort_order asc nulls last,\s+lower\(coalesce\(nullif\(users\.display_name, ''\), users\.email\)\), membership\.user_id/u)
  assert.match(organizationWorkbenchSource, /setWeeklyReportAssigneeUserIds\(detail\.weeklyReportAssigneeUserIds\)/u)
})
