import type { TestBug } from '../test-workbench-types'

export type BugFilterJoin = 'and' | 'or'
export type BugFilterField =
  | 'title'
  | 'testSpace'
  | 'testCase'
  | 'caseFolder'
  | 'caseScope'
  | 'caseLink'
  | 'testPlan'
  | 'reporter'
  | 'assignee'
  | 'createdAt'
  | 'status'
  | 'severity'
  | 'priority'
  | 'environment'
export type BugFilterOperator =
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'is_empty'
  | 'is_not_empty'
  | 'before'
  | 'after'
  | 'between'
export type BugFilterCondition = {
  field: BugFilterField
  id: string
  operator: BugFilterOperator
  value: string
  folderId?: string
}

export const bugFilterFieldLabels: Record<BugFilterField, string> = {
  title: 'Bug 标题',
  testSpace: '测试空间',
  testCase: '测试用例',
  caseFolder: '用例目录',
  caseScope: '用例目录与用例',
  caseLink: '用例关联状态',
  testPlan: '测试计划',
  reporter: '创建人',
  assignee: '指派人',
  createdAt: '创建时间',
  status: 'Bug 状态',
  severity: '严重程度',
  priority: '优先级',
  environment: '运行环境',
}

export const bugFilterOperatorLabels: Record<BugFilterOperator, string> = {
  contains: '包含',
  not_contains: '不包含',
  equals: '等于',
  not_equals: '不等于',
  is_empty: '为空',
  is_not_empty: '不为空',
  before: '早于',
  after: '晚于',
  between: '介于',
}

export const bugFilterFields: BugFilterField[] = [
  'title',
  'testSpace',
  'caseScope',
  'caseLink',
  'testPlan',
  'reporter',
  'assignee',
  'createdAt',
  'status',
  'severity',
  'priority',
  'environment',
]

export const bugFilterOperatorsByField: Record<BugFilterField, BugFilterOperator[]> = {
  title: ['contains', 'not_contains', 'equals', 'not_equals'],
  testSpace: ['equals', 'not_equals'],
  testCase: ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
  caseFolder: ['equals', 'not_equals'],
  caseScope: ['equals', 'not_equals'],
  caseLink: ['equals', 'not_equals'],
  testPlan: ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
  reporter: ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
  assignee: ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
  createdAt: ['equals', 'not_equals', 'before', 'after', 'between'],
  status: ['equals', 'not_equals'],
  severity: ['equals', 'not_equals'],
  priority: ['equals', 'not_equals'],
  environment: ['contains', 'not_contains', 'equals', 'not_equals', 'is_empty', 'is_not_empty'],
}

export function getBugFilterTodayStamp() {
  return new Date().toISOString().slice(0, 10)
}

export function getDefaultBugFilterValue(
  field: BugFilterField,
  operator: BugFilterOperator,
) {
  if (operator === 'is_empty' || operator === 'is_not_empty') return ''
  if (field === 'createdAt' && operator === 'between') {
    const today = getBugFilterTodayStamp()
    return `${today}..${today}`
  }
  if (field === 'createdAt') return getBugFilterTodayStamp()
  if (field === 'status') return 'new'
  if (field === 'severity') return 'major'
  if (field === 'priority') return 'medium'
  if (field === 'caseScope') return 'all'
  if (field === 'caseLink') return 'unlinked'
  return ''
}

export function createBugFilterCondition(
  field: BugFilterField = 'status',
): BugFilterCondition {
  const operator = bugFilterOperatorsByField[field][0]
  return {
    field,
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    operator,
    value: getDefaultBugFilterValue(field, operator),
  }
}

export function createDefaultBugFilterConditions(): BugFilterCondition[] {
  return [{
    ...createBugFilterCondition('status'),
    operator: 'not_equals',
    value: 'closed',
  }]
}

export function parseBugFilterDateRange(value: string) {
  const [rawStart, rawEnd] = value.split('..')
  const start = rawStart || getBugFilterTodayStamp()
  const end = rawEnd || start
  return start <= end ? { start, end } : { start: end, end: start }
}

