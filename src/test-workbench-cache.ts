export function replaceItemByIdInPlace<T extends { id: number }>(
  current: T[],
  next: T[],
  id: number,
) {
  const replacement = next.find((item) => item.id === id)
  if (!replacement) return current.filter((item) => item.id !== id)

  let replaced = false
  const merged = current.map((item) => {
    if (item.id !== id) return item
    replaced = true
    return replacement
  })
  return replaced ? merged : [...merged, replacement]
}
