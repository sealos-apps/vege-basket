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
const migration = readFileSync(new URL('./migrations/20260911_bug_test_case_association.sql', import.meta.url), 'utf8')

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

test('bootstrap and migration preserve legacy rows while enforcing new case bindings', () => {
  for (const sql of [schema, migration]) {
    assert.match(sql, /foreign key \(test_case_id, test_space_id, test_subject_id\)/)
    assert.match(sql, /references test_cases \(id, test_space_id, test_subject_id\);/)
    assert.match(sql, /b.test_case_id is null and b.test_plan_case_id = pc.id/)
    assert.match(sql, /b.test_space_id = c.test_space_id and b.test_subject_id = c.test_subject_id/)
    assert.match(sql, /tg_op = 'INSERT'/)
    assert.match(sql, /old.test_case_id is not null or new.test_space_id <> old.test_space_id/)
    assert.match(sql, /if not exists \(select 1 from test_bugs where test_case_id is null\)/)
    assert.match(sql, /alter column test_case_id set not null/)
    assert.match(sql, /create trigger test_subjects_protect_bugs before delete/)
  }
})

test('create and legacy repair validate canonical cases and preserve prior execution IDs', () => {
  const create = source.slice(source.indexOf("router.post('/test-spaces/:spaceId/bugs'"), source.indexOf("router.post('/test-spaces/:spaceId/bugs/:bugId/transfer-space'"))
  assert.match(create, /positiveId\(request.body.testCaseId\)/)
  assert.doesNotMatch(create, /positiveId\(request.body.testSubjectId\)/)
  assert.match(create, /Number\(execution.rows\[0\].test_case_id\) !== caseId/)
  assert.ok(create.indexOf('await lockTestCaseSpace') < create.indexOf('select test_subject_id from test_cases'))
  assert.match(client, /const caseLocked = editing \? Boolean\(seed.testCaseId\) : Boolean\(seed.testPlanCaseId\)/)
  assert.match(source, /历史 Bug 补关联：原计划/)
  assert.match(source, /if \(sources.some\(\(source\) => source.categories.includes\('bugs'\)\) && !targetCase\)/)
  assert.doesNotMatch(source, /scopeBugs/)
})
