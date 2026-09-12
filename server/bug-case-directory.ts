import { decryptText } from './crypto.ts'
import { maxTestCaseDirectoryDepth } from '../shared/test-case-directories.ts'

export type BugCaseDirectoryRow = Array<{ id: number; name: string }> | null

// Used only after the caller has joined the Bug's canonical case as linked_case.
// Return ancestors of that case, never unrelated directories from its space.
export const bugCaseDirectoryJoinSql = `
left join lateral (
  with recursive ancestors as (
    select f.id, f.name, f.parent_id, 1 as depth, array[f.id] as visited
    from test_case_folders f
    where f.id = linked_case.folder_id
      and f.test_space_id = linked_case.test_space_id
      and f.test_subject_id = linked_case.test_subject_id
    union all
    select parent.id, parent.name, parent.parent_id, child.depth + 1, child.visited || parent.id
    from ancestors child join test_case_folders parent on parent.id = child.parent_id
    where parent.test_space_id = linked_case.test_space_id
      and parent.test_subject_id = linked_case.test_subject_id
      and child.depth < ${maxTestCaseDirectoryDepth} and not parent.id = any(child.visited)
  )
  select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by depth desc) as path
  from ancestors
) case_directory on true
`

export function serializeBugCaseDirectory(path: BugCaseDirectoryRow) {
  const testCaseDirectoryPath = (path ?? []).map((folder) => ({ id: Number(folder.id), name: decryptText(folder.name) }))
  return {
    testCaseDirectoryPath,
    testCaseFolderName: testCaseDirectoryPath.length ? testCaseDirectoryPath.map((folder) => folder.name).join(' / ') : undefined,
  }
}
