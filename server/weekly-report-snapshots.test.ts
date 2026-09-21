import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { buildWeeklyReportSnapshots, normalizeWeeklyReportItemSources, retainWeeklyReportItemSources } from './weekly-report-snapshots.ts'
import { createWeeklyReportDocument, createWeeklyReportItem, serializeWeeklyReportDocument } from '../shared/weekly-report-document.ts'
import type { WeeklyReportSourceCandidate, WeeklyReportSourceRef } from '../shared/weekly-report-profile.ts'

const ref: WeeklyReportSourceRef = { kind: 'test_plan', id: 11, testSpaceId: 2 }
function fixture() {
  const document = createWeeklyReportDocument('tester')
  const item = createWeeklyReportItem('test')
  item.title = 'Version verification'
  item.tasks[0] = { id: 'task', title: 'Regression', description: 'Verified paths', progressPercent: 80 }
  document.items.push(item)
  return serializeWeeklyReportDocument(document)
}
const candidate: WeeklyReportSourceCandidate = {
  ...ref, title: 'Release verification', status: 'in_progress', projectName: 'Quality',
  date: '2026-09-21', matchedDate: '2026-09-21', matchReason: 'Executed this week', relatedToMe: true,
  testSubjects: [{ id: 3, name: 'Orders' }],
  personalExecutionStats: { total: 8, passed: 6, failed: 1, blocked: 1, skipped: 0 },
  personalExecutionRecords: [{ caseTitle: 'Checkout', result: 'passed', executedAt: '2026-09-21' }],
}

test('item bindings accept only canonical references belonging to the report', () => {
  const value = [{ itemIndex: 1, sources: [{ ...ref, personalExecutionStats: { passed: 999 } }] }]
  assert.deepEqual(normalizeWeeklyReportItemSources(value, fixture(), [ref]), [{ itemIndex: 1, sources: [ref] }])
  for (const bindings of [null, [{ itemIndex: -1, sources: [ref] }], [{ itemIndex: 2, sources: [ref] }],
    [{ itemIndex: 1, sources: [ref] }, { itemIndex: 1, sources: [ref] }],
    [{ itemIndex: 1, sources: [{ ...ref, testSpaceId: 99 }] }]]) {
    assert.throws(() => normalizeWeeklyReportItemSources(bindings, fixture(), [ref]))
  }
  assert.deepEqual(normalizeWeeklyReportItemSources(undefined, 'Legacy Markdown', []), [])
})

test('submission snapshots remap blank items and retain independent canonical statistics', () => {
  const live = structuredClone(candidate)
  const snapshots = buildWeeklyReportSnapshots(fixture(), [{ itemIndex: 1, sources: [ref] }], [live])
  assert.equal(snapshots[0].itemIndex, 0)
  assert.deepEqual(snapshots[0].sources[0].personalExecutionStats, candidate.personalExecutionStats)
  assert.equal('personalExecutionRecords' in snapshots[0].sources[0], false)
  live.personalExecutionStats!.passed = 99
  live.testSubjects![0].name = 'Changed'
  assert.equal(snapshots[0].sources[0].personalExecutionStats!.passed, 6)
  assert.equal(snapshots[0].sources[0].testSubjects![0].name, 'Orders')
  assert.throws(() => buildWeeklyReportSnapshots(fixture(), [{ itemIndex: 1, sources: [ref] }], []), /失效/)
  assert.deepEqual(buildWeeklyReportSnapshots('Legacy Markdown', [], []), [])
})

test('deleted source rows remove only draft bindings, preserving content and published snapshots', () => {
  const content = fixture()
  const bindings = [{ itemIndex: 1, sources: [ref] }]
  const published = buildWeeklyReportSnapshots(content, bindings, [candidate])
  assert.deepEqual(retainWeeklyReportItemSources(bindings, []), [])
  assert.deepEqual(retainWeeklyReportItemSources(bindings, [ref]), bindings)
  assert.equal(published[0].sources[0].title, candidate.title)
  assert.equal(bindings[0].sources.length, 1)
  assert.equal(content, fixture())
})

test('snapshots are encrypted in the revision transaction and historical nulls are not backfilled from live facts', () => {
  const server = readFileSync(new URL('./weekly-reports.ts', import.meta.url), 'utf8')
  const start = server.indexOf('async function submitWeeklyReport')
  const submit = server.slice(start, server.indexOf('\nasync function ', start + 1))
  assert.match(submit, /checkSources[\s\S]*lock: true[\s\S]*buildWeeklyReportSnapshots/)
  assert.match(submit, /source_snapshots = \$1::text[\s\S]*encryptText\(JSON.stringify\(sourceSnapshots\)\)/)
  assert.match(server, /publishedSourceSnapshots: report\?\.source_snapshots \? JSON.parse\(decryptText\(report.source_snapshots\)\).* : \[\]/)
  const backfill = readFileSync(new URL('./encrypt-existing.ts', import.meta.url), 'utf8')
  assert.match(backfill, /encryptColumn\('organization_weekly_reports', 'draft_item_sources'\)/)
  assert.match(backfill, /encryptColumn\('organization_weekly_report_revisions', 'source_snapshots'\)/)
})
