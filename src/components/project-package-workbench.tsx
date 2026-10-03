import { ConfirmActionDialog } from './confirm-action-dialog'
import { createResumableAction } from '../confirmed-action'
import { ConfirmActionDialog as DeleteConfirmDialog } from './confirm-action-dialog'
import { useConfirmAction } from '../hooks/use-confirm-action'
import {
  Component,
  forwardRef,
  lazy,
  Suspense,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import {
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  ChatCircleDots,
  Check,
  Copy,
  DotsThree,
  Eye,
  EyeSlash,
  FunnelSimple,
  LinkSimple,
  MagnifyingGlass,
  Package,
  PencilSimple,
  Plus,
  ShoppingCartSimple,
  SortAscending,
  SortDescending,
  TerminalWindow,
  Trash,
} from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MentionTextarea, type MentionMember } from '@/components/mention-textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { JournalDatePicker } from '@/components/journal-date-picker'
import { getProjectPackageOperationTitle } from '@/lib/project-package-operation'
import { createWgetDownloadCommand } from '@/lib/download-command'
import {
  TodoFilterBuilderDialog,
  matchesTodoFilterConditions,
  type TodoFilterCondition,
  type TodoFilterJoin,
} from '@/components/todo-filter-builder-dialog'
import { PackageEventFilterBuilderDialog } from '@/components/package-event-filter-builder-dialog'
import {
  type PackageEventFilterCondition,
  type PackageEventFilterJoin,
} from '@/components/package-event-filter'
import type {
  PackageMarketChannel,
  PackageMarketCiBranch,
  PackageMarketDetail,
  PackageMarketRule,
  PackageMarketVersion,
  Project,
  ProjectMembership,
  ProjectPackageEvent,
  ProjectPackageDeliveryScript,
  ProjectPackageDeliveryStep,
  ProjectPackageDeliveryArtifacts,
  ProjectPackageEventComment,
  ProjectPackageEventSavePayload,
  ProjectPackageEventStatus,
  ProjectPackageItem,
  ProjectPackageEventType,
  ProjectPackageOperation,
  ProjectPackageOperationKind,
  ProjectPackageOperationStatus,
  ProjectPackageTimeline,
  ProjectPackageTimelineQuery,
  Todo,
} from '@/types'
import { resolveExistingOperationInteraction } from '@/project-package-operation-access'
import { UserName } from '@/components/user-name'
import { ListPagination } from '@/components/list-pagination'
import type {
  PackageMarketRequestContext,
  PackageMarketRulesResponse,
} from '@/api'
import {
  canonicalPackageMarketRuleId,
  isPackageMarketRuleVisible,
  organizationPackageMarketPolicyHasVisibleChannel,
  packageMarketDependencyChannel,
} from '../../shared/organization-package-market'
import { containerImageReferenceKey, normalizeContainerImageReference } from '../../shared/container-image-reference'
import {
  deliveryValuesRoot,
  emptyDeliveryRuntimeConfig,
  maxDeliveryArtifactEntries,
  maxDeliveryEnvironmentVariables,
  maxDeliveryOtherScriptLength,
  normalizeDeliveryRuntimeConfig,
  normalizeDeliveryOther,
  normalizeOfflinePackageUrl,
  type DeliveryRuntimeConfig,
} from '../../shared/delivery-artifact'
import './project-package-workbench.css'

type PackageWorkbenchProps = {
  onLoadTimeline: (options: ProjectPackageTimelineQuery) => Promise<ProjectPackageTimeline>
  onAddEventComment: (eventId: number, content: string) => Promise<boolean>
  onReassignEvent: (eventId: number, payload: { assigneeUserId: number; previousAssigneeUserId: number | null; reason: string }) => Promise<boolean>
  onCompleteEvent: (eventId: number, payload: {
    result: 'success' | 'partial' | 'rejected' | 'failed'
    failureReason?: string
    stepResults?: Record<string, { result: 'success' | 'failed' | 'skipped'; failureDetail?: string }>
  }) => Promise<boolean>
  onCreateOperation: (payload: {
    eventId: number
    groupId?: number | null
    kind: ProjectPackageOperationKind
    title?: string
    label?: string
    content?: string
    completed?: boolean
    status?: ProjectPackageOperationStatus
    relatedTodoIds?: number[]
    relatedTodoNotes?: Record<number, string>
  }) => Promise<boolean>
  onDeleteEvent: (eventId: number) => Promise<boolean>
  onDeleteEventComment: (eventId: number, commentId: number) => Promise<boolean>
  onDeleteGroup: (groupId: number) => Promise<boolean>
  onDeleteOperation: (operationId: number) => Promise<boolean>
  onExportTimeline: (eventId?: number) => Promise<{ fileName: string; markdown: string }>
  onLoadPackageMarketDetail: (payload: {
    arch: string
    channel: PackageMarketChannel
    ciBranch?: string
    ciVersion?: string
    deployType?: 'pro' | 'oss'
    expireMinutes?: number
    includeAll?: boolean
    packageId: string
    releaseVersion?: string
    context?: PackageMarketRequestContext
  }) => Promise<PackageMarketDetail>
  onLoadEventDeliveryArtifacts: (eventId: number, expireMinutes: 30 | 60 | 120) => Promise<ProjectPackageDeliveryArtifacts>
  onLoadPackageMarketCiBranches: (packageId: string, context?: PackageMarketRequestContext) => Promise<PackageMarketCiBranch[]>
  onLoadPackageMarketRules: (context?: PackageMarketRequestContext) => Promise<PackageMarketRulesResponse>
  onLoadPackageMarketVersions: (payload: {
    arch: string
    ciBranch?: string
    kind: 'ci' | 'release'
    deployType?: 'pro' | 'oss'
    includeAll?: boolean
    packageId: string
    context?: PackageMarketRequestContext
  }) => Promise<PackageMarketVersion[]>
  onSaveEvent: (
    eventId: number | null,
    payload: ProjectPackageEventSavePayload,
  ) => Promise<ProjectPackageEvent | null>
  onUpdateOperation: (
    operationId: number,
    payload: Partial<{
      title: string
      label: string
      content: string
      completed: boolean
      status: ProjectPackageOperationStatus
      relatedTodoIds: number[]
      relatedTodoNotes: Record<number, string>
    }>,
    confirmed?: boolean,
  ) => Promise<boolean>
  onUpdateEventComment: (eventId: number, commentId: number, content: string) => Promise<boolean>
  onUpdateTodo: (
    todoId: number,
    payload: Partial<Pick<Todo, 'done'>>,
  ) => Promise<boolean>
  currentUserId?: number
  memberships: ProjectMembership[]
  project: Project
  todos: Todo[]
  timeline: ProjectPackageTimeline | null
}

const MarkdownWysiwygEditor = lazy(() =>
  import('@/components/markdown-wysiwyg-editor').then((module) => ({
    default: module.MarkdownWysiwygEditor,
  })),
)

class MarkdownEditorLoadBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="markdown-wysiwyg-loading is-error" role="alert">
          <strong>编辑器加载失败</strong>
          <Button type="button" variant="outline" onClick={() => this.setState({ failed: false })}>
            重试编辑器
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}

export type ProjectPackageWorkbenchHandle = {
  exportTimeline: () => void
  selectEvent: (eventId: number) => void
}

type PendingOperationTarget =
  | {
      defaultTitle?: string
      eventId: number
      groupId?: number | null
      operation?: ProjectPackageOperation | null
    }
  | null

type TimelineExportScope = 'current' | 'all'

type EventDocumentDraftValue = {
  content: string
  relatedTodoIds: number[]
  title: string
}

type PackageMarketDetailContext = {
  arch: 'amd64' | 'arm64'
  channel: PackageMarketChannel
  ciBranch: string
  ciVersion: string
  packageId: string
  releaseVersion: string
}

type DraftContainerImage = { image: string; runtimeConfig: DeliveryRuntimeConfig }
type DraftOfflinePackage = { runtimeConfig: DeliveryRuntimeConfig; url: string }

function newDeliveryId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

function DeliveryRuntimeConfigEditor({
  config,
  label,
  onChange,
}: {
  config: DeliveryRuntimeConfig
  label: string
  onChange: (config: DeliveryRuntimeConfig) => void
}) {
  const validation = normalizeDeliveryRuntimeConfig(config)
  return (
    <details className="delivery-runtime-config-editor">
      <summary>
        <CaretRight aria-hidden="true" size={14} />
        <span>运行配置</span>
        <small>{config.environmentVariables.length > 0 || config.valuesPath || config.valuesPatch ? '已配置' : '可选'}</small>
      </summary>
      <div className="delivery-runtime-config-content">
        <div className="delivery-runtime-config-heading">
          <div><strong>环境变量</strong><span>仅应用于当前交付项</span></div>
          <Button
            disabled={config.environmentVariables.length >= maxDeliveryEnvironmentVariables}
            size="sm"
            type="button"
            variant="outline"
            onClick={() => onChange({ ...config, environmentVariables: [...config.environmentVariables, { name: '', value: '' }] })}
          >
            <Plus size={14} /> 添加变量
          </Button>
        </div>
        {config.environmentVariables.map((variable, index) => (
          <div className="delivery-environment-variable-row" key={`${label}-env-${index}`}>
            <Input
              aria-label={`${label}环境变量名称 ${index + 1}`}
              autoCapitalize="none"
              autoComplete="off"
              placeholder="变量名，例如 REGION"
              spellCheck={false}
              value={variable.name}
              onChange={(event) => onChange({
                ...config,
                environmentVariables: config.environmentVariables.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item),
              })}
            />
            <Input
              aria-label={`${label}环境变量值 ${index + 1}`}
              autoComplete="off"
              placeholder="变量值"
              value={variable.value}
              onChange={(event) => onChange({
                ...config,
                environmentVariables: config.environmentVariables.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item),
              })}
            />
            <Button
              aria-label={`删除${label}环境变量 ${index + 1}`}
              size="icon"
              type="button"
              variant="ghost"
              onClick={() => onChange({ ...config, environmentVariables: config.environmentVariables.filter((_, itemIndex) => itemIndex !== index) })}
            ><Trash size={15} /></Button>
          </div>
        ))}
        <div className="delivery-values-fields">
          <Label>Values 文件绝对路径
            <Input
              aria-label={`${label} Values 文件绝对路径`}
              autoCapitalize="none"
              autoComplete="off"
              placeholder={`${deliveryValuesRoot}/应用/values.yaml`}
              spellCheck={false}
              value={config.valuesPath}
              onChange={(event) => onChange({ ...config, valuesPath: event.target.value })}
            />
          </Label>
          <Label>Values 修改内容
            <Textarea
              aria-label={`${label} Values YAML 增量内容`}
              placeholder={'replicaCount: 3\nimage:\n  tag: v2.1.0'}
              rows={6}
              spellCheck={false}
              value={config.valuesPatch}
              onChange={(event) => onChange({ ...config, valuesPatch: event.target.value })}
            />
          </Label>
          <p>执行当前交付项前深度合并 YAML，执行结束后自动恢复原文件。</p>
        </div>
        {!validation.valid ? <p className="delivery-artifact-error" role="alert">{validation.error}</p> : null}
      </div>
    </details>
  )
}

type PackageMarketDependencyState = {
  context: PackageMarketDetailContext | null
  detail: PackageMarketDetail | null
  error: string
  loading: boolean
  rule: PackageMarketRule
  selectedVersion: string
  versions: PackageMarketVersion[]
}

type PackageMarketBrowserProps = {
  organizationId: number
  onLoadPackageMarketCiBranches: PackageWorkbenchProps['onLoadPackageMarketCiBranches']
  onLoadPackageMarketDetail: PackageWorkbenchProps['onLoadPackageMarketDetail']
  onLoadPackageMarketRules: PackageWorkbenchProps['onLoadPackageMarketRules']
  onLoadPackageMarketVersions: PackageWorkbenchProps['onLoadPackageMarketVersions']
}

function eventTypeLabel(type: ProjectPackageEventType) {
  return type === 'init' ? '初始化安装' : '升级'
}

function eventStatusLabel(status: ProjectPackageEventStatus) {
  if (status === 'delivered') return '已交付'
  if (status === 'partially_delivered') return '部分交付'
  if (status === 'failed') return '交付失败'
  if (status === 'rejected') return '拒绝交付'
  if (status === 'delivering') return '交付中'
  return '草稿'
}

function eventDisplayStatus(event: ProjectPackageEvent): ProjectPackageEventStatus {
  if (!event.publishedAt) return 'draft'
  return event.status
}

function getShanghaiDateTimeLocalStamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).formatToParts(date)
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${pick('year')}-${pick('month')}-${pick('day')}T${pick('hour')}:${pick('minute')}`
}

function getShanghaiDateStamp(date = new Date()) {
  return getShanghaiDateTimeLocalStamp(date).slice(0, 10)
}

function normalizeDateTimeLocalStamp(value: string | undefined, fallback = '') {
  const match = String(value ?? '').trim().match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[T ](\d{1,2}):(\d{2})(?::\d{2})?$/,
  )
  if (!match) return fallback
  const [, year, month, day, hour, minute] = match
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}`
}

function dateTimeLocalToUtcTimestamp(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!match) return Number.NaN
  const [, year, month, day, hour, minute] = match
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))
  const date = new Date(timestamp)
  return date.getUTCFullYear() === Number(year) &&
      date.getUTCMonth() === Number(month) - 1 &&
      date.getUTCDate() === Number(day) &&
      date.getUTCHours() === Number(hour) &&
      date.getUTCMinutes() === Number(minute)
    ? timestamp
    : Number.NaN
}

function dateTimeLocalDateStamp(value: string) {
  return normalizeDateTimeLocalStamp(value).slice(0, 10)
}

function getEventDeliveryStartAt(event: ProjectPackageEvent) {
  return normalizeDateTimeLocalStamp(event.deliveryStartAt, `${getEventDeliveryDate(event)}T00:00`)
}

function getEventDeliveryEndAt(event: ProjectPackageEvent) {
  return normalizeDateTimeLocalStamp(event.deliveryEndAt, `${getEventDeliveryDate(event)}T23:59`)
}

function formatEventDeliveryDate(event: ProjectPackageEvent) {
  return getEventDeliveryDate(event)
}

function formatDeliveryDelay(event: ProjectPackageEvent) {
  if (event.deliveryDelayDays == null) return '--'
  if (event.deliveryDelayDays > 0) return `+${event.deliveryDelayDays} 天`
  return `${event.deliveryDelayDays} 天`
}

function formatDateTimeLocalWindow(startAt: string, endAt: string) {
  return `${startAt.replace('T', ' ')} ~ ${endAt.replace('T', ' ')}`
}

function getExpireMinutesUntil(value: string) {
  const remaining = Math.ceil(
    (dateTimeLocalToUtcTimestamp(value) -
      dateTimeLocalToUtcTimestamp(getShanghaiDateTimeLocalStamp())) /
      60000,
  )
  return Number.isFinite(remaining)
    ? Math.min(packageMarketExpireMaxMinutes, Math.max(1, remaining))
    : 1
}

function formatExpireDuration(minutes: number) {
  const days = Math.floor(minutes / (24 * 60))
  const hours = Math.floor((minutes % (24 * 60)) / 60)
  const parts = []
  if (days > 0) parts.push(`${days} 天`)
  if (hours > 0) parts.push(`${hours} 小时`)
  if (parts.length === 0) parts.push('不足 1 小时')
  return parts.join(' ')
}

function getEventDeliveryDate(event: ProjectPackageEvent) {
  return event.deliveryDate || event.createdAt.slice(0, 10)
}

function channelLabel(channel: PackageMarketChannel) {
  return channel === 'ci' ? '测试包' : '正式包'
}

const packageMarketExpireOptions = [
  { label: '4 小时', value: 4 * 60 },
  { label: '8 小时', value: 8 * 60 },
  { label: '24 小时', value: 24 * 60 },
  { label: '3 天', value: 3 * 24 * 60 },
  { label: '7 天', value: 7 * 24 * 60 },
]

const packageMarketExpireMaxMinutes = 365 * 24 * 60

