import {
  Component,
  forwardRef,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  defaultWeeklyReportRules,
  getShanghaiDateTime,
  getWeeklyReportCreationAvailability,
  getWeeklyReportTargetWeekStart,
  type WeeklyReportRules,
} from '../../shared/weekly-report-availability'
import {
  hasWeeklyReportBodyContent,
  isDefaultWeeklyReportTemplate,
  WEEKLY_REPORT_TEMPLATE,
} from '../../shared/weekly-report-template'
import {
  ArrowLeft,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  ClipboardText,
  Flag,
  FolderSimple,
  LinkSimple,
  ListChecks,
  MagicWand,
  MagnifyingGlass,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  SpinnerGap,
  X,
} from '@phosphor-icons/react'
import {
  fetchOrganization,
  fetchPersonalWeeklyReport,
  fetchPersonalWeeklyReports,
  fetchWeeklyReportSources,
  generatePersonalWeeklyReport,
  savePersonalWeeklyReportDraft,
  submitPersonalWeeklyReport,
} from '../api'
import { ApiError } from '../api-error'
import type {
  PersonalWeeklyReport,
  PersonalWeeklyReportList,
  PersonalWeeklyReportListItem,
  WeeklyReportSourceCandidate,
  WeeklyReportSourceKind,
  WeeklyReportSourceRef,
} from '../organization-types'
import type { MarkdownWysiwygEditorHandle } from './markdown-wysiwyg-editor'
import { claimMarkdownEditorRecovery } from './markdown-editor-recovery'
import { Button } from './ui/button'
import { Input } from './ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import './weekly-report-workbench.css'

const MarkdownWysiwygEditor = lazy(() => (
  import('./markdown-wysiwyg-editor').then((module) => ({
    default: module.MarkdownWysiwygEditor,
  }))
))

class WeeklyReportEditorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; retrying: boolean }
> {
  state = { failed: false, retrying: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    if (!claimMarkdownEditorRecovery()) return
    this.setState({ failed: true, retrying: true })
    window.setTimeout(() => window.location.reload(), 0)
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="weekly-report-editor-loading is-error" role="alert">
          <strong>{this.state.retrying ? '正在恢复编辑器…' : '编辑器加载失败'}</strong>
          {!this.state.retrying ? (
            <Button type="button" variant="outline" onClick={() => window.location.reload()}>
              刷新页面
            </Button>
          ) : null}
        </div>
      )
    }
    return this.props.children
  }
}

type WeeklyReportWorkbenchProps = {
  embedded?: boolean
  initialOrganizationId?: number | null
  initialWeekStart?: string | null
  onInitialContextConsumed?: () => void
  organizationId: number | null
  refreshToken?: number
}

export type WeeklyReportWorkbenchHandle = {
  prepareOrganizationChange: () => Promise<boolean>
}

const sourceKindMeta: Record<WeeklyReportSourceKind, {
  icon: typeof ListChecks
  label: string
}> = {
  delivery: { icon: FolderSimple, label: '交付事件' },
  milestone: { icon: Flag, label: '项目里程碑' },
  todo: { icon: ListChecks, label: '待办' },
}

const SOURCE_PAGE_SIZE = 8
const REPORT_LIST_PAGE_SIZE = 10

type WeeklyReportView = 'editor' | 'list'

const sourceStatusLabel: Record<string, string> = {
  achieved: '已达成',
  cancelled: '已取消',
  completed: '已完成',
  confirmed: '已确认',
  delivered: '已交付',
  delivering: '交付中',
  draft: '草稿',
  in_review: '待验收',
  pending: '待处理',
  pending_review: '待确认',
  rejected: '已拒绝',
}

function dateOnly(value: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).format(value)
}

function currentWeekStart(weekStartsOn: number, baseDate = dateOnly(new Date())) {
  const date = new Date(`${baseDate}T00:00:00Z`)
  const startDay = weekStartsOn === 7 ? 0 : weekStartsOn
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() - startDay + 7) % 7))
  return date.toISOString().slice(0, 10)
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function formatWeekRange(weekStart: string) {
  return `${weekStart.replaceAll('-', '/')} - ${shiftDate(weekStart, 6).replaceAll('-', '/')}`
}

