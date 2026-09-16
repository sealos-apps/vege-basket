import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { testCaseCsvHeaders } from '../shared/test-case-csv.ts'
import { parseTestCaseCsv, TestCaseImportError } from './test-case-import.ts'

const testWorkbenchSource = readFileSync(new URL('./test-workbench.ts', import.meta.url), 'utf8')

function canonicalCsv(row: string) {
  return `\uFEFF${testCaseCsvHeaders.join(',')}\r\n${row}`
}

test('parses the strict Chinese CSV contract including ids, types and directory paths', () => {
  const csv = canonicalCsv('CASE-17,"创建,并启动",账户模块,DevBox/业务/创建,P0,冒烟,已登录,"[1] 点击创建\n[2] 点击启动",运行成功,覆盖AC-001')
  const result = parseTestCaseCsv(csv, 'tree')

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

test('strict CSV ignores its directory only in current-directory mode', () => {
  const result = parseTestCaseCsv(canonicalCsv(',搜索,,DevBox/列表,P2,性能,存在数据,输入关键字,返回匹配项,'), 'current')
  assert.deepEqual(result.rows[0].directorySegments, [])
  assert.equal(result.rows[0].caseType, 'performance')
})

test('rejects missing, extra, reordered and invalid strict CSV fields', () => {
  const validRow = ',用例A,,目录A,P1,功能,,,结果,'
  const missingHeader = testCaseCsvHeaders.filter((header) => header !== '备注').join(',')
  const reorderedHeaders = [testCaseCsvHeaders[1], testCaseCsvHeaders[0], ...testCaseCsvHeaders.slice(2)].join(',')
  assert.throws(
    () => parseTestCaseCsv(`${missingHeader}\n,用例A,,目录A,P1,功能,,,结果`, 'tree'),
    (error) => error instanceof TestCaseImportError && error.message.includes('缺少：备注'),
  )
  assert.throws(
    () => parseTestCaseCsv(`${testCaseCsvHeaders.join(',')},自定义标签\n${validRow},标签`, 'tree'),
    (error) => error instanceof TestCaseImportError && error.message.includes('多余：自定义标签'),
  )
  assert.throws(
    () => parseTestCaseCsv(`${reorderedHeaders}\n用例A,,,目录A,P1,功能,,,结果,`, 'tree'),
    (error) => error instanceof TestCaseImportError && error.message.includes('表头顺序'),
  )
  assert.throws(
    () => parseTestCaseCsv(canonicalCsv('17,用例A,,目录A,P1,功能,,,结果,'), 'tree'),
    (error) => error instanceof TestCaseImportError && error.message.includes('CASE-数字'),
  )
  assert.throws(
    () => parseTestCaseCsv(canonicalCsv(',用例A,,目录A,P3,功能,,,结果,'), 'tree'),
    (error) => error instanceof TestCaseImportError && error.message.includes('P0、P1 或 P2'),
  )
  assert.throws(
    () => parseTestCaseCsv(canonicalCsv(',用例A,,目录A,P1,兼容性,,,结果,'), 'tree'),
    (error) => error instanceof TestCaseImportError && error.message.includes('功能、回归、冒烟、安全或性能'),
  )
})

test('keeps the previous module and directory CSV format importable', () => {
  const csv = `\uFEFF用例名称,模块,所属模块,前置条件,步骤描述,预期结果,备注,用例等级,自定义标签,目录路径\r\n旧用例,账户模块,旧目录,前置,步骤,结果,备注,P2,核心,父级/子级`
  const result = parseTestCaseCsv(csv, 'tree')
  assert.equal(result.rows[0].sourceId, '')
  assert.equal(result.rows[0].moduleName, '账户模块')
  assert.equal(result.rows[0].caseType, 'functional')
  assert.deepEqual(result.rows[0].customTags, ['核心'])
  assert.deepEqual(result.rows[0].directorySegments, ['父级', '子级'])
})

test('case import persists the validated priority and type in their matching columns', () => {
  assert.match(testWorkbenchSource, /remarks, priority, case_type, custom_tags, status, created_by_user_id\)\s*values \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11, \$12, 'active', \$13\)/u)
  assert.match(testWorkbenchSource, /row\.priority, row\.caseType, encryptJson\(row\.customTags\), session\.userId/u)
})
