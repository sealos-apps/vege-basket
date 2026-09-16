import assert from 'node:assert/strict'
import test from 'node:test'
import { parse } from 'csv-parse/sync'
import { testCaseCsvHeaders } from '../shared/test-case-csv.ts'
import { buildTestCaseCsv } from '../src/test-case-csv.ts'
import type { TestCase, TestCaseFolder, TestSubject } from '../src/test-workbench-types.ts'

const folders: TestCaseFolder[] = [
  { createdAt: '2026-09-16T00:00:00.000Z', id: 1, name: '父级', parentId: null, testSpaceId: 1, testSubjectId: 2 },
  { createdAt: '2026-09-16T00:00:00.000Z', id: 2, name: '子/级', parentId: 1, testSpaceId: 1, testSubjectId: 2 },
]
const subjects: TestSubject[] = [
  { canDelete: true, canEdit: true, createdAt: '', description: '', directoryRoot: false, id: 2, name: '账户', testSpaceId: 1 },
  { canDelete: false, canEdit: false, createdAt: '', description: '', directoryRoot: true, id: 3, name: '根目录', testSpaceId: 1 },
]

const testCase: TestCase = {
  canDelete: true,
  caseType: 'security',
  createdAt: '2026-09-16T00:00:00.000Z',
  csvCaseId: 'CASE-2846',
  customTags: ['不进入新格式'],
  expectedResult: '保存成功',
  folderId: 2,
  id: 23,
  moduleId: 5,
  moduleName: '账户模块',
  preconditions: '已登录',
  priority: 'high',
  remarks: '覆盖异常输入',
  status: 'active',
  steps: '输入并保存',
  testSpaceId: 1,
  testSubjectId: 2,
  title: '保存账户',
  updatedAt: '2026-09-16T00:00:00.000Z',
}

test('exports the strict ten-column CSV contract with a complete root-based directory path', () => {
  const records = parse(buildTestCaseCsv([testCase], folders, subjects), { bom: true }) as string[][]
  assert.deepEqual(records[0], [...testCaseCsvHeaders])
  assert.deepEqual(records[1], [
    'CASE-2846',
    '保存账户',
    '账户模块',
    '~账户~父级~子/级',
    'P0',
    '安全',
    '已登录',
    '输入并保存',
    '保存成功',
    '覆盖异常输入',
  ])
})

test('exports an empty directory and module without synthetic placeholder values', () => {
  const records = parse(buildTestCaseCsv([{ ...testCase, folderId: undefined, moduleId: undefined, moduleName: undefined, testSubjectId: 3 }], folders, subjects), { bom: true }) as string[][]
  assert.equal(records[1][2], '')
  assert.equal(records[1][3], '')
})
