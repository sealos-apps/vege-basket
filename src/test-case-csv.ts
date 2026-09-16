import {
  createDirectoryIndex,
  encodeDirectoryPath,
} from '../shared/test-case-directories.ts'
import { testCaseCsvHeaders, testCaseTypeLabels } from '../shared/test-case-csv.ts'
import type { TestCase, TestCaseFolder } from './test-workbench-types.ts'

export { testCaseCsvFieldGuidance, testCaseCsvHeaders } from '../shared/test-case-csv.ts'

export function buildTestCaseCsv(
  cases: TestCase[],
  folders: TestCaseFolder[],
  rootId: number | null = null,
) {
  const index = createDirectoryIndex(folders)
  const rootPath = index.path(rootId)
  const levels = { high: 'P0', medium: 'P1', low: 'P2' }
  const rows = cases.map((item) => {
    const path = index.path(item.folderId ?? null)
    if (rootId !== null && !path.some((folder) => folder.id === rootId))
      throw new Error('导出用例不属于当前目录。')
    return [
      item.csvCaseId || `CASE-${item.id}`,
      item.title,
      item.moduleName || '',
      encodeDirectoryPath(
        path.slice(rootPath.length).map((folder) => folder.name),
      ),
      levels[item.priority],
      testCaseTypeLabels[item.caseType],
      item.preconditions,
      item.steps,
      item.expectedResult,
      item.remarks,
    ]
  })
  return `\uFEFF${[testCaseCsvHeaders, ...rows].map((row) => row.map((value) => `"${String(value ?? '').replace(/"/gu, '""')}"`).join(',')).join('\r\n')}\r\n`
}
