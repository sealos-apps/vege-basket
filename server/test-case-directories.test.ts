import assert from 'node:assert/strict'
import test from 'node:test'
import type { PoolClient } from 'pg'
import {
  createDirectoryIndex,
  countDirectoryCases,
  decodeDirectoryPath,
  directoryName,
  encodeDirectoryPath,
  nullableDirectoryId,
  parseCaseMoveIds,
  planDirectoryImport,
  validateDirectoryPlacement,
} from '../shared/test-case-directories.ts'
import { parseTestCaseCsv } from './test-case-import.ts'
import { buildTestCaseCsv } from '../src/test-case-csv.ts'
import type { TestCase, TestCaseFolder } from '../src/test-workbench-types.ts'

process.env.APP_ENCRYPTION_ACTIVE_KEY_ID = 'directory-test'
process.env.APP_ENCRYPTION_KEYS = `directory-test:${Buffer.alloc(32, 31).toString('base64')}`
const {
  deleteEmptyCaseDirectory,
  moveCaseDirectories,
  lockTestCaseScope,
  updateCaseDirectory,
} = await import('./test-case-directories.ts')
const { backfillCaseDirectoryEncryption } =
  await import('./test-case-directory-backfill.ts')
const { decryptText, isEncryptedText } = await import('./crypto.ts')
const folders = [
  { id: 1, parentId: null, name: '账户' },
  { id: 2, parentId: 1, name: '登录/退出' },
  { id: 3, parentId: 2, name: '~特殊目录' },
  { id: 4, parentId: null, name: '订单' },
  { id: 5, parentId: 4, name: '登录/退出' },
]
function fakeClient(handler: (sql: string, values: unknown[]) => unknown[]) {
  const calls: { sql: string; values: unknown[] }[] = []
  const client = {
    query: async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values })
      const rows = handler(sql, values)
      return { rows, rowCount: rows.length }
    },
  } as unknown as PoolClient
  return { client, calls }
}
const dbFolders = folders.map((f) => ({
  id: String(f.id),
  parent_id: f.parentId === null ? null : String(f.parentId),
  name: f.name,
}))

test('directory placement rejects self, descendants, foreign parents, sibling names and depth overflow', () => {
  assert.throws(
    () => validateDirectoryPlacement(folders, '账户', 3, 1),
    /自身或其子目录/u,
  )
  assert.throws(
    () => validateDirectoryPlacement(folders, '账户', 1, 1),
    /自身或其子目录/u,
  )
  assert.throws(
    () => validateDirectoryPlacement(folders, '新目录', 999),
    /不属于/u,
  )
  assert.throws(
    () => validateDirectoryPlacement(folders, ' 登录/退出 ', 1),
    /同名/u,
  )
  assert.doesNotThrow(() =>
    validateDirectoryPlacement(folders, '登录/退出', null, 5),
  )
  const chain = Array.from({ length: 32 }, (_, i) => ({
    id: i + 1,
    name: String(i),
    parentId: i === 0 ? null : i,
  }))
  assert.throws(() => validateDirectoryPlacement(chain, 'overflow', 32), /32/u)
  assert.doesNotThrow(() => validateDirectoryPlacement(chain, 'leaf', 31))
  const tree = [
    ...chain,
    { id: 40, name: 'subtree', parentId: null },
    { id: 41, name: 'leaf', parentId: 40 },
  ]
  assert.throws(
    () => validateDirectoryPlacement(tree, 'subtree', 31, 40),
    /32/u,
  )
})