function formatBytes(bytes?: number) {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function itemChannelLabel(item: Pick<ProjectPackageItem, 'channel' | 'channelLabel'>) {
  if (item.channelLabel) return item.channelLabel
  return item.channel === 'ci' ? '测试包' : '正式包'
}

function packageItemFileName(item: Pick<ProjectPackageItem, 'objectKey' | 'packageName'>) {
  return item.objectKey.split('/').filter(Boolean).at(-1) || item.packageName
}

function operationHeading(operation: ProjectPackageOperation) {
  return getProjectPackageOperationTitle(
    operation,
    operation.kind === 'document' ? '未命名文档' : '操作事件',
  )
}

function todoCreatedDateLabel(todo: Todo) {
  return todo.createdAt.slice(0, 10)
}

function todoDialogMeta(todo: Todo, done: boolean) {
  return [
    done ? '已完成' : '未完成',
    `创建日期 ${todoCreatedDateLabel(todo)}`,
    `截止 ${todo.dueDate}`,
    priorityLabel(todo.priority),
    todo.assigneeName ? `@${todo.assigneeName}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

function todoSearchMeta(todo: Todo) {
  const watcherNames = Array.isArray(todo.watcherNames) && todo.watcherNames.length > 0
    ? todo.watcherNames
    : todo.watcherName
      ? [todo.watcherName]
      : []
  return [
    todo.title,
    todo.moduleName ?? '',
    todo.assigneeName ?? '',
    watcherNames.join(' '),
    todo.creatorName ?? '',
    todo.priority,
    todo.createdAt,
    todoCreatedDateLabel(todo),
    `创建日期 ${todoCreatedDateLabel(todo)}`,
    todo.done ? '已完成 完成 done' : '未完成 未做 open pending',
  ]
    .join(' ')
    .toLowerCase()
}

function packageMarketSearchMeta(value: string) {
  return value.trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ')
}

function getPackageMarketBaseRules(): PackageMarketRule[] {
  return [
    {
      id: 'base-pro',
      name: 'sealos-pro',
      category: 'apps',
      mode: 'release',
      roots: [],
      fileNameFormats: [],
      ciFileNameFormats: [],
    },
    {
      id: 'base-oss',
      name: 'sealos-oss',
      category: 'apps',
      mode: 'release',
      roots: [],
      fileNameFormats: [],
      ciFileNameFormats: [],
    },
  ]
}

type PackageMarketRuleGroup = {
  id: string
  label: string
  rules: PackageMarketRule[]
}

function packageMarketRuleGroupLabel(rule: PackageMarketRule) {
  if (rule.pageKind?.labelZh) return rule.pageKind.labelZh
  if (rule.category === 'apps') return '应用'
  if (rule.category === 'middleware') return '中间件'
  return rule.category
}

function groupPackageMarketRules(rules: readonly PackageMarketRule[]): PackageMarketRuleGroup[] {
  const groups = new Map<string, PackageMarketRuleGroup>()
  for (const rule of rules) {
    const isBase = rule.id === 'base-pro' || rule.id === 'base-oss'
    if (rule.category === 'dependency') continue
    if (!isBase && ['sealos-pro', 'sealos-oss'].includes(rule.id)) continue
    const id = isBase ? 'base' : rule.pageKind?.code ?? rule.category
    const existing = groups.get(id)
    if (existing) {
      existing.rules.push(rule)
      continue
    }
    groups.set(id, {
      id,
      label: isBase ? '基础包' : packageMarketRuleGroupLabel(rule),
      rules: [rule],
    })
  }
  return [...groups.values()]
}

function PackageMarketRuleList({ children }: { children: ReactNode }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scrollbar, setScrollbar] = useState({ height: 0, scrollable: false, top: 0, value: 0 })

  function syncScrollbar() {
    const viewport = viewportRef.current
    if (!viewport) return
    const trackHeight = Math.max(0, viewport.clientHeight - 8)
    const maxScroll = viewport.scrollHeight - viewport.clientHeight
    if (maxScroll <= 0 || trackHeight <= 0) {
      setScrollbar({ height: 0, scrollable: false, top: 0, value: 0 })
      return
    }
    const height = Math.max(32, Math.round(trackHeight * viewport.clientHeight / viewport.scrollHeight))
    const travel = Math.max(0, trackHeight - height)
    const top = 4 + travel * viewport.scrollTop / maxScroll
    setScrollbar({
      height,
      scrollable: true,
      top,
      value: Math.round(viewport.scrollTop * 100 / maxScroll),
    })
  }

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(syncScrollbar)
    observer.observe(viewport)
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild)
    syncScrollbar()
    return () => observer.disconnect()
  }, [children])

  function startScrollbarDrag(event: PointerEvent<HTMLButtonElement>) {
    const viewport = viewportRef.current
    if (!viewport) return
    const activeViewport = viewport
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const startY = event.clientY
    const startScrollTop = activeViewport.scrollTop
    const trackTravel = activeViewport.clientHeight - 8 - scrollbar.height
    const maxScroll = activeViewport.scrollHeight - activeViewport.clientHeight
    if (trackTravel <= 0 || maxScroll <= 0) return

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      activeViewport.scrollTop = startScrollTop + (moveEvent.clientY - startY) * maxScroll / trackTravel
    }

    function stopPointerDrag() {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopPointerDrag)
      window.removeEventListener('pointercancel', stopPointerDrag)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopPointerDrag)
    window.addEventListener('pointercancel', stopPointerDrag)
  }

  function handleScrollbarKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const viewport = viewportRef.current
    if (!viewport) return
    const increments: Partial<Record<string, number>> = {
      ArrowDown: 40,
      ArrowUp: -40,
      PageDown: viewport.clientHeight * 0.8,
      PageUp: viewport.clientHeight * -0.8,
    }
    const increment = increments[event.key]
    if (increment == null) return
    event.preventDefault()
    viewport.scrollBy({ behavior: 'smooth', top: increment })
  }

  return (
    <div className="package-market-rule-list">
      <div className="package-market-rule-scroll" onScroll={syncScrollbar} ref={viewportRef}>
        <div className="package-market-rule-scroll-content">{children}</div>
      </div>
      {scrollbar.scrollable ? (
        <button
          aria-label="滚动安装包列表"
          aria-orientation="vertical"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={scrollbar.value}
          className="package-market-scrollbar-thumb"
          onKeyDown={handleScrollbarKeyDown}
          onPointerDown={startScrollbarDrag}
          role="scrollbar"
          style={{ height: scrollbar.height, transform: `translateY(${scrollbar.top}px)` }}
          type="button"
        />
      ) : null}
    </div>
  )
}

export function PackageMarketBrowser({
  organizationId,
  onLoadPackageMarketCiBranches,
  onLoadPackageMarketDetail,
  onLoadPackageMarketRules,
  onLoadPackageMarketVersions,
}: PackageMarketBrowserProps) {
  const [marketContextLoading, setMarketContextLoading] = useState(true)
  const [marketPolicy, setMarketPolicy] = useState<PackageMarketRulesResponse['policy'] | null>(null)
  const [marketVisibleRuleIds, setMarketVisibleRuleIds] = useState<PackageMarketRulesResponse['visibleRuleIds']>({
    release: [],
    ci: [],
  })
  const [copiedValue, setCopiedValue] = useState('')
  const [marketRules, setMarketRules] = useState<PackageMarketRule[]>([])
  const [marketExpireMinutes, setMarketExpireMinutes] = useState(packageMarketExpireOptions[0].value)
  const [marketSelectedPackage, setMarketSelectedPackage] = useState('base-pro')
  const [marketChannel, setMarketChannel] = useState<PackageMarketChannel>('release')
  const [marketArch, setMarketArch] = useState<'amd64' | 'arm64'>('amd64')
  const [marketSearch, setMarketSearch] = useState('')
  const [marketReleaseVersion, setMarketReleaseVersion] = useState('')
  const [marketCiBranch, setMarketCiBranch] = useState('')
  const [marketCiVersion, setMarketCiVersion] = useState('')
  const [marketIncludeAll, setMarketIncludeAll] = useState(false)
  const [marketCiBranches, setMarketCiBranches] = useState<PackageMarketCiBranch[]>([])
  const [marketReleaseVersions, setMarketReleaseVersions] = useState<PackageMarketVersion[]>([])
  const [marketCiVersions, setMarketCiVersions] = useState<PackageMarketVersion[]>([])
  const [marketDetail, setMarketDetail] = useState<PackageMarketDetail | null>(null)
  const [marketDetailContext, setMarketDetailContext] = useState<PackageMarketDetailContext | null>(null)
  const [marketDependencyDetails, setMarketDependencyDetails] = useState<PackageMarketDependencyState[]>([])
  const [marketLoading, setMarketLoading] = useState(false)
  const [marketError, setMarketError] = useState('')
  const [marketExpandedGroups, setMarketExpandedGroups] = useState<Record<string, boolean>>({
    base: true,
    apps: true,
    middleware: true,
  })
  const marketDetailRequestIdRef = useRef(0)
  const currentOrganizationIdRef = useRef(organizationId)
  const loadMarketRulesRef = useRef(onLoadPackageMarketRules)
  useEffect(() => {
    currentOrganizationIdRef.current = organizationId
  }, [organizationId])
  useEffect(() => {
    loadMarketRulesRef.current = onLoadPackageMarketRules
  }, [onLoadPackageMarketRules])
  const refreshMarketDetailRef = useRef<(
    nextOverrides?: Partial<{
      arch: 'amd64' | 'arm64'
      channel: PackageMarketChannel
      ciBranch: string
      ciVersion: string
      expireMinutes: number
      includeAll: boolean
      marketRules: PackageMarketRule[]
      visibleRuleIds: PackageMarketRulesResponse['visibleRuleIds']
      packageId: string
      releaseVersion: string
      dependencyVersions: Record<string, string>
    }>,
  ) => Promise<void>>(async () => undefined)

  const filteredRules = useMemo(() => {
    const query = packageMarketSearchMeta(marketSearch)
    const visibleIds = new Set(marketVisibleRuleIds[marketChannel] ?? [])
    const baseRules = [
      ...getPackageMarketBaseRules().filter((rule) => visibleIds.has(rule.id)),
      ...marketRules.filter((rule) => {
        if (rule.category === 'dependency') {
          const dependencyChannel = packageMarketDependencyChannel(rule)
          return dependencyChannel === marketChannel && visibleIds.has(canonicalPackageMarketRuleId(rule.parent))
        }
        const id = canonicalPackageMarketRuleId(rule.id)
        return visibleIds.has(id)
      }),
    ]
    return baseRules.filter((rule) => {
      if (!query) return true
      return packageMarketSearchMeta(`${rule.id} ${rule.name}`).includes(query)
    })
  }, [marketRules, marketSearch, marketVisibleRuleIds, marketChannel])

  const groupedMarketRules = useMemo(() => groupPackageMarketRules(filteredRules), [filteredRules])

  const selectedMarketDependencyRules = useMemo(() => {
    if (!marketPolicy) return []
    const selectedPackageId = canonicalPackageMarketRuleId(marketSelectedPackage)
    return marketRules.filter((rule) => {
      const dependencyChannel = packageMarketDependencyChannel(rule)
      return rule.category === 'dependency' &&
        dependencyChannel != null &&
        canonicalPackageMarketRuleId(rule.parent) === selectedPackageId &&
        isPackageMarketRuleVisible(rule, marketPolicy, dependencyChannel)
    })
  }, [marketPolicy, marketRules, marketSelectedPackage])

  async function copyToClipboard(value: string, feedbackKey: string) {
    if (!value) return
    await navigator.clipboard.writeText(value)
    setCopiedValue(feedbackKey)
    window.setTimeout(() => {
      setCopiedValue((current) => (current === feedbackKey ? '' : current))
    }, 1200)
  }

  function copiedLabel(feedbackKey: string, fallback: string) {
    return copiedValue === feedbackKey ? '已复制' : fallback
  }

  async function refreshMarketDependencyDetails(params: {
    arch: 'amd64' | 'arm64'
    expireMinutes: number
    includeAll: boolean
    requestId: number
    requestContext?: PackageMarketRequestContext
    rules: PackageMarketRule[]
    selectedVersions?: Record<string, string>
  }) {
    const {
      arch,
      expireMinutes,
      includeAll,
      requestContext,
      requestId,
      rules,
      selectedVersions = {},
    } = params
    if (rules.length === 0) {
      setMarketDependencyDetails([])
      return
    }

    setMarketDependencyDetails(rules.map((rule) => ({
      context: null,
      detail: null,
      error: '',
      loading: true,
      rule,
      selectedVersion: selectedVersions[rule.id] ?? '',
      versions: [],
    })))

    const nextDetails = await Promise.all(rules.map(async (rule): Promise<PackageMarketDependencyState> => {
      const dependencyChannel: PackageMarketChannel = rule.dependencyRoots?.length ? 'ci' : 'release'
      try {
        const versions = await onLoadPackageMarketVersions({
          arch,
          kind: dependencyChannel,
          includeAll,
          packageId: rule.id,
          context: requestContext,
        })
        const selectedVersion =
          selectedVersions[rule.id] ||
          (dependencyChannel === 'ci' ? versions[0]?.hash : versions[0]?.version) ||
          ''
        const detail = await onLoadPackageMarketDetail({
          packageId: rule.id,
          channel: dependencyChannel,
          arch,
          expireMinutes,
          includeAll,
          ciVersion: dependencyChannel === 'ci' ? selectedVersion : '',
          releaseVersion: dependencyChannel === 'release' ? selectedVersion : '',
          context: requestContext,
        })
        return {
          context: {
            arch,
            channel: dependencyChannel,
            ciBranch: '',
            ciVersion: dependencyChannel === 'ci' ? selectedVersion : '',
            packageId: rule.id,
            releaseVersion: dependencyChannel === 'release' ? selectedVersion : '',
          },
          detail,
          error: '',
          loading: false,
          rule,
          selectedVersion,
          versions,
        }
      } catch (error) {
        return {
          context: null,
          detail: null,
          error: error instanceof Error ? error.message : '附属包详情加载失败',
          loading: false,
          rule,
          selectedVersion: selectedVersions[rule.id] ?? '',
          versions: [],
        }
      }
    }))

    if (requestId !== marketDetailRequestIdRef.current) return
    setMarketDependencyDetails(nextDetails)
  }

  async function refreshMarketDetail(nextOverrides?: Partial<{
    arch: 'amd64' | 'arm64'
    channel: PackageMarketChannel
    ciBranch: string
    ciVersion: string
    expireMinutes: number
    includeAll: boolean
    marketRules: PackageMarketRule[]
    visibleRuleIds?: PackageMarketRulesResponse['visibleRuleIds']
    packageId: string
    releaseVersion: string
    dependencyVersions: Record<string, string>
  }>) {
    const packageId = nextOverrides?.packageId ?? marketSelectedPackage
    const channel = nextOverrides?.channel ?? marketChannel
    const arch = nextOverrides?.arch ?? marketArch
    const releaseVersion = nextOverrides?.releaseVersion ?? marketReleaseVersion
    const requestedCiBranch = nextOverrides?.ciBranch ?? marketCiBranch
    const ciVersion = nextOverrides?.ciVersion ?? marketCiVersion
    const expireMinutes = nextOverrides?.expireMinutes ?? marketExpireMinutes
    const includeAll = nextOverrides?.includeAll ?? marketIncludeAll
    const rules = nextOverrides?.marketRules ?? marketRules
    const visibleRuleIds = nextOverrides?.visibleRuleIds ?? marketVisibleRuleIds
    const requestContext: PackageMarketRequestContext = { organizationId }
    const requestId = ++marketDetailRequestIdRef.current
    setMarketLoading(true)
    setMarketError('')
    setMarketDetail(null)
    setMarketDetailContext(null)
    setMarketDependencyDetails([])
    try {
      const ciBranches = channel === 'ci'
        ? await onLoadPackageMarketCiBranches(packageId, requestContext)
        : []
      if (requestId !== marketDetailRequestIdRef.current) return
      const ciBranch = requestedCiBranch && ciBranches.some((item) => item.name === requestedCiBranch)
        ? requestedCiBranch
        : ciBranches[0]?.name ?? ''
      const context: PackageMarketDetailContext = {
        arch,
        channel,
        ciBranch,
        ciVersion,
        packageId,
        releaseVersion,
      }
      const [versions, detail] = await Promise.all([
        channel === 'ci'
          ? onLoadPackageMarketVersions({
              arch,
              ciBranch,
              kind: 'ci',
              includeAll,
              packageId,
              context: requestContext,
            })
          : onLoadPackageMarketVersions({
              arch,
              kind: 'release',
              deployType: packageId === 'base-oss' ? 'oss' : packageId === 'base-pro' ? 'pro' : undefined,
              includeAll,
              packageId,
              context: requestContext,
            }),
        onLoadPackageMarketDetail({
          packageId,
          channel,
          arch,
          ciBranch,
          deployType: packageId === 'base-oss' ? 'oss' : packageId === 'base-pro' ? 'pro' : undefined,
          expireMinutes,
          includeAll,
          releaseVersion,
          ciVersion,
          context: requestContext,
        }),
      ])
      if (requestId !== marketDetailRequestIdRef.current) return
      if (channel === 'ci') {
        setMarketCiBranch(ciBranch)
        setMarketCiBranches(ciBranches)
        setMarketCiVersions(versions)
      } else {
        setMarketCiBranch('')
        setMarketCiBranches([])
        setMarketReleaseVersions(versions)
      }
      setMarketDetail(detail)
      setMarketDetailContext(context)
      const dependencyRules = rules.filter((rule) => {
        const dependencyChannel = packageMarketDependencyChannel(rule)
        return rule.category === 'dependency' &&
          dependencyChannel != null &&
          canonicalPackageMarketRuleId(rule.parent) === canonicalPackageMarketRuleId(packageId) &&
          visibleRuleIds[dependencyChannel].includes(canonicalPackageMarketRuleId(rule.parent))
      })
      void refreshMarketDependencyDetails({
        arch,
        expireMinutes,
        includeAll,
        requestId,
        requestContext,
        rules: dependencyRules,
        selectedVersions: nextOverrides?.dependencyVersions,
      })
    } catch (error) {
      if (requestId !== marketDetailRequestIdRef.current) return
      setMarketError(error instanceof Error ? error.message : '包详情加载失败')
    } finally {
      if (requestId === marketDetailRequestIdRef.current) {
        setMarketLoading(false)
      }
    }
  }

  useEffect(() => {
    loadMarketRulesRef.current = onLoadPackageMarketRules
    refreshMarketDetailRef.current = refreshMarketDetail
  })

  function renderMarketLinkCard(
    detail: PackageMarketDetail,
    context: PackageMarketDetailContext | null,
    link: PackageMarketDetail['links'][number],
  ) {
    const fileName = link.objectKey.split('/').filter(Boolean).at(-1) || link.name
    const canDownload = Boolean(link.downloadUrl)
    return (
      <article className="package-market-link-card" key={`${context?.packageId ?? detail.title}-${link.objectKey}-${link.version}`}>
        <div className="package-market-link-head">
          <div className="package-market-link-meta">
            <strong>{fileName}</strong>
            {link.size ? <small>{formatBytes(link.size)}</small> : null}
          </div>
          <div className="package-market-link-actions">
            {canDownload ? <Button
              className="ghost-button"
              variant="outline"
              type="button"
              onClick={() =>
                void copyToClipboard(
                  link.downloadUrl,
                  `browser-copy-download-url-${link.objectKey}`,
                )
              }
            >
              <Copy size={15} /> {copiedLabel(`browser-copy-download-url-${link.objectKey}`, '链接')}
            </Button> : null}
            {canDownload ? <Button
              className="ghost-button"
              variant="outline"
              type="button"
              onClick={() =>
                void copyToClipboard(
                  createWgetDownloadCommand(link.downloadUrl, fileName),
                  `browser-copy-download-command-${link.objectKey}`,
                )
              }
            >
              <TerminalWindow size={15} /> {copiedLabel(`browser-copy-download-command-${link.objectKey}`, '命令')}
            </Button> : null}
            <Button
              className="ghost-button"
              variant="outline"
              type="button"
              onClick={() =>
                void copyToClipboard(link.objectKey, `browser-copy-object-key-${link.objectKey}`)
              }
            >
              <Copy size={15} /> {copiedLabel(`browser-copy-object-key-${link.objectKey}`, 'Key')}
            </Button>
          </div>
        </div>
        <code>{link.objectKey}</code>
        <div className="package-market-link-footer">
          <a href={link.downloadUrl} target="_blank" rel="noreferrer">
            查看临时链接
          </a>
        </div>
      </article>
    )
  }

  async function loadMarketContext(contextOrganizationId: number, requestId: number) {
    setMarketContextLoading(true)
    setMarketPolicy(null)
    setMarketRules([])
    setMarketVisibleRuleIds({ release: [], ci: [] })
    setMarketDetail(null)
    setMarketDetailContext(null)
    setMarketDependencyDetails([])
    setMarketReleaseVersions([])
    setMarketCiBranches([])
    setMarketCiVersions([])
    const rulesPayload = await loadMarketRulesRef.current({ organizationId: contextOrganizationId })
    if (
      contextOrganizationId !== currentOrganizationIdRef.current ||
      requestId !== marketDetailRequestIdRef.current
    ) return
    setMarketContextLoading(false)
    setMarketPolicy(rulesPayload.policy)
    setMarketVisibleRuleIds(rulesPayload.visibleRuleIds)
    setMarketRules(rulesPayload.rules)
    const releaseIds = rulesPayload.visibleRuleIds.release
    const ciIds = rulesPayload.visibleRuleIds.ci
    const activeChannel: PackageMarketChannel = rulesPayload.policy.channels.release.enabled && releaseIds.length > 0
      ? 'release'
      : rulesPayload.policy.channels.ci.enabled && ciIds.length > 0 ? 'ci' : 'release'
    const visibleIds = rulesPayload.visibleRuleIds[activeChannel]
    const nextPackage = visibleIds[0] ?? ''
    setMarketChannel(activeChannel)
    setMarketSelectedPackage(nextPackage)
    setMarketReleaseVersion('')
    setMarketCiBranch('')
    setMarketCiVersion('')
    const expireMinutes = packageMarketExpireOptions.some(
      (option) => option.value === rulesPayload.expireMinutes,
    )
      ? rulesPayload.expireMinutes
      : packageMarketExpireOptions[0].value
    setMarketExpireMinutes(expireMinutes)
    if (!nextPackage || !rulesPayload.policy.enabled) {
      setMarketDetail(null)
      setMarketDetailContext(null)
      setMarketLoading(false)
      return
    }
    await refreshMarketDetailRef.current({
      channel: activeChannel,
      expireMinutes,
      marketRules: rulesPayload.rules,
      visibleRuleIds: rulesPayload.visibleRuleIds,
      packageId: nextPackage,
      releaseVersion: '',
      ciBranch: '',
      ciVersion: '',
    })
  }

  useEffect(() => {
    const requestId = ++marketDetailRequestIdRef.current
    setMarketDetail(null)
    setMarketDetailContext(null)
    setMarketLoading(true)
    setMarketError('')
    setMarketContextLoading(true)
    let cancelled = false
    void loadMarketContext(organizationId, requestId)
      .catch((error) => {
        if (
          cancelled ||
          organizationId !== currentOrganizationIdRef.current ||
          requestId !== marketDetailRequestIdRef.current
        ) return
        setMarketContextLoading(false)
        setMarketError(error instanceof Error ? error.message : '包市场读取失败')
        setMarketLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [organizationId])

  return (
    <section className="package-market-workspace" aria-label="安装包市场">
      <div className="package-market-grid">
          <div className="package-market-sidebar">
            <Label>
              搜索
              <Input
                value={marketSearch}
                onChange={(event) => setMarketSearch(event.target.value)}
                placeholder="sealos / db / app"
              />
            </Label>
            <Button
              className="package-market-show-all"
              variant={marketIncludeAll ? 'default' : 'outline'}
              type="button"
              aria-pressed={marketIncludeAll}
              disabled={marketPolicy == null || marketContextLoading}
              title={marketIncludeAll ? '关闭全部包展示' : '展示全部包'}
              onClick={() => {
                const nextIncludeAll = !marketIncludeAll
                setMarketIncludeAll(nextIncludeAll)
                void refreshMarketDetail({ includeAll: nextIncludeAll })
              }}
            >
              {marketIncludeAll ? <EyeSlash size={15} /> : <Eye size={15} />}
              {marketIncludeAll ? '仅展示规则包' : '展示全部包'}
            </Button>
            <PackageMarketRuleList>
              {groupedMarketRules.map((group) => (
                <section
                  className={marketExpandedGroups[group.id] !== false ? 'package-market-group' : 'package-market-group collapsed'}
                  key={group.id}
                >
                  <button
                    className="package-market-group-toggle"
                    type="button"
                    onClick={() =>
                      setMarketExpandedGroups((current) => ({
                        ...current,
                        [group.id]: current[group.id] === false,
                      }))
                    }
                  >
                    <span>{group.label}</span>
                    {marketExpandedGroups[group.id] !== false ? (
                      <CaretDown size={14} weight="bold" />
                    ) : (
                      <CaretRight size={14} weight="bold" />
                    )}
                  </button>
                  {marketExpandedGroups[group.id] !== false ? (
                    <div className="package-market-group-list">
                      {group.rules.length === 0 ? (
                        <p className="package-market-group-empty">当前分组没有匹配到安装包。</p>
                      ) : (
                        group.rules.map((rule) => (
                          <button
                            key={rule.id}
                            type="button"
                            className={rule.id === marketSelectedPackage ? 'package-market-rule active' : 'package-market-rule'}
                            onClick={() => {
                              const nextChannel = rule.id === 'base-oss' ? 'release' : marketChannel
                              setMarketSelectedPackage(rule.id)
                              setMarketChannel(nextChannel)
                              setMarketReleaseVersion('')
                              setMarketCiBranch('')
                              setMarketCiVersion('')
                              void refreshMarketDetail({
                                packageId: rule.id,
                                channel: nextChannel,
                                releaseVersion: '',
                                ciBranch: '',
                                ciVersion: '',
                              })
                            }}
                          >
                            <strong>{rule.name}</strong>
                            <small>{rule.id}</small>
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                </section>
              ))}
            </PackageMarketRuleList>
          </div>
          <div className="package-market-main">
            <div className="package-market-controls">
              <Label>
                渠道
                <Select
                  value={marketChannel}
                  disabled={marketPolicy == null || marketContextLoading}
                  onValueChange={(value) => {
                    const next = value as PackageMarketChannel
                    if (!marketPolicy?.channels[next].enabled) return
                    const visibleIds = marketVisibleRuleIds[next] ?? []
                    if (visibleIds.length === 0) return
                    const currentPackageId = canonicalPackageMarketRuleId(marketSelectedPackage)
                    const nextPackage = visibleIds.includes(currentPackageId)
                      ? currentPackageId
                      : visibleIds[0] ?? ''
                    setMarketChannel(next)
                    setMarketSelectedPackage(nextPackage)
                    setMarketCiBranch('')
                    setMarketCiVersion('')
                    setMarketReleaseVersion('')
                    if (!nextPackage) {
                      setMarketDetail(null)
                      setMarketDetailContext(null)
                      return
                    }
                    void refreshMarketDetail({
                      channel: next,
                      ciBranch: '',
                      ciVersion: '',
                      packageId: nextPackage,
                      releaseVersion: '',
                    })
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {marketPolicy?.channels.release.enabled && marketVisibleRuleIds.release.length > 0 ? (
                      <SelectItem value="release">正式包</SelectItem>
                    ) : null}
                    {marketPolicy?.channels.ci.enabled && marketVisibleRuleIds.ci.length > 0 ? (
                      <SelectItem value="ci">测试包</SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              </Label>
              <Label>
                架构
                <Select
                  value={marketArch}
                  disabled={marketPolicy == null || marketContextLoading}
                  onValueChange={(value) => {
                    const next = value as 'amd64' | 'arm64'
                    setMarketArch(next)
                    setMarketCiBranch('')
                    setMarketCiVersion('')
                    setMarketReleaseVersion('')
                    void refreshMarketDetail({ arch: next, ciBranch: '', ciVersion: '', releaseVersion: '' })
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="amd64">amd64</SelectItem>
                    <SelectItem value="arm64">arm64</SelectItem>
                  </SelectContent>
                </Select>
              </Label>
              {marketChannel === 'release' && marketReleaseVersions.length > 0 ? (
                <Label className="package-market-version-control">
                  正式版本
                  <Select
                    value={marketReleaseVersion || marketReleaseVersions[0]?.version || ''}
                    onValueChange={(value) => {
                      setMarketReleaseVersion(value)
                      void refreshMarketDetail({ releaseVersion: value })
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择版本" />
                    </SelectTrigger>
                    <SelectContent>
                      {marketReleaseVersions.map((version) => (
                        <SelectItem key={version.version ?? version.label} value={version.version ?? version.label}>
                          {version.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Label>
              ) : null}
              {marketChannel === 'ci' && marketCiBranches.length > 0 ? (
                <Label className="package-market-version-control">
                  CI 分支
                  <Select
                    value={marketCiBranch || marketCiBranches[0]?.name || ''}
                    onValueChange={(value) => {
                      setMarketCiBranch(value)
                      setMarketCiVersion('')
                      void refreshMarketDetail({ ciBranch: value, ciVersion: '' })
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择分支" />
                    </SelectTrigger>
                    <SelectContent>
                      {marketCiBranches.map((branch) => (
                        <SelectItem key={branch.name} value={branch.name}>
                          {branch.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Label>
              ) : null}
              {marketChannel === 'ci' && marketCiVersions.length > 0 ? (
                <Label className="package-market-version-control">
                  测试版本
                  <Select
                    value={marketCiVersion || marketCiVersions[0]?.hash || ''}
                    onValueChange={(value) => {
                      setMarketCiVersion(value)
                      void refreshMarketDetail({ ciVersion: value })
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择版本" />
                    </SelectTrigger>
                    <SelectContent>
                      {marketCiVersions.map((version) => (
                        <SelectItem key={version.hash ?? version.label} value={version.hash ?? version.label}>
                          {version.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Label>
              ) : null}
            </div>
            <div className="package-market-detail-area">
              {marketError ? <p className="form-error">{marketError}</p> : null}
              {marketPolicy && !marketPolicy.enabled ? (
                <p className="empty-state">当前组织已关闭安装包市场。</p>
              ) : marketPolicy && !organizationPackageMarketPolicyHasVisibleChannel(marketPolicy, marketVisibleRuleIds) ? (
                <p className="empty-state">当前组织没有开放可用的安装包。</p>
              ) : marketLoading ? (
                <p className="empty-state">正在读取 OSS 包信息...</p>
              ) : marketDetail ? (
                <div className="package-market-link-list">
                  {marketDetail.links.length === 0 ? (
                    <p className="empty-state">当前参数下没有找到可用对象。</p>
                  ) : (
                    marketDetail.links.map((link) => renderMarketLinkCard(marketDetail, marketDetailContext, link))
                  )}
                  {selectedMarketDependencyRules.length > 0 ? (
                    marketDependencyDetails.map((dependency) => (
                      <section className="package-market-dependency" key={dependency.rule.id}>
                        <div className="package-market-dependency-head">
                          <div>
                            <strong>{dependency.rule.name}</strong>
                            <small>附属包 · {dependency.rule.id}</small>
                          </div>
                          {dependency.versions.length > 0 ? (
                            <Label className="package-market-dependency-version">
                              版本
                              <Select
                                value={dependency.selectedVersion}
                                onValueChange={(value) => {
                                  const selectedVersions = Object.fromEntries(
                                    marketDependencyDetails.map((item) => [item.rule.id, item.selectedVersion]),
                                  )
                                  selectedVersions[dependency.rule.id] = value
                                  void refreshMarketDependencyDetails({
                                    arch: marketArch,
                                    expireMinutes: marketExpireMinutes,
                                    includeAll: marketIncludeAll,
                                    requestId: marketDetailRequestIdRef.current,
                                    requestContext: { organizationId },
                                    rules: selectedMarketDependencyRules,
                                    selectedVersions,
                                  })
                                }}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="选择版本" />
                                </SelectTrigger>
                                <SelectContent>
                                  {dependency.versions.map((version) => (
                                    <SelectItem
                                      key={version.hash ?? version.version ?? version.label}
                                      value={version.hash ?? version.version ?? version.label}
                                    >
                                      {version.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </Label>
                          ) : null}
                        </div>
                        {dependency.error ? <p className="form-error">{dependency.error}</p> : null}
                        {dependency.loading ? (
                          <p className="empty-state">正在读取附属包...</p>
                        ) : dependency.detail ? (
                          dependency.detail.links.length === 0 ? (
                            <p className="empty-state">当前参数下没有找到可用附属包对象。</p>
                          ) : (
                            <div className="package-market-link-list">
                              {dependency.detail.links.map((link) =>
                                renderMarketLinkCard(dependency.detail as PackageMarketDetail, dependency.context, link),
                              )}
                            </div>
                          )
                        ) : (
                          <p className="empty-state">当前包没有可用附属包对象。</p>
                        )}
                      </section>
                    ))
                  ) : null}
                </div>
              ) : (
                <p className="empty-state">选择一个包后查看详情。</p>
              )}
            </div>
            <div className="package-market-expire-row">
              <Label>
                配置链接有效期
                <Select
                  value={String(marketExpireMinutes)}
                  onValueChange={(value) => {
                    const nextExpireMinutes = Number(value)
                    setMarketExpireMinutes(nextExpireMinutes)
                    void refreshMarketDetail({ expireMinutes: nextExpireMinutes })
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {packageMarketExpireOptions.map((option) => (
                      <SelectItem key={option.value} value={String(option.value)}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>
              <small>影响当前页面内“查看临时链接”和“复制下载链接”的有效期。</small>
            </div>
          </div>
      </div>
    </section>
  )
}

function priorityLabel(priority: Todo['priority']) {
  if (priority === 'high') return '高优先级'
  if (priority === 'low') return '低优先级'
  return '中优先级'
}

function sortByCreatedAt<T extends { createdAt: string }>(items: T[], direction: 'asc' | 'desc' = 'asc') {
  return [...items].sort((left, right) => {
    const delta = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
    return direction === 'asc' ? delta : -delta
  })
}

function downloadMarkdownFile(fileName: string, markdown: string) {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export const ProjectPackageWorkbench = forwardRef<ProjectPackageWorkbenchHandle, PackageWorkbenchProps>(function ProjectPackageWorkbench({
  onLoadTimeline,
  currentUserId,
  memberships,
  onAddEventComment,
  onCompleteEvent,
  onReassignEvent,
  onCreateOperation,
  onDeleteEvent,
  onDeleteEventComment,
  onExportTimeline,
  onLoadPackageMarketCiBranches,
  onLoadPackageMarketDetail,
  onLoadEventDeliveryArtifacts,
  onLoadPackageMarketRules,
  onLoadPackageMarketVersions,
  onSaveEvent,
  onUpdateEventComment,
  onUpdateOperation,
  onUpdateTodo,
  project,
  todos,
  timeline,
}, ref) {
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null)
  const [eventDetailOpen, setEventDetailOpen] = useState(false)
  const [eventDetailTab, setEventDetailTab] = useState<'overview' | 'delivery'>('overview')
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null)
  const [commentsDrawerOpen, setCommentsDrawerOpen] = useState(false)
  const [eventEditorOpen, setEventEditorOpen] = useState(false)
  const [eventEditorEventId, setEventEditorEventId] = useState<number | null>(null)
  const [eventEditorStep, setEventEditorStep] = useState<1 | 2 | 3>(1)
  const [eventEditorDirty, setEventEditorDirty] = useState(false)
  const [eventDocumentTitle, setEventDocumentTitle] = useState('变更记录')
  const [eventDocumentContent, setEventDocumentContent] = useState('')
  const [deliveryScripts, setDeliveryScripts] = useState<ProjectPackageDeliveryScript[]>([])
  const [deliverySteps, setDeliverySteps] = useState<ProjectPackageDeliveryStep[]>([])
  const [eventDocumentRelatedTodoIds, setEventDocumentRelatedTodoIds] = useState<number[]>([])
  const [packageDocumentValues, setPackageDocumentValues] = useState<Record<string, EventDocumentDraftValue>>({})
  const [activeDocumentScope, setActiveDocumentScope] = useState('event')
  const documentTabsId = useId()
  const [documentTodoPickerOpen, setDocumentTodoPickerOpen] = useState(false)
  const [documentTodoSearch, setDocumentTodoSearch] = useState('')
  const [documentTodoFilterDialogOpen, setDocumentTodoFilterDialogOpen] = useState(false)
  const [documentTodoFilterJoin, setDocumentTodoFilterJoin] = useState<TodoFilterJoin>('and')
  const [documentTodoFilterConditions, setDocumentTodoFilterConditions] = useState<TodoFilterCondition[]>([])
  const [, setEventEditorReady] = useState(false)
  const [eventAssigneeUserId, setEventAssigneeUserId] = useState('')
  const [reassignEventId, setReassignEventId] = useState<number | null>(null)
  const [nextAssignee, setNextAssignee] = useState('')
  const [reassignReason, setReassignReason] = useState('')
  const [eventDeliveryStartAt, setEventDeliveryStartAt] = useState(() => `${getShanghaiDateStamp()}T00:00`)
  const [eventDeliveryEndAt, setEventDeliveryEndAt] = useState(() => `${getShanghaiDateStamp()}T23:59`)
  const [eventTitle, setEventTitle] = useState('')
  const [eventType, setEventType] = useState<ProjectPackageEventType>('upgrade')
  const [eventFilterDialogOpen, setEventFilterDialogOpen] = useState(false)
  const [eventFilterJoin, setEventFilterJoin] = useState<PackageEventFilterJoin>('and')
  const [eventFilterConditions, setEventFilterConditions] = useState<PackageEventFilterCondition[]>([])
  const [showDelivered, setShowDelivered] = useState(false)
  const [eventSortDirection, setEventSortDirection] = useState<'asc' | 'desc'>('desc')
  const [eventPage, setEventPage] = useState(0)
  const [eventPageSize, setEventPageSize] = useState(10)
  const [eventSearch, setEventSearch] = useState('')
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [timelineError, setTimelineError] = useState('')
  const timelineRequestIdRef = useRef(0)
  const [eventDetailsError, setEventDetailsError] = useState('')
  const [eventDetailsRetry, setEventDetailsRetry] = useState(0)
  const eventDetailsRequestIdRef = useRef(0)
  const [deliveryResultDialogOpen, setDeliveryResultDialogOpen] = useState(false)
  const [deliveryResult, setDeliveryResult] = useState<'success' | 'partial' | 'rejected' | 'failed'>('success')
  const [deliveryFailureReason, setDeliveryFailureReason] = useState('')
  const [deliveryStepResults, setDeliveryStepResults] = useState<Record<string, { result: 'success' | 'failed' | 'skipped'; failureDetail?: string }>>({})
  const [deliveryResultError, setDeliveryResultError] = useState('')
  const [operationDialogOpen, setOperationDialogOpen] = useState(false)
  const [operationEditorReady, setOperationEditorReady] = useState(false)
  const [operationTitle, setOperationTitle] = useState('')
  const [operationContent, setOperationContent] = useState('')
  const [operationKind] = useState<ProjectPackageOperationKind>('document')
  const [pendingOperationTarget, setPendingOperationTarget] = useState<PendingOperationTarget>(null)
  const [operationTodoDialogOpen, setOperationTodoDialogOpen] = useState(false)
  const { confirmAction, confirmationDialog } = useConfirmAction(`${currentUserId}:${project.id}`)
  const [operationTodoSaveError, setOperationTodoSaveError] = useState('')
  const [todoDialogOperationId, setTodoDialogOperationId] = useState<number | null>(null)
  const [todoDialogRelatedTodoIds, setTodoDialogRelatedTodoIds] = useState<number[]>([])
  const [todoDialogRelatedTodoNotes, setTodoDialogRelatedTodoNotes] = useState<Record<number, string>>({})
  const [todoDialogTodoDoneMap, setTodoDialogTodoDoneMap] = useState<Record<number, boolean>>({})
  const [todoDialogSearch, setTodoDialogSearch] = useState('')
  const [todoFilterDialogOpen, setTodoFilterDialogOpen] = useState(false)
  const [todoFilterJoin, setTodoFilterJoin] = useState<TodoFilterJoin>('and')
  const [todoFilterConditions, setTodoFilterConditions] = useState<TodoFilterCondition[]>([])
  const [todoPickerOpen, setTodoPickerOpen] = useState(false)
  const [exportScopeDialogOpen, setExportScopeDialogOpen] = useState(false)
  const [exportScope, setExportScope] = useState<TimelineExportScope>('current')
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false)
  const [exportEditorReady, setExportEditorReady] = useState(false)
  const [exportFileName, setExportFileName] = useState('')
  const [exportContent, setExportContent] = useState('')
  const [marketOpen, setMarketOpen] = useState(false)
  const [marketRules, setMarketRules] = useState<PackageMarketRule[]>([])
  const [marketPolicy, setMarketPolicy] = useState<PackageMarketRulesResponse['policy'] | null>(null)
  const [marketAvailabilityLoading, setMarketAvailabilityLoading] = useState(true)
  const [marketVisibleRuleIds, setMarketVisibleRuleIds] = useState<PackageMarketRulesResponse['visibleRuleIds']>({
    release: [],
    ci: [],
  })
  const [marketExpireMinutes, setMarketExpireMinutes] = useState(packageMarketExpireOptions[0].value)
  const [marketExpireMode, setMarketExpireMode] = useState<'delivery-end' | 'custom'>('delivery-end')
  const [marketExpireDays, setMarketExpireDays] = useState('1')
  const [marketExpireHours, setMarketExpireHours] = useState('0')
  const [marketSelectedPackage, setMarketSelectedPackage] = useState('base-pro')
  const [marketChannel, setMarketChannel] = useState<PackageMarketChannel>('release')
  const [marketArch, setMarketArch] = useState<'amd64' | 'arm64'>('amd64')
  const [marketSearch, setMarketSearch] = useState('')
  const [marketReleaseVersion, setMarketReleaseVersion] = useState('')
  const [marketCiBranch, setMarketCiBranch] = useState('')
  const [marketCiVersion, setMarketCiVersion] = useState('')
  const [marketIncludeAll, setMarketIncludeAll] = useState(false)
  const [marketCiBranches, setMarketCiBranches] = useState<PackageMarketCiBranch[]>([])
  const [marketReleaseVersions, setMarketReleaseVersions] = useState<PackageMarketVersion[]>([])
  const [marketCiVersions, setMarketCiVersions] = useState<PackageMarketVersion[]>([])
  const [marketDetail, setMarketDetail] = useState<PackageMarketDetail | null>(null)
  const [marketDetailContext, setMarketDetailContext] = useState<PackageMarketDetailContext | null>(null)
  const [marketDependencyDetails, setMarketDependencyDetails] = useState<PackageMarketDependencyState[]>([])
  const [marketLoading, setMarketLoading] = useState(false)
  const [marketError, setMarketError] = useState('')
  const [marketExpandedGroups, setMarketExpandedGroups] = useState<Record<string, boolean>>({
    base: true,
    apps: true,
    middleware: true,
  })
  const [cartItems, setCartItems] = useState<
    Array<{
      sourcePackageId: string
      sourcePackageName: string
      packageName: string
      channel: string
      channelLabel: string
      arch: string
      version: string
      objectKey: string
      objectLastModified?: string
      sizeBytes?: number
      runtimeConfig: DeliveryRuntimeConfig
    }>
  >([])
  const [containerImages, setContainerImages] = useState<DraftContainerImage[]>([])
  const [offlinePackages, setOfflinePackages] = useState<DraftOfflinePackage[]>([])
  const [deliveryArtifacts, setDeliveryArtifacts] = useState<ProjectPackageDeliveryArtifacts | null>(null)
  const [deliveryArtifactsError, setDeliveryArtifactsError] = useState('')
  const [deliveryArtifactsLoading, setDeliveryArtifactsLoading] = useState(false)
  const [deliveryArtifactsExpireMinutes, setDeliveryArtifactsExpireMinutes] = useState<30 | 60 | 120>(30)
  const [valuesPreviewStepId, setValuesPreviewStepId] = useState<string | null>(null)
  const deliveryArtifactsCacheRef = useRef(new Map<string, ProjectPackageDeliveryArtifacts>())
  const deliveryArtifactsLoaderRef = useRef(onLoadEventDeliveryArtifacts)
  const [busyAction, setBusyAction] = useState('')
  const [copiedValue, setCopiedValue] = useState('')
  const marketDetailRequestIdRef = useRef(0)
  const todoPickerSearchRef = useRef<HTMLInputElement | null>(null)
  const todoPickerOptionsRef = useRef<HTMLDivElement | null>(null)
  const [todoPickerOptionsOverflowing, setTodoPickerOptionsOverflowing] = useState(false)
  const projectMarketContext: PackageMarketRequestContext = { projectId: project.id }
  const packageMarketRulesLoaderRef = useRef(onLoadPackageMarketRules)
  const packageMarketSelectionAvailable = !marketAvailabilityLoading &&
    marketPolicy != null &&
    organizationPackageMarketPolicyHasVisibleChannel(marketPolicy, marketVisibleRuleIds)

  useEffect(() => {
    packageMarketRulesLoaderRef.current = onLoadPackageMarketRules
  }, [onLoadPackageMarketRules])

  useEffect(() => {
    deliveryArtifactsLoaderRef.current = onLoadEventDeliveryArtifacts
  }, [onLoadEventDeliveryArtifacts])

  useEffect(() => {
    let cancelled = false
    setMarketAvailabilityLoading(true)
    setMarketPolicy(null)
    setMarketVisibleRuleIds({ release: [], ci: [] })
    void packageMarketRulesLoaderRef.current({ projectId: project.id })
      .then((payload) => {
        if (cancelled) return
        setMarketPolicy(payload.policy)
        setMarketVisibleRuleIds(payload.visibleRuleIds)
        setMarketRules(payload.rules)
        setMarketAvailabilityLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setMarketPolicy(null)
        setMarketVisibleRuleIds({ release: [], ci: [] })
        setMarketRules([])
        setMarketAvailabilityLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [project.id])

  const events = useMemo(() => timeline?.events ?? [], [timeline])
  const memberOptions = useMemo(() => {
    if (project.organizationId) return (timeline?.deliveryMembers ?? []).filter(member => member.canExecute).map(member => ({ id: member.userId, name: member.name }))
    const options = new Map<number, string>()
    options.set(project.ownerUserId, project.ownerName || '项目 Owner')
    memberships
      .filter((membership) => membership.projectId === project.id && membership.status === 'active' && membership.invitedUserId)
      .forEach((membership) => {
        options.set(
          Number(membership.invitedUserId),
          membership.memberName || membership.invitedUsername || `成员 ${membership.invitedUserId}`,
        )
      })
    return [...options.entries()].map(([id, name]) => ({ id, name }))
  }, [memberships, project.id, project.ownerName, project.ownerUserId, project.organizationId, timeline?.deliveryMembers])
  const [assignedOnly, setAssignedOnly] = useState(false)
  const activeEventFilterCount = eventFilterConditions.length
  const timelineFilterConditions = useMemo(() => {
    if (showDelivered || eventFilterConditions.some((condition) => condition.field === 'status')) {
      return eventFilterConditions
    }
    return [
      ...eventFilterConditions,
      { field: 'status' as const, id: 'default-hide-delivered', operator: 'not_equals' as const, value: 'delivered' },
    ]
  }, [eventFilterConditions, showDelivered])
  const visibleEvents = events
  const pagedEvents = visibleEvents
  const eventTotal = timeline?.pagination?.total ?? visibleEvents.length
  const eventStats = useMemo(() => ({
    active: visibleEvents.filter((event) => event.publishedAt && eventDisplayStatus(event) === 'delivering').length,
    completed: visibleEvents.filter((event) => ['delivered', 'partially_delivered', 'failed'].includes(eventDisplayStatus(event))).length,
    mine: currentUserId
      ? visibleEvents.filter((event) => event.assigneeUserId === currentUserId).length
      : 0,
  }), [currentUserId, visibleEvents])
  useEffect(() => {
    const requestId = ++timelineRequestIdRef.current
    const timer = window.setTimeout(() => {
      setTimelineLoading(true)
      setTimelineError('')
      void onLoadTimeline({
        assignedUserId: assignedOnly && currentUserId ? currentUserId : undefined,
        filters: timelineFilterConditions,
        includeDetails: false,
        join: eventFilterJoin,
        limit: eventPageSize,
        offset: eventPage * eventPageSize,
        q: eventSearch,
        sort: eventSortDirection,
      }).catch(() => {
        if (timelineRequestIdRef.current === requestId) setTimelineError('交付事件读取失败，请稍后重试。')
      }).finally(() => {
        if (timelineRequestIdRef.current === requestId) setTimelineLoading(false)
      })
    }, eventSearch.trim() ? 280 : 0)
    return () => {
      window.clearTimeout(timer)
      if (timelineRequestIdRef.current === requestId) timelineRequestIdRef.current += 1
    }
  }, [assignedOnly, currentUserId, eventFilterJoin, eventPage, eventPageSize, eventSearch, eventSortDirection, onLoadTimeline, timelineFilterConditions])
  useEffect(() => {
    const interval = window.setInterval(() => {
      void onLoadTimeline({
        assignedUserId: assignedOnly && currentUserId ? currentUserId : undefined,
        filters: timelineFilterConditions,
        includeDetails: false,
        join: eventFilterJoin,
        limit: eventPageSize,
        offset: eventPage * eventPageSize,
        q: eventSearch,
        sort: eventSortDirection,
      }).catch(() => undefined)
    }, 15_000)
    return () => window.clearInterval(interval)
  }, [assignedOnly, currentUserId, eventFilterJoin, eventPage, eventPageSize, eventSearch, eventSortDirection, onLoadTimeline, timelineFilterConditions])
  useEffect(() => {
    setEventPage(0)
  }, [assignedOnly, eventFilterConditions, eventFilterJoin, eventPageSize, eventSearch, eventSortDirection, showDelivered])
  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(eventTotal / eventPageSize) - 1)
    if (eventPage > lastPage) setEventPage(lastPage)
  }, [eventPage, eventPageSize, eventTotal])
  const todosById = useMemo(
    () => new Map(todos.map((todo) => [todo.id, todo])),
    [todos],
  )
  const selectableTodos = useMemo(
    () =>
      [...todos]
        .filter((todo) => todo.confirmationStatus !== 'rejected')
        .sort((left, right) => {
        if (left.done !== right.done) return Number(left.done) - Number(right.done)
        if (left.dueDate !== right.dueDate) return left.dueDate.localeCompare(right.dueDate)
        return left.id - right.id
      }),
    [todos],
  )
  const selectableTodosById = useMemo(
    () => new Map(selectableTodos.map((todo) => [todo.id, todo])),
    [selectableTodos],
  )
  const canManageProject = timeline?.canPlanDelivery === true
  const todoDialogOperation = useMemo(
    () =>
      todoDialogOperationId == null
        ? null
        : events
          .flatMap((event) => [
            ...event.operations,
            ...event.groups.flatMap((group) => group.operations),
          ])
          .find((operation) => operation.id === todoDialogOperationId) ?? null,
    [events, todoDialogOperationId],
  )
  const todoDialogSelectedIds = useMemo(
    () => new Set(todoDialogRelatedTodoIds),
    [todoDialogRelatedTodoIds],
  )
  const todoDialogModuleOptions = useMemo(() => {
    const modules = new Map<number, string>()
    for (const todo of selectableTodos) {
      if (todo.moduleId && todo.moduleName) {
        modules.set(todo.moduleId, todo.moduleName)
      }
    }
    return Array.from(modules, ([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  }, [selectableTodos])
  const todoDialogAssigneeOptions = useMemo(() => {
    const assignees = new Map<number, string>()
    for (const todo of selectableTodos) {
      if (todo.assigneeUserId && todo.assigneeName) {
        assignees.set(todo.assigneeUserId, todo.assigneeName)
      }
    }
    return Array.from(assignees, ([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  }, [selectableTodos])
  const todoDialogCreatorOptions = useMemo(() => {
    const creators = new Map<number, string>()
    for (const todo of selectableTodos) {
      if (todo.createdByUserId && todo.creatorName) {
        creators.set(todo.createdByUserId, todo.creatorName)
      }
    }
    return Array.from(creators, ([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  }, [selectableTodos])
  const todoDialogWatcherOptions = useMemo(() => {
    const watchers = new Map<number, string>()
    for (const todo of selectableTodos) {
      const watcherIds = Array.isArray(todo.watcherUserIds) && todo.watcherUserIds.length > 0
        ? todo.watcherUserIds
        : todo.watcherUserId
          ? [todo.watcherUserId]
          : []
      const watcherNames = Array.isArray(todo.watcherNames) && todo.watcherNames.length > 0
        ? todo.watcherNames
        : todo.watcherName
          ? [todo.watcherName]
          : []
      watcherIds.forEach((watcherId, index) => {
        const watcherName = watcherNames[index]
        if (watcherName) {
          watchers.set(watcherId, watcherName)
        }
      })
      if (watcherIds.length > 0 && watcherNames.length === 0 && todo.watcherName) {
        watchers.set(watcherIds[0], todo.watcherName)
      }
    }
    return Array.from(watchers, ([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  }, [selectableTodos])
  const activeTodoFilterCount = todoFilterConditions.length
  const todoFilterSummary = activeTodoFilterCount > 0
    ? `已筛选 ${activeTodoFilterCount} 条件`
    : '筛选'
  const filteredTodoDialogTodos = useMemo(() => {
    const query = todoDialogSearch.trim().toLowerCase()
    return selectableTodos.filter((todo) => {
      const matchesSearch = !query || todoSearchMeta(todo).includes(query)
      return (
        matchesSearch &&
        matchesTodoFilterConditions(todo, todoFilterConditions, todoFilterJoin)
      )
    })
  }, [selectableTodos, todoDialogSearch, todoFilterConditions, todoFilterJoin])
  const todoDialogSelectedTodos = useMemo(
    () =>
      todoDialogRelatedTodoIds
        .map((todoId) => selectableTodosById.get(todoId) ?? todosById.get(todoId))
        .filter((todo): todo is Todo => Boolean(todo)),
    [selectableTodosById, todoDialogRelatedTodoIds, todosById],
  )

  const selectedEvent =
    visibleEvents.find((event) => event.id === selectedEventId) ?? visibleEvents[0] ?? null
  const selectedEventDetailId = selectedEvent?.id ?? null
  const selectedEventDetailRevision = selectedEvent?.detailRevision ?? ''
  const selectedEventNeedsDetails = Boolean(selectedEvent && selectedEvent.detailsLoaded === false)
  useEffect(() => {
    const requestId = ++eventDetailsRequestIdRef.current
    if (!selectedEventNeedsDetails || selectedEventDetailId == null) {
      setEventDetailsError('')
      return
    }
    setEventDetailsError('')
    void onLoadTimeline({ eventId: selectedEventDetailId, includeDetails: true, limit: 1, offset: 0 })
      .then((detailTimeline) => {
        if (eventDetailsRequestIdRef.current !== requestId) return
        if (!detailTimeline.events.some((event) => event.id === selectedEventDetailId)) {
          setEventDetailsError('事件不存在、已删除或当前账号无权查看。')
        }
      })
      .catch(() => {
        if (eventDetailsRequestIdRef.current === requestId) setEventDetailsError('事件详情读取失败，请稍后重试。')
      })
  }, [eventDetailsRetry, onLoadTimeline, selectedEventDetailId, selectedEventNeedsDetails])
  useEffect(() => {
    let cancelled = false
    if (!eventDetailOpen || eventDetailTab !== 'delivery' || selectedEventDetailId == null || selectedEventNeedsDetails) {
      return
    }
    const cacheKey = `${selectedEventDetailId}:${selectedEventDetailRevision}:${deliveryArtifactsExpireMinutes}`
    const cached = deliveryArtifactsCacheRef.current.get(cacheKey)
    if (cached) {
      setDeliveryArtifacts(cached)
      setDeliveryArtifactsError('')
      setDeliveryArtifactsLoading(false)
      return
    }
    setDeliveryArtifacts(null)
    setDeliveryArtifactsLoading(true)
    setDeliveryArtifactsError('')
    void deliveryArtifactsLoaderRef.current(selectedEventDetailId, deliveryArtifactsExpireMinutes)
      .then((value) => {
        if (cancelled) return
        deliveryArtifactsCacheRef.current.set(cacheKey, value)
        setDeliveryArtifacts(value)
      })
      .catch(() => {
        if (!cancelled) {
          setDeliveryArtifacts(null)
          setDeliveryArtifactsError('交付地址和执行脚本生成失败，请稍后重试。')
        }
      })
      .finally(() => {
        if (!cancelled) setDeliveryArtifactsLoading(false)
    })
    return () => { cancelled = true }
  }, [deliveryArtifactsExpireMinutes, eventDetailOpen, eventDetailTab, selectedEventDetailId, selectedEventDetailRevision, selectedEventNeedsDetails])
  const canManageTimeline = selectedEvent?.capabilities?.canEditPlan === true
  const canManageLinks = selectedEvent?.capabilities?.canExecute === true || canManageTimeline
  const existingOperationInteraction = resolveExistingOperationInteraction(canManageTimeline)
  const operationDialogReadOnly = Boolean(
    pendingOperationTarget?.operation && existingOperationInteraction.readOnly,
  )

  useEffect(() => {
    const nextEvent =
      visibleEvents.find((event) => event.id === selectedEventId) ?? visibleEvents[0] ?? null
    const nextGroup =
      nextEvent?.groups.find((group) => group.id === selectedGroupId) ??
      nextEvent?.groups[0] ??
      null
    if (nextEvent?.id !== selectedEventId) {
      setSelectedEventId(nextEvent?.id ?? null)
    }
    if (nextGroup?.id !== selectedGroupId) {
      setSelectedGroupId(nextGroup?.id ?? null)
    }
  }, [selectedEventId, selectedGroupId, visibleEvents])

  const selectedEventAddedObjectKeys = useMemo(() => {
    const next = new Set<string>()
    cartItems.forEach((item) => next.add(item.objectKey))
    return next
  }, [cartItems])
  const documentScopes = useMemo(() => ['event'], [])
  const resolvedDocumentScope = documentScopes.includes(activeDocumentScope)
    ? activeDocumentScope
    : 'event'
  const activePackageDocumentName = resolvedDocumentScope.startsWith('package:')
    ? resolvedDocumentScope.slice('package:'.length)
    : ''
  const activePackageDocument = activePackageDocumentName
    ? packageDocumentValues[activePackageDocumentName] ?? {
        content: '',
        relatedTodoIds: [],
        title: `${activePackageDocumentName} 安装包文档`,
      }
    : null
  const activeDocumentRelatedTodoIds = activePackageDocument
    ? activePackageDocument.relatedTodoIds
    : eventDocumentRelatedTodoIds
  const activeDocumentRelatedTodoIdSet = useMemo(
    () => new Set(activeDocumentRelatedTodoIds),
    [activeDocumentRelatedTodoIds],
  )
  const activeDocumentRelatedTodos = useMemo(
    () =>
      activeDocumentRelatedTodoIds
        .map((todoId) => selectableTodosById.get(todoId) ?? todosById.get(todoId))
        .filter((todo): todo is Todo => Boolean(todo)),
    [activeDocumentRelatedTodoIds, selectableTodosById, todosById],
  )
  const activeDocumentTodoFilterCount = documentTodoFilterConditions.length
  const documentTodoFilterSummary = activeDocumentTodoFilterCount > 0
    ? `已筛选 ${activeDocumentTodoFilterCount} 条件`
    : '筛选'
  const filteredDocumentTodos = useMemo(() => {
    const query = documentTodoSearch.trim().toLocaleLowerCase()
    return selectableTodos.filter((todo) => {
      const matchesSearch = !query ||
        `${todo.title} ${todoSearchMeta(todo)}`.toLocaleLowerCase().includes(query)
      return matchesSearch && matchesTodoFilterConditions(
        todo,
        documentTodoFilterConditions,
        documentTodoFilterJoin,
      )
    })
  }, [documentTodoFilterConditions, documentTodoFilterJoin, documentTodoSearch, selectableTodos])
  const eventBasicInformationValid = Boolean(
    eventTitle.trim() &&
      eventDeliveryStartAt &&
      eventDeliveryEndAt &&
      dateTimeLocalToUtcTimestamp(eventDeliveryEndAt) > dateTimeLocalToUtcTimestamp(eventDeliveryStartAt),
  )
  const containerImageValidation = useMemo(() => {
    const seen = new Set<string>()
    return containerImages.map((item) => {
      const result = normalizeContainerImageReference(item.image, { requireTagOrDigest: true })
      if (!result.valid) return result.error
      const key = containerImageReferenceKey(result.value)
      if (seen.has(key)) return '镜像地址不能重复。'
      seen.add(key)
      const runtimeConfig = normalizeDeliveryRuntimeConfig(item.runtimeConfig)
      return runtimeConfig.valid ? '' : runtimeConfig.error
    })
  }, [containerImages])
  const offlinePackageValidation = useMemo(() => {
    const seen = new Set<string>()
    return offlinePackages.map((item) => {
      const result = normalizeOfflinePackageUrl(item.url)
      if (!result.valid) return result.error
      if (seen.has(result.value)) return '离线包地址不能重复。'
      seen.add(result.value)
      const runtimeConfig = normalizeDeliveryRuntimeConfig(item.runtimeConfig)
      return runtimeConfig.valid ? '' : runtimeConfig.error
    })
  }, [offlinePackages])
  const packageRuntimeConfigValidation = useMemo(
    () => cartItems.map((item) => normalizeDeliveryRuntimeConfig(item.runtimeConfig)),
    [cartItems],
  )
  const otherValidation = useMemo(
    () => deliveryScripts.map((script) => normalizeDeliveryOther({ content: script.content, type: 'shell-script' })),
    [deliveryScripts],
  )
  const eventHasDeliveryContent = cartItems.length > 0 || containerImages.length > 0 || offlinePackages.length > 0 || deliveryScripts.length > 0
  const eventArtifactsValid = !containerImageValidation.some(Boolean) &&
    !offlinePackageValidation.some(Boolean) &&
    packageRuntimeConfigValidation.every((result) => result.valid) &&
    otherValidation.every((result) => result.valid) &&
    deliveryScripts.every((script) => Boolean(script.title.trim())) &&
    deliverySteps.every((step) => Boolean(step.processName.trim() && step.reference) && (
      step.kind === 'package' ? cartItems.some((item) => item.objectKey === step.reference) :
      step.kind === 'container-image' ? containerImages.some((item) => item.image === step.reference) :
      step.kind === 'offline-package' ? offlinePackages.some((item) => item.url === step.reference) :
      deliveryScripts.some((script) => script.id === step.reference)
    ))
  const eventCreateContentValid = eventEditorEventId != null || eventHasDeliveryContent
  const eventDocumentValid = Boolean(eventDocumentTitle.trim() && eventDocumentContent.trim())
  const eventPublishValid = canManageProject &&
    eventBasicInformationValid &&
    eventArtifactsValid &&
    eventCreateContentValid &&
    deliverySteps.length > 0 &&
    eventDocumentValid &&
    memberOptions.some((member) => member.id === Number(eventAssigneeUserId))
  const deliveryStepResources = useMemo(() => [
    ...cartItems.map((item) => ({ kind: 'package' as const, label: `对象存储 · ${packageItemFileName(item)}`, reference: item.objectKey })),
    ...containerImages.map((item, index) => ({ kind: 'container-image' as const, label: `集群镜像 · ${item.image || index + 1}`, reference: item.image })),
    ...offlinePackages.map((item, index) => ({ kind: 'offline-package' as const, label: `离线包 · ${item.url || index + 1}`, reference: item.url })),
    ...deliveryScripts.map((script) => ({ kind: 'shell-script' as const, label: `Shell 脚本 · ${script.title || '未命名'}`, reference: script.id })),
  ], [cartItems, containerImages, deliveryScripts, offlinePackages])

  function addDeliveryStep(resourceKey: string) {
    const resource = deliveryStepResources.find((item) => `${item.kind}:${item.reference}` === resourceKey)
    if (!resource) return
    setDeliverySteps((current) => [...current, {
      id: newDeliveryId('step'),
      kind: resource.kind,
      processName: resource.label.replace(/^.+? · /u, ''),
      reference: resource.reference,
    }])
    setEventEditorDirty(true)
  }

  function moveDeliveryStep(index: number, offset: -1 | 1) {
    setDeliverySteps((current) => {
      const target = index + offset
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
    setEventEditorDirty(true)
  }

  function updatePackageDocument(
    packageName: string,
    patch: Partial<EventDocumentDraftValue>,
  ) {
    setPackageDocumentValues((current) => ({
      ...current,
      [packageName]: {
        content: current[packageName]?.content ?? '',
        relatedTodoIds: current[packageName]?.relatedTodoIds ?? [],
        title: current[packageName]?.title || `${packageName} 安装包文档`,
        ...patch,
      },
    }))
    setEventEditorDirty(true)
  }

  function selectDocumentScope(scope: string) {
    setActiveDocumentScope(scope)
    setDocumentTodoPickerOpen(false)
    setDocumentTodoFilterDialogOpen(false)
    setDocumentTodoSearch('')
    setEventEditorReady(false)
  }

  function handleDocumentTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, scope: string) {
    if (!['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'End', 'Home'].includes(event.key)) return
    event.preventDefault()
    const currentIndex = documentScopes.indexOf(scope)
    if (currentIndex < 0) return
    const lastIndex = documentScopes.length - 1
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? lastIndex
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? (currentIndex - 1 + documentScopes.length) % documentScopes.length
          : (currentIndex + 1) % documentScopes.length
    const nextScope = documentScopes[nextIndex]
    selectDocumentScope(nextScope)
    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    tabs?.[nextIndex]?.focus()
  }

  useEffect(() => {
    if (documentScopes.includes(activeDocumentScope)) return
    setActiveDocumentScope('event')
    setDocumentTodoPickerOpen(false)
    setDocumentTodoFilterDialogOpen(false)
    setDocumentTodoSearch('')
    setEventEditorReady(false)
  }, [activeDocumentScope, documentScopes])

  function toggleActiveDocumentTodo(todoId: number) {
    const nextRelatedTodoIds = activeDocumentRelatedTodoIds.includes(todoId)
      ? activeDocumentRelatedTodoIds.filter((item) => item !== todoId)
      : [...activeDocumentRelatedTodoIds, todoId]
    if (activePackageDocumentName) {
      updatePackageDocument(activePackageDocumentName, { relatedTodoIds: nextRelatedTodoIds })
    } else {
      setEventDocumentRelatedTodoIds(nextRelatedTodoIds)
      setEventEditorDirty(true)
    }
  }

  function removeDraftPackageItem(objectKey: string) {
    setCartItems((current) => current.filter((item) => item.objectKey !== objectKey))
    setEventEditorDirty(true)
  }

  const filteredRules = useMemo(() => {
    const query = packageMarketSearchMeta(marketSearch)
    const visibleIds = new Set(marketVisibleRuleIds[marketChannel] ?? [])
    const baseRules: PackageMarketRule[] = [
      ...getPackageMarketBaseRules().filter((rule) => visibleIds.has(rule.id)),
      ...marketRules.filter((rule) => {
        if (rule.category === 'dependency') {
          const dependencyChannel = packageMarketDependencyChannel(rule)
          return dependencyChannel === marketChannel && visibleIds.has(canonicalPackageMarketRuleId(rule.parent))
        }
        const id = canonicalPackageMarketRuleId(rule.id)
        return visibleIds.has(id)
      }),
    ]
    return baseRules.filter((rule) => {
      if (!query) return true
      return packageMarketSearchMeta(`${rule.id} ${rule.name}`).includes(query)
    })
  }, [marketChannel, marketRules, marketSearch, marketVisibleRuleIds])

  const groupedMarketRules = useMemo(() => groupPackageMarketRules(filteredRules), [filteredRules])
  const selectedMarketDependencyRules = useMemo(() => {
    if (!marketPolicy) return []
    const selectedPackageId = canonicalPackageMarketRuleId(marketSelectedPackage)
    return marketRules.filter((rule) => {
      const dependencyChannel = packageMarketDependencyChannel(rule)
      return rule.category === 'dependency' &&
        dependencyChannel != null &&
        canonicalPackageMarketRuleId(rule.parent) === selectedPackageId &&
        isPackageMarketRuleVisible(rule, marketPolicy, dependencyChannel)
    })
  }, [marketPolicy, marketRules, marketSelectedPackage])

  async function copyToClipboard(value: string, feedbackKey: string) {
    if (!value) return
    await navigator.clipboard.writeText(value)
    setCopiedValue(feedbackKey)
    window.setTimeout(() => {
      setCopiedValue((current) => (current === feedbackKey ? '' : current))
    }, 1200)
  }

  function copiedLabel(feedbackKey: string, fallback: string) {
    return copiedValue === feedbackKey ? '已复制' : fallback
  }

  function addMarketLinkToCart(
    context: PackageMarketDetailContext | null,
    detail: PackageMarketDetail,
    link: PackageMarketDetail['links'][number],
  ) {
    if (!context || selectedEventAddedObjectKeys.has(link.objectKey)) return
    setCartItems((current) => {
      if (current.some((item) => item.objectKey === link.objectKey)) return current
      return [
        ...current,
        {
          sourcePackageId: context.packageId,
          sourcePackageName: detail.title,
          packageName: link.name,
          channel: context.channel,
          channelLabel: channelLabel(context.channel),
          arch: context.arch,
          version: link.version,
          objectKey: link.objectKey,
          objectLastModified: link.lastModified,
          sizeBytes: link.size,
          runtimeConfig: emptyDeliveryRuntimeConfig(),
        },
      ]
    })
    setEventEditorDirty(true)
  }

  useEffect(() => {
    if (!todoPickerOpen) return
    const frameId = window.requestAnimationFrame(() => {
      todoPickerSearchRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [todoPickerOpen])

  useEffect(() => {
    if (!todoPickerOpen) {
      setTodoPickerOptionsOverflowing(false)
      return
    }
    const optionsElement = todoPickerOptionsRef.current
    if (!optionsElement) return

    const updateOverflowState = () => {
      setTodoPickerOptionsOverflowing(optionsElement.scrollHeight > optionsElement.clientHeight + 1)
    }

    const frameId = window.requestAnimationFrame(updateOverflowState)
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateOverflowState)
    resizeObserver?.observe(optionsElement)

    return () => {
      window.cancelAnimationFrame(frameId)
      resizeObserver?.disconnect()
    }
  }, [filteredTodoDialogTodos.length, todoPickerOpen])

  async function loadMarketContext(requestId: number) {
    setMarketError('')
    try {
      const rulesPayload = await onLoadPackageMarketRules(projectMarketContext)
      if (requestId !== marketDetailRequestIdRef.current) return null
      setMarketPolicy(rulesPayload.policy)
      setMarketVisibleRuleIds(rulesPayload.visibleRuleIds)
      setMarketRules(rulesPayload.rules)
      const expireMinutes = getExpireMinutesUntil(eventDeliveryEndAt)
      const defaultDays = Math.floor(expireMinutes / (24 * 60))
      const defaultHours = Math.floor((expireMinutes % (24 * 60)) / 60)
      setMarketExpireMode('delivery-end')
      setMarketExpireDays(String(defaultDays))
      setMarketExpireHours(String(defaultHours))
      setMarketExpireMinutes(expireMinutes)
      const releaseIds = rulesPayload.visibleRuleIds.release
      const ciIds = rulesPayload.visibleRuleIds.ci
      const activeChannel: PackageMarketChannel = rulesPayload.policy.channels.release.enabled && releaseIds.length > 0
        ? 'release'
        : rulesPayload.policy.channels.ci.enabled && ciIds.length > 0 ? 'ci' : 'release'
      const packageId = rulesPayload.visibleRuleIds[activeChannel][0] ?? ''
      setMarketChannel(activeChannel)
      setMarketSelectedPackage(packageId)
      setMarketReleaseVersion('')
      setMarketCiBranch('')
      setMarketCiVersion('')
      return {
        channel: activeChannel,
        enabled: rulesPayload.policy.enabled,
        expireMinutes,
        packageId,
        rules: rulesPayload.rules,
        visibleRuleIds: rulesPayload.visibleRuleIds,
      }
    } catch (error) {
      if (requestId !== marketDetailRequestIdRef.current) return null
      setMarketError(error instanceof Error ? error.message : '包市场读取失败')
      return null
    }
  }

  async function refreshMarketDependencyDetails(params: {
    arch: 'amd64' | 'arm64'
    expireMinutes: number
    includeAll: boolean
    requestId: number
    requestContext?: PackageMarketRequestContext
    rules: PackageMarketRule[]
    selectedVersions?: Record<string, string>
  }) {
    const {
      arch,
      expireMinutes,
      includeAll,
      requestContext,
      requestId,
      rules,
      selectedVersions = {},
    } = params
    if (rules.length === 0) {
      setMarketDependencyDetails([])
      return
    }

    setMarketDependencyDetails(rules.map((rule) => ({
      context: null,
      detail: null,
      error: '',
      loading: true,
      rule,
      selectedVersion: selectedVersions[rule.id] ?? '',
      versions: [],
    })))

    const nextDetails = await Promise.all(rules.map(async (rule): Promise<PackageMarketDependencyState> => {
      const dependencyChannel: PackageMarketChannel = rule.dependencyRoots?.length ? 'ci' : 'release'
      try {
        const versions = await onLoadPackageMarketVersions({
          arch,
          kind: dependencyChannel,
          includeAll,
          packageId: rule.id,
          context: requestContext,
        })
        const selectedVersion =
          selectedVersions[rule.id] ||
          (dependencyChannel === 'ci' ? versions[0]?.hash : versions[0]?.version) ||
          ''
        const detail = await onLoadPackageMarketDetail({
          packageId: rule.id,
          channel: dependencyChannel,
          arch,
          expireMinutes,
          includeAll,
          ciVersion: dependencyChannel === 'ci' ? selectedVersion : '',
          releaseVersion: dependencyChannel === 'release' ? selectedVersion : '',
          context: requestContext,
        })
        return {
          context: {
            arch,
            channel: dependencyChannel,
            ciBranch: '',
            ciVersion: dependencyChannel === 'ci' ? selectedVersion : '',
            packageId: rule.id,
            releaseVersion: dependencyChannel === 'release' ? selectedVersion : '',
          },
          detail,
          error: '',
          loading: false,
          rule,
          selectedVersion,
          versions,
        }
      } catch (error) {
        return {
          context: null,
          detail: null,
          error: error instanceof Error ? error.message : '附属包详情加载失败',
          loading: false,
          rule,
          selectedVersion: selectedVersions[rule.id] ?? '',
          versions: [],
        }
      }
    }))

    if (requestId !== marketDetailRequestIdRef.current) return
    setMarketDependencyDetails(nextDetails)
  }

  async function refreshMarketDetail(nextOverrides?: Partial<{
    arch: 'amd64' | 'arm64'
    channel: PackageMarketChannel
    ciBranch: string
    ciVersion: string
    expireMinutes: number
    includeAll: boolean
    marketRules: PackageMarketRule[]
    visibleRuleIds?: PackageMarketRulesResponse['visibleRuleIds']
    requestContext: PackageMarketRequestContext
    packageId: string
    releaseVersion: string
    dependencyVersions: Record<string, string>
  }>) {
    const packageId = nextOverrides?.packageId ?? marketSelectedPackage
    const channel = nextOverrides?.channel ?? marketChannel
    const arch = nextOverrides?.arch ?? marketArch
    const releaseVersion = nextOverrides?.releaseVersion ?? marketReleaseVersion
    const requestedCiBranch = nextOverrides?.ciBranch ?? marketCiBranch
    const ciVersion = nextOverrides?.ciVersion ?? marketCiVersion
    const expireMinutes = nextOverrides?.expireMinutes ?? marketExpireMinutes
    const includeAll = nextOverrides?.includeAll ?? marketIncludeAll
    const rules = nextOverrides?.marketRules ?? marketRules
    const visibleRuleIds = nextOverrides?.visibleRuleIds ?? marketVisibleRuleIds
    const requestContext = nextOverrides?.requestContext ?? projectMarketContext
    const requestId = ++marketDetailRequestIdRef.current
    setMarketLoading(true)
    setMarketError('')
    setMarketDetail(null)
    setMarketDetailContext(null)
    setMarketDependencyDetails([])
    try {
      const ciBranches = channel === 'ci'
        ? await onLoadPackageMarketCiBranches(packageId, requestContext)
        : []
      if (requestId !== marketDetailRequestIdRef.current) return
      const ciBranch = requestedCiBranch && ciBranches.some((item) => item.name === requestedCiBranch)
        ? requestedCiBranch
        : ciBranches[0]?.name ?? ''
      const context: PackageMarketDetailContext = {
        arch,
        channel,
        ciBranch,
        ciVersion,
        packageId,
        releaseVersion,
      }
      const [versions, detail] = await Promise.all([
        channel === 'ci'
          ? onLoadPackageMarketVersions({
              arch,
              ciBranch,
              kind: 'ci',
              includeAll,
              packageId,
              context: requestContext,
            })
          : onLoadPackageMarketVersions({
              arch,
              kind: 'release',
              deployType: packageId === 'base-oss' ? 'oss' : packageId === 'base-pro' ? 'pro' : undefined,
              includeAll,
              packageId,
              context: requestContext,
            }),
        onLoadPackageMarketDetail({
          packageId,
          channel,
          arch,
          ciBranch,
          deployType: packageId === 'base-oss' ? 'oss' : packageId === 'base-pro' ? 'pro' : undefined,
          expireMinutes,
          includeAll,
          releaseVersion,
          ciVersion,
          context: requestContext,
        }),
      ])
      if (requestId !== marketDetailRequestIdRef.current) return
      if (channel === 'ci') {
        setMarketCiBranch(ciBranch)
        setMarketCiBranches(ciBranches)
        setMarketCiVersions(versions)
      } else {
        setMarketCiBranch('')
        setMarketCiBranches([])
        setMarketReleaseVersions(versions)
      }
      setMarketDetail(detail)
      setMarketDetailContext(context)
      const dependencyRules = rules.filter((rule) => {
        const dependencyChannel = packageMarketDependencyChannel(rule)
        return rule.category === 'dependency' &&
          dependencyChannel != null &&
          canonicalPackageMarketRuleId(rule.parent) === canonicalPackageMarketRuleId(packageId) &&
          visibleRuleIds[dependencyChannel].includes(canonicalPackageMarketRuleId(rule.parent))
      })
      void refreshMarketDependencyDetails({
        arch,
        expireMinutes,
        includeAll,
        requestId,
        requestContext,
        rules: dependencyRules,
        selectedVersions: nextOverrides?.dependencyVersions,
      })
    } catch (error) {
      if (requestId !== marketDetailRequestIdRef.current) return
      setMarketError(error instanceof Error ? error.message : '包详情加载失败')
    } finally {
      if (requestId === marketDetailRequestIdRef.current) {
        setMarketLoading(false)
      }
    }
  }

  function confirmDiscardEventChanges() {
    return !eventEditorDirty || window.confirm('当前事件有未保存修改，确认离开吗？')
  }

  function openCreateEventEditor() {
    if (!confirmDiscardEventChanges()) return
    setEventEditorEventId(null)
    setEventEditorStep(1)
    setEventTitle('')
    setEventType(events.length === 0 ? 'init' : 'upgrade')
    const startDate = getShanghaiDateStamp()
    setEventDeliveryStartAt(`${startDate}T00:00`)
    setEventDeliveryEndAt(`${startDate}T23:59`)
    setEventAssigneeUserId(
      String(
        memberOptions.find((member) => member.id === currentUserId)?.id ??
          memberOptions[0]?.id ??
          '',
      ),
    )
    setCartItems([])
    setContainerImages([])
    setOfflinePackages([])
    setDeliveryScripts([])
    setDeliverySteps([])
    setEventDocumentTitle('变更记录')
    setEventDocumentContent('')
    setEventDocumentRelatedTodoIds([])
    setPackageDocumentValues({})
    setActiveDocumentScope('event')
    setDocumentTodoPickerOpen(false)
    setDocumentTodoSearch('')
    setDocumentTodoFilterDialogOpen(false)
    setDocumentTodoFilterJoin('and')
    setDocumentTodoFilterConditions([])
    setEventEditorReady(false)
    setEventEditorDirty(false)
    setEventDetailOpen(false)
    setEventEditorOpen(true)
  }

  function openPackageMarket() {
    if (!packageMarketSelectionAvailable) return
    const openRequestId = ++marketDetailRequestIdRef.current
    setMarketDetail(null)
    setMarketDetailContext(null)
    setMarketLoading(true)
    setMarketError('')
    setMarketOpen(true)
    void loadMarketContext(openRequestId).then((context) => {
      if (openRequestId !== marketDetailRequestIdRef.current) return
      if (context == null) {
        setMarketLoading(false)
        return
      }
      if (!context.packageId || !context.enabled) {
        setMarketLoading(false)
        return
      }
      void refreshMarketDetail({
        channel: context.channel,
        expireMinutes: context.expireMinutes,
        marketRules: context.rules,
        visibleRuleIds: context.visibleRuleIds,
        packageId: context.packageId,
      })
      })
  }

  function customMarketExpireMinutes(daysValue = marketExpireDays, hoursValue = marketExpireHours) {
    const days = Number(daysValue)
    const hours = Number(hoursValue)
    if (
      !Number.isInteger(days) ||
      !Number.isInteger(hours) ||
      days < 0 ||
      hours < 0 ||
      hours > 23
    ) {
      return null
    }
    const minutes = days * 24 * 60 + hours * 60
    if (minutes < 1 || minutes > packageMarketExpireMaxMinutes) return null
    return minutes
  }

  function refreshCustomMarketExpire(nextDays: string, nextHours: string) {
    const nextMinutes = customMarketExpireMinutes(nextDays, nextHours)
    if (nextMinutes == null) return
    setMarketExpireMinutes(nextMinutes)
    void refreshMarketDetail({ expireMinutes: nextMinutes })
  }

  function openLoadedDraftEventEditor(event: ProjectPackageEvent) {
    if ((event.publishedAt && event.status !== 'rejected') || !confirmDiscardEventChanges()) return
    const eventDocument = event.operations.find((operation) => operation.kind === 'document')
    setEventEditorEventId(event.id)
    setEventEditorStep(1)
    setSelectedEventId(event.id)
    setEventTitle(event.title)
    setEventType(event.type)
    setEventDeliveryStartAt(`${dateTimeLocalDateStamp(getEventDeliveryStartAt(event))}T00:00`)
    setEventDeliveryEndAt(`${dateTimeLocalDateStamp(getEventDeliveryEndAt(event))}T23:59`)
    setEventAssigneeUserId(String(event.assigneeUserId ?? ''))
    setCartItems(event.groups.flatMap((group) => group.items.map((item) => ({
      arch: item.arch,
      channel: item.channel,
      channelLabel: item.channelLabel,
      objectKey: item.objectKey,
      objectLastModified: item.objectLastModified,
      packageName: item.packageName,
      sizeBytes: item.sizeBytes,
      runtimeConfig: item.runtimeConfig,
      sourcePackageId: item.sourcePackageId,
      sourcePackageName: item.sourcePackageName,
      version: item.version,
    }))))
    setContainerImages(event.containerImages.map((item) => ({ image: item.image, runtimeConfig: item.runtimeConfig })))
    setOfflinePackages(event.offlinePackages.map((item) => ({ runtimeConfig: item.runtimeConfig, url: item.url })))
    setDeliveryScripts(event.deliveryScripts?.length
      ? event.deliveryScripts
      : event.other ? [{ id: 'script-1', title: 'Shell 脚本', content: event.other.content }] : [])
    setDeliverySteps(event.deliverySteps ?? [])
    setEventDocumentTitle(eventDocument?.title || `${event.title} 变更记录`)
    setEventDocumentContent(eventDocument?.content ?? '')
    setEventDocumentRelatedTodoIds(eventDocument?.relatedTodoIds ?? [])
    setPackageDocumentValues({})
    setActiveDocumentScope('event')
    setDocumentTodoPickerOpen(false)
    setDocumentTodoSearch('')
    setDocumentTodoFilterDialogOpen(false)
    setDocumentTodoFilterJoin('and')
    setDocumentTodoFilterConditions([])
    setEventEditorReady(false)
    setEventEditorDirty(false)
    setEventDetailOpen(false)
    setEventEditorOpen(true)
  }

  async function openDraftEventEditor(event: ProjectPackageEvent) {
    if (event.detailsLoaded !== false) {
      openLoadedDraftEventEditor(event)
      return
    }
    setEventDetailsError('')
    try {
      const detailTimeline = await onLoadTimeline({ eventId: event.id, includeDetails: true, limit: 1, offset: 0 })
      const loadedEvent = detailTimeline.events.find((item) => item.id === event.id)
      if (!loadedEvent) {
        setEventDetailsError('事件不存在、已删除或当前账号无权查看。')
        setSelectedEventId(event.id)
        setEventDetailOpen(true)
        return
      }
      openLoadedDraftEventEditor(loadedEvent)
    } catch {
      setEventDetailsError('事件详情读取失败，请稍后重试。')
      setSelectedEventId(event.id)
      setEventDetailOpen(true)
    }
  }

  function selectEventFromList(event: ProjectPackageEvent) {
    setEventDetailTab('overview')
    if (!confirmDiscardEventChanges()) return
    setEventEditorOpen(false)
    setEventEditorDirty(false)
    setSelectedEventId(event.id)
    setSelectedGroupId(event.groups[0]?.id ?? null)
    setEventDetailOpen(true)
  }

  function resetEventEditor() {
    setEventEditorOpen(false)
    setEventEditorDirty(false)
    setEventEditorEventId(null)
  }

  async function returnToEventList() {
    if (!eventEditorDirty) {
      resetEventEditor()
      return
    }
    await confirmAction({
      title: '放弃未保存的修改？',
      description: '当前交付事件中的修改尚未保存，返回列表后这些修改将丢失。',
      confirmLabel: '放弃修改',
      variant: 'destructive',
    }, async () => {
      resetEventEditor()
      return true
    })
  }

  async function deleteEventFromList(event: ProjectPackageEvent) {
    const deletedIndex = visibleEvents.findIndex((item) => item.id === event.id)
    const nextEvent = deletedIndex >= 0
      ? visibleEvents[deletedIndex + 1] ?? visibleEvents[deletedIndex - 1] ?? null
      : null
    const deletingActiveEvent = selectedEvent?.id === event.id || (
      eventEditorOpen && eventEditorEventId === event.id
    )
    const deleted = await onDeleteEvent(event.id)
    if (!deleted || !deletingActiveEvent) return deleted

    setEventEditorOpen(false)
    setEventEditorDirty(false)
    setEventEditorEventId(null)
    setSelectedEventId(nextEvent?.id ?? null)
    setSelectedGroupId(nextEvent?.groups[0]?.id ?? null)
    return true
  }

  function clearOperationTodoDialogState() {
    setTodoDialogOperationId(null)
    setTodoDialogRelatedTodoIds([])
    setTodoDialogRelatedTodoNotes({})
    setTodoDialogTodoDoneMap({})
    setTodoDialogSearch('')
    setTodoFilterConditions([])
    setTodoFilterJoin('and')
    setTodoFilterDialogOpen(false)
    setTodoPickerOpen(false)
  }

  function toggleTodoDialogTodo(todoId: number) {
    setTodoDialogRelatedTodoIds((current) =>
      current.includes(todoId)
        ? current.filter((item) => item !== todoId)
        : [...current, todoId],
    )
    setTodoDialogRelatedTodoNotes((current) => {
      if (!(todoId in current)) return current
      return current
    })
  }

  function updateTodoDialogNote(todoId: number, note: string) {
    const normalized = note.trim()
    setTodoDialogRelatedTodoNotes((current) => ({
      ...current,
      [todoId]: note,
    }))
    if (normalized) {
      setTodoDialogRelatedTodoIds((current) =>
        current.includes(todoId) ? current : [...current, todoId],
      )
    }
  }

  async function saveOperationTodoDialog() {
    if (!canManageLinks) return
    setOperationTodoSaveError('')
    if (!todoDialogOperation) return
    const operationId = todoDialogOperation.id
    const relatedTodoIds = [...todoDialogRelatedTodoIds]
    const relatedTodoNotes = Object.fromEntries(relatedTodoIds.flatMap((id) => {
      const note = todoDialogRelatedTodoNotes[id]
      return note?.trim() ? [[id, note]] : []
    }))
    const changes = todos.filter((todo) => typeof todoDialogTodoDoneMap[todo.id] === 'boolean' && todo.done !== todoDialogTodoDoneMap[todo.id])
      .map((todo) => ({ id: todo.id, title: todo.title, done: todoDialogTodoDoneMap[todo.id] }))
    const completions = changes.filter((todo) => todo.done)
    const action = createResumableAction([
      () => onUpdateOperation(operationId, { relatedTodoIds, relatedTodoNotes }, completions.length > 0),
      ...changes.map((todo) => () => onUpdateTodo(todo.id, { done: todo.done })),
    ])
    const save = async () => {
      setBusyAction(`operation-todo-link-${operationId}`)
      try {
        if (!await action.run()) throw new Error('操作未完成，请检查后重试。')
        setOperationTodoDialogOpen(false)
        clearOperationTodoDialogState()
        return true
      } catch (error) {
        if (error instanceof Error && action.completed > 0) {
          error.message = `关联记录已保存，已更新 ${action.completed - 1}/${changes.length} 条待办。${error.message}`
        }
        throw error
      } finally { setBusyAction('') }
    }
    if (completions.length) {
      await confirmAction({
        title: `完成 ${completions.length} 条关联待办？`,
        description: `${completions.map((todo) => `• ${todo.title}`).join('\n')}\n关联关系和备注将一并保存。完成的待办可在项目的已完成列表查看。若部分保存失败，重试只提交未完成的步骤。`,
        confirmLabel: '保存并完成待办', variant: 'default',
      }, save)
    } else {
      try { await save() } catch (error) { setOperationTodoSaveError(error instanceof Error ? error.message : '保存失败，请重试。') }
    }
  }

  function toggleTodoDialogDone(todoId: number) {
    setTodoDialogTodoDoneMap((current) => ({
      ...current,
      [todoId]: !current[todoId],
    }))
  }

  async function saveEvent(action: 'publish' | 'save_draft') {
    const assigneeUserId = Number(eventAssigneeUserId)
    if (!canManageProject || !eventBasicInformationValid || !eventArtifactsValid || !eventCreateContentValid) {
      if (!eventArtifactsValid) setEventEditorStep(2)
      if (!eventCreateContentValid) setEventEditorStep(2)
      return
    }
    if (action === 'publish' && !eventPublishValid) {
      if (!Number.isInteger(assigneeUserId) || assigneeUserId <= 0 || !memberOptions.some((member) => member.id === assigneeUserId)) {
        setEventEditorStep(1)
      } else if (!eventDocumentValid) {
        setEventEditorStep(3)
      }
      return
    }
    setBusyAction('event')
    try {
      const savedEvent = await onSaveEvent(eventEditorEventId, {
        action,
        assigneeUserId: assigneeUserId || null,
        containerImages: containerImages.map((item) => ({
          image: item.image.trim(),
          runtimeConfig: item.runtimeConfig,
        })),
        deliveryDate: dateTimeLocalDateStamp(eventDeliveryEndAt),
        deliveryEndAt: eventDeliveryEndAt,
        deliveryStartAt: eventDeliveryStartAt,
        documents: [{
          content: eventDocumentContent,
          relatedTodoIds: [],
          scope: 'event',
          title: eventDocumentTitle.trim() || `${eventTitle.trim()} 变更记录`,
        }],
        items: cartItems,
        offlinePackages: offlinePackages.map((item) => ({
          runtimeConfig: item.runtimeConfig,
          url: item.url.trim(),
        })),
        other: deliveryScripts[0] ? { content: deliveryScripts[0].content, type: 'shell-script' } : null,
        deliveryScripts,
        deliverySteps,
        title: eventTitle.trim(),
        type: eventType,
      })
      if (savedEvent) {
        setAssignedOnly(false)
        setEventFilterConditions([])
        setEventFilterJoin('and')
        setSelectedEventId(savedEvent.id)
        setSelectedGroupId(savedEvent.groups[0]?.id ?? null)
        setEventEditorOpen(false)
        setEventEditorDirty(false)
      }
    } finally {
      setBusyAction('')
    }
  }

  async function submitOperation() {
    if (!pendingOperationTarget) return
    setBusyAction('operation')
    try {
      const trimmedTitle = operationTitle.trim()
      const trimmedContent = operationContent.trim()
      const saved = pendingOperationTarget.operation
        ? await onUpdateOperation(
          pendingOperationTarget.operation.id,
          operationKind === 'document'
            ? {
                title: trimmedTitle,
                content: trimmedContent,
              }
            : {
                label: trimmedTitle,
                ...(trimmedContent ? { content: trimmedContent } : {}),
              },
        )
        : await onCreateOperation({
          eventId: pendingOperationTarget.eventId,
          groupId: pendingOperationTarget.groupId ?? null,
          kind: operationKind,
          ...(operationKind === 'document'
            ? {
                title: trimmedTitle,
                content: trimmedContent,
              }
            : {
                label: trimmedTitle,
                ...(trimmedContent ? { content: trimmedContent } : {}),
              }),
        })
      if (!saved) return
      setOperationDialogOpen(false)
      setPendingOperationTarget(null)
    } finally {
      setBusyAction('')
    }
  }

  async function submitCart() {
    setMarketOpen(false)
    setEventEditorDirty(true)
  }

  function openExportScopeDialog() {
    setExportScope(selectedEvent ? 'current' : 'all')
    setExportScopeDialogOpen(true)
  }

  async function handleExport(scope: TimelineExportScope) {
    const eventId = scope === 'current' ? selectedEvent?.id : undefined
    if (scope === 'current' && eventId == null) return
    setExportScopeDialogOpen(false)
    setBusyAction('export')
    try {
      const result = await onExportTimeline(eventId)
      setExportEditorReady(false)
      setExportFileName(result.fileName)
      setExportContent(result.markdown)
      setExportPreviewOpen(true)
    } finally {
      setBusyAction('')
    }
  }

  function renderMarketLinkCard(
    detail: PackageMarketDetail,
    context: PackageMarketDetailContext | null,
    link: PackageMarketDetail['links'][number],
  ) {
    const fileName = link.objectKey.split('/').filter(Boolean).at(-1) || link.name
    const canDownload = Boolean(link.downloadUrl)
    const alreadyAdded = selectedEventAddedObjectKeys.has(link.objectKey)
    return (
      <article className="package-market-link-card" key={`${context?.packageId ?? detail.title}-${link.objectKey}-${link.version}`}>
        <div className="package-market-link-head">
          <div className="package-market-link-meta">
            <strong>{fileName}</strong>
            {link.size ? <small>{formatBytes(link.size)}</small> : null}
          </div>
          <div className="package-market-link-actions">
            {canDownload ? <Button
              className="ghost-button"
              variant="outline"
              type="button"
              onClick={() =>
                void copyToClipboard(
                  link.downloadUrl,
                  `copy-download-url-${link.objectKey}`,
                )
              }
            >
              <Copy size={15} /> {copiedLabel(`copy-download-url-${link.objectKey}`, '链接')}
            </Button> : null}
            {canDownload ? <Button
              className="ghost-button"
              variant="outline"
              type="button"
              onClick={() =>
                void copyToClipboard(
                  createWgetDownloadCommand(link.downloadUrl, fileName),
                  `copy-download-command-${link.objectKey}`,
                )
              }
            >
              <TerminalWindow size={15} /> {copiedLabel(`copy-download-command-${link.objectKey}`, '命令')}
            </Button> : null}
            <Button
              className="solid-button"
              type="button"
              disabled={!context || !canDownload || alreadyAdded}
              onClick={() => addMarketLinkToCart(context, detail, link)}
            >
              <Package size={16} /> {alreadyAdded ? '已添加' : '添加'}
            </Button>
          </div>
        </div>
        <code>{link.objectKey}</code>
        <div className="package-market-link-footer">
          <a href={link.downloadUrl} target="_blank" rel="noreferrer">
            查看临时链接
          </a>
          <Button
            className="ghost-button"
            variant="outline"
            type="button"
            onClick={() =>
              void copyToClipboard(link.objectKey, `copy-object-key-${link.objectKey}`)
            }
          >
            <Copy size={15} /> {copiedLabel(`copy-object-key-${link.objectKey}`, 'Key')}
          </Button>
        </div>
      </article>
    )
  }

  useImperativeHandle(ref, () => ({
    exportTimeline: () => {
      openExportScopeDialog()
    },
    selectEvent: (eventId: number) => {
      const targetEvent = events.find((event) => event.id === eventId)
      setAssignedOnly(false)
      setEventFilterConditions([])
      setEventFilterJoin('and')
      setSelectedEventId(eventId)
      setEventDetailTab('overview')
      setSelectedGroupId(targetEvent?.groups[0]?.id ?? null)
      setEventDetailOpen(true)
      setEventEditorOpen(false)
      setEventEditorDirty(false)
    },
  }))

  function confirmExport() {
    downloadMarkdownFile(exportFileName, exportContent)
    setExportPreviewOpen(false)
  }

  function renderDeliveryArtifacts() {
    if (deliveryArtifactsLoading) return <section className="delivery-artifacts-panel" aria-live="polite"><p>正在准备交付链接和命令...</p></section>
    if (deliveryArtifactsError) return <section className="delivery-artifacts-panel"><p className="delivery-artifact-error" role="alert">{deliveryArtifactsError}</p></section>
    if (!deliveryArtifacts || deliveryArtifacts.processes.length === 0) {
      return <section className="delivery-empty-state"><strong>暂无交付内容</strong><span>该事件没有可展示的交付流程。</span></section>
    }
    const kindLabel = { 'container-image': '集群镜像', package: '对象存储', 'offline-package': '离线包', 'shell-script': 'Shell 脚本' } as const
    return (
      <section className="delivery-artifacts-panel">
        <div className="delivery-artifacts-heading">
          <div><h4>交付项</h4><p>按计划顺序执行，重复引用会独立记录结果。</p></div>
          <Label>对象存储有效期
            <Select value={String(deliveryArtifactsExpireMinutes)} onValueChange={(value) => setDeliveryArtifactsExpireMinutes(Number(value) as 30 | 60 | 120)}>
              <SelectTrigger aria-label="对象存储下载地址有效期"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="30">30 分钟</SelectItem><SelectItem value="60">1 小时</SelectItem><SelectItem value="120">2 小时</SelectItem></SelectContent>
            </Select>
          </Label>
        </div>
        <div className="delivery-process-list">
          {deliveryArtifacts.processes.map((process, index) => {
            const addressKey = `delivery-address-${process.stepId}`
            const onlineCommandKey = `delivery-online-command-${process.stepId}`
            const offlineCommandKey = `delivery-offline-command-${process.stepId}`
            const copyKey = `delivery-copy-${process.stepId}`
            const isDownloadable = process.kind === 'package' || process.kind === 'offline-package'
            const hasValuesPatch = Boolean(process.runtimeConfig?.valuesPath && process.runtimeConfig.valuesPatch)
            const step = selectedEvent?.deliverySteps.find((candidate) => candidate.id === process.stepId)
            return <article className="delivery-process-item" key={process.stepId}>
              <div className="delivery-process-title">
                <span>{index + 1}</span>
                <div><strong>{process.processName}</strong><small>{kindLabel[process.kind]}</small></div>
                {step?.result && step.result !== 'pending' ? <span className={`delivery-step-result ${step.result}`}>{step.result === 'success' ? '成功' : step.result === 'failed' ? '失败' : '未执行'}</span> : null}
              </div>
              <div className="delivery-process-actions">
                {isDownloadable && process.address ? <>
                  <Button size="sm" type="button" variant="outline" onClick={() => void copyToClipboard(process.address?.value ?? '', addressKey)}><Copy size={14} />{copiedValue === addressKey ? '已复制链接' : '链接'}</Button>
                  <Button disabled={!process.onlineCommand} size="sm" type="button" variant="outline" onClick={() => void copyToClipboard(process.onlineCommand ?? '', onlineCommandKey)}><TerminalWindow size={14} />{copiedValue === onlineCommandKey ? '已复制在线命令' : '在线命令'}</Button>
                  <Button disabled={!process.offlineCommand} size="sm" type="button" variant="outline" onClick={() => void copyToClipboard(process.offlineCommand ?? '', offlineCommandKey)}><TerminalWindow size={14} />{copiedValue === offlineCommandKey ? '已复制离线命令' : '离线命令'}</Button>
                </> : <Button size="sm" type="button" variant="outline" onClick={() => void copyToClipboard(process.content, copyKey)}><Copy size={14} />{copiedValue === copyKey ? '已复制' : '复制'}</Button>}
                {hasValuesPatch ? <>
                  <Button size="sm" type="button" variant="outline" onClick={() => setValuesPreviewStepId(process.stepId)}><Eye size={14} />预览 Values 修改</Button>
                </> : null}
                {process.address?.expiresAt ? <small>链接有效至 {process.address.expiresAt}</small> : null}
              </div>
            </article>
          })}
        </div>
        <aside className="delivery-command-requirements" role="note">
          <strong>执行前请确认命令依赖</strong>
          <p>所有交付项需要 <code>sealos</code>；在线命令还需要 <code>wget</code>。配置 Values 修改时，还需要 <code>yq v4</code>、<code>flock</code>、<code>realpath</code>、<code>base64</code> 和 <code>mktemp</code>，并建议使用 Bash 执行。</p>
        </aside>
        {(() => {
          const previewProcess = deliveryArtifacts.processes.find((process) => process.stepId === valuesPreviewStepId)
          const previewConfig = previewProcess?.runtimeConfig
          const previewScript = previewProcess?.onlineCommand ?? previewProcess?.content ?? ''
          const previewScriptKey = valuesPreviewStepId ? `delivery-values-script-${valuesPreviewStepId}` : 'delivery-values-script'
          return <Dialog open={Boolean(previewProcess && previewConfig?.valuesPath && previewConfig.valuesPatch)} onOpenChange={(open) => { if (!open) setValuesPreviewStepId(null) }}>
            <DialogContent className="delivery-values-preview-dialog">
              <DialogHeader>
                <DialogTitle>预览 Values 修改</DialogTitle>
                <DialogDescription>{previewProcess ? `${previewProcess.processName} · 只读预览，执行时会临时合并并在结束后恢复原文件。` : ''}</DialogDescription>
              </DialogHeader>
              {previewConfig ? <div className="delivery-values-preview-body">
                <section className="delivery-values-preview-section">
                  <span>Values 文件路径</span>
                  <code>{previewConfig.valuesPath}</code>
                </section>
                <section className="delivery-values-preview-section">
                  <span>Values 修改内容</span>
                  <pre>{previewConfig.valuesPatch}</pre>
                </section>
                <section className="delivery-values-preview-section">
                  <div className="delivery-values-preview-script-heading"><span>执行脚本</span><Button disabled={!previewScript} size="sm" type="button" variant="outline" onClick={() => void copyToClipboard(previewScript, previewScriptKey)}><Copy size={14} />{copiedValue === previewScriptKey ? '已复制执行脚本' : '复制执行脚本'}</Button></div>
                  <pre>{previewScript || '暂无可复制的执行脚本'}</pre>
                </section>
              </div> : null}
              <DialogFooter><Button type="button" variant="outline" onClick={() => setValuesPreviewStepId(null)}>关闭</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        })()}
      </section>
    )
  }

  function renderEventEditor() {
    return (
      <section className="event-wizard" aria-label="交付事件编辑器">
        <header className="event-wizard-header">
          <Button className="event-wizard-return" type="button" variant="ghost" onClick={() => void returnToEventList()}>
            <CaretLeft size={16} /> 返回事件列表
          </Button>
          <div className="event-wizard-heading">
            <span className="event-wizard-eyebrow">
              {eventEditorEventId == null ? '新建交付事件' : selectedEvent?.status === 'rejected' ? '调整被拒绝的交付事件' : '编辑事件草稿'}
            </span>
            <h3>{eventTitle.trim() || '未命名事件'}</h3>
          </div>
        </header>
        <div className="event-wizard-main">
          <div className="event-wizard-steps-row">
            <nav className="event-wizard-steps" aria-label="事件创建步骤">
              {([
                { label: '基本信息', step: 1 as const },
                { label: '交付内容', step: 2 as const },
                { label: '变更记录', step: 3 as const },
              ]).map((item) => (
                <div className={item.step === 3 ? 'event-wizard-step-group documents' : 'event-wizard-step-group'} key={item.step}>
                  <button
                    aria-current={eventEditorStep === item.step ? 'step' : undefined}
                    className={[
                      'event-wizard-step',
                      item.step <= eventEditorStep ? 'reached' : '',
                      eventEditorStep === item.step ? 'active' : '',
                    ].filter(Boolean).join(' ')}
                    disabled={item.step > 1 && !eventBasicInformationValid}
                    onClick={() => {
                      setEventEditorStep(item.step)
                      if (item.step === 3) setEventEditorReady(false)
                    }}
                    type="button"
                  >
                    <span>{item.step}</span>
                    {item.label}
                  </button>
                  {item.step === 3 && eventEditorStep === 3 ? (
                    <div className="event-wizard-document-nav" role="tablist" aria-label="变更记录">
                      <button
                        aria-controls={`${documentTabsId}-panel`}
                        aria-selected={resolvedDocumentScope === 'event'}
                        className={resolvedDocumentScope === 'event' ? 'active' : ''}
                        id={`${documentTabsId}-event-tab`}
                        onKeyDown={(event) => handleDocumentTabKeyDown(event, 'event')}
                        onClick={() => selectDocumentScope('event')}
                        role="tab"
                        tabIndex={resolvedDocumentScope === 'event' ? 0 : -1}
                        type="button"
                      >
                        变更记录
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </nav>
          </div>

          <div className="event-wizard-content">
          {selectedEvent?.status === 'rejected' && selectedEvent.latestRejectionReason ? (
            <section className="event-rejection-notice" role="status">
              <div><strong>拒绝理由</strong><span>{[selectedEvent.latestRejectedByName, selectedEvent.latestRejectedAt].filter(Boolean).join(' · ')}</span></div>
              <p>{selectedEvent.latestRejectionReason}</p>
            </section>
          ) : null}
          {eventEditorStep === 1 ? (
            <div className="event-wizard-form-grid">
              <Label>
                <span>事件类型 <span className="field-required" aria-hidden="true">*</span></span>
                <Select
                  value={eventType}
                  onValueChange={(value) => {
                    setEventType(value as ProjectPackageEventType)
                    setEventEditorDirty(true)
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="选择事件类型" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="init">初始化安装</SelectItem>
                    <SelectItem value="upgrade">升级</SelectItem>
                  </SelectContent>
                </Select>
              </Label>
              <Label>
                <span>事件标题 <span className="field-required" aria-hidden="true">*</span></span>
                <Input
                  value={eventTitle}
                  onChange={(event) => {
                    setEventTitle(event.target.value)
                    setEventEditorDirty(true)
                  }}
                  placeholder="例如：控制台升级到 v5.1.2"
                />
              </Label>
              <div className="event-wizard-date-fields">
                <Label>
                  <span>交付开始日期 <span className="field-required" aria-hidden="true">*</span></span>
                  <JournalDatePicker
                    ariaLabel="交付开始日期"
                    datesWithEntries={[]}
                    displayValue={dateTimeLocalDateStamp(eventDeliveryStartAt).replaceAll('-', '/')}
                    value={dateTimeLocalDateStamp(eventDeliveryStartAt)}
                    onChange={(date) => {
                      setEventDeliveryStartAt(`${date}T00:00`)
                      setEventEditorDirty(true)
                    }}
                  />
                </Label>
                <Label>
                  <span>预期交付完成日期 <span className="field-required" aria-hidden="true">*</span></span>
                  <JournalDatePicker
                    ariaLabel="预期交付完成日期"
                    datesWithEntries={[]}
                    displayValue={dateTimeLocalDateStamp(eventDeliveryEndAt).replaceAll('-', '/')}
                    value={dateTimeLocalDateStamp(eventDeliveryEndAt)}
                    onChange={(date) => {
                      setEventDeliveryEndAt(`${date}T23:59`)
                      setEventEditorDirty(true)
                    }}
                  />
                </Label>
              </div>
              <Label>
                <span>执行负责人 <span className="field-required" aria-hidden="true">*</span><small> 发布必填</small></span>
                <Select
                  value={eventAssigneeUserId || 'unassigned'}
                  onValueChange={(value) => {
                    setEventAssigneeUserId(value === 'unassigned' ? '' : value)
                    setEventEditorDirty(true)
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="选择执行负责人" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">暂不指派（发布前必选）</SelectItem>
                    {memberOptions.map((member) => (
                      <SelectItem key={member.id} value={String(member.id)}>{member.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>
            </div>
          ) : null}

          {eventEditorStep === 2 ? (
            <div className="event-wizard-packages">
              <div className="event-wizard-section-head">
                <div>
                  <h4>交付内容</h4>
                  <p>可同时提供对象存储安装包、离线包地址和集群镜像。</p>
                </div>
                {packageMarketSelectionAvailable ? (
                  <Button className="solid-button" type="button" onClick={openPackageMarket}>
                    <ShoppingCartSimple size={16} /> 从安装包市场选择
                  </Button>
                ) : null}
              </div>
              <div className="delivery-artifact-editor-heading"><strong>对象存储安装包</strong><span>{cartItems.length} 项</span></div>
              {cartItems.length > 0 ? (
                <div className="event-wizard-package-list">
                  {cartItems.map((item) => (
                    <div className="event-wizard-package-row" key={item.objectKey}>
                      <div className="delivery-artifact-draft-summary">
                        <strong>{packageItemFileName(item)}</strong>
                        <span>{item.packageName} · {itemChannelLabel(item)} · {item.arch} · {item.version}</span>
                      </div>
                      <button
                        aria-label={`移除安装包 ${packageItemFileName(item)}`}
                        className="icon-button event-wizard-remove-button"
                        onClick={() => removeDraftPackageItem(item.objectKey)}
                        type="button"
                      >
                        <Trash size={15} />
                      </button>
                      <DeliveryRuntimeConfigEditor
                        config={item.runtimeConfig}
                        label={`安装包 ${packageItemFileName(item)}`}
                        onChange={(runtimeConfig) => {
                          setCartItems((current) => current.map((candidate) => candidate.objectKey === item.objectKey ? { ...candidate, runtimeConfig } : candidate))
                          setEventEditorDirty(true)
                        }}
                      />
                    </div>
                  ))}
                </div>
              ) : null}
              <section className="delivery-artifact-editor-section">
                <div className="delivery-artifact-editor-heading"><strong>集群镜像</strong><span>{containerImages.length} / {maxDeliveryArtifactEntries}</span></div>
                {containerImages.map((item, index) => (
                  <div className="delivery-artifact-editor-row" key={`container-image-${index}`}>
                    <div className="delivery-artifact-editor-primary-row">
                      <Input
                        aria-label={`集群镜像地址 ${index + 1}`}
                        autoCapitalize="none"
                        autoComplete="off"
                        maxLength={512}
                        placeholder="例如：ghcr.io/example/admin:v2.1.0"
                        spellCheck={false}
                        value={item.image}
                        onChange={(event) => {
                          setContainerImages((current) => current.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, image: event.target.value } : candidate))
                          setEventEditorDirty(true)
                        }}
                      />
                      <Button aria-label={`移除集群镜像 ${index + 1}`} size="icon" type="button" variant="ghost" onClick={() => { setContainerImages((current) => current.filter((_, itemIndex) => itemIndex !== index)); setEventEditorDirty(true) }}><Trash size={15} /></Button>
                    </div>
                    <DeliveryRuntimeConfigEditor config={item.runtimeConfig} label={`集群镜像 ${index + 1}`} onChange={(runtimeConfig) => { setContainerImages((current) => current.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, runtimeConfig } : candidate)); setEventEditorDirty(true) }} />
                    {containerImageValidation[index] ? <p className="delivery-artifact-error" role="alert">{containerImageValidation[index]}</p> : null}
                  </div>
                ))}
                <Button disabled={containerImages.length >= maxDeliveryArtifactEntries} type="button" variant="outline" onClick={() => { setContainerImages((current) => [...current, { image: '', runtimeConfig: emptyDeliveryRuntimeConfig() }]); setEventEditorDirty(true) }}><Plus size={15} /> 添加镜像</Button>
              </section>
              <section className="delivery-artifact-editor-section">
                <div className="delivery-artifact-editor-heading"><strong>离线包地址</strong><span>{offlinePackages.length} / {maxDeliveryArtifactEntries}</span></div>
                {offlinePackages.map((item, index) => (
                  <div className="delivery-artifact-editor-row" key={`offline-package-${index}`}>
                    <div className="delivery-artifact-editor-primary-row">
                      <Input
                        aria-label={`离线包地址 ${index + 1}`}
                        autoComplete="off"
                        maxLength={4096}
                        placeholder="https://downloads.example.com/releases/app.tar"
                        value={item.url}
                        onChange={(event) => {
                          setOfflinePackages((current) => current.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, url: event.target.value } : candidate))
                          setEventEditorDirty(true)
                        }}
                      />
                      <Button aria-label={`移除离线包地址 ${index + 1}`} size="icon" type="button" variant="ghost" onClick={() => { setOfflinePackages((current) => current.filter((_, itemIndex) => itemIndex !== index)); setEventEditorDirty(true) }}><Trash size={15} /></Button>
                    </div>
                    <DeliveryRuntimeConfigEditor config={item.runtimeConfig} label={`离线包 ${index + 1}`} onChange={(runtimeConfig) => { setOfflinePackages((current) => current.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, runtimeConfig } : candidate)); setEventEditorDirty(true) }} />
                    {offlinePackageValidation[index] ? <p className="delivery-artifact-error" role="alert">{offlinePackageValidation[index]}</p> : null}
                  </div>
                ))}
                <Button disabled={offlinePackages.length >= maxDeliveryArtifactEntries} type="button" variant="outline" onClick={() => { setOfflinePackages((current) => [...current, { runtimeConfig: emptyDeliveryRuntimeConfig(), url: '' }]); setEventEditorDirty(true) }}><Plus size={15} /> 添加离线包</Button>
              </section>
              <section className="delivery-artifact-editor-section">
                <div className="delivery-artifact-editor-heading"><strong>Shell 脚本</strong><span>{deliveryScripts.length} 项</span></div>
                <p className="delivery-artifact-note">脚本只有加入交付流程后才参与执行，可被多个流程重复引用。</p>
                {deliveryScripts.map((script, index) => (
                  <div className="delivery-script-editor" key={script.id}>
                    <div className="delivery-artifact-editor-primary-row">
                      <Input aria-label={`Shell 脚本 ${index + 1} 名称`} maxLength={120} placeholder="脚本名称" value={script.title} onChange={(event) => { setDeliveryScripts((current) => current.map((item) => item.id === script.id ? { ...item, title: event.target.value } : item)); setEventEditorDirty(true) }} />
                      <Button aria-label={`移除 Shell 脚本 ${script.title || index + 1}`} size="icon" type="button" variant="ghost" onClick={() => { setDeliveryScripts((current) => current.filter((item) => item.id !== script.id)); setDeliverySteps((current) => current.filter((step) => !(step.kind === 'shell-script' && step.reference === script.id))); setEventEditorDirty(true) }}><Trash size={15} /></Button>
                    </div>
                    <Textarea aria-label={`Shell 脚本 ${script.title || index + 1} 内容`} maxLength={maxDeliveryOtherScriptLength} placeholder="输入 Shell 脚本，例如：set -eu" value={script.content} onChange={(event) => { setDeliveryScripts((current) => current.map((item) => item.id === script.id ? { ...item, content: event.target.value } : item)); setEventEditorDirty(true) }} />
                    {!otherValidation[index]?.valid ? <p className="delivery-artifact-error" role="alert">{otherValidation[index].error}</p> : null}
                  </div>
                ))}
                <Button disabled={deliveryScripts.length >= maxDeliveryArtifactEntries} type="button" variant="outline" onClick={() => { setDeliveryScripts((current) => [...current, { id: newDeliveryId('script'), title: '', content: '' }]); setEventEditorDirty(true) }}><Plus size={15} /> 添加 Shell 脚本</Button>
              </section>
              <section className="delivery-artifact-editor-section">
                <div className="delivery-artifact-editor-heading"><strong>交付流程</strong><span>{deliverySteps.length} 步</span></div>
                <p className="delivery-artifact-note">流程名称会写入生成脚本的注释；同一交付物或脚本可以重复加入。</p>
                {deliverySteps.map((step, index) => {
                  const resource = deliveryStepResources.find((item) => item.kind === step.kind && item.reference === step.reference)
                  return <div className="delivery-step-editor" key={step.id}>
                    <span className="delivery-step-position">{index + 1}</span>
                    <Input aria-label={`流程 ${index + 1} 名称`} maxLength={120} placeholder="流程名称" value={step.processName} onChange={(event) => { setDeliverySteps((current) => current.map((item) => item.id === step.id ? { ...item, processName: event.target.value } : item)); setEventEditorDirty(true) }} />
                    <span className="delivery-step-resource">{resource?.label ?? '交付内容已移除'}</span>
                    <div className="delivery-step-actions">
                      <Button aria-label={`上移流程 ${index + 1}`} disabled={index === 0} size="icon" type="button" variant="ghost" onClick={() => moveDeliveryStep(index, -1)}><CaretUp size={15} /></Button>
                      <Button aria-label={`下移流程 ${index + 1}`} disabled={index === deliverySteps.length - 1} size="icon" type="button" variant="ghost" onClick={() => moveDeliveryStep(index, 1)}><CaretDown size={15} /></Button>
                      <Button aria-label={`删除流程 ${index + 1}`} size="icon" type="button" variant="ghost" onClick={() => { setDeliverySteps((current) => current.filter((item) => item.id !== step.id)); setEventEditorDirty(true) }}><Trash size={15} /></Button>
                    </div>
                  </div>
                })}
                <Select disabled={deliverySteps.length >= 100} key={`delivery-step-picker-${deliverySteps.length}`} onValueChange={addDeliveryStep}>
                  <SelectTrigger aria-label="添加交付流程"><SelectValue placeholder="选择交付内容并添加流程" /></SelectTrigger>
                  <SelectContent>{deliveryStepResources.map((resource) => <SelectItem key={`${resource.kind}:${resource.reference}`} value={`${resource.kind}:${resource.reference}`}>{resource.label}</SelectItem>)}</SelectContent>
                </Select>
              </section>
              {!eventCreateContentValid ? <p className="delivery-artifact-error" role="alert">至少添加一种交付内容后才能创建交付事件。</p> : null}
            </div>
          ) : null}

          {eventEditorStep === 3 ? (
            <div
              aria-labelledby={`${documentTabsId}-event-tab`}
              className="event-wizard-documents"
              id={`${documentTabsId}-panel`}
              role="tabpanel"
            >
              <Label className="event-document-title-field">
                <span>文档标题 <span className="field-required" aria-hidden="true">*</span><small> 发布必填</small></span>
                <Input
                  value={activePackageDocument ? activePackageDocument.title : eventDocumentTitle}
                  onChange={(event) => {
                    if (activePackageDocumentName) {
                      updatePackageDocument(activePackageDocumentName, { title: event.target.value })
                    } else {
                      setEventDocumentTitle(event.target.value)
                      setEventEditorDirty(true)
                    }
                  }}
                />
              </Label>
              <div className="event-document-todo-link" hidden>
                <div className="event-document-todo-link-copy">
                  <div>
                    <strong>关联待办</strong>
                    <span>可选</span>
                  </div>
                  <p>关联结果仅应用于当前文档。</p>
                </div>
                <DropdownMenu open={documentTodoPickerOpen} onOpenChange={setDocumentTodoPickerOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      className="operation-todo-picker-trigger event-document-todo-trigger"
                      disabled={selectableTodos.length === 0}
                      type="button"
                      variant="outline"
                    >
                      <LinkSimple size={15} />
                      <span className="operation-todo-picker-trigger-content">
                        {activeDocumentRelatedTodos.length === 0 ? (
                          <span className="operation-todo-picker-placeholder">
                            {selectableTodos.length === 0 ? '暂无可关联待办' : '选择关联待办'}
                          </span>
                        ) : (
                          <span className="operation-todo-picker-tags">
                            {activeDocumentRelatedTodos.slice(0, 2).map((todo) => (
                              <span className="operation-todo-picker-tag" key={todo.id}>
                                {todo.title}
                              </span>
                            ))}
                            {activeDocumentRelatedTodos.length > 2 ? (
                              <span className="operation-todo-picker-tag">
                                +{activeDocumentRelatedTodos.length - 2}
                              </span>
                            ) : null}
                          </span>
                        )}
                      </span>
                      <CaretDown
                        className={documentTodoPickerOpen ? 'operation-todo-picker-caret open' : 'operation-todo-picker-caret'}
                        size={14}
                        weight="bold"
                      />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="operation-todo-picker-content event-document-todo-menu"
                    collisionPadding={20}
                    onCloseAutoFocus={(event) => event.preventDefault()}
                    sideOffset={8}
                  >
                    <div className="operation-todo-picker-search-row">
                      <Input
                        value={documentTodoSearch}
                        onChange={(event) => setDocumentTodoSearch(event.target.value)}
                        onKeyDown={(event) => event.stopPropagation()}
                        placeholder="搜索待办标题、负责人或模块"
                      />
                      <Button
                        className={
                          activeDocumentTodoFilterCount > 0
                            ? 'todo-filter-open-button operation-todo-filter-open-button active'
                            : 'todo-filter-open-button operation-todo-filter-open-button'
                        }
                        variant="outline"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setDocumentTodoFilterDialogOpen(true)
                        }}
                      >
                        <FunnelSimple size={14} />
                        <span>{documentTodoFilterSummary}</span>
                      </Button>
                    </div>
                    <TodoFilterBuilderDialog
                      assigneeOptions={todoDialogAssigneeOptions}
                      conditions={documentTodoFilterConditions}
                      creatorOptions={todoDialogCreatorOptions}
                      join={documentTodoFilterJoin}
                      moduleOptions={todoDialogModuleOptions}
                      watcherOptions={todoDialogWatcherOptions}
                      open={documentTodoFilterDialogOpen}
                      onOpenChange={setDocumentTodoFilterDialogOpen}
                      onApply={({ conditions: nextConditions, join: nextJoin }) => {
                        setDocumentTodoFilterConditions(nextConditions)
                        setDocumentTodoFilterJoin(nextJoin)
                      }}
                    />
                    <div className="operation-todo-picker-options">
                      {filteredDocumentTodos.length === 0 ? (
                        <p className="operation-empty">没有搜索到匹配的待办。</p>
                      ) : (
                        filteredDocumentTodos.map((todo) => {
                          const selected = activeDocumentRelatedTodoIdSet.has(todo.id)
                          return (
                            <button
                              className={selected ? 'operation-todo-picker-option selected' : 'operation-todo-picker-option'}
                              key={todo.id}
                              onClick={() => toggleActiveDocumentTodo(todo.id)}
                              type="button"
                            >
                              <span className="operation-todo-picker-option-check" aria-hidden="true" />
                              <span className="operation-todo-picker-option-text">
                                <strong>
                                  <span className="operation-todo-dialog-item-title">{todo.title}</span>
                                  {todo.moduleName ? (
                                    <Badge className="todo-module-badge">{todo.moduleName}</Badge>
                                  ) : null}
                                </strong>
                                <small>{todoDialogMeta(todo, todo.done)}</small>
                              </span>
                            </button>
                          )
                        })
                      )}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <MarkdownEditorLoadBoundary>
                <div className="event-document-content-label">文档内容 <span className="field-required" aria-hidden="true">*</span><small> 发布必填</small></div>
                <Suspense fallback={<div className="markdown-wysiwyg-loading" role="status">正在加载编辑器…</div>}>
                  <MarkdownWysiwygEditor
                    ariaLabel="变更记录内容"
                    key={`event-wizard-${resolvedDocumentScope}`}
                    onChange={(value) => {
                      if (activePackageDocumentName) {
                        updatePackageDocument(activePackageDocumentName, { content: value })
                      } else {
                        setEventDocumentContent(value)
                        setEventEditorDirty(true)
                      }
                    }}
                    onReady={() => setEventEditorReady(true)}
                    placeholder="输入交付步骤、命令或说明…"
                    value={activePackageDocument ? activePackageDocument.content : eventDocumentContent}
                  />
                </Suspense>
              </MarkdownEditorLoadBoundary>
            </div>
          ) : null}
          </div>
        </div>

        <footer className="event-wizard-footer">
          <div className="event-wizard-footer-actions">
            <div className="event-wizard-navigation">
              <Button
                disabled={eventEditorStep === 1}
                onClick={() => setEventEditorStep((eventEditorStep - 1) as 1 | 2)}
                type="button"
                variant="outline"
              >
                上一步
              </Button>
              <Button
                disabled={eventEditorStep === 3 || !eventBasicInformationValid}
                onClick={() => setEventEditorStep((eventEditorStep + 1) as 2 | 3)}
                type="button"
                variant="outline"
              >
                下一步
              </Button>
            </div>
            <div className="event-wizard-save-actions">
              <Button type="button" variant="ghost" disabled={busyAction === 'event'} onClick={() => void returnToEventList()}>
                取消
              </Button>
              <Button
                disabled={!canManageProject || !eventBasicInformationValid || !eventArtifactsValid || !eventCreateContentValid || busyAction === 'event'}
                onClick={() => void saveEvent('save_draft')}
                type="button"
                variant="outline"
              >
                保存草稿
              </Button>
              <Button
                className="solid-button"
                disabled={!eventPublishValid || busyAction === 'event'}
                onClick={() => void saveEvent('publish')}
                type="button"
              >
                {selectedEvent?.status === 'rejected' ? '调整并重新提交' : '发布并指派'}
              </Button>
            </div>
          </div>
        </footer>
      </section>
    )
  }

  return (
    <div className="package-workbench">
      {confirmationDialog}
      <div className="delivery-workbench-shell">
        {eventEditorOpen ? renderEventEditor() : (
          <>
          <section className="project-events-panel delivery-event-list-panel">
            <div className="delivery-workbench-heading">
              <div>
                <span className="delivery-workbench-eyebrow">项目交付</span>
                <h2>交付工作台</h2>
                <p>管理当前项目的交付事件、安装包和执行记录。</p>
              </div>
              {canManageProject ? (
                <Button className="solid-button" type="button" onClick={openCreateEventEditor}>
                  <Plus size={17} /> 新增事件
                </Button>
              ) : null}
            </div>
            <div className="project-events-head">
              <div className="project-events-title-row">
                <h3>事件列表</h3>
                <Button
                  aria-label={activeEventFilterCount > 0
                    ? `筛选交付事件，已应用 ${activeEventFilterCount} 个条件`
                    : '筛选交付事件'}
                  aria-pressed={activeEventFilterCount > 0}
                  className={activeEventFilterCount > 0
                    ? 'project-events-filter-button active'
                    : 'project-events-filter-button'}
                  size="icon-sm"
                  title={activeEventFilterCount > 0
                    ? `已应用 ${activeEventFilterCount} 个筛选条件`
                    : '筛选交付事件'}
                  type="button"
                  variant="ghost"
                  onClick={() => setEventFilterDialogOpen(true)}
                >
                  <FunnelSimple size={14} />
                </Button>
              </div>
            </div>
            <div className="delivery-event-stats" aria-label="交付事件概览">
              <div><span>总事件</span><strong>{eventTotal}</strong></div>
              <div><span>本页事件</span><strong>{visibleEvents.length}</strong></div>
              <div><span>本页进行中</span><strong>{eventStats.active}</strong></div>
              <div><span>本页已完成</span><strong>{eventStats.completed}</strong></div>
              <div><span>本页我的</span><strong>{eventStats.mine}</strong></div>
            </div>
            <PackageEventFilterBuilderDialog
              assigneeOptions={memberOptions}
              conditions={eventFilterConditions}
              join={eventFilterJoin}
              open={eventFilterDialogOpen}
              onOpenChange={setEventFilterDialogOpen}
              onApply={({ conditions: nextConditions, join: nextJoin }) => {
                setEventFilterConditions(nextConditions)
                setEventFilterJoin(nextJoin)
              }}
            />
            <div className="project-events-controls-row">
              <label className="project-events-search">
                <MagnifyingGlass size={14} />
                <Input
                  aria-label="检索交付事件"
                  placeholder="检索标题、状态、类型或交付人"
                  value={eventSearch}
                  onChange={(event) => setEventSearch(event.target.value)}
                />
              </label>
              <label className="project-events-assigned-toggle">
                <input
                  type="checkbox"
                  checked={assignedOnly}
                  onChange={(event) => setAssignedOnly(event.target.checked)}
                />
                <span>只看我被指派的事件</span>
              </label>
              <label className="project-events-assigned-toggle">
                <input
                  type="checkbox"
                  checked={showDelivered}
                  onChange={(event) => setShowDelivered(event.target.checked)}
                />
                <span>显示已交付</span>
              </label>
              <Button
                aria-label={eventSortDirection === 'asc'
                  ? '当前按交付日期正序排列，点击切换为倒序'
                  : '当前按交付日期倒序排列，点击切换为正序'}
                className="project-events-sort-button"
                size="icon-sm"
                title={eventSortDirection === 'asc' ? '切换为时间倒序' : '切换为时间正序'}
                type="button"
                variant="ghost"
                onClick={() => setEventSortDirection((current) =>
                  current === 'asc' ? 'desc' : 'asc'
                )}
              >
                {eventSortDirection === 'asc' ? (
                  <SortAscending size={14} />
                ) : (
                  <SortDescending size={14} />
                )}
              </Button>
            </div>
            <div className="delivery-event-message-row">
              {timelineError ? <p className="project-events-error" role="alert">{timelineError}</p> : null}
            </div>
            <div className="delivery-event-table-viewport">
              <div className="project-event-table-head" aria-hidden="true">
                <span>事件</span><span>类型</span><span>状态</span><span>交付日期</span><span>交付延期</span><span>拒绝次数</span><span>执行负责人</span><span>最近更新</span><span aria-hidden="true" />
              </div>
              <div className="project-event-items project-event-table">
                {timelineLoading && visibleEvents.length === 0 ? (
                  <div className="delivery-event-skeletons" role="status" aria-label="正在加载交付事件">
                    {[1, 2, 3, 4].map((row) => <div className="delivery-event-skeleton" key={row} />)}
                  </div>
                ) : visibleEvents.length === 0 ? (
                  <div className="project-events-empty">
                    <strong>{activeEventFilterCount > 0 || eventSearch.trim() ? '没有匹配的交付事件' : assignedOnly ? '暂无指派给你的事件' : '暂无交付事件'}</strong>
                    <span>{activeEventFilterCount > 0 || eventSearch.trim() ? '调整检索或筛选条件后重试。' : assignedOnly ? '关闭“只看我被指派的事件”可查看全部事件。' : '创建事件后，可在这里查看交付日期、安装包和执行记录。'}</span>
                  </div>
                ) : pagedEvents.map((event) => (
                  <div
                    className={event.id === selectedEvent?.id ? 'project-event-item active' : 'project-event-item'}
                    key={event.id}
                  >
                    <button
                      className="project-event-tab-button project-event-row"
                      type="button"
                      aria-label={`查看交付事件 ${event.title}`}
                      onClick={() => selectEventFromList(event)}
                    >
                      <span className="project-event-cell project-event-title-cell"><strong>{event.title}</strong><small className="project-event-counts">操作 {event.operationCount ?? 0} · 反馈 {event.commentCount ?? 0}</small></span>
                      <span className="project-event-cell project-event-type-cell">{eventTypeLabel(event.type)}</span>
                      <span className="project-event-cell project-event-status-cell"><span className={`project-event-status-badge ${eventDisplayStatus(event)}`}>{event.deliveryResult === 'failed' ? '交付失败' : eventStatusLabel(eventDisplayStatus(event))}</span></span>
                      <span className="project-event-cell project-event-date-cell">{formatEventDeliveryDate(event)}</span>
                      <span className={`project-event-cell project-event-delay-cell ${event.deliveryDelayDays == null ? 'neutral' : event.deliveryDelayDays > 0 ? 'late' : event.deliveryDelayDays < 0 ? 'early' : 'neutral'}`}>{formatDeliveryDelay(event)}</span>
                      <span className="project-event-cell project-event-package-count" aria-label={`拒绝 ${event.rejectionCount ?? 0} 次`}>{event.rejectionCount ?? 0}</span>
                      <span className="project-event-cell project-event-assignee-cell"><UserName departedUserIds={timeline?.departedUserIds} name={event.assigneeName || '未指派'} userId={event.assigneeUserId} /></span>
                      <span className="project-event-cell project-event-updated-cell">{event.updatedAt}</span>
                    </button>
                    {event.capabilities?.canEditPlan ? (
                      <div className="project-event-item-actions">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className="icon-button project-menu-trigger project-event-menu-button"
                              type="button"
                              aria-label={`更多事件操作 ${event.title}`}
                            >
                              <DotsThree size={18} weight="bold" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="project-actions-menu-content" sideOffset={8}>
                            {!event.publishedAt || event.status === 'rejected' ? (
                              <DropdownMenuItem onSelect={() => void openDraftEventEditor(event)}>
                                {event.status === 'rejected' ? '调整并重新提交' : '继续编辑'}
                              </DropdownMenuItem>
                            ) : null}
                            <DeleteConfirmDialog
                              confirmLabel="删除事件"
                              description={`删除「${event.title}」后，这个交付事件下的安装包、记录和文档都会一起移除。`}
                              onConfirm={() => deleteEventFromList(event)}
                              title="确认删除这个交付事件？"
                              trigger={(
                                <DropdownMenuItem
                                  className="project-event-danger-menu-item"
                                  onSelect={(selectEvent) => selectEvent.preventDefault()}
                                  variant="destructive"
                                >
                                  删除事件
                                </DropdownMenuItem>
                              )}
                            />
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
            <ListPagination label="交付事件分页" page={eventPage} pageSize={eventPageSize} total={eventTotal} disabled={timelineLoading} onPageChange={setEventPage} onPageSizeChange={(size) => { setEventPage(0); setEventPageSize(size) }} />
          </section>

          <Dialog open={eventDetailOpen && Boolean(selectedEvent)} onOpenChange={setEventDetailOpen}>
            <DialogContent fixedHeader className="project-package-event-drawer">
              <DialogHeader className="delivery-drawer-header">
                <DialogTitle>{selectedEvent?.title ?? '交付事件详情'}</DialogTitle>
                <DialogDescription>{selectedEvent ? `${eventTypeLabel(selectedEvent.type)} · ${eventStatusLabel(eventDisplayStatus(selectedEvent))}` : '查看交付事件详情'}</DialogDescription>
              </DialogHeader>
              {selectedEvent && selectedEvent.detailsLoaded === false && !eventDetailsError ? (
                <section className="event-workspace event-details-loading" aria-live="polite"><div className="event-details-loading-bar" /><p>正在加载事件详情...</p></section>
              ) : eventDetailsError && selectedEvent ? (
                <section className="event-workspace event-details-error" role="alert"><h3>事件详情暂时无法显示</h3><p>{eventDetailsError}</p><Button type="button" variant="outline" onClick={() => setEventDetailsRetry((retry) => retry + 1)}>重新加载</Button></section>
              ) : selectedEvent ? (
                <Tabs className="delivery-detail-tabs" value={eventDetailTab} onValueChange={(value) => setEventDetailTab(value as 'overview' | 'delivery')}>
                  <TabsList className="delivery-detail-tab-list">
                    <TabsTrigger value="overview">基础信息与变更记录</TabsTrigger>
                    <TabsTrigger value="delivery">交付内容</TabsTrigger>
                  </TabsList>
                  <TabsContent className="delivery-detail-tab-content" value="overview">
                    <section className="delivery-overview-panel">
                      <div className="delivery-overview-actions">
                        <div><span className={`project-event-status-badge ${eventDisplayStatus(selectedEvent)}`}>{eventStatusLabel(eventDisplayStatus(selectedEvent))}</span><small>更新于 {selectedEvent.updatedAt}</small></div>
                        <div className="operation-actions">
                          {selectedEvent.capabilities.canEditPlan ? <Button type="button" variant="outline" onClick={() => void openDraftEventEditor(selectedEvent)}>{selectedEvent.status === 'rejected' ? '调整并重新提交' : '继续编辑'}</Button> : null}
                          {selectedEvent.publishedAt && selectedEvent.capabilities.canComment ? <Button className="package-feedback-button" type="button" variant="outline" onClick={() => setCommentsDrawerOpen(true)}><ChatCircleDots size={15} /> 交付反馈</Button> : null}
                          {selectedEvent.capabilities.canReassign ? <Button variant="outline" type="button" onClick={() => { setReassignEventId(reassignEventId === selectedEvent.id ? null : selectedEvent.id); setNextAssignee(''); setReassignReason('') }}>转交执行人</Button> : null}
                          {selectedEvent.capabilities.canComplete ? <Button className="solid-button" type="button" onClick={() => {
                            setDeliveryResult('success')
                            setDeliveryFailureReason('')
                            setDeliveryResultError('')
                            setDeliveryStepResults(Object.fromEntries(selectedEvent.deliverySteps.map((step) => [step.id, { result: 'success' as const }])))
                            setDeliveryResultDialogOpen(true)
                          }}><Check size={14} weight="bold" /> 提交交付结果</Button> : null}
                        </div>
                      </div>
                      {reassignEventId === selectedEvent.id && selectedEvent.capabilities.canReassign ? <div className="delivery-member-picker">
                        <Label>新执行负责人<Select value={nextAssignee} onValueChange={setNextAssignee}><SelectTrigger aria-label="新执行负责人"><SelectValue placeholder="选择交接人员" /></SelectTrigger><SelectContent>{memberOptions.filter((member) => member.id !== selectedEvent.assigneeUserId).map((member) => <SelectItem key={member.id} value={String(member.id)}>{member.name}</SelectItem>)}</SelectContent></Select></Label>
                        <Label>交接原因<Textarea aria-label="交接原因" maxLength={1000} value={reassignReason} onChange={(event) => setReassignReason(event.target.value)} /></Label>
                        <div className="delivery-members-actions"><Button variant="outline" onClick={() => setReassignEventId(null)}>取消</Button><ConfirmActionDialog actionKey={`delivery-reassign:${project.id}:${selectedEvent.id}`} title={`确认转交“${selectedEvent.title}”的执行负责人？`} description="确认后原负责人将失去执行权限。" confirmLabel="确认转交" variant="default" confirmDisabled={!nextAssignee || !reassignReason.trim()} onConfirm={async () => { const saved = await onReassignEvent(selectedEvent.id, { assigneeUserId: Number(nextAssignee), previousAssigneeUserId: selectedEvent.assigneeUserId ?? null, reason: reassignReason }); if (saved) setReassignEventId(null); return saved }} trigger={<Button disabled={!nextAssignee || !reassignReason.trim()}>转交执行人</Button>} /></div>
                      </div> : null}
                      <dl className="delivery-basic-grid">
                        <div><dt>事件类型</dt><dd>{eventTypeLabel(selectedEvent.type)}</dd></div><div><dt>交付日期</dt><dd>{formatEventDeliveryDate(selectedEvent)}</dd></div><div><dt>制定人</dt><dd>{selectedEvent.createdByName || '未知'}</dd></div><div><dt>执行负责人</dt><dd><UserName departedUserIds={timeline?.departedUserIds} name={selectedEvent.assigneeName || '未指派'} userId={selectedEvent.assigneeUserId} /></dd></div><div><dt>发布人</dt><dd>{selectedEvent.publishedByName || '未发布'}</dd></div><div><dt>拒绝次数</dt><dd>{selectedEvent.rejectionCount ?? 0}</dd></div>
                      </dl>
                      {selectedEvent.deliveryResult === 'partial' || selectedEvent.deliveryResult === 'failed' ? <section className="delivery-result-summary"><strong>交付失败记录</strong>{selectedEvent.deliveryFailureReason ? <p>{selectedEvent.deliveryFailureReason}</p> : null}{selectedEvent.deliverySteps.filter((step) => step.result === 'failed').map((step) => <p key={step.id}><strong>{step.processName}</strong>：{step.failureDetail || '未填写失败详情'}</p>)}</section> : null}
                      {selectedEvent.rejections.length > 0 ? <section className="delivery-rejection-history"><h4>拒绝记录</h4>{selectedEvent.rejections.map((rejection, index) => <article key={`${rejection.createdAt}-${index}`}><div><strong>第 {selectedEvent.rejections.length - index} 次拒绝</strong><span>{rejection.rejectedByName} · {rejection.createdAt}</span></div><p>{rejection.reason}</p></article>)}</section> : null}
                      <section className="delivery-changelog"><h4>变更记录</h4>{selectedEvent.operations.length === 0 ? <div className="delivery-empty-state"><strong>暂无变更记录</strong></div> : sortByCreatedAt(selectedEvent.operations).map((operation) => <article key={operation.id}><div><strong>{operationHeading(operation)}</strong><span>{operation.createdAt}</span></div><div className="delivery-changelog-content">{operation.content || '暂无内容'}</div></article>)}</section>
                    </section>
                  </TabsContent>
                  <TabsContent className="delivery-detail-tab-content" value="delivery">
                    <section className="delivery-content-panel">
                      {renderDeliveryArtifacts()}
                    </section>
                  </TabsContent>
                </Tabs>
              ) : null}
            </DialogContent>
          </Dialog>
          </>
        )}
      </div>

      <Dialog open={deliveryResultDialogOpen} onOpenChange={setDeliveryResultDialogOpen}>
        <DialogContent className="delivery-result-dialog">
          <DialogHeader><DialogTitle>提交交付结果</DialogTitle><DialogDescription>部分交付和交付失败提交后为终止状态；拒绝后计划人员可调整并重新提交。</DialogDescription></DialogHeader>
          <div className="work-hours-dialog-form delivery-result-form">
            <Label>交付状态<Select value={deliveryResult} onValueChange={(value) => {
              const result = value as typeof deliveryResult
              setDeliveryResult(result)
              setDeliveryStepResults(Object.fromEntries((selectedEvent?.deliverySteps ?? []).map((step) => [step.id, { result: result === 'failed' ? 'failed' as const : 'success' as const }])))
              setDeliveryResultError('')
            }}><SelectTrigger aria-label="交付状态"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="success">交付成功</SelectItem><SelectItem value="partial">部分交付</SelectItem><SelectItem value="failed">交付失败</SelectItem><SelectItem value="rejected">拒绝交付</SelectItem></SelectContent></Select></Label>
            {deliveryResult === 'rejected' ? <Label>拒绝理由<Textarea rows={4} maxLength={4000} value={deliveryFailureReason} onChange={(event) => setDeliveryFailureReason(event.target.value)} placeholder="说明需要计划人员调整的内容" /></Label> : null}
            {deliveryResult === 'failed' ? <Label>失败详情<Textarea rows={4} maxLength={4000} value={deliveryFailureReason} onChange={(event) => setDeliveryFailureReason(event.target.value)} placeholder="说明本次交付失败的整体情况" /></Label> : null}
            {(deliveryResult === 'partial' || deliveryResult === 'failed') && selectedEvent ? <section className="delivery-step-result-editor"><h4>流程执行结果</h4>{selectedEvent.deliverySteps.map((step, index) => {
              const value = deliveryStepResults[step.id] ?? { result: deliveryResult === 'failed' ? 'failed' as const : 'success' as const }
              return <article key={step.id}><div><span>{index + 1}</span><strong>{step.processName}</strong><Select value={value.result} onValueChange={(result) => setDeliveryStepResults((current) => ({ ...current, [step.id]: { ...current[step.id], result: result as 'success' | 'failed' | 'skipped' } }))}><SelectTrigger aria-label={`${step.processName}执行结果`}><SelectValue /></SelectTrigger><SelectContent>{deliveryResult === 'partial' ? <SelectItem value="success">成功</SelectItem> : null}<SelectItem value="failed">失败</SelectItem><SelectItem value="skipped">未执行</SelectItem></SelectContent></Select></div>{value.result === 'failed' ? <Textarea aria-label={`${step.processName}失败详情`} maxLength={4000} placeholder="填写该流程失败详情" value={value.failureDetail ?? ''} onChange={(event) => setDeliveryStepResults((current) => ({ ...current, [step.id]: { ...(current[step.id] ?? value), failureDetail: event.target.value } }))} /> : null}</article>
            })}</section> : null}
            {deliveryResultError ? <p className="work-hours-error">{deliveryResultError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setDeliveryResultDialogOpen(false)}>取消</Button>
            <Button type="button" onClick={() => {
              if ((deliveryResult === 'failed' || deliveryResult === 'rejected') && !deliveryFailureReason.trim()) { setDeliveryResultError(deliveryResult === 'rejected' ? '拒绝交付时必须填写拒绝理由' : '交付失败时必须填写失败详情'); return }
              if ((deliveryResult === 'partial' || deliveryResult === 'failed') && selectedEvent) {
                const results = selectedEvent.deliverySteps.map((step) => deliveryStepResults[step.id])
                if (results.some((result) => !result || (result.result === 'failed' && !result.failureDetail?.trim()))) { setDeliveryResultError('请填写每个失败流程的失败详情'); return }
                if (deliveryResult === 'partial' && (!results.some((result) => result.result === 'success') || !results.some((result) => result.result !== 'success'))) { setDeliveryResultError('部分交付必须同时包含成功和失败或未执行流程'); return }
                if (deliveryResult === 'failed' && results.some((result) => result.result === 'success')) { setDeliveryResultError('交付失败不能包含成功流程，请选择部分交付'); return }
              }
              setDeliveryResultDialogOpen(false)
              if (!selectedEvent) return
              const descriptions = { success: '事件将标记为交付成功。', partial: '事件将以部分交付终止。', failed: '事件将以交付失败终止。', rejected: '事件将退回计划人员调整，可重新提交交付。' }
              void confirmAction({ title: `确认提交“${selectedEvent.title}”的交付结果？`, description: descriptions[deliveryResult], confirmLabel: '确认提交' }, () => onCompleteEvent(selectedEvent.id, { result: deliveryResult, failureReason: deliveryFailureReason.trim() || undefined, stepResults: deliveryResult === 'partial' || deliveryResult === 'failed' ? deliveryStepResults : undefined }))
            }}>确认提交</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={operationDialogOpen} onOpenChange={setOperationDialogOpen}>
        <DialogContent className="package-operation-dialog">
          <DialogHeader className="operation-doc-header">
            <DialogTitle>
              {operationDialogReadOnly
                ? operationKind === 'document'
                  ? '查看操作文档'
                  : '查看操作事件'
                : pendingOperationTarget?.operation
                ? operationKind === 'document'
                  ? '编辑操作文档'
                  : '编辑操作文档'
                : '添加操作文档'}
            </DialogTitle>
            <DialogDescription>
              {operationDialogReadOnly
                ? '事件发布后，文档内容仅供查看。'
                : '记录交付过程中需要保留的步骤、命令和说明。'}
            </DialogDescription>
          </DialogHeader>
          <div className="operation-doc-form">
            <div className="operation-doc-meta-row">
              <Label className="operation-doc-title-field">
                文档标题
                <Input
                  value={operationTitle}
                  readOnly={operationDialogReadOnly}
                  onChange={(event) => setOperationTitle(event.target.value)}
                  placeholder={operationKind === 'document' ? '例如：升级前检查事项' : '例如：初始化安装'}
                />
              </Label>
            </div>
            <MarkdownEditorLoadBoundary>
              <Suspense fallback={<div className="markdown-wysiwyg-loading" role="status">正在加载编辑器…</div>}>
                <MarkdownWysiwygEditor
                  key={`operation-${pendingOperationTarget?.operation?.id ?? `${pendingOperationTarget?.eventId ?? 'new'}-${pendingOperationTarget?.groupId ?? 'event'}`}`}
                  ariaLabel="操作文档内容"
                  value={operationContent}
                  onChange={setOperationContent}
                  onReady={() => setOperationEditorReady(true)}
                  placeholder="输入操作步骤、命令或说明…"
                  readOnly={operationDialogReadOnly}
                />
              </Suspense>
            </MarkdownEditorLoadBoundary>
          </div>
          <DialogFooter className="operation-doc-footer">
            {operationDialogReadOnly ? (
              <Button variant="outline" type="button" onClick={() => setOperationDialogOpen(false)}>
                关闭
              </Button>
            ) : (
              <>
                <Button variant="outline" type="button" onClick={() => setOperationDialogOpen(false)}>
                  取消
                </Button>
                <Button
                  type="button"
                  onClick={() => void submitOperation()}
                  disabled={
                    busyAction === 'operation' ||
                    !operationEditorReady ||
                    !operationTitle.trim() ||
                    (operationKind === 'document' && !operationContent.trim())
                  }
                >
                  保存
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={exportScopeDialogOpen} onOpenChange={setExportScopeDialogOpen}>
        <DialogContent className="package-export-scope-dialog">
          <DialogHeader>
            <DialogTitle>导出时间线</DialogTitle>
            <DialogDescription>
              选择需要导出的时间线范围，确认后可以在预览中继续编辑内容。
            </DialogDescription>
          </DialogHeader>
          <fieldset className="package-export-scope-options">
            <legend>导出范围</legend>
            <label className={exportScope === 'current' ? 'package-export-scope-option active' : 'package-export-scope-option'}>
              <input
                checked={exportScope === 'current'}
                disabled={!selectedEvent}
                name="timeline-export-scope"
                type="radio"
                value="current"
                onChange={() => setExportScope('current')}
              />
              <span>
                <strong>导出当前事件时间线</strong>
                <small>
                  {selectedEvent ? `仅导出「${selectedEvent.title}」及其操作文档、安装包记录。` : '当前没有可导出的交付事件。'}
                </small>
              </span>
            </label>
            <label className={exportScope === 'all' ? 'package-export-scope-option active' : 'package-export-scope-option'}>
              <input
                checked={exportScope === 'all'}
                name="timeline-export-scope"
                type="radio"
                value="all"
                onChange={() => setExportScope('all')}
              />
              <span>
                <strong>导出完整事件线</strong>
                <small>导出当前项目下的全部交付事件和时间线记录。</small>
              </span>
            </label>
          </fieldset>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setExportScopeDialogOpen(false)}>
              取消
            </Button>
            <Button type="button" onClick={() => void handleExport(exportScope)}>
              继续导出
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={exportPreviewOpen} onOpenChange={setExportPreviewOpen}>
        <DialogContent className="package-operation-dialog">
          <DialogHeader className="operation-doc-header">
            <DialogTitle>导出 {project.name || '项目'} 时间线</DialogTitle>
            <DialogDescription>
              确认项目「{project.name || '未命名项目'}」的时间线内容无误后，再点击右下角确认导出。
            </DialogDescription>
          </DialogHeader>
          <div className="operation-doc-form">
            <MarkdownEditorLoadBoundary>
              <Suspense fallback={<div className="markdown-wysiwyg-loading" role="status">正在加载编辑器…</div>}>
                <MarkdownWysiwygEditor
                  key={`export-${exportFileName}`}
                ariaLabel="时间线导出内容"
                value={exportContent}
                onChange={setExportContent}
                onReady={() => setExportEditorReady(true)}
                placeholder="当前项目没有可导出的时间线内容"
                />
              </Suspense>
            </MarkdownEditorLoadBoundary>
          </div>
          <DialogFooter className="operation-doc-footer">
            <Button variant="outline" type="button" onClick={() => setExportPreviewOpen(false)}>
              取消
            </Button>
            <Button type="button" onClick={confirmExport} disabled={!exportEditorReady || !exportContent.trim()}>
              确认导出
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={operationTodoDialogOpen}
        onOpenChange={(open) => {
          setOperationTodoDialogOpen(open)
          if (!open) clearOperationTodoDialogState()
        }}
      >
        <DialogContent className="package-operation-dialog operation-todo-link-dialog">
          <DialogHeader>
            <DialogTitle>关联待办</DialogTitle>
            <DialogDescription>
              在这里统一管理待办关联、完成状态和备注说明；复选框会与外部待办列表的勾选状态保持同步。
            </DialogDescription>
          </DialogHeader>
          <div className={selectableTodos.length > 0 ? 'operation-todo-dialog-body has-picker' : 'operation-todo-dialog-body'}>
            {selectableTodos.length > 0 ? (
              <div className="operation-todo-picker">
                <span className="operation-todo-picker-label">选择待办</span>
                <DropdownMenu
                  open={todoPickerOpen}
                  onOpenChange={(open) => {
                    setTodoPickerOpen(open)
                  }}
                >
                  <DropdownMenuTrigger asChild>
                    <Button className="operation-todo-picker-trigger" variant="outline" type="button">
                      <span className="operation-todo-picker-trigger-content">
                        {todoDialogSelectedTodos.length === 0 ? (
                          <span className="operation-todo-picker-placeholder">搜索并选择待办</span>
                        ) : (
                          <span className="operation-todo-picker-tags">
                            {todoDialogSelectedTodos.slice(0, 3).map((todo) => (
                              <span className="operation-todo-picker-tag" key={todo.id}>
                                {todo.title}
                              </span>
                            ))}
                            {todoDialogSelectedTodos.length > 3 ? (
                              <span className="operation-todo-picker-tag">
                                +{todoDialogSelectedTodos.length - 3}
                              </span>
                            ) : null}
                          </span>
                        )}
                      </span>
                      <CaretDown
                        className={todoPickerOpen ? 'operation-todo-picker-caret open' : 'operation-todo-picker-caret'}
                        size={14}
                        weight="bold"
                      />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className={
                      todoPickerOptionsOverflowing
                        ? 'operation-todo-picker-content has-options-scrollbar'
                        : 'operation-todo-picker-content'
                    }
                    collisionPadding={20}
                    onCloseAutoFocus={(event) => event.preventDefault()}
                    sideOffset={8}
                  >
                    <div className="operation-todo-picker-search-row">
                      <Input
                        ref={todoPickerSearchRef}
                        value={todoDialogSearch}
                        onChange={(event) => setTodoDialogSearch(event.target.value)}
                        onKeyDown={(event) => event.stopPropagation()}
                        placeholder="搜索标题、负责人、提交人、创建日期"
                      />
                      <Button
                        className={
                          activeTodoFilterCount > 0
                            ? 'todo-filter-open-button operation-todo-filter-open-button active'
                            : 'todo-filter-open-button operation-todo-filter-open-button'
                        }
                        variant="outline"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setTodoFilterDialogOpen(true)
                        }}
                      >
                        <FunnelSimple size={14} />
                        <span>{todoFilterSummary}</span>
                      </Button>
                    </div>
                    <TodoFilterBuilderDialog
                      assigneeOptions={todoDialogAssigneeOptions}
                      conditions={todoFilterConditions}
                      creatorOptions={todoDialogCreatorOptions}
                      join={todoFilterJoin}
                      moduleOptions={todoDialogModuleOptions}
                      watcherOptions={todoDialogWatcherOptions}
                      open={todoFilterDialogOpen}
                      onOpenChange={setTodoFilterDialogOpen}
                      onApply={({ conditions: nextConditions, join: nextJoin }) => {
                        setTodoFilterConditions(nextConditions)
                        setTodoFilterJoin(nextJoin)
                      }}
                    />
                    <div className="operation-todo-picker-options" ref={todoPickerOptionsRef}>
                      {filteredTodoDialogTodos.length === 0 ? (
                        <p className="operation-empty">没有搜索到匹配的待办。</p>
                      ) : (
                        filteredTodoDialogTodos.map((todo) => {
                          const selected = todoDialogSelectedIds.has(todo.id)
                          const done = Boolean(todoDialogTodoDoneMap[todo.id])
                          const meta = todoDialogMeta(todo, done)
                          return (
                            <button
                              className={selected ? 'operation-todo-picker-option selected' : 'operation-todo-picker-option'}
                              key={todo.id}
                              type="button"
                              onClick={() => toggleTodoDialogTodo(todo.id)}
                            >
                              <span className="operation-todo-picker-option-check" aria-hidden="true" />
                              <span className="operation-todo-picker-option-text">
                                <strong>
                                  <span className="operation-todo-dialog-item-title">{todo.title}</span>
                                  {todo.moduleName ? (
                                    <Badge className="todo-module-badge">{todo.moduleName}</Badge>
                                  ) : null}
                                </strong>
                                <small>{meta}</small>
                              </span>
                            </button>
                          )
                        })
                      )}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : null}
            <div className="operation-todo-dialog-list">
              {selectableTodos.length === 0 ? (
                <div className="operation-todo-dialog-empty-state">
                  <strong>暂未关联待办</strong>
                  <span>当前项目还没有可供关联的待办。</span>
                </div>
              ) : todoDialogSelectedTodos.length === 0 ? (
                <div className="operation-todo-dialog-empty-state">
                  <strong>暂未关联待办</strong>
                  <span>先在上方搜索并选择待办，选择后再填写备注并同步完成状态。</span>
                </div>
              ) : (
                todoDialogSelectedTodos.map((todo) => {
                  const done = Boolean(todoDialogTodoDoneMap[todo.id])
                  const meta = todoDialogMeta(todo, done)
                  return (
                    <article
                      className={done ? 'operation-todo-dialog-item selected done' : 'operation-todo-dialog-item selected'}
                      key={todo.id}
                    >
                      <div className="operation-todo-dialog-item-head">
                        <div className="operation-todo-dialog-item-text">
                          <strong>
                            <span className="operation-todo-dialog-item-title">{todo.title}</span>
                          </strong>
                          {todo.moduleName ? (
                            <Badge className="todo-module-badge">{todo.moduleName}</Badge>
                          ) : null}
                          <small>{meta}</small>
                        </div>
                        <div className="operation-todo-dialog-item-controls">
                          <label className="operation-todo-dialog-done-toggle">
                            <input
                              type="checkbox"
                              checked={done}
                              onChange={() => toggleTodoDialogDone(todo.id)}
                            />
                            <span>完成待办</span>
                          </label>
                        </div>
                      </div>
                      <Textarea
                        className="operation-todo-dialog-note"
                        placeholder="写一下未完成原因、完成情况或补充说明..."
                        value={todoDialogRelatedTodoNotes[todo.id] ?? ''}
                        onChange={(event) => updateTodoDialogNote(todo.id, event.target.value)}
                      />
                    </article>
                  )
                })
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                setOperationTodoDialogOpen(false)
                clearOperationTodoDialogState()
              }}
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={() => void saveOperationTodoDialog()}
              disabled={!todoDialogOperation || busyAction === `operation-todo-link-${todoDialogOperation.id}`}
            >
              保存操作
            </Button>
          </DialogFooter>
          {operationTodoSaveError ? <p role="alert" className="text-destructive">{operationTodoSaveError}</p> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={marketOpen} onOpenChange={setMarketOpen}>
        <DialogContent className="package-market-dialog">
          <DialogHeader>
            <DialogTitle>安装包市场</DialogTitle>
            <DialogDescription>
              为项目「{project.name}」当前事件选择安装包。当前链接有效期：{formatExpireDuration(marketExpireMinutes)}。
            </DialogDescription>
          </DialogHeader>
          <div className="package-market-grid">
          <div className="package-market-sidebar">
            <Label>
                搜索
                <Input
                  value={marketSearch}
                  onChange={(event) => setMarketSearch(event.target.value)}
                  placeholder="sealos / db / app"
              />
            </Label>
            <Button
              className="package-market-show-all"
              variant={marketIncludeAll ? 'default' : 'outline'}
              type="button"
              aria-pressed={marketIncludeAll}
              title={marketIncludeAll ? '关闭全部包展示' : '展示全部包'}
              onClick={() => {
                const nextIncludeAll = !marketIncludeAll
                setMarketIncludeAll(nextIncludeAll)
                void refreshMarketDetail({ includeAll: nextIncludeAll })
              }}
            >
              {marketIncludeAll ? <EyeSlash size={15} /> : <Eye size={15} />}
              {marketIncludeAll ? '仅展示规则包' : '展示全部包'}
            </Button>
              <PackageMarketRuleList>
                {groupedMarketRules.map((group) => (
                  <section
                    className={marketExpandedGroups[group.id] !== false ? 'package-market-group' : 'package-market-group collapsed'}
                    key={group.id}
                  >
                    <button
                      className="package-market-group-toggle"
                      type="button"
                      onClick={() =>
                        setMarketExpandedGroups((current) => ({
                          ...current,
                          [group.id]: current[group.id] === false,
                        }))
                      }
                    >
                      <span>{group.label}</span>
                    {marketExpandedGroups[group.id] !== false ? (
                        <CaretDown size={14} weight="bold" />
                      ) : (
                        <CaretRight size={14} weight="bold" />
                      )}
                    </button>
                    {marketExpandedGroups[group.id] !== false ? (
                      <div className="package-market-group-list">
                        {group.rules.length === 0 ? (
                          <p className="package-market-group-empty">当前分组没有匹配到安装包。</p>
                        ) : (
                          group.rules.map((rule) => (
                            <button
                              key={rule.id}
                              type="button"
                              className={rule.id === marketSelectedPackage ? 'package-market-rule active' : 'package-market-rule'}
                              onClick={() => {
                                const nextChannel = rule.id === 'base-oss' ? 'release' : marketChannel
                                setMarketSelectedPackage(rule.id)
                                setMarketChannel(nextChannel)
                                setMarketReleaseVersion('')
                                setMarketCiBranch('')
                                setMarketCiVersion('')
                                void refreshMarketDetail({
                                  packageId: rule.id,
                                  channel: nextChannel,
                                  releaseVersion: '',
                                  ciBranch: '',
                                  ciVersion: '',
                                })
                              }}
                            >
                              <strong>{rule.name}</strong>
                              <small>{rule.id}</small>
                            </button>
                          ))
                        )}
                      </div>
                    ) : null}
                  </section>
                ))}
              </PackageMarketRuleList>
            </div>
            <div className="package-market-main">
              <div className="package-market-controls">
                <Label>
                  渠道
                <Select
                  value={marketChannel}
                  onValueChange={(value) => {
                      const next = value as PackageMarketChannel
                      if (!marketPolicy?.channels[next].enabled) return
                      const visibleIds = marketVisibleRuleIds[next] ?? []
                      if (visibleIds.length === 0) return
                      const currentPackageId = canonicalPackageMarketRuleId(marketSelectedPackage)
                      const nextPackage = visibleIds.includes(currentPackageId)
                        ? currentPackageId
                        : visibleIds[0] ?? ''
                      setMarketChannel(next)
                      setMarketSelectedPackage(nextPackage)
                      setMarketCiBranch('')
                      setMarketCiVersion('')
                      setMarketReleaseVersion('')
                      if (!nextPackage) {
                        setMarketDetail(null)
                        setMarketDetailContext(null)
                        return
                      }
                      void refreshMarketDetail({
                        channel: next,
                        ciBranch: '',
                        ciVersion: '',
                        packageId: nextPackage,
                        releaseVersion: '',
                      })
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {marketPolicy?.channels.release.enabled && marketVisibleRuleIds.release.length > 0 ? (
                        <SelectItem value="release">正式包</SelectItem>
                      ) : null}
                      {marketPolicy?.channels.ci.enabled && marketVisibleRuleIds.ci.length > 0 ? (
                        <SelectItem value="ci">测试包</SelectItem>
                      ) : null}
                    </SelectContent>
                  </Select>
                </Label>
                <Label>
                  架构
                <Select
                  value={marketArch}
                  onValueChange={(value) => {
                      const next = value as 'amd64' | 'arm64'
                      setMarketArch(next)
                      setMarketCiBranch('')
                      setMarketCiVersion('')
                      setMarketReleaseVersion('')
                      void refreshMarketDetail({ arch: next, ciBranch: '', ciVersion: '', releaseVersion: '' })
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="amd64">amd64</SelectItem>
                      <SelectItem value="arm64">arm64</SelectItem>
                    </SelectContent>
                  </Select>
                </Label>
                {marketChannel === 'release' && marketReleaseVersions.length > 0 ? (
                  <Label className="package-market-version-control">
                    正式版本
                    <Select
                      value={marketReleaseVersion || marketReleaseVersions[0]?.version || ''}
                      onValueChange={(value) => {
                        setMarketReleaseVersion(value)
                        void refreshMarketDetail({ releaseVersion: value })
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="选择版本" />
                      </SelectTrigger>
                      <SelectContent>
                        {marketReleaseVersions.map((version) => (
                          <SelectItem key={version.version ?? version.label} value={version.version ?? version.label}>
                            {version.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Label>
                ) : null}
                {marketChannel === 'ci' && marketCiBranches.length > 0 ? (
                  <Label className="package-market-version-control">
                    CI 分支
                    <Select
                      value={marketCiBranch || marketCiBranches[0]?.name || ''}
                      onValueChange={(value) => {
                        setMarketCiBranch(value)
                        setMarketCiVersion('')
                        void refreshMarketDetail({ ciBranch: value, ciVersion: '' })
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="选择分支" />
                      </SelectTrigger>
                      <SelectContent>
                        {marketCiBranches.map((branch) => (
                          <SelectItem key={branch.name} value={branch.name}>
                            {branch.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Label>
                ) : null}
                {marketChannel === 'ci' && marketCiVersions.length > 0 ? (
                  <Label className="package-market-version-control">
                    测试版本
                    <Select
                      value={marketCiVersion || marketCiVersions[0]?.hash || ''}
                      onValueChange={(value) => {
                        setMarketCiVersion(value)
                        void refreshMarketDetail({ ciVersion: value })
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="选择版本" />
                      </SelectTrigger>
                      <SelectContent>
                        {marketCiVersions.map((version) => (
                          <SelectItem key={version.hash ?? version.label} value={version.hash ?? version.label}>
                            {version.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Label>
                ) : null}
              </div>
              <div className="package-market-detail-area">
                {marketError ? <p className="form-error">{marketError}</p> : null}
                {marketPolicy && !marketPolicy.enabled ? (
                  <p className="empty-state">当前组织已关闭安装包市场。</p>
                ) : marketPolicy && !organizationPackageMarketPolicyHasVisibleChannel(marketPolicy, marketVisibleRuleIds) ? (
                  <p className="empty-state">当前组织没有开放可用的安装包。</p>
                ) : marketLoading ? (
                  <p className="empty-state">正在读取 OSS 包信息...</p>
                ) : marketDetail ? (
                  <div className="package-market-link-list">
                    {marketDetail.links.length === 0 ? (
                      <p className="empty-state">当前参数下没有找到可用对象。</p>
                    ) : (
                      marketDetail.links.map((link) => renderMarketLinkCard(marketDetail, marketDetailContext, link))
                    )}
                    {selectedMarketDependencyRules.length > 0 ? (
                      marketDependencyDetails.map((dependency) => (
                        <section className="package-market-dependency" key={dependency.rule.id}>
                          <div className="package-market-dependency-head">
                            <div>
                              <strong>{dependency.rule.name}</strong>
                              <small>附属包 · {dependency.rule.id}</small>
                            </div>
                            {dependency.versions.length > 0 ? (
                              <Label className="package-market-dependency-version">
                                版本
                                <Select
                                  value={dependency.selectedVersion}
                                  onValueChange={(value) => {
                                    const selectedVersions = Object.fromEntries(
                                      marketDependencyDetails.map((item) => [item.rule.id, item.selectedVersion]),
                                    )
                                    selectedVersions[dependency.rule.id] = value
                                    void refreshMarketDependencyDetails({
                                      arch: marketArch,
                                      expireMinutes: marketExpireMinutes,
                                      includeAll: marketIncludeAll,
                                      requestId: marketDetailRequestIdRef.current,
                                      requestContext: projectMarketContext,
                                      rules: selectedMarketDependencyRules,
                                      selectedVersions,
                                  })
                                  }}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="选择版本" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {dependency.versions.map((version) => (
                                      <SelectItem
                                        key={version.hash ?? version.version ?? version.label}
                                        value={version.hash ?? version.version ?? version.label}
                                      >
                                        {version.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </Label>
                            ) : null}
                          </div>
                          {dependency.error ? <p className="form-error">{dependency.error}</p> : null}
                          {dependency.loading ? (
                            <p className="empty-state">正在读取附属包...</p>
                          ) : dependency.detail ? (
                            dependency.detail.links.length === 0 ? (
                              <p className="empty-state">当前参数下没有找到可用附属包对象。</p>
                            ) : (
                              <div className="package-market-link-list">
                                {dependency.detail.links.map((link) =>
                                  renderMarketLinkCard(dependency.detail as PackageMarketDetail, dependency.context, link),
                                )}
                              </div>
                            )
                          ) : (
                            <p className="empty-state">当前包没有可用附属包对象。</p>
                          )}
                        </section>
                      ))
                    ) : null}
                  </div>
                ) : (
                  <p className="empty-state">选择一个包后查看详情。</p>
                )}
              </div>
              <div className="package-market-expire-row">
                <Label>
                  配置链接有效期
                  <Select
                    value={marketExpireMode}
                    onValueChange={(value) => {
                      const nextMode = value as 'delivery-end' | 'custom'
                      setMarketExpireMode(nextMode)
                      if (nextMode === 'delivery-end') {
                        const nextExpireMinutes = getExpireMinutesUntil(eventDeliveryEndAt)
                        setMarketExpireMinutes(nextExpireMinutes)
                        void refreshMarketDetail({ expireMinutes: nextExpireMinutes })
                      } else {
                        refreshCustomMarketExpire(marketExpireDays, marketExpireHours)
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="delivery-end">至预期交付完成时间（{formatDateTimeLocalWindow(
                        eventDeliveryStartAt,
                        eventDeliveryEndAt,
                      )}）</SelectItem>
                      <SelectItem value="custom">自定义时长</SelectItem>
                    </SelectContent>
                  </Select>
                </Label>
                {marketExpireMode === 'custom' ? (
                  <div className="package-market-expire-custom">
                    <Label>
                      天
                      <Input
                        min="0"
                        max="365"
                        step="1"
                        type="number"
                        value={marketExpireDays}
                        onChange={(event) => {
                          const nextDays = event.target.value
                          setMarketExpireDays(nextDays)
                          refreshCustomMarketExpire(nextDays, marketExpireHours)
                        }}
                      />
                    </Label>
                    <Label>
                      时
                      <Input
                        min="0"
                        max="23"
                        step="1"
                        type="number"
                        value={marketExpireHours}
                        onChange={(event) => {
                          const nextHours = event.target.value
                          setMarketExpireHours(nextHours)
                          refreshCustomMarketExpire(marketExpireDays, nextHours)
                        }}
                      />
                    </Label>
                  </div>
                ) : null}
                <small>影响当前弹窗内“查看临时链接”和“复制下载链接”的有效期。自定义时长至少 1 小时，最长 365 天。</small>
              </div>
            </div>
          </div>
          <div className="package-cart-strip">
            <div>
              <strong>当前草稿已选择：{cartItems.length} 项</strong>
              <small>
                {cartItems.map((item) => `${item.packageName} · ${item.version}`).join('；') || '还没有选择安装包'}
              </small>
            </div>
            <div className="package-cart-actions">
              <Button
                variant="outline"
                type="button"
                onClick={() => {
                  setCartItems([])
                  setEventEditorDirty(true)
                }}
                disabled={cartItems.length === 0}
              >
                清空
              </Button>
              <Button type="button" onClick={() => void submitCart()}>
                <Check size={16} /> 确认选择
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <PackageEventCommentsDrawer
        currentUserId={currentUserId}
        departedUserIds={timeline?.departedUserIds ?? []}
        event={selectedEvent}
        mentionMembers={timeline?.mentionableMembers ?? memberOptions}
        open={commentsDrawerOpen && selectedEvent != null}
        onAddComment={(eventId, content) => onAddEventComment(eventId, content)}
        onDeleteComment={(comment) => onDeleteEventComment(selectedEvent!.id, comment.id)}
        onOpenChange={setCommentsDrawerOpen}
        onUpdateComment={(comment, content) => onUpdateEventComment(selectedEvent!.id, comment.id, content)}
      />
    </div>
  )
})

function PackageEventCommentItem({
  comment,
  currentUserId,
  departedUserIds,
  disabled,
  mentionMembers,
  onDelete,
  onUpdate,
}: {
  comment: ProjectPackageEventComment
  currentUserId?: number
  departedUserIds: readonly number[]
  disabled: boolean
  mentionMembers: MentionMember[]
  onDelete: (comment: ProjectPackageEventComment) => Promise<boolean>
  onUpdate: (comment: ProjectPackageEventComment, content: string) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.content)
  const canManage = !disabled && (comment.canEdit || (
    currentUserId != null && comment.authorUserId === currentUserId
  ))
  const edited = comment.updatedAt !== comment.createdAt

  useEffect(() => {
    if (!editing) setDraft(comment.content)
  }, [comment.content, editing])

  return (
    <article className="package-event-comment-item">
      <div className="package-event-comment-header">
        <div className="package-event-comment-byline">
          <UserName departedUserIds={departedUserIds} name={comment.authorName} userId={comment.authorUserId} />
          <span aria-hidden="true">·</span>
          <time>{comment.createdAt}{edited ? ` · 编辑于 ${comment.updatedAt}` : ''}</time>
        </div>
        {canManage && !editing ? (
          <div className="package-event-comment-actions">
            <Button
              aria-label="编辑反馈"
              size="icon-sm"
              title="编辑反馈"
              type="button"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              <PencilSimple />
            </Button>
            <DeleteConfirmDialog
              title="删除这条交付反馈？"
              description={`“${comment.content.slice(0, 120)}”将永久删除，无法恢复。`}
              confirmLabel="删除反馈"
              onConfirm={() => onDelete(comment)}
              trigger={(
                <Button
                  aria-label="删除反馈"
                  className="package-event-comment-delete"
                  disabled={disabled}
                  size="icon-sm"
                  title="删除反馈"
                  type="button"
                  variant="outline"
                >
                  <Trash />
                </Button>
              )}
            />
          </div>
        ) : null}
      </div>
      {editing && canManage ? (
        <form
          className="package-event-comment-editor"
          onSubmit={async (formEvent) => {
            formEvent.preventDefault()
            if (!draft.trim() || disabled) return
            if (await onUpdate(comment, draft)) setEditing(false)
          }}
        >
          <MentionTextarea
            aria-label="编辑反馈"
            members={mentionMembers}
            menuPlacement="above"
            maxLength={5000}
            onChange={setDraft}
            value={draft}
          />
          <div className="package-event-comment-editor-actions">
            <Button type="button" variant="outline" onClick={() => { setDraft(comment.content); setEditing(false) }}>
              取消
            </Button>
            <Button disabled={disabled || !draft.trim()}>保存</Button>
          </div>
        </form>
      ) : (
        <p className="package-event-comment-content">{comment.content}</p>
      )}
    </article>
  )
}

function PackageEventCommentsDrawer({
  currentUserId,
  departedUserIds,
  event,
  mentionMembers,
  onAddComment,
  onDeleteComment,
  onOpenChange,
  onUpdateComment,
  open,
}: {
  currentUserId?: number
  departedUserIds: readonly number[]
  event: ProjectPackageEvent | null
  mentionMembers: MentionMember[]
  onAddComment: (eventId: number, content: string) => Promise<boolean>
  onDeleteComment: (comment: ProjectPackageEventComment) => Promise<boolean>
  onOpenChange: (open: boolean) => void
  onUpdateComment: (comment: ProjectPackageEventComment, content: string) => Promise<boolean>
  open: boolean
}) {
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) setDraft('')
  }, [event?.id, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="package-event-comments-drawer fixed inset-y-0 right-0 left-auto z-50 h-full w-[min(92vw,430px)] translate-x-0 translate-y-0 gap-0 rounded-none border-l p-0 shadow-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right"
      >
        <DialogHeader className="package-event-comments-header">
          <DialogTitle>交付反馈</DialogTitle>
          <DialogDescription>
            {event ? `${event.title} · ${eventTypeLabel(event.type)}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="package-event-comments-body">
          {(event?.comments ?? []).length === 0 ? (
            <div className="package-event-comments-empty">
              {event?.capabilities?.canComment ? '还没有反馈，写下这次交付的情况或 @ 相关成员吧。' : '暂无交付反馈。'}
            </div>
          ) : (
            (event?.comments ?? []).map((comment) => (
              <PackageEventCommentItem
                comment={comment}
                currentUserId={currentUserId}
                departedUserIds={departedUserIds}
                disabled={submitting || !event?.capabilities?.canComment}
                key={comment.id}
                mentionMembers={mentionMembers}
                onDelete={onDeleteComment}
                onUpdate={onUpdateComment}
              />
            ))
          )}
        </div>
        {event?.capabilities?.canComment ? <form
          className="package-event-comments-composer"
          onSubmit={async (formEvent) => {
            formEvent.preventDefault()
            if (!event?.capabilities?.canComment || !draft.trim() || submitting) return
            setSubmitting(true)
            const saved = await onAddComment(event.id, draft)
            setSubmitting(false)
            if (saved) setDraft('')
          }}
        >
          <MentionTextarea
            aria-label="交付反馈"
            members={mentionMembers}
            menuPlacement="above"
            maxLength={5000}
            onChange={setDraft}
            placeholder="写下交付反馈，输入 @ 可提及组织成员。"
            value={draft}
          />
          <div className="package-event-comments-composer-actions">
            <Button disabled={submitting || !draft.trim()}>
              {submitting ? '发送中...' : '发送反馈'}
            </Button>
          </div>
        </form> : <p className="package-workbench-readonly">当前交付反馈为只读。</p>}
      </DialogContent>
    </Dialog>
  )
}
