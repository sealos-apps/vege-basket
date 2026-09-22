export function clampListPage(page: number, total: number, pageSize: number) {
  return Math.max(0, Math.min(page, Math.max(0, Math.ceil(total / pageSize) - 1)))
}

export function selectedListPage(ids: readonly number[], selectedId: number | undefined, pageSize: number) {
  const index = selectedId == null ? -1 : ids.indexOf(selectedId)
  return index < 0 ? 0 : Math.floor(index / pageSize)
}
