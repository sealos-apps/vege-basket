import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChartLine, CheckCircle, Clock, DownloadSimple, MagnifyingGlass, PencilSimple, Plus, Trash, TrendUp } from '@phosphor-icons/react'
import {
  createWorkHour, fetchMyWorkHours, fetchOrganizationWorkHours, fetchProjectTodos, fetchTodoWorkHours,
  fetchProjectWorkHours, removeWorkHour, updateWorkHour,
  type WorkHourEntry, type WorkHourSummary,
} from '../api'
import type { Project, Todo } from '../types'
import { buildAiExportPrompt } from '../ai-export-prompt'
import { AiExportPromptDialog } from './ai-export-prompt-dialog'
import { ConfirmActionDialog } from './confirm-action-dialog'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { ListPagination } from './list-pagination'
import './work-hours-workbench.css'

function hours(minutes: number | null | undefined) {
  const value = minutes ?? 0
  return `${(value / 60).toFixed(value % 60 === 0 ? 0 : 1)}h`
}

function dateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function rangeForPeriod(period: 'week' | 'month') {
  const end = new Date()
  const start = new Date(end)
  if (period === 'week') start.setDate(end.getDate() - ((end.getDay() + 6) % 7))
  else start.setDate(1)
  return { endDate: dateInputValue(end), startDate: dateInputValue(start) }
}

function shiftRange(range: { startDate: string; endDate: string }, period: 'week' | 'month', direction: -1 | 1) {
  const start = new Date(`${range.startDate}T12:00:00`)
  const end = new Date(`${range.endDate}T12:00:00`)
  if (period === 'week') {
    start.setDate(start.getDate() + direction * 7)
    end.setDate(end.getDate() + direction * 7)
  } else {
    start.setMonth(start.getMonth() + direction)
    end.setMonth(end.getMonth() + direction)
  }
  return { startDate: dateInputValue(start), endDate: dateInputValue(end) }
}

const emptySummary: WorkHourSummary = {
  byDate: [], byProject: [], byUser: [], confirmedMinutes: 0, pendingMinutes: 0,
  projectCount: 0, taskCount: 0, totalHours: 0, totalMinutes: 0,
}

type Props = {
  mode: 'mine' | 'organization' | 'project'
  organizationId?: number | null
  project?: Project
  projects: Project[]
  currentUserId?: number
  currentUserName?: string
  initialProjectId?: number | null
  initialTodoId?: number | null
  autoOpenRecorder?: boolean
  recorderOnly?: boolean
  recorderRequest?: { projectId: number; todoId: number } | null
  onRecorderContextConsumed?: () => void
  onRecorderDismiss?: () => void
  onTodoClick?: (projectId: number, todoId: number) => void
  onProjectClick?: (projectId: number) => void
}

