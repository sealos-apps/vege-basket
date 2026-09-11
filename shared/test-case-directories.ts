export const maxTestCaseDirectoryDepth = 32
export const maxTestCaseDirectoryNameLength = 240
export const maxTestCaseMoveCount = 1000

export type TestCaseDirectory = {
  id: number
  name: string
  parentId: number | null
}
export type TestCaseDirectoryMode = 'current' | 'tree' | 'legacy'

export class TestCaseDirectoryError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export function directoryName(value: unknown) {
  if (typeof value !== 'string' || !value.trim())
    throw new TestCaseDirectoryError('目录名称不能为空。')
  const name = value.trim()
  if (name.length > maxTestCaseDirectoryNameLength || /[\p{Cc}]/u.test(name)) {
    throw new TestCaseDirectoryError(
      '目录名称最多 240 个字符，且不能包含控制字符。',
    )
  }
  return name
}

export function nullableDirectoryId(value: unknown): number | null {
  if (value === null) return null
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    value === ''
  ) {
    throw new TestCaseDirectoryError('目录 ID 无效。')
  }
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new TestCaseDirectoryError('目录 ID 无效。')
  return id
}

export function createDirectoryIndex<T extends TestCaseDirectory>(
  directories: readonly T[],
) {
  const byId = new Map(
    directories.map((directory) => [directory.id, directory]),
  )
  const children = new Map<number | null, T[]>()
  for (const directory of directories) {
    const siblings = children.get(directory.parentId) ?? []
    siblings.push(directory)
    children.set(directory.parentId, siblings)
  }
  for (const siblings of children.values())
    siblings.sort(
      (a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.id - b.id,
    )
  const pathCache = new Map<number, T[]>()
  function path(id: number | null): T[] {
    if (id === null) return []
    const cached = pathCache.get(id)
    if (cached) return cached
    const result: T[] = []
    const seen = new Set<number>()
    let cursor: number | null = id
    while (cursor !== null) {
      if (seen.has(cursor))
        throw new TestCaseDirectoryError('目录结构存在循环。', 409)
      const node = byId.get(cursor)
      if (!node)
        throw new TestCaseDirectoryError(
          '目录不存在或不属于当前测试对象。',
          404,
        )
      seen.add(cursor)
      result.unshift(node)
      cursor = node.parentId
    }
    pathCache.set(id, result)
    return result
  }
  function descendants(id: number | null) {
    if (id !== null) path(id)
    const result = new Set<number>()
    const queue =
      id === null ? (children.get(null) ?? []).map((node) => node.id) : [id]
    for (let offset = 0; offset < queue.length; offset++) {
      const current = queue[offset]
      if (result.has(current)) continue
      result.add(current)
      queue.push(...(children.get(current) ?? []).map((node) => node.id))
    }
    return result
  }
  return { byId, children, path, descendants }
}

export function validateDirectoryPlacement(
  directories: readonly TestCaseDirectory[],
  name: string,
  parentId: number | null,
  movingId?: number,
) {
  const index = createDirectoryIndex(directories)
  directoryName(name)
  const parentPath = index.path(parentId)
  if (
    movingId !== undefined &&
    (!index.byId.has(movingId) ||
      parentPath.some((node) => node.id === movingId))
  ) {
    throw new TestCaseDirectoryError('不能将目录移动到自身或其子目录。', 409)
  }
  if (
    (index.children.get(parentId) ?? []).some(
      (node) =>
        node.id !== movingId &&
        node.name.trim().toLowerCase() === name.trim().toLowerCase(),
    )
  ) {
    throw new TestCaseDirectoryError('同一层级已存在同名目录。', 409)
  }
  let height = 1
  if (movingId !== undefined) {
    const currentDepth = index.path(movingId).length
    for (const id of index.descendants(movingId))
      height = Math.max(height, index.path(id).length - currentDepth + 1)
  }
  if (parentPath.length + height > maxTestCaseDirectoryDepth) {
    throw new TestCaseDirectoryError('目录最多支持 32 层，请选择更浅的层级。')
  }
}

export function encodeDirectoryPath(segments: readonly string[]) {
  return segments
    .map((segment) => segment.replace(/~/gu, '~0').replace(/\//gu, '~1'))
    .join('/')
}

export function decodeDirectoryPath(value: string) {
  if (!value) return []
  const segments = value.split('/').map((segment) => {
    if (/~(?![01])/u.test(segment))
      throw new TestCaseDirectoryError('目录路径包含无效转义。')
    return directoryName(segment.replace(/~1/gu, '/').replace(/~0/gu, '~'))
  })
  if (segments.length > maxTestCaseDirectoryDepth)
    throw new TestCaseDirectoryError('目录路径超过 32 层。')
  return segments
}

export function parseCaseMoveIds(value: unknown) {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > maxTestCaseMoveCount
  ) {
    throw new TestCaseDirectoryError('每次请选择 1–1000 条用例。')
  }
  const ids = value.map((id) => {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)
      throw new TestCaseDirectoryError('用例 ID 无效。')
    return id
  })
  if (new Set(ids).size !== ids.length)
    throw new TestCaseDirectoryError('用例 ID 不能重复。')
  return ids.sort((a, b) => a - b)
}

/** Counts each case once, then accumulates descendants from deepest to shallowest. */
export function countDirectoryCases(
  directories: readonly TestCaseDirectory[],
  cases: readonly { folderId?: number | null }[],
) {
  const index = createDirectoryIndex(directories)
  const direct = new Map<number | null, number>()
  for (const item of cases)
    direct.set(
      item.folderId ?? null,
      (direct.get(item.folderId ?? null) ?? 0) + 1,
    )
  const total = new Map(direct)
  const ordered = [...directories].sort(
    (a, b) => index.path(b.id).length - index.path(a.id).length,
  )
  for (const directory of ordered)
    total.set(
      directory.parentId,
      (total.get(directory.parentId) ?? 0) + (total.get(directory.id) ?? 0),
    )
  return { direct, total }
}

/** Build the entire import without writes; negative IDs identify planned directories. */
export function planDirectoryImport(
  directories: readonly TestCaseDirectory[],
  targetId: number | null,
  paths: readonly string[][],
) {
  const index = createDirectoryIndex(directories)
  const targetPath = index.path(targetId)
  const byParentAndName = new Map(
    directories.map((node) => [
      JSON.stringify([node.parentId, node.name.trim().toLowerCase()]),
      node.id,
    ]),
  )
  const created: TestCaseDirectory[] = []
  const reused = new Set<number>()
  const folderIds = paths.map((segments) => {
    if (targetPath.length + segments.length > maxTestCaseDirectoryDepth)
      throw new TestCaseDirectoryError('导入后的目录超过 32 层。')
    let parent = targetId
    for (const segment of segments) {
      const name = directoryName(segment)
      const key = JSON.stringify([parent, name.toLowerCase()])
      const existing = byParentAndName.get(key)
      if (existing !== undefined) {
        if (existing > 0) reused.add(existing)
        parent = existing
      } else {
        const node = { id: -(created.length + 1), name, parentId: parent }
        created.push(node)
        byParentAndName.set(key, node.id)
        parent = node.id
      }
    }
    return parent
  })
  return {
    created,
    folderIds,
    reusedCount: reused.size,
    targetPath: targetPath.map((node) => node.name),
  }
}
