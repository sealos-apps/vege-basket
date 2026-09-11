import { useState } from 'react'
import type { TestCaseFolder } from './test-workbench-types'

export function useDirectoryTreeState(folders: TestCaseFolder[]) {
  const [expanded, setExpanded] = useState<Set<number>>(
    () => new Set(folders.filter((f) => f.parentId === null).map((f) => f.id)),
  )
  const [query, setQuery] = useState('')
  const [focusId, setFocusId] = useState<string>('all')
  return { expanded, setExpanded, query, setQuery, focusId, setFocusId }
}
