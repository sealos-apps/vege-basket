import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Bug, CalendarBlank, Check, CheckCircle, Clock, FolderSimple, FunnelSimple, ListChecks, MagnifyingGlass, Flag, SortAscending, SortDescending } from '@phosphor-icons/react'
import { fetchMyWork } from '../api'
import type { Project } from '../types'
import type { MyWorkData, MyWorkItem, MyWorkKind, MyWorkFilters, MyWorkViewState } from '../my-work-types'
import type { OrganizationContext } from '../../shared/organization-context'
import { startVisibleRefreshSchedule, workspaceRefreshIntervalMs } from '../refresh-schedule'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'
import { ListPagination } from './list-pagination'
import './my-work-workbench.css'

const kindLabels: Record<MyWorkKind, string> = {
  todo: '待办',
  delivery: '交付事件',
  bug: 'Bug',
  milestone: '里程碑',
}

const statusLabels: Record<string, string> = {
  assigned: '待处理',
  achieved: '已达成',
  cancelled: '已取消',
  confirmed: '已确认',
  acceptance_failed: '验收未通过',
  closed: '已关闭',
  completed: '已完成',
  delivering: '交付中',
  delivered: '已交付',
  draft: '草稿',
  in_progress: '进行中',
  pending_confirmation: '待确认',
  pending_verification: '待验证',
  new: '新建',
  pending: '待达成',
  in_review: '验收中',
  pending_review: '待审核',
  reopened: '重新打开',
  rejected: '已拒绝',
  duplicate: '重复',
}

function formatDueDate(value?: string) {
  if (!value) return '未排期'
  return value.replaceAll('-', '/')
}