test('name and ID validation rejects ambiguous and invalid values', () => {
  assert.equal(directoryName(' /A/~B '), '/A/~B')
  for (const name of ['', '\n', 'a\u0000b', 'x'.repeat(241), 1])
    assert.throws(() => directoryName(name))
  for (const id of [
    undefined,
    '',
    false,
    0,
    -1,
    1.5,
    'oops',
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.throws(() => nullableDirectoryId(id))
  assert.equal(nullableDirectoryId(null), null)
  assert.equal(nullableDirectoryId('12'), 12)
  assert.deepEqual(parseCaseMoveIds([3, 1]), [1, 3])
  for (const ids of [
    [],
    [1, 1],
    ['1'],
    [1.5],
    Array.from({ length: 1001 }, (_, i) => i + 1),
  ])
    assert.throws(() => parseCaseMoveIds(ids))
})

test('paths preserve literal slash/tilde and distinguish uncategorized from a named directory', () => {
  const names = ['A/B', '~1', '未分类', 'a,b"c']
  assert.deepEqual(decodeDirectoryPath(encodeDirectoryPath(names)), names)
  assert.deepEqual(decodeDirectoryPath(''), [])
  for (const value of ['/A', 'A/', 'A//B', '~2', '~'])
    assert.throws(() => decodeDirectoryPath(value))
  assert.deepEqual([...createDirectoryIndex(folders).descendants(1)], [1, 2, 3])
  const counts = countDirectoryCases(folders, [
    { folderId: 1 },
    { folderId: 3 },
    { folderId: null },
  ])
  assert.equal(counts.direct.get(1), 1)
  assert.equal(counts.total.get(1), 2)
  assert.equal(counts.total.get(null), 3)
})

test('import plan deduplicates siblings and validates the complete batch before any writes', () => {
  const plan = planDirectoryImport(folders, 1, [
    ['登录/退出', 'new'],
    ['登录/退出', 'NEW'],
    [],
    ['new'],
  ])
  assert.equal(plan.created.length, 2)
  assert.equal(plan.reusedCount, 1)
  assert.deepEqual(plan.folderIds, [-1, -1, 1, -2])
  assert.equal(plan.created[0].parentId, 2)
  assert.throws(() =>
    planDirectoryImport(folders, 1, [['valid'], ['\u0000invalid']]),
  )
  assert.throws(
    () => planDirectoryImport(folders, 3, [Array(30).fill('deep')]),
    /32/u,
  )
})

test('scoped CSV round trip retains hierarchy, multiline content and all supplied filtered rows', () => {
  const typedFolders = folders.map((f) => ({
    ...f,
    testSpaceId: 1,
    testSubjectId: 1,
    createdAt: '',
  })) satisfies TestCaseFolder[]
  const cases = Array.from({ length: 35 }, (_, i) => ({
    id: i + 1,
    folderId: i % 2 ? 3 : 1,
    title: `用例,"${i}"`,
    preconditions: '',
    steps: '步骤一\n步骤二',
    expectedResult: '完成',
    remarks: '',
    priority: 'high',
    customTags: ['核心'],
  })) as TestCase[]
  const csv = buildTestCaseCsv(cases, typedFolders, 1)
  const parsed = parseTestCaseCsv(csv, 'tree')
  assert.equal(parsed.rows.length, 35)
  assert.deepEqual(parsed.rows[1].directorySegments, ['登录/退出', '~特殊目录'])
  assert.deepEqual(parsed.rows[0].directorySegments, [])
  assert.equal(parsed.rows[1].steps, '步骤一\n步骤二')
  assert.equal(parsed.rows[1].title, cases[1].title)
  assert.throws(
    () => buildTestCaseCsv([{ ...cases[0], folderId: 5 }], typedFolders, 1),
    /不属于/u,
  )
  assert.deepEqual(
    parseTestCaseCsv(csv, 'current').rows[1].directorySegments,
    [],
  )
  const legacy =
    '用例名称,所属模块,前置条件,步骤描述,预期结果,备注,用例等级\n旧用例,/原样/保留,,,结果,,P1'
  assert.deepEqual(parseTestCaseCsv(legacy).rows[0].directorySegments, [
    '/原样/保留',
  ])
  assert.deepEqual(parseTestCaseCsv(legacy, 'tree').rows[0].directorySegments, [
    '/原样/保留',
  ])
})

test('scope lock rejects revoked/viewer access before locking resources', async () => {
  const { client, calls } = fakeClient((sql) =>
    sql.includes('from test_spaces')
      ? [{ id: '1' }]
      : [{ access_level: 'viewer' }],
  )
  await assert.rejects(lockTestCaseScope(client, 1, 2, 3), /编辑权限/u)
  assert.equal(calls.length, 2)
  assert.match(calls[0].sql, /for update/u)
  assert.match(calls[1].sql, /status = 'active' for share/u)
})

test('move validates every case and target before updating, and skips no-op rows', async () => {
  const missing = fakeClient((sql) =>
    sql.includes('test_case_folders')
      ? dbFolders
      : [{ id: '10', folder_id: '1', created_by_user_id: '7' }],
  )
  await assert.rejects(
    moveCaseDirectories(missing.client, 1, 2, [10, 11], 3),
    /部分用例/u,
  )
  assert.equal(
    missing.calls.some((call) => call.sql.startsWith('update')),
    false,
  )
  const invalid = fakeClient(() => dbFolders)
  await assert.rejects(
    moveCaseDirectories(invalid.client, 1, 2, [10], 999),
    /不属于/u,
  )
  assert.equal(invalid.calls.length, 1)
  const valid = fakeClient((sql) =>
    sql.includes('test_case_folders')
      ? dbFolders
      : sql.startsWith('select')
        ? [
            { id: '10', folder_id: '1', created_by_user_id: '7' },
            { id: '11', folder_id: '3', created_by_user_id: '8' },
          ]
        : [],
  )
  assert.deepEqual(await moveCaseDirectories(valid.client, 1, 2, [10, 11], 3), [
    { id: 10, createdByUserId: 7 },
  ])
  assert.deepEqual(valid.calls.at(-1)!.values, [3, 1, 2, [10]])
  const noop = fakeClient((sql) =>
    sql.includes('test_case_folders')
      ? dbFolders
      : [{ id: '11', folder_id: '3', created_by_user_id: '8' }],
  )
  assert.deepEqual(await moveCaseDirectories(noop.client, 1, 2, [11], 3), [])
  assert.equal(
    noop.calls.some((call) => call.sql.startsWith('update')),
    false,
  )
})

test('delete refuses a concurrently populated directory and never reassigns its cases', async () => {
  const populated = fakeClient(() => [])
  await assert.rejects(
    deleteEmptyCaseDirectory(populated.client, 1, 2, 3),
    /仅空目录/u,
  )
  assert.equal(populated.calls.length, 1)
  assert.match(
    populated.calls[0].sql,
    /not exists \(select 1 from test_case_folders child/u,
  )
  assert.match(
    populated.calls[0].sql,
    /not exists \(select 1 from test_cases c/u,
  )
  const empty = fakeClient(() => [{ id: '3' }])
  await deleteEmptyCaseDirectory(empty.client, 1, 2, 3)
  assert.deepEqual(empty.calls[0].values, [3, 1, 2])
})

test('directory update rejects a cyclic placement without a write', async () => {
  const { client, calls } = fakeClient(() => dbFolders)
  await assert.rejects(
    updateCaseDirectory(client, 1, 2, 1, { parentId: 3 }),
    /自身或其子目录/u,
  )
  assert.equal(calls.length, 1)
})

test('encryption backfill detects duplicates before writes and converges idempotently', async () => {
  const rows = [
    {
      id: '1',
      test_subject_id: '1',
      parent_id: null,
      name: 'Private directory',
      name_lookup: null as string | null,
    },
  ]
  const mock = fakeClient((sql, values) => {
    if (sql.startsWith('select id, test_subject_id')) return rows
    if (sql.startsWith('update')) {
      rows[0].name = String(values[0])
      rows[0].name_lookup = String(values[1])
    }
    return []
  })
  await backfillCaseDirectoryEncryption(mock.client)
  assert.equal(isEncryptedText(rows[0].name), true)
  assert.equal(decryptText(rows[0].name), 'Private directory')
  const count = mock.calls.filter((c) => c.sql.startsWith('update')).length
  await backfillCaseDirectoryEncryption(mock.client)
  assert.equal(
    mock.calls.filter((c) => c.sql.startsWith('update')).length,
    count,
  )
  const duplicate = fakeClient((sql) =>
    sql.startsWith('select id, test_subject_id')
      ? [...rows, { ...rows[0], id: '2', name: ' private DIRECTORY ' }]
      : [],
  )
  await assert.rejects(
    backfillCaseDirectoryEncryption(duplicate.client),
    /Duplicate/u,
  )
  assert.equal(
    duplicate.calls.some((c) => c.sql.startsWith('update')),
    false,
  )
})

test('startup directory migration matches the versioned SQL including dollar quoting', async () => {
  const { readFile } = await import('node:fs/promises')
  const { schemaSql } = await import('./schema.ts')
  const migration = await readFile(
    new URL(
      './migrations/20260910_test_case_directory_tree.sql',
      import.meta.url,
    ),
    'utf8',
  )
  const start = schemaSql.indexOf(
    'alter table test_case_folders add column if not exists parent_id bigint;',
  )
  const end = schemaSql.indexOf(
    'create table if not exists test_cases (',
    start,
  )
  assert.ok(start > 0 && end > start)
  assert.ok(migration.includes(schemaSql.slice(start, end).trim()))
  assert.ok(schemaSql.slice(start, end).includes('do $$ begin'))
})

test('client sends frozen import scope and ID-based moves on their dedicated endpoints', async (t) => {
  const requests: { url: string; options?: RequestInit }[] = []
  t.mock.method(
    globalThis,
    'fetch',
    async (input: string | URL | Request, options?: RequestInit) => {
      requests.push({ url: String(input), options })
      return new Response(
        JSON.stringify({ preview: { rowCount: 1 }, workbench: { cases: [] } }),
        { status: 200 },
      )
    },
  )
  const { previewTestCaseImport, importTestCases, moveTestCases } =
    await import('../src/test-workbench-api.ts')
  await previewTestCaseImport(10, 20, 'csv-preview', {
    directoryMode: 'tree',
    targetFolderId: 30,
  })
  await importTestCases(10, 20, 'csv-submit', {
    directoryMode: 'tree',
    targetFolderId: 30,
  })
  await moveTestCases(10, 20, [1, 2], null)
  for (const request of requests.slice(0, 2)) {
    const url = new URL(request.url, 'https://example.test')
    assert.equal(url.searchParams.get('testSubjectId'), '20')
    assert.equal(url.searchParams.get('directoryMode'), 'tree')
    assert.equal(url.searchParams.get('targetFolderId'), '30')
  }
  assert.equal(requests[0].options?.body, 'csv-preview')
  assert.equal(requests[1].options?.body, 'csv-submit')
  assert.equal(requests[2].url, '/api/test-spaces/10/cases/move')
  assert.deepEqual(JSON.parse(String(requests[2].options?.body)), {
    testSubjectId: 20,
    caseIds: [1, 2],
    targetFolderId: null,
  })
})
