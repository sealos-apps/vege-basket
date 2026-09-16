import { parse } from 'csv-parse/sync'
import { decodeRootDirectoryPath } from '../shared/test-case-directories.ts'
import {
  testCaseCsvHeaders,
  testCaseTypeByLabel,
  type TestCaseCsvType,
} from '../shared/test-case-csv.ts'

const priorityByLevel = {
  P0: 'high',
  P1: 'medium',
  P2: 'low',
} as const

export type TestCaseImportRow = {
  caseType: TestCaseCsvType
  customTags: string[]
  expectedResult: string
  level: keyof typeof priorityByLevel
  moduleName: string
  directorySegments: string[]
  preconditions: string
  priority: (typeof priorityByLevel)[keyof typeof priorityByLevel]
  remarks: string
  rowNumber: number
  sourceId: string
  steps: string
  title: string
}

export type TestCaseImportIssue = {
  message: string
  rowNumber: number
  sourceId: string
  title: string
}

export type TestCaseImportPreview = {
  levelCounts: Record<keyof typeof priorityByLevel, number>
  moduleCount: number
  rowCount: number
  sampleTitles: string[]
  issues: TestCaseImportIssue[]
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

export function parseTestCaseCsv(csvText: string) {
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
  const missingHeaders = testCaseCsvHeaders.filter((header) => !headers.includes(header))
  const unknownHeaders = headers.filter((header) => !testCaseCsvHeaders.includes(header as (typeof testCaseCsvHeaders)[number]))
  if (missingHeaders.length || unknownHeaders.length) {
    const details = [
      missingHeaders.length ? `缺少：${missingHeaders.join('、')}` : '',
      unknownHeaders.length ? `多余：${unknownHeaders.join('、')}` : '',
    ].filter(Boolean).join('；')
    importError(`CSV 表头必须严格使用指定字段（${details}）。`)
  }
  if (headers.some((header, index) => header !== testCaseCsvHeaders[index])) {
    importError(`CSV 表头顺序必须为：${testCaseCsvHeaders.join('、')}。`)
  }
  const records = parsedRecords.filter((record) =>
    headers.some((header) => String(record[header] ?? '').trim()),
  )
  if (records.length === 0) importError('CSV 中没有可导入的用例。')
  if (records.length > 1000) importError('单次最多导入 1000 条用例。')

  const issues: TestCaseImportIssue[] = []
  const rows = records.flatMap((record, index): TestCaseImportRow[] => {
    const rowNumber = index + 2
    const rawSourceId = String(record['用例ID'] ?? '').trim()
    const rawTitle = String(record['用例名称'] ?? '').trim()
    try {
      const sourceId = limited(record['用例ID'], 40, rowNumber, '用例ID')
      const title = limited(record['用例名称'], 160, rowNumber, '用例名称')
      const moduleName = limited(record['所属模块'], 160, rowNumber, '所属模块')
      const level = limited(record['用例等级'], 2, rowNumber, '用例等级').toUpperCase()
      const caseTypeLabel = limited(record['用例类型'], 10, rowNumber, '用例类型')
      const caseType = testCaseTypeByLabel[caseTypeLabel as keyof typeof testCaseTypeByLabel]
      if (sourceId && !/^CASE-[1-9]\d*$/u.test(sourceId)) importError(`第 ${rowNumber} 行“用例ID”必须留空或使用 CASE-数字 格式。`)
      if (!title) importError(`第 ${rowNumber} 行“用例名称”不能为空。`)
      const directorySegments = decodeRootDirectoryPath(limited(record['用例目录'], 16000, rowNumber, '用例目录'))
      if (!(level in priorityByLevel)) {
        importError(`第 ${rowNumber} 行“用例等级”必须是 P0、P1 或 P2。`)
      }
      if (!caseType) importError(`第 ${rowNumber} 行“用例类型”必须是功能、回归、冒烟、安全或性能。`)
      const normalizedLevel = level as keyof typeof priorityByLevel
      return [{
        caseType,
        customTags: [],
        expectedResult: limited(record['预期结果'], 10000, rowNumber, '预期结果'),
        level: normalizedLevel,
        moduleName,
        directorySegments,
        preconditions: limited(record['前置条件'], 5000, rowNumber, '前置条件'),
        priority: priorityByLevel[normalizedLevel],
        remarks: limited(record['备注'], 5000, rowNumber, '备注'),
        rowNumber,
        sourceId,
        steps: limited(record['步骤描述'], 10000, rowNumber, '步骤描述'),
        title,
      }]
    } catch (error) {
      issues.push({
        message: error instanceof Error ? error.message.replace(/^第 \d+ 行/u, '').trim() : '字段内容无效。',
        rowNumber,
        sourceId: rawSourceId,
        title: rawTitle,
      })
      return []
    }
  })

  const duplicateIds = new Set<string>()
  const seenIds = new Set<string>()
  for (const row of rows) {
    if (!row.sourceId) continue
    if (seenIds.has(row.sourceId)) duplicateIds.add(row.sourceId)
    seenIds.add(row.sourceId)
  }
  const validRows = rows.filter((row) => {
    if (!duplicateIds.has(row.sourceId)) return true
    issues.push({
      message: '“用例ID”在当前 CSV 中重复。',
      rowNumber: row.rowNumber,
      sourceId: row.sourceId,
      title: row.title,
    })
    return false
  })

  return {
    preview: buildTestCaseImportPreview(validRows, issues),
    rows: validRows,
  }
}

export function buildTestCaseImportPreview(rows: TestCaseImportRow[], issues: TestCaseImportIssue[] = []): TestCaseImportPreview {
  const levelCounts: TestCaseImportPreview['levelCounts'] = { P0: 0, P1: 0, P2: 0 }
  for (const row of rows) levelCounts[row.level] += 1
  return {
    levelCounts,
    issues,
    moduleCount: new Set(rows.map((row) => row.moduleName).filter(Boolean)).size,
    rowCount: rows.length + issues.length,
    sampleTitles: rows.slice(0, 5).map((row) => row.title),
  }
}
