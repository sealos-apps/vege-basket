import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createWeeklyReportDocument,
  createWeeklyReportTask,
  getWeeklyReportProgress,
  combineWeeklyReportProgress,
  serializeWeeklyReportDocument,
  parseWeeklyReportDocument,
  weeklyReportTaskStatus,
  weeklyReportValidationError,
  prepareGeneratedWeeklyReport,
} from '../shared/weekly-report-document.ts'

for (const profile of ['developer', 'tester'] as const) {
  test(`${profile}: nested Markdown and whitespace survive a document round trip`, () => {
    const doc = createWeeklyReportDocument(profile)
    doc.goal = '  目标\n\n末行  '
    doc.items[0].title = '事项\n## 标题'
    doc.items[0].tasks[0] = {
      id: 'x',
      title: 'Task',
      description:
        '```ts\n## 事项 2\n##### 任务进度\n100%\n```\n> quote\n\n  trailing  ',
      progressPercent: 0,
    }
    const content = serializeWeeklyReportDocument(doc)
    const parsed = parseWeeklyReportDocument(content)!
    assert.equal(serializeWeeklyReportDocument(parsed), content)
    assert.equal(
      parsed.items[0].tasks[0].description,
      doc.items[0].tasks[0].description,
    )
    assert.equal(weeklyReportValidationError(parsed), null)
    assert.equal(parseWeeklyReportDocument(content + '\n额外内容'), null)
    assert.equal(
      parseWeeklyReportDocument(content.replace('\n0%\n', '\n0.5%\n')),
      null,
    )
    assert.equal(
      parseWeeklyReportDocument(content.replace('#### 任务 1', '#### 任务 2')),
      null,
    )
  })
}
test('progress averages every task, including zero, without averaging averages', () => {
  const doc = createWeeklyReportDocument('developer')
  doc.items[0].tasks = [100, 60, 0].map((p, i) => ({
    ...createWeeklyReportTask(String(i)),
    title: 'task',
    description: 'progress',
    progressPercent: p,
  }))
  const other = {
    ...doc.items[0],
    tasks: doc.items[0].tasks
      .slice(0, 2)
      .map((t, i) => ({ ...t, progressPercent: [100, 80][i] })),
  }
  assert.equal(
    getWeeklyReportProgress([...doc.items, other]).averagePercent,
    68,
  )
  assert.equal(
    combineWeeklyReportProgress([
      getWeeklyReportProgress(doc.items),
      getWeeklyReportProgress([other]),
    ]).averagePercent,
    68,
  )
  assert.equal(getWeeklyReportProgress([]).averagePercent, null)
  doc.items[0].tasks.push(createWeeklyReportTask('blank'))
  assert.equal(getWeeklyReportProgress(doc.items).taskCount, 3)
  doc.items[0].tasks.at(-1)!.title = 'partial'
  assert.equal(getWeeklyReportProgress(doc.items).missingProgressCount, 1)
  assert.ok(weeklyReportValidationError(doc))
})
test('task states track exact percentages including reverse transitions', () => {
  assert.deepEqual(
    [0, 1, 99, 100, 80, 0, null, -1, 101, 1.2].map(weeklyReportTaskStatus),
    [
      '未开始',
      '进行中',
      '进行中',
      '已完成',
      '进行中',
      '未开始',
      '待填写',
      '待填写',
      '待填写',
      '待填写',
    ],
  )
})

test('oversized drafts remain parseable so editing can recover without changing editor contracts', () => {
  const doc = createWeeklyReportDocument('tester')
  doc.items[0].tasks[0].description = '长'.repeat(12_001)
  const content = serializeWeeklyReportDocument(doc)
  assert.equal(
    parseWeeklyReportDocument(content)?.items[0].tasks[0].description.length,
    12_001,
  )
})

test('AI draft preparation never infers percentages from generated status or text', () => {
  const doc = createWeeklyReportDocument('tester')
  doc.items[0].tasks[0] = {
    id: '1',
    title: '回归',
    description: '全部通过',
    progressPercent: 100,
  }
  const content = serializeWeeklyReportDocument(doc)
  assert.equal(
    parseWeeklyReportDocument(prepareGeneratedWeeklyReport(content, 'tester')!)!
      .items[0].tasks[0].progressPercent,
    null,
  )
  assert.equal(prepareGeneratedWeeklyReport(content, 'developer'), null)
})
