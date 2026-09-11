import type { PoolClient } from 'pg'
import { blindIndex, decryptText, encryptText } from './crypto.ts'
import {
  createDirectoryIndex,
  directoryName,
  TestCaseDirectoryError,
  validateDirectoryPlacement,
  type TestCaseDirectory,
} from '../shared/test-case-directories.ts'

export async function lockTestCaseSpace(client: PoolClient, spaceId: number) {
  const space = await client.query(
    'select id from test_spaces where id = $1 for update',
    [spaceId],
  )
  if (!space.rows.length)
    throw new TestCaseDirectoryError('测试空间不存在。', 404)
}

/** Every directory/assignment writer takes space -> subject -> resource locks. */
export async function lockTestCaseScope(
  client: PoolClient,
  spaceId: number,
  subjectId: number,
  userId: number,
) {
  await lockTestCaseSpace(client, spaceId)
  const membership = await client.query<{ access_level: string }>(
    `select access_level from test_space_memberships
     where test_space_id = $1 and user_id = $2 and status = 'active' for share`,
    [spaceId, userId],
  )
  if (!['owner', 'editor'].includes(membership.rows[0]?.access_level)) {
    throw new TestCaseDirectoryError('需要测试空间的编辑权限。', 403)
  }
  const subject = await client.query(
    'select id from test_subjects where id = $1 and test_space_id = $2 for update',
    [subjectId, spaceId],
  )
  if (!subject.rows.length)
    throw new TestCaseDirectoryError('测试对象不存在。', 404)
}

export async function readCaseDirectories(
  client: PoolClient,
  spaceId: number,
  subjectId: number,
) {
  const result = await client.query<{
    id: string
    name: string
    parent_id: string | null
  }>(
    'select id, name, parent_id from test_case_folders where test_space_id = $1 and test_subject_id = $2 order by id',
    [spaceId, subjectId],
  )
  return result.rows.map((row): TestCaseDirectory => ({
    id: Number(row.id),
    name: decryptText(row.name),
    parentId: row.parent_id ? Number(row.parent_id) : null,
  }))
}

export async function caseFolderSubject(
  client: PoolClient,
  spaceId: number,
  folderId: number,
) {
  const result = await client.query<{ test_subject_id: string }>(
    'select test_subject_id from test_case_folders where id = $1 and test_space_id = $2',
    [folderId, spaceId],
  )
  if (!result.rows.length)
    throw new TestCaseDirectoryError('用例目录不存在。', 404)
  return Number(result.rows[0].test_subject_id)
}

export async function insertCaseDirectory(
  client: PoolClient,
  spaceId: number,
  subjectId: number,
  name: string,
  parentId: number | null,
) {
  const result = await client.query<{ id: string }>(
    `insert into test_case_folders (test_space_id, test_subject_id, parent_id, name, name_lookup)
     values ($1, $2, $3, $4, $5)
     on conflict ${
       parentId === null
         ? '(test_subject_id, name_lookup) where parent_id is null and name_lookup is not null'
         : '(test_subject_id, parent_id, name_lookup) where parent_id is not null and name_lookup is not null'
     }
     do update set name_lookup = excluded.name_lookup returning id`,
    [spaceId, subjectId, parentId, encryptText(name), blindIndex(name)],
  )
  return Number(result.rows[0].id)
}

/** Call only while holding the scope lock. Compare legacy retained-key names too. */
export async function resolveCaseDirectory(
  client: PoolClient,
  spaceId: number,
  subjectId: number,
  name: string,
  parentId: number | null = null,
) {
  const normalized = directoryName(name)
  const directories = await readCaseDirectories(client, spaceId, subjectId)
  const existing = directories.find(
    (node) =>
      node.parentId === parentId &&
      node.name.trim().toLowerCase() === normalized.toLowerCase(),
  )
  if (existing) return existing.id
  validateDirectoryPlacement(directories, normalized, parentId)
  return insertCaseDirectory(client, spaceId, subjectId, normalized, parentId)
}

export async function createCaseDirectory(
  client: PoolClient,
  spaceId: number,
  subjectId: number,
  name: string,
  parentId: number | null,
) {
  const directories = await readCaseDirectories(client, spaceId, subjectId)
  validateDirectoryPlacement(directories, name, parentId)
  return insertCaseDirectory(client, spaceId, subjectId, name, parentId)
}

export async function updateCaseDirectory(
  client: PoolClient,
  spaceId: number,
  subjectId: number,
  folderId: number,
  patch: { name?: string; parentId?: number | null },
) {
  const directories = await readCaseDirectories(client, spaceId, subjectId)
  const current = directories.find((node) => node.id === folderId)
  if (!current) throw new TestCaseDirectoryError('用例目录不存在。', 404)
  const name = patch.name ?? current.name
  const parentId =
    patch.parentId === undefined ? current.parentId : patch.parentId
  validateDirectoryPlacement(directories, name, parentId, folderId)
  await client.query(
    'update test_case_folders set name = $1, name_lookup = $2, parent_id = $3 where id = $4 and test_space_id = $5 and test_subject_id = $6',
    [
      encryptText(name),
      blindIndex(name),
      parentId,
      folderId,
      spaceId,
      subjectId,
    ],
  )
}

export async function deleteEmptyCaseDirectory(
  client: PoolClient,
  spaceId: number,
  subjectId: number,
  folderId: number,
) {
  const result = await client.query(
    `delete from test_case_folders f where f.id = $1 and f.test_space_id = $2 and f.test_subject_id = $3
     and not exists (select 1 from test_case_folders child where child.parent_id = f.id)
     and not exists (select 1 from test_cases c where c.folder_id = f.id) returning f.id`,
    [folderId, spaceId, subjectId],
  )
  if (!result.rows.length)
    throw new TestCaseDirectoryError(
      '仅空目录可删除，请先移走用例和子目录。',
      409,
    )
}

export async function moveCaseDirectories(
  client: PoolClient,
  spaceId: number,
  subjectId: number,
  caseIds: number[],
  targetFolderId: number | null,
) {
  const directories = await readCaseDirectories(client, spaceId, subjectId)
  createDirectoryIndex(directories).path(targetFolderId)
  const cases = await client.query<{
    id: string
    folder_id: string | null
    created_by_user_id: string | null
  }>(
    `select id, folder_id, created_by_user_id from test_cases
     where test_space_id = $1 and test_subject_id = $2 and id = any($3::bigint[]) order by id for update`,
    [spaceId, subjectId, caseIds],
  )
  if (cases.rows.length !== caseIds.length)
    throw new TestCaseDirectoryError(
      '部分用例不存在或不属于当前测试对象。',
      404,
    )
  const changed = cases.rows.filter(
    (row) => (row.folder_id ? Number(row.folder_id) : null) !== targetFolderId,
  )
  if (changed.length)
    await client.query(
      `update test_cases set folder_id = $1, updated_at = now()
     where test_space_id = $2 and test_subject_id = $3 and id = any($4::bigint[])`,
      [
        targetFolderId,
        spaceId,
        subjectId,
        changed.map((row) => Number(row.id)),
      ],
    )
  return changed.map((row) => ({
    id: Number(row.id),
    createdByUserId: row.created_by_user_id
      ? Number(row.created_by_user_id)
      : null,
  }))
}
