import {
  createDirectoryIndex,
  encodeRootDirectoryPath,
} from '../shared/test-case-directories.ts'
import { testCaseCsvHeaders, testCaseTypeLabels } from '../shared/test-case-csv.ts'
import type { TestCase, TestCaseFolder, TestSubject } from './test-workbench-types.ts'

export { testCaseCsvFieldGuidance, testCaseCsvHeaders } from '../shared/test-case-csv.ts'

export function buildTestCaseCsv(
  cases: TestCase[],
  folders: TestCaseFolder[],
  subjects: TestSubject[],
) {
  const index = createDirectoryIndex(folders)
  const levels = { high: 'P0', medium: 'P1', low: 'P2' }
  const rows = cases.map((item) => {
    const subject = subjects.find((candidate) => candidate.id === item.testSubjectId)
    if (!subject) throw new Error('导出用例的一级目录不存在。')
    const path = index.path(item.folderId ?? null)
    if (path.some((folder) => folder.testSubjectId !== item.testSubjectId))
      throw new Error('导出用例的目录范围无效。')
    return [
      item.csvCaseId || `CASE-${item.id}`,
      item.title,
      item.moduleName || '',
      encodeRootDirectoryPath(
        [
          ...(subject.directoryRoot ? [] : [subject.name]),
          ...path.map((folder) => folder.name),
        ],
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