function TableFilterMenu({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ label: string; value: string }>
  onChange: (value: string) => void
}) {
  return (
    <div className="my-work-table-heading-filter">
      <span>{label}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className={`my-work-filter-icon${value !== 'all' ? ' is-active' : ''}`} type="button" aria-label={`筛选${label}`}>
            <FunnelSimple size={15} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="my-work-filter-menu">
          {options.map((option) => (
            <DropdownMenuItem className="my-work-filter-menu-item" key={option.value} onSelect={() => onChange(option.value)}>
              {value === option.value ? <Check size={15} /> : <span className="my-work-filter-check-placeholder" />}
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function MyWorkWorkbench({
  scope,
  savedView,
  onViewChange,
  organizationId,
  projects,
  onTodoClick,
  onDeliveryClick,
  onBugClick,
  onMilestoneClick,
}: {
  scope: string
  savedView?: MyWorkViewState
  onViewChange: (view: MyWorkViewState) => void
  organizationId: OrganizationContext
  projects: Project[]
  onTodoClick: (projectId: number, todoId: number) => void
  onDeliveryClick: (projectId: number, eventId: number) => void
  onBugClick: (bugId: number) => void
  onMilestoneClick: (projectId: number) => void
}) {
  const [view, setView] = useState<MyWorkViewState>(() => savedView?.scope === scope ? savedView : {
    scope, filters: { status: 'open', sort: 'due_desc' }, page: 0, pageSize: 20, scrollTop: 0,
  })
  const [result, setResult] = useState<{ data: MyWorkData; view: MyWorkViewState }>()
  const [loading, setLoading] = useState(true)
  const [backgroundRefreshVersion, setBackgroundRefreshVersion] = useState(0)
  const [error, setError] = useState('')
  const tableRef = useRef<HTMLDivElement>(null)
  const onViewChangeRef = useRef(onViewChange)
  useEffect(() => { onViewChangeRef.current = onViewChange }, [onViewChange])
  const data = result?.data
  const { kind = 'all', projectId: selectedProjectId, creator = 'all', q: query = '', status = 'open', sort = 'due_desc', due: dueFilter = 'all' } = view.filters
  const projectId = selectedProjectId == null ? 'all' : String(selectedProjectId)
  function changeFilters(patch: Partial<MyWorkFilters>) {
    setView((current) => ({ ...current, filters: { ...current.filters, ...patch }, page: 0, scrollTop: 0 }))
  }

  useEffect(() => startVisibleRefreshSchedule({
    clearInterval: (handle) => window.clearInterval(handle),
    intervalMs: workspaceRefreshIntervalMs,
    isVisible: () => document.visibilityState === 'visible',
    onFocus: (listener) => {
      window.addEventListener('focus', listener)
      return () => window.removeEventListener('focus', listener)
    },
    onVisibilityChange: (listener) => {
      document.addEventListener('visibilitychange', listener)
      return () => document.removeEventListener('visibilitychange', listener)
    },
    refresh: () => setBackgroundRefreshVersion((current) => current + 1),
    minRefreshGapMs: 1_000,
    setInterval: (listener, delay) => window.setInterval(listener, delay),
  }), [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void fetchMyWork(organizationId, {
      ...view.filters,
      q: view.filters.q?.trim() || undefined,
      cursor: String(view.page * view.pageSize),
      limit: view.pageSize,
    }).then((next) => {
      if (!active) return
      const canonicalView = { ...view, page: Math.floor(next.offset / view.pageSize) }
      setResult({ data: next, view: canonicalView })
      if (canonicalView.page !== view.page) setView(canonicalView)
    }).catch((loadError) => {
      if (active) setError(loadError instanceof Error ? loadError.message : '我的待办加载失败。')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [backgroundRefreshVersion, organizationId, view])

  // Revalidation preserves the viewport. Explicit navigation and remounts restore
  // their own position only after the corresponding records are committed.
  const committedViewRef = useRef<MyWorkViewState | null>(null)
  useLayoutEffect(() => {
    if (!result) return
    const previous = committedViewRef.current
    const next = result.view
    if (tableRef.current && (!previous || previous.page !== next.page || previous.pageSize !== next.pageSize || previous.filters !== next.filters)) {
      tableRef.current.scrollTop = next.scrollTop
    }
    committedViewRef.current = next
    onViewChangeRef.current({ ...next, scrollTop: tableRef.current?.scrollTop ?? 0 })
  }, [result])

  const visibleItems = data?.items ?? []
  const statusOptions = useMemo(() => {
    const concreteStatuses = (data?.filterOptions.statuses ?? []).map((value) => {
      const [kind, status] = value.split(':')
      return { value, label: `${kindLabels[kind as MyWorkKind]}-${statusLabels[status] ?? status}` }
    }).sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
    return [
      { label: '未完成', value: 'open' },
      { label: '全部状态', value: 'all' },
      ...concreteStatuses.filter((option) => option.value !== 'open' && option.value !== 'all'),
    ]
  }, [data?.filterOptions.statuses])

  const creatorOptions = useMemo(() => {
    const creators = [...(data?.filterOptions.creators ?? [])]
      .sort((left, right) => (left === '__unrecorded__' ? '未记录' : left).localeCompare(right === '__unrecorded__' ? '未记录' : right, 'zh-CN'))
    return [
      { label: '全部创建人', value: 'all' },
      ...creators.map((value) => ({ label: value === '__unrecorded__' ? '未记录' : value, value })),
    ]
  }, [data?.filterOptions.creators])

  function openItem(item: MyWorkItem) {
    if (result) onViewChange({ ...result.view, scrollTop: tableRef.current?.scrollTop ?? 0 })
    if (item.kind === 'todo' && item.projectId) onTodoClick(item.projectId, item.sourceId)
    if (item.kind === 'delivery' && item.projectId) onDeliveryClick(item.projectId, item.sourceId)
    if (item.kind === 'bug') onBugClick(item.sourceId)
    if (item.kind === 'milestone' && item.projectId) onMilestoneClick(item.projectId)
  }

  return (
    <section className="panel my-work-panel">
      <div className="my-work-toolbar">
        <label className="my-work-search">
          <MagnifyingGlass size={17} />
          <Input value={query} onChange={(event) => changeFilters({ q: event.target.value })} placeholder="搜索事项、项目或状态" />
        </label>
      </div>

      {loading && !result ? <div className="my-work-empty"><Clock className="spin" size={24} />正在加载我的待办...</div> : null}
      {error ? <div className="my-work-load-error" role="alert">{error}{result ? ' 列表仍显示上次加载的结果。' : ''}<Button type="button" variant="ghost" disabled={loading} onClick={() => setBackgroundRefreshVersion((version) => version + 1)}>重试</Button></div> : null}
      {result ? (
        <div className="my-work-table" role="table" aria-label="我的待办列表" aria-busy={loading} ref={tableRef} onScroll={(event) => {
          onViewChange({ ...result.view, scrollTop: event.currentTarget.scrollTop })
        }}>
          <div className="my-work-table-header-group" role="rowgroup">
            <div className="my-work-table-header" role="row">
              <span role="columnheader">事项</span>
              <div role="columnheader"><TableFilterMenu label="项目" value={projectId} onChange={(value) => changeFilters({ projectId: value === 'all' ? undefined : Number(value) })} options={[{ label: '全部项目', value: 'all' }, ...projects.map((project) => ({ label: project.name, value: String(project.id) }))]} /></div>
              <div role="columnheader"><TableFilterMenu label="类型" value={kind} onChange={(value) => changeFilters({ kind: value === 'all' ? undefined : value as MyWorkKind })} options={[{ label: '全部类型', value: 'all' }, ...Object.entries(kindLabels).map(([value, label]) => ({ label, value }))]} /></div>
              <div role="columnheader"><TableFilterMenu label="状态" value={status} onChange={(value) => changeFilters({ status: value })} options={statusOptions} /></div>
              <div className="my-work-date-heading" role="columnheader">
                <TableFilterMenu label="截止日期" value={dueFilter} onChange={(value) => changeFilters({ due: value === 'all' ? undefined : value as MyWorkFilters['due'] })} options={[{ label: '全部日期', value: 'all' }, { label: '已逾期', value: 'overdue' }, { label: '今天', value: 'today' }, { label: '本周', value: 'this_week' }, { label: '更晚', value: 'later' }, { label: '未排期', value: 'unscheduled' }]} />
                <button
                  aria-label={sort === 'due_desc' ? '当前按截止日期倒序排列，点击切换为正序' : '当前按截止日期正序排列，点击切换为倒序'}
                  className={`my-work-sort-icon${sort === 'due_desc' ? ' is-active' : ''}`}
                  title={sort === 'due_desc' ? '切换为截止日期正序' : '切换为截止日期倒序'}
                  type="button"
                  onClick={() => changeFilters({ sort: sort === 'due_desc' ? 'due_asc' : 'due_desc' })}
                >
                  {sort === 'due_desc' ? <SortDescending size={15} /> : <SortAscending size={15} />}
                </button>
              </div>
              <div role="columnheader"><TableFilterMenu label="创建人" value={creator} onChange={(value) => changeFilters({ creator: value === 'all' ? undefined : value })} options={creatorOptions} /></div>
            </div>
          </div>
          <div className="my-work-table-body" role="rowgroup">
            {visibleItems.length === 0 ? <div className="my-work-table-row" role="row"><div className="my-work-empty" role="cell" aria-colspan={6}><CheckCircle size={28} />当前没有需要你推进的事项</div></div> : null}
            {visibleItems.map((item) => (
              <div className="my-work-table-row" key={item.id} role="row">
                <div className="my-work-table-cell my-work-main-cell" role="cell">
                  <button className="my-work-row-main" type="button" disabled={loading} onClick={() => openItem(item)}>
                    <span className={`my-work-kind-icon is-${item.kind}`}>
                      {item.kind === 'bug' ? <Bug size={17} /> : item.kind === 'milestone' ? <Flag size={17} /> : item.kind === 'delivery' ? <FolderSimple size={17} /> : <ListChecks size={17} />}
                    </span>
                    <span className="my-work-row-copy">
                      <span className="my-work-item-title">
                        <strong>{item.title}</strong>
                        {item.offboardingTransferredFromName ? <Badge className="my-work-offboarding-badge" variant="outline">{item.offboardingTransferredFromName}-离职转移</Badge> : null}
                      </span>
                    </span>
                  </button>
                </div>
                <span className="my-work-table-cell" role="cell">{item.projectName ?? item.contextName ?? '未关联项目'}</span>
                <span className="my-work-table-cell" role="cell"><Badge variant="outline">{kindLabels[item.kind]}</Badge></span>
                <span className="my-work-table-cell" role="cell"><span className={`my-work-status is-${item.status}`}>{statusLabels[item.status] ?? item.status}</span></span>
                <span className="my-work-table-cell my-work-due" role="cell"><CalendarBlank size={16} />{formatDueDate(item.dueAt)}</span>
                <span className="my-work-table-cell" role="cell">{item.creatorName ?? '未记录'}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {result ? (
        <ListPagination label="我的待办分页" page={result.view.page} pageSize={result.view.pageSize} total={result.data.total} disabled={loading || Boolean(error)}
          onPageChange={(page) => setView({ ...result.view, page, scrollTop: 0 })}
          onPageSizeChange={(pageSize) => setView({ ...result.view, pageSize, page: 0, scrollTop: 0 })} />
      ) : null}
    </section>
  )
}
