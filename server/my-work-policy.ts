import type { MyWorkFilters, MyWorkKind, MyWorkDueFilter, MyWorkItem } from '../src/my-work-types.ts'

const kinds = new Set<MyWorkKind>(['todo', 'delivery', 'bug', 'milestone'])
const statuses = new Set([
  'assigned', 'achieved', 'cancelled', 'confirmed', 'acceptance_failed', 'closed', 'completed',
  'delivering', 'delivered', 'draft', 'in_progress', 'pending_verification',
  'new', 'pending', 'pending_confirmation', 'in_review', 'pending_review', 'reopened', 'rejected', 'duplicate',
])

export function parseMyWorkFilters(query: Record<string, unknown>): MyWorkFilters {
  const kind = typeof query.kind === 'string' && kinds.has(query.kind as MyWorkKind)
    ? query.kind as MyWorkKind
    : undefined
  const projectId = Number(query.projectId)
  const creator = typeof query.creator === 'string' ? query.creator.trim().slice(0, 100) : undefined
  const cursor = Number(query.cursor)
  const limit = Number(query.limit)
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : undefined
  const requestedStatus = typeof query.status === 'string' ? query.status : undefined
  const sort = query.sort === 'due_asc' ? 'due_asc' : 'due_desc'
  const [statusKind, statusValue] = requestedStatus?.split(':') ?? []
  const isConcreteStatus = requestedStatus
    ? statuses.has(requestedStatus)
      || (statusKind && kinds.has(statusKind as MyWorkKind) && statusValue && statuses.has(statusValue))
    : false
  return {
    due: typeof query.due === 'string' && ['overdue', 'today', 'this_week', 'later', 'unscheduled'].includes(query.due)
      ? query.due as MyWorkDueFilter : undefined,
    cursor: Number.isSafeInteger(cursor) && cursor >= 0 ? String(cursor) : undefined,
    kind,
    projectId: Number.isSafeInteger(projectId) && projectId > 0 ? projectId : undefined,
    creator: creator || undefined,
    q: q || undefined,
    status: requestedStatus === 'all' || requestedStatus === 'open' || isConcreteStatus
      ? requestedStatus
      : 'open',
    sort,
    limit: Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 50,
  }
}

export function workBucket(dueAt: string | undefined, today: string, weekEnd: string) {
  if (!dueAt) return 'unscheduled' as const
  if (dueAt < today) return 'overdue' as const
  if (dueAt === today) return 'today' as const
  if (dueAt <= weekEnd) return 'this_week' as const
  return 'later' as const
}

export function workItemKey(kind: MyWorkKind, sourceId: number) {
  return `${kind}:${sourceId}`
}

// Keep at most the requested page and the trailing page while scanning encrypted
// search results. The trailing page provides a safe fallback after deletions.
export function createMyWorkPagination(filters: MyWorkFilters, today: string, weekEnd: string) {
  const limit = filters.limit ?? 50
  const requestedOffset = Number(filters.cursor ?? 0)
  let total = 0
  let lastPage: MyWorkItem[] = []
  const requestedPage: MyWorkItem[] = []
  const summary = { all: 0, overdue: 0, today: 0, thisWeek: 0 }
  const creators = new Set<string>()
  const statuses = new Set<string>()
  return {
    add(item: MyWorkItem) {
      creators.add(item.creatorName ?? '__unrecorded__')
      statuses.add(`${item.kind}:${item.status}`)
      const bucket = workBucket(item.dueAt, today, weekEnd)
      summary.all += 1
      if (bucket === 'overdue') summary.overdue += 1
      if (bucket === 'today') summary.today += 1
      if (bucket === 'today' || bucket === 'this_week') summary.thisWeek += 1
      if (filters.due && bucket !== filters.due) return
      if (total % limit === 0) lastPage = []
      lastPage.push(item)
      if (total >= requestedOffset && total < requestedOffset + limit) requestedPage.push(item)
      total += 1
    },
    result() {
      const lastOffset = Math.max(0, Math.ceil(total / limit) - 1) * limit
      const offset = Math.min(requestedOffset, lastOffset)
      return {
        items: requestedOffset > lastOffset ? lastPage : requestedPage,
        total, offset, summary,
        filterOptions: { creators: [...creators], statuses: [...statuses] },
        nextCursor: offset + limit < total ? String(offset + limit) : undefined,
      }
    },
  }
}

export function paginateMyWork(items: MyWorkItem[], filters: MyWorkFilters, today: string, weekEnd: string) {
  const pagination = createMyWorkPagination(filters, today, weekEnd)
  for (const item of items) pagination.add(item)
  return pagination.result()
}
