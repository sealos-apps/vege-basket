import { useEffect, useMemo, useRef, useState } from 'react'
import { Bug, CalendarBlank, Check, CheckCircle, Clock, FolderSimple, FunnelSimple, ListChecks, MagnifyingGlass, Flag, SortAscending, SortDescending } from '@phosphor-icons/react'
import { fetchMyWork } from '../api'
import type { Project } from '../types'
import type { MyWorkData, MyWorkItem, MyWorkKind } from '../my-work-types'
import type { OrganizationContext } from '../../shared/organization-context'
import { startVisibleRefreshSchedule, workspaceRefreshIntervalMs } from '../refresh-schedule'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'
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

function dateBucket(item: MyWorkItem) {
  if (!item.dueAt) return '未排期'
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
  const due = item.dueAt.slice(0, 10)
  if (due < today) return '已逾期'
  if (due === today) return '今天'
  const current = new Date(`${today}T00:00:00Z`)
  const day = current.getUTCDay() || 7
  current.setUTCDate(current.getUTCDate() + (7 - day))
  const end = current.toISOString().slice(0, 10)
  return due <= end ? '本周' : '更晚'
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
  organizationId,
  projects,
  onTodoClick,
  onDeliveryClick,
  onBugClick,
  onMilestoneClick,
}: {
  organizationId: OrganizationContext
  projects: Project[]
  onTodoClick: (projectId: number, todoId: number) => void
  onDeliveryClick: (projectId: number, eventId: number) => void
  onBugClick: (bugId: number) => void
  onMilestoneClick: (projectId: number) => void
}) {
  const [data, setData] = useState<MyWorkData>({
    organizationId,
    items: [],
    summary: { all: 0, overdue: 0, today: 0, thisWeek: 0 },
  })
  const [kind, setKind] = useState<'all' | MyWorkKind>('all')
  const [projectId, setProjectId] = useState('all')
  const [creator, setCreator] = useState('all')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('open')
  const [sort, setSort] = useState<'due_asc' | 'due_desc'>('due_desc')
  const [dueFilter, setDueFilter] = useState<'all' | '已逾期' | '今天' | '本周' | '更晚' | '未排期'>('all')
  const [cursor, setCursor] = useState('')
  const [loading, setLoading] = useState(true)
  const hasLoadedRef = useRef(false)
  const [backgroundRefreshVersion, setBackgroundRefreshVersion] = useState(0)
  const [error, setError] = useState('')

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
    // Keep the current table mounted during workspace polling. Replacing it with
    // the initial loading state makes the document height collapse and resets scroll.
    if (!hasLoadedRef.current) setLoading(true)
    setError('')
    void fetchMyWork(organizationId, {
      kind: kind === 'all' ? undefined : kind,
      cursor: cursor || undefined,
      projectId: projectId === 'all' ? undefined : Number(projectId),
      creator: creator === 'all' ? undefined : creator,
      q: query.trim() || undefined,
      status,
      sort,
      limit: 50,
    }).then((next) => {
      if (active) {
        hasLoadedRef.current = true
        setData(next)
        setLoading(false)
      }
    }).catch((loadError) => {
      if (active) {
        if (!hasLoadedRef.current) setError(loadError instanceof Error ? loadError.message : '我的待办加载失败。')
        setLoading(false)
      }
    }).finally(() => {
      if (active && !hasLoadedRef.current) setLoading(false)
    })
    return () => { active = false }
  }, [backgroundRefreshVersion, creator, cursor, kind, organizationId, projectId, query, sort, status])

  useEffect(() => {
    setCursor('')
  }, [creator, kind, projectId, query, sort, status])

  const visibleItems = useMemo(
    () => dueFilter === 'all'
      ? data.items
      : data.items.filter((item) => dateBucket(item) === dueFilter),
    [data.items, dueFilter],
  )

  const statusOptions = useMemo(() => {
    const concreteStatuses = [...new Map(data.items.map((item) => {
      const value = `${item.kind}:${item.status}`
      return [value, { label: `${kindLabels[item.kind]}-${statusLabels[item.status] ?? item.status}`, value }]
    })).values()]
      .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
    return [
      { label: '未完成', value: 'open' },
      { label: '全部状态', value: 'all' },
      ...concreteStatuses.filter((option) => option.value !== 'open' && option.value !== 'all'),
    ]
  }, [data.items])

  const creatorOptions = useMemo(() => {
    const creators = [...new Set(data.items.map((item) => item.creatorName ?? '__unrecorded__'))]
      .sort((left, right) => (left === '__unrecorded__' ? '未记录' : left).localeCompare(right === '__unrecorded__' ? '未记录' : right, 'zh-CN'))
    return [
      { label: '全部创建人', value: 'all' },
      ...creators.map((value) => ({ label: value === '__unrecorded__' ? '未记录' : value, value })),
    ]
  }, [data.items])

  function openItem(item: MyWorkItem) {
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
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索事项、项目或状态" />
        </label>
      </div>

      {loading ? <div className="my-work-empty"><Clock className="spin" size={24} />正在加载我的待办...</div> : null}
      {!loading && error ? <div className="my-work-empty is-error">{error}</div> : null}
      {!loading && !error ? (
        <div className="my-work-table" role="table" aria-label="我的待办列表">
          <div className="my-work-table-header-group" role="rowgroup">
            <div className="my-work-table-header" role="row">
              <span role="columnheader">事项</span>
              <div role="columnheader"><TableFilterMenu label="项目" value={projectId} onChange={setProjectId} options={[{ label: '全部项目', value: 'all' }, ...projects.map((project) => ({ label: project.name, value: String(project.id) }))]} /></div>
              <div role="columnheader"><TableFilterMenu label="类型" value={kind} onChange={(value) => setKind(value as 'all' | MyWorkKind)} options={[{ label: '全部类型', value: 'all' }, ...Object.entries(kindLabels).map(([value, label]) => ({ label, value }))]} /></div>
              <div role="columnheader"><TableFilterMenu label="状态" value={status} onChange={setStatus} options={statusOptions} /></div>
              <div className="my-work-date-heading" role="columnheader">
                <TableFilterMenu label="截止日期" value={dueFilter} onChange={(value) => setDueFilter(value as typeof dueFilter)} options={[{ label: '全部日期', value: 'all' }, ...(['已逾期', '今天', '本周', '更晚', '未排期'] as const).map((value) => ({ label: value, value }))]} />
                <button
                  aria-label={sort === 'due_desc' ? '当前按截止日期倒序排列，点击切换为正序' : '当前按截止日期正序排列，点击切换为倒序'}
                  className={`my-work-sort-icon${sort === 'due_desc' ? ' is-active' : ''}`}
                  title={sort === 'due_desc' ? '切换为截止日期正序' : '切换为截止日期倒序'}
                  type="button"
                  onClick={() => setSort((current) => current === 'due_desc' ? 'due_asc' : 'due_desc')}
                >
                  {sort === 'due_desc' ? <SortDescending size={15} /> : <SortAscending size={15} />}
                </button>
              </div>
              <div role="columnheader"><TableFilterMenu label="创建人" value={creator} onChange={setCreator} options={creatorOptions} /></div>
            </div>
          </div>
          <div className="my-work-table-body" role="rowgroup">
            {visibleItems.length === 0 ? <div className="my-work-table-row" role="row"><div className="my-work-empty" role="cell" aria-colspan={6}><CheckCircle size={28} />当前没有需要你推进的事项</div></div> : null}
            {visibleItems.map((item) => (
              <div className="my-work-table-row" key={item.id} role="row">
                <div className="my-work-table-cell my-work-main-cell" role="cell">
                  <button className="my-work-row-main" type="button" onClick={() => openItem(item)}>
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
      {!loading && !error && data.nextCursor ? (
        <div className="my-work-pagination">
          <Button type="button" variant="outline" onClick={() => setCursor(data.nextCursor ?? '')}>下一页</Button>
        </div>
      ) : null}
    </section>
  )
}
