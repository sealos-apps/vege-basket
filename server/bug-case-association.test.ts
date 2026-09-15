import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

process.env.APP_ENCRYPTION_ACTIVE_KEY_ID = 'test'
process.env.APP_ENCRYPTION_KEYS = `test:${Buffer.alloc(32, 19).toString('base64')}`
const { encryptText } = await import('./crypto.ts')
const { serializeBugCaseDirectory, bugCaseDirectoryJoinSql } = await import('./bug-case-directory.ts')
const source = readFileSync(new URL('./test-workbench.ts', import.meta.url), 'utf8')
const client = readFileSync(new URL('../src/components/test-workbench.tsx', import.meta.url), 'utf8')
const schema = readFileSync(new URL('./schema.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('./migrations/20260914_test_workbench_modules_optional_bugs.sql', import.meta.url), 'utf8')

test('Bug directory metadata decrypts ordered ancestry without exposing envelopes', () => {
  const result = serializeBugCaseDirectory([{ id: 10, name: encryptText('账户') }, { id: 11, name: encryptText('登录') }])
  assert.deepEqual(result, {
    testCaseDirectoryPath: [{ id: 10, name: '账户' }, { id: 11, name: '登录' }],
    testCaseFolderName: '账户 / 登录',
  })
  assert.deepEqual(serializeBugCaseDirectory(null), { testCaseDirectoryPath: [], testCaseFolderName: undefined })
  assert.match(bugCaseDirectoryJoinSql, /parent.test_space_id = linked_case.test_space_id/)
  assert.match(bugCaseDirectoryJoinSql, /parent.test_subject_id = linked_case.test_subject_id/)
  assert.match(bugCaseDirectoryJoinSql, /not parent.id = any\(child.visited\)/)
})

test('bootstrap and migration keep Bug case and subject associations optional while preserving FKs', () => {
  assert.match(schema, /organization_module_id bigint[\s\S]*references organization_project_modules\(id\) on delete set null/)
  assert.match(schema, /alter column test_case_id drop not null/)
  assert.match(schema, /alter column test_subject_id drop not null/)
  assert.match(schema, /create or replace function enforce_test_bug_case\(\)/)
  assert.match(migration, /alter table test_bugs[\s\S]*alter column test_case_id drop not null/)
  assert.match(migration, /alter table test_bugs[\s\S]*alter column test_subject_id drop not null/)
  assert.match(migration, /drop trigger if exists test_bugs_require_case on test_bugs/)
  assert.match(migration, /organization_module_id bigint/)
})

test('create and edit allow standalone Bugs while validating optional canonical cases', () => {
  const create = source.slice(source.indexOf("router.post('/test-spaces/:spaceId/bugs'"), source.indexOf("router.post('/test-spaces/:spaceId/bugs/:bugId/transfer-space'"))
  assert.match(create, /positiveId\(request.body.testCaseId\)/)
  assert.match(create, /const requestedSubjectId = positiveId\(request.body.testSubjectId\)/)
  assert.match(create, /const requestedModuleValue = request.body.moduleId/)
  assert.match(create, /Number\(execution.rows\[0\].test_case_id\) !== caseId/)
  assert.ok(create.indexOf('await lockTestCaseSpace') < create.indexOf('select test_subject_id, organization_module_id from test_cases'))
  assert.match(client, /const caseLocked = !editing && Boolean\(seed.testPlanCaseId\)/)
  assert.match(source, /历史 Bug 补关联：原计划/)
  assert.match(source, /if \(sources.some\(\(source\) => source.categories.includes\('bugs'\)\) && !targetCase\)/)
  assert.doesNotMatch(source, /scopeBugs/)
})
