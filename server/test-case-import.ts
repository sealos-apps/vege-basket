import { parse } from 'csv-parse/sync'
import { decodeDirectoryPath, directoryName, type TestCaseDirectoryMode } from '../shared/test-case-directories.ts'

const requiredHeaders = [
  '用例名称',
  '所属模块',
  '前置条件',
  '步骤描述',
  '预期结果',
  '备注',
  '用例等级',
] as const

const priorityByLevel = {
  P0: 'high',
  P1: 'medium',
  P2: 'low',
} as const

export type TestCaseImportRow = {
  customTags: string[]
  expectedResult: string
  level: keyof typeof priorityByLevel
  modulePath: string
  directorySegments: string[]
  preconditions: string
  priority: (typeof priorityByLevel)[keyof typeof priorityByLevel]
  remarks: string
  steps: string
  title: string
}

export type TestCaseImportPreview = {
  levelCounts: Record<keyof typeof priorityByLevel, number>
  moduleCount: number
  rowCount: number
  sampleTitles: string[]
  targetPath?: string
  newDirectoryCount?: number
  reusedDirectoryCount?: number
  samplePaths?: string[]
}

export class TestCaseImportError extends Error {
  status = 400
}

function importError(message: string): never {
  throw new TestCaseImportError(message)
}

function limited(value: unknown, maxLength: number, rowNumber: number, field: string) {
  const normalized = String(value ?? '').trim()
  if (normalized.length > maxLength) {
    importError(`第 ${rowNumber} 行“${field}”超过 ${maxLength} 个字符。`)
  }
  return normalized
}

function parseTags(value: unknown, rowNumber: number) {
  const raw = limited(value, 500, rowNumber, '自定义标签')
  if (!raw) return []
  return Array.from(new Set(raw.split(/[,，;；、\s]+/).map((item) => item.trim()).filter(Boolean)))
    .slice(0, 12)
    .map((item) => item.slice(0, 40))
}

export function parseTestCaseCsv(csvText: string, directoryMode: TestCaseDirectoryMode = 'legacy') {
  if (!csvText.trim()) importError('CSV 文件为空。')

  let headers: string[] = []
  let parsedRecords: Array<Record<string, string>>
  try {
    parsedRecords = parse(csvText, {
      bom: true,
      columns: (rawHeaders: string[]) => {
        headers = rawHeaders.map((header) => String(header ?? '').trim())
        return headers
      },
      relax_column_count: false,
      skip_empty_lines: true,
      trim: true,
    })
  } catch {
    importError('CSV 格式无法解析，请检查引号、逗号和换行是否完整。')
  }

  if (new Set(headers).size !== headers.length) {
    importError('CSV 表头存在重复字段。')
  }
  const missingHeaders = requiredHeaders.filter((header) => (header !== '所属模块' || directoryMode === 'legacy') && !headers.includes(header))
  if (directoryMode === 'tree' && !headers.includes('目录路径') && !headers.includes('所属模块')) importError('CSV 缺少字段：目录路径或所属模块。')
  if (missingHeaders.length > 0) {
    importError(`CSV 缺少字段：${missingHeaders.join('、')}。`)
  }
  const records = parsedRecords.filter((record) =>
    headers.some((header) => String(record[header] ?? '').trim()),
  )
  if (records.length === 0) importError('CSV 中没有可导入的用例。')
  if (records.length > 1000) importError('单次最多导入 1000 条用例。')

  const rows = records.map((record, index): TestCaseImportRow => {
    const rowNumber = index + 2
    const title = limited(record['用例名称'], 160, rowNumber, '用例名称')
    const modulePath = limited(record['所属模块'], directoryMode === 'legacy' ? 240 : 16000, rowNumber, '所属模块')
    const level = limited(record['用例等级'], 2, rowNumber, '用例等级').toUpperCase()
    if (!title) importError(`第 ${rowNumber} 行“用例名称”不能为空。`)
    if (directoryMode === 'legacy' && !modulePath) importError(`第 ${rowNumber} 行“所属模块”不能为空。`)
    const directorySegments = directoryMode === 'current' ? []
      : directoryMode === 'tree' && headers.includes('目录路径')
        ? decodeDirectoryPath(limited(record['目录路径'], 16000, rowNumber, '目录路径'))
        : modulePath ? [directoryName(modulePath)] : []
    if (!(level in priorityByLevel)) {
      importError(`第 ${rowNumber} 行“用例等级”必须是 P0、P1 或 P2。`)
    }
    const normalizedLevel = level as keyof typeof priorityByLevel
    return {
      customTags: parseTags(record['自定义标签'] ?? record['标签'], rowNumber),
      expectedResult: limited(record['预期结果'], 10000, rowNumber, '预期结果'),
      level: normalizedLevel,
      modulePath,
      directorySegments,
      preconditions: limited(record['前置条件'], 5000, rowNumber, '前置条件'),
      priority: priorityByLevel[normalizedLevel],
      remarks: limited(record['备注'], 5000, rowNumber, '备注'),
      steps: limited(record['步骤描述'], 10000, rowNumber, '步骤描述'),
      title,
    }
  })

  return {
    preview: buildTestCaseImportPreview(rows),
    rows,
  }
}

export function buildTestCaseImportPreview(rows: TestCaseImportRow[]): TestCaseImportPreview {
  const levelCounts: TestCaseImportPreview['levelCounts'] = { P0: 0, P1: 0, P2: 0 }
  for (const row of rows) levelCounts[row.level] += 1
  return {
    levelCounts,
    moduleCount: new Set(rows.map((row) => row.modulePath)).size,
    rowCount: rows.length,
    sampleTitles: rows.slice(0, 5).map((row) => row.title),
  }
}
