import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { testCaseCsvHeaders } from '../shared/test-case-csv.ts'
import { parseTestCaseCsv, TestCaseImportError } from './test-case-import.ts'

const testWorkbenchSource = readFileSync(new URL('./test-workbench.ts', import.meta.url), 'utf8')
const schemaSource = readFileSync(new URL('./schema.ts', import.meta.url), 'utf8')
const migrationSource = readFileSync(new URL('./migrations/20260916_test_case_csv_root_paths.sql', import.meta.url), 'utf8')
const testWorkbenchClientSource = readFileSync(new URL('../src/components/test-workbench.tsx', import.meta.url), 'utf8')

function canonicalCsv(row: string) {
  return `\uFEFF${testCaseCsvHeaders.join(',')}\r\n${row}`
}

test('parses the strict Chinese CSV contract including ids, types and directory paths', () => {
  const csv = canonicalCsv('CASE-17,"创建,并启动",账户模块,~DevBox~业务~创建,P0,冒烟,已登录,"[1] 点击创建\n[2] 点击启动",运行成功,覆盖AC-001')
  const result = parseTestCaseCsv(csv)

  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].sourceId, 'CASE-17')
  assert.equal(result.rows[0].title, '创建,并启动')
  assert.equal(result.rows[0].steps, '[1] 点击创建\n[2] 点击启动')
  assert.equal(result.rows[0].priority, 'high')
  assert.equal(result.rows[0].caseType, 'smoke')
  assert.equal(result.rows[0].moduleName, '账户模块')
  assert.deepEqual(result.rows[0].directorySegments, ['DevBox', '业务', '创建'])
  assert.deepEqual(result.preview.levelCounts, { P0: 1, P1: 0, P2: 0 })
  assert.equal(result.preview.moduleCount, 1)
})

test('strict CSV always retains its complete root-based directory path', () => {
  const result = parseTestCaseCsv(canonicalCsv(',搜索,,~DevBox~列表,P2,性能,存在数据,输入关键字,返回匹配项,'))
  assert.deepEqual(result.rows[0].directorySegments, ['DevBox', '列表'])
  assert.equal(result.rows[0].caseType, 'performance')
})

test('strict CSV rejects non-empty directory paths without the root separator', () => {
  const result = parseTestCaseCsv(canonicalCsv(',搜索,,DevBox~列表,P2,性能,存在数据,输入关键字,返回匹配项,'))
  assert.equal(result.rows.length, 0)
  assert.match(result.preview.issues[0].message, /必须以 ~/u)
})

test('rejects missing, extra, reordered and invalid strict CSV fields', () => {
  const validRow = ',用例A,,~目录A,P1,功能,,,结果,'
  const missingHeader = testCaseCsvHeaders.filter((header) => header !== '备注').join(',')
  const reorderedHeaders = [testCaseCsvHeaders[1], testCaseCsvHeaders[0], ...testCaseCsvHeaders.slice(2)].join(',')
  assert.throws(
    () => parseTestCaseCsv(`${missingHeader}\n,用例A,,~目录A,P1,功能,,,结果`),
    (error) => error instanceof TestCaseImportError && error.message.includes('缺少：备注'),
  )
  assert.throws(
    () => parseTestCaseCsv(`${testCaseCsvHeaders.join(',')},自定义标签\n${validRow},标签`),
    (error) => error instanceof TestCaseImportError && error.message.includes('多余：自定义标签'),
  )
  assert.throws(
    () => parseTestCaseCsv(`${reorderedHeaders}\n用例A,,,~目录A,P1,功能,,,结果,`),
    (error) => error instanceof TestCaseImportError && error.message.includes('表头顺序'),
  )
  const invalid = parseTestCaseCsv(`${testCaseCsvHeaders.join(',')}\n17,用例A,,~目录A,P1,功能,,,结果,\n,用例B,,~目录A,P3,功能,,,结果,\n,用例C,,~目录A,P1,兼容性,,,结果,`)
  assert.equal(invalid.rows.length, 0)
  assert.equal(invalid.preview.issues.length, 3)
  assert.match(invalid.preview.issues[0].message, /CASE-数字/u)
  assert.match(invalid.preview.issues[1].message, /P0、P1 或 P2/u)
  assert.match(invalid.preview.issues[2].message, /功能、回归、冒烟、安全或性能/u)
})

test('rejects the previous module and directory CSV format', () => {
  const csv = `\uFEFF用例名称,模块,所属模块,前置条件,步骤描述,预期结果,备注,用例等级,自定义标签,目录路径\r\n旧用例,账户模块,旧目录,前置,步骤,结果,备注,P2,核心,父级/子级`
  assert.throws(
    () => parseTestCaseCsv(csv),
    (error) => error instanceof TestCaseImportError && error.message.includes('严格使用指定字段'),
  )
})

test('marks every occurrence of a repeated case ID as invalid', () => {
  const result = parseTestCaseCsv(`${testCaseCsvHeaders.join(',')}\nCASE-8,用例A,,~目录A,P1,功能,,,结果,\nCASE-8,用例B,,~目录B,P2,回归,,,结果,`)
  assert.equal(result.rows.length, 0)
  assert.equal(result.preview.issues.length, 2)
  assert.ok(result.preview.issues.every((issue) => issue.message.includes('重复')))
})

test('case import preflights create, update and invalid rows before writing', () => {
  assert.match(testWorkbenchSource, /existingCaseId: existing \? Number\(existing\.id\) : null/u)
  assert.match(testWorkbenchSource, /if \(inspection\.preview\.invalidCount > 0\)/u)
  assert.match(testWorkbenchSource, /update test_cases[\s\S]*test_subject_id = \$1[\s\S]*case_type = \$10/u)
  assert.match(testWorkbenchSource, /update test_bugs[\s\S]*test_subject_id = \$1[\s\S]*organization_module_id = \$2/u)
  assert.match(testWorkbenchSource, /created_by_user_id, csv_case_id/u)
})

test('database keeps stable CSV IDs unique and assigns collision-safe IDs to ordinary cases', () => {
  assert.match(schemaSource, /add column if not exists csv_case_id text/u)
  assert.match(schemaSource, /idx_test_cases_space_csv_case_id[\s\S]*test_space_id, csv_case_id/u)
  assert.match(schemaSource, /idx_test_subjects_one_directory_root[\s\S]*where is_directory_root/u)
  assert.match(schemaSource, /while exists \([\s\S]*existing\.csv_case_id = candidate[\s\S]*candidate := 'CASE-9'/u)
  assert.match(schemaSource, /test_bugs_case_scope_fkey[\s\S]*deferrable initially immediate/u)
  assert.match(migrationSource, /^-- Apply only[\s\S]*begin;[\s\S]*idx_test_cases_space_csv_case_id[\s\S]*test_bugs_case_scope_fkey[\s\S]*deferrable initially immediate;[\s\S]*commit;\s*$/u)
  assert.match(migrationSource, /Duplicate CSV case IDs exist within a test space/u)
})

test('import and export dialogs expose preflight details, field examples and selected-case export', () => {
  assert.match(testWorkbenchClientSource, /填写说明与字段示例/u)
  assert.match(testWorkbenchClientSource, /preview\.items\.map/u)
  assert.match(testWorkbenchClientSource, /preview\.invalidCount > 0/u)
  assert.match(testWorkbenchClientSource, /TabsTrigger value="filtered"/u)
  assert.match(testWorkbenchClientSource, /TabsTrigger value="selected"/u)
})
