import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { clampListPage, selectedListPage } from '../list-pagination'

// A detail link follows its selected record; refreshing the same selection does
// not move the reader. Filtering always starts a fresh first page.
export function usePagedSelection<T extends { id: number }>(items: T[], selectedId: number | undefined, scope: string, onSelect: (id: number) => void, listRef: RefObject<HTMLDivElement | null>) {
  const [pageSize, setPageSize] = useState(20)
  const [state, setState] = useState(() => ({ scope, selectedId, page: selectedListPage(items.map((item) => item.id), selectedId, pageSize) }))
  const page = clampListPage(
    selectedId !== state.selectedId && items.some((item) => item.id === selectedId)
      ? selectedListPage(items.map((item) => item.id), selectedId, pageSize)
      : scope !== state.scope ? 0 : state.page,
    items.length, pageSize,
  )
  if (state.scope !== scope || state.selectedId !== selectedId || state.page !== page) {
    setState({ scope, selectedId, page })
  }
  const previousScopeRef = useRef(scope)
  useEffect(() => {
    const scopeChanged = previousScopeRef.current !== scope
    previousScopeRef.current = scope
    const selectedIndex = items.findIndex((item) => item.id === selectedId)
    if (selectedIndex < 0 || (scopeChanged && Math.floor(selectedIndex / pageSize) !== page)) {
      const first = items[page * pageSize]
      if (first) onSelect(first.id)
    }
  }, [items, onSelect, page, pageSize, scope, selectedId])
  useLayoutEffect(() => {
    const list = listRef.current
    const selected = list?.querySelector<HTMLElement>('button.active')
    if (!list || !selected) return
    const listBounds = list.getBoundingClientRect()
    const selectedBounds = selected.getBoundingClientRect()
    if (selectedBounds.top < listBounds.top) list.scrollTop += selectedBounds.top - listBounds.top
    else if (selectedBounds.bottom > listBounds.bottom) list.scrollTop += selectedBounds.bottom - listBounds.bottom
  }, [listRef, page, pageSize, selectedId])
  function changePage(next: number, size = pageSize) {
    const nextPage = clampListPage(next, items.length, size)
    const first = items[nextPage * size]
    setState({ scope, selectedId: first?.id, page: nextPage })
    if (first) onSelect(first.id)
  }
  return {
    page, pageSize,
    items: items.slice(page * pageSize, (page + 1) * pageSize),
    onPageChange: (next: number) => changePage(next),
    onPageSizeChange: (size: number) => { setPageSize(size); changePage(0, size) },
  }
}