export function normalizeBugFilterCondition(
  condition: BugFilterCondition,
): BugFilterCondition {
  if (condition.field === 'caseFolder' && condition.value === 'unlinked') {
    return { ...condition, field: 'caseLink' }
  }
  const allowedOperators = bugFilterOperatorsByField[condition.field]
  const operator = allowedOperators.includes(condition.operator)
    ? condition.operator
    : allowedOperators[0]
  const value = condition.field === 'status' && (
    condition.value === 'pending_confirmation' || condition.value === 'confirmed'
  )
    ? 'new'
    : condition.value
  return {
    ...condition,
    operator,
    value: value || getDefaultBugFilterValue(condition.field, operator),
  }
}

function getFieldValue(bug: TestBug, field: BugFilterField) {
  if (field === 'caseLink') return bug.testCaseId ? 'linked' : 'unlinked'
  if (field === 'title') return bug.title
  if (field === 'testSpace') return String(bug.testSpaceId)
  if (field === 'testCase') return bug.testCaseId ? String(bug.testCaseId) : ''
  if (field === 'caseFolder') return bug.testCaseId ? (bug.testCaseFolderId ? String(bug.testCaseFolderId) : 'uncategorized') : 'unlinked'
  if (field === 'testPlan') return bug.testPlanId ? String(bug.testPlanId) : ''
  if (field === 'reporter') return bug.reporterUserId ? String(bug.reporterUserId) : ''
  if (field === 'assignee') return bug.assigneeUserId ? String(bug.assigneeUserId) : ''
  if (field === 'createdAt') return bug.createdAt.slice(0, 10)
  if (field === 'status') return bug.status
  if (field === 'severity') return bug.severity
  if (field === 'priority') return bug.priority
  return bug.environment
}

function matchesCondition(bug: TestBug, condition: BugFilterCondition): boolean {
  const normalized = normalizeBugFilterCondition(condition)
  if (normalized.field === 'caseScope') {
    const folder = normalized.folderId || 'all'
    const directoryMatches = folder === 'all' || matchesCondition(bug, {
      id: normalized.id, field: 'caseFolder', operator: 'equals', value: folder,
    })
    const caseMatches = normalized.value === 'all' || String(bug.testCaseId ?? '') === normalized.value
    const matches = directoryMatches && caseMatches
    return normalized.operator === 'not_equals' ? !matches : matches
  }
  const fieldValue = getFieldValue(bug, normalized.field)
  const targetValue = normalized.value

  if (normalized.operator === 'is_empty') return !fieldValue
  if (normalized.operator === 'is_not_empty') return Boolean(fieldValue)
  if (normalized.operator === 'contains') {
    return fieldValue.toLowerCase().includes(targetValue.trim().toLowerCase())
  }
  if (normalized.operator === 'not_contains') {
    return !fieldValue.toLowerCase().includes(targetValue.trim().toLowerCase())
  }
  const equalsTarget = normalized.field === 'caseFolder' && /^\d+$/.test(targetValue)
    ? fieldValue === targetValue || Boolean(bug.testCaseDirectoryPath?.some((folder) => String(folder.id) === targetValue))
    : normalized.field === 'status' && targetValue === 'new'
    ? fieldValue === 'new' || fieldValue === 'pending_confirmation'
    : fieldValue === targetValue
  if (normalized.operator === 'equals') return equalsTarget
  if (normalized.operator === 'not_equals') return !equalsTarget
  if (normalized.operator === 'before') return Boolean(fieldValue) && fieldValue < targetValue
  if (normalized.operator === 'after') return Boolean(fieldValue) && fieldValue > targetValue
  if (normalized.operator === 'between') {
    const range = parseBugFilterDateRange(targetValue)
    return Boolean(fieldValue) && fieldValue >= range.start && fieldValue <= range.end
  }
  return true
}

export function matchesBugFilterConditions(
  bug: TestBug,
  conditions: BugFilterCondition[],
  join: BugFilterJoin,
) {
  const activeConditions = conditions.filter((condition) => {
    const normalized = normalizeBugFilterCondition(condition)
    if (normalized.field === 'caseScope' && normalized.value === 'all' && (!normalized.folderId || normalized.folderId === 'all')) return false
    return normalized.operator === 'is_empty' ||
      normalized.operator === 'is_not_empty' ||
      Boolean(normalized.value.trim())
  })
  if (activeConditions.length === 0) return true
  return join === 'and'
    ? activeConditions.every((condition) => matchesCondition(bug, condition))
    : activeConditions.some((condition) => matchesCondition(bug, condition))
}