function formatDateTime(value: string | null) {
  if (!value) return '--'
  return new Intl.DateTimeFormat('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).format(new Date(value))
}

const reportStateMeta: Record<PersonalWeeklyReportListItem['state'], {
  label: string
  tone: string
}> = {
  draft: { label: '草稿', tone: 'draft' },
  modified: { label: '有未提交修改', tone: 'modified' },
  submitted: { label: '已提交', tone: 'submitted' },
}

function CreateWeeklyReportButton(props: {
  enabled: boolean
  onCreate: () => void
  reason: string
}) {
  return (
    <span
      aria-label={props.reason || undefined}
      className="weekly-report-create-wrap"
      tabIndex={props.enabled ? -1 : 0}
    >
      <Button
        className="solid-button weekly-report-create-button"
        disabled={!props.enabled}
        type="button"
        onClick={props.onCreate}
      >
        <Plus size={17} /> 新建周报
      </Button>
      {!props.enabled ? (
        <span className="weekly-report-create-tooltip" role="tooltip">
          {props.reason}
        </span>
      ) : null}
    </span>
  )
}

function reportSignature(params: {
  content: string
  sourceMode: PersonalWeeklyReport['sourceMode']
  sources: WeeklyReportSourceRef[]
}) {
  const sources = [...params.sources].sort((left, right) => (
    `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`)
  ))
  return JSON.stringify({ content: params.content, sourceMode: params.sourceMode, sources })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请稍后重试'
}

function isWeeklyReportWriteWindowError(error: unknown) {
  return error instanceof ApiError
    && error.status === 409
    && error.message === '当前不在周报可填写时段内'
}

function sourceKey(source: WeeklyReportSourceRef) {
  return `${source.kind}:${source.id}`
}

function markdownForSources(sources: WeeklyReportSourceCandidate[]) {
  if (sources.length === 0) return ''
  return sources.map((source) => (
    `- **${sourceKindMeta[source.kind].label}｜${source.projectName}**：${source.title}（${sourceStatusLabel[source.status] ?? source.status}${source.date ? `，${source.date}` : ''}）`
  )).join('\n')
}

