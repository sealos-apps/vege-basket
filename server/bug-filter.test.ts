import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  createDefaultBugFilterConditions,
  getDefaultBugFilterValue,
  matchesBugFilterConditions,
  normalizeBugFilterCondition,
  type BugFilterCondition,
} from '../src/components/bug-filter.ts'
import type { TestBug } from '../src/test-workbench-types.ts'

const filterDialogSource = readFileSync(new URL('../src/components/bug-filter-builder-dialog.tsx', import.meta.url), 'utf8')
const testWorkbenchSource = readFileSync(new URL('../src/components/test-workbench.tsx', import.meta.url), 'utf8')

const baseBug: TestBug = {
  actualResult: '页面返回 500',
  assigneeName: '开发甲',
  assigneeUserId: 11,
  comments: [],
  createdAt: '2026-08-04T12:30:00.000Z',
  environment: 'Chrome 128',
  events: [],
  expectedResult: '保存成功',
  id: 6,
  priority: 'high',
  reporterName: '测试乙',
  reporterUserId: 12,
  reproductionSteps: '打开页面并保存',
  severity: 'critical',
  status: 'assigned',
  testPlanId: 22,
  testPlanName: '8 月回归',
  testSpaceId: 30,
  testSpaceName: '控制台',
  testSubjectId: 21,
  testSubjectName: '用户管理',
  testCaseId: 41,
  testCaseTitle: '保存用户',
  testCaseFolderId: 51,
  testCaseFolderName: '用户/编辑',
  testCaseDirectoryPath: [{ id: 50, name: '用户' }, { id: 51, name: '编辑' }],
  title: '保存用户时报错',
  updatedAt: '2026-08-04T13:00:00.000Z',
}

function condition(
  field: BugFilterCondition['field'],
  operator: BugFilterCondition['operator'],
  value: string,
): BugFilterCondition {
  return { field, id: `${field}-${operator}`, operator, value }
}

test('linked directory and case filters are one atomic group under OR', () => {
  const scope: BugFilterCondition = { id: 'scope', field: 'caseScope', operator: 'equals', folderId: '50', value: '41' }
  assert.equal(matchesBugFilterConditions(baseBug, [scope], 'and'), true)
  assert.equal(matchesBugFilterConditions({ ...baseBug, testCaseId: 42 }, [scope], 'and'), false)
  assert.equal(matchesBugFilterConditions(baseBug, [{ ...scope, folderId: '99' }], 'and'), false)
  assert.equal(matchesBugFilterConditions(baseBug, [{ ...scope, value: 'all' }], 'and'), true)
  assert.equal(matchesBugFilterConditions(baseBug, [{ ...scope, value: '42' }, condition('status', 'equals', 'closed')], 'or'), false)
  assert.equal(matchesBugFilterConditions(baseBug, [{ ...scope, value: '42' }, condition('status', 'equals', 'assigned')], 'or'), true)
  assert.equal(matchesBugFilterConditions(baseBug, [{ ...scope, value: 'all', folderId: 'all' }, condition('status', 'equals', 'closed')], 'or'), false)
  assert.equal(matchesBugFilterConditions({ ...baseBug, testCaseId: undefined }, [condition('caseLink', 'equals', 'unlinked')], 'and'), true)
  assert.equal(matchesBugFilterConditions(baseBug, [condition('caseLink', 'equals', 'unlinked')], 'and'), false)
})

test('bug filters match linked test fields and people by stable ids', () => {
  assert.equal(matchesBugFilterConditions(baseBug, [
    condition('testCase', 'equals', '41'),
    condition('caseFolder', 'equals', '51'),
    condition('testPlan', 'equals', '22'),
    condition('reporter', 'equals', '12'),
    condition('assignee', 'equals', '11'),
  ], 'and'), true)
  assert.equal(matchesBugFilterConditions(baseBug, [
    condition('testCase', 'equals', '99'),
    condition('testPlan', 'equals', '22'),
  ], 'and'), false)
})

test('directory filters follow current case folders and distinguish legacy Bugs from uncategorized cases', () => {
  const filter = [condition('caseFolder', 'equals', '51')]
  assert.equal(matchesBugFilterConditions(baseBug, filter, 'and'), true)
  assert.equal(matchesBugFilterConditions({ ...baseBug, testCaseFolderId: 52, testCaseDirectoryPath: [{ id: 52, name: '编辑' }] }, filter, 'and'), false)
  assert.equal(matchesBugFilterConditions(baseBug, [condition('caseFolder', 'equals', '50')], 'and'), true)
  assert.equal(matchesBugFilterConditions(baseBug, [condition('caseFolder', 'not_equals', '50')], 'and'), false)
  const uncategorized = { ...baseBug, testCaseFolderId: undefined, testCaseFolderName: undefined, testCaseDirectoryPath: [] }
  const legacy = { ...uncategorized, testCaseId: undefined, testCaseTitle: undefined }
  assert.equal(matchesBugFilterConditions(uncategorized, [condition('caseFolder', 'equals', 'uncategorized')], 'and'), true)
  assert.equal(matchesBugFilterConditions(legacy, [condition('caseFolder', 'equals', 'uncategorized')], 'and'), false)
  assert.equal(matchesBugFilterConditions(legacy, [condition('caseFolder', 'equals', 'unlinked')], 'and'), true)
  assert.equal(matchesBugFilterConditions(legacy, [condition('testCase', 'is_empty', '')], 'and'), true)
  assert.equal(matchesBugFilterConditions(baseBug, [condition('testCase', 'is_empty', '')], 'and'), false)
})

