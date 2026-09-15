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
import { convertLegacyWeeklyReport, createWeeklyReportDocument, parseWeeklyReportDocument, serializeWeeklyReportDocument, WEEKLY_REPORT_CONTENT_LIMIT, weeklyReportValidationError } from '../../shared/weekly-report-document'
import { weeklyReportProfiles, type WeeklyReportProfile } from '../../shared/weekly-report-profile'
import { WeeklyReportForm, WeeklyReportReading, type WeeklyReportFormHandle } from './weekly-report-form'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog'
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
  navigationBusy?: boolean
  activeProfile?: WeeklyReportProfile
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
  bug: { icon: Flag, label: 'Bug' },
  test_plan: { icon: ListChecks, label: '测试计划' },
}

const SOURCE_PAGE_SIZE = 8
const REPORT_LIST_PAGE_SIZE = 10

type WeeklyReportView = 'editor' | 'list'

const sourceStatusLabel: Record<string, string> = {
  in_progress: '进行中',
  closed: '已关闭',
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
  activeProfile = 'developer',
  navigationBusy = false,
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
  const openPublishedOnLoad = useRef(false)
  const [legacyPreview, setLegacyPreview] = useState<string | null>(null)
  const [preview, setPreview] = useState<'draft' | 'published' | null>(null)
  const formRef = useRef<WeeklyReportFormHandle>(null)
  const [sourceTruncated, setSourceTruncated] = useState(false)
  const [insertTarget, setInsertTarget] = useState<'progress' | 'risk' | 'plan'>('progress')
  const [content, setContent] = useState('')
  const [sourceMode, setSourceMode] = useState<PersonalWeeklyReport['sourceMode']>('manual')
  const [selectedSources, setSelectedSources] = useState<WeeklyReportSourceRef[]>([])
  const [sourceCandidates, setSourceCandidates] = useState<WeeklyReportSourceCandidate[]>([])
  const [sourceKind, setSourceKind] = useState<WeeklyReportSourceKind | 'all'>('all')
  const [relatedOnly, setRelatedOnly] = useState(true)
  const [sourceQuery, setSourceQuery] = useState('')
  const [sourcePage, setSourcePage] = useState(0)
  const [sourcePanelOpen, setSourcePanelOpen] = useState(() => window.innerWidth > 1000)
  const [reportList, setReportList] = useState<PersonalWeeklyReportList | null>(null)
  const [reportListPage, setReportListPage] = useState(0)
  const [reportListRefresh, setReportListRefresh] = useState(0)
  const [reportListLoading, setReportListLoading] = useState(false)
  const [currentWeekSubmitted, setCurrentWeekSubmitted] = useState<boolean | null>(null)
  const [now, setNow] = useState(() => getShanghaiDateTime())
  const [topbarActionHost, setTopbarActionHost] = useState<HTMLElement | null>(null)
  const [loading, setLoading] = useState(true)
  const [internalBusy, setBusy] = useState(false)
  const busy = internalBusy || navigationBusy
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'saving'>('idle')
  const lastSavedSignature = useRef('')
  const saveInFlight = useRef(false)
  const [editorReady, setEditorReady] = useState(false)
  const editorRef = useRef<MarkdownWysiwygEditorHandle>(null)
  const loadedOrganizationId = useRef<number | null>(null)
  const activeContext = useRef(`${organizationId}:${weekStart}:${activeProfile}`)
  const selectedWeekStart = useRef('')
  const selectAllSourcesCheckbox = useRef<HTMLInputElement>(null)
  const today = now.slice(0, 10)

  useEffect(() => {
    activeContext.current = `${organizationId}:${weekStart}:${activeProfile}`
    selectedWeekStart.current = weekStart
  }, [activeProfile, organizationId, weekStart])

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
      ? serializeWeeklyReportDocument(createWeeklyReportDocument(next.activeProfile))
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
        : Promise.resolve({ sources: [], truncated: {} }),
    ])
      .then(([nextReport, sourceResult]) => {
        if (!active) return
        applyReport(nextReport)
        setSourceCandidates(sourceResult.sources)
        setSourceTruncated(Object.values(sourceResult.truncated).some(Boolean))
        setSourceKind('all')
        setInsertTarget('progress')
        setPreview(openPublishedOnLoad.current && nextReport.publishedRevision ? 'published' : null)
        openPublishedOnLoad.current = false
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
  }, [activeProfile, applyReport, canWriteWeeklyReport, organizationId, weekStart, workspaceView])

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

  async function convertLegacyDraft() {
    if (busy || saveInFlight.current || !report) return
    const converted = legacyPreview ? parseWeeklyReportDocument(legacyPreview) : null
    if (!converted) { setError('原文无法安全识别，已保留原文编辑'); return }
    const compatibleSources = selectedSources.filter(source => (weeklyReportProfiles[activeProfile].sourceKinds as readonly string[]).includes(source.kind))
    setBusy(true)
    try {
      const saved = await persistDraft()
      const next = await savePersonalWeeklyReportDraft(organizationId, weekStart, {
        content: serializeWeeklyReportDocument(converted), convertLegacy: true,
        expectedVersion: saved?.draftVersion ?? report.draftVersion, sources: compatibleSources, sourceMode: 'manual',
      })
      applyReport(next)
      setLegacyPreview(null)
      const candidates = await fetchWeeklyReportSources(organizationId, weekStart)
      setSourceCandidates(candidates.sources)
      setSourceTruncated(Object.values(candidates.truncated).some(Boolean))
    } catch (conversionError) { setError(errorMessage(conversionError)) } finally { setBusy(false) }
  }

  const persistDraft = useCallback(async () => {
    if (!canWriteWeeklyReport || report?.readOnlyReason || !report || !organizationId || !weekStart || saveInFlight.current) return report
    const captured = {
      content,
      sourceMode,
      sources: selectedSources,
    }
    const contextKey = `${organizationId}:${weekStart}:${activeProfile}`
    const signature = reportSignature(captured)
    if (signature === lastSavedSignature.current) return report
    if (content.length > WEEKLY_REPORT_CONTENT_LIMIT) {
      setError('周报正文不能超过 12,000 字符，请精简后保存')
      throw new Error('周报正文不能超过 12,000 字符，请精简后保存')
    }
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
  }, [activeProfile, canWriteWeeklyReport, content, organizationId, report, selectedSources, sourceMode, weekStart])

  const prepareOrganizationChange = useCallback(async () => {
    if (busy || saveInFlight.current) return false
    if (workspaceView !== 'editor') return true
    setBusy(true)
    try {
      await persistDraft()
      return true
    } catch (saveError) {
      void saveError
      return false
    } finally { setBusy(false) }
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
    if (busy) return
    const key = sourceKey(source)
    if (selectedSources.length >= 80 && !selectedSourceKeys.has(key)) { setError('每份周报最多关联 80 项工作'); return }
    setSelectedSources((current) => (
      current.some((item) => sourceKey(item) === key)
        ? current.filter((item) => sourceKey(item) !== key)
        : [...current, ('projectId' in source ? { id: source.id, kind: source.kind, projectId: source.projectId } : { id: source.id, kind: source.kind, testSpaceId: source.testSpaceId })]
    ))
  }

  function toggleAllVisibleSources(checked: boolean) {
    if (busy) return
    if (checked && new Set([...selectedSources, ...visibleSources].map(sourceKey)).size > 80) { setError('每份周报最多关联 80 项工作，请缩小筛选范围'); return }
    const visibleKeys = new Set(visibleSources.map(sourceKey))
    setSelectedSources((current) => {
      if (!checked) return current.filter((source) => !visibleKeys.has(sourceKey(source)))
      const currentKeys = new Set(current.map(sourceKey))
      return [
        ...current,
        ...visibleSources
          .filter((source) => !currentKeys.has(sourceKey(source)))
          .map((source) => (('projectId' in source ? { id: source.id, kind: source.kind, projectId: source.projectId } : { id: source.id, kind: source.kind, testSpaceId: source.testSpaceId }))),
      ]
    })
  }

  function insertSelectedSources(asItems = false) {
    if (busy) return
    const selected = sourceCandidates.filter((source) => selectedSourceKeys.has(sourceKey(source)))
    if (formRef.current) {
      formRef.current.insertSources(selected, asItems, insertTarget)
      setSourceMode('manual')
      return
    }
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

  function openEditor(targetWeekStart: string, published = false) {
    openPublishedOnLoad.current = published
    resetEditorState(true)
    setWeekStart(targetWeekStart)
    setWorkspaceView('editor')
    setError('')
  }

  async function changeEditorWeek(targetWeekStart: string) {
    if (targetWeekStart === weekStart || saveInFlight.current || busy) return
    setBusy(true)
    try {
      await persistDraft()
    } catch (saveError) {
      void saveError
      setBusy(false)
      return
    }
    resetEditorState()
    setWeekStart(targetWeekStart)
    setBusy(false)
  }

  async function returnToList() {
    if (saveInFlight.current || busy) return
    setBusy(true)
    try {
      await persistDraft()
    } catch (saveError) {
      void saveError
      setBusy(false)
      return
    }
    setError('')
    setEditorReady(false)
    setWorkspaceView('list')
    setReportListPage(0)
    setReportListRefresh((value) => value + 1)
    setBusy(false)
  }

  async function generateReport() {
    if (saveInFlight.current || busy) return
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
    if (saveInFlight.current) return
    if (!report || !hasWeeklyReportBodyContent(content)) return
    const document = parseWeeklyReportDocument(content)
    if (document && weeklyReportValidationError(document)) { setError(weeklyReportValidationError(document)!); return }
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
        setPreview(null)
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

  const structuredDocument = useMemo(() => parseWeeklyReportDocument(content), [content])
  const canEdit = Boolean(canWriteWeeklyReport && !report?.readOnlyReason)
  const allowedSources = report?.allowedSourceKinds ?? []
  const unlistedSources = selectedSources.filter(source => !sourceCandidates.some(candidate => sourceKey(candidate) === sourceKey(source)))
  async function previewReport() {
    if (saveInFlight.current || busy) return
    if (structuredDocument && !formRef.current?.validate()) return
    setBusy(true)
    try { await persistDraft(); setPreview('draft') } catch { /* retain the unsaved draft */ } finally { setBusy(false) }
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
                      aria-label={`${canWriteWeeklyReport && !item.publishedRevision ? '编辑' : '查看'} ${formatWeekRange(item.weekStart)} 周报`}
                      title={canWriteWeeklyReport && !item.publishedRevision ? '编辑周报' : '查看周报'}
                      type="button"
                      variant="outline"
                      onClick={() => openEditor(item.weekStart, Boolean(item.publishedRevision))}
                    >
                      {canWriteWeeklyReport ? <PencilSimple size={16} /> : <ClipboardText size={16} />}
                      {canWriteWeeklyReport && !item.publishedRevision ? '编辑' : '查看'}
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
      <div className={`weekly-report-layout ${canEdit && allowedSources.length && sourcePanelOpen ? '' : 'source-collapsed'}`}>
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
                  <h3>{report?.reportProfile ? weeklyReportProfiles[report.reportProfile].label : report?.state === 'empty' ? weeklyReportProfiles[activeProfile].label : '历史周报'} · {formatWeekRange(weekStart)}</h3>
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
          {report?.readOnlyReason ? <p className="weekly-report-readonly-note">{report.readOnlyReason}</p> : null}
          {report?.publishedRevision ? <div className="wr-published-note"><span>草稿仅自己可见，管理员仍阅读上次提交版。</span><Button size="sm" variant="ghost" onClick={() => setPreview('published')}>查看已提交版</Button></div> : null}
          {structuredDocument ? <WeeklyReportForm ref={formRef} key={`${organizationId}:${weekStart}:${activeProfile}`} content={content} disabled={!canEdit || busy} onChange={value => { setContent(value); setSourceMode('manual') }} /> : <WeeklyReportEditorBoundary>
            <Suspense fallback={<div className="weekly-report-editor-loading">正在加载编辑器...</div>}>
              <MarkdownWysiwygEditor
                ref={editorRef}
                ariaLabel="周报正文"
                normalizeOnCreate={false}
                placeholder="记录本周完成事项、风险阻塞和下周计划..."
                readOnly={!canEdit || busy}
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
          </WeeklyReportEditorBoundary>}
          {canEdit ? <footer className="weekly-report-actions">
            <div>
              <Button
                aria-busy={generating}
                className="weekly-report-generate-button"
                disabled={busy || loading || saveState === 'saving' || !allowedSources.length}
                type="button"
                variant="outline"
                onClick={() => void generateReport()}
              >
                {generating
                  ? <SpinnerGap aria-hidden className="is-spinning" size={16} />
                  : <MagicWand size={16} />}
                <span aria-live="polite">{generating ? '正在生成周报' : 'AI 起草'}</span>
              </Button>
              {!structuredDocument && !report?.reportProfile && convertLegacyWeeklyReport(content, activeProfile) ? <Button disabled={busy || saveState === 'saving'} variant="outline" onClick={() => setLegacyPreview(serializeWeeklyReportDocument(convertLegacyWeeklyReport(content, activeProfile)!))}>转为任务填写</Button> : null}
              {!structuredDocument ? <Button disabled={busy || !editorReady} type="button" variant="outline" onClick={insertWeeklyReportTemplate}><ClipboardText size={16} />插入历史模板</Button> : null}

            </div>
            <div>
<span className="wr-hint" role="status">{saveState === 'saving' ? '正在保存…' : saveState === 'saved' ? '草稿已保存' : '待保存'}</span>
              <Button disabled={busy || saveState === 'saving'} type="button" variant="outline" onClick={() => void persistDraft().catch(() => undefined)}>
                保存草稿
              </Button>
              <Button disabled={busy || saveState === 'saving' || !hasWeeklyReportBodyContent(content)} type="button" onClick={() => void previewReport()}>
                <PaperPlaneTilt size={16} /> 预览并提交
              </Button>
            </div>
          </footer> : null}
        </div>

        {canEdit && allowedSources.length > 0 && sourcePanelOpen ? (
          <aside className="weekly-report-source-panel" aria-label="关联工作项"><fieldset disabled={busy} className="wr-source-fieldset">
            <div className="weekly-report-source-heading">
              <div className="weekly-report-source-copy">
                <strong>{activeProfile === 'tester' ? '关联本周测试工作' : '关联本周开发工作'}</strong><span>已选 {selectedSources.length}</span>
              </div>
              <div className="weekly-report-source-actions">
                <Button disabled={selectedSources.length === 0 || (!structuredDocument && !editorReady)} size="sm" type="button" variant="outline" onClick={() => insertSelectedSources()}>
                  插入当前事项
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
            <p className="wr-source-note">{formatWeekRange(weekStart)} · 仅此周期<br />Bug 仅含修复中和本周期已关闭的记录。</p>
            {sourceTruncated ? <p className="wr-source-note">仅展示部分结果，请缩小范围；全选仅包含已加载结果。</p> : null}
            {unlistedSources.length ? <div className="wr-invalid-source">以下已关联工作未在当前加载列表中显示；提交时重新检查资格，可手动移除：{unlistedSources.map(source => <Button size="sm" variant="ghost" key={sourceKey(source)} onClick={() => setSelectedSources(current => current.filter(item => sourceKey(item) !== sourceKey(source)))}>{sourceKindMeta[source.kind].label} #{source.id} ×</Button>)}</div> : null}
            {structuredDocument ? <div className="wr-source-note"><Button size="sm" variant="outline" disabled={!selectedSources.length} onClick={() => insertSelectedSources(true)}>添加为{weeklyReportProfiles[activeProfile].item}</Button><select aria-label="选择插入字段" value={insertTarget} onChange={e => setInsertTarget(e.target.value as typeof insertTarget)}><option value="progress">{weeklyReportProfiles[activeProfile].progress}</option><option value="risk">{weeklyReportProfiles[activeProfile].risk}</option><option value="plan">{weeklyReportProfiles[activeProfile].plan}</option></select></div> : null}
            <div className="weekly-report-source-tabs" role="tablist" aria-label="来源类型">
              <button
                className={sourceKind === 'all' ? 'active' : ''}
                type="button"
                onClick={() => {
                  setSourceKind('all')
                  setSourcePage(0)
                }}
              >全部</button>
              {allowedSources.map((kind) => (
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
                全选已加载结果
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
                      <small>{source.projectName} · {source.kind === 'bug' && source.status === 'in_progress' ? '修复中' : sourceStatusLabel[source.status] ?? source.status}</small><small>{source.matchedDate} · {source.matchReason}</small>
                      {source.personalExecutionStats ? <small>{source.testSubjects?.map(subject => subject.name).join('、')} · {source.versionLabel}<br />本人本周期最新记录 {source.personalExecutionStats.total} 条：通过 {source.personalExecutionStats.passed} / 失败 {source.personalExecutionStats.failed} / 阻塞 {source.personalExecutionStats.blocked} / 跳过 {source.personalExecutionStats.skipped}</small> : null}
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
          </fieldset></aside>
        ) : null}
      </div>
      )}

      <Dialog open={legacyPreview !== null} onOpenChange={open => { if (!busy && !open) setLegacyPreview(null) }}>
        <DialogContent className="wr-preview-dialog"><DialogHeader><DialogTitle>转换为任务填写 · 预览</DialogTitle><DialogDescription>每个旧事项的进展转为一项任务，进度保持待填写。确认保存后固定为当前身份；已提交版本保持不变。当前身份不支持的来源引用将移除，正文保留。</DialogDescription></DialogHeader>
          {legacyPreview ? <WeeklyReportReading content={legacyPreview} /> : null}
          <DialogFooter><Button disabled={busy} variant="outline" onClick={() => setLegacyPreview(null)}>撤销转换，保留原文</Button><Button disabled={busy} onClick={() => void convertLegacyDraft()}>确认转换并保存</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={preview !== null} onOpenChange={open => { if (!busy && !open) setPreview(null) }}>
        <DialogContent className="wr-preview-dialog"><DialogHeader><DialogTitle>{preview === 'published' ? '已提交周报' : '提交预览'}</DialogTitle><DialogDescription>{formatWeekRange(weekStart)} · {preview === 'published' ? '管理员可见的提交快照' : '检查全部任务进展和进度后确认提交'}</DialogDescription></DialogHeader>
          <WeeklyReportReading content={preview === 'published' ? report?.publishedContent ?? '' : content} />
          <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setPreview(null)}>返回填写</Button>{preview === 'draft' ? <Button disabled={busy || saveState === 'saving'} onClick={() => void submitReport()}>确认提交</Button> : null}</DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
})
