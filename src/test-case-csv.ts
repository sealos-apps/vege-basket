import {
  createDirectoryIndex,
  encodeDirectoryPath,
} from '../shared/test-case-directories.ts'
import type { TestCase, TestCaseFolder } from './test-workbench-types.ts'

export const testCaseCsvHeaders = [
  '用例名称',
  '所属模块',
  '前置条件',
  '步骤描述',
  '预期结果',
  '备注',
  '用例等级',
  '自定义标签',
  '目录路径',
]
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
      item.title,
      path.map((folder) => folder.name).join(' / ') || '未分类',
      item.preconditions,
      item.steps,
      item.expectedResult,
      item.remarks,
      levels[item.priority],
      item.customTags.join('、'),
      encodeDirectoryPath(
        path.slice(rootPath.length).map((folder) => folder.name),
      ),
    ]
  })
  return `\uFEFF${[testCaseCsvHeaders, ...rows].map((row) => row.map((value) => `"${value.replace(/"/gu, '""')}"`).join(',')).join('\r\n')}\r\n`
}