export function WorkHoursWorkbench({
  mode, organizationId, project, projects, currentUserId,
  initialProjectId = null, initialTodoId = null, autoOpenRecorder = false, onRecorderContextConsumed,
  recorderOnly = false, recorderRequest = null, onRecorderDismiss, onTodoClick, onProjectClick,
}: Props) {
  const [period, setPeriod] = useState<'week' | 'month'>('month')
  const [range, setRange] = useState(() => rangeForPeriod('month'))
  const [entries, setEntries] = useState<WorkHourEntry[]>([])
  const [summary, setSummary] = useState<WorkHourSummary>(emptySummary)
  const [todos, setTodos] = useState<Todo[]>([])
  const [mineTab, setMineTab] = useState<'stats' | 'records'>('stats')
  const [managementTab, setManagementTab] = useState<'projects' | 'members' | 'trend' | 'tasks'>('projects')
  const [status, setStatus] = useState<'all' | 'pending' | 'confirmed'>('all')
  const [projectFilter, setProjectFilter] = useState<number | 'all'>('all')
  const [projectPickerPage, setProjectPickerPage] = useState(0)
  const [projectQuery, setProjectQuery] = useState('')
  const [taskQuery, setTaskQuery] = useState('')
  const [taskPage, setTaskPage] = useState(0)
  const [tableQuery, setTableQuery] = useState('')
  const [tablePage, setTablePage] = useState(0)
  const [taskStatus, setTaskStatus] = useState<'all' | 'open' | 'done'>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<WorkHourEntry | null>(null)
  const [deletingEntry, setDeletingEntry] = useState<WorkHourEntry | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [selectedTaskEntries, setSelectedTaskEntries] = useState<WorkHourEntry[]>([])
  const [selectedTaskEntryTotal, setSelectedTaskEntryTotal] = useState(0)
  const [selectedTaskEntryPage, setSelectedTaskEntryPage] = useState(0)
  const [selectedTaskEntriesVersion, setSelectedTaskEntriesVersion] = useState(0)
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(initialProjectId ?? project?.id ?? null)
  const [selectedTodoId, setSelectedTodoId] = useState<number | null>(initialTodoId)
  const [recorderContextLocked, setRecorderContextLocked] = useState(initialTodoId != null)
  const [minutes, setMinutes] = useState('60')
  const [workDate, setWorkDate] = useState(dateInputValue(new Date()))
  const [description, setDescription] = useState('')
  const [exportPrompt, setExportPrompt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const projectId = project?.id

  const reload = useCallback(() => {
    setLoading(true)
    setError('')
    const filters = {
      startDate: range.startDate,
      endDate: range.endDate,
      status: mode === 'mine' && mineTab === 'records' ? status : 'all' as const,
    }
    const request = mode === 'organization' && organizationId
      ? fetchOrganizationWorkHours(organizationId, filters)
      : mode === 'project' && projectId
        ? fetchProjectWorkHours(projectId, filters)
        : fetchMyWorkHours({ ...filters, projectId: projectFilter === 'all' ? undefined : projectFilter })
    void request.then((data) => { setEntries(data.entries); setSummary(data.summary) })
      .catch((cause) => setError(cause instanceof Error ? cause.message : '工时加载失败。'))
      .finally(() => setLoading(false))
  }, [mineTab, mode, organizationId, projectFilter, projectId, range.endDate, range.startDate, status])

  useEffect(() => { reload() }, [reload])
  useEffect(() => { setRange(rangeForPeriod(period)) }, [period])
  useEffect(() => {
    if (!selectedProjectId || mode !== 'mine') { setTodos([]); return }
    void fetchProjectTodos(selectedProjectId)
      .then((data) => setTodos(data.todos.filter((todo) => todo.assigneeUserId != null && !todo.done && todo.confirmationStatus !== 'pending_review')))
      .catch(() => setTodos([]))
  }, [currentUserId, mode, projects, selectedProjectId])

  useEffect(() => {
    if (mode !== 'mine' || !autoOpenRecorder || initialTodoId == null) return
    setSelectedProjectId(initialProjectId ?? project?.id ?? null)
    setSelectedTodoId(initialTodoId)
    setRecorderContextLocked(true)
    setEditingEntry(null)
    setError('')
    setDialogOpen(true)
    onRecorderContextConsumed?.()
  }, [autoOpenRecorder, initialProjectId, initialTodoId, mode, onRecorderContextConsumed, project?.id])

  useEffect(() => {
    if (mode !== 'mine' || !recorderRequest) return
    openRecorderForTodo(recorderRequest.todoId, recorderRequest.projectId)
  }, [mode, recorderRequest])

  useEffect(() => {
    setSelectedTaskEntryPage(0)
  }, [selectedTaskId])

  useEffect(() => {
    if (selectedTaskId == null) {
      setSelectedTaskEntries([])
      setSelectedTaskEntryTotal(0)
      return
    }
    let active = true
    void fetchTodoWorkHours(selectedTaskId, {
      cursor: selectedTaskEntryPage * 10,
      limit: 10,
    }).then((response) => {
      if (!active) return
      setSelectedTaskEntries(response.entries)
      const total = response.pagination?.total ?? response.entries.length
      setSelectedTaskEntryTotal(total)
      setSelectedTaskEntryPage((page) => Math.min(page, Math.max(0, Math.ceil(total / 10) - 1)))
    }).catch(() => {
      if (!active) return
      setSelectedTaskEntries([])
      setSelectedTaskEntryTotal(0)
    })
    return () => { active = false }
  }, [selectedTaskEntriesVersion, selectedTaskEntryPage, selectedTaskId])

  const projectOptions = useMemo(() => projects.filter((candidate) => candidate.organizationId != null), [projects])
  const filteredProjectOptions = useMemo(() => projectOptions.filter((candidate) => !projectQuery.trim() || candidate.name.toLowerCase().includes(projectQuery.trim().toLowerCase())), [projectOptions, projectQuery])
  const projectPickerSize = 10
  const projectPickerPages = Math.max(1, Math.ceil(filteredProjectOptions.length / projectPickerSize))
  const visibleProjectOptions = filteredProjectOptions.slice(projectPickerPage * projectPickerSize, (projectPickerPage + 1) * projectPickerSize)
  const filteredTasks = useMemo(() => (summary.tasks ?? []).filter((task) => {
    const matchesQuery = !tableQuery.trim() || task.title.toLowerCase().includes(tableQuery.trim().toLowerCase()) || task.assigneeName?.toLowerCase().includes(tableQuery.trim().toLowerCase())
    return matchesQuery && (taskStatus === 'all' || (taskStatus === 'done' ? task.done : !task.done))
  }), [summary.tasks, tableQuery, taskStatus])
  const recorderTasks = useMemo(() => {
    const query = taskQuery.trim().toLowerCase()
    return todos.filter((todo) => {
      return todo.assigneeUserId != null && !todo.done && todo.confirmationStatus !== 'pending_review' && (
        !query || todo.title.toLowerCase().includes(query)
      )
    })
  }, [taskQuery, todos])
  const recorderTaskPages = Math.max(1, Math.ceil(recorderTasks.length / 20))
  const visibleRecorderTasks = recorderTasks.slice(taskPage * 20, (taskPage + 1) * 20)

  useEffect(() => { setProjectPickerPage((page) => Math.min(page, projectPickerPages - 1)) }, [projectPickerPages])
  useEffect(() => { setTaskPage((page) => Math.min(page, recorderTaskPages - 1)) }, [recorderTaskPages])
  useEffect(() => { setTaskPage(0) }, [selectedProjectId, taskQuery])
  useEffect(() => { setTablePage(0) }, [managementTab, mineTab, mode, tableQuery, taskStatus])

  function openRecorder(entry?: WorkHourEntry) {
    setError('')
    setEditingEntry(entry ?? null)
    setRecorderContextLocked(false)
    setSelectedProjectId(entry?.projectId ?? project?.id ?? null)
    setSelectedTodoId(entry?.todoId ?? null)
    setMinutes(String(entry?.minutes ?? 60))
    setWorkDate(entry?.workDate ?? dateInputValue(new Date()))
    setDescription(entry?.description ?? '')
    setDialogOpen(true)
  }

  function openRecorderForTodo(todoId: number, todoProjectId: number) {
    setError('')
    setEditingEntry(null)
    setSelectedProjectId(todoProjectId)
    setSelectedTodoId(todoId)
    setRecorderContextLocked(true)
    setMinutes('60')
    setWorkDate(dateInputValue(new Date()))
    setDescription('')
    setDialogOpen(true)
  }

  async function saveRecord() {
    const amount = Number(minutes)
    if (!description.trim()) { setError('请填写本次工作的说明。'); return }
    if (!selectedTodoId || !Number.isInteger(amount) || amount < 60 || amount > 1440 || amount % 60 !== 0) {
      setError('请选择任务；工时须按整数小时填写，且不超过 24 小时。')
      return
    }
    setSaving(true)
    try {
      if (editingEntry) await updateWorkHour(editingEntry.id, { minutes: amount, workDate, description: description.trim() })
      else await createWorkHour({ todoId: selectedTodoId, minutes: amount, workDate, description: description.trim() })
      setDialogOpen(false)
      onRecorderDismiss?.()
      setSelectedTaskEntriesVersion((version) => version + 1)
      reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '工时保存失败。')
    } finally { setSaving(false) }
  }

  function openExportPrompt() {
    const filtered = tableQuery.trim() ? filteredEntries : entries
    const data = filtered.map((entry) => [
      `日期：${entry.workDate}`,
      `项目：${entry.projectName ?? '未命名项目'}`,
      `任务：${entry.todoTitle ?? `任务 #${entry.todoId}`}`,
      `人员：${entry.userName ?? '未知'}`,
      `时长：${entry.hours} 小时（${entry.minutes} 分钟）`,
      `状态：${entry.status === 'confirmed' ? '已确认' : '待确认'}`,
      `说明：${entry.description || '无'}`,
    ].join('\n')).join('\n\n')
    setExportPrompt(buildAiExportPrompt({
      title: mode === 'project' ? `${project?.name ?? '项目'}工时` : '组织工时统计',
      scope: [
        `模式：${mode === 'project' ? '项目工时' : '工时统计'}`,
        `日期范围：${range.startDate} 至 ${range.endDate}`,
        `状态：${mode === 'mine' ? status : '全部状态'}`,
        tableQuery.trim() ? `当前筛选：${tableQuery.trim()}` : '当前筛选：全部可见记录',
        `记录数：${filtered.length}`,
      ],
      fields: ['日期、项目、任务、人员、分钟数/小时数、确认状态、工作说明', '统计摘要：总投入、已确认、待确认、预估和偏差'],
      data: `${JSON.stringify({ summary, entries: filtered }, null, 2)}\n\n${data}`,
      instructions: ['按项目和任务汇总实际投入，指出已确认与待确认差异。', '比较预估与实际投入，标记明显偏差和需要跟进的任务。'],
    }))
  }

  const maxMemberMinutes = Math.max(...summary.byUser.map((item) => item.minutes), 1)
  const estimatedMinutes = summary.estimatedMinutes ?? summary.byProject.reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0)
  const selectedTask = summary.tasks?.find((task) => task.taskId === selectedTaskId)
  const selectedProjectName = projects.find((candidate) => candidate.id === selectedProjectId)?.name
  const tablePageSize = 10
  const normalizedTableQuery = tableQuery.trim().toLocaleLowerCase('zh-CN')
  const filteredEntries = entries.filter((entry) => !normalizedTableQuery || [entry.projectName, entry.todoTitle, entry.description, entry.userName, entry.workDate, entry.status === 'confirmed' ? '已确认' : '未确认'].join(' ').toLocaleLowerCase('zh-CN').includes(normalizedTableQuery))
  const filteredProjects = summary.byProject.filter((item) => !normalizedTableQuery || item.projectName.toLocaleLowerCase('zh-CN').includes(normalizedTableQuery))
  const filteredUsers = summary.byUser.filter((item) => !normalizedTableQuery || item.userName.toLocaleLowerCase('zh-CN').includes(normalizedTableQuery))
  const filteredDates = summary.byDate.filter((item) => !normalizedTableQuery || item.date.includes(normalizedTableQuery))
  const activeTableRows = mode === 'mine'
    ? mineTab === 'records' ? filteredEntries : filteredProjects
    : managementTab === 'members' ? filteredUsers
      : managementTab === 'trend' ? filteredDates
        : managementTab === 'tasks' ? filteredTasks : filteredProjects
  const tablePages = Math.max(1, Math.ceil(activeTableRows.length / tablePageSize))
  const safeTablePage = Math.min(tablePage, tablePages - 1)
  const pageRows = <T,>(rows: T[]) => rows.slice(safeTablePage * tablePageSize, (safeTablePage + 1) * tablePageSize)
  const visibleEntries = pageRows(filteredEntries)
  const visibleProjects = pageRows(filteredProjects)
  const visibleUsers = pageRows(filteredUsers)
  const visibleDates = pageRows(filteredDates)
  const visibleTasks = pageRows(filteredTasks)
  const tableTools = (placeholder: string, label: string, total: number) => <>
    <label className="work-hours-list-search"><MagnifyingGlass size={15} /><Input aria-label={label} placeholder={placeholder} value={tableQuery} onChange={(event) => setTableQuery(event.target.value)} /></label>
    {total > tablePageSize ? <ListPagination label={`${label}分页`} page={safeTablePage} pageSize={tablePageSize} total={total} onPageChange={setTablePage} /> : null}
  </>
  const recorderProjectPicker = <div className="work-hours-recorder-picker">
    <Input aria-label="搜索项目" placeholder="搜索项目名称" value={projectQuery} onChange={(event) => { setProjectQuery(event.target.value); setProjectPickerPage(0) }} />
    <div aria-label="选择项目" className="work-hours-picker-options" role="listbox">
      {visibleProjectOptions.map((item) => <button aria-selected={selectedProjectId === item.id} className={selectedProjectId === item.id ? 'is-selected' : ''} disabled={Boolean(editingEntry) || recorderContextLocked} key={item.id} onClick={() => { setSelectedProjectId(item.id); setSelectedTodoId(null); setTaskPage(0) }} role="option" type="button">{item.name}</button>)}
      {visibleProjectOptions.length === 0 ? <span className="work-hours-picker-empty">没有匹配的项目</span> : null}
    </div>
    {editingEntry && selectedProjectName ? <span className="work-hours-picker-selected">已选择：{selectedProjectName}</span> : null}
    {projectPickerPages > 1 ? <ListPagination label="填报工时项目分页" page={projectPickerPage} pageSize={projectPickerSize} total={filteredProjectOptions.length} disabled={Boolean(editingEntry) || recorderContextLocked} onPageChange={setProjectPickerPage} /> : null}
  </div>
  const recorderTaskPicker = <div className="work-hours-recorder-picker">
    <Input aria-label="搜索任务" placeholder="搜索任务标题" value={taskQuery} onChange={(event) => { setTaskQuery(event.target.value); setTaskPage(0) }} />
    <div aria-label="选择任务" className="work-hours-picker-options" role="listbox">
      {visibleRecorderTasks.map((todo) => <button aria-selected={selectedTodoId === todo.id} className={selectedTodoId === todo.id ? 'is-selected' : ''} disabled={Boolean(editingEntry) || recorderContextLocked || !selectedProjectId} key={todo.id} onClick={() => setSelectedTodoId(todo.id)} role="option" type="button">{todo.title}</button>)}
      {visibleRecorderTasks.length === 0 ? <span className="work-hours-picker-empty">{selectedProjectId ? '没有可填报的任务' : '请先选择项目'}</span> : null}
    </div>
    {recorderTaskPages > 1 ? <ListPagination label="填报工时任务分页" page={taskPage} pageSize={20} total={recorderTasks.length} disabled={Boolean(editingEntry) || recorderContextLocked || !selectedProjectId} onPageChange={setTaskPage} /> : null}
  </div>

  return (
    <section className={`work-hours-workbench mode-${mode}${recorderOnly ? ' is-recorder-only' : ''}`}>
      {mode === 'mine' ? <div className="work-hours-actions work-hours-actions-only"><Button type="button" onClick={() => openRecorder()}><Plus size={16} />填报工时</Button></div> : <div className="work-hours-actions work-hours-actions-only"><Button type="button" variant="outline" onClick={openExportPrompt}><DownloadSimple size={16} />导出 AI 提示词</Button></div>}

      <nav className="work-hours-tabs" aria-label="工时视图">
        {mode === 'mine' ? <><button className={mineTab === 'records' ? 'is-active' : ''} onClick={() => setMineTab('records')} type="button">工时记录</button><button className={mineTab === 'stats' ? 'is-active' : ''} onClick={() => setMineTab('stats')} type="button">工时统计</button></> : <>
          <button className={managementTab === 'projects' ? 'is-active' : ''} onClick={() => setManagementTab('projects')} type="button">{mode === 'project' ? '项目总览' : '全部项目'}</button>
          <button className={managementTab === 'members' ? 'is-active' : ''} onClick={() => setManagementTab('members')} type="button">成员投入</button>
          <button className={managementTab === 'trend' ? 'is-active' : ''} onClick={() => setManagementTab('trend')} type="button">周 / 月趋势</button>
          {mode === 'project' ? <button className={managementTab === 'tasks' ? 'is-active' : ''} onClick={() => setManagementTab('tasks')} type="button">任务明细</button> : null}
        </>}
      </nav>

      <div className="work-hours-filters">
        <div className="work-hours-period"><button className={period === 'week' ? 'is-active' : ''} onClick={() => setPeriod('week')} type="button">周</button><button className={period === 'month' ? 'is-active' : ''} onClick={() => setPeriod('month')} type="button">月</button></div>
        <div className="work-hours-date-nav"><button onClick={() => setRange((value) => shiftRange(value, period, -1))} type="button">上一周期</button><strong>{range.startDate.replaceAll('-', '.')} - {range.endDate.replaceAll('-', '.')}</strong><button onClick={() => setRange((value) => shiftRange(value, period, 1))} type="button">下一周期</button></div>
        {mode === 'mine' ? <div className="work-hours-project-picker" aria-label="按项目筛选">
          <Input value={projectQuery} onChange={(event) => { setProjectQuery(event.target.value); setProjectPickerPage(0) }} placeholder="搜索项目" aria-label="搜索项目" />
          <button className={projectFilter === 'all' ? 'is-active' : ''} onClick={() => setProjectFilter('all')} type="button">全部项目</button>
          {visibleProjectOptions.map((item) => <button className={projectFilter === item.id ? 'is-active' : ''} key={item.id} onClick={() => setProjectFilter(item.id)} type="button">{item.name}</button>)}
          {projectPickerPages > 1 ? <span className="work-hours-project-pager"><button aria-label="上一页项目" disabled={projectPickerPage === 0} onClick={() => setProjectPickerPage((page) => Math.max(0, page - 1))} type="button">‹</button><span>{projectPickerPage + 1}/{projectPickerPages}</span><button aria-label="下一页项目" disabled={projectPickerPage >= projectPickerPages - 1} onClick={() => setProjectPickerPage((page) => Math.min(projectPickerPages - 1, page + 1))} type="button">›</button></span> : null}
        </div> : null}
        {mode === 'mine' && mineTab === 'records' ? <Label>状态<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">全部状态</option><option value="confirmed">已确认</option><option value="pending">待确认</option></select></Label> : null}
      </div>

      {error ? <div className="work-hours-error" role="alert">{error}</div> : null}
      {mode !== 'mine' || mineTab === 'stats' ? <>
        <div className="work-hours-metrics">
          <div><Clock size={18} /><span>{mode === 'mine' ? '本周期已记录' : mode === 'organization' ? '任务预估' : '累计投入'}</span><strong>{mode === 'organization' ? hours(estimatedMinutes) : hours(summary.totalMinutes)}</strong></div>
          <div><CheckCircle size={18} /><span>{mode === 'mine' ? '本周期已确认' : '已确认'}</span><strong>{hours(summary.confirmedMinutes)}</strong></div>
          <div><TrendUp size={18} /><span>{mode === 'mine' ? '本周期未确认' : '未确认'}</span><strong>{hours(summary.pendingMinutes)}</strong></div>
          <div><ChartLine size={18} /><span>{mode === 'mine' ? '参与项目' : mode === 'organization' ? '完结偏差' : '累计预估'}</span><strong>{mode === 'mine' ? summary.projectCount : mode === 'organization' ? hours(summary.byProject.reduce((sum, item) => sum + (item.varianceMinutes ?? 0), 0)) : hours(estimatedMinutes)}</strong></div>
        </div>
        {mode === 'mine' ? <div className="work-hours-grid">
          <section className="work-hours-card work-hours-table-card"><h4>我的投入明细</h4><p className="work-hours-card-note">{period === 'week' ? '按工作日期每日汇总' : '按自然月日期汇总'}</p>{summary.byDate.length ? <div className="work-hours-table work-hours-date-table"><div className="work-hours-table-row work-hours-table-heading"><span>日期</span><span>总投入</span><span>已确认</span><span>待确认</span></div>{summary.byDate.map((item) => <div className="work-hours-table-row" key={item.date}><strong>{item.date}</strong><span>{hours(item.minutes)}</span><span>{hours(item.confirmedMinutes)}</span><span>{hours(item.pendingMinutes)}</span></div>)}</div> : <p className="work-hours-empty">当前周期暂无记录</p>}</section>
          <section className="work-hours-card"><h4>项目投入</h4>{tableTools('搜索项目', '搜索我的项目投入', filteredProjects.length)}{visibleProjects.map((item) => <button className="work-hours-project-card" key={item.projectId} onClick={() => onProjectClick?.(item.projectId)} type="button"><span>{item.projectName}</span><small>{item.taskCount ?? 0} 个任务</small><strong>{hours(item.minutes)}</strong></button>)}</section>
        </div> : null}
      </> : null}

      {mode !== 'mine' && managementTab === 'projects' ? <>
        <div className="work-hours-overview-grid">
          <section className="work-hours-card work-hours-table-card">
            <div className="work-hours-section-heading"><div><h4>投入日期明细</h4><p className="work-hours-card-note">{period === 'week' ? '按工作日期汇总' : '按自然月日期汇总'}</p></div><span className="work-hours-history-summary">{summary.byDate.length} 个工作日</span></div>
            {summary.byDate.length ? <div className="work-hours-table work-hours-date-table"><div className="work-hours-table-row work-hours-table-heading"><span>日期</span><span>总投入</span><span>已确认</span><span>待确认</span></div>{summary.byDate.map((item) => <div className="work-hours-table-row" key={item.date}><strong>{item.date}</strong><span>{hours(item.minutes)}</span><span>{hours(item.confirmedMinutes)}</span><span>{hours(item.pendingMinutes)}</span></div>)}</div> : <p className="work-hours-empty">当前周期暂无记录</p>}
          </section>
          <section className="work-hours-card work-hours-overview-members">
            <div className="work-hours-section-heading"><div><h4>成员投入</h4><p className="work-hours-card-note">按实际填报人归属</p></div></div>
            {summary.byUser.length ? <div className="work-hours-member-bars">{summary.byUser.map((item) => <div className="work-hours-member-bar-row" key={item.userId}><strong>{item.userName}</strong><div><i style={{ width: `${item.minutes / maxMemberMinutes * 100}%` }} /></div><span>{hours(item.minutes)}</span></div>)}</div> : <p className="work-hours-empty">当前周期暂无成员投入</p>}
          </section>
        </div>
        {mode === 'project' ? <section className="work-hours-card work-hours-table-card"><div className="work-hours-section-heading"><div><h4>任务投入明细</h4><p className="work-hours-card-note">点击任务查看记录详情</p></div></div>{tableTools('搜索任务或负责人', '搜索任务投入', filteredTasks.length)}<div className="work-hours-table work-hours-task-table"><div className="work-hours-table-row work-hours-table-heading"><span>任务</span><span>负责人</span><span>预估</span><span>已确认</span><span>待确认</span><span>状态</span></div>{visibleTasks.map((task) => <button className="work-hours-table-row" key={task.taskId} onClick={() => setSelectedTaskId(task.taskId)} type="button"><strong>{task.title}</strong><span>{task.assigneeName ?? '未分配'}</span><span>{hours(task.estimatedMinutes)}</span><span>{hours(task.confirmedMinutes)}</span><span>{hours(task.pendingMinutes)}</span><span>{task.done ? '已完成' : task.confirmationStatus === 'pending_review' ? '待确认' : '进行中'}</span></button>)}</div>{filteredTasks.length === 0 ? <p className="work-hours-empty">当前周期暂无任务投入</p> : null}</section> : <section className="work-hours-card work-hours-table-card"><h4>项目投入明细</h4>{tableTools('搜索项目', '搜索项目投入', filteredProjects.length)}<div className="work-hours-table work-hours-project-table"><div className="work-hours-table-row work-hours-table-heading"><span>项目</span><span>任务</span><span>预估</span><span>已确认</span><span>待确认</span><span>偏差</span></div>{visibleProjects.map((item) => <button className="work-hours-table-row" key={item.projectId} onClick={() => onProjectClick?.(item.projectId)} type="button"><strong>{item.projectName}</strong><span>{item.taskCount ?? 0}</span><span>{hours(item.estimatedMinutes)}</span><span>{hours(item.confirmedMinutes)}</span><span>{hours(item.pendingMinutes)}</span><span className={(item.varianceMinutes ?? 0) > 0 ? 'is-overrun' : ''}>{item.varianceMinutes == null ? '-' : `${item.varianceMinutes > 0 ? '+' : ''}${hours(item.varianceMinutes)}`}</span></button>)}</div></section>}
      </> : null}
      {mode !== 'mine' && managementTab === 'members' ? <>
        <section className="work-hours-card work-hours-overview-members"><h4>成员投入对比</h4><div className="work-hours-member-bars">{summary.byUser.map((item) => <div className="work-hours-member-bar-row" key={item.userId}><strong>{item.userName}</strong><div><i style={{ width: `${item.minutes / maxMemberMinutes * 100}%` }} /></div><span>{hours(item.minutes)}</span></div>)}</div></section>
        <section className="work-hours-card work-hours-table-card"><h4>成员投入明细</h4>{tableTools('搜索成员', '搜索成员投入', filteredUsers.length)}<div className="work-hours-table work-hours-member-table"><div className="work-hours-table-row work-hours-table-heading"><span>成员</span><span>项目</span><span>任务</span><span>已确认</span><span>待确认</span><span>累计</span></div>{visibleUsers.map((item) => <div className="work-hours-table-row" key={item.userId}><strong>{item.userName}</strong><span>{item.projectCount ?? 0}</span><span>{item.taskCount ?? 0}</span><span>{hours(item.confirmedMinutes)}</span><span>{hours(item.pendingMinutes)}</span><strong>{hours(item.minutes)}</strong></div>)}</div></section>
      </> : null}
      {mode !== 'mine' && managementTab === 'trend' ? <section className="work-hours-card work-hours-table-card"><div className="work-hours-section-heading"><div><h4>每日投入明细</h4><p className="work-hours-card-note">按工作日期拆分已确认与待确认投入</p></div><span className="work-hours-history-summary">{summary.byDate.length} 个工作日</span></div>{tableTools('搜索日期', '搜索每日投入', filteredDates.length)}{summary.byDate.length ? <div className="work-hours-table work-hours-date-table"><div className="work-hours-table-row work-hours-table-heading"><span>日期</span><span>总投入</span><span>已确认</span><span>待确认</span></div>{visibleDates.map((item) => <div className="work-hours-table-row" key={item.date}><strong>{item.date}</strong><span>{hours(item.minutes)}</span><span>{hours(item.confirmedMinutes)}</span><span>{hours(item.pendingMinutes)}</span></div>)}</div> : <p className="work-hours-empty">当前周期暂无记录</p>}</section> : null}
      {mode === 'project' && managementTab === 'tasks' ? <section className="work-hours-card work-hours-table-card"><div className="work-hours-section-heading"><h4>任务明细</h4><div className="work-hours-task-filters"><select value={taskStatus} onChange={(event) => setTaskStatus(event.target.value as typeof taskStatus)}><option value="all">全部状态</option><option value="open">进行中</option><option value="done">已完成</option></select></div></div>{tableTools('搜索任务或负责人', '搜索任务明细', filteredTasks.length)}<div className="work-hours-table work-hours-task-table"><div className="work-hours-table-row work-hours-table-heading"><span>任务</span><span>负责人</span><span>预估</span><span>已确认</span><span>待确认</span><span>状态</span></div>{visibleTasks.map((task) => <button className="work-hours-table-row" key={task.taskId} onClick={() => setSelectedTaskId(task.taskId)} type="button"><strong>{task.title}</strong><span>{task.assigneeName ?? '未分配'}</span><span>{hours(task.estimatedMinutes)}</span><span>{hours(task.confirmedMinutes)}</span><span>{hours(task.pendingMinutes)}</span><span>{task.done ? '已完成' : task.confirmationStatus === 'pending_review' ? '待确认' : '进行中'}</span></button>)}</div></section> : null}

      {mode === 'mine' && mineTab === 'records' ? <section className="work-hours-card work-hours-records"><h4>工时记录</h4>{tableTools('搜索项目、任务、说明或日期', '搜索工时记录', filteredEntries.length)}{loading ? <p className="work-hours-empty">加载中...</p> : filteredEntries.length === 0 ? <p className="work-hours-empty">当前周期暂无匹配工时</p> : <div className="work-hours-record-list">{visibleEntries.map((entry) => <article className="work-hours-record" key={entry.id}><time>{entry.workDate}</time><div><strong>{entry.projectName ?? '项目'} · {entry.todoTitle ?? `任务 #${entry.todoId}`}</strong><p>{entry.description}</p><small>{entry.userName ? `${entry.userName} · ` : ''}{entry.status === 'confirmed' ? '已确认' : '待确认'}</small></div><b>{hours(entry.minutes)}</b>{entry.status === 'pending' ? <div className="work-hours-record-actions"><Button aria-label="编辑工时" size="icon" variant="ghost" onClick={() => openRecorder(entry)}><PencilSimple size={16} /></Button><Button aria-label="删除工时" size="icon" variant="ghost" onClick={() => setDeletingEntry(entry)}><Trash size={16} /></Button></div> : null}</article>)}</div>}</section> : null}

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!saving) { setDialogOpen(open); if (!open) onRecorderDismiss?.() } }}><DialogContent className="work-hours-dialog"><DialogHeader><DialogTitle>{editingEntry ? '编辑工时' : '填报工时'}</DialogTitle><DialogDescription>{recorderContextLocked && !editingEntry ? '已从待办带入项目和任务，请填写本次实际完成的工作。' : '选择组织内可访问的进行中任务，记录本人实际完成的工作。'}</DialogDescription></DialogHeader><div className="work-hours-dialog-form">{recorderContextLocked && !editingEntry ? <div className="work-hours-locked-context" aria-label="已选择的项目和任务"><div><span>项目</span><strong>{selectedProjectName ?? '当前项目'}</strong></div><div><span>任务</span><strong>{todos.find((todo) => todo.id === selectedTodoId)?.title ?? `任务 #${selectedTodoId}`}</strong></div></div> : <><Label>项目{recorderProjectPicker}</Label><Label>任务{recorderTaskPicker}</Label></>}<div className="work-hours-form-grid"><Label>日期<Input max={dateInputValue(new Date())} type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} /></Label><Label>时长（小时）<Input min="1" max="24" step="1" type="number" value={String(Number(minutes) / 60)} onChange={(event) => setMinutes(String(Math.round(Number(event.target.value) * 60)))} /></Label></div><Label><span>工作说明 <span className="field-required" aria-hidden="true">*</span></span><textarea aria-required="true" required value={description} onChange={(event) => setDescription(event.target.value)} placeholder="说明本次完成的工作和结果" rows={4} /></Label>{error ? <div className="work-hours-error">{error}</div> : null}</div><DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)} type="button">取消</Button><Button disabled={saving || !selectedTodoId || !description.trim()} onClick={() => void saveRecord()} type="button">{saving ? '保存中...' : '保存记录'}</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={Boolean(selectedTask)} onOpenChange={(open) => { if (!open) setSelectedTaskId(null) }}><DialogContent className="work-hours-task-drawer"><DialogHeader><DialogTitle>{selectedTask?.title}</DialogTitle><DialogDescription>{selectedTask?.assigneeName ?? '未分配负责人'} · {selectedTask?.done ? '已完成' : selectedTask?.confirmationStatus === 'pending_review' ? '待确认' : '进行中'}</DialogDescription></DialogHeader>{selectedTask ? <><div className="work-hours-drawer-metrics"><div><span>预估</span><strong>{hours(selectedTask.estimatedMinutes)}</strong></div><div><span>已确认</span><strong>{hours(selectedTask.confirmedMinutes)}</strong></div><div><span>待确认</span><strong>{hours(selectedTask.pendingMinutes)}</strong></div></div><div className="work-hours-drawer-list"><h4>工时记录</h4>{selectedTaskEntries.length ? selectedTaskEntries.map((entry) => <div key={entry.id}><span>{entry.workDate}<small>{entry.userName ?? ''}</small></span><p>{entry.description}</p><strong>{hours(entry.minutes)}</strong>{entry.status === 'pending' && entry.userId === currentUserId ? <span className="work-hours-drawer-entry-actions"><Button aria-label="编辑工时" size="icon" variant="ghost" onClick={() => openRecorder(entry)}><PencilSimple size={14} /></Button><Button aria-label="删除工时" size="icon" variant="ghost" onClick={() => setDeletingEntry(entry)}><Trash size={14} /></Button></span> : null}</div>) : <p className="work-hours-empty">当前任务暂无工时记录</p>}</div>{selectedTaskEntryTotal > 10 ? <ListPagination label="任务投入明细分页" page={selectedTaskEntryPage} pageSize={10} total={selectedTaskEntryTotal} onPageChange={setSelectedTaskEntryPage} /> : null}{projectId && selectedTask && selectedTask.assigneeUserId != null && !selectedTask.done && selectedTask.confirmationStatus !== 'pending_review' ? <DialogFooter><Button type="button" onClick={() => { setSelectedTaskId(null); openRecorderForTodo(selectedTask.taskId, projectId) }}>记录工时</Button>{onTodoClick ? <Button type="button" variant="outline" onClick={() => onTodoClick(projectId, selectedTask.taskId)}>打开任务详情</Button> : null}</DialogFooter> : projectId && selectedTask && onTodoClick ? <DialogFooter><Button type="button" onClick={() => onTodoClick(projectId, selectedTask.taskId)}>打开任务详情</Button></DialogFooter> : null}</> : null}</DialogContent></Dialog>
      <ConfirmActionDialog actionKey={`delete-work-hour:${deletingEntry?.id ?? 0}`} open={Boolean(deletingEntry)} onOpenChange={(open) => { if (!open) setDeletingEntry(null) }} title="删除工时记录" description="删除后无法恢复，统计数据会立即更新。" confirmLabel="删除记录" onConfirm={async () => { if (!deletingEntry) return false; await removeWorkHour(deletingEntry.id); setDeletingEntry(null); setSelectedTaskEntriesVersion((version) => version + 1); reload(); return true }} />
      <AiExportPromptDialog open={Boolean(exportPrompt)} onOpenChange={(open) => { if (!open) setExportPrompt(null) }} title="确认导出工时提示词" prompt={exportPrompt ?? ''} fileName={`${project?.name ?? '组织'}工时分析提示词`} summary={`本次将导出 ${tableQuery.trim() ? '当前筛选后的' : '当前周期内的'} ${entries.length} 条已授权工时记录，包含统计摘要和工作说明。`} />
    </section>
  )
}
