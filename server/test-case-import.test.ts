import assert from 'node:assert/strict'
import test from 'node:test'
import { parseTestCaseCsv, TestCaseImportError } from './test-case-import.ts'

test('parses the supported Chinese CSV contract including quoted line breaks', () => {
  const csv = `\uFEFF用例名称,模块,所属模块,前置条件,步骤描述,预期结果,备注,用例等级\r\n"创建,并启动",账户模块,/DevBox/业务/创建,已登录,"[1] 点击创建\n[2] 点击启动",运行成功,覆盖AC-001,P0\r\n搜索,,/DevBox/业务/列表,存在数据,输入关键字,返回匹配项,,p2`
  const result = parseTestCaseCsv(csv)

  assert.equal(result.rows.length, 2)
  assert.equal(result.rows[0].title, '创建,并启动')
  assert.equal(result.rows[0].steps, '[1] 点击创建\n[2] 点击启动')
  assert.equal(result.rows[0].priority, 'high')
  assert.equal(result.rows[0].moduleName, '账户模块')
  assert.equal(result.rows[1].level, 'P2')
  assert.deepEqual(result.preview.levelCounts, { P0: 1, P1: 0, P2: 1 })
  assert.equal(result.preview.moduleCount, 2)
})

test('rejects missing headers and unsupported case levels', () => {
  assert.throws(
    () => parseTestCaseCsv('用例名称,模块\n用例A,'),
    (error) => error instanceof TestCaseImportError && error.message.includes('CSV 缺少字段'),
  )
  assert.throws(
    () => parseTestCaseCsv('用例名称,模块,所属模块,前置条件,步骤描述,预期结果,备注,用例等级\n用例A,,/模块A,,,结果,,P3'),
    (error) => error instanceof TestCaseImportError && error.message.includes('P0、P1 或 P2'),
  )
})
