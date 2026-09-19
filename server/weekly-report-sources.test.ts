import assert from 'node:assert/strict'
import test from 'node:test'
import type { PoolClient } from 'pg'
import {
  loadWeeklyReportSources,
  normalizeWeeklyReportSources,
  validateWeeklyReportSources,
  weeklyReportPeriod,
} from './weekly-report-sources.ts'
import {
  convertLegacyWeeklyReport,
  serializeWeeklyReportDocument,
  parseWeeklyReportDocument,
} from '../shared/weekly-report-document.ts'

const params = {
  organizationId: 7,
  userId: 9,
  weekStart: '2026-09-07',
  profile: 'tester' as const,
}
function mockClient(rows: object[] = []) {
  const calls: { sql: string; args: unknown[] }[] = []
  return {
    calls,
    client: {
      query: async (sql: string, args: unknown[]) => {
        calls.push({ sql, args })
        return { rows }
      },
    } as unknown as PoolClient,
  }
}
test('period uses a seven-day Shanghai interval across month and year boundaries', () => {
  assert.deepEqual(weeklyReportPeriod('2026-12-28'), {
    start: '2026-12-28T00:00:00+08:00',
    endExclusive: '2027-01-04T00:00:00+08:00',
  })
})
test('source normalization rejects ambiguous parent identity, invalid ids, kinds and over-limit selections', () => {
  const bug = { kind: 'bug', id: 3, testSpaceId: 2 }
  assert.deepEqual(normalizeWeeklyReportSources([bug, bug]), [bug])
  for (const refs of [
    [{ ...bug, id: '3' }],
    [{ ...bug, testSpaceId: 0 }],
    [bug, { ...bug, testSpaceId: 7 }],
    [{ ...bug, kind: 'unknown' }],
    Array(81).fill(bug),
  ])
    assert.throws(() => normalizeWeeklyReportSources(refs))
})
test('tester candidates query only authorized test spaces and never project resources', async () => {
  const { client, calls } = mockClient()
  const result = await loadWeeklyReportSources(client, params)
  assert.deepEqual(
    new Set(result.allowedSourceKinds),
    new Set(['test_plan', 'bug']),
  )
  assert.equal(calls.length, 2)
  for (const call of calls) {
    assert.match(call.sql, /space.organization_id = \$1::bigint/)
    assert.match(call.sql, /test_space_memberships/)
    assert.match(call.sql, /status = 'active'/)
    assert.doesNotMatch(call.sql, /from todos|from project_package_events/)
    assert.deepEqual(call.args, [
      7,
      9,
      '2026-09-07T00:00:00+08:00',
      '2026-09-14T00:00:00+08:00',
      null,
      true,
    ])
  }
  const bugSql = calls.find((call) =>
    call.sql.includes('from test_bugs bug'),
  )!.sql
  assert.match(bugSql, /bug.status in \('in_progress', 'closed'\)/)
  assert.match(bugSql, /order by e.created_at desc, e.id desc limit 1/)
  assert.match(bugSql, /\(stop.created_at, stop.id\) > \(e.created_at, e.id\)/)
  assert.doesNotMatch(bugSql, /event_type = 'comment'/)
  const planSql = calls.find((call) =>
    call.sql.includes('from test_plans plan'),
  )!.sql
  assert.match(planSql, /executed_by_user_id = \$2::bigint/)
  assert.match(planSql, /pc.result <> 'untested'/)
  assert.match(planSql, /from test_plan_subjects/)
})
test('saved references are checked independently of candidate limits and unauthorized ids are never locked', async () => {
  const { client, calls } = mockClient()
  await assert.rejects(
    validateWeeklyReportSources(client, {
      ...params,
      refs: [{ kind: 'bug', id: 5, testSpaceId: 99 }],
      lock: true,
    }),
    /权限/,
  )
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args[4], [5])
  assert.doesNotMatch(calls[0].sql, /limit 121|for update/)
  await assert.rejects(
    validateWeeklyReportSources(client, {
      ...params,
      refs: [{ kind: 'todo', id: 1, projectId: 2 }],
    }),
    /身份/,
  )
  assert.equal(calls.length, 1)
})
test('candidate truncation is explicit and matched dates come from query evidence', async () => {
  const row = {
    id: '1',
    parent_id: '2',
    parent_name: '空间',
    title: 'Bug',
    status: 'closed',
    date: '2026-09-10T08:00:00+08:00',
    related_to_me: true,
  }
  const { client } = mockClient(
    Array.from({ length: 121 }, (_, i) => ({ ...row, id: String(i + 1) })),
  )
  const result = await loadWeeklyReportSources(client, {
    ...params,
    profile: 'developer',
  })
  assert.equal(
    result.sources.filter((source) => source.kind === 'bug').length,
    120,
  )
  assert.equal(result.truncated.bug, true)
  assert.equal(result.sources[0].matchedDate, '2026-09-10')
})
test('legacy conversion preserves field text and leaves every percentage unset; ambiguous Markdown stays raw', () => {
  const raw =
    '## 本周重点工作目标：\n\n目标\n\n---\n\n## 事项一：接口验证\n\n- 本周进展：第一行\n第二行\n- 风险问题：需要协作\n- 下周计划：继续回归'
  const doc = convertLegacyWeeklyReport(raw, 'tester')!
  assert.ok(doc)
  assert.equal(doc.items[0].tasks[0].description, '第一行\n第二行')
  assert.equal(doc.items[0].tasks[0].progressPercent, null)
  assert.equal(doc.items[0].risk, '需要协作')
  assert.ok(parseWeeklyReportDocument(serializeWeeklyReportDocument(doc)))
  for (const invalid of [
    '自由格式',
    raw + '\n- 本周进展：额外内容',
    raw.replace('第一行', '```ts\n第一行\n```'),
    raw + '\n## 其他标题',
  ])
    assert.equal(convertLegacyWeeklyReport(invalid, 'developer'), null)
})
