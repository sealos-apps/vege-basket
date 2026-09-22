export type MyWorkKind = 'todo' | 'delivery' | 'bug' | 'milestone'
export type MyWorkRelation = 'assignee' | 'reviewer' | 'responsible'

export type MyWorkItem = {
  id: string
  kind: MyWorkKind
  sourceId: number
  projectId?: number
  projectName?: string
  contextName?: string
  creatorName?: string
  canComplete?: boolean
  title: string
  status: string
  priority?: 'high' | 'medium' | 'low'
  offboardingTransferredFromName?: string
  dueAt?: string
  updatedAt: string
  relation: MyWorkRelation
}

export type MyWorkSummary = {
  all: number
  overdue: number
  today: number
  thisWeek: number
}

export type MyWorkData = {
  organizationId: number | null
  items: MyWorkItem[]
  summary: MyWorkSummary
  nextCursor?: string
  filterOptions: { creators: string[]; statuses: string[] }
  total: number
  offset: number
}

export type MyWorkDueFilter = 'overdue' | 'today' | 'this_week' | 'later' | 'unscheduled'

export type MyWorkFilters = {
  due?: MyWorkDueFilter
  cursor?: string
  kind?: MyWorkKind
  projectId?: number
  creator?: string
  q?: string
  /** `open` and `all` are built-in views; other values select a concrete item status. */
  status?: string
  sort?: 'due_asc' | 'due_desc'
  limit?: number
}

// Kept by App only for the current login. No work content is written to storage.
export type MyWorkViewState = {
  scope: string
  filters: MyWorkFilters
  pageSize: number
  page: number
  scrollTop: number
}
