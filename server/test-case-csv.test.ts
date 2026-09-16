import assert from 'node:assert/strict'
import test from 'node:test'
import { parse } from 'csv-parse/sync'
import { testCaseCsvHeaders } from '../shared/test-case-csv.ts'
import { buildTestCaseCsv } from '../src/test-case-csv.ts'
import type { TestCase, TestCaseFolder } from '../src/test-workbench-types.ts'

const folders: TestCaseFolder[] = [
  { createdAt: '2026-09-16T00:00:00.000Z', id: 1, name: '父级', parentId: null, testSpaceId: 1, testSubjectId: 2 },
  { createdAt: '2026-09-16T00:00:00.000Z', id: 2, name: '子/级', parentId: 1, testSpaceId: 1, testSubjectId: 2 },
]

const testCase: TestCase = {
  canDelete: true,
  caseType: 'security',
  createdAt: '2026-09-16T00:00:00.000Z',
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

test('exports the strict ten-column CSV contract with a relative directory path', () => {
  const records = parse(buildTestCaseCsv([testCase], folders, 1), { bom: true }) as string[][]
  assert.deepEqual(records[0], [...testCaseCsvHeaders])
  assert.deepEqual(records[1], [
    'CASE-23',
    '保存账户',
    '账户模块',
    '子~1级',
    'P0',
    '安全',
    '已登录',
    '输入并保存',
    '保存成功',
    '覆盖异常输入',
  ])
})

test('exports an empty directory and module without synthetic placeholder values', () => {
  const records = parse(buildTestCaseCsv([{ ...testCase, folderId: undefined, moduleId: undefined, moduleName: undefined }], folders), { bom: true }) as string[][]
  assert.equal(records[1][2], '')
  assert.equal(records[1][3], '')
})