export const WeeklyReportWorkbench = forwardRef<WeeklyReportWorkbenchHandle, WeeklyReportWorkbenchProps>(function WeeklyReportWorkbench({
  embedded = false,
  initialOrganizationId = null,
  initialWeekStart = null,
  onInitialContextConsumed,
  organizationId: providedOrganizationId,
  refreshToken = 0,
}, ref) {
  const organizationId = providedOrganizationId ?? 0
  const resolvedInitialOrganizationId = initialOrganizationId ?? (organizationId || null)
  const initialContext = useRef({
    organizationId: resolvedInitialOrganizationId,
    weekStart: initialWeekStart,
  })
  const [workspaceView, setWorkspaceView] = useState<WeeklyReportView>(() => (
    resolvedInitialOrganizationId && initialWeekStart ? 'editor' : 'list'
  ))
  const [weekStartsOn, setWeekStartsOn] = useState(1)
  const [weeklyReportRules, setWeeklyReportRules] = useState<WeeklyReportRules>(defaultWeeklyReportRules)
  const [canWriteWeeklyReport, setCanWriteWeeklyReport] = useState<boolean | null>(null)
  const [weekStart, setWeekStart] = useState('')
  const [report, setReport] = useState<PersonalWeeklyReport | null>(null)
  const [content, setContent] = useState('')
  const [sourceMode, setSourceMode] = useState<PersonalWeeklyReport['sourceMode']>('manual')
  const [selectedSources, setSelectedSources] = useState<WeeklyReportSourceRef[]>([])
  const [sourceCandidates, setSourceCandidates] = useState<WeeklyReportSourceCandidate[]>([])
  const [sourceKind, setSourceKind] = useState<WeeklyReportSourceKind | 'all'>('all')
  const [relatedOnly, setRelatedOnly] = useState(true)
  const [sourceQuery, setSourceQuery] = useState('')
  const [sourcePage, setSourcePage] = useState(0)
  const [sourcePanelOpen, setSourcePanelOpen] = useState(true)
  const [reportList, setReportList] = useState<PersonalWeeklyReportList | null>(null)
  const [reportListPage, setReportListPage] = useState(0)
  const [reportListRefresh, setReportListRefresh] = useState(0)
  const [reportListLoading, setReportListLoading] = useState(false)
  const [currentWeekSubmitted, setCurrentWeekSubmitted] = useState<boolean | null>(null)
  const [now, setNow] = useState(() => getShanghaiDateTime())
  const [topbarActionHost, setTopbarActionHost] = useState<HTMLElement | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'saving'>('idle')
  const lastSavedSignature = useRef('')
  const saveInFlight = useRef(false)
  const [editorReady, setEditorReady] = useState(false)
  const editorRef = useRef<MarkdownWysiwygEditorHandle>(null)
  const loadedOrganizationId = useRef<number | null>(null)
  const activeContext = useRef(`${organizationId}:${weekStart}`)
  const selectedWeekStart = useRef('')
  const selectAllSourcesCheckbox = useRef<HTMLInputElement>(null)
  const today = now.slice(0, 10)

  useEffect(() => {
    activeContext.current = `${organizationId}:${weekStart}`
    selectedWeekStart.current = weekStart
  }, [organizationId, weekStart])

  useEffect(() => {
    if (initialOrganizationId && initialWeekStart) onInitialContextConsumed?.()
  }, [initialOrganizationId, initialWeekStart, onInitialContextConsumed])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(getShanghaiDateTime()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (workspaceView !== 'list') return
    setCurrentWeekSubmitted(null)
    setReportListPage(0)
  }, [today, workspaceView])

  useEffect(() => {
    setTopbarActionHost(document.getElementById(
      embedded ? 'weekly-report-embedded-toolbar-actions' : 'weekly-report-topbar-actions',
    ))
    return () => setTopbarActionHost(null)
  }, [embedded, organizationId, workspaceView])

  const weekOptions = useMemo(() => {
    const current = currentWeekStart(weekStartsOn, today)
    const options = Array.from({ length: 12 }, (_, index) => shiftDate(current, -7 * index))
    if (workspaceView === 'editor' && weekStart && !options.includes(weekStart)) {
      return [weekStart, ...options]
    }
    return options
  }, [today, weekStart, weekStartsOn, workspaceView])

  const selectedSourceKeys = useMemo(
    () => new Set(selectedSources.map(sourceKey)),
    [selectedSources],
  )

  const visibleSources = useMemo(() => {
    const normalizedQuery = sourceQuery.trim().toLocaleLowerCase('zh-CN')
    return sourceCandidates.filter((source) => {
      if (sourceKind !== 'all' && source.kind !== sourceKind) return false
      if (relatedOnly && !source.relatedToMe) return false
      if (!normalizedQuery) return true
      const searchableText = [
        source.title,
        source.projectName,
        sourceStatusLabel[source.status] ?? source.status,
      ].join(' ').toLocaleLowerCase('zh-CN')
      return searchableText.includes(normalizedQuery)
    })
  }, [relatedOnly, sourceCandidates, sourceKind, sourceQuery])

  const sourceTotalPages = Math.max(1, Math.ceil(visibleSources.length / SOURCE_PAGE_SIZE))
  const normalizedSourcePage = Math.min(sourcePage, sourceTotalPages - 1)
  const pagedSources = useMemo(() => visibleSources.slice(
    normalizedSourcePage * SOURCE_PAGE_SIZE,
    (normalizedSourcePage + 1) * SOURCE_PAGE_SIZE,
  ), [normalizedSourcePage, visibleSources])
  const sourceVisibleStart = visibleSources.length === 0
    ? 0
    : normalizedSourcePage * SOURCE_PAGE_SIZE + 1
  const sourceVisibleEnd = Math.min(
    (normalizedSourcePage + 1) * SOURCE_PAGE_SIZE,
    visibleSources.length,
  )
  const selectedVisibleSourceCount = visibleSources.reduce(
    (count, source) => count + (selectedSourceKeys.has(sourceKey(source)) ? 1 : 0),
    0,
  )
  const allVisibleSourcesSelected = visibleSources.length > 0
    && selectedVisibleSourceCount === visibleSources.length

  useEffect(() => {
    if (!selectAllSourcesCheckbox.current) return
    selectAllSourcesCheckbox.current.indeterminate = selectedVisibleSourceCount > 0
      && !allVisibleSourcesSelected
  }, [allVisibleSourcesSelected, selectedVisibleSourceCount])

  const currentSignature = useMemo(() => reportSignature({
    content,
    sourceMode,
    sources: selectedSources,
  }), [content, selectedSources, sourceMode])

  const applyReport = useCallback((next: PersonalWeeklyReport) => {
    const nextContent = canWriteWeeklyReport && next.state === 'empty' && !next.content.trim()
      ? WEEKLY_REPORT_TEMPLATE
      : next.content
    setWeekStart(next.weekStart)
    setReport(next)
    setContent(nextContent)
    setSourceMode(next.sourceMode)
    setSelectedSources(next.sources)
    lastSavedSignature.current = reportSignature({
      content: nextContent,
      sourceMode: next.sourceMode,
      sources: next.sources,
    })
    setSaveState('saved')
  }, [canWriteWeeklyReport])

  const previousOrganizationId = useRef(organizationId)

  useEffect(() => {
    if (previousOrganizationId.current === organizationId) return
    previousOrganizationId.current = organizationId
    setReportList(null)
    setReportListPage(0)
    setCurrentWeekSubmitted(null)
    setCanWriteWeeklyReport(null)
    if (workspaceView !== 'editor') return
    setReport(null)
    setContent('')
    setSourceMode('manual')
    setSelectedSources([])
    setSourceCandidates([])
    setSourceKind('all')
    setSourceQuery('')
    setSourcePage(0)
    setSaveState('idle')
    lastSavedSignature.current = ''
    setWeekStart('')
  }, [organizationId, workspaceView])

  useEffect(() => {
    if (!organizationId) {
      setLoading(false)
      return
    }
    let active = true
    const organizationChanged = loadedOrganizationId.current !== organizationId
    if (organizationChanged) setLoading(true)
    fetchOrganization(organizationId)
      .then((detail) => {
        if (!active) return
        if (organizationChanged) setCurrentWeekSubmitted(null)
        setWeekStartsOn(detail.weekStartsOn)
        setWeeklyReportRules(detail.weeklyReportRules)
        setCanWriteWeeklyReport(detail.canWriteWeeklyReport)
        const current = currentWeekStart(detail.weekStartsOn, today)
        const preferredWeek = organizationId === initialContext.current.organizationId
          && initialContext.current.weekStart
          && initialContext.current.weekStart <= current
          ? initialContext.current.weekStart
          : current
        // Background workspace refreshes must not move an editor that is viewing
        // a historical week back to the current week.
        if (organizationChanged || !selectedWeekStart.current) setWeekStart(preferredWeek)
        loadedOrganizationId.current = organizationId
        setLoading(false)
      })
      .catch((loadError) => {
        if (active) {
          setError(errorMessage(loadError))
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [organizationId, refreshToken, today])

  useEffect(() => {
    if (workspaceView !== 'editor' || !organizationId || !weekStart) return
    let active = true
    setLoading(true)
    Promise.all([
      fetchPersonalWeeklyReport(organizationId, weekStart),
      canWriteWeeklyReport
        ? fetchWeeklyReportSources(organizationId, weekStart)
        : Promise.resolve({ sources: [] }),
    ])
      .then(([nextReport, sourceResult]) => {
        if (!active) return
        applyReport(nextReport)
        setSourceCandidates(sourceResult.sources)
        setSourceQuery('')
        setSourcePage(0)
        setError('')
      })
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [applyReport, canWriteWeeklyReport, organizationId, weekStart, workspaceView])

  useEffect(() => {
    if (workspaceView !== 'list' || !organizationId) return
    let active = true
    setReportListLoading(true)
    fetchPersonalWeeklyReports(organizationId, {
      limit: REPORT_LIST_PAGE_SIZE,
      offset: reportListPage * REPORT_LIST_PAGE_SIZE,
    })
      .then((result) => {
        if (!active) return
        setReportList(result)
        if (reportListPage === 0) {
          const activeWeek = getWeeklyReportTargetWeekStart({
            now,
            rules: weeklyReportRules,
            weekStartsOn,
          })
          const currentReport = result.items.find((item) => item.weekStart === activeWeek)
          setCurrentWeekSubmitted(Boolean(currentReport?.publishedRevision))
        }
        setError('')
      })
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError))
      })
      .finally(() => {
        if (active) setReportListLoading(false)
      })
    return () => {
      active = false
    }
  }, [now, organizationId, refreshToken, reportListPage, reportListRefresh, today, weekStartsOn, weeklyReportRules, workspaceView])

  const persistDraft = useCallback(async () => {
    if (!canWriteWeeklyReport || !report || !organizationId || !weekStart || saveInFlight.current) return report
    const captured = {
      content,
      sourceMode,
      sources: selectedSources,
    }
    const contextKey = `${organizationId}:${weekStart}`
    const signature = reportSignature(captured)
    if (signature === lastSavedSignature.current) return report
    saveInFlight.current = true
    setSaveState('saving')
    try {
      const next = await savePersonalWeeklyReportDraft(organizationId, weekStart, {
        ...captured,
        expectedVersion: report.draftVersion,
      })
      if (activeContext.current !== contextKey) return next
      lastSavedSignature.current = signature
      setReport(next)
      setSaveState('saved')
      setError('')
      return next
    } catch (saveError) {
      setSaveState('idle')
      setError(errorMessage(saveError))
      throw saveError
    } finally {
      saveInFlight.current = false
    }
  }, [canWriteWeeklyReport, content, organizationId, report, selectedSources, sourceMode, weekStart])

  const prepareOrganizationChange = useCallback(async () => {
    if (busy || saveInFlight.current) return false
    if (workspaceView !== 'editor') return true
    try {
      await persistDraft()
      return true
    } catch (saveError) {
      return isWeeklyReportWriteWindowError(saveError)
    }
  }, [busy, persistDraft, workspaceView])

  useImperativeHandle(ref, () => ({ prepareOrganizationChange }), [prepareOrganizationChange])

  useEffect(() => {
    if (!canWriteWeeklyReport || workspaceView !== 'editor' || !report || loading || busy || currentSignature === lastSavedSignature.current) return
    setSaveState('idle')
    const timer = window.setTimeout(() => {
      void persistDraft().catch(() => undefined)
    }, 900)
    return () => window.clearTimeout(timer)
  }, [busy, canWriteWeeklyReport, currentSignature, loading, persistDraft, report, workspaceView])

  function toggleSource(source: WeeklyReportSourceCandidate) {
    const key = sourceKey(source)
    setSelectedSources((current) => (
      current.some((item) => sourceKey(item) === key)
        ? current.filter((item) => sourceKey(item) !== key)
        : [...current, { id: source.id, kind: source.kind, projectId: source.projectId }]
    ))
  }

  function toggleAllVisibleSources(checked: boolean) {
    const visibleKeys = new Set(visibleSources.map(sourceKey))
    setSelectedSources((current) => {
      if (!checked) return current.filter((source) => !visibleKeys.has(sourceKey(source)))
      const currentKeys = new Set(current.map(sourceKey))
      return [
        ...current,
        ...visibleSources
          .filter((source) => !currentKeys.has(sourceKey(source)))
          .map((source) => ({ id: source.id, kind: source.kind, projectId: source.projectId })),
      ]
    })
  }

  function insertSelectedSources() {
    const selected = sourceCandidates.filter((source) => selectedSourceKeys.has(sourceKey(source)))
    const markdown = markdownForSources(selected)
    if (!markdown) return
    if (editorRef.current?.insertMarkdownAtCursor(markdown)) setSourceMode('manual')
  }

  function insertWeeklyReportTemplate() {
    if (editorRef.current?.insertMarkdownAtCursor(WEEKLY_REPORT_TEMPLATE)) setSourceMode('manual')
  }

  function resetEditorState(resetEditorReadiness = false) {
    if (resetEditorReadiness) setEditorReady(false)
    setReport(null)
    setContent('')
    setSourceMode('manual')
    setSelectedSources([])
    setSourceCandidates([])
    setSourceKind('all')
    setSourceQuery('')
    setSourcePage(0)
    setSaveState('idle')
    lastSavedSignature.current = ''
  }

  function openEditor(targetWeekStart: string) {
    resetEditorState(true)
    setWeekStart(targetWeekStart)
    setWorkspaceView('editor')
    setError('')
  }

  async function changeEditorWeek(targetWeekStart: string) {
    if (targetWeekStart === weekStart) return
    try {
      await persistDraft()
    } catch (saveError) {
      if (!isWeeklyReportWriteWindowError(saveError)) return
    }
    resetEditorState()
    setWeekStart(targetWeekStart)
  }

  async function returnToList() {
    try {
      await persistDraft()
    } catch (saveError) {
      if (!isWeeklyReportWriteWindowError(saveError)) return
    }
    setError('')
    setEditorReady(false)
    setWorkspaceView('list')
    setReportListPage(0)
    setReportListRefresh((value) => value + 1)
  }

  async function generateReport() {
    if (!report) return
    if (
      content.trim()
      && !isDefaultWeeklyReportTemplate(content)
      && !window.confirm('AI 生成内容会替换当前草稿，是否继续？')
    ) return
    setBusy(true)
    setGenerating(true)
    setError('')
    const contextKey = activeContext.current
    try {
      const saved = await persistDraft()
      const next = await generatePersonalWeeklyReport(organizationId, weekStart, {
        expectedVersion: saved?.draftVersion ?? report.draftVersion,
        sources: selectedSources,
      })
      if (activeContext.current === contextKey) applyReport(next)
    } catch (generateError) {
      setError(errorMessage(generateError))
    } finally {
      setGenerating(false)
      setBusy(false)
    }
  }

  async function submitReport() {
    if (!report || !hasWeeklyReportBodyContent(content)) return
    setBusy(true)
    setError('')
    const contextKey = activeContext.current
    try {
      const saved = await persistDraft()
      const next = await submitPersonalWeeklyReport(
        organizationId,
        weekStart,
        saved?.draftVersion ?? report.draftVersion,
      )
      if (activeContext.current === contextKey) {
        applyReport(next)
        setCurrentWeekSubmitted(true)
        setWorkspaceView('list')
        setReportListPage(0)
        setReportListRefresh((value) => value + 1)
      }
    } catch (submitError) {
      setError(errorMessage(submitError))
    } finally {
      setBusy(false)
    }
  }

  const activeWeekStart = getWeeklyReportTargetWeekStart({
    now,
    rules: weeklyReportRules,
    weekStartsOn,
  })
  const createAvailability = getWeeklyReportCreationAvailability({
    loading: loading || reportListLoading || currentWeekSubmitted === null,
    now,
    rules: weeklyReportRules,
    submitted: currentWeekSubmitted === true,
    today,
    weekStart: activeWeekStart,
  })
  const canCreateWeeklyReport = canWriteWeeklyReport === true && createAvailability.enabled
  const weeklyReportCreationReason = canWriteWeeklyReport === false
    ? '当前无需填写本组织周报。'
    : createAvailability.reason

  const weeklyReportToolbar = topbarActionHost && organizationId > 0
    ? createPortal(
      <div className="weekly-report-toolbar">
        {workspaceView === 'editor' ? (
          <Select value={weekStart} onValueChange={(value) => void changeEditorWeek(value)}>
            <SelectTrigger
              aria-label="选择周报周期"
              className="weekly-report-select weekly-report-period-select"
              disabled={busy || saveState === 'saving'}
            >
              <CalendarBlank size={16} />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {weekOptions.map((value, index) => (
                <SelectItem key={value} value={value}>
                  {index === 0 ? '本周 · ' : ''}{formatWeekRange(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <CreateWeeklyReportButton
            enabled={canCreateWeeklyReport}
            reason={weeklyReportCreationReason}
            onCreate={() => openEditor(activeWeekStart)}
          />
        )}
      </div>,
      topbarActionHost,
    )
    : null

  if (!organizationId) {
    return (
      <div className="weekly-report-empty">
        <ClipboardText size={32} weight="duotone" />
        <strong>{embedded ? '当前测试空间未关联组织' : '当前未选择组织'}</strong>
        <span>{embedded ? '关联组织后，可以在这里整理并提交个人周报。' : '请从侧栏选择组织后再查看周报。'}</span>
      </div>
    )
  }

  if (loading) {
    return <div className="weekly-report-empty">正在加载周报管理...</div>
  }

  const reportListTotalPages = Math.max(
    1,
    Math.ceil((reportList?.total ?? 0) / REPORT_LIST_PAGE_SIZE),
  )

  return (
    <section className={`weekly-report-workbench is-${workspaceView}`} aria-label="周报管理">
      {weeklyReportToolbar}

      {error ? <div className="weekly-report-error" role="alert">{error}</div> : null}

      {workspaceView === 'list' ? (
        <div className="weekly-report-index">
          {embedded ? <div id="weekly-report-embedded-toolbar-actions" className="weekly-report-embedded-toolbar-host" /> : null}
          <header className="weekly-report-index-heading">
            <div>
              <h2>我的周报</h2>
              <span>共 {reportList?.total ?? 0} 份</span>
            </div>
          </header>

          {reportListLoading && !reportList ? (
            <div className="weekly-report-index-loading">
              <SpinnerGap aria-hidden className="is-spinning" size={18} /> 正在加载周报...
            </div>
          ) : reportList?.items.length ? (
            <div className="weekly-report-list" role="list">
              <div className="weekly-report-list-head" aria-hidden="true">
                <span>周报周期</span>
                <span>状态</span>
                <span>关联工作</span>
                <span>最近更新</span>
                <span>操作</span>
              </div>
              {reportList.items.map((item) => {
                const state = reportStateMeta[item.state]
                return (
                  <article className="weekly-report-list-row" key={item.weekStart} role="listitem">
                    <div className="weekly-report-list-period">
                      <strong>{formatWeekRange(item.weekStart)}</strong>
                      <span>{item.publishedRevision ? `已提交第 ${item.publishedRevision} 版` : '尚未提交'}</span>
                    </div>
                    <div>
                      <span className={`weekly-report-state is-${state.tone}`}>{state.label}</span>
                    </div>
                    <div className="weekly-report-list-source-count">
                      <LinkSimple size={16} /> {item.sourceCount} 项
                    </div>
                    <div className="weekly-report-list-updated">
                      <strong>{formatDateTime(item.updatedAt)}</strong>
                      <span>{item.submittedAt ? `提交于 ${formatDateTime(item.submittedAt)}` : '草稿自动保存'}</span>
                    </div>
                    <Button
                      aria-label={`${canWriteWeeklyReport ? '编辑' : '查看'} ${formatWeekRange(item.weekStart)} 周报`}
                      title={canWriteWeeklyReport ? '编辑周报' : '查看周报'}
                      type="button"
                      variant="outline"
                      onClick={() => openEditor(item.weekStart)}
                    >
                      {canWriteWeeklyReport ? <PencilSimple size={16} /> : <ClipboardText size={16} />}
                      {canWriteWeeklyReport ? '编辑' : '查看'}
                    </Button>
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="weekly-report-index-empty">
              <ClipboardText size={32} weight="duotone" />
              <strong>{canWriteWeeklyReport ? '还没有周报' : '当前无需填写周报'}</strong>
              {canWriteWeeklyReport ? (
                <CreateWeeklyReportButton
                  enabled={canCreateWeeklyReport}
                  reason={weeklyReportCreationReason}
                  onCreate={() => openEditor(activeWeekStart)}
                />
              ) : null}
            </div>
          )}

          {reportList && reportList.total > REPORT_LIST_PAGE_SIZE ? (
            <nav className="weekly-report-index-pagination" aria-label="周报列表分页">
              <span>第 {reportListPage + 1} / {reportListTotalPages} 页</span>
              <div>
                <Button
                  aria-label="上一页"
                  disabled={reportListPage === 0 || reportListLoading}
                  size="icon"
                  title="上一页"
                  type="button"
                  variant="ghost"
                  onClick={() => setReportListPage((page) => Math.max(0, page - 1))}
                ><CaretLeft /></Button>
                <Button
                  aria-label="下一页"
                  disabled={reportListPage >= reportListTotalPages - 1 || reportListLoading}
                  size="icon"
                  title="下一页"
                  type="button"
                  variant="ghost"
                  onClick={() => setReportListPage((page) => page + 1)}
                ><CaretRight /></Button>
              </div>
            </nav>
          ) : null}
        </div>
      ) : (
      <div className={`weekly-report-layout ${canWriteWeeklyReport && sourcePanelOpen ? '' : 'source-collapsed'}`}>
        {embedded ? <div id="weekly-report-embedded-toolbar-actions" className="weekly-report-embedded-toolbar-host" /> : null}
        <div className="weekly-report-editor-panel">
          <div className="weekly-report-editor-header">
            <div className="weekly-report-editor-heading">
              <div className="weekly-report-editor-title">
                <Button
                  aria-label="返回周报列表"
                  disabled={busy || saveState === 'saving'}
                  size="icon"
                  title="返回周报列表"
                  type="button"
                  variant="ghost"
                  onClick={() => void returnToList()}
                ><ArrowLeft /></Button>
                <div>
                  <h3>{formatWeekRange(weekStart)}</h3>
                  <span>{report?.publishedRevision ? `已提交第 ${report.publishedRevision} 版` : '尚未提交'}</span>
                </div>
              </div>
              {canWriteWeeklyReport ? (
                <Button type="button" variant="outline" onClick={() => setSourcePanelOpen((open) => !open)}>
                  <LinkSimple size={16} /> {sourcePanelOpen ? '收起关联项' : `关联工作 ${selectedSources.length}`}
                </Button>
              ) : null}
            </div>
            {!canWriteWeeklyReport ? (
              <div className="weekly-report-readonly-note">当前无需填写本组织周报，已有内容仅供查看。</div>
            ) : null}
          </div>
          <WeeklyReportEditorBoundary>
            <Suspense fallback={<div className="weekly-report-editor-loading">正在加载编辑器...</div>}>
              <MarkdownWysiwygEditor
                ref={editorRef}
                ariaLabel="周报正文"
                placeholder="记录本周完成事项、风险阻塞和下周计划..."
                readOnly={!canWriteWeeklyReport}
                value={content}
                onReady={() => {
                  setEditorReady(true)
                }}
                onChange={(nextContent) => {
                  setContent(nextContent)
                  if (editorReady) setSourceMode('manual')
                }}
              />
            </Suspense>
          </WeeklyReportEditorBoundary>
          {canWriteWeeklyReport ? <footer className="weekly-report-actions">
            <div>
              <Button
                aria-busy={generating}
                className="weekly-report-generate-button"
                disabled={busy || loading || saveState === 'saving'}
                type="button"
                variant="outline"
                onClick={() => void generateReport()}
              >
                {generating
                  ? <SpinnerGap aria-hidden className="is-spinning" size={16} />
                  : <MagicWand size={16} />}
                <span aria-live="polite">{generating ? '正在生成周报' : '一键生成周报'}</span>
              </Button>
              <Button
                disabled={busy || loading || saveState === 'saving' || !editorReady}
                type="button"
                variant="outline"
                onClick={insertWeeklyReportTemplate}
              >
                <ClipboardText size={16} /> 一键插入模版
              </Button>
            </div>
            <div>
              <Button disabled={busy || saveState === 'saving'} type="button" variant="outline" onClick={() => void persistDraft()}>
                保存草稿
              </Button>
              <Button disabled={busy || saveState === 'saving' || !hasWeeklyReportBodyContent(content)} type="button" onClick={() => void submitReport()}>
                <PaperPlaneTilt size={16} /> 确认提交
              </Button>
            </div>
          </footer> : null}
        </div>

        {canWriteWeeklyReport && sourcePanelOpen ? (
          <aside className="weekly-report-source-panel" aria-label="关联工作项">
            <div className="weekly-report-source-heading">
              <div className="weekly-report-source-copy">
                <strong>关联工作</strong><span>已选 {selectedSources.length}</span>
              </div>
              <div className="weekly-report-source-actions">
                <Button disabled={selectedSources.length === 0 || !editorReady} size="sm" type="button" variant="outline" onClick={insertSelectedSources}>
                  插入正文
                </Button>
                <Button
                  aria-label="关闭关联工作"
                  className="weekly-report-source-close"
                  size="icon"
                  title="关闭关联工作"
                  type="button"
                  variant="ghost"
                  onClick={() => setSourcePanelOpen(false)}
                ><X /></Button>
              </div>
            </div>
            <div className="weekly-report-source-tabs" role="tablist" aria-label="来源类型">
              <button
                className={sourceKind === 'all' ? 'active' : ''}
                type="button"
                onClick={() => {
                  setSourceKind('all')
                  setSourcePage(0)
                }}
              >全部</button>
              {(Object.keys(sourceKindMeta) as WeeklyReportSourceKind[]).map((kind) => (
                <button
                  key={kind}
                  className={sourceKind === kind ? 'active' : ''}
                  type="button"
                  onClick={() => {
                    setSourceKind(kind)
                    setSourcePage(0)
                  }}
                >
                  {sourceKindMeta[kind].label}
                </button>
              ))}
            </div>
            <div className="weekly-report-source-search">
              <MagnifyingGlass size={15} aria-hidden="true" />
              <Input
                aria-label="搜索关联工作"
                placeholder="搜索标题、项目或状态"
                type="search"
                value={sourceQuery}
                onChange={(event) => {
                  setSourceQuery(event.target.value)
                  setSourcePage(0)
                }}
              />
            </div>
            <div className="weekly-report-source-selection-controls">
              <label className="weekly-report-related-toggle">
                <input
                  checked={relatedOnly}
                  type="checkbox"
                  onChange={(event) => {
                    setRelatedOnly(event.target.checked)
                    setSourcePage(0)
                  }}
                />
                仅显示与我相关
              </label>
              <label className="weekly-report-select-all" title="全选当前筛选结果">
                <input
                  ref={selectAllSourcesCheckbox}
                  checked={allVisibleSourcesSelected}
                  disabled={visibleSources.length === 0}
                  type="checkbox"
                  onChange={(event) => toggleAllVisibleSources(event.target.checked)}
                />
                全选
              </label>
            </div>
            <div className="weekly-report-source-list">
              {pagedSources.map((source) => {
                const Icon = sourceKindMeta[source.kind].icon
                const checked = selectedSourceKeys.has(sourceKey(source))
                return (
                  <label className={checked ? 'selected' : ''} key={sourceKey(source)}>
                    <input checked={checked} type="checkbox" onChange={() => toggleSource(source)} />
                    <Icon size={17} weight="duotone" />
                    <span>
                      <strong>{source.title}</strong>
                      <small>{source.projectName} · {sourceStatusLabel[source.status] ?? source.status}{source.date ? ` · ${source.date}` : ''}</small>
                    </span>
                  </label>
                )
              })}
              {visibleSources.length === 0 ? <p>当前筛选下没有可关联的工作项。</p> : null}
            </div>
            <nav className="weekly-report-source-pagination" aria-label="关联工作分页">
              <span>
                <strong>{sourceVisibleStart}-{sourceVisibleEnd}</strong> / {visibleSources.length}
              </span>
              <div>
                <Button
                  aria-label="上一页"
                  title="上一页"
                  disabled={normalizedSourcePage === 0}
                  size="icon"
                  type="button"
                  variant="ghost"
                  onClick={() => setSourcePage(normalizedSourcePage - 1)}
                ><CaretLeft /></Button>
                <small>{normalizedSourcePage + 1} / {sourceTotalPages}</small>
                <Button
                  aria-label="下一页"
                  title="下一页"
                  disabled={normalizedSourcePage >= sourceTotalPages - 1}
                  size="icon"
                  type="button"
                  variant="ghost"
                  onClick={() => setSourcePage(normalizedSourcePage + 1)}
                ><CaretRight /></Button>
              </div>
            </nav>
          </aside>
        ) : null}
      </div>
      )}

    </section>
  )
})