test('bug filters support status, text, date range, and or matching', () => {
  assert.equal(matchesBugFilterConditions(baseBug, [
    condition('status', 'equals', 'assigned'),
    condition('title', 'contains', '用户'),
    condition('createdAt', 'between', '2026-08-01..2026-08-05'),
  ], 'and'), true)
  assert.equal(matchesBugFilterConditions(baseBug, [
    condition('severity', 'equals', 'minor'),
    condition('environment', 'contains', 'chrome'),
  ], 'or'), true)
})

test('Bug 工作台 starts with a non-closed status filter', () => {
  const [defaultCondition] = createDefaultBugFilterConditions()
  assert.deepEqual(defaultCondition, {
    field: 'status',
    id: defaultCondition.id,
    operator: 'not_equals',
    value: 'closed',
  })
  assert.equal(matchesBugFilterConditions(baseBug, [defaultCondition], 'and'), true)
  assert.equal(matchesBugFilterConditions({ ...baseBug, status: 'closed' }, [defaultCondition], 'and'), false)
  assert.match(testWorkbenchSource, /const \[filterConditions, setFilterConditions\] = useState<BugFilterCondition\[\]\s*>\(createDefaultBugFilterConditions\)/u)
})

test('pending confirmation filter covers unassigned and assigned confirmation states', () => {
  const pendingAssigneeConfirmation: TestBug = { ...baseBug, status: 'pending_confirmation' }
  const pendingTriage: TestBug = { ...baseBug, assigneeName: undefined, assigneeUserId: undefined, status: 'new' }
  const pendingFilter = [condition('status', 'equals', 'new')]
  assert.equal(matchesBugFilterConditions(pendingAssigneeConfirmation, pendingFilter, 'and'), true)
  assert.equal(matchesBugFilterConditions(pendingTriage, pendingFilter, 'and'), true)
  assert.equal(matchesBugFilterConditions(baseBug, pendingFilter, 'and'), false)
  assert.equal(matchesBugFilterConditions(pendingAssigneeConfirmation, [
    condition('status', 'not_equals', 'new'),
  ], 'and'), false)
})

test('Bug status UI exposes one pending confirmation option and upgrades old filters', () => {
  assert.equal(getDefaultBugFilterValue('status', 'equals'), 'new')
  assert.equal(normalizeBugFilterCondition(
    condition('status', 'equals', 'pending_confirmation'),
  ).value, 'new')
  assert.equal(normalizeBugFilterCondition(
    condition('status', 'equals', 'confirmed'),
  ).value, 'new')
  assert.match(filterDialogSource, /\{ label: '待确认', value: 'new' \}/u)
  assert.doesNotMatch(filterDialogSource, /已确认/u)
  assert.doesNotMatch(filterDialogSource, /待确定/u)

  const expectedStatusOrder = [
    "{ label: '待确认', value: 'new' }",
    "{ label: '待修复', value: 'assigned' }",
    "{ label: '修复中', value: 'in_progress' }",
    "{ label: '待验证', value: 'pending_verification' }",
    "{ label: '已驳回', value: 'rejected' }",
    "{ label: '已关闭', value: 'closed' }",
  ]
  let previousIndex = -1
  for (const option of expectedStatusOrder) {
    const index = filterDialogSource.indexOf(option)
    assert.ok(index > previousIndex, `${option} should appear after the previous status option`)
    previousIndex = index
  }
})

test('bug filters distinguish unassigned and unplanned bugs', () => {
  const unassignedBug: TestBug = {
    ...baseBug,
    assigneeName: undefined,
    assigneeUserId: undefined,
    testPlanId: undefined,
    testPlanName: undefined,
  }
  assert.equal(matchesBugFilterConditions(unassignedBug, [
    condition('assignee', 'is_empty', ''),
    condition('testPlan', 'is_empty', ''),
  ], 'and'), true)
  assert.equal(matchesBugFilterConditions(baseBug, [
    condition('assignee', 'is_empty', ''),
  ], 'and'), false)
})
