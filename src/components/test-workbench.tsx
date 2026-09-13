import { OrganizationTestEnvironmentPanel } from './organization-test-environments'
import type { OrganizationDetail } from '../organization-types'
import { ConfirmActionDialog } from './confirm-action-dialog'
import { useConfirmAction } from '../hooks/use-confirm-action'
import { reconcileAction } from '../confirmed-action'
import { useDirectoryTreeState } from '../use-case-directory-tree'
import { buildTestCaseCsv, testCaseCsvHeaders } from '../test-case-csv'
import { DirectoryPicker, DirectoryTree } from './test-case-directory-tree'
import { countDirectoryCases, createDirectoryIndex } from '../../shared/test-case-directories'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type FormEvent, type ReactNode } from 'react'
import {
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowsLeftRight,
  Bell,
  Bug,
  Buildings,
  CaretDoubleLeft,
  CaretDoubleRight,
  CaretDown,
  CaretLeft,
  CaretRight,
  CheckCircle,
  Check,
  ClipboardText,
  Clock,
  CopySimple,
  DownloadSimple,
  FileCsv,
  FileText,
  Flask,
  FolderPlus,
  Folder,
  FolderOpen,
  FunnelSimple,
  GearSix,
  ListChecks,
  LinkSimple,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  DotsThreeVertical,
  Trash,
  UploadSimple,
  UserPlus,
  WarningCircle,
  X,
  XCircle,
} from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { JournalDatePicker } from '@/components/journal-date-picker'
import { notificationRefreshIntervalMs } from '@/notifications'
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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { MentionTextarea, type MentionMember } from './mention-textarea'
import {
  WeeklyReportWorkbench,
  type WeeklyReportWorkbenchHandle,
} from './weekly-report-workbench'
import { BugShareDialog } from './bug-share-dialog'
import { UserName } from './user-name'
import {
  BugFilterBuilderDialog,
  type BugFilterOption,
  type BugFilterOptions,
} from './bug-filter-builder-dialog'
import {
  createDefaultBugFilterConditions,
  matchesBugFilterConditions,
  type BugFilterCondition,
  type BugFilterJoin,
} from './bug-filter'
import {
  fetchOrganization,
  fetchPackageMarketDetail,
  fetchPackageMarketCiVersions,
  fetchPackageMarketReleaseVersions,
  fetchPackageMarketRules,
  uploadWorkbenchAttachment,
} from '@/api'
import {
  clearBugCommentDraftIfMatches,
  loadBugCommentDraft,
  saveBugCommentDraft,
  subscribeBugCommentDraftChanges,
} from '@/bug-comment-drafts'
import {
  addAssignedTestBugComment,
  addTestBugComment,
  respondTestSpaceTransfer,
  acceptTestSpaceInvitation,
  acceptTestSpaceInviteLink,
  createTestBug,
  createTestCase,
  createTestCaseFolder,
  moveTestCases,
  createTestPlan,
  createTestSpace,
  createTestSpaceInviteLink,
  createTestSubject,
  declineTestSpaceInvitation,
  deleteAssignedTestBugComment,
  deleteTestCase,
  deleteTestCaseFolder,
  deleteTestPlan,
  deleteTestSpace,
  deleteTestSubject,
  deleteTestBug,
  deleteTestBugComment,
  fetchAssignedTestBugs,
  fetchTestBugVerificationScript,
  fetchTestSpaceInviteLinkInfo,
  fetchTestSpaceSettings,
  fetchTestWorkbench,
  importTestCases,
  importTestSpaceData,
  inviteTestSpaceMember,
  addTestSpaceMember,
  previewTestCaseImport,
  removeTestPlanCase,
  removeTestSpaceMember,
  rejectAssignedTestBug,
  submitAssignedBugVerification,
  transferAssignedTestBug,
  transferTestBugToSpace,
  updateTestSpace,
  updateAssignedTestBugComment,
  updateAssignedTestBug,
  updateTestBug,
  updateTestBugComment,
  updateTestCase,
  updateTestCaseFolder,
  updateTestPlan,
  updateTestPlanCase,
  updateTestPlanStatus,
  updateTestSpaceMember,
  updateTestSubject,
  verifyTestSpaceInviteLink,
} from '@/test-workbench-api'
import type {
  BugSeverity,
  BugStatus,
  TestBug,
  TestBugComment,
  TestBugEvent,
  TestCase,
  TestCaseFolder,
  TestCaseType,
  TestCaseImportPreview,
  TestPlan,
  TestResult,
  TestSpaceDataImportResult,
  TestSpaceImportCategory,
  TestSpaceImportSource,
  TestSpaceOwnershipTransfer,
  TestSpaceInvitation,
  TestSpaceSettings,
  TestSubject,
  TestEnvironment,
  TestWorkbenchData,
  TestWorkbenchNotification,
  TestWorkbenchProjectOption,
} from '@/test-workbench-types'
import type { OrganizationContext } from '../../shared/organization-context'
import { containerImageReferenceKey, normalizeContainerImageReference } from '../../shared/container-image-reference'
import type { PackageMarketRule, PackageMarketVersion, Priority } from '@/types'
import './test-workbench.css'

type WorkbenchTab = 'cases' | 'plans' | 'bugs' | 'weekly_report' | 'notifications'
type VerificationPackageSelection = {
  arch: string
  channel: 'release' | 'ci'
  objectKey: string
  objectLastModified?: string
  packageName: string
  sizeBytes?: number
  sourcePackageId: string
  sourcePackageName: string
  version: string
}

type SelectedVerificationPackage = VerificationPackageSelection & {
  selectionKey: string
}

function verificationPackageSnapshot(item: SelectedVerificationPackage): VerificationPackageSelection {
  return {
    arch: item.arch,
    channel: item.channel,
    objectKey: item.objectKey,
    objectLastModified: item.objectLastModified,
    packageName: item.packageName,
    sizeBytes: item.sizeBytes,
    sourcePackageId: item.sourcePackageId,
    sourcePackageName: item.sourcePackageName,
    version: item.version,
  }
}

const emptyWorkbench: TestWorkbenchData = {
  bugs: [],
  cases: [],
  departedUserIds: [],
  folders: [],
  notifications: [],
  planCases: [],
  plans: [],
  spaces: [],
  subjects: [],
  testEnvironments: [],
  users: [],
}

const priorityLabel: Record<Priority, string> = { high: '高', low: '低', medium: '中' }
const caseLevelLabel: Record<Priority, 'P0' | 'P1' | 'P2'> = { high: 'P0', low: 'P2', medium: 'P1' }
const caseTypeLabel: Record<TestCaseType, string> = {
  functional: '功能',
  performance: '性能',
  regression: '回归',
  security: '安全',
  smoke: '冒烟',
}
const resultLabel: Record<TestResult, string> = {
  blocked: '阻塞',
  failed: '失败',
  passed: '通过',
  skipped: '跳过',
  untested: '未执行',
}
const planStatusLabel: Record<TestPlan['status'], string> = {
  aborted: '已终止',
  completed: '已完成',
  draft: '草稿',
  in_progress: '执行中',
}
const bugStatusLabel: Record<BugStatus, string> = {
  new: '待确认',
  pending_confirmation: '待确认',
  assigned: '待修复',
  in_progress: '修复中',
  pending_verification: '待验证',
  rejected: '已驳回',
  closed: '已关闭',
}
const bugStatusOptions: Array<[BugStatus, string]> = [
  ['new', '待确认'],
  ['assigned', '待修复'],
  ['in_progress', '修复中'],
  ['pending_verification', '待验证'],
  ['rejected', '已驳回'],
  ['closed', '已关闭'],
]

function visibleBugStatus(status: BugStatus) {
  return status === 'pending_confirmation' ? 'new' : status
}

function selectedBugStatus(bug: TestBug, status: BugStatus) {
  return status === 'new' && bug.assigneeUserId ? 'pending_confirmation' : status
}
const severityLabel: Record<BugSeverity, string> = {
  blocker: '阻断',
  critical: '严重',
  major: '主要',
  minor: '次要',
  trivial: '轻微',
}

function bugFolderOptions(bugs: TestBug[]): BugFilterOption[] {
  const folders = new Map<string, BugFilterOption>()
  for (const bug of bugs) {
    const path = bug.testCaseDirectoryPath ?? []
    path.forEach((folder, index) => {
      folders.set(String(folder.id), {
        label: `${bug.testSubjectName || ''} / ${path.slice(0, index + 1).map((item) => item.name).join(' / ')}`,
        value: String(folder.id),
      })
    })
  }
  return [
    { label: '未分类', value: 'uncategorized' },
    { label: '待补关联', value: 'unlinked' },
    ...Array.from(folders.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN')),
  ]
}

function uniqueBugFilterOptions(
  bugs: TestBug[],
  getOption: (bug: TestBug) => BugFilterOption | undefined,
) {
  const options = new Map<string, BugFilterOption>()
  for (const bug of bugs) {
    const option = getOption(bug)
    if (option) options.set(option.value, option)
  }
  return Array.from(options.values()).sort((left, right) => (
    left.label.localeCompare(right.label, 'zh-CN')
  ))
}
const PLAN_EXECUTION_ROW_BLOCK_SIZE = 88
const emptyTestSpaceSettings: TestSpaceSettings = { invitations: [], organizations: [], spaces: [] }
const testSpaceInviteParam = 'testSpaceInvite'
const seenBugCommentStoragePrefix = 'veges.testWorkbench.seenBugComments.v1'
const readNotificationStoragePrefix = 'veges.testWorkbench.readNotifications.v1'
const assignedBugSpaceStoragePrefix = 'veges.assignedBugs.testSpace.v1'

type BugCommentNotification = {
  bug: TestBug
  comment: TestBugComment
  notification: TestWorkbenchNotification
}

type BugReturnNotification = {
  bug: TestBug
  notification: TestWorkbenchNotification
}

type PlanAssignmentNotification = {
  notification: TestWorkbenchNotification
  plan: TestPlan
}

function getTestSpaceInviteTokenFromUrl() {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get(testSpaceInviteParam)?.trim() ?? ''
}

function clearTestSpaceInviteTokenFromUrl() {
  const url = new URL(window.location.href)
  url.searchParams.delete(testSpaceInviteParam)
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
}

function buildTestSpaceInviteUrl(token: string) {
  const url = new URL(window.location.href)
  url.searchParams.set(testSpaceInviteParam, token)
  return url.toString()
}

function getTimestampMs(value?: string) {
  const timestamp = Date.parse(value ?? '')
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function getSeenBugCommentStorageKey(currentUserId?: number) {
  return currentUserId ? `${seenBugCommentStoragePrefix}.${currentUserId}` : ''
}

function readSeenBugCommentIds(currentUserId?: number) {
  const storageKey = getSeenBugCommentStorageKey(currentUserId)
  if (typeof window === 'undefined' || !storageKey) return new Set<number>()
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return new Set<number>()
    return new Set(parsed.map((value) => Number(value)).filter(Number.isFinite))
  } catch {
    return new Set<number>()
  }
}

function writeSeenBugCommentIds(currentUserId: number | undefined, ids: Set<number>) {
  const storageKey = getSeenBugCommentStorageKey(currentUserId)
  if (typeof window === 'undefined' || !storageKey) return
  window.localStorage.setItem(storageKey, JSON.stringify(Array.from(ids)))
}

function getReadNotificationStorageKey(currentUserId?: number) {
  return currentUserId ? `${readNotificationStoragePrefix}.${currentUserId}` : ''
}

function loadReadNotificationKeys(currentUserId?: number) {
  const storageKey = getReadNotificationStorageKey(currentUserId)
  if (typeof window === 'undefined' || !storageKey) return new Set<string>()
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return new Set<string>()
    return new Set(parsed.map((value) => String(value)).filter(Boolean))
  } catch {
    return new Set<string>()
  }
}

function writeReadNotificationKeys(currentUserId: number | undefined, keys: Set<string>) {
  const storageKey = getReadNotificationStorageKey(currentUserId)
  if (typeof window === 'undefined' || !storageKey) return
  window.localStorage.setItem(storageKey, JSON.stringify(Array.from(keys)))
}

function getAssignedBugSpaceStorageKey(
  currentUserId: number | undefined,
  organizationId: OrganizationContext,
) {
  const scope = organizationId == null ? 'personal' : String(organizationId)
  return currentUserId
    ? `${assignedBugSpaceStoragePrefix}.${currentUserId}.${scope}`
    : `${assignedBugSpaceStoragePrefix}.${scope}`
}

function readAssignedBugSpaceId(currentUserId: number | undefined, organizationId: OrganizationContext) {
  if (typeof window === 'undefined') return undefined
  const value = Number(window.localStorage.getItem(getAssignedBugSpaceStorageKey(currentUserId, organizationId)))
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

const testWorkbenchViewStatePrefix = 'veges.testWorkbench.viewState.v1'

type TestWorkbenchViewState = {
  selectedBugId?: number
  selectedCaseId?: number
  selectedPlanId?: number
  spaceId?: number
  subjectId?: number
  tab: WorkbenchTab
}

function getTestWorkbenchViewStateStorageKey(currentUserId?: number) {
  return currentUserId ? `${testWorkbenchViewStatePrefix}.${currentUserId}` : ''
}

function readTestWorkbenchViewState(currentUserId?: number): TestWorkbenchViewState | undefined {
  const storageKey = getTestWorkbenchViewStateStorageKey(currentUserId)
  if (typeof window === 'undefined' || !storageKey) return undefined
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null') as unknown
    if (!parsed || typeof parsed !== 'object') return undefined
    const state = parsed as Partial<TestWorkbenchViewState>
    if (
      !state.tab ||
      !(['cases', 'plans', 'bugs', 'weekly_report', 'notifications'] as WorkbenchTab[]).includes(state.tab)
    ) return undefined
    const positiveNumber = (value: unknown) => (
      typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
    )
    return {
      tab: state.tab,
      spaceId: positiveNumber(state.spaceId),
      subjectId: positiveNumber(state.subjectId),
      selectedCaseId: positiveNumber(state.selectedCaseId),
      selectedPlanId: positiveNumber(state.selectedPlanId),
      selectedBugId: positiveNumber(state.selectedBugId),
    }
  } catch {
    return undefined
  }
}

function writeTestWorkbenchViewState(currentUserId: number | undefined, state: TestWorkbenchViewState) {
  const storageKey = getTestWorkbenchViewStateStorageKey(currentUserId)
  if (typeof window === 'undefined' || !storageKey) return
  window.localStorage.setItem(storageKey, JSON.stringify(state))
}

function getTestWorkbenchNotificationKey(notification: TestWorkbenchNotification) {
  return `${notification.kind}:${notification.sourceId}:${notification.createdAt}`
}

function generateTestSpaceInvitePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const values = globalThis.crypto.getRandomValues(new Uint8Array(10))
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join('')
}

function formatInviteDuration(minutes: number) {
  if (minutes === 1440) return '24 小时'
  if (minutes === 240) return '4 小时'
  return `${minutes} 分钟`
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  }).format(new Date(value))
}

function WorkspaceError({ message }: { message: string }) {
  return message ? <div className="test-workbench-error"><WarningCircle /> {message}</div> : null
}

function TestSpaceSelectLabel({
  name,
  organizationName,
  versionLabel,
}: {
  name: string
  organizationName?: string
  versionLabel?: string
}) {
  const metadata = [organizationName, versionLabel].filter(Boolean).join(' · ')

  return (
    <span className="test-space-select-label">
      <span>{name}</span>
      {metadata ? <small>{metadata}</small> : null}
    </span>
  )
}

type TestSpaceOrganizationGroup = {
  id: string
  name: string
  spaces: TestSpaceSettings['spaces']
}

export function TestWorkbench({
  weeklyReportRef,
  navigationBusy = false,
  accountMenu,
  currentUserId,
  projects,
  refreshToken = 0,
  workspaceContent,
}: {
  navigationBusy?: boolean
  weeklyReportRef?: { current: WeeklyReportWorkbenchHandle | null }
  accountMenu: ReactNode
  currentUserId?: number
  projects: TestWorkbenchProjectOption[]
  refreshToken?: number
  workspaceContent?: ReactNode
}) {
  const [data, setData] = useState<TestWorkbenchData>(emptyWorkbench)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<WorkbenchTab>('cases')
  const [spaceId, setSpaceId] = useState<number>()
  const [subjectId, setSubjectId] = useState<number>()
  const actionScope = `${currentUserId}:${spaceId}:${subjectId}:${tab}`
  const actionScopeRef = useRef(actionScope)
  useEffect(() => { actionScopeRef.current = actionScope }, [actionScope])
  const { confirmAction, confirmationDialog } = useConfirmAction(actionScope)
  const [selectedCaseId, setSelectedCaseId] = useState<number>()
  const [selectedPlanId, setSelectedPlanId] = useState<number>()
  const [selectedBugId, setSelectedBugId] = useState<number>()
  const [bugFilterDialogOpen, setBugFilterDialogOpen] = useState(false)
  const [bugFilterJoin, setBugFilterJoin] = useState<BugFilterJoin>('and')
  const [bugFilterConditions, setBugFilterConditions] = useState<BugFilterCondition[]>([])
  const [bugSearchQuery, setBugSearchQuery] = useState('')
  const [spaceSwitcherOpen, setSpaceSwitcherOpen] = useState(false)
  const [environmentManagerOpen,setEnvironmentManagerOpen]=useState(false)
  const [environmentDetail,setEnvironmentDetail]=useState<OrganizationDetail|null>(null)
  const [environmentError,setEnvironmentError]=useState('')
  const [environmentBusy,setEnvironmentBusy]=useState(false)
  const [spaceAdministrationOpen, setSpaceAdministrationOpen] = useState(false)
  const [spaceCreateOpen, setSpaceCreateOpen] = useState(false)
  const [spaceSettings, setSpaceSettings] = useState<TestSpaceSettings>(emptyTestSpaceSettings)
  const [subjectDialogOpen, setSubjectDialogOpen] = useState(false)
  const [editingSubject, setEditingSubject] = useState<TestSubject>()
  const [subjectPendingDelete, setSubjectPendingDelete] = useState<TestSubject>()
  const [subjectDeleteDialogOpen, setSubjectDeleteDialogOpen] = useState(false)
  const [caseTargetFolderId, setCaseTargetFolderId] = useState<number | null>(null)
  const [caseDialogOpen, setCaseDialogOpen] = useState(false)
  const [caseImportDialogOpen, setCaseImportDialogOpen] = useState(false)
  const [editingCase, setEditingCase] = useState<TestCase>()
  const [casePendingDelete, setCasePendingDelete] = useState<TestCase>()
  const [caseDeleteDialogOpen, setCaseDeleteDialogOpen] = useState(false)
  useEffect(() => {
    setCaseDialogOpen(false)
    setCaseImportDialogOpen(false)
    setCaseDeleteDialogOpen(false)
    setCaseTargetFolderId(null)
    setEditingCase(undefined)
    setCasePendingDelete(undefined)
  }, [spaceId, subjectId])
  const [planDialogOpen, setPlanDialogOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<TestPlan>()
  const [planPendingDelete, setPlanPendingDelete] = useState<TestPlan>()
  const [planDeleteDialogOpen, setPlanDeleteDialogOpen] = useState(false)
  const [bugDialogOpen, setBugDialogOpen] = useState(false)
  const [bugSeed, setBugSeed] = useState<Partial<TestBug>>({})
  const [editingBug, setEditingBug] = useState<TestBug>()
  const [bugPendingDelete, setBugPendingDelete] = useState<TestBug>()
  const [bugDeleteDialogOpen, setBugDeleteDialogOpen] = useState(false)
  const [inviteToken, setInviteToken] = useState(getTestSpaceInviteTokenFromUrl)
  const [invitePasswordChecking, setInvitePasswordChecking] = useState(false)
  const [invitePasswordDraft, setInvitePasswordDraft] = useState('')
  const [invitePasswordRequired, setInvitePasswordRequired] = useState(false)
  const [invitePasswordVerified, setInvitePasswordVerified] = useState(false)
  const [invitePasswordError, setInvitePasswordError] = useState('')
  const [seenBugCommentIds, setSeenBugCommentIds] = useState<Set<number>>(() => readSeenBugCommentIds(currentUserId))
  const [readNotificationKeySet, setReadNotificationKeySet] = useState<Set<string>>(() => loadReadNotificationKeys(currentUserId))
  const acceptingInviteTokenRef = useRef('')
  const refreshInFlightRef = useRef(false)
  const viewStateReadyRef = useRef(false)
  const localWeeklyReportRef = useRef<WeeklyReportWorkbenchHandle>(null)
  const weeklyReportWorkbenchRef = weeklyReportRef ?? localWeeklyReportRef
  async function changeTab(next: WorkbenchTab) {
    if (tab === 'weekly_report' && !(await weeklyReportWorkbenchRef.current?.prepareOrganizationChange() ?? true)) return
    setTab(next)
  }

  useEffect(() => {
    setSeenBugCommentIds(readSeenBugCommentIds(currentUserId))
    setReadNotificationKeySet(loadReadNotificationKeys(currentUserId))
  }, [currentUserId])

  useEffect(() => {
    let cancelled = false
    const savedBeforeLoad = readTestWorkbenchViewState(currentUserId)
    fetchTestWorkbench(savedBeforeLoad?.tab === 'cases' && savedBeforeLoad.spaceId && savedBeforeLoad.subjectId
      ? { spaceId: savedBeforeLoad.spaceId, subjectId: savedBeforeLoad.subjectId }
      : undefined)
      .then((result) => {
        if (cancelled) return
        setData(result)
        const saved = readTestWorkbenchViewState(currentUserId)
        const savedSpaceId = saved?.spaceId && result.spaces.some((space) => space.id === saved.spaceId)
          ? saved.spaceId
          : undefined
        setSpaceId(savedSpaceId ?? result.spaces[0]?.id)
        if (saved && savedSpaceId) {
          if (saved.subjectId != null && result.subjects.some((subject) => (
            subject.id === saved.subjectId && subject.testSpaceId === savedSpaceId
          ))) {
            setSubjectId(saved.subjectId)
          }
          if (saved.selectedCaseId != null && result.cases.some((item) => (
            item.id === saved.selectedCaseId && item.testSpaceId === savedSpaceId
          ))) {
            setSelectedCaseId(saved.selectedCaseId)
          }
          if (saved.selectedPlanId != null && result.plans.some((plan) => (
            plan.id === saved.selectedPlanId && plan.testSpaceId === savedSpaceId
          ))) {
            setSelectedPlanId(saved.selectedPlanId)
          }
          if (saved.selectedBugId != null && result.bugs.some((bug) => (
            bug.id === saved.selectedBugId && bug.testSpaceId === savedSpaceId
          ))) {
            setSelectedBugId(saved.selectedBugId)
          }
        }
        setTab(saved?.tab ?? 'cases')
        viewStateReadyRef.current = true
        setLoading(false)
      })
      .catch((loadError) => {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : '测试工作台加载失败。')
        setLoading(false)
      })
    fetchTestSpaceSettings()
      .then((result) => {
        if (cancelled) return
        setSpaceSettings(result)
        if (result.spaces.length === 0 && result.invitations.length > 0) setTab('notifications')
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [currentUserId])

  useEffect(() => {
    if (!viewStateReadyRef.current) return
    writeTestWorkbenchViewState(currentUserId, {
      tab,
      spaceId,
      subjectId,
      selectedCaseId,
      selectedPlanId,
      selectedBugId,
    })
  }, [tab, spaceId, subjectId, selectedCaseId, selectedPlanId, selectedBugId, currentUserId])

  useEffect(() => {
    if (loading) return
    let cancelled = false
    const refreshIfVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      if (busy) return
      if (refreshInFlightRef.current) return
      refreshInFlightRef.current = true
      Promise.all([
        fetchTestWorkbench(tab === 'cases' && spaceId && subjectId ? { spaceId, subjectId } : undefined)
          .then((result) => {
            if (!cancelled) setData(result)
          })
          .catch(() => undefined),
        fetchTestSpaceSettings()
          .then((result) => {
            if (!cancelled) setSpaceSettings(result)
          })
          .catch(() => undefined),
      ]).then(() => {
        refreshInFlightRef.current = false
      })
    }
    const interval = window.setInterval(refreshIfVisible, notificationRefreshIntervalMs)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [busy, loading, spaceId, subjectId, tab])

  useEffect(() => {
    if (loading || (tab !== 'bugs' && tab !== 'plans')) return
    let cancelled = false
    fetchTestWorkbench().then((result) => {
      if (!cancelled) setData(result)
    }).catch((loadError: unknown) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : '用例加载失败。')
    })
    return () => { cancelled = true }
  }, [loading, tab, spaceId])

  useEffect(() => {
    setInvitePasswordDraft('')
    setInvitePasswordError('')
    setInvitePasswordRequired(false)
    setInvitePasswordVerified(false)
    if (!inviteToken) {
      setInvitePasswordChecking(false)
      return
    }
    let cancelled = false
    setInvitePasswordChecking(true)
    fetchTestSpaceInviteLinkInfo(inviteToken)
      .then((result) => {
        if (cancelled) return
        setInvitePasswordRequired(result.passwordRequired)
        setInvitePasswordVerified(!result.passwordRequired)
      })
      .catch(() => {
        if (cancelled) return
        setError('测试空间邀请链接无效或已失效。')
        setInviteToken('')
        clearTestSpaceInviteTokenFromUrl()
      })
      .finally(() => {
        if (!cancelled) setInvitePasswordChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [inviteToken])

  useEffect(() => {
    if (!inviteToken || invitePasswordChecking) return
    if (invitePasswordRequired && !invitePasswordVerified) return
    if (acceptingInviteTokenRef.current === inviteToken) return
    acceptingInviteTokenRef.current = inviteToken
    acceptTestSpaceInviteLink(inviteToken, invitePasswordDraft.trim() || undefined)
      .then(({ workbench }) => {
        setData(workbench)
        setError('')
        setInviteToken('')
        clearTestSpaceInviteTokenFromUrl()
        void refreshSpaceSettings()
      })
      .catch(() => {
        setInvitePasswordError('测试空间邀请链接无效、已失效或密码不正确。')
        if (invitePasswordRequired) {
          setInvitePasswordVerified(false)
        } else {
          setInviteToken('')
          clearTestSpaceInviteTokenFromUrl()
        }
      })
      .finally(() => {
        acceptingInviteTokenRef.current = ''
      })
  }, [invitePasswordChecking, invitePasswordDraft, invitePasswordRequired, invitePasswordVerified, inviteToken])

  const activeSpace = data.spaces.find((space) => space.id === spaceId)
  const activeManagedSpace = spaceSettings.spaces.find((space) => space.id === spaceId)
  const activeWeeklyReportOrganizationId = activeManagedSpace?.organizationId ?? null
  const testSpaceOrganizationGroups = useMemo<TestSpaceOrganizationGroup[]>(() => {
    const visibleSpaceIds = new Set(data.spaces.map((space) => space.id))
    const groups = new Map<string, TestSpaceOrganizationGroup>()

    for (const organization of spaceSettings.organizations) {
      groups.set(`organization:${organization.id}`, {
        id: `organization:${organization.id}`,
        name: organization.name,
        spaces: [],
      })
    }

    for (const space of spaceSettings.spaces) {
      if (!visibleSpaceIds.has(space.id)) continue
      const groupId = space.organizationId
        ? `organization:${space.organizationId}`
        : 'personal'
      const group = groups.get(groupId) ?? {
        id: groupId,
        name: space.organizationName ?? '未归属组织',
        spaces: [],
      }
      group.spaces.push(space)
      groups.set(groupId, group)
    }

    return Array.from(groups.values())
      .filter((group) => group.spaces.length > 0)
      .map((group) => ({
        ...group,
        spaces: [...group.spaces].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
      }))
  }, [data.spaces, spaceSettings.organizations, spaceSettings.spaces])
  const activeSpaceReadOnly = activeSpace?.accessLevel === 'viewer'
  const subjects = data.subjects.filter((subject) => subject.testSpaceId === spaceId)
  const activeSubject = subjects.find((subject) => subject.id === subjectId)
  const spaceCases = data.cases.filter((testCase) => testCase.testSpaceId === spaceId)
  const cases = spaceCases
  const plans = data.plans.filter(
    (plan) => plan.testSpaceId === spaceId,
  )
  const testEnvironments = (data.testEnvironments ?? []).filter((environment) => (
    spaceId != null && environment.testSpaceIds.includes(spaceId)
  ))
  const bugs = data.bugs.filter(
    (bug) => bug.testSpaceId === spaceId,
  )
  const normalizedBugSearchQuery = bugSearchQuery.trim().toLocaleLowerCase('zh-CN')
  const filteredBugs = useMemo(() => bugs.filter((bug) => {
    if (!matchesBugFilterConditions(bug, bugFilterConditions, bugFilterJoin)) return false
    if (!normalizedBugSearchQuery) return true
    return [
      `bug-${bug.id}`,
      bug.title,
      bug.environment,
      bug.testCaseTitle,
      bug.testCaseId ? `case-${bug.testCaseId}` : '',
      bug.testCaseFolderName,
      bug.testPlanName,
      bug.reporterName,
      bug.assigneeName,
    ].filter(Boolean).some((value) => String(value).toLocaleLowerCase('zh-CN').includes(normalizedBugSearchQuery))
  }), [bugFilterConditions, bugFilterJoin, bugs, normalizedBugSearchQuery])
  const bugFilterOptions = useMemo<BugFilterOptions>(() => ({
    assignees: uniqueBugFilterOptions(bugs, (bug) => bug.assigneeUserId && bug.assigneeName
      ? { label: bug.assigneeName, value: String(bug.assigneeUserId) }
      : undefined),
    plans: uniqueBugFilterOptions(bugs, (bug) => bug.testPlanId && bug.testPlanName
      ? { label: bug.testPlanName, value: String(bug.testPlanId) }
      : undefined),
    reporters: uniqueBugFilterOptions(bugs, (bug) => bug.reporterUserId && bug.reporterName
      ? { label: bug.reporterName, value: String(bug.reporterUserId) }
      : undefined),
    spaces: [],
    ...(() => {
      const folders = data.folders.filter((folder) => folder.testSpaceId === spaceId)
      const index = createDirectoryIndex(folders)
      return {
        cases: data.cases.filter((item) => item.testSpaceId === spaceId).map((item) => ({
          label: `CASE-${item.id} ${item.title}`, value: String(item.id),
          folderIds: index.path(item.folderId ?? null).map((folder) => String(folder.id)),
        })),
        folders: folders.map((folder) => ({
          label: `${data.subjects.find((subject) => subject.id === folder.testSubjectId)?.name || ''} / ${index.path(folder.id).map((item) => item.name).join(' / ')}`,
          value: String(folder.id),
        })),
      }
    })(),
  }), [bugs, data.cases, data.folders, data.subjects, spaceId])
  const returnedBugs: BugReturnNotification[] = data.notifications.flatMap((notification) => {
    if (notification.kind !== 'test_bug_status_changed') return []
    const bug = data.bugs.find((candidate) => candidate.id === notification.sourceId)
    if (!bug || (bug.status !== 'pending_verification' && bug.status !== 'pending_confirmation')) return []
    return [{ bug, notification }]
  })
  const rejectedBugNotifications: BugReturnNotification[] = data.notifications.flatMap((notification) => {
    if (notification.kind !== 'test_bug_rejected') return []
    const bug = data.bugs.find((candidate) => candidate.id === notification.sourceId)
    if (!bug || bug.status !== 'rejected') return []
    return [{ bug, notification }]
  })
  const bugCommentNotifications: BugCommentNotification[] = data.notifications.flatMap((notification) => {
    if (notification.kind !== 'test_bug_comment_added') return []
    for (const bug of data.bugs) {
      const comment = bug.comments.find((candidate) => candidate.id === notification.sourceId)
      if (!comment) continue
      if (bug.status === 'closed' || bug.status === 'rejected') return []
      return [{ bug, comment, notification }]
    }
    return []
  })
  const planAssignmentNotifications: PlanAssignmentNotification[] = currentUserId
    ? data.notifications.flatMap((notification) => {
      if (notification.kind !== 'test_plan_assigned') return []
      const plan = data.plans.find((candidate) => candidate.id === notification.sourceId)
      if (
        !plan ||
        plan.ownerUserId !== currentUserId ||
        plan.createdByUserId === currentUserId ||
        plan.status === 'completed' ||
        plan.status === 'aborted'
      ) return []
      return [{ notification, plan }]
    })
    : []
  const packageEventCommentNotifications = data.notifications.filter(
    (notification) => notification.kind === 'package_event_comment_added',
  )
  const returnedBugUnreadCount = returnedBugs.filter(({ notification }) =>
    !readNotificationKeySet.has(getTestWorkbenchNotificationKey(notification)),
  ).length
  const rejectedBugUnreadCount = rejectedBugNotifications.filter(({ notification }) =>
    !readNotificationKeySet.has(getTestWorkbenchNotificationKey(notification)),
  ).length
  const planAssignmentUnreadCount = planAssignmentNotifications.filter(({ notification }) =>
    !readNotificationKeySet.has(getTestWorkbenchNotificationKey(notification)),
  ).length
  const bugCommentUnreadCount = bugCommentNotifications.filter(({ comment }) => !seenBugCommentIds.has(comment.id)).length
  const packageEventCommentUnreadCount = packageEventCommentNotifications.filter((notification) =>
    !readNotificationKeySet.has(getTestWorkbenchNotificationKey(notification)),
  ).length
  const notificationUnreadCount =
    (spaceSettings.ownershipTransfers?.length ?? 0) + spaceSettings.invitations.length +
    returnedBugUnreadCount +
    rejectedBugUnreadCount +
    bugCommentUnreadCount +
    planAssignmentUnreadCount +
    packageEventCommentUnreadCount

  function markBugCommentAsSeen(commentId?: number) {
    if (!commentId || !currentUserId) return
    setSeenBugCommentIds((current) => {
      if (current.has(commentId)) return current
      const next = new Set(current)
      next.add(commentId)
      writeSeenBugCommentIds(currentUserId, next)
      return next
    })
  }

  function markNotificationAsRead(key?: string) {
    if (!key || !currentUserId) return
    setReadNotificationKeySet((current) => {
      if (current.has(key)) return current
      const next = new Set(current)
      next.add(key)
      writeReadNotificationKeys(currentUserId, next)
      return next
    })
  }

  useEffect(() => {
    if (!spaceId || !data.spaces.some((space) => space.id === spaceId)) {
      setSpaceId(data.spaces[0]?.id)
      return
    }
    if (!subjectId || !subjects.some((subject) => subject.id === subjectId)) {
      setSubjectId(subjects[0]?.id)
    }
  }, [data.spaces, spaceId, subjectId, subjects])

  useEffect(() => {
    if (!cases.some((item) => item.id === selectedCaseId)) setSelectedCaseId(cases[0]?.id)
    if (!plans.some((item) => item.id === selectedPlanId)) setSelectedPlanId(plans[0]?.id)
    if (!filteredBugs.some((item) => item.id === selectedBugId)) setSelectedBugId(filteredBugs[0]?.id)
  }, [bugs, cases, filteredBugs, plans, selectedBugId, selectedCaseId, selectedPlanId])

  useEffect(() => {
    if (subjectDeleteDialogOpen || !subjectPendingDelete) return
    const cleanup = window.setTimeout(() => {
      setSubjectPendingDelete(undefined)
    }, 180)
    return () => window.clearTimeout(cleanup)
  }, [subjectDeleteDialogOpen, subjectPendingDelete])

  useEffect(() => {
    if (caseDeleteDialogOpen || !casePendingDelete) return
    const cleanup = window.setTimeout(() => {
      setCasePendingDelete(undefined)
    }, 180)
    return () => window.clearTimeout(cleanup)
  }, [caseDeleteDialogOpen, casePendingDelete])

  useEffect(() => {
    if (planDeleteDialogOpen || !planPendingDelete) return
    const cleanup = window.setTimeout(() => {
      setPlanPendingDelete(undefined)
    }, 180)
    return () => window.clearTimeout(cleanup)
  }, [planDeleteDialogOpen, planPendingDelete])

  async function mutate(operation: () => Promise<TestWorkbenchData>, confirmed = false, matches: (data: TestWorkbenchData) => boolean = () => false) {
    setBusy(true)
    setError('')
    try {
      const result = confirmed ? await reconcileAction(operation, fetchTestWorkbench, matches) : await operation()
      if (actionScopeRef.current !== actionScope) return false
      setData(result)
      return true
    } catch (mutationError) {
      if (confirmed) throw mutationError
      setError(mutationError instanceof Error ? mutationError.message : '保存失败，请稍后重试。')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function refreshSpaceSettings() {
    try {
      const result = await fetchTestSpaceSettings()
      setSpaceSettings(result)
      return result
    } catch {
      return undefined
    }
  }

  async function refreshWorkbench(preferredSpaceId?: number) {
    const result = await fetchTestWorkbench()
    setData(result)
    setSpaceId((current) => {
      if (preferredSpaceId && result.spaces.some((space) => space.id === preferredSpaceId)) return preferredSpaceId
      if (current && result.spaces.some((space) => space.id === current)) return current
      return result.spaces[0]?.id
    })
    return result
  }

  async function selectTestSpace(nextSpaceId: number) {
    if (nextSpaceId === spaceId) return
    const nextSpace = spaceSettings.spaces.find((space) => space.id === nextSpaceId)
    if (!nextSpace) return
    const nextOrganizationId = nextSpace.organizationId ?? null
    if (tab === 'weekly_report' && activeWeeklyReportOrganizationId !== nextOrganizationId) {
      const prepared = await weeklyReportWorkbenchRef.current?.prepareOrganizationChange() ?? true
      if (!prepared) return
    }
    setSpaceId(nextSpaceId)
  }

  async function handleCreateSpace(name: string, versionLabel: string, organizationId?: number) {
    const normalizedName = name.trim()
    const normalizedVersion = versionLabel.trim()
    if (!normalizedName || !normalizedVersion || organizationId == null) return false
    setBusy(true)
    setError('')
    try {
      const result = await createTestSpace(normalizedName, normalizedVersion, organizationId)
      const createdSpace = result.spaces.find((space) => space.name === normalizedName) ?? result.spaces[0]
      setData(result)
      setSpaceId(createdSpace?.id)
      setTab('cases')
      setSpaceCreateOpen(false)
      await refreshSpaceSettings()
      return true
    } catch (creationError) {
      setError(creationError instanceof Error ? creationError.message : '测试空间创建失败。')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function handleOwnershipTransfer(id:number,action:'accept'|'decline'){
    setBusy(true);setError('')
    try{const result=await respondTestSpaceTransfer(id,action);setSpaceSettings(result.settings);setData(result.workbench)}
    catch(error){setError(error instanceof Error?error.message:'转移处理失败。')}
    finally{setBusy(false)}
  }
  async function openEnvironmentManager(){
    const organizationId=data.spaces.find(s=>s.id===spaceId)?.organizationId
    if(!organizationId)return
    setEnvironmentManagerOpen(true);setEnvironmentDetail(null);setEnvironmentError('');setEnvironmentBusy(true)
    try{setEnvironmentDetail(await fetchOrganization(organizationId))}
    catch(error){setEnvironmentError(error instanceof Error?error.message:'环境加载失败。')}
    finally{setEnvironmentBusy(false)}
  }
  async function handleAcceptInvitation(invitationSpaceId: number) {
    setBusy(true)
    setError('')
    try {
      const result = await acceptTestSpaceInvitation(invitationSpaceId)
      setSpaceSettings(result.settings)
      setData(result.workbench)
      setSpaceId(invitationSpaceId)
      setTab('cases')
      return true
    } catch (invitationError) {
      setError(invitationError instanceof Error ? invitationError.message : '邀请处理失败。')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function handleDeclineInvitation(invitationSpaceId: number) {
    const invitation = spaceSettings.invitations.find((item) => item.spaceId === invitationSpaceId)
    return confirmAction({ title: '确认拒绝测试空间邀请？',
      actionKey: `decline-space:${currentUserId}:${invitationSpaceId}`, description: `“${invitation?.spaceName ?? `测试空间 #${invitationSpaceId}`}”的邀请将退出待处理列表，你不会加入该空间。`, confirmLabel: '拒绝邀请',
    }, async () => {
      setError('')
      const result = await reconcileAction(() => declineTestSpaceInvitation(invitationSpaceId), fetchTestSpaceSettings,
        (data) => !data.invitations.some((item) => item.spaceId === invitationSpaceId))
      if (actionScopeRef.current !== actionScope) return false
      setSpaceSettings(result)
      return true
    })
  }

  async function verifyInvitePassword() {
    const password = invitePasswordDraft.trim()
    if (!inviteToken || !password) return
    setInvitePasswordChecking(true)
    setInvitePasswordError('')
    try {
      await verifyTestSpaceInviteLink(inviteToken, password)
      setInvitePasswordVerified(true)
    } catch {
      setInvitePasswordError('邀请密码不正确，请检查后重试。')
    } finally {
      setInvitePasswordChecking(false)
    }
  }

  return (
    <main className="test-workbench-shell">
      {confirmationDialog}
      <aside className="test-workbench-nav">
        <div className="test-workbench-space-header">
          <div className="brand-block">
            <img className="brand-mark" src="/favicon.svg" alt="Veges" />
            <div>
              <p className="eyebrow">Veges</p>
              <h1>测试工作台</h1>
            </div>
          </div>
          <button
            className="sidebar-notifications-button"
            type="button"
            aria-label="通知中心"
            title="通知中心"
            onClick={() => void changeTab('notifications')}
          >
            <Bell size={18} weight="duotone" />
            {notificationUnreadCount > 0 ? <span className="sidebar-notifications-dot" aria-hidden /> : null}
          </button>
        </div>
        <div className="test-space-switcher">
          <DropdownMenu
            open={spaceSwitcherOpen}
            onOpenChange={setSpaceSwitcherOpen}
          >
            <DropdownMenuTrigger asChild>
              <Button className="test-space-cascade-trigger" type="button" variant="outline" aria-label="选择测试空间">
                <TestSpaceSelectLabel
                  name={activeSpace?.name ?? '选择测试空间'}
                  organizationName={activeManagedSpace?.organizationName ?? (activeManagedSpace ? '未归属组织' : undefined)}
                  versionLabel={activeManagedSpace?.versionLabel ?? activeSpace?.versionLabel}
                />
                <CaretDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="test-space-cascade-content">
              {testSpaceOrganizationGroups.map((group) => (
                <DropdownMenuSub key={group.id}>
                  <DropdownMenuSubTrigger className="test-space-organization-item">
                    <Buildings aria-hidden />
                    <span>{group.name}</span>
                    <small>{group.spaces.length}</small>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="test-space-cascade-space-content">
                    {group.spaces.map((space) => (
                      <DropdownMenuItem
                        key={space.id}
                        className="test-space-cascade-space-item"
                        onSelect={() => void selectTestSpace(space.id)}
                      >
                        {space.id === spaceId ? <Check aria-hidden /> : <span className="test-space-select-check-placeholder" />}
                        <TestSpaceSelectLabel
                          name={space.name}
                          organizationName={group.name}
                          versionLabel={space.versionLabel}
                        />
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ))}
              {testSpaceOrganizationGroups.length > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                onSelect={() => {
                  setSpaceSwitcherOpen(false)
                  setSpaceCreateOpen(true)
                }}
              >
                <Plus aria-hidden />
                新建测试空间
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setSpaceSwitcherOpen(false)
                  setSpaceAdministrationOpen(true)
                }}
              >
                <GearSix aria-hidden />
                管理测试空间
              </DropdownMenuItem>
              {data.spaces.find(s=>s.id===spaceId)?.organizationId ? <DropdownMenuItem onSelect={()=>{setSpaceSwitcherOpen(false);void openEnvironmentManager()}}><GearSix aria-hidden/>管理测试环境</DropdownMenuItem>:null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
          <div className="test-workbench-nav-main">
            <nav className="test-workbench-nav-actions" aria-label="测试工作台模块">
              <button className={tab === 'cases' ? 'active' : ''} onClick={() => void changeTab('cases')}><ClipboardText /><span className="test-nav-label">用例管理</span><span className="test-nav-count">{cases.length}</span></button>
              <button className={tab === 'plans' ? 'active' : ''} onClick={() => void changeTab('plans')}><ListChecks /><span className="test-nav-label">测试计划</span><span className="test-nav-count">{plans.length}</span></button>
              <button className={tab === 'bugs' ? 'active' : ''} onClick={() => void changeTab('bugs')}><Bug /><span className="test-nav-label">Bug 追踪</span><span className="test-nav-count">{bugs.length}</span></button>
              <button className={tab === 'weekly_report' ? 'active' : ''} onClick={() => void changeTab('weekly_report')}><FileText /><span className="test-nav-label">周报管理</span><span className="test-nav-count" /></button>
            </nav>
            {activeSpace && tab === 'cases' ? (
              <section className="test-subject-browser" aria-label="测试对象">
                <header className="test-subject-browser-header">
                  <span>测试对象</span>
                  {!activeSpaceReadOnly ? <Button className="test-subject-add" size="icon" variant="ghost" aria-label="新建测试对象" title="新建测试对象" onClick={() => { setEditingSubject(undefined); setSubjectDialogOpen(true) }}><Plus /></Button> : null}
                </header>
                <div className="test-subject-list">
                  {subjects.length ? subjects.map((subject) => (
                    <article key={subject.id} className={subject.id === subjectId ? 'active' : ''}>
                      <button
                        type="button"
                        className="test-subject-select"
                        aria-current={subject.id === subjectId ? 'true' : undefined}
                        onClick={() => setSubjectId(subject.id)}
                      >
                        <strong>{subject.name}</strong>
                      </button>
                      {!activeSpaceReadOnly && (subject.canEdit || subject.canDelete) ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              className="test-subject-menu-trigger"
                              size="icon"
                              type="button"
                              variant="ghost"
                              aria-label={`测试对象 ${subject.name} 更多操作`}
                              title="更多操作"
                            >
                              <DotsThreeVertical aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="test-subject-menu-content" sideOffset={8}>
                            {subject.canEdit ? (
                              <DropdownMenuItem
                                className="test-subject-menu-item"
                                onSelect={() => { setEditingSubject(subject); setSubjectDialogOpen(true) }}
                              >
                                <PencilSimple />
                                编辑
                              </DropdownMenuItem>
                            ) : null}
                            {subject.canEdit && subject.canDelete ? <DropdownMenuSeparator /> : null}
                            {subject.canDelete ? (
                              <DropdownMenuItem
                                className="test-subject-menu-item"
                                variant="destructive"
                                onSelect={() => {
                                  setSubjectPendingDelete(subject)
                                  setSubjectDeleteDialogOpen(true)
                                }}
                              >
                                <Trash />
                                删除
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </article>
                  )) : <p className="test-subject-list-empty">暂无测试对象</p>}
                </div>
              </section>
            ) : null}
          </div>
          <div className="test-workbench-account">{accountMenu}</div>
      </aside>

      <section className="test-workbench-content">
          {workspaceContent ?? (loading ? (
            <div className="test-workbench-loading">正在加载测试工作台...</div>
          ) : tab === 'weekly_report' ? (
            <div className="test-workbench-weekly-report">
              <WeeklyReportWorkbench
                navigationBusy={navigationBusy}
                activeProfile="tester"
                ref={weeklyReportWorkbenchRef}
                embedded
                organizationId={activeWeeklyReportOrganizationId}
                refreshToken={refreshToken}
              />
            </div>
          ) : tab === 'notifications' ? (
            <>
              <WorkspaceError message={error} />
              <NotificationsView
                busy={busy}
                data={data}
                bugCommentNotifications={bugCommentNotifications}
                ownershipTransfers={spaceSettings.ownershipTransfers ?? []}
                onRespondOwnershipTransfer={(id,action)=>void handleOwnershipTransfer(id,action)}
                invitations={spaceSettings.invitations}
                planAssignmentNotifications={planAssignmentNotifications}
                readNotificationKeys={readNotificationKeySet}
                rejectedBugNotifications={rejectedBugNotifications}
                returnedBugs={returnedBugs}
                seenBugCommentIds={seenBugCommentIds}
                onAcceptInvitation={(invitation) => void handleAcceptInvitation(invitation.spaceId)}
                onDeclineInvitation={(invitation) => void handleDeclineInvitation(invitation.spaceId)}
                onOpenBug={(bug, notification, commentId) => {
                  markNotificationAsRead(getTestWorkbenchNotificationKey(notification))
                  markBugCommentAsSeen(commentId)
                  setSpaceId(bug.testSpaceId)
                  setSubjectId(bug.testSubjectId)
                  setSelectedBugId(bug.id)
                  setTab('bugs')
                }}
                onOpenPlan={(plan, notification) => {
                  markNotificationAsRead(getTestWorkbenchNotificationKey(notification))
                  setSpaceId(plan.testSpaceId)
                  setSelectedPlanId(plan.id)
                  setTab('plans')
                }}
                onMarkNotificationRead={(notification) => markNotificationAsRead(getTestWorkbenchNotificationKey(notification))}
              />
            </>
          ) : data.spaces.length === 0 ? (
            <div className="test-workbench-empty">
              <Flask size={34} weight="duotone" />
              <h1>建立第一个测试空间</h1>
              <p>测试空间用于隔离测试对象、用例、计划和 Bug，不依赖现有项目。</p>
              <div className="test-empty-actions">
                <Button onClick={() => setSpaceCreateOpen(true)}><Plus /> 新增测试空间</Button>
              </div>
              <WorkspaceError message={error} />
            </div>
          ) : tab === 'cases' && subjects.length === 0 ? (
            <div className="test-inline-empty">
              <WorkspaceError message={error} />
              <Flask size={30} />
              <h2>{activeSpaceReadOnly ? '暂无测试对象' : '先创建测试对象'}</h2>
              <p>{activeSpaceReadOnly ? '当前测试空间还没有测试对象。' : '测试对象可以是应用、服务或产品，也可以选择性关联现有项目。'}</p>
              {!activeSpaceReadOnly ? <div className="test-empty-actions">
                <Button onClick={() => { setEditingSubject(undefined); setSubjectDialogOpen(true) }}><Plus /> 新建测试对象</Button>
              </div> : null}
            </div>
          ) : tab === 'cases' ? (
            <>
              <WorkspaceError message={error} />
              <CasesView
                key={`${spaceId}`}
                busy={busy}
                subjectId={subjects[0]?.id}
                spaceId={spaceId}
                onCreateFolder={(name, parentId) => mutate(() => createTestCaseFolder(spaceId!, { name, parentId, testSubjectId: subjects[0]!.id }))}
                onUpdateFolder={(folder, name, parentId) => mutate(() => updateTestCaseFolder(spaceId!, folder.id, { name, parentId }))}
                onDeleteFolder={(folder) => mutate(() => deleteTestCaseFolder(spaceId!, folder.id), true,
                  (next) => !next.folders.some((item) => item.id === folder.id))}
                onMove={(ids, target) => mutate(() => moveTestCases(spaceId!, subjects[0]!.id, ids, target))}
                cases={cases}
                data={data}
                readOnly={activeSpaceReadOnly}
                selectedId={selectedCaseId}
                onSelect={setSelectedCaseId}
                onCreate={(folderId) => { setCaseTargetFolderId(folderId); setEditingCase(undefined); setCaseDialogOpen(true) }}
                onDelete={(testCase) => {
                  setCasePendingDelete(testCase)
                  setCaseDeleteDialogOpen(true)
                }}
                onEdit={(testCase) => { setEditingCase(testCase); setCaseDialogOpen(true) }}
                onExport={(items, folderId) => downloadTestCaseCsv(items, data.folders, folderId)}
                onImport={(folderId) => { setCaseTargetFolderId(folderId); setCaseImportDialogOpen(true) }}
              />
            </>
          ) : tab === 'plans' ? (
            <>
              <WorkspaceError message={error} />
              <PlansView
                busy={busy}
                data={data}
                plans={plans}
                projects={projects}
                readOnly={activeSpaceReadOnly}
                selectedId={selectedPlanId}
                onSelect={setSelectedPlanId}
                onCreate={() => { setEditingPlan(undefined); setPlanDialogOpen(true) }}
                onDelete={(plan) => {
                  setPlanPendingDelete(plan)
                  setPlanDeleteDialogOpen(true)
                }}
                onEdit={(plan) => { setEditingPlan(plan); setPlanDialogOpen(true) }}
                onRemoveCase={(plan, planCaseId) => void confirmAction({
                  title: '确认从计划移除用例？', description: `「${plan.name}」中的「${data.planCases.find((item) => item.id === planCaseId)?.snapshotTitle ?? planCaseId}」快照将移除，源用例保留。`, confirmLabel: '移除用例',
                }, () => mutate(() => removeTestPlanCase(plan.testSpaceId, plan.id, planCaseId), true,
                  (next) => !next.planCases.some((item) => item.id === planCaseId)))}
                onStatus={(plan, status) => {
                  if (plan.status === status) return
                  if (status === 'completed' || status === 'aborted') {
                    void confirmAction({ title: `确认${status === 'completed' ? '完成' : '终止'}测试计划？`,
                      description: `「${plan.name}」将变为${planStatusLabel[status]}，并退出相关待处理提醒。执行记录保留，可在原测试空间的计划中查看。`,
                      confirmLabel: status === 'completed' ? '确认完成' : '确认终止', variant: 'default',
                    }, () => mutate(() => updateTestPlanStatus(plan.testSpaceId, plan.id, status), true,
                      (next) => next.plans.some((item) => item.id === plan.id && item.status === status)))
                  } else void mutate(() => updateTestPlanStatus(plan.testSpaceId, plan.id, status))
                }}
                onResult={(planCaseId, result) => void mutate(() => updateTestPlanCase(spaceId!, planCaseId, { result }))}
                onCreateBug={(plan, planCase) => {
                  setEditingBug(undefined)
                  setBugSeed({
                    actualResult: planCase.resultNote,
                    environment: plan.environment,
                    expectedResult: planCase.snapshotExpectedResult,
                    reproductionSteps: planCase.snapshotSteps,
                    testPlanCaseId: planCase.id,
                    testCaseId: planCase.testCaseId,
                    testPlanId: plan.id,
                    testSubjectId: planCase.testSubjectId ?? plan.testSubjectId,
                    title: planCase.snapshotTitle,
                  })
                  setBugDialogOpen(true)
                }}
              />
            </>
          ) : (
            <>
              <WorkspaceError message={error} />
              <BugsView
                bugs={filteredBugs}
                busy={busy}
                data={data}
                draftOwnerUserId={currentUserId}
                filterConditions={bugFilterConditions}
                onFilterOpenChange={setBugFilterDialogOpen}
                onFilterClear={() => setBugFilterConditions([])}
                searchQuery={bugSearchQuery}
                onSearchQueryChange={setBugSearchQuery}
                readOnly={activeSpaceReadOnly}
                selectedId={selectedBugId}
                onSelect={setSelectedBugId}
                onCreate={() => { setEditingBug(undefined); setBugSeed({}); setBugDialogOpen(true) }}
                onEdit={(bug) => { setEditingBug(bug); setBugSeed(bug); setBugDialogOpen(true) }}
                onDelete={(bug) => {
                  setBugPendingDelete(bug)
                  setBugDeleteDialogOpen(true)
                }}
                onStatus={(bug, status) => {
                  if (bug.status === status) return
                  const run = () => mutate(() => updateTestBug(bug.testSpaceId, bug.id, { assigneeUserId: bug.assigneeUserId, status }), true,
                    (next) => next.bugs.some((item) => item.id === bug.id && item.status === status))
                  if (status === 'closed' || status === 'rejected') {
                    void confirmAction({ title: status === 'closed' ? '确认关闭 Bug？' : '确认驳回 Bug？',
                      description: `「${bug.title}」将变为${bugStatusLabel[status]}并退出待处理事项，可在原测试空间按对应状态查看。`,
                      confirmLabel: status === 'closed' ? '确认关闭' : '确认驳回', variant: status === 'closed' ? 'default' : 'destructive',
                    }, run)
                  } else void mutate(() => updateTestBug(bug.testSpaceId, bug.id, { assigneeUserId: bug.assigneeUserId, status }))
                }}
                onTransferSpace={(bug, targetSpaceId, targetTestCaseId) => mutate(() => transferTestBugToSpace(bug.testSpaceId, bug.id, targetSpaceId, targetTestCaseId))}
                onAssignee={(bug, assigneeUserId) => void mutate(() => updateTestBug(bug.testSpaceId, bug.id, { assigneeUserId, status: assigneeUserId ? 'pending_confirmation' : 'new' }))}
                onComment={(bug, content) => mutate(() => addTestBugComment(bug.testSpaceId, bug.id, content))}
                onUpdateComment={(bug, comment, content) => mutate(() => updateTestBugComment(bug.testSpaceId, bug.id, comment.id, content))}
                onDeleteComment={(bug, comment) => mutate(() => deleteTestBugComment(bug.testSpaceId, bug.id, comment.id), true,
                  (next) => next.bugs.some((item) => item.id === bug.id && !item.comments.some((entry) => entry.id === comment.id)))}
              />
            </>
          ))}
      </section>

      <TestSpaceSettingsDialog
        currentSpaceId={spaceId}
        open={spaceAdministrationOpen}
        onOpenChange={setSpaceAdministrationOpen}
        onCreateSpace={() => {
          setSpaceAdministrationOpen(false)
          setSpaceCreateOpen(true)
        }}
        onWorkbenchChange={async () => {
          await refreshWorkbench()
          await refreshSpaceSettings()
        }}
      />
      <BugFilterBuilderDialog
        conditions={bugFilterConditions}
        includeTestSpace={false}
        join={bugFilterJoin}
        open={bugFilterDialogOpen}
        options={bugFilterOptions}
        onOpenChange={setBugFilterDialogOpen}
        onApply={(next) => {
          setBugFilterConditions(next.conditions)
          setBugFilterJoin(next.join)
        }}
      />
      <Dialog open={environmentManagerOpen} onOpenChange={open=>{if(!environmentBusy)setEnvironmentManagerOpen(open)}}><DialogContent className="organization-resource-dialog" fixedHeader><DialogHeader><DialogTitle>管理测试环境</DialogTitle><DialogDescription>当前组织统一配置，所有测试空间共享。</DialogDescription></DialogHeader>
        {environmentError?<p role="alert">{environmentError}</p>:null}
        {!environmentDetail&&environmentBusy?<p role="status">正在加载…</p>:null}
        {environmentDetail && !environmentDetail.canManageTestEnvironments ? <div className="organization-list">{data.testEnvironments.filter(environment=>environment.testSpaceIds.some(id=>data.spaces.some(space=>space.id===id&&space.organizationId===environmentDetail.id))).map(environment=><div key={environment.id} className="organization-resource-row"><strong>{environment.name}</strong><a href={environment.accessUrl} target="_blank" rel="noreferrer">{environment.accessUrl}</a></div>)}</div>:null}
        {environmentDetail?.canManageTestEnvironments?<OrganizationTestEnvironmentPanel busy={environmentBusy} detail={environmentDetail} onMutate={async operation=>{setEnvironmentBusy(true);setEnvironmentError('');try{setEnvironmentDetail(await operation());await refreshWorkbench();return true}catch(error){setEnvironmentError(error instanceof Error?error.message:'环境保存失败。');return false}finally{setEnvironmentBusy(false)}}}/>:null}
      </DialogContent></Dialog>
      <TestSpaceCreateDialog
        busy={busy}
        organizations={spaceSettings.organizations}
        open={spaceCreateOpen}
        onOpenChange={setSpaceCreateOpen}
        onSubmit={handleCreateSpace}
      />
      <TestSpaceInvitePasswordDialog
        busy={invitePasswordChecking}
        error={invitePasswordError}
        open={Boolean(inviteToken && invitePasswordRequired && !invitePasswordVerified)}
        password={invitePasswordDraft}
        onCancel={() => {
          setInviteToken('')
          setInvitePasswordError('')
          clearTestSpaceInviteTokenFromUrl()
        }}
        onPasswordChange={(value) => {
          setInvitePasswordDraft(value)
          setInvitePasswordError('')
        }}
        onSubmit={() => void verifyInvitePassword()}
      />
      <SubjectDialog
        busy={busy}
        open={subjectDialogOpen}
        subject={editingSubject}
        onOpenChange={(nextOpen) => {
          setSubjectDialogOpen(nextOpen)
          if (!nextOpen) setEditingSubject(undefined)
        }}
        onSubmit={async (payload) => {
          const saved = editingSubject
            ? await mutate(() => updateTestSubject(spaceId!, editingSubject.id, payload))
            : await mutate(() => createTestSubject(spaceId!, payload))
          if (saved) setEditingSubject(undefined)
          return saved
        }}
      />
      <ConfirmActionDialog
        key={`subject-delete-${subjectPendingDelete?.id}`}
        actionKey={`delete-subject:${subjectPendingDelete?.id}`}
        open={subjectDeleteDialogOpen}
        onOpenChange={setSubjectDeleteDialogOpen}
        title="删除测试对象"
        description={`删除“${subjectPendingDelete?.name}”后，其用例、测试计划、Bug 和评论也会永久删除。`}
        confirmLabel="删除测试对象"
        confirmDisabled={!subjectPendingDelete}
        onConfirm={() => subjectPendingDelete ? mutate(() => deleteTestSubject(subjectPendingDelete.testSpaceId, subjectPendingDelete.id), true,
          (next) => !next.subjects.some((item) => item.id === subjectPendingDelete.id)) : Promise.resolve(false)}
      />
      <CaseDialog
        defaultFolderId={caseTargetFolderId}
        busy={busy}
        data={data}
        open={caseDialogOpen}
        testCase={editingCase}
        subjectId={subjectId}
        spaceId={spaceId}
        onOpenChange={setCaseDialogOpen}
        onSubmit={async (payload) => {
          const saved = editingCase
            ? await mutate(() => updateTestCase(editingCase.testSpaceId, editingCase.id, payload))
            : await mutate(() => createTestCase(spaceId!, payload))
          if (saved) setCaseDialogOpen(false)
        }}
      />
      <ConfirmActionDialog
        key={`case-delete-${casePendingDelete?.id}`}
        actionKey={`delete-case:${casePendingDelete?.id}`}
        open={caseDeleteDialogOpen}
        onOpenChange={setCaseDeleteDialogOpen}
        title="删除测试用例"
        description={`删除“${casePendingDelete?.title}”后，源用例将永久移除；已加入计划的执行快照继续保留。`}
        confirmLabel="删除测试用例"
        confirmDisabled={!casePendingDelete}
        onConfirm={() => casePendingDelete ? mutate(() => deleteTestCase(casePendingDelete.testSpaceId, casePendingDelete.id), true,
          (next) => !next.cases.some((item) => item.id === casePendingDelete.id)) : Promise.resolve(false)}
      />
      <ImportCasesDialog
        key={`${caseImportDialogOpen}-${spaceId}-${subjectId}-${caseTargetFolderId}`}
        targetFolderId={caseTargetFolderId}
        folders={data.folders.filter(f => f.testSpaceId === spaceId)}
        busy={busy}
        open={caseImportDialogOpen}
        spaceId={spaceId}
        subject={activeSubject}
        onOpenChange={setCaseImportDialogOpen}
        onSubmit={(csvText, directoryMode) => mutate(() => importTestCases(spaceId!, subjects[0]!.id, csvText, { directoryMode, targetFolderId: caseTargetFolderId }))}
      />
      <PlanDialog
        key={`${planDialogOpen}-${editingPlan?.id ?? 'new'}`}
        busy={busy}
        cases={spaceCases}
        folders={data.folders}
        open={planDialogOpen}
        plan={editingPlan}
        planCases={data.planCases}
        projects={projects}
        testEnvironments={data.testEnvironments.filter((environment) => spaceId != null && environment.testSpaceIds.includes(spaceId))}
        subjects={subjects}
        users={data.users}
        onOpenChange={setPlanDialogOpen}
        onSubmit={async (payload) => {
          const saved = editingPlan
            ? await mutate(() => updateTestPlan(editingPlan.testSpaceId, editingPlan.id, payload))
            : await mutate(() => createTestPlan(spaceId!, payload))
          if (saved) setPlanDialogOpen(false)
        }}
      />
      <ConfirmActionDialog
        key={`plan-delete-${planPendingDelete?.id}`}
        actionKey={`delete-plan:${planPendingDelete?.id}`}
        open={planDeleteDialogOpen}
        onOpenChange={setPlanDeleteDialogOpen}
        title="删除测试计划"
        description={`删除“${planPendingDelete?.name}”后，执行快照将永久删除；已创建的 Bug 保留并解除计划关联。`}
        confirmLabel="删除测试计划"
        confirmDisabled={!planPendingDelete}
        onConfirm={() => planPendingDelete ? mutate(() => deleteTestPlan(planPendingDelete.testSpaceId, planPendingDelete.id), true,
          (next) => !next.plans.some((item) => item.id === planPendingDelete.id)) : Promise.resolve(false)}
      />
      <BugDialog
        busy={busy}
        editing={Boolean(editingBug)}
        environments={testEnvironments}
        open={bugDialogOpen}
        seed={bugSeed}
        cases={spaceCases}
        folders={data.folders.filter((folder) => folder.testSpaceId === spaceId)}
        subjects={subjects}
        users={data.users}
        onOpenChange={(open) => {
          setBugDialogOpen(open)
          if (!open) setEditingBug(undefined)
        }}
        onSubmit={async (payload) => {
          const saved = editingBug
            ? await mutate(() => updateTestBug(editingBug.testSpaceId, editingBug.id, payload))
            : await mutate(() => createTestBug(spaceId!, payload))
          if (saved) {
            setBugDialogOpen(false)
            setEditingBug(undefined)
            if (!editingBug) setTab('bugs')
          }
        }}
      />
      <ConfirmActionDialog
        key={`bug-delete-${bugPendingDelete?.id}`}
        actionKey={`delete-bug:${bugPendingDelete?.id}`}
        open={bugDeleteDialogOpen}
        onOpenChange={setBugDeleteDialogOpen}
        title="删除 Bug"
        description={`删除“${bugPendingDelete?.title}”后，评论、分享链接和时间线也会永久删除。`}
        confirmLabel="删除 Bug"
        confirmDisabled={!bugPendingDelete}
        onConfirm={() => bugPendingDelete ? mutate(() => deleteTestBug(bugPendingDelete.testSpaceId, bugPendingDelete.id), true,
          (next) => !next.bugs.some((item) => item.id === bugPendingDelete.id)) : Promise.resolve(false)}
      />
    </main>
  )
}

function NotificationsView({
  bugCommentNotifications,
  busy,
  data,
  ownershipTransfers,
  onRespondOwnershipTransfer,
  invitations,
  onAcceptInvitation,
  onDeclineInvitation,
  onOpenBug,
  onOpenPlan,
  onMarkNotificationRead,
  planAssignmentNotifications,
  readNotificationKeys,
  rejectedBugNotifications,
  returnedBugs,
  seenBugCommentIds,
}: {
  bugCommentNotifications: BugCommentNotification[]
  busy: boolean
  data: TestWorkbenchData
  ownershipTransfers: TestSpaceOwnershipTransfer[]
  onRespondOwnershipTransfer: (id:number,action:'accept'|'decline')=>void
  invitations: TestSpaceInvitation[]
  onAcceptInvitation: (invitation: TestSpaceInvitation) => void
  onDeclineInvitation: (invitation: TestSpaceInvitation) => void
  onOpenBug: (bug: TestBug, notification: TestWorkbenchNotification, commentId?: number) => void
  onOpenPlan: (plan: TestPlan, notification: TestWorkbenchNotification) => void
  onMarkNotificationRead: (notification: TestWorkbenchNotification) => void
  planAssignmentNotifications: PlanAssignmentNotification[]
  readNotificationKeys: Set<string>
  rejectedBugNotifications: BugReturnNotification[]
  returnedBugs: BugReturnNotification[]
  seenBugCommentIds: Set<number>
}) {
  const notificationItems = [
    ...ownershipTransfers.map(transfer=>({createdAt:transfer.createdAt,transfer,key:`ownership-transfer-${transfer.id}`,kind:'ownership_transfer' as const,sortAt:Date.parse(transfer.createdAt)})),
    ...invitations.map((invitation) => ({
      createdAt: invitation.createdAt,
      invitation,
      key: `invitation-${invitation.spaceId}`,
      kind: 'invitation' as const,
      sortAt: Date.parse(invitation.createdAt),
    })),
    ...returnedBugs.map(({ bug, notification }) => ({
      bug,
      createdAt: notification.createdAt,
      key: `bug-${bug.id}`,
      kind: 'bug_return' as const,
      notification,
      notificationKey: getTestWorkbenchNotificationKey(notification),
      sortAt: Date.parse(notification.createdAt),
    })),
    ...rejectedBugNotifications.map(({ bug, notification }) => ({
      bug,
      createdAt: notification.createdAt,
      key: `bug-rejected-${bug.id}`,
      kind: 'bug_rejected' as const,
      notification,
      notificationKey: getTestWorkbenchNotificationKey(notification),
      sortAt: Date.parse(notification.createdAt),
    })),
    ...bugCommentNotifications.map(({ bug, comment, notification }) => ({
      bug,
      comment,
      createdAt: notification.createdAt,
      key: `bug-comment-${comment.id}`,
      kind: 'bug_comment' as const,
      notification,
      notificationKey: getTestWorkbenchNotificationKey(notification),
      sortAt: getTimestampMs(notification.createdAt),
    })),
    ...planAssignmentNotifications.map(({ notification, plan }) => ({
      createdAt: notification.createdAt,
      key: `plan-assignment-${plan.id}`,
      kind: 'plan_assignment' as const,
      notification,
      notificationKey: getTestWorkbenchNotificationKey(notification),
      plan,
      sortAt: getTimestampMs(notification.createdAt),
    })),
    ...data.notifications
      .filter((notification) => notification.kind === 'package_event_comment_added')
      .map((notification) => ({
        createdAt: notification.createdAt,
        key: `package-comment-${notification.sourceId}`,
        kind: 'package_comment' as const,
        notification,
        notificationKey: getTestWorkbenchNotificationKey(notification),
        sortAt: getTimestampMs(notification.createdAt),
      })),
  ].sort((left, right) => {
    const rightTime = Number.isNaN(right.sortAt) ? 0 : right.sortAt
    const leftTime = Number.isNaN(left.sortAt) ? 0 : left.sortAt
    return rightTime - leftTime
  })
  const unreadCount = notificationItems.filter((item) => {
    if (item.kind === 'invitation' || item.kind === 'ownership_transfer') return true
    if (item.kind === 'bug_comment') return !seenBugCommentIds.has(item.comment.id)
    return !readNotificationKeys.has(item.notificationKey)
  }).length
  const readCount = Math.max(0, notificationItems.length - unreadCount)

  return (
    <div className="test-module-view test-notifications-view">
      <div className="test-module-toolbar">
        <div>
          <span>协作消息</span>
          <h1>通知中心</h1>
        </div>
      </div>
      <section className="test-notification-board">
        {notificationItems.length ? (
          <>
          <header>
            <div>
              <strong>待处理通知</strong>
              <small>测试空间邀请、所有权转移、测试计划指派、Bug 返回和协作回复按时间排列。</small>
            </div>
            <div className="test-notification-counts" aria-label="通知已读状态统计">
              {unreadCount > 0 ? <Badge className="test-notification-unread-badge">{unreadCount} 未读</Badge> : null}
              <Badge variant="outline">{readCount} 已读 / {notificationItems.length} 总计</Badge>
            </div>
          </header>
          <div className="test-notification-list">
            {notificationItems.map((item) => {
              if (item.kind === 'ownership_transfer') return <article key={item.key} className="test-notification-card unread"><div className="test-notification-copy"><span className="test-notification-kind unread">所有权转移</span><div><strong>{item.transfer.spaceName}</strong><p>{item.transfer.requestedByName} 申请将测试空间所有权转移给你。接受后你将成为所有者，原所有者保留可编辑权限。</p><small>有效期至 {formatTimestamp(item.transfer.expiresAt)}</small></div></div><div><Button variant="outline" disabled={busy} onClick={()=>onRespondOwnershipTransfer(item.transfer.id,'decline')}>拒绝</Button><Button disabled={busy} onClick={()=>onRespondOwnershipTransfer(item.transfer.id,'accept')}>接受所有权</Button></div></article>
              if (item.kind === 'invitation') {
                const invitation = item.invitation
                return (
                  <article key={item.key} className="test-notification-card unread">
                    <div className="test-notification-copy">
                      <span className="test-notification-kind unread">邀请</span>
                      <div>
                        <strong>{invitation.spaceName}</strong>
                        <p>{invitation.invitedByName} 邀请你加入测试空间。</p>
                        <small>{invitation.accessLevel === 'editor' ? '可编辑' : '只读'} · {formatTimestamp(invitation.createdAt)}</small>
                      </div>
                    </div>
                    <div>
                      <Button variant="outline" disabled={busy} onClick={() => onDeclineInvitation(invitation)}><XCircle /> 拒绝</Button>
                      <Button disabled={busy} onClick={() => onAcceptInvitation(invitation)}><CheckCircle /> 接受</Button>
                    </div>
                  </article>
                )
              }
              if (item.kind === 'plan_assignment') {
                const plan = item.plan
                const spaceName = data.spaces.find((space) => space.id === plan.testSpaceId)?.name ?? '未知测试空间'
                const subjectNames = (plan.testSubjectIds.length ? plan.testSubjectIds : [plan.testSubjectId])
                  .map((id) => data.subjects.find((subject) => subject.id === id)?.name)
                  .filter(Boolean)
                  .join('、') || '未关联测试对象'
                const read = readNotificationKeys.has(item.notificationKey)
                return (
                  <article key={item.key} className={read ? 'test-notification-card read' : 'test-notification-card unread'}>
                    <div className="test-notification-copy">
                      <span className={read ? 'test-notification-kind' : 'test-notification-kind unread'}>计划指派</span>
                      <div>
                        <strong>PLAN-{plan.id} · {plan.name}</strong>
                        <p>这个测试计划已指派给你，需要跟进执行。</p>
                        <small>{spaceName} · {subjectNames} · {formatTimestamp(item.createdAt)}</small>
                      </div>
                    </div>
                    <div>
                      <Button variant="outline" onClick={() => onOpenPlan(plan, item.notification)}><ListChecks /> 查看计划</Button>
                    </div>
                  </article>
                )
              }
              if (item.kind === 'package_comment') {
                const notification = item.notification
                const read = readNotificationKeys.has(item.notificationKey)
                return (
                  <article key={item.key} className={read ? 'test-notification-card read' : 'test-notification-card unread'}>
                    <div className="test-notification-copy">
                      <span className={read ? 'test-notification-kind' : 'test-notification-kind unread'}>交付反馈</span>
                      <div>
                        <strong>{notification.eventTitle || '交付事件'}</strong>
                        <p>{notification.authorName} 在交付反馈中提到了你{notification.commentPreview ? `：“${notification.commentPreview}”` : '。'}</p>
                        <small>{notification.projectName || '项目' } · {formatTimestamp(item.createdAt)}</small>
                      </div>
                    </div>
                    <div>
                      <Button
                        disabled={read}
                        variant="outline"
                        onClick={() => onMarkNotificationRead(notification)}
                      >
                        <CheckCircle /> {read ? '已读' : '标记已读'}
                      </Button>
                    </div>
                  </article>
                )
              }
              const bug = item.bug
              const spaceName = data.spaces.find((space) => space.id === bug.testSpaceId)?.name ?? '未知测试空间'
              const caseName = bug.testCaseId ? `CASE-${bug.testCaseId} ${bug.testCaseTitle || ''}` : '待补关联'
              if (item.kind === 'bug_comment') {
                const comment = item.comment
                const read = seenBugCommentIds.has(comment.id)
                return (
                  <article key={item.key} className={read ? 'test-notification-card read' : 'test-notification-card unread'}>
                    <div className="test-notification-copy">
                      <span className={read ? 'test-notification-kind' : 'test-notification-kind unread'}>Bug 回复</span>
                      <div>
                        <strong>BUG-{bug.id} · {bug.title}</strong>
                        <p>{comment.authorName} 添加了协作备注，需要测试侧查看。</p>
                        <small>{spaceName} · {caseName} · {formatTimestamp(item.createdAt)}</small>
                      </div>
                    </div>
                    <div>
                      <Button variant="outline" onClick={() => onOpenBug(bug, item.notification, comment.id)}><Bug /> 查看 Bug</Button>
                    </div>
                  </article>
                )
              }
              if (item.kind === 'bug_rejected') {
                const read = readNotificationKeys.has(item.notificationKey)
                return (
                  <article key={item.key} className={read ? 'test-notification-card read' : 'test-notification-card unread'}>
                    <div className="test-notification-copy">
                      <span className={read ? 'test-notification-kind' : 'test-notification-kind unread'}>Bug 驳回</span>
                      <div>
                        <strong>BUG-{bug.id} · {bug.title}</strong>
                        <p>开发工程师驳回了这个 Bug，需要测试侧处理。</p>
                        <small>{spaceName} · {caseName} · {formatTimestamp(item.createdAt)}</small>
                      </div>
                    </div>
                    <div>
                      <Button variant="outline" onClick={() => onOpenBug(bug, item.notification)}><Bug /> 查看 Bug</Button>
                    </div>
                  </article>
                )
              }
              const read = readNotificationKeys.has(item.notificationKey)
              return (
                <article key={item.key} className={read ? 'test-notification-card read' : 'test-notification-card unread'}>
                  <div className="test-notification-copy">
                    <span className={read ? 'test-notification-kind' : 'test-notification-kind unread'}>Bug 返回</span>
                    <div>
                      <strong>BUG-{bug.id} · {bug.title}</strong>
                      <p>{bugStatusLabel[bug.status]}，需要测试侧回看。</p>
                      <small>{spaceName} · {caseName} · {formatTimestamp(item.createdAt)}</small>
                    </div>
                  </div>
                  <div>
                    <Button variant="outline" onClick={() => onOpenBug(bug, item.notification)}><Bug /> 查看 Bug</Button>
                  </div>
                </article>
              )
            })}
          </div>
          </>
        ) : (
          <div className="test-notification-empty">
            <Bell size={30} />
            <strong>暂时没有需要处理的通知。</strong>
            <p>收到测试空间邀请、Bug 返回或协作回复后，会在这里按时间展示。</p>
          </div>
        )}
      </section>
    </div>
  )
}

export function CasesView({ busy, subjectId, spaceId, cases, data, readOnly, selectedId, onCreate, onCreateFolder, onUpdateFolder, onDeleteFolder, onMove, onDelete, onEdit, onExport, onImport, onSelect }: {
  busy: boolean
  subjectId?: number
  spaceId?: number
  onUpdateFolder: (folder: TestCaseFolder, name: string, parentId: number | null) => Promise<boolean>
  onDeleteFolder: (folder: TestCaseFolder) => Promise<boolean>
  onMove: (ids: number[], target: number | null) => Promise<boolean>
  cases: TestCase[]
  data: TestWorkbenchData
  readOnly: boolean
  selectedId?: number
  onCreate: (folderId: number | null) => void
  onCreateFolder: (name: string, parentId: number | null) => Promise<boolean>
  onDelete: (testCase: TestCase) => void
  onEdit: (testCase: TestCase) => void
  onExport: (items: TestCase[], root: number | null) => void
  onImport: (folderId: number | null) => void
  onSelect: (id: number) => void
}) {
  const listPanelRef = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(6)
  const [searchQuery, setSearchQuery] = useState('')
  const [folderFilter, setFolderFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const folders = useMemo(() => data.folders.filter(f => f.testSpaceId === spaceId), [data.folders, spaceId])
  const directoryIndex = useMemo(() => createDirectoryIndex(folders), [folders])
  const treeState = useDirectoryTreeState(folders)
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  const [drawerOpen, setDrawerOpen] = useState(false)
  useEffect(() => { const media = window.matchMedia('(max-width: 760px)'); const change = () => { setNarrow(media.matches); setDrawerOpen(false) }; media.addEventListener('change', change); return () => media.removeEventListener('change', change) }, [])
  const [includeChildren, setIncludeChildren] = useState(true)
  const [panelHidden, setPanelHidden] = useState(() => { try { return localStorage.getItem('veges.case-directories.hidden') === 'true' } catch { return false } })
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set())
  const [moveIds, setMoveIds] = useState<number[]>()
  const [moveTarget, setMoveTarget] = useState<number | null>(null)
  const [moveError, setMoveError] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const effectiveFolderFilter = folderFilter === 'all' || folderFilter === 'uncategorized' || directoryIndex.byId.has(Number(folderFilter)) ? folderFilter : 'all'
  const activeFolderId = effectiveFolderFilter === 'all' || effectiveFolderFilter === 'uncategorized' ? null : Number(effectiveFolderFilter)
  const scopeIds = useMemo(() => activeFolderId === null ? new Set<number>() : includeChildren ? directoryIndex.descendants(activeFolderId) : new Set([activeFolderId]), [activeFolderId, directoryIndex, includeChildren])
  const scopeLabel = activeFolderId === null ? effectiveFolderFilter === 'all' ? '全部用例' : '未分类' : directoryIndex.byId.has(activeFolderId) ? directoryIndex.path(activeFolderId).map(f => f.name).join(' / ') : '目录已删除'
  const selectedCaseIds = cases.filter(c => checkedIds.has(c.id)).map(c => c.id)
  function togglePanel() { if (narrow) { setDrawerOpen(prev => !prev); return } setPanelHidden(prev => { try { localStorage.setItem('veges.case-directories.hidden', String(!prev)) } catch { /* Storage may be disabled. */ } return !prev }) }
  function selectDirectory(id: string) { setFolderFilter(id); setCheckedIds(new Set()); setIncludeChildren(true); setDrawerOpen(false) }
  function startMove(ids: number[]) { setMoveTarget(activeFolderId); setMoveError(''); setMoveIds(ids) }
  const filteredCases = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase('zh-CN')
    return cases.filter((item) => {
      const folderPath = directoryIndex.path(item.folderId ?? null).map(f => f.name).join(' / ')
      const matchesSearch = !normalizedQuery || [
        `CASE-${item.id}`,
        item.title,
        folderPath || '未分类',
        item.preconditions,
        item.steps,
        item.expectedResult,
        item.remarks,
        item.customTags.join(' '),
      ].some((value) => value.toLocaleLowerCase('zh-CN').includes(normalizedQuery))
      const matchesFolder = effectiveFolderFilter === 'all'
        || (effectiveFolderFilter === 'uncategorized' ? !item.folderId : scopeIds.has(item.folderId ?? -1))
      return matchesSearch
        && matchesFolder
        && (typeFilter === 'all' || item.caseType === typeFilter)
        && (priorityFilter === 'all' || item.priority === priorityFilter)
    })
  }, [cases, directoryIndex, effectiveFolderFilter, priorityFilter, searchQuery, typeFilter, scopeIds])
  const selected = filteredCases.find((item) => item.id === selectedId)
  const selectedIndex = filteredCases.findIndex((item) => item.id === selectedId)
  const totalPages = Math.max(1, Math.ceil(filteredCases.length / pageSize))
  const visibleCases = filteredCases.slice(page * pageSize, (page + 1) * pageSize)
  const visibleStart = filteredCases.length === 0 ? 0 : page * pageSize + 1
  const visibleEnd = Math.min((page + 1) * pageSize, filteredCases.length)
  const hasFilters = Boolean(searchQuery.trim()) || folderFilter !== 'all' || typeFilter !== 'all' || priorityFilter !== 'all'

  useEffect(() => {
    const panel = listPanelRef.current
    if (!panel) return
    const updatePageSize = () => {
      const availableHeight = panel.getBoundingClientRect().height - 46
      const nextPageSize = Math.max(2, Math.min(20, Math.floor(availableHeight / 104)))
      setPageSize((current) => current === nextPageSize ? current : nextPageSize)
    }
    updatePageSize()
    const observer = new ResizeObserver(updatePageSize)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages - 1))
  }, [totalPages])

  useEffect(() => {
    setPage(0)
  }, [folderFilter, priorityFilter, searchQuery, typeFilter])

  useEffect(() => {
    if (filteredCases.length > 0 && selectedIndex < 0) onSelect(filteredCases[0].id)
  }, [filteredCases, onSelect, selectedIndex])

  useEffect(() => {
    if (selectedIndex < 0) return
    setPage(Math.floor(selectedIndex / pageSize))
  }, [pageSize, selectedIndex])

  function changePage(nextPage: number) {
    const normalizedPage = Math.max(0, Math.min(totalPages - 1, nextPage))
    setPage(normalizedPage)
    const firstCase = filteredCases[normalizedPage * pageSize]
    if (firstCase) onSelect(firstCase.id)
  }

  return (
    <div className="test-module-view test-cases-module-view">
      <div className="test-module-toolbar">
        <div><span>用例库</span><h1>用例管理</h1></div>
        <div><Button variant="outline" disabled={!filteredCases.length} onClick={() => setExportOpen(true)}><DownloadSimple /> 导出用例 ({filteredCases.length})</Button>{!readOnly && <><Button variant="outline" disabled={!subjectId} onClick={() => onImport(activeFolderId)}><UploadSimple /> 导入用例</Button><Button disabled={!subjectId} onClick={() => onCreate(activeFolderId)}><Plus /> 新建用例</Button></>}</div>
      </div>
      <div className="test-directory-workspace" data-panel-hidden={panelHidden || narrow}>
      <div className="test-directory-desktop" style={{ display: panelHidden || narrow ? 'none' : undefined }}><DirectoryTree viewState={treeState} folders={folders} cases={cases} selected={effectiveFolderFilter} onSelect={selectDirectory} onCollapse={togglePanel} busy={busy} readOnly={readOnly || !subjectId} onCreate={onCreateFolder} onUpdate={onUpdateFolder} onDelete={onDeleteFolder} /></div>
      <Dialog open={narrow && drawerOpen} onOpenChange={setDrawerOpen}><DialogContent className="test-directory-drawer"><DialogHeader><DialogTitle>用例目录</DialogTitle><DialogDescription>选择目录查看对应范围的用例。</DialogDescription></DialogHeader><DirectoryTree viewState={treeState} folders={folders} cases={cases} selected={effectiveFolderFilter} onSelect={selectDirectory} onCollapse={() => setDrawerOpen(false)} busy={busy} readOnly={readOnly || !subjectId} onCreate={onCreateFolder} onUpdate={onUpdateFolder} onDelete={onDeleteFolder} /></DialogContent></Dialog>
      <div className="test-directory-content">
      <div className="test-directory-scope"><Button size="sm" variant="outline" aria-label={(panelHidden || narrow) ? "展开用例目录" : "收缩用例目录"} onClick={togglePanel}><FolderPlus /> {(panelHidden || narrow) ? "展开目录" : "收缩目录"}</Button><strong title={scopeLabel}>{scopeLabel}</strong><span>{filteredCases.length} 条用例</span>{activeFolderId !== null && <Label><Checkbox checked={includeChildren} onCheckedChange={value => setIncludeChildren(value === true)} /> 包含下级目录</Label>}</div>
      <div className="test-case-filters" aria-label="用例搜索与筛选">
        <label className="test-case-search">
          <MagnifyingGlass />
          <Input
            type="search"
            aria-label="搜索用例"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索编号、标题、模块或用例内容"
          />
        </label>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger aria-label="用例类型筛选"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">全部类型</SelectItem>{Object.entries(caseTypeLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger aria-label="用例等级筛选"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">全部等级</SelectItem><SelectItem value="high">P0</SelectItem><SelectItem value="medium">P1</SelectItem><SelectItem value="low">P2</SelectItem></SelectContent>
        </Select>
        <Button
          className="test-case-clear-filters"
          variant="outline"
          aria-label="清除用例筛选"
          disabled={!hasFilters}
          onClick={() => {
            setSearchQuery('')
            selectDirectory('all')
            setTypeFilter('all')
            setPriorityFilter('all')
                  }}
        ><XCircle /> 清除</Button>
      </div>
      {!readOnly && <div className="test-directory-batch"><Label><Checkbox aria-label="选择本页用例" checked={visibleCases.length > 0 && visibleCases.every(c => checkedIds.has(c.id))} onCheckedChange={checked => setCheckedIds(prev => { const next = new Set(prev); visibleCases.forEach(c => { if (checked) next.add(c.id); else next.delete(c.id) }); return next })} /> 本页</Label><span>已选 {selectedCaseIds.length} 条</span><Button size="sm" variant="outline" disabled={busy || !selectedCaseIds.length || selectedCaseIds.length > 1000} onClick={() => startMove(selectedCaseIds)}>迁移用例</Button><Button size="sm" variant="ghost" disabled={!selectedCaseIds.length} onClick={() => setCheckedIds(new Set())}>清空选择</Button><small>单次最多 1000 条</small></div>}
      <div className="test-split-view test-cases-split-view">
        <div ref={listPanelRef} className="test-record-list-panel">
          <div
            className="test-record-list test-case-record-list"
          >
            {filteredCases.length ? visibleCases.map((item) => (
              <div key={item.id} className="test-directory-case-row">{!readOnly && <Checkbox aria-label={`选择 CASE-${item.id}`} checked={checkedIds.has(item.id)} onCheckedChange={value => setCheckedIds(prev => { const next = new Set(prev); if (value) next.add(item.id); else next.delete(item.id); return next })} />}<button className={item.id === selectedId ? 'active' : ''} onClick={() => onSelect(item.id)}>
                <div><code>CASE-{item.id}</code><Badge variant="outline">{caseTypeLabel[item.caseType]}</Badge></div>
                <strong>{item.title}</strong>
                <small>{caseLevelLabel[item.priority]} · {directoryIndex.path(item.folderId ?? null).map(f => f.name).join(' / ') || '未分类'}{item.customTags.length ? ` · ${item.customTags.join('、')}` : ''}</small>
              </button></div>
            )) : <p className="test-list-empty">{cases.length ? '没有符合条件的用例。' : '当前测试对象还没有用例。'}</p>}
          </div>
          <nav className="test-case-pagination" aria-label="用例分页">
            <span className="test-case-pagination-summary">
              <strong>{visibleStart}-{visibleEnd}</strong> / {filteredCases.length}
              <small>每页 {pageSize} 条</small>
            </span>
            <div>
              <Button aria-label="第一页" title="第一页" size="icon" variant="ghost" disabled={page === 0} onClick={() => changePage(0)}><CaretDoubleLeft /></Button>
              <Button aria-label="上一页" title="上一页" size="icon" variant="ghost" disabled={page === 0} onClick={() => changePage(page - 1)}><CaretLeft /></Button>
              <span className="test-case-page-index">{page + 1} / {totalPages}</span>
              <Button aria-label="下一页" title="下一页" size="icon" variant="ghost" disabled={page >= totalPages - 1} onClick={() => changePage(page + 1)}><CaretRight /></Button>
              <Button aria-label="最后一页" title="最后一页" size="icon" variant="ghost" disabled={page >= totalPages - 1} onClick={() => changePage(totalPages - 1)}><CaretDoubleRight /></Button>
            </div>
          </nav>
        </div>
        <div className="test-record-detail">
          {selected ? (
            <>
              <div className="test-detail-heading">
                <div>
                  <code>CASE-{selected.id}</code>
                  <h2>{selected.title}</h2>
                  <p className="test-case-folder">
                    <span>所属目录</span>
                    <strong>{directoryIndex.path(selected.folderId ?? null).map(f => f.name).join(' / ') || '未分类'}</strong>
                  </p>
                </div>
                {!readOnly ? <div><Button variant="outline" onClick={() => onEdit(selected)}>编辑</Button><Button variant="outline" disabled={busy} onClick={() => startMove([selected.id])}>迁移</Button>{selected.canDelete ? <Button variant="destructive" onClick={() => onDelete(selected)}><Trash /> 删除</Button> : null}</div> : null}
              </div>
              <div className="test-detail-meta test-case-detail-meta"><span>类型 <strong>{caseTypeLabel[selected.caseType]}</strong></span><span>等级 <strong>{caseLevelLabel[selected.priority]}</strong></span></div>
              {selected.customTags.length ? <div className="test-case-tags">{selected.customTags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}</div> : null}
              <DetailBlock title="前置条件" content={selected.preconditions} />
              <DetailBlock title="测试步骤" content={selected.steps} />
              <DetailBlock title="预期结果" content={selected.expectedResult} />
              <DetailBlock title="备注" content={selected.remarks} />
            </>
          ) : <div className="test-detail-empty"><ClipboardText size={28} /><p>选择一个用例查看完整内容。</p></div>}
        </div>
      </div>
      </div></div>
      <Dialog open={Boolean(moveIds)} onOpenChange={open => { if (!open && !busy) setMoveIds(undefined) }}><DialogContent><DialogHeader><DialogTitle>迁移 {moveIds?.length ?? 0} 条用例</DialogTitle><DialogDescription>用例编号、内容与已有执行快照保持不变。所有选中用例将一起迁移。</DialogDescription></DialogHeader><DirectoryPicker folders={folders} value={moveTarget} onChange={setMoveTarget} disabled={busy} />{moveError && <p role="alert">{moveError}</p>}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setMoveIds(undefined)}>取消</Button><Button disabled={busy} onClick={async () => { if (!moveIds) return; if (await onMove(moveIds, moveTarget)) { setMoveIds(undefined); setCheckedIds(new Set()) } else setMoveError('迁移失败，请检查权限或刷新后重试。') }}>确认迁移</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={exportOpen} onOpenChange={setExportOpen}><DialogContent><DialogHeader><DialogTitle>导出用例</DialogTitle><DialogDescription>导出“{scopeLabel}”中符合当前筛选的全部 {filteredCases.length} 条用例（包含所有分页）。{activeFolderId !== null ? includeChildren ? '包含下级目录。' : '仅直属用例。' : ''}</DialogDescription></DialogHeader><p>筛选：{searchQuery.trim() ? `搜索“${searchQuery.trim()}”` : "不限关键词"} · {typeFilter === "all" ? "全部类型" : caseTypeLabel[typeFilter as TestCaseType]} · {priorityFilter === "all" ? "全部等级" : caseLevelLabel[priorityFilter as Priority]}</p><p>CSV 保留相对于当前目录的目录路径。</p><DialogFooter><Button variant="outline" onClick={() => setExportOpen(false)}>取消</Button><Button disabled={!filteredCases.length} onClick={() => { onExport(filteredCases, activeFolderId); setExportOpen(false) }}>导出 {filteredCases.length} 条</Button></DialogFooter></DialogContent></Dialog>
    </div>
  )
}

function PlansView({ busy, data, onCreate, onCreateBug, onDelete, onEdit, onRemoveCase, onResult, onSelect, onStatus, plans, projects, readOnly, selectedId }: {
  busy: boolean
  data: TestWorkbenchData
  onCreate: () => void
  onCreateBug: (plan: TestPlan, planCase: TestWorkbenchData['planCases'][number]) => void
  onDelete: (plan: TestPlan) => void
  onEdit: (plan: TestPlan) => void
  onRemoveCase: (plan: TestPlan, planCaseId: number) => void
  onResult: (planCaseId: number, result: TestResult) => void
  onSelect: (id: number) => void
  onStatus: (plan: TestPlan, status: TestPlan['status']) => void
  plans: TestPlan[]
  projects: TestWorkbenchProjectOption[]
  readOnly: boolean
  selectedId?: number
}) {
  const [executionPage, setExecutionPage] = useState(0)
  const [executionPageSize, setExecutionPageSize] = useState(6)
  const [detailExecutionId, setDetailExecutionId] = useState<number>()
  const executionListRef = useRef<HTMLDivElement>(null)
  const selected = plans.find((item) => item.id === selectedId)
  const executions = data.planCases.filter((item) => item.testPlanId === selectedId)
  const detailExecution = executions.find((item) => item.id === detailExecutionId)
  const passed = executions.filter((item) => item.result === 'passed').length
  const executionTotalPages = Math.max(1, Math.ceil(executions.length / executionPageSize))
  const visibleExecutions = executions.slice(
    executionPage * executionPageSize,
    (executionPage + 1) * executionPageSize,
  )
  const executionStart = executions.length === 0 ? 0 : executionPage * executionPageSize + 1
  const executionEnd = Math.min((executionPage + 1) * executionPageSize, executions.length)

  useEffect(() => {
    const list = executionListRef.current
    if (!list || !selectedId) return
    const updatePageSize = () => {
      if (window.matchMedia('(max-width: 760px)').matches) {
        setExecutionPageSize(5)
        return
      }
      const availableHeight = list.getBoundingClientRect().height
      const nextPageSize = Math.max(3, Math.min(20, Math.floor((availableHeight + 8) / PLAN_EXECUTION_ROW_BLOCK_SIZE)))
      setExecutionPageSize((current) => current === nextPageSize ? current : nextPageSize)
    }
    updatePageSize()
    const observer = new ResizeObserver(updatePageSize)
    observer.observe(list)
    return () => observer.disconnect()
  }, [selectedId])

  useEffect(() => {
    setExecutionPage(0)
  }, [selectedId])

  useEffect(() => {
    setExecutionPage((current) => Math.min(current, executionTotalPages - 1))
  }, [executionTotalPages])

  function changeExecutionPage(nextPage: number) {
    setExecutionPage(Math.max(0, Math.min(executionTotalPages - 1, nextPage)))
  }

  return (
    <div className="test-module-view">
      <div className="test-module-toolbar"><div><span>执行与回归</span><h1>测试计划</h1></div>{!readOnly ? <Button onClick={onCreate}><Plus /> 新建计划</Button> : null}</div>
      <div className="test-split-view">
        <div className="test-record-list">
          {plans.length ? plans.map((plan) => {
            const rows = data.planCases.filter((item) => item.testPlanId === plan.id)
            const complete = rows.filter((item) => item.result !== 'untested').length
            return <button key={plan.id} className={plan.id === selectedId ? 'active' : ''} onClick={() => onSelect(plan.id)}><div><code>PLAN-{plan.id}</code><Badge variant="outline">{planStatusLabel[plan.status]}</Badge></div><strong>{plan.name}</strong><small>{complete}/{rows.length} 已执行 · {plan.environment || '未设置环境'}</small></button>
          }) : <p className="test-list-empty">当前测试空间还没有测试计划。</p>}
        </div>
        <div className={selected ? 'test-record-detail test-plan-detail' : 'test-record-detail'}>
          {selected ? <>
            {(() => {
              const planSubjectNames = (selected.testSubjectIds.length ? selected.testSubjectIds : [selected.testSubjectId])
                .map((id) => data.subjects.find((subject) => subject.id === id)?.name)
                .filter(Boolean)
              const ownerName = data.users.find((user) => user.id === selected.ownerUserId)?.displayName || '未分配'
              const projectName = selected.projectId
                ? projects.find((project) => project.id === selected.projectId)?.name || '未知项目'
                : '未关联项目'
              return (
            <div className="test-detail-heading">
              <div>
                <code>PLAN-{selected.id}</code>
                <h2>{selected.name}</h2>
                <p className="test-plan-subtitle">
                  <span>{planSubjectNames.join('、') || '未关联测试对象'}</span>
                  <span>关联项目：{projectName}</span>
                  <span>负责人：{ownerName}</span>
                </p>
              </div>
              <div className="test-plan-heading-actions">
                <Select value={selected.status} onValueChange={(value) => onStatus(selected, value as TestPlan['status'])} disabled={busy || readOnly}>
                  <SelectTrigger className="test-status-select"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="draft">草稿</SelectItem><SelectItem value="in_progress">执行中</SelectItem><SelectItem value="completed">已完成</SelectItem><SelectItem value="aborted">已终止</SelectItem></SelectContent>
                </Select>
                {selected.canManage && !readOnly ? <>
                  <Button variant="outline" disabled={busy} onClick={() => onEdit(selected)}><PencilSimple /> 编辑</Button>
                  <Button variant="destructive" disabled={busy} onClick={() => onDelete(selected)}><Trash /> 删除</Button>
                </> : null}
              </div>
            </div>
              )
            })()}
            <div className="test-plan-progress"><div><strong>{passed}</strong><span>通过</span></div><div><strong>{executions.filter((item) => item.result === 'failed').length}</strong><span>失败</span></div><div><strong>{executions.filter((item) => item.result === 'blocked').length}</strong><span>阻塞</span></div><div><strong>{executions.length ? Math.round((executions.filter((item) => item.result !== 'untested').length / executions.length) * 100) : 0}%</strong><span>进度</span></div></div>
            <div ref={executionListRef} className="test-execution-list">
              {visibleExecutions.map((row) => <article key={row.id}>
                <div className="test-execution-copy"><code>CASE-{row.testCaseId ?? 'SNAPSHOT'}</code><strong>{row.snapshotTitle}</strong><small>{data.subjects.find((subject) => subject.id === row.testSubjectId)?.name || '未知测试对象'}</small></div>
                <Select value={row.result} onValueChange={(value) => onResult(row.id, value as TestResult)} disabled={busy || readOnly}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(resultLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
                <div className="test-execution-actions">
                  <Button variant="outline" onClick={() => setDetailExecutionId(row.id)}><ClipboardText /> 详情</Button>
                  {row.result === 'failed' && !readOnly ? <Button variant="outline" onClick={() => onCreateBug(selected, row)}><Bug /> 创建 Bug</Button> : null}
                  {selected.canManage && !readOnly && row.result === 'untested' ? <Button
                    aria-label={`从计划移除 ${row.snapshotTitle}`}
                    className="test-plan-case-remove"
                    disabled={busy}
                    size="icon"
                    title="从计划移除"
                    variant="ghost"
                    onClick={() => onRemoveCase(selected, row.id)}
                  ><Trash /></Button> : null}
                </div>
              </article>)}
            </div>
            <nav className="test-case-pagination test-plan-pagination" aria-label="计划用例分页">
              <span className="test-case-pagination-summary">
                <strong>{executionStart}-{executionEnd}</strong> / {executions.length}
                <small>每页 {executionPageSize} 条</small>
              </span>
              <div>
                <Button aria-label="第一页" title="第一页" size="icon" variant="ghost" disabled={executionPage === 0} onClick={() => changeExecutionPage(0)}><CaretDoubleLeft /></Button>
                <Button aria-label="上一页" title="上一页" size="icon" variant="ghost" disabled={executionPage === 0} onClick={() => changeExecutionPage(executionPage - 1)}><CaretLeft /></Button>
                <span className="test-case-page-index">{executionPage + 1} / {executionTotalPages}</span>
                <Button aria-label="下一页" title="下一页" size="icon" variant="ghost" disabled={executionPage >= executionTotalPages - 1} onClick={() => changeExecutionPage(executionPage + 1)}><CaretRight /></Button>
                <Button aria-label="最后一页" title="最后一页" size="icon" variant="ghost" disabled={executionPage >= executionTotalPages - 1} onClick={() => changeExecutionPage(executionTotalPages - 1)}><CaretDoubleRight /></Button>
              </div>
            </nav>
          </> : <div className="test-detail-empty"><ListChecks size={28} /><p>选择一个计划开始执行。</p></div>}
        </div>
      </div>
      <PlanCaseDetailDialog planCase={detailExecution} onClose={() => setDetailExecutionId(undefined)} />
    </div>
  )
}

function PlanCaseDetailDialog({ onClose, planCase }: {
  onClose: () => void
  planCase?: TestWorkbenchData['planCases'][number]
}) {
  if (!planCase) return null
  const caseCode = planCase.testCaseId ? `CASE-${planCase.testCaseId}` : `快照-${planCase.id}`
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent fixedHeader className="test-wide-dialog test-plan-case-detail-dialog">
        <DialogHeader>
          <DialogTitle>{caseCode} 用例详情</DialogTitle>
        <DialogDescription>计划创建时保存的执行快照，后续用例修改不会影响本次执行。</DialogDescription>
        </DialogHeader>
        <div className="test-plan-case-snapshot">
          <DetailBlock title="用例名称" content={planCase.snapshotTitle} />
          <DetailBlock title="前置条件" content={planCase.snapshotPreconditions} />
          <DetailBlock title="测试步骤" content={planCase.snapshotSteps} />
          <DetailBlock title="预期结果" content={planCase.snapshotExpectedResult} />
          {planCase.resultNote ? <DetailBlock title="执行备注" content={planCase.resultNote} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function BugsView({ bugs, busy, data, draftOwnerUserId, filterConditions, onAssignee, onComment, onCreate, onDelete, onDeleteComment, onEdit, onFilterClear, onFilterOpenChange, onSelect, onStatus, onTransferSpace, onUpdateComment, readOnly, searchQuery, onSearchQueryChange, selectedId }: {
  bugs: TestBug[]
  busy: boolean
  data: TestWorkbenchData
  draftOwnerUserId?: number
  filterConditions: BugFilterCondition[]
  onAssignee: (bug: TestBug, assigneeUserId?: number) => void
  onComment?: (bug: TestBug, content: string) => Promise<boolean>
  onCreate: () => void
  onDelete: (bug: TestBug) => void
  onDeleteComment: (bug: TestBug, comment: TestBugComment) => Promise<boolean>
  onEdit: (bug: TestBug) => void
  onFilterClear: () => void
  onFilterOpenChange: (open: boolean) => void
  onSearchQueryChange: (value: string) => void
  onSelect: (id: number) => void
  onStatus: (bug: TestBug, status: BugStatus) => void
  onTransferSpace: (bug: TestBug, targetSpaceId: number, targetTestCaseId: number) => Promise<boolean>
  onUpdateComment: (bug: TestBug, comment: TestBugComment, content: string) => Promise<boolean>
  readOnly: boolean
  searchQuery: string
  selectedId?: number
}) {
  const selected = bugs.find((item) => item.id === selectedId)
  return (
    <div className="test-module-view test-bugs-module-view">
      <div className="test-module-toolbar">
        <div><span>缺陷闭环</span><h1>Bug 追踪</h1></div>
        <div className="test-bug-toolbar-actions">
          <label className="test-bug-search">
            <MagnifyingGlass aria-hidden />
            <Input
              aria-label="搜索 Bug"
              placeholder="搜索 Bug 标题、编号或关联信息"
              type="search"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
            />
          </label>
          <Button
            className={filterConditions.length > 0 ? 'todo-filter-open-button active' : 'todo-filter-open-button'}
            type="button"
            variant="outline"
            onClick={() => onFilterOpenChange(true)}
          >
            <FunnelSimple />
            筛选
            {filterConditions.length > 0 ? <span className="test-bug-filter-count">{filterConditions.length}</span> : null}
          </Button>
          {!readOnly ? <Button onClick={onCreate}><Plus /> 新建 Bug</Button> : null}
        </div>
      </div>
      {filterConditions.length > 0 || searchQuery.trim() ? (
        <div className="test-bug-filter-summary">
          <span>当前显示 {bugs.length} 条 Bug</span>
          {filterConditions.length > 0 ? <Button type="button" variant="ghost" onClick={onFilterClear}>清除筛选</Button> : null}
          {searchQuery.trim() ? <Button type="button" variant="ghost" onClick={() => onSearchQueryChange('')}>清除搜索</Button> : null}
        </div>
      ) : null}
      <div className="test-split-view">
          <div className="test-record-list">
            {bugs.length ? bugs.map((bug) => <button key={bug.id} className={bug.id === selectedId ? 'active' : ''} onClick={() => onSelect(bug.id)}><div><code>BUG-{bug.id}</code><Badge className={`test-bug-status ${bug.status}`} variant="outline">{bugStatusLabel[bug.status]}</Badge></div><strong>{bug.title}</strong><small>{formatTimestamp(bug.updatedAt)} · <UserName departedUserIds={data.departedUserIds} name={bug.assigneeName || '未分配'} userId={bug.assigneeUserId} />{bug.assigneeTransferSource === 'offboarding' ? '（离职转移）' : null}</small></button>) : <div className="test-list-empty">{filterConditions.length > 0 || searchQuery.trim() ? <><FunnelSimple size={24} /><span>没有符合当前条件的 Bug。</span>{filterConditions.length > 0 ? <Button type="button" variant="outline" onClick={onFilterClear}>清除筛选</Button> : null}{searchQuery.trim() ? <Button type="button" variant="outline" onClick={() => onSearchQueryChange('')}>清除搜索</Button> : null}</> : '当前测试空间还没有 Bug。'}</div>}
        </div>
        <div className="test-record-detail">
          {selected ? <BugDetail bug={selected} busy={busy} cases={data.cases} departedUserIds={data.departedUserIds} draftOwnerUserId={draftOwnerUserId} readOnly={readOnly} users={data.users} onAssignee={onAssignee} onComment={readOnly ? undefined : onComment} onDelete={onDelete} onDeleteComment={readOnly ? undefined : onDeleteComment} onEdit={onEdit} onStatus={onStatus} onTransferSpace={onTransferSpace} onUpdateComment={readOnly ? undefined : onUpdateComment} /> : <div className="test-detail-empty"><Bug size={28} /><p>选择一个 Bug 查看和流转。</p></div>}
        </div>
      </div>
    </div>
  )
}

function BugDetail({ bug, busy, cases, departedUserIds, draftOwnerUserId, onAssignee, onComment, onDelete, onDeleteComment, onEdit, onStatus, onTransferSpace, onUpdateComment, readOnly, users }: {
  bug: TestBug
  busy: boolean
  cases: TestCase[]
  departedUserIds: readonly number[]
  draftOwnerUserId?: number
  onAssignee: (bug: TestBug, assigneeUserId?: number) => void
  onComment?: (bug: TestBug, content: string) => Promise<boolean>
  onDelete: (bug: TestBug) => void
  onDeleteComment?: (bug: TestBug, comment: TestBugComment) => Promise<boolean>
  onEdit: (bug: TestBug) => void
  onStatus: (bug: TestBug, status: BugStatus) => void
  onTransferSpace: (bug: TestBug, targetSpaceId: number, targetTestCaseId: number) => Promise<boolean>
  onUpdateComment?: (bug: TestBug, comment: TestBugComment, content: string) => Promise<boolean>
  readOnly: boolean
  users: TestWorkbenchData['users']
}) {
  const developers = users.filter((user) => user.roles.includes('developer'))
  const [shareOpen, setShareOpen] = useState(false)
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [transferSpaceOpen, setTransferSpaceOpen] = useState(false)
  const [environmentCopyState, setEnvironmentCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const environmentValue = bug.testEnvironmentAccessUrl || bug.environment

  useEffect(() => {
    setEnvironmentCopyState('idle')
  }, [environmentValue, bug.id])

  async function copyEnvironment() {
    try {
      await navigator.clipboard.writeText(environmentValue)
      setEnvironmentCopyState('copied')
    } catch {
      setEnvironmentCopyState('failed')
    }
  }

  return <>
    <div className="test-detail-heading">
      <div><code>BUG-{bug.id}</code><h2>{bug.title}</h2></div>
      <div className="test-detail-heading-actions">
        {bug.canTransferSpace ? <Button aria-label="转移空间" disabled={busy} onClick={() => setTransferSpaceOpen(true)} size="icon-sm" title="转移空间" variant="outline"><ArrowsLeftRight /></Button> : null}
        <Button aria-label="时间线" onClick={() => setTimelineOpen(true)} size="icon-sm" title="时间线" variant="outline"><Clock /></Button>
        {(bug.status === 'rejected' || bug.status === 'closed') ? <Button variant="outline" disabled={busy || readOnly} onClick={() => onStatus(bug, 'pending_confirmation')}><ArrowCounterClockwise /> 重新打开</Button> : null}
        {bug.canShare ? <Button aria-label="分享 Bug" disabled={busy} onClick={() => setShareOpen(true)} size="icon-sm" title="分享 Bug" variant="outline"><LinkSimple /></Button> : null}
        {bug.canEdit && !readOnly ? <Button aria-label="编辑" disabled={busy} onClick={() => onEdit(bug)} size="icon-sm" title="编辑" variant="outline"><PencilSimple /></Button> : null}
        {bug.canDelete ? <Button aria-label="删除 Bug" disabled={busy} onClick={() => onDelete(bug)} size="icon-sm" title="删除 Bug" variant="destructive"><Trash /></Button> : null}
      </div>
    </div>
    <div className="test-bug-controls"><Label>状态<Select value={visibleBugStatus(bug.status)} onValueChange={(value) => onStatus(bug, selectedBugStatus(bug, value as BugStatus))} disabled={busy || readOnly}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{bugStatusOptions.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Label><Label>负责人<Select value={bug.assigneeUserId ? String(bug.assigneeUserId) : 'none'} onValueChange={(value) => onAssignee(bug, value === 'none' ? undefined : Number(value))} disabled={busy || readOnly}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">未分配</SelectItem>{developers.map((user) => <SelectItem key={user.id} value={String(user.id)}>{user.displayName}</SelectItem>)}</SelectContent></Select></Label></div>
    <div className="test-detail-meta test-bug-detail-meta">
      <span>测试用例 <strong>{bug.testCaseId ? `CASE-${bug.testCaseId} ${bug.testCaseTitle || ''}` : '待补关联'}</strong></span>
      <span>用例目录 <strong>{bug.testCaseId ? bug.testCaseFolderName || '未分类' : '待补关联'}</strong></span>
      {bug.testPlanName ? <span>测试计划 <strong>{bug.testPlanName}</strong></span> : null}
      <span>测试空间 <strong>{bug.testSpaceName || '未记录'}</strong></span>
        <span>空间版本 <span className="test-detail-meta-label"><strong>{bug.testSpaceVersionLabel || '未指定'}</strong>{bug.canTransferSpace ? <Button aria-label="迁移到其他测试空间" className="test-detail-meta-copy" disabled={busy} onClick={() => setTransferSpaceOpen(true)} size="icon-xs" title="迁移到其他测试空间" variant="ghost"><PencilSimple /></Button> : null}</span></span>
      <span>严重程度 <strong>{severityLabel[bug.severity]}</strong></span>
      <span>优先级 <strong>{priorityLabel[bug.priority]}</strong></span>
      <span>
        <span className="test-detail-meta-label">
          环境{bug.testEnvironmentName ? ` · ${bug.testEnvironmentName}` : ''}
          <Button aria-label={environmentCopyState === 'copied' ? '已复制环境链接' : '复制环境链接'} className="test-detail-meta-copy" disabled={!environmentValue} onClick={() => void copyEnvironment()} size="icon-xs" title={environmentCopyState === 'copied' ? '已复制' : environmentCopyState === 'failed' ? '复制失败' : '复制环境链接'} variant="ghost">{environmentCopyState === 'copied' ? <CheckCircle weight="bold" /> : <CopySimple />}</Button>
        </span>
        {bug.testEnvironmentAccessUrl ? <a className="test-environment-link" href={bug.testEnvironmentAccessUrl} rel="noreferrer" target="_blank">{environmentValue}<LinkSimple aria-hidden /></a> : <strong>{environmentValue || '未记录'}</strong>}
      </span>
      <span>更新时间 <strong>{formatTimestamp(bug.updatedAt)}</strong></span>
    </div>
    <DetailBlock title="复现步骤" content={bug.reproductionSteps} /><DetailBlock title="预期结果" content={bug.expectedResult} /><DetailBlock title="实际结果" content={bug.actualResult} />
    <BugVerificationSubmissions bugId={bug.id} submissions={bug.verificationSubmissions} />
    <BugCommentsSection
      bug={bug}
      busy={busy}
      departedUserIds={departedUserIds}
      draftOwnerUserId={draftOwnerUserId}
      placeholder="补充验证信息或处理记录，支持粘贴、拖入或上传图片和视频。"
      onComment={onComment}
      onDeleteComment={onDeleteComment}
      onUpdateComment={onUpdateComment}
    />
    <BugShareDialog bugId={bug.id} open={shareOpen} onOpenChange={setShareOpen} />
    <BugSpaceTransferDialog bug={bug} busy={busy} cases={cases} open={transferSpaceOpen} onOpenChange={setTransferSpaceOpen} onSubmit={onTransferSpace} />
    <BugTimelineDialog bug={bug} departedUserIds={departedUserIds} open={timelineOpen} onOpenChange={setTimelineOpen} />
  </>
}

function BugSpaceTransferDialog({ bug, busy, cases, onOpenChange, onSubmit, open }: {
  bug: TestBug
  busy: boolean
  cases: TestCase[]
  onOpenChange: (open: boolean) => void
  onSubmit: (bug: TestBug, targetSpaceId: number, targetTestCaseId: number) => Promise<boolean>
  open: boolean
}) {
  const [targetSpaceId, setTargetSpaceId] = useState('')
  const [targetCaseId, setTargetCaseId] = useState('')
  const targetCases = cases.filter((item) => String(item.testSpaceId) === targetSpaceId)

  useEffect(() => {
    if (open) { setTargetSpaceId(''); setTargetCaseId('') }
  }, [bug.id, open])

  async function submit() {
    if (!targetSpaceId || !targetCaseId) return
    const transferred = await onSubmit(bug, Number(targetSpaceId), Number(targetCaseId))
    if (transferred) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent fixedHeader className="test-workbench-dialog">
        <DialogHeader>
          <DialogTitle>转移 Bug 到其他空间</DialogTitle>
          <DialogDescription>选择目标测试空间后，Bug 编号、评论、分享链接和时间线都会保留。</DialogDescription>
        </DialogHeader>
        {(bug.transferSpaceCandidates?.length ?? 0) > 0 ? (
          <Label>目标测试空间
            <Select value={targetSpaceId} onValueChange={(value) => { setTargetSpaceId(value); setTargetCaseId('') }}>
              <SelectTrigger aria-label="目标测试空间"><SelectValue placeholder="选择测试空间" /></SelectTrigger>
              <SelectContent>
                {bug.transferSpaceCandidates?.map((space) => (
                  <SelectItem key={space.id} value={String(space.id)}>
                    {space.name}{space.versionLabel ? ` · ${space.versionLabel}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
        ) : <p className="test-list-empty">没有同组织的其他可用测试空间。</p>}
        {targetSpaceId ? <Label>目标测试用例
          <Select value={targetCaseId} onValueChange={setTargetCaseId}>
            <SelectTrigger aria-label="目标测试用例"><SelectValue placeholder="选择测试用例" /></SelectTrigger>
            <SelectContent>{targetCases.map((item) => <SelectItem key={item.id} value={String(item.id)}>CASE-{item.id} {item.title}</SelectItem>)}</SelectContent>
          </Select>
          {!targetCases.length ? <span>目标空间暂无用例，请先创建用例。</span> : null}
        </Label> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={busy || !targetSpaceId || !targetCaseId} onClick={() => void submit()}><ArrowsLeftRight />{busy ? '转移中...' : '确认转移'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BugTimelineDialog({ bug, departedUserIds, onOpenChange, open }: {
  bug: TestBug
  departedUserIds: readonly number[]
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const hasCreatedEvent = bug.events.some((event) => event.eventType === 'created')
  const isNamedTransferComment = (comment: TestBugComment) => (
    comment.kind === 'transfer' && /转移给「([^」]+)」/u.test(comment.content)
  )
  const timeline: Array<{
    actorUserId?: number
    actorName?: string
    assigneeUserId?: number
    assigneeName?: string
    createdAt: string
    eventType: TestBugEvent['eventType'] | 'rejected'
    id: number
    nextSpaceName?: string
    nextSpaceVersionLabel?: string
    nextStatus?: BugStatus
    previousSpaceName?: string
    previousSpaceVersionLabel?: string
    previousStatus?: BugStatus
    transferSource?: 'manual' | 'offboarding'
  }> = [
    ...(hasCreatedEvent ? [] : [{ eventType: 'created' as const, actorName: bug.reporterName, actorUserId: bug.reporterUserId, createdAt: bug.createdAt, id: 0 }]),
    ...bug.comments
      .filter((comment) => comment.kind === 'reject' || isNamedTransferComment(comment))
      .map((comment) => ({
        actorName: comment.authorName,
        actorUserId: comment.authorUserId,
        assigneeName: comment.kind === 'transfer'
          ? (comment.content.match(/转移给「([^」]+)」/u)?.[1] ?? undefined)
          : undefined,
        createdAt: comment.createdAt,
        eventType: comment.kind === 'reject' ? 'rejected' as const : 'transferred' as const,
        id: -comment.id,
      })),
    ...bug.events.map((event) => ({ ...event, actorUserId: event.actorUserId, assigneeUserId: event.assigneeUserId })),
  ].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
  const formatSpace = (name?: string, versionLabel?: string) => (
    name ? `${name} · ${versionLabel ?? '未设置版本'}` : '未知空间'
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bug-timeline-dialog">
        <DialogHeader>
          <DialogTitle>Bug 时间线</DialogTitle>
          <DialogDescription>BUG-{bug.id} · {bug.title}</DialogDescription>
        </DialogHeader>
        <div className="bug-timeline-list">
          {timeline.length === 0 ? (
            <div className="bug-timeline-empty">暂无记录</div>
          ) : timeline.map((event) => (
            <div className="bug-timeline-item" key={event.id}>
              <span className="bug-timeline-icon">{event.eventType === 'created' ? <Plus size={15} /> : event.eventType === 'assigned' ? <UserPlus size={15} /> : event.eventType === 'transferred' || event.eventType === 'space_transferred' ? <ArrowsLeftRight size={15} /> : event.eventType === 'rejected' ? <XCircle size={15} /> : <ArrowCounterClockwise size={15} />}</span>
              <div className="bug-timeline-content">
                {event.eventType === 'created' ? (
                  <strong>创建了 Bug</strong>
                ) : event.eventType === 'assigned' ? (
                  <strong>指派给 <UserName departedUserIds={departedUserIds} name={event.assigneeName ?? '未分配'} userId={event.assigneeUserId} /></strong>
                ) : event.eventType === 'transferred' ? (
                  <strong>转移给 <UserName departedUserIds={departedUserIds} name={event.assigneeName ?? '未分配'} userId={event.assigneeUserId} />{event.transferSource === 'offboarding' ? '（离职转移）' : null}</strong>
                ) : event.eventType === 'space_transferred' ? (
                  <strong>从「{formatSpace(event.previousSpaceName, event.previousSpaceVersionLabel)}」转移到「{formatSpace(event.nextSpaceName, event.nextSpaceVersionLabel)}」</strong>
                ) : event.eventType === 'rejected' ? (
                  <strong>驳回了该 Bug</strong>
                ) : (
                  <strong>状态从「{event.previousStatus ? bugStatusLabel[event.previousStatus] : '未知'}」改为「{event.nextStatus ? bugStatusLabel[event.nextStatus] : '未知'}」</strong>
                )}
                <UserName departedUserIds={departedUserIds} name={event.actorName ?? '未知用户'} userId={event.actorUserId} />
              </div>
              <time>{formatTimestamp(event.createdAt)}</time>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

type BugCommentComposerDraft = {
  context: string
  publishedDraftClearFailed: boolean
  storageFailed: boolean
  value: string
}

function getBugCommentDraftContext(userId: number | undefined, bugId: number) {
  return `${userId ?? 'anonymous'}:${bugId}`
}

function didBugCommentDraftStorageFail(userId: number | undefined, result: { ok: boolean }) {
  return typeof userId === 'number' && Number.isSafeInteger(userId) && userId > 0 && !result.ok
}

function BugCommentsSection({ bug, busy, currentUserId, departedUserIds = [], draftOwnerUserId, mentionMembers, onComment, onDeleteComment, onUpdateComment, placeholder }: {
  bug: TestBug
  busy: boolean
  currentUserId?: number
  departedUserIds?: readonly number[]
  draftOwnerUserId?: number
  mentionMembers?: MentionMember[]
  onComment?: (bug: TestBug, content: string) => Promise<boolean>
  onDeleteComment?: (bug: TestBug, comment: TestBugComment) => Promise<boolean>
  onUpdateComment?: (bug: TestBug, comment: TestBugComment, content: string) => Promise<boolean>
  placeholder: string
}) {
  const draftContext = getBugCommentDraftContext(draftOwnerUserId, bug.id)
  const draftMemoryRef = useRef(new Map<string, string>())
  const draftRevisionRef = useRef(new Map<string, number>())
  const failedDraftContextsRef = useRef(new Set<string>())
  const publishedDraftClearFailedContextsRef = useRef(new Set<string>())
  const previousDraftOwnerUserIdRef = useRef(draftOwnerUserId)
  const mountedRef = useRef(false)
  const [composerDraft, setComposerDraft] = useState<BugCommentComposerDraft>({
    context: '',
    publishedDraftClearFailed: false,
    storageFailed: false,
    value: '',
  })
  const [uploading, setUploading] = useState(false)
  const comment = composerDraft.context === draftContext ? composerDraft.value : ''
  const publishedDraftClearFailed = composerDraft.context === draftContext && composerDraft.publishedDraftClearFailed
  const draftStorageFailed = composerDraft.context === draftContext && composerDraft.storageFailed

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (previousDraftOwnerUserIdRef.current !== draftOwnerUserId) {
      draftMemoryRef.current.clear()
      draftRevisionRef.current.clear()
      failedDraftContextsRef.current.clear()
      publishedDraftClearFailedContextsRef.current.clear()
      previousDraftOwnerUserIdRef.current = draftOwnerUserId
    }

    const cachedDraft = draftMemoryRef.current.get(draftContext)
    if (cachedDraft !== undefined) {
      if (!draftRevisionRef.current.has(draftContext)) draftRevisionRef.current.set(draftContext, 0)
      setComposerDraft({
        context: draftContext,
        publishedDraftClearFailed: publishedDraftClearFailedContextsRef.current.has(draftContext),
        storageFailed: failedDraftContextsRef.current.has(draftContext),
        value: cachedDraft,
      })
    } else {
      const loaded = loadBugCommentDraft(draftOwnerUserId, bug.id)
      draftMemoryRef.current.set(draftContext, loaded.value)
      draftRevisionRef.current.set(draftContext, loaded.revision)
      const storageFailed = didBugCommentDraftStorageFail(draftOwnerUserId, loaded)
      if (storageFailed) failedDraftContextsRef.current.add(draftContext)
      else failedDraftContextsRef.current.delete(draftContext)
      setComposerDraft({
        context: draftContext,
        publishedDraftClearFailed: false,
        storageFailed,
        value: loaded.value,
      })
    }
    setUploading(false)
  }, [bug.id, draftContext, draftOwnerUserId])

  useEffect(() => subscribeBugCommentDraftChanges((changedUserId, changedBugId) => {
    if (changedUserId !== draftOwnerUserId || changedBugId !== bug.id) return
    const loaded = loadBugCommentDraft(draftOwnerUserId, bug.id)
    draftMemoryRef.current.set(draftContext, loaded.value)
    draftRevisionRef.current.set(draftContext, loaded.revision)
    const storageFailed = didBugCommentDraftStorageFail(draftOwnerUserId, loaded)
    if (storageFailed) failedDraftContextsRef.current.add(draftContext)
    else failedDraftContextsRef.current.delete(draftContext)
    publishedDraftClearFailedContextsRef.current.delete(draftContext)
    if (!mountedRef.current) return
    setComposerDraft((current) => current.context === draftContext
      ? {
          context: draftContext,
          publishedDraftClearFailed: false,
          storageFailed,
          value: loaded.value,
        }
      : current)
  }), [bug.id, draftContext, draftOwnerUserId])

  function updateCommentDraft(nextValue: string) {
    const nextRevision = (draftRevisionRef.current.get(draftContext) ?? 0) + 1
    const saved = saveBugCommentDraft(draftOwnerUserId, bug.id, nextValue, nextRevision)
    draftMemoryRef.current.set(draftContext, saved.value)
    draftRevisionRef.current.set(draftContext, saved.revision)
    if (didBugCommentDraftStorageFail(draftOwnerUserId, saved)) failedDraftContextsRef.current.add(draftContext)
    else failedDraftContextsRef.current.delete(draftContext)
    publishedDraftClearFailedContextsRef.current.delete(draftContext)

    setComposerDraft((current) => current.context === draftContext
      ? {
          context: draftContext,
          publishedDraftClearFailed: false,
          storageFailed: failedDraftContextsRef.current.has(draftContext),
          value: nextValue,
        }
      : current)
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const submittedContent = comment
    const submittedContext = draftContext
    const submittedBug = bug
    const submittedUserId = draftOwnerUserId
    const submittedRevision = draftRevisionRef.current.get(submittedContext) ?? 0
    if (!submittedContent.trim() || !onComment) return
    if (!(await onComment(submittedBug, submittedContent))) return
    if (draftRevisionRef.current.get(submittedContext) !== submittedRevision) return

    const cleared = clearBugCommentDraftIfMatches(
      submittedUserId,
      submittedBug.id,
      submittedContent,
      submittedRevision,
    )

    failedDraftContextsRef.current.delete(submittedContext)
    if (cleared.status === 'kept') {
      draftMemoryRef.current.set(submittedContext, cleared.value)
      draftRevisionRef.current.set(submittedContext, cleared.revision)
      publishedDraftClearFailedContextsRef.current.delete(submittedContext)
      if (mountedRef.current) setComposerDraft((current) => current.context === submittedContext && current.value === submittedContent
        ? {
            context: submittedContext,
            publishedDraftClearFailed: false,
            storageFailed: false,
            value: cleared.value,
          }
        : current)
      return
    }

    const clearFailed = didBugCommentDraftStorageFail(submittedUserId, cleared)
    draftMemoryRef.current.set(submittedContext, '')
    draftRevisionRef.current.set(submittedContext, submittedRevision + 1)
    if (clearFailed) publishedDraftClearFailedContextsRef.current.add(submittedContext)
    else publishedDraftClearFailedContextsRef.current.delete(submittedContext)
    if (mountedRef.current) setComposerDraft((current) => current.context === submittedContext && current.value === submittedContent
      ? {
          context: submittedContext,
          publishedDraftClearFailed: clearFailed,
          storageFailed: false,
          value: '',
        }
      : current)
  }

  return (
    <section className="test-comments">
      <h3>协作记录</h3>
      {bug.comments.filter((item) => item.kind !== 'acceptance').map((item) => (
        <BugCommentArticle
          key={item.id}
          bug={bug}
          busy={busy}
          comment={item}
          currentUserId={currentUserId}
          departedUserIds={departedUserIds}
          onDeleteComment={onDeleteComment}
          onUpdateComment={onUpdateComment}
        />
      ))}
      {onComment ? <form
        className="test-comment-composer"
        onSubmit={submitComment}
      >
        <BugEvidenceEditor
          key={draftContext}
          label="添加评论"
          mentionMembers={mentionMembers}
          value={comment}
          placeholder={placeholder}
          onChange={updateCommentDraft}
          onUploadingChange={setUploading}
        />
        {publishedDraftClearFailed ? <p aria-live="polite" className="test-form-error" role="status">评论已发布，但浏览器草稿未能清除；刷新后如再次出现，请勿重复提交。</p> : null}
        {!publishedDraftClearFailed && draftStorageFailed ? <p aria-live="polite" className="test-form-error" role="status">评论草稿无法保存到浏览器，切换页面或刷新前请先复制内容。</p> : null}
        <Button disabled={busy || uploading || !comment.trim()}>{uploading ? '附件上传中...' : '添加评论'}</Button>
      </form> : null}
    </section>
  )
}

function BugCommentArticle({ bug, busy, comment, currentUserId, departedUserIds = [], onDeleteComment, onUpdateComment }: {
  bug: TestBug
  busy: boolean
  comment: TestBugComment
  currentUserId?: number
  departedUserIds?: readonly number[]
  onDeleteComment?: (bug: TestBug, comment: TestBugComment) => Promise<boolean>
  onUpdateComment?: (bug: TestBug, comment: TestBugComment, content: string) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.content)
  const [uploading, setUploading] = useState(false)
  const canManage = comment.kind === 'comment' && Boolean((onUpdateComment || onDeleteComment) && (comment.canEdit || (
    currentUserId != null && comment.authorUserId === currentUserId
  )))
  const canEdit = Boolean(onUpdateComment && canManage)
  const canDelete = Boolean(onDeleteComment && canManage)
  const edited = comment.updatedAt
    ? new Date(comment.updatedAt).getTime() - new Date(comment.createdAt).getTime() > 1000
    : false

  useEffect(() => {
    if (!editing) setDraft(comment.content)
  }, [comment.content, editing])

  return (
    <article className="test-comment-item">
      <div className="test-comment-header">
        <div className="test-comment-byline">
          <UserName departedUserIds={departedUserIds} name={comment.authorName} userId={comment.authorUserId} />
          {comment.kind === 'transfer' ? <Badge variant="outline">转移记录</Badge> : null}
          {comment.kind === 'reject' ? <Badge variant="outline">驳回记录</Badge> : null}
          <span aria-hidden="true">·</span>
          <time>{formatTimestamp(comment.createdAt)}{edited ? ` · 编辑于 ${formatTimestamp(comment.updatedAt)}` : ''}</time>
        </div>
        {(canEdit || canDelete) && !editing ? (
          <div className="test-comment-actions">
            {canEdit ? (
              <Button
                aria-label="编辑协作记录"
                size="icon"
                title="编辑协作记录"
                type="button"
                variant="outline"
                onClick={() => setEditing(true)}
              >
                <PencilSimple />
              </Button>
            ) : null}
            {canDelete ? (
              <ConfirmActionDialog
                title="确认删除协作记录？"
                description={`Bug「${bug.title}」的评论「${comment.content.slice(0, 100)}」将被删除。`}
                confirmLabel="删除评论"
                onConfirm={() => onDeleteComment ? onDeleteComment(bug, comment) : Promise.resolve(false)}
                trigger={<Button aria-label="删除协作记录" className="test-comment-delete-button" disabled={busy} size="icon" title="删除协作记录" type="button" variant="outline"><Trash /></Button>}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      {editing ? (
        <form
          className="test-comment-editor"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!onUpdateComment || !draft.trim()) return
            const saved = await onUpdateComment(bug, comment, draft)
            if (saved) setEditing(false)
          }}
        >
          <BugEvidenceEditor
            label="编辑评论"
            value={draft}
            placeholder="更新协作记录，支持粘贴、拖入或上传图片和视频。"
            onChange={setDraft}
            onUploadingChange={setUploading}
          />
          <div className="test-comment-editor-actions">
            <Button type="button" variant="outline" onClick={() => { setDraft(comment.content); setEditing(false) }}>取消</Button>
            <Button disabled={busy || uploading || !draft.trim()}>{uploading ? '附件上传中...' : '保存'}</Button>
          </div>
        </form>
      ) : comment.kind === 'acceptance' ? (
        <pre className="test-acceptance-command"><code>{comment.content}</code></pre>
      ) : (
        <BugEvidenceContent content={comment.content} emptyText="未填写" />
      )}
    </article>
  )
}

type BugEvidenceAttachment = {
  alt: string
  src: string
  type: 'image' | 'video'
  uploading?: boolean
}

const bugEvidenceAttachmentPattern = /!\[([^\]]*)\]\(([^)\n]+)\)|\[视频：([^\]]*)\]\(([^)\n]+)\)/g

function normalizeBugEvidenceAttachment(attachment: BugEvidenceAttachment, index: number) {
  const fallback = attachment.type === 'video' ? `录屏 ${index + 1}` : `截图 ${index + 1}`
  return {
    ...attachment,
    alt: sanitizeBugEvidenceAlt(attachment.alt) || fallback,
  }
}

function normalizeBugEvidenceAttachments(attachments: BugEvidenceAttachment[]) {
  return attachments
    .filter((attachment) => attachment.src.trim())
    .map(normalizeBugEvidenceAttachment)
}

function parseBugEvidenceContent(content: string) {
  const attachments: BugEvidenceAttachment[] = []
  const textParts: string[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null = bugEvidenceAttachmentPattern.exec(content)

  while (match) {
    textParts.push(content.slice(lastIndex, match.index))
    const imageAlt = match[1]
    const imageSrc = match[2]
    const videoAlt = match[3]
    const videoSrc = match[4]
    attachments.push({
      alt: imageAlt ?? videoAlt ?? '',
      src: imageSrc ?? videoSrc ?? '',
      type: imageSrc ? 'image' : 'video',
    })
    lastIndex = bugEvidenceAttachmentPattern.lastIndex
    match = bugEvidenceAttachmentPattern.exec(content)
  }

  textParts.push(content.slice(lastIndex))
  bugEvidenceAttachmentPattern.lastIndex = 0

  return {
    attachments: normalizeBugEvidenceAttachments(attachments),
    text: attachments.length > 0
      ? textParts.join('').replace(/\n{3,}/g, '\n\n').replace(/\n{2,}$/g, '')
      : textParts.join(''),
  }
}

function sanitizeBugEvidenceAlt(value: string) {
  return value.replace(/[\]\n\r]/g, ' ').trim()
}

function serializeBugEvidenceContent(text: string, attachments: BugEvidenceAttachment[]) {
  const normalizedAttachments = normalizeBugEvidenceAttachments(attachments)
  const attachmentMarkdown = normalizedAttachments
    .map((attachment) => attachment.type === 'video'
      ? `[视频：${attachment.alt}](${attachment.src})`
      : `![${attachment.alt}](${attachment.src})`)
    .join('\n\n')
  const hasText = text.trim().length > 0

  if (hasText && attachmentMarkdown) return `${text}\n\n${attachmentMarkdown}`
  return hasText ? text : attachmentMarkdown
}

function isSupportedBugEvidenceFile(file: File) {
  return file.type.startsWith('image/') || file.type.startsWith('video/')
}

function bugEvidenceFileType(file: File): BugEvidenceAttachment['type'] {
  return file.type.startsWith('video/') ? 'video' : 'image'
}

function BugEvidenceEditor({ label, mentionMembers, onChange, onUploadingChange, placeholder, value }: {
  label: string
  mentionMembers?: MentionMember[]
  onChange: (value: string) => void
  onUploadingChange?: (uploading: boolean) => void
  placeholder: string
  value: string
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { attachments, text } = useMemo(() => parseBugEvidenceContent(value), [value])
  const [textDraft, setTextDraft] = useState(text)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [uploadingAttachmentSrcs, setUploadingAttachmentSrcs] = useState<string[]>([])
  const latestValueRef = useRef(value)
  const lastSerializedValueRef = useRef<string | null>(null)
  const mountedRef = useRef(false)
  const previewAttachment = previewIndex == null ? null : attachments[previewIndex] ?? null
  const uploadingSrcSet = useMemo(() => new Set(uploadingAttachmentSrcs), [uploadingAttachmentSrcs])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    latestValueRef.current = value
  }, [value])

  useEffect(() => {
    if (lastSerializedValueRef.current === value) return
    setTextDraft(text)
  }, [text, value])

  useEffect(() => {
    onUploadingChange?.(uploadingAttachmentSrcs.length > 0)
  }, [onUploadingChange, uploadingAttachmentSrcs.length])

  useEffect(() => {
    if (previewIndex != null && !attachments[previewIndex]) setPreviewIndex(null)
  }, [attachments, previewIndex])

  function commitValue(nextValue: string) {
    latestValueRef.current = nextValue
    lastSerializedValueRef.current = nextValue
    if (mountedRef.current) {
      onChange(nextValue)
      return true
    }
    return false
  }

  function updateEvidence(nextText: string, nextAttachments: BugEvidenceAttachment[]) {
    return commitValue(serializeBugEvidenceContent(nextText, nextAttachments))
  }

  async function handleFiles(files: File[]) {
    const supportedFiles = files.filter(isSupportedBugEvidenceFile)
    if (supportedFiles.length === 0) {
      window.alert('仅支持上传图片或视频文件。')
      return
    }
    if (supportedFiles.length !== files.length) {
      window.alert('已忽略不支持的文件，仅保留图片和视频。')
    }

    const currentContent = parseBugEvidenceContent(latestValueRef.current)
    const pendingAttachments = supportedFiles.map((file, index) => ({
      alt: sanitizeBugEvidenceAlt(file.name) || (file.type.startsWith('video/') ? `录屏 ${currentContent.attachments.length + index + 1}` : `截图 ${currentContent.attachments.length + index + 1}`),
      src: URL.createObjectURL(file),
      type: bugEvidenceFileType(file),
      uploading: true,
    }))
    const pendingSrcs = pendingAttachments.map((attachment) => attachment.src)
    const pendingSrcSet = new Set(pendingSrcs)
    setUploadingAttachmentSrcs((current) => [...new Set([...current, ...pendingSrcs])])
    updateEvidence(currentContent.text, [...currentContent.attachments, ...pendingAttachments])

    try {
      const uploads = await Promise.all(supportedFiles.map(uploadWorkbenchAttachment))
      if (!mountedRef.current) return
      const uploadedAttachmentsByPendingSrc = new Map(
        pendingAttachments.map((pendingAttachment, index) => [
          pendingAttachment.src,
          {
            alt: pendingAttachment.alt,
            src: uploads[index]?.attachmentUrl ?? uploads[index]?.imageUrl ?? '',
            type: pendingAttachment.type,
          },
        ]),
      )
      const latestContent = parseBugEvidenceContent(latestValueRef.current)
      const nextAttachments = latestContent.attachments.flatMap((attachment) => {
        const uploadedAttachment = uploadedAttachmentsByPendingSrc.get(attachment.src)
        return uploadedAttachment?.src ? [uploadedAttachment] : [attachment]
      })
      updateEvidence(latestContent.text, nextAttachments)
    } catch (error) {
      if (!mountedRef.current) return
      const latestContent = parseBugEvidenceContent(latestValueRef.current)
      const changed = updateEvidence(
        latestContent.text,
        latestContent.attachments.filter((attachment) => !pendingSrcSet.has(attachment.src)),
      )
      console.error('Bug evidence attachment upload failed', error)
      if (mountedRef.current && changed) {
        window.alert(error instanceof Error && error.message
          ? `附件上传失败：${error.message}`
          : '附件上传失败，请稍后重试。')
      }
    } finally {
      if (mountedRef.current) {
        setUploadingAttachmentSrcs((current) => current.filter((src) => !pendingSrcSet.has(src)))
      }
      pendingAttachments.forEach((attachment) => URL.revokeObjectURL(attachment.src))
    }
  }

  async function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && (item.type.startsWith('image/') || item.type.startsWith('video/')))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
    if (files.length === 0) return
    event.preventDefault()
    await handleFiles(files)
  }

  async function handleDrop(event: DragEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) return
    event.preventDefault()
    await handleFiles(files)
  }

  return (
    <section className={attachments.length > 0 ? 'test-evidence-editor has-attachments' : 'test-evidence-editor'}>
      <div className="test-evidence-editor-header">
        <span>{label}</span>
        <Button
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadSimple /> 上传图片/视频
        </Button>
      </div>
      <div className="test-evidence-composer">
        {attachments.length > 0 ? (
          <div className="test-evidence-attachments" aria-label={`${label}包含 ${attachments.length} 个附件`}>
            {attachments.map((attachment, index) => {
              const uploading = uploadingSrcSet.has(attachment.src) || attachment.uploading
              return (
                <figure className="test-evidence-attachment" key={`${attachment.src.slice(0, 48)}-${index}`}>
                  <button
                    aria-label={`查看${attachment.type === 'video' ? '视频' : '图片'} ${index + 1}`}
                    className={uploading ? 'test-evidence-attachment-preview uploading' : 'test-evidence-attachment-preview'}
                    disabled={uploading}
                    type="button"
                    onClick={() => setPreviewIndex(index)}
                  >
                    {attachment.type === 'video' ? (
                      <>
                        <video src={attachment.src} muted preload="metadata" />
                        <span className="test-evidence-video-chip">视频</span>
                      </>
                    ) : (
                      <img src={attachment.src} alt={attachment.alt} loading="lazy" />
                    )}
                    {uploading ? <span className="test-evidence-uploading-chip">上传中</span> : null}
                  </button>
                  <button
                    aria-label={`删除附件 ${index + 1}`}
                    className="test-evidence-attachment-remove"
                    type="button"
                    onClick={() => updateEvidence(
                      textDraft,
                      attachments.filter((_, attachmentIndex) => attachmentIndex !== index),
                  )}
                >
                    <X size={13} />
                  </button>
                </figure>
              )
            })}
          </div>
        ) : null}
        <MentionTextarea
          className="test-evidence-textarea"
          members={mentionMembers}
          placeholder={placeholder}
          value={textDraft}
          onChange={(nextText) => {
            setTextDraft(nextText)
            updateEvidence(nextText, attachments)
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('Files')) event.preventDefault()
          }}
          onDrop={(event) => {
            void handleDrop(event)
          }}
          onPaste={(event) => {
            void handlePaste(event)
          }}
        />
        <input
          ref={fileInputRef}
          accept="image/*,video/mp4,video/webm,video/quicktime"
          className="test-evidence-file-input"
          multiple
          type="file"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ''
            void handleFiles(files)
          }}
        />
      </div>
      <EvidencePreviewDialog
        attachment={previewAttachment}
        onClose={() => setPreviewIndex(null)}
      />
    </section>
  )
}

function EvidencePreviewDialog({ attachment, onClose }: {
  attachment: BugEvidenceAttachment | null
  onClose: () => void
}) {
  return (
    <Dialog open={Boolean(attachment)} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="test-evidence-preview-dialog" showCloseButton={false}>
        <DialogTitle className="test-evidence-preview-title">附件预览</DialogTitle>
        {attachment ? (
          <div className="test-evidence-preview-shell">
            {attachment.type === 'video' ? (
              <video className="test-evidence-preview-media" controls src={attachment.src} />
            ) : (
              <img className="test-evidence-preview-media" src={attachment.src} alt={attachment.alt} />
            )}
            <button
              aria-label="关闭附件预览"
              className="test-evidence-preview-close"
              type="button"
              onClick={onClose}
            >
              <XCircle size={18} weight="fill" />
            </button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function BugEvidenceContent({ content, emptyText = '未填写', title = '附件' }: {
  content: string
  emptyText?: string
  title?: string
}) {
  const { attachments, text } = useMemo(() => parseBugEvidenceContent(content), [content])
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const previewAttachment = previewIndex == null ? null : attachments[previewIndex] ?? null

  useEffect(() => {
    if (previewIndex != null && !attachments[previewIndex]) setPreviewIndex(null)
  }, [attachments, previewIndex])

  return (
    <div className="test-evidence-content">
      {text.trim() ? <p>{text}</p> : attachments.length === 0 ? <p>{emptyText}</p> : null}
      {attachments.length > 0 ? (
        <div className="test-evidence-viewer-attachments" aria-label={`${title}包含 ${attachments.length} 个附件`}>
          {attachments.map((attachment, index) => (
            <figure className="test-evidence-viewer-attachment" key={`${attachment.src.slice(0, 48)}-${index}`}>
              <button
                aria-label={`查看${attachment.type === 'video' ? '视频' : '图片'} ${index + 1}`}
                className="test-evidence-attachment-preview"
                type="button"
                onClick={() => setPreviewIndex(index)}
              >
                {attachment.type === 'video' ? (
                  <>
                    <video src={attachment.src} muted preload="metadata" />
                    <span className="test-evidence-video-chip">视频</span>
                  </>
                ) : (
                  <img src={attachment.src} alt={attachment.alt} loading="lazy" />
                )}
              </button>
            </figure>
          ))}
        </div>
      ) : null}
      <EvidencePreviewDialog attachment={previewAttachment} onClose={() => setPreviewIndex(null)} />
    </div>
  )
}

function DetailBlock({ content, title }: { content: string; title: string }) {
  return (
    <section className="test-detail-block">
      <h3>{title}</h3>
      <BugEvidenceContent content={content} title={title} />
    </section>
  )
}

function BugVerificationSubmissions({ bugId, submissions = [] }: {
  bugId: number
  submissions?: TestBug['verificationSubmissions']
}) {
  return (
    <section className="test-verification-history">
      <div className="test-acceptance-records-heading">
        <h3>验收记录</h3>
        <span>交付物摘要与验证脚本</span>
      </div>
      {submissions.length === 0 ? <p className="test-verification-empty">暂无验收记录</p> : submissions.map((submission) => (
        <BugAcceptanceRecord bugId={bugId} key={submission.id} submission={submission} />
      ))}
    </section>
  )
}

function BugAcceptanceRecord({ bugId, submission }: {
  bugId: number
  submission: NonNullable<TestBug['verificationSubmissions']>[number]
}) {
  const [expireMinutes, setExpireMinutes] = useState<30 | 60 | 120>(30)
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')
  const hasPackages = submission.packages.length > 0
  const packageSelections = useMemo(() => Array.from(new Map(
    submission.packages.map((item) => [item.sourcePackageId, item]),
  ).values()), [submission.packages])

  useEffect(() => {
    setCopyState('idle')
    setExpireMinutes(30)
  }, [submission.id])

  async function copyVerificationScript() {
    setCopyState('copying')
    try {
      if (!navigator.clipboard) throw new Error('Clipboard is not available')
      const result = await fetchTestBugVerificationScript(
        bugId,
        submission.id,
        hasPackages ? expireMinutes : undefined,
      )
      await navigator.clipboard.writeText(result.script)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <article className="test-verification-history-item">
      <div className="test-verification-history-head">
        <div>
          <Badge variant="outline">{hasPackages ? '安装包' : '集群镜像'}</Badge>
          <strong>{submission.submittedByName || '未知用户'}</strong>
        </div>
        <time>{formatTimestamp(submission.submittedAt)}</time>
      </div>
      {submission.containerImages.length > 0 ? (
        <ul className="test-verification-history-images">
          {submission.containerImages.map((item) => <li key={item.id}><code>{item.image}</code></li>)}
        </ul>
      ) : packageSelections.length === 0 ? (
        <p className="test-verification-empty">历史记录未关联交付物</p>
      ) : (
        <ul>
          {packageSelections.map((item) => (
            <li key={item.id}>
              <strong>{item.sourcePackageName || item.packageName}</strong>
              <span>{item.channelLabel} · {item.arch} · {item.version}</span>
            </li>
          ))}
        </ul>
      )}
      {hasPackages || submission.containerImages.length > 0 ? (
        <div className="test-acceptance-record-actions">
          {hasPackages ? (
            <Label className="test-acceptance-expiry">下载链接有效期
              <Select value={String(expireMinutes)} onValueChange={(value) => setExpireMinutes(Number(value) as 30 | 60 | 120)}>
                <SelectTrigger aria-label="下载链接有效期"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 分钟（推荐）</SelectItem>
                  <SelectItem value="60">1 小时</SelectItem>
                  <SelectItem value="120">2 小时</SelectItem>
                </SelectContent>
              </Select>
            </Label>
          ) : <span className="test-acceptance-direct-run">直接使用集群镜像运行</span>}
          <Button
            aria-label={copyState === 'copied' ? '已复制验证脚本' : '复制验证脚本'}
            disabled={copyState === 'copying'}
            title={copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败，请重试' : '复制验证脚本'}
            type="button"
            onClick={() => void copyVerificationScript()}
          >
            {copyState === 'copied' ? <CheckCircle weight="bold" /> : <CopySimple />}
            {copyState === 'copying' ? '生成中...' : copyState === 'copied' ? '已复制验证脚本' : '复制验证脚本'}
          </Button>
        </div>
      ) : null}
      {copyState === 'failed' ? <p className="test-form-error" role="status">验证脚本生成或复制失败，请重试。</p> : null}
    </article>
  )
}

function TestSpaceCreateDialog({ busy, onOpenChange, onSubmit, open, organizations }: {
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string, versionLabel: string, organizationId?: number) => Promise<boolean>
  open: boolean
  organizations: TestSpaceSettings['organizations']
}) {
  const [name, setName] = useState('')
  const [versionLabel, setVersionLabel] = useState('')
  const [organizationValue, setOrganizationValue] = useState('')

  useEffect(() => {
    if (!open) {
      setName('')
      setVersionLabel('')
      setOrganizationValue('')
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent fixedHeader className="test-workbench-dialog">
        <DialogHeader>
          <DialogTitle>新建测试空间</DialogTitle>
          <DialogDescription>测试空间用于隔离测试对象、用例、计划和 Bug，也可以归属到你所在的组织。</DialogDescription>
        </DialogHeader>
        <form
          className="test-dialog-form"
          onSubmit={async (event) => {
            event.preventDefault()
            const saved = await onSubmit(
              name,
              versionLabel,
              organizationValue ? Number(organizationValue) : undefined,
            )
            if (saved) {
              setName('')
              setVersionLabel('')
              setOrganizationValue('')
            }
          }}
        >
          <Label>
            空间名称
            <Input autoFocus maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：Sealos Pro 测试组" />
          </Label>
          <Label>
            版本号
            <Input maxLength={80} value={versionLabel} onChange={(event) => setVersionLabel(event.target.value)} placeholder="例如：v1.2.3" />
          </Label>
          <Label>
            归属组织
            <Select value={organizationValue} onValueChange={(value) => { if (value) setOrganizationValue(value) }}>
              <SelectTrigger aria-label="测试空间归属组织"><SelectValue placeholder="选择归属组织" /></SelectTrigger>
              <SelectContent>
                {organizations.map((organization) => (
                  <SelectItem key={organization.id} value={String(organization.id)}>{organization.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button disabled={busy || !name.trim() || !versionLabel.trim() || !organizationValue}><Plus /> 创建空间</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TestSpaceDataImportDialog({ busy, error, onOpenChange, onSubmit, open, spaces, targetSpaceId }: {
  busy: boolean
  error: string
  onOpenChange: (open: boolean) => void
  onSubmit: (sources: TestSpaceImportSource[]) => Promise<TestSpaceDataImportResult | null>
  open: boolean
  spaces: TestSpaceSettings['spaces']
  targetSpaceId: number
}) {
  const [selections, setSelections] = useState<Record<number, TestSpaceImportCategory[]>>({})
  const [status, setStatus] = useState('')
  const sourceSpaces = spaces.filter((space) => space.accessLevel === 'owner' && space.id !== targetSpaceId)
  const options: Array<{ category: TestSpaceImportCategory; label: string; action: string }> = [
    { action: '复制到当前空间', category: 'cases', label: '全部用例' },
    { action: '复制到当前空间', category: 'plans', label: '全部测试计划' },
  ]

  useEffect(() => {
    if (open) {
      setSelections({})
      setStatus('')
    }
  }, [open, targetSpaceId])

  function toggleCategory(spaceId: number, category: TestSpaceImportCategory, checked: boolean) {
    setSelections((current) => {
      const categories = new Set(current[spaceId] ?? [])
      if (checked) categories.add(category)
      else categories.delete(category)
      return { ...current, [spaceId]: Array.from(categories) }
    })
  }

  function toggleSpace(spaceId: number, checked: boolean) {
    setSelections((current) => ({
      ...current,
      [spaceId]: checked ? options.map((option) => option.category) : [],
    }))
  }

  async function submit() {
    const sources = Object.entries(selections)
      .map(([spaceId, categories]) => ({ categories, spaceId: Number(spaceId) }))
      .filter((source) => source.categories.length > 0)
    if (sources.length === 0) return
    const result = await onSubmit(sources)
    if (!result) return
    setStatus(`已复制 ${result.copiedCases} 个用例、${result.copiedPlans} 个测试计划`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent fixedHeader className="test-space-data-import-dialog">
        <DialogHeader>
          <DialogTitle>数据转入</DialogTitle>
          <DialogDescription>选择来源测试空间和要转入的数据。</DialogDescription>
        </DialogHeader>
        <WorkspaceError message={error} />
        <div className="test-space-import-list">
          {sourceSpaces.length === 0 ? <p className="test-list-empty">没有可用的来源测试空间。</p> : sourceSpaces.map((space) => {
            const selected = selections[space.id] ?? []
            return (
              <section className="test-space-import-source" key={space.id}>
                <div className="test-space-import-source-heading">
                  <label><Checkbox aria-label={`选择${space.name}`} checked={selected.length === options.length ? true : selected.length > 0 ? 'indeterminate' : false} onCheckedChange={(checked) => toggleSpace(space.id, checked === true)} /><strong>{space.name}</strong></label>
                  <small>{space.versionLabel || '未指定版本号'}</small>
                </div>
                <div className="test-space-import-options">
                  {options.map((option) => (
                    <label key={option.category}>
                      <Checkbox checked={selected.includes(option.category)} onCheckedChange={(checked) => toggleCategory(space.id, option.category, checked === true)} />
                      <span>{option.label}</span>
                      <Badge variant="outline">{option.action}</Badge>
                    </label>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
        {status ? <p className="test-space-import-status">{status}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
          <Button disabled={busy || Object.values(selections).every((categories) => categories.length === 0)} onClick={() => void submit()}><DownloadSimple />{busy ? '转入中...' : '开始转入'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TestSpaceSettingsDialog({ currentSpaceId, onCreateSpace, onOpenChange, onWorkbenchChange, open }: {
  currentSpaceId?: number
  onCreateSpace: () => void
  onOpenChange: (open: boolean) => void
  onWorkbenchChange: () => Promise<void>
  open: boolean
}) {
  const [settings, setSettings] = useState<TestSpaceSettings>(emptyTestSpaceSettings)
  const [selectedSpaceId, setSelectedSpaceId] = useState<number>()
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [versionLabel, setVersionLabel] = useState('')
  const [organizationValue, setOrganizationValue] = useState('none')
  const [inviteUsername, setInviteUsername] = useState('')
  const [memberAccess, setMemberAccess] = useState<'editor' | 'viewer'>('editor')
  const [deleteSpaceOpen, setDeleteSpaceOpen] = useState(false)
  const [inviteLinkAccess, setInviteLinkAccess] = useState<'editor' | 'viewer'>('editor')
  const [inviteExpiresInMinutes, setInviteExpiresInMinutes] = useState(10)
  const [encryptedInviteShare, setEncryptedInviteShare] = useState(false)
  const [inviteLinkStatus, setInviteLinkStatus] = useState('')
  const [dataImportOpen, setDataImportOpen] = useState(false)
  const [dataImportBusy, setDataImportBusy] = useState(false)
  const [dataImportError, setDataImportError] = useState('')
  const selectedSpace = settings.spaces.find((space) => space.id === selectedSpaceId)
  const isOwner = selectedSpace?.accessLevel === 'owner'
  const canManageSettings = selectedSpace?.canManageSettings ?? isOwner
  const canManageMembers = selectedSpace?.canManageMembers ?? isOwner
  const canDelete = selectedSpace?.canDelete ?? isOwner
  const actionScope = `${open}:${selectedSpaceId}`
  const actionScopeRef = useRef(actionScope)
  useEffect(() => { actionScopeRef.current = actionScope }, [actionScope])
  const { confirmAction, confirmationDialog } = useConfirmAction(actionScope)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError('')
    fetchTestSpaceSettings()
      .then((result) => {
        setSettings(result)
        setSelectedSpaceId((current) => {
          if (result.spaces.some((space) => space.id === current)) return current
          if (result.spaces.some((space) => space.id === currentSpaceId)) return currentSpaceId
          return result.spaces[0]?.id
        })
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : '测试空间加载失败。'))
      .finally(() => setLoading(false))
  }, [currentSpaceId, open])

  useEffect(() => {
    setRenameValue(selectedSpace?.name ?? '')
    setVersionLabel(selectedSpace?.versionLabel ?? '')
    setOrganizationValue(selectedSpace?.organizationId ? String(selectedSpace.organizationId) : 'none')
    setDeleteSpaceOpen(false)
    setInviteUsername('')
    setInviteLinkStatus('')
  }, [selectedSpace?.id, selectedSpace?.name, selectedSpace?.organizationId, selectedSpace?.versionLabel])

  async function mutateSettings(
    operation: () => Promise<TestSpaceSettings>,
    onSuccess?: (result: TestSpaceSettings) => void,
    confirmed = false,
    matches: (data: TestSpaceSettings) => boolean = () => false,
  ) {
    setBusy(true)
    setError('')
    try {
      const result = confirmed ? await reconcileAction(operation, fetchTestSpaceSettings, matches) : await operation()
      if (actionScopeRef.current !== actionScope) return false
      setSettings(result)
      setSelectedSpaceId((current) => result.spaces.some((space) => space.id === current) ? current : result.spaces[0]?.id)
      onSuccess?.(result)
      try { await onWorkbenchChange() } catch { /* The settings write already succeeded. */ }
      return true
    } catch (mutationError) {
      if (confirmed) throw mutationError
      setError(mutationError instanceof Error ? mutationError.message : '测试空间保存失败。')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function copyInviteLink() {
    if (!selectedSpace || !canManageMembers) return
    setBusy(true)
    setInviteLinkStatus('')
    try {
      const password = encryptedInviteShare ? generateTestSpaceInvitePassword() : undefined
      const inviteLink = await createTestSpaceInviteLink(selectedSpace.id, {
        accessLevel: inviteLinkAccess,
        expiresInMinutes: inviteExpiresInMinutes,
        password,
      })
      const inviteUrl = buildTestSpaceInviteUrl(inviteLink.token)
      const shareText = password
        ? `邀请你加入 ${selectedSpace.name} 测试空间，请点击此链接进入：${inviteUrl}，密码：${password}`
        : inviteUrl
      if (!navigator.clipboard) throw new Error('Clipboard is not available')
      await navigator.clipboard.writeText(shareText)
      setInviteLinkStatus(`已复制，${formatInviteDuration(inviteLink.expiresInMinutes)}内有效`)
    } catch {
      setInviteLinkStatus('复制失败，请稍后再试。')
    } finally {
      setBusy(false)
    }
  }

  async function importData(sources: TestSpaceImportSource[]) {
    if (!selectedSpace || !isOwner) return null
    setDataImportBusy(true)
    setDataImportError('')
    try {
      const result = await importTestSpaceData(selectedSpace.id, sources)
      setSettings(result.settings)
      await onWorkbenchChange()
      return result.result
    } catch (mutationError) {
      setDataImportError(mutationError instanceof Error ? mutationError.message : '数据转入失败。')
      return null
    } finally {
      setDataImportBusy(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent fixedHeader className="test-space-admin-dialog">
        <DialogHeader>
          <DialogTitle>管理测试空间</DialogTitle>
          <DialogDescription>维护测试空间信息、组织归属、成员与协作权限。</DialogDescription>
        </DialogHeader>
        {confirmationDialog}
        <ConfirmActionDialog
          key={`space-delete-${selectedSpace?.id}`}
          actionKey={`delete-space:${selectedSpace?.id}`}
          open={deleteSpaceOpen && open}
          onOpenChange={setDeleteSpaceOpen}
          title="确认删除测试空间？"
          description={`「${selectedSpace?.name}」及其全部测试对象、用例、计划、Bug 和评论将永久删除。`}
          confirmationName={selectedSpace?.name ?? ''}
          confirmDisabled={!selectedSpace}
          confirmLabel="删除测试空间"
          onConfirm={() => selectedSpace ? mutateSettings(
            () => deleteTestSpace(selectedSpace.id, selectedSpace.name),
            (result) => setSelectedSpaceId(result.spaces[0]?.id), true,
            (next) => !next.spaces.some((space) => space.id === selectedSpace.id),
          ) : Promise.resolve(false)}
        />
        <WorkspaceError message={error} />
        {loading ? <p className="test-list-empty">正在加载测试空间...</p> : (
          <div className="test-space-admin-layout">
            <section className="test-space-admin-list-pane">
              <div className="test-space-admin-list-toolbar">
                <strong>我的测试空间</strong>
                <Button type="button" variant="outline" onClick={onCreateSpace}><Plus /> 新建</Button>
              </div>
              <div className="test-space-admin-list">
                {settings.spaces.map((space) => (
                  <button key={space.id} type="button" className={space.id === selectedSpaceId ? 'active' : ''} onClick={() => setSelectedSpaceId(space.id)}>
                    <strong>{space.name}</strong>
                    <small>{space.accessLevel === 'owner' ? '所有者' : space.canManageSettings ? '组织管理' : space.accessLevel === 'editor' ? '可编辑' : '只读'} · {space.members.filter((member) => member.status === 'active').length} 位成员 · {space.organizationName ?? '无组织'}</small>
                  </button>
                ))}
                {settings.spaces.length === 0 ? <p className="test-list-empty">还没有已加入的测试空间。</p> : null}
              </div>
            </section>

            <section className="test-space-admin-detail">
              {selectedSpace ? (
                <>
                  {canManageSettings ? (
                    <form className="test-space-settings-row" onSubmit={(event) => {
                      event.preventDefault()
                      void mutateSettings(() => updateTestSpace(selectedSpace.id, {
                        name: renameValue,
                        organizationId: organizationValue === 'none' ? undefined : Number(organizationValue),
                        versionLabel,
                      }))
                    }}>
                      <Label>空间名称<Input maxLength={80} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} /></Label>
                      <Label>版本号<Input maxLength={80} value={versionLabel} onChange={(event) => setVersionLabel(event.target.value)} /></Label>
                      <Label>归属组织
                        <Select value={organizationValue} onValueChange={(value) => { if (value) setOrganizationValue(value) }}>
                          <SelectTrigger aria-label="测试空间归属组织"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">不归属组织</SelectItem>
                            {settings.organizations.filter((organization) => isOwner || organization.canManageResources).map((organization) => (
                              <SelectItem key={organization.id} value={String(organization.id)}>{organization.name}</SelectItem>
                            ))}
                            {selectedSpace.organizationId && !settings.organizations.some((organization) => organization.id === selectedSpace.organizationId) ? (
                              <SelectItem disabled value={String(selectedSpace.organizationId)}>{selectedSpace.organizationName ?? '当前组织'}</SelectItem>
                            ) : null}
                          </SelectContent>
                        </Select>
                      </Label>
                      <Button variant="outline" disabled={busy || !renameValue.trim() || (
                        renameValue.trim() === selectedSpace.name
                        && versionLabel.trim() === (selectedSpace.versionLabel ?? '')
                        && organizationValue === (selectedSpace.organizationId ? String(selectedSpace.organizationId) : 'none')
                      )}><PencilSimple /> 保存修改</Button>
                    </form>
                  ) : <div className="test-space-readonly-heading">
                    <div><span>空间名称</span><strong>{selectedSpace.name}</strong></div>
                    <div><span>版本号</span><strong>{selectedSpace.versionLabel || '未指定'}</strong></div>
                    <div><span>归属组织</span><strong>{selectedSpace.organizationName ?? '不归属组织'}</strong></div>
                    <Badge variant="outline">{selectedSpace.accessLevel === 'editor' ? '可编辑' : '只读'}</Badge>
                  </div>}

                  {isOwner ? <section className="test-space-data-import-entry">
                    <div><span>数据转入</span><small>用例、测试计划复制</small></div>
                    <Button type="button" variant="outline" disabled={busy || dataImportBusy} onClick={() => { setDataImportError(''); setDataImportOpen(true) }}><DownloadSimple /> 数据转入</Button>
                  </section> : null}

                  <section className="test-space-members-section">
                    <div className="test-space-admin-section-heading">
                      <div>
                        <span>成员与邀请</span>
                        <strong>{selectedSpace.members.length}</strong>
                      </div>
                    </div>
                    {canManageMembers ? <form
                      className="test-space-member-add-row"
                      onSubmit={async (event) => {
                        event.preventDefault()
                        if (!inviteUsername.trim()) return
                        const saved = await mutateSettings(() => addTestSpaceMember(selectedSpace.id, inviteUsername.trim(), memberAccess))
                        if (saved) setInviteUsername('')
                      }}
                    >
                      <Input autoComplete="username" value={inviteUsername} onChange={(event) => setInviteUsername(event.target.value)} placeholder="输入测试工程师用户名" />
                      <Select value={memberAccess} onValueChange={(value) => setMemberAccess(value as 'editor' | 'viewer')}>
                        <SelectTrigger aria-label="成员权限"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="editor">可编辑</SelectItem><SelectItem value="viewer">只读</SelectItem></SelectContent>
                      </Select>
                      <Button variant="outline" aria-label="直接添加空间成员" title="直接添加空间成员，无需对方确认" disabled={busy || !inviteUsername.trim()}><UserPlus /> 直接添加</Button>
                    </form> : null}
                    {canManageMembers ? <Button type="button" variant="ghost" disabled={busy || !inviteUsername.trim()} onClick={async () => {
                      const saved = await mutateSettings(() => inviteTestSpaceMember(selectedSpace.id, inviteUsername.trim(), memberAccess))
                      if (saved) setInviteUsername('')
                    }}>发送邀请，等待对方确认</Button> : null}
                    <div className="test-space-member-list">
                      {selectedSpace.members.map((member) => (
                        <article key={member.userId}>
                          <div><strong>{member.displayName}</strong><small>{member.username} · {member.status === 'pending' ? '待接受' : '已加入'}</small></div>
                          {member.accessLevel === 'owner' ? <Badge variant="outline">所有者</Badge> : (
                            canManageMembers ? <Select value={member.accessLevel} onValueChange={(value) => void mutateSettings(() => updateTestSpaceMember(selectedSpace.id, member.userId, value as 'editor' | 'viewer'))} disabled={busy}>
                              <SelectTrigger aria-label={`${member.displayName}的空间权限`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="editor">可编辑</SelectItem><SelectItem value="viewer">只读</SelectItem></SelectContent>
                            </Select> : <Badge variant="outline">{member.accessLevel === 'editor' ? '可编辑' : '只读'}</Badge>
                          )}
                          {member.accessLevel === 'owner' || !canManageMembers ? <span /> : (
                            <Button size="icon" variant="ghost" aria-label={`移除成员${member.displayName}`} title="移除成员" disabled={busy} onClick={() => void confirmAction({ title: '确认移除测试空间成员？',
                              description: `「${member.displayName}」将失去「${selectedSpace.name}」的成员权限，其创建的测试数据保留。`, confirmLabel: '移除成员',
                            }, () => mutateSettings(() => removeTestSpaceMember(selectedSpace.id, member.userId), undefined, true,
                              (next) => next.spaces.some((space) => space.id === selectedSpace.id && !space.members.some((item) => item.userId === member.userId))))}><Trash /></Button>
                          )}
                        </article>
                      ))}
                    </div>
                  </section>

                  {canManageMembers ? <section className="test-space-invite-link-section">
                    <div className="test-space-admin-section-heading"><div><span>邀请链接</span><strong>{inviteLinkAccess === 'editor' ? '可编辑' : '只读'}</strong></div></div>
                    <p>{selectedSpace.organizationId ? '复制给组织成员，对方登录并切换到测试工程师身份后即可加入。' : '复制给测试工程师，对方登录并切换到测试工程师身份后即可加入。'}</p>
                    <div className="test-space-invite-link-controls">
                      <Select value={String(inviteExpiresInMinutes)} onValueChange={(value) => { setInviteExpiresInMinutes(Number(value)); setInviteLinkStatus('') }}>
                        <SelectTrigger aria-label="邀请链接有效时长"><SelectValue /></SelectTrigger>
                        <SelectContent>{[10, 30, 60, 240, 1440].map((minutes) => <SelectItem key={minutes} value={String(minutes)}>{formatInviteDuration(minutes)}</SelectItem>)}</SelectContent>
                      </Select>
                      <Select value={inviteLinkAccess} onValueChange={(value) => { setInviteLinkAccess(value as 'editor' | 'viewer'); setInviteLinkStatus('') }}>
                        <SelectTrigger aria-label="邀请链接成员权限"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="editor">可编辑</SelectItem><SelectItem value="viewer">只读</SelectItem></SelectContent>
                      </Select>
                      <label><input type="checkbox" checked={encryptedInviteShare} onChange={(event) => { setEncryptedInviteShare(event.target.checked); setInviteLinkStatus('') }} /> 加密分享</label>
                      <Button variant="outline" disabled={busy} onClick={() => void copyInviteLink()}><CopySimple /> {inviteLinkStatus.startsWith('已复制') ? '已复制' : '复制链接'}</Button>
                    </div>
                    {inviteLinkStatus ? <small>{inviteLinkStatus}</small> : null}
                  </section> : null}

                  {canDelete ? <div className="test-space-danger-zone">
                    <div><strong>删除测试空间</strong><small>将永久删除空间内全部测试对象、用例、计划、Bug 和评论。</small></div>
                    <Button type="button" variant="destructive" disabled={busy} onClick={() => setDeleteSpaceOpen(true)}><Trash /> 删除空间</Button>
                  </div> : null}
                </>
              ) : <div className="test-detail-empty"><GearSix size={28} /><p>创建测试空间后即可维护成员和权限。</p></div>}
            </section>
          </div>
        )}
        </DialogContent>
      </Dialog>
      {selectedSpace ? <TestSpaceDataImportDialog
        busy={dataImportBusy}
        error={dataImportError}
        onOpenChange={setDataImportOpen}
        onSubmit={importData}
        open={dataImportOpen && Boolean(isOwner)}
        spaces={settings.spaces}
        targetSpaceId={selectedSpace.id}
      /> : null}
    </>
  )
}

function TestSpaceInvitePasswordDialog({ busy, error, onCancel, onPasswordChange, onSubmit, open, password }: {
  busy: boolean
  error: string
  onCancel: () => void
  onPasswordChange: (value: string) => void
  onSubmit: () => void
  open: boolean
  password: string
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel() }}>
      <DialogContent fixedHeader className="test-workbench-dialog">
        <DialogHeader><DialogTitle>输入测试空间邀请密码</DialogTitle><DialogDescription>该邀请链接已开启加密分享，验证后会加入测试空间。</DialogDescription></DialogHeader>
        <form className="test-dialog-form" onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
          <Label>邀请密码<Input autoFocus type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} /></Label>
          {error ? <WorkspaceError message={error} /> : null}
          <DialogFooter><Button type="button" variant="outline" onClick={onCancel}>取消</Button><Button disabled={busy || !password.trim()}>{busy ? '验证中...' : '验证并加入'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SubjectDialog({
  busy,
  onOpenChange,
  onSubmit,
  open,
  subject,
}: {
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (payload: { description: string; name: string }) => Promise<boolean>
  open: boolean
  subject?: TestSubject
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  useEffect(() => {
    if (!open) return
    setName(subject?.name ?? '')
    setDescription(subject?.description ?? '')
  }, [open, subject?.description, subject?.id, subject?.name])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent fixedHeader className="test-wide-dialog">
        <DialogHeader>
          <DialogTitle>{subject ? '编辑测试对象' : '新建测试对象'}</DialogTitle>
          <DialogDescription>测试对象独立存在，用于承载测试用例和测试计划。</DialogDescription>
        </DialogHeader>
        <form className="test-dialog-form" onSubmit={async (event) => {
          event.preventDefault()
          if (!name.trim()) return
          const saved = await onSubmit({ description, name })
          if (saved) onOpenChange(false)
        }}>
          <Label>名称<Input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></Label>
          <Label>说明<Textarea value={description} onChange={(event) => setDescription(event.target.value)} /></Label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button disabled={busy || !name.trim()}>{busy ? (subject ? '保存中...' : '创建中...') : (subject ? '保存' : '创建')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type TestCaseFormPayload = {
  caseType: TestCaseType
  customTags?: string[]
  expectedResult: string
  folderId?: number | null
  preconditions: string
  priority: Priority
  remarks: string
  steps: string
  testSubjectId: number
  title: string
}

export function CaseDialog({ defaultFolderId = null, busy, data, onOpenChange, onSubmit, open, spaceId, subjectId, testCase }: { defaultFolderId?: number | null; busy: boolean; data: TestWorkbenchData; onOpenChange: (open: boolean) => void; onSubmit: (payload: TestCaseFormPayload) => void; open: boolean; spaceId?: number; subjectId?: number; testCase?: TestCase }) {
  const key = `${open}-${spaceId}-${subjectId}-${testCase?.id ?? 'new'}`
  return <CaseDialogForm key={key} {...{ defaultFolderId, busy, data, onOpenChange, onSubmit, open, spaceId, subjectId, testCase }} />
}

function CaseDialogForm({ defaultFolderId = null, busy, data, onOpenChange, onSubmit, open, spaceId, subjectId, testCase }: Parameters<typeof CaseDialog>[0]) {
  const folders = data.folders.filter((folder) => folder.testSpaceId === spaceId && folder.testSubjectId === subjectId)
  const [title, setTitle] = useState(testCase?.title ?? '')
  const [folderId, setFolderId] = useState<number | null>(testCase ? testCase.folderId ?? null : defaultFolderId)
  const [preconditions, setPreconditions] = useState(testCase?.preconditions ?? '')
  const [steps, setSteps] = useState(testCase?.steps ?? '')
  const [expectedResult, setExpectedResult] = useState(testCase?.expectedResult ?? '')
  const [remarks, setRemarks] = useState(testCase?.remarks ?? '')
  const [priority, setPriority] = useState<Priority>(testCase?.priority ?? 'medium')
  const [caseType, setCaseType] = useState<TestCaseType>(testCase?.caseType ?? 'functional')
  const [customTagsInput, setCustomTagsInput] = useState(testCase?.customTags.join('、') ?? '')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent fixedHeader className="test-wide-dialog test-case-dialog">
        <DialogHeader>
          <DialogTitle>{testCase ? `编辑 CASE-${testCase.id}` : '新建测试用例'}</DialogTitle>
          <DialogDescription>按执行顺序记录用例，加入测试计划后会保留不可变快照。</DialogDescription>
        </DialogHeader>
        <form
          className="test-dialog-form"
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit({
              caseType,
              customTags: Array.from(new Set(customTagsInput.split(/[,，;；、\s]+/).map((tag) => tag.trim()).filter(Boolean))).slice(0, 12),
              expectedResult,
              folderId,
              preconditions,
              priority,
              remarks,
              steps,
              testSubjectId: subjectId!,
              title,
            })
          }}
        >
          <fieldset className="test-dialog-section">
            <legend>基础信息</legend>
            <Label>用例名称<Input autoFocus maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></Label>
            <Label>所属目录<DirectoryPicker folders={folders} value={folderId} onChange={setFolderId} /></Label>
            <div className="test-form-grid test-case-classification-grid">
              <Label>用例等级<Select value={priority} onValueChange={(value) => setPriority(value as Priority)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="high">P0</SelectItem><SelectItem value="medium">P1</SelectItem><SelectItem value="low">P2</SelectItem></SelectContent></Select></Label>
              <Label>类型<Select value={caseType} onValueChange={(value) => setCaseType(value as TestCaseType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(caseTypeLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Label>
            </div>
            <Label>自定义标签<Input maxLength={500} value={customTagsInput} onChange={(event) => setCustomTagsInput(event.target.value)} placeholder="例如：核心流程、兼容性、支付" /></Label>
          </fieldset>
          <fieldset className="test-dialog-section">
            <legend>执行内容</legend>
            <Label>前置条件<Textarea maxLength={5000} value={preconditions} onChange={(event) => setPreconditions(event.target.value)} /></Label>
            <Label>步骤描述<Textarea maxLength={10000} value={steps} onChange={(event) => setSteps(event.target.value)} /></Label>
            <Label>预期结果<Textarea maxLength={10000} value={expectedResult} onChange={(event) => setExpectedResult(event.target.value)} /></Label>
            <Label>备注<Textarea maxLength={5000} value={remarks} onChange={(event) => setRemarks(event.target.value)} /></Label>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={busy || !title.trim()}>{testCase ? '保存修改' : '创建用例'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function downloadTestCaseCsv(cases: TestCase[], folders: TestCaseFolder[], rootId: number | null = null) {
  const csvContent = buildTestCaseCsv(cases, folders, rootId)
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = '测试用例.csv'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function downloadTestCaseCsvTemplate() {
  const csvContent = `\uFEFF${testCaseCsvHeaders.join(',')}\r\n`
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = '测试用例导入模板.csv'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function ImportCasesDialog({ targetFolderId, folders, busy, onOpenChange, onSubmit, open, spaceId, subject }: {
  targetFolderId: number | null
  folders: TestCaseFolder[]
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (csvText: string, directoryMode: 'current' | 'tree') => Promise<boolean>
  open: boolean
  spaceId?: number
  subject?: TestWorkbenchData['subjects'][number]
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [csvText, setCsvText] = useState('')
  const [preview, setPreview] = useState<TestCaseImportPreview>()
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState('')
  const [directoryMode, setDirectoryMode] = useState<'current' | 'tree'>('current')
  const generation = useRef(0)
  useEffect(() => () => { generation.current += 1 }, [])
  const targetIndex = createDirectoryIndex(folders)
  const targetExists = targetFolderId === null || targetIndex.byId.has(targetFolderId)
  const targetPath = targetExists ? targetIndex.path(targetFolderId).map(f => f.name).join(' / ') || '根目录 / 未分类' : '目录已删除，请重新选择'

  function reset() {
    generation.current += 1
    setFileName('')
    setCsvText('')
    setPreview(undefined)
    setPreviewing(false)
    setError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file || !spaceId || !subject) return
    const requestGeneration = ++generation.current
    setCsvText('')
    setError('')
    setPreview(undefined)
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('请选择 CSV 文件。')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('CSV 文件不能超过 2 MB。')
      return
    }
    setFileName(file.name)
    setPreviewing(true)
    try {
      const content = await file.text()
      if (requestGeneration !== generation.current) return
      const result = await previewTestCaseImport(spaceId, subject.id, content, { directoryMode, targetFolderId })
      if (requestGeneration !== generation.current) return
      setCsvText(content)
      setPreview(result.preview)
    } catch (previewError) {
      if (requestGeneration !== generation.current) return
      setCsvText('')
      setError(previewError instanceof Error ? previewError.message : 'CSV 校验失败。')
    } finally {
      if (requestGeneration === generation.current) setPreviewing(false)
    }
  }

  async function confirmImport() {
    if (!csvText || !preview) return
    const imported = await onSubmit(csvText, directoryMode)
    if (imported) changeOpen(false)
    else setError('导入失败，请根据工作台中的错误提示检查文件。')
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent fixedHeader className="test-wide-dialog test-import-dialog">
        <DialogHeader>
          <DialogTitle>导入用例</DialogTitle>
          <DialogDescription>目标：{subject?.name} / {targetPath}。提交时会重新校验目录与权限。</DialogDescription>
        </DialogHeader>
        <Label>导入方式<Select disabled={busy} value={directoryMode} onValueChange={value => { reset(); setDirectoryMode(value as 'current' | 'tree') }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="current">全部导入当前目录</SelectItem><SelectItem value="tree">按相对目录路径导入</SelectItem></SelectContent></Select></Label>
        <p>{directoryMode === 'current' ? '忽略文件中的目录列，全部用例放入当前目录。' : '目录路径以 / 分隔；名称中的 / 写为 ~1，~ 写为 ~0。空路径表示当前目录。旧所属模块列作为单个子目录名称。'}</p>
        <div className="test-import-picker">
          <input ref={fileInputRef} hidden accept=".csv,text/csv" type="file" onChange={(event) => void selectFile(event)} />
          <FileCsv size={28} weight="duotone" />
          <div className="test-import-picker-copy"><strong>{fileName || '选择 CSV 文件'}</strong><small>支持 UTF-8、最多 1000 条、文件不超过 2 MB</small></div>
          <div className="test-import-picker-actions">
            <Button type="button" variant="outline" onClick={downloadTestCaseCsvTemplate}><DownloadSimple /> 下载模板</Button>
            <Button type="button" variant="outline" disabled={previewing || busy} onClick={() => fileInputRef.current?.click()}><UploadSimple /> {fileName ? '重新选择' : '选择文件'}</Button>
          </div>
        </div>
        {previewing ? <p className="test-import-status">正在校验字段与内容...</p> : null}
        {error ? <div className="test-workbench-error"><WarningCircle /> {error}</div> : null}
        {preview ? (
          <div className="test-import-preview">
            <div className="test-import-metrics">
              <span><strong>{preview.rowCount}</strong> 条用例</span>
              <span><strong>{preview.newDirectoryCount ?? 0}</strong> 个新目录</span><span><strong>{preview.reusedDirectoryCount ?? 0}</strong> 个复用目录</span>
              <span><strong>{preview.levelCounts.P0}</strong> P0</span>
              <span><strong>{preview.levelCounts.P1}</strong> P1</span>
              <span><strong>{preview.levelCounts.P2}</strong> P2</span>
            </div>
            <div className="test-import-samples">
              <span>内容预览</span>{preview.samplePaths?.map((path, i) => <small key={`${path}-${i}`}>{path}</small>)}
              {preview.sampleTitles.map((title, index) => <p key={`${title}-${index}`}><code>{index + 1}</code>{title}</p>)}
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => changeOpen(false)}>取消</Button>
          <Button type="button" disabled={busy || previewing || !preview || !targetExists} onClick={() => void confirmImport()}>{busy ? '导入中...' : preview ? `导入 ${preview.rowCount} 条用例` : '确认导入'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type TestPlanFormPayload = {
  caseIds: number[]
  endsOn?: string
  environment: string
  testEnvironmentId?: number
  name: string
  ownerUserId?: number
  projectId?: number
  startsOn?: string
  testSubjectIds: number[]
  versionLabel: string
}

function PlanDirectoryTree({
  cases,
  folders,
  onCollapseAll,
  onExpandAll,
  onSelect,
  onToggle,
  selected,
  expanded,
}: {
  cases: TestCase[]
  folders: TestCaseFolder[]
  onCollapseAll: () => void
  onExpandAll: () => void
  onSelect: (id: string) => void
  onToggle: (id: number) => void
  selected: string
  expanded: Set<number>
}) {
  const index = useMemo(() => createDirectoryIndex(folders), [folders])
  const counts = useMemo(() => countDirectoryCases(folders, cases), [cases, folders])
  const selectedFolder = selected !== 'all' && selected !== 'uncategorized' ? index.byId.get(Number(selected)) : undefined
  const visible: Array<{ folder: TestCaseFolder; depth: number }> = []
  const visit = (parentId: number | null, depth: number) => {
    for (const folder of index.children.get(parentId) ?? []) {
      visible.push({ folder, depth })
      if (expanded.has(folder.id)) visit(folder.id, depth + 1)
    }
  }
  visit(null, 1)
  return (
    <aside className="test-plan-directory-pane" aria-label="选择用例目录">
      <div className="test-plan-directory-heading">
        <div><span>用例目录</span><strong>{selected === 'all' ? '全部目录' : selected === 'uncategorized' ? '未分类' : selectedFolder ? index.path(selectedFolder.id).map((folder) => folder.name).join(' / ') : '全部目录'}</strong></div>
        <small>{cases.length} 条可选用例</small>
      </div>
      <div className="test-plan-directory-actions">
        <Button type="button" size="sm" variant="ghost" onClick={onExpandAll}>全部展开</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCollapseAll}>全部收起</Button>
      </div>
      <div className="test-plan-directory-tree" role="tree" aria-label="测试用例目录">
        <button type="button" role="treeitem" aria-selected={selected === 'all'} className={`test-plan-directory-node test-plan-directory-node-root ${selected === 'all' ? 'active' : ''}`} onClick={() => onSelect('all')}>
          <Folder /><span>全部目录</span><small>{cases.length}</small>
        </button>
        {visible.map(({ folder, depth }) => {
          const hasChildren = Boolean(index.children.get(folder.id)?.length)
          const isExpanded = expanded.has(folder.id)
          return (
            <div key={folder.id} role="treeitem" aria-level={depth} aria-expanded={hasChildren ? isExpanded : undefined} aria-selected={selected === String(folder.id)} className={`test-plan-directory-node ${selected === String(folder.id) ? 'active' : ''}`} style={{ paddingLeft: 8 + (depth - 1) * 15 }} onClick={() => onSelect(String(folder.id))}>
              <button type="button" className="test-plan-directory-toggle" tabIndex={-1} aria-label={`${isExpanded ? '收起' : '展开'} ${folder.name}`} disabled={!hasChildren} onClick={(event) => { event.stopPropagation(); onToggle(folder.id) }}>
                {hasChildren ? isExpanded ? <CaretDown /> : <CaretRight /> : null}
              </button>
              {isExpanded && hasChildren ? <FolderOpen /> : <Folder />}
              <span title={folder.name}>{folder.name}</span>
              <small>{counts.total.get(folder.id) ?? 0}</small>
            </div>
          )
        })}
        <button type="button" role="treeitem" aria-selected={selected === 'uncategorized'} className={`test-plan-directory-node test-plan-directory-node-root ${selected === 'uncategorized' ? 'active' : ''}`} onClick={() => onSelect('uncategorized')}>
          <Folder /><span>未分类</span><small>{counts.direct.get(null) ?? 0}</small>
        </button>
        {!folders.length ? <p className="test-list-empty">当前测试空间还没有目录。</p> : null}
      </div>
      <small className="test-plan-directory-footnote">目录数量包含所有下级用例</small>
    </aside>
  )
}

function PlanDialog({ busy, cases, folders, onOpenChange, onSubmit, open, plan, planCases, projects, subjects, users, testEnvironments }: {
  busy: boolean
  cases: TestCase[]
  folders: TestWorkbenchData['folders']
  onOpenChange: (open: boolean) => void
  onSubmit: (payload: TestPlanFormPayload) => void
  open: boolean
  plan?: TestPlan
  planCases: TestWorkbenchData['planCases']
  projects: TestWorkbenchProjectOption[]
  testEnvironments: TestWorkbenchData['testEnvironments']
  subjects: TestWorkbenchData['subjects']
  users: TestWorkbenchData['users']
}) {
  const [name, setName] = useState(plan?.name ?? '')
  const [versionLabel, setVersionLabel] = useState(plan?.versionLabel ?? '')
  const [environment, setEnvironment] = useState(plan?.environment ?? '')
  const [testEnvironmentId, setTestEnvironmentId] = useState(plan?.testEnvironmentId ? String(plan.testEnvironmentId) : '')
  const [startsOn, setStartsOn] = useState(plan?.startsOn?.slice(0, 10) ?? '')
  const [endsOn, setEndsOn] = useState(plan?.endsOn?.slice(0, 10) ?? '')
  const [ownerUserId, setOwnerUserId] = useState(plan?.ownerUserId ? String(plan.ownerUserId) : 'none')
  const [projectId, setProjectId] = useState(plan?.projectId ? String(plan.projectId) : 'none')
  const [subjectIds] = useState<number[]>(plan?.testSubjectIds ?? subjects.map((subject) => subject.id))
  const [caseIds, setCaseIds] = useState<number[]>([])
  const [caseSearchQuery, setCaseSearchQuery] = useState('')
  const [caseFolderFilter, setCaseFolderFilter] = useState('all')
  const scopedFolders = useMemo(() => folders.filter((folder) => subjectIds.includes(folder.testSubjectId)), [folders, subjectIds])
  const [expandedDirectories, setExpandedDirectories] = useState<Set<number>>(() => new Set(scopedFolders.filter((folder) => folder.parentId === null).map((folder) => folder.id)))
  const [caseTypeFilter, setCaseTypeFilter] = useState('all')
  const [casePriorityFilter, setCasePriorityFilter] = useState('all')
  const [step, setStep] = useState<1 | 2>(1)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const existingCaseIds = new Set(planCases
    .filter((item) => item.testPlanId === plan?.id && item.testCaseId)
    .map((item) => item.testCaseId as number))
  const available = cases.filter((item) => subjectIds.includes(item.testSubjectId) && item.status === 'active' && !existingCaseIds.has(item.id))
  const planDirectoryIndex = useMemo(() => createDirectoryIndex(scopedFolders), [scopedFolders])
  const effectiveCaseFolderFilter = caseFolderFilter === 'all' || caseFolderFilter === 'uncategorized' || planDirectoryIndex.byId.has(Number(caseFolderFilter)) ? caseFolderFilter : 'all'
  const planScopeIds = effectiveCaseFolderFilter === 'all' || effectiveCaseFolderFilter === 'uncategorized' ? new Set<number>() : planDirectoryIndex.descendants(Number(effectiveCaseFolderFilter))
  const normalizedCaseQuery = caseSearchQuery.trim().toLocaleLowerCase('zh-CN')
  const filteredAvailable = available.filter((item) => {
    const folder = folders.find((candidate) => candidate.id === item.folderId)
    const matchesSearch = !normalizedCaseQuery || [
      `CASE-${item.id}`,
      item.title,
      folder?.name ?? '未分类',
      item.preconditions,
      item.steps,
      item.expectedResult,
      item.remarks,
      item.customTags.join(' '),
    ].some((value) => value.toLocaleLowerCase('zh-CN').includes(normalizedCaseQuery))
    const matchesFolder = effectiveCaseFolderFilter === 'all'
      || (effectiveCaseFolderFilter === 'uncategorized' ? !item.folderId : planScopeIds.has(item.folderId ?? -1))
    return matchesSearch
      && matchesFolder
      && (caseTypeFilter === 'all' || item.caseType === caseTypeFilter)
      && (casePriorityFilter === 'all' || item.priority === casePriorityFilter)
  })
  const filteredCaseIds = filteredAvailable.map((item) => item.id)
  const selectedFilteredCount = filteredCaseIds.filter((id) => caseIds.includes(id)).length
  const allFilteredSelected = filteredCaseIds.length > 0 && selectedFilteredCount === filteredCaseIds.length
  const hasCaseFilters = Boolean(caseSearchQuery.trim())
    || effectiveCaseFolderFilter !== 'all'
    || caseTypeFilter !== 'all'
    || casePriorityFilter !== 'all'
  const invalidDateRange = Boolean(startsOn && endsOn && startsOn > endsOn)
  useEffect(() => {
    const validIds = new Set(scopedFolders.map((folder) => folder.id))
    setExpandedDirectories((current) => new Set([...current].filter((id) => validIds.has(id))))
    if (caseFolderFilter !== 'all' && caseFolderFilter !== 'uncategorized' && !validIds.has(Number(caseFolderFilter))) setCaseFolderFilter('all')
  }, [caseFolderFilter, scopedFolders])

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedFilteredCount > 0 && !allFilteredSelected
    }
  }, [allFilteredSelected, selectedFilteredCount])

  useEffect(() => {
    if (open) setStep(1)
  }, [open, plan?.id])

  const canGoNext = name.trim().length > 0 && !invalidDateRange
  const canSubmit = canGoNext && (Boolean(plan) || Boolean(testEnvironmentId)) && subjectIds.length > 0 && (Boolean(plan) || caseIds.length > 0)

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent fixedHeader className={`test-wide-dialog test-plan-dialog ${step === 2 ? 'test-plan-dialog-fixed' : 'test-plan-dialog-auto'}`}>
      <DialogHeader>
        <DialogTitle>{plan ? `编辑 PLAN-${plan.id}` : '新建测试计划'}</DialogTitle>
        <DialogDescription>{plan ? '先修改计划基础信息，再追加测试对象或活动用例。已有快照不会改变。' : '先填写计划基础信息，再选择测试对象和要纳入计划的用例。'}</DialogDescription>
      </DialogHeader>
      <form className="test-dialog-form test-plan-dialog-form" onSubmit={(event) => {
        event.preventDefault()
        if (!canSubmit) return
        onSubmit({
          caseIds,
          endsOn: endsOn || undefined,
          environment,
          ...(testEnvironmentId ? { testEnvironmentId: Number(testEnvironmentId) } : {}),
          name,
          ownerUserId: ownerUserId === 'none' ? undefined : Number(ownerUserId),
          projectId: projectId === 'none' ? undefined : Number(projectId),
          startsOn: startsOn || undefined,
          testSubjectIds: subjectIds,
          versionLabel,
        })
      }}>
        <div className="test-plan-stepper" aria-label="新建测试计划步骤">
          <button className={step === 1 ? 'active' : 'done'} type="button" onClick={() => setStep(1)}>
            <span>1</span>
            <strong>基础信息</strong>
          </button>
          <i aria-hidden="true" />
          <button className={step === 2 ? 'active' : ''} type="button" disabled={!canGoNext} onClick={() => setStep(2)}>
            <span>2</span>
            <strong>选择用例</strong>
          </button>
        </div>
        {step === 1 ? (
          <section className="test-plan-step-panel test-plan-basic-panel" aria-label="计划基础信息">
            <Label>计划名称<Input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></Label>
            <div className="test-form-grid test-plan-basic-grid">
              <Label>版本<Input value={versionLabel} onChange={(event) => setVersionLabel(event.target.value)} /></Label>
              <Label>环境<Select value={testEnvironmentId} onValueChange={(value) => { setTestEnvironmentId(value); const selected = testEnvironments.find((item) => item.id === Number(value)); if (selected) setEnvironment(selected.name) }}><SelectTrigger><SelectValue placeholder="选择已配置环境" /></SelectTrigger><SelectContent>{testEnvironments.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select></Label>
              <Label>
                开始日期
                <JournalDatePicker
                  ariaLabel="选择测试计划开始日期"
                  datesWithEntries={[]}
                  displayValue={startsOn || '选择日期'}
                  value={startsOn}
                  onChange={setStartsOn}
                />
              </Label>
              <Label>
                结束日期
                <JournalDatePicker
                  ariaLabel="选择测试计划结束日期"
                  datesWithEntries={[]}
                  displayValue={endsOn || '选择日期'}
                  value={endsOn}
                  onChange={setEndsOn}
                />
              </Label>
            </div>
            <Label>负责人<Select value={ownerUserId} onValueChange={setOwnerUserId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">未分配</SelectItem>{users.filter((user) => user.roles.includes('tester')).map((user) => <SelectItem key={user.id} value={String(user.id)}>{user.displayName}</SelectItem>)}</SelectContent></Select></Label>
            <Label>关联项目<Select value={projectId} onValueChange={setProjectId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">不关联项目</SelectItem>{projects.map((project) => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select></Label>
            {invalidDateRange ? <p className="test-form-error">结束日期不能早于开始日期。</p> : null}
          </section>
        ) : (
          <section className="test-plan-step-panel test-plan-scope-panel" aria-label="计划范围与用例">
            <div className="test-plan-scope-grid">
              <PlanDirectoryTree
                cases={available}
                folders={scopedFolders}
                selected={caseFolderFilter}
                expanded={expandedDirectories}
                onSelect={setCaseFolderFilter}
                onToggle={(id) => setExpandedDirectories((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })}
                onExpandAll={() => setExpandedDirectories(new Set(scopedFolders.map((folder) => folder.id)))}
                onCollapseAll={() => setExpandedDirectories(new Set())}
              />
              <fieldset className="test-plan-case-picker">
                <legend>{plan ? '追加用例' : '选择用例'}</legend>
                <div className="test-plan-case-tools">
                  <div className="test-plan-case-search-row">
                    <label className="test-case-search">
                      <MagnifyingGlass />
                      <Input
                        type="search"
                        aria-label="搜索计划用例"
                        value={caseSearchQuery}
                        onChange={(event) => setCaseSearchQuery(event.target.value)}
                        placeholder="搜索编号、标题、模块或用例内容"
                      />
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      aria-label="清除计划用例筛选"
                      disabled={!hasCaseFilters}
                      onClick={() => {
                        setCaseSearchQuery('')
                        setCaseFolderFilter('all')
                        setCaseTypeFilter('all')
                        setCasePriorityFilter('all')
                      }}
                    ><XCircle /> 清除</Button>
                  </div>
                  <div className="test-plan-case-filter-row">
                    <Select value={caseTypeFilter} onValueChange={setCaseTypeFilter}>
                      <SelectTrigger aria-label="计划用例类型筛选"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="all">全部类型</SelectItem>{Object.entries(caseTypeLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={casePriorityFilter} onValueChange={setCasePriorityFilter}>
                      <SelectTrigger aria-label="计划用例等级筛选"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="all">全部等级</SelectItem><SelectItem value="high">P0</SelectItem><SelectItem value="medium">P1</SelectItem><SelectItem value="low">P2</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="test-plan-case-selection-bar">
                    <label>
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        checked={allFilteredSelected}
                        disabled={filteredCaseIds.length === 0}
                        onChange={(event) => {
                          const filteredIds = new Set(filteredCaseIds)
                          setCaseIds((current) => event.target.checked
                            ? Array.from(new Set([...current, ...filteredCaseIds]))
                            : current.filter((id) => !filteredIds.has(id)))
                        }}
                      />
                      <span>{allFilteredSelected ? '取消全选当前结果' : '全选当前结果'}</span>
                    </label>
                    <small>{filteredAvailable.length} 条结果 · 已选 {caseIds.length} 条</small>
                  </div>
                </div>
                <div className="test-case-checklist" role="group" aria-label={plan ? '可追加用例' : '可选择用例'}>
                  {filteredAvailable.length ? filteredAvailable.map((item) => {
                    const folder = folders.find((candidate) => candidate.id === item.folderId)
                    return <label key={item.id}>
                      <input type="checkbox" checked={caseIds.includes(item.id)} onChange={(event) => setCaseIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />
                      <span className="test-plan-case-option">
                        <span><code>CASE-{item.id}</code><strong>{item.title}</strong></span>
                        <small>{folder ? planDirectoryIndex.path(folder.id).map((node) => node.name).join(' / ') : '未分类'} · {caseTypeLabel[item.caseType]} · {caseLevelLabel[item.priority]}</small>
                      </span>
                    </label>
                  }) : <p className="test-list-empty">{available.length ? '没有符合条件的可选用例。' : '没有可追加的活动用例。'}</p>}
                </div>
              </fieldset>
            </div>
          </section>
        )}
        <DialogFooter>
          {step === 1 ? (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
              <Button type="button" disabled={!canGoNext} onClick={() => setStep(2)}>下一步</Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => setStep(1)}>上一步</Button>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
              <Button disabled={busy || !canSubmit}>{plan ? '保存修改' : '创建计划'}</Button>
            </>
          )}
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}

type BugDialogPayload = {
  actualResult: string
  assigneeUserId?: number
  environment: string
  expectedResult: string
  priority: Priority
  reproductionSteps: string
  severity: BugSeverity
  testEnvironmentId?: number | null
  testPlanCaseId?: number
  testPlanId?: number
  testCaseId: number
  title: string
}

function BugDialog(props: { busy: boolean; editing: boolean; environments: TestEnvironment[]; onOpenChange: (open: boolean) => void; onSubmit: (payload: BugDialogPayload) => void; open: boolean; seed: Partial<TestBug>; subjects: TestSubject[]; cases: TestCase[]; folders: TestCaseFolder[]; users: TestWorkbenchData['users'] }) {
  return <BugDialogForm key={`${props.open}-${props.editing ? props.seed.id : props.seed.testPlanCaseId ?? 'new'}`} {...props} />
}

function BugDialogForm({ busy, editing, environments, onOpenChange, onSubmit, open, seed, subjects, cases, folders, users }: Parameters<typeof BugDialog>[0]) {
  const [title, setTitle] = useState(seed.title ?? '')
  const [severity, setSeverity] = useState<BugSeverity>(seed.severity ?? 'major')
  const [priority, setPriority] = useState<Priority>(seed.priority ?? 'medium')
  const [environment, setEnvironment] = useState(seed.environment ?? '')
  const [testEnvironmentId, setTestEnvironmentId] = useState(() => (
    seed.testEnvironmentId && environments.some((item) => item.id === seed.testEnvironmentId)
      ? String(seed.testEnvironmentId)
      : 'manual'
  ))
  const [reproductionSteps, setReproductionSteps] = useState(seed.reproductionSteps ?? '')
  const [expectedResult, setExpectedResult] = useState(seed.expectedResult ?? '')
  const [actualResult, setActualResult] = useState(seed.actualResult ?? '')
  const [assigneeUserId, setAssigneeUserId] = useState(seed.assigneeUserId ? String(seed.assigneeUserId) : 'none')
  const [testCaseId, setTestCaseId] = useState(seed.testCaseId ? String(seed.testCaseId) : '')
  const [caseSearch, setCaseSearch] = useState('')
  const [caseFolder, setCaseFolder] = useState('all')
  const caseLocked = editing ? Boolean(seed.testCaseId) : Boolean(seed.testPlanCaseId)
  const caseDirectoryIndex = createDirectoryIndex(folders)
  const selectedDirectoryIds = caseDirectoryIndex.byId.has(Number(caseFolder))
    ? caseDirectoryIndex.descendants(Number(caseFolder)) : new Set<number>()
  const selectableCases = cases.filter((item) => (
    (caseFolder === 'all' || (caseFolder === 'uncategorized' ? !item.folderId : Boolean(item.folderId && selectedDirectoryIds.has(item.folderId))))
    && `CASE-${item.id} ${item.title}`.toLocaleLowerCase('zh-CN').includes(caseSearch.trim().toLocaleLowerCase('zh-CN'))
  ))
  const selectedCase = cases.find((item) => String(item.id) === testCaseId)
  const [reproductionUploading, setReproductionUploading] = useState(false)
  const [expectedUploading, setExpectedUploading] = useState(false)
  const [actualUploading, setActualUploading] = useState(false)
  const evidenceUploading = reproductionUploading || expectedUploading || actualUploading
  const selectedTestEnvironment = testEnvironmentId === 'manual'
    ? undefined
    : environments.find((item) => item.id === Number(testEnvironmentId))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent fixedHeader className="test-wide-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? '编辑 Bug' : '创建 Bug'}</DialogTitle>
          <DialogDescription>{editing ? '仅 Bug 创建者可以修改缺陷信息。' : seed.testPlanCaseId ? '已从失败用例带入执行上下文。' : '记录可复现、可分派、可验证的缺陷。'}</DialogDescription>
        </DialogHeader>
        <form
          className="test-dialog-form"
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit({
              actualResult,
              assigneeUserId: assigneeUserId === 'none' ? undefined : Number(assigneeUserId),
              environment,
              expectedResult,
              priority,
              reproductionSteps,
              severity,
              ...(testEnvironmentId === 'manual' ? {} : { testEnvironmentId: Number(testEnvironmentId) }),
              testPlanCaseId: seed.testPlanCaseId,
              testPlanId: seed.testPlanId,
              testCaseId: Number(testCaseId),
              title,
            })
          }}
        >
          <Label>
            Bug 标题
            <Input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} />
          </Label>
          <div className="test-form-grid">
            <Label>
              严重程度
              <Select value={severity} onValueChange={(value) => setSeverity(value as BugSeverity)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(severityLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
            </Label>
            <Label>
              优先级
              <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="high">高</SelectItem><SelectItem value="medium">中</SelectItem><SelectItem value="low">低</SelectItem></SelectContent>
              </Select>
            </Label>
            <Label>
              负责人
              <Select value={assigneeUserId} onValueChange={setAssigneeUserId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">未分配</SelectItem>{users.filter((user) => user.roles.includes('developer')).map((user) => <SelectItem key={user.id} value={String(user.id)}>{user.displayName}</SelectItem>)}</SelectContent>
              </Select>
            </Label>
            <div className="test-bug-case-picker">
              {!caseLocked ? <>
                <Label>用例目录
                  <Select value={caseFolder} onValueChange={setCaseFolder}>
                    <SelectTrigger aria-label="用例目录"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="all">全部目录</SelectItem><SelectItem value="uncategorized">未分类</SelectItem>{folders.map((folder) => <SelectItem key={folder.id} value={String(folder.id)}>{subjects.find((subject) => subject.id === folder.testSubjectId)?.name} / {caseDirectoryIndex.path(folder.id).map((item) => item.name).join(' / ')}</SelectItem>)}</SelectContent>
                  </Select>
                </Label>
                <Input aria-label="搜索测试用例" placeholder="搜索用例编号或标题" value={caseSearch} onChange={(event) => setCaseSearch(event.target.value)} />
              </> : null}
              <Label>测试用例（必填）
                <Select value={testCaseId} disabled={caseLocked} onValueChange={(value) => {
                  setTestCaseId(value)
                  const item = cases.find((candidate) => String(candidate.id) === value)
                  if (item && !editing) { setReproductionSteps(item.steps); setExpectedResult(item.expectedResult) }
                }}>
                  <SelectTrigger aria-label="关联测试用例"><SelectValue placeholder="选择测试用例">{selectedCase ? `CASE-${selectedCase.id} ${selectedCase.title}` : undefined}</SelectValue></SelectTrigger>
                  <SelectContent>{selectableCases.map((item) => <SelectItem key={item.id} value={String(item.id)}>CASE-{item.id} {item.title}</SelectItem>)}</SelectContent>
                </Select>
              </Label>
              {!cases.length ? <p className="test-list-empty">当前测试空间暂无用例，请先创建测试用例。</p> : null}
              {caseLocked && !selectedCase ? <p className="test-list-empty">来源用例已删除，无法从此执行记录创建 Bug。</p> : null}
              {!caseLocked && cases.length > 0 && !selectableCases.length ? <p className="test-list-empty">没有符合条件的用例。</p> : null}
            </div>
            <Label>
              测试环境
              <Select
                value={testEnvironmentId}
                onValueChange={(value) => {
                  setTestEnvironmentId(value)
                  const selected = environments.find((item) => String(item.id) === value)
                  if (selected) setEnvironment(selected.accessUrl)
                }}
              >
                <SelectTrigger aria-label="选择测试环境"><SelectValue placeholder="选择已配置环境" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">手工填写环境</SelectItem>
                  {environments.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {selectedTestEnvironment ? (
                <span className="test-environment-preview">
                  <span><strong>{selectedTestEnvironment.name}</strong>{selectedTestEnvironment.accessUrl}</span>
                  <a href={selectedTestEnvironment.accessUrl} rel="noreferrer" target="_blank" title="打开测试环境"><LinkSimple aria-hidden /></a>
                </span>
              ) : <Input aria-label="手工填写测试环境" placeholder="例如：https://staging.example.com" value={environment} onChange={(event) => setEnvironment(event.target.value)} />}
            </Label>
          </div>
          <BugEvidenceEditor
            label="复现步骤"
            onChange={setReproductionSteps}
            onUploadingChange={setReproductionUploading}
            placeholder="记录复现路径，支持粘贴、拖入或上传图片和视频。"
            value={reproductionSteps}
          />
          <BugEvidenceEditor
            label="预期结果"
            onChange={setExpectedResult}
            onUploadingChange={setExpectedUploading}
            placeholder="描述预期表现，支持补充截图或录屏。"
            value={expectedResult}
          />
          <BugEvidenceEditor
            label="实际结果"
            onChange={setActualResult}
            onUploadingChange={setActualUploading}
            placeholder="描述实际表现，支持补充截图或录屏。"
            value={actualResult}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button disabled={busy || evidenceUploading || !title.trim() || !selectedCase}>
              {evidenceUploading ? '附件上传中...' : editing ? '保存修改' : '创建 Bug'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function BugTransferDialog({ bug, busy, onOpenChange, onSubmit, open }: {
  bug?: TestBug
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (bug: TestBug, assigneeUserId: number, reason: string) => Promise<boolean>
  open: boolean
}) {
  const [assigneeUserId, setAssigneeUserId] = useState('')
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (!open) return
    setAssigneeUserId('')
    setReason('')
  }, [bug?.id, open])

  const assigning = !bug?.assigneeUserId
  const normalizedReason = reason.trim()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent fixedHeader>
        <DialogHeader>
          <DialogTitle>{assigning ? '分配 Bug' : '转移 Bug'}</DialogTitle>
          <DialogDescription>{bug ? `BUG-${bug.id} · ${bug.title}` : ''}</DialogDescription>
        </DialogHeader>
        <form
          className="test-dialog-form"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!bug || !assigneeUserId || (!assigning && !normalizedReason)) return
            if (await onSubmit(bug, Number(assigneeUserId), normalizedReason)) onOpenChange(false)
          }}
        >
          <Label>
            新负责人
            <Select value={assigneeUserId} onValueChange={setAssigneeUserId} disabled={busy}>
              <SelectTrigger><SelectValue placeholder="选择组织成员" /></SelectTrigger>
              <SelectContent>
                {(bug?.transferCandidates ?? []).map((member) => (
                  <SelectItem key={member.id} value={String(member.id)}>{member.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          {!assigning ? (
            <Label>
              转移理由
              <Textarea
                autoFocus
                maxLength={1000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Label>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button disabled={busy || !assigneeUserId || (!assigning && !normalizedReason)}>
              {busy ? (assigning ? '分配中...' : '转移中...') : (assigning ? '确认分配' : '确认转移')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function BugRejectDialog({ bug, busy, onOpenChange, onSubmit, open }: {
  bug?: TestBug
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (bug: TestBug, reason: string) => Promise<boolean>
  open: boolean
}) {
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (!open) return
    setReason('')
  }, [bug?.id, open])

  const normalizedReason = reason.trim()
  return (
    <ConfirmActionDialog
      key={bug?.id}
      open={open}
      onOpenChange={onOpenChange}
      title={`驳回 Bug“${bug?.title ?? ''}”？`}
      description="驳回后 Bug 将退出待处理列表，可按已驳回查看。理由会记录到评论区并通知提出者。"
      confirmLabel="确认驳回"
      busy={busy}
      confirmDisabled={!bug || !normalizedReason}
      onConfirm={() => bug ? onSubmit(bug, normalizedReason) : Promise.resolve(false)}
    >
      <Label>驳回理由
        <Textarea maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="填写驳回理由" />
      </Label>
    </ConfirmActionDialog>
  )
}

function BugVerificationDialog({
  bug,
  busy,
  onOpenChange,
  onSubmit,
  open,
  organizationId,
}: {
  bug?: TestBug
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (bug: TestBug, packages: VerificationPackageSelection[], containerImages: string[]) => Promise<boolean>
  open: boolean
  organizationId: OrganizationContext
}) {
  const [rules, setRules] = useState<PackageMarketRule[]>([])
  const [visibleRuleIds, setVisibleRuleIds] = useState<Record<'release' | 'ci', string[]>>({ release: [], ci: [] })
  const [ruleId, setRuleId] = useState('')
  const [channel, setChannel] = useState<'release' | 'ci'>('release')
  const [arch, setArch] = useState('amd64')
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [rulePage, setRulePage] = useState(0)
  const [versions, setVersions] = useState<PackageMarketVersion[]>([])
  const [visibleVersionCount, setVisibleVersionCount] = useState(10)
  const [selected, setSelected] = useState<SelectedVerificationPackage[]>([])
  const [containerImages, setContainerImages] = useState([''])
  const [containerImagesTouched, setContainerImagesTouched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [loadingVersionKey, setLoadingVersionKey] = useState('')
  const [error, setError] = useState('')
  const versionSelectionRequestRef = useRef(0)

  useEffect(() => {
    if (!open || organizationId == null) return
    let active = true
    setLoading(true)
    setError('')
    fetchPackageMarketRules({ organizationId })
      .then((result) => {
        if (!active) return
        setVisibleRuleIds(result.visibleRuleIds)
        setRules(result.rules)
        setRuleId((current) => current && result.rules.some((rule) => rule.id === current) ? current : result.rules[0]?.id ?? '')
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : '安装包市场加载失败')
      })
      .finally(() => {
        if (active) setLoading(false)
    })
    return () => { active = false }
  }, [open, organizationId])

  useEffect(() => {
    if (open) {
      setSelected([])
      setContainerImages([''])
      setContainerImagesTouched(false)
      setCategory('all')
      setQuery('')
      setRulePage(0)
      setVersions([])
      setVisibleVersionCount(10)
      setError('')
    }
  }, [bug?.id, open])

  const visibleRules = useMemo(() => {
    const search = query.trim().toLowerCase()
    return rules
      .filter((rule) => rule.id && rule.name)
      .filter((rule) => visibleRuleIds[channel]?.includes(rule.id))
      .filter((rule) => category === 'all' || (rule.pageKind?.code || rule.category) === category)
      .filter((rule) => !search || rule.name.toLowerCase().includes(search) || rule.id.toLowerCase().includes(search))
  }, [category, channel, query, rules, visibleRuleIds])
  const rulePageSize = 8
  const rulePageCount = Math.max(1, Math.ceil(visibleRules.length / rulePageSize))
  const pageRules = useMemo(
    () => visibleRules.slice(rulePage * rulePageSize, (rulePage + 1) * rulePageSize),
    [rulePage, visibleRules],
  )
  const selectedRule = rules.find((rule) => rule.id === ruleId)
  const categories = useMemo(() => {
    const result = new Map<string, string>([
      ['all', '全部'],
      ['apps', '应用'],
      ['middleware', '中间件'],
      ['dependency', '依赖'],
    ])
    rules.forEach((rule) => {
      const key = rule.pageKind?.code || rule.category
      if (key && !result.has(key)) result.set(key, rule.pageKind?.labelZh || rule.category || key)
    })
    return Array.from(result.entries())
  }, [rules])

  useEffect(() => {
    setRulePage((current) => Math.min(current, rulePageCount - 1))
  }, [rulePageCount])

  useEffect(() => {
    if (pageRules.length === 0) {
      if (ruleId) setRuleId('')
      return
    }
    if (!pageRules.some((rule) => rule.id === ruleId)) setRuleId(pageRules[0].id)
  }, [pageRules, ruleId])

  useEffect(() => {
    versionSelectionRequestRef.current += 1
    setLoadingVersionKey('')
  }, [arch, bug?.id, channel, open, selectedRule?.id])

  useEffect(() => {
    const selectedRuleId = selectedRule?.id
    if (!selectedRuleId || organizationId == null || !open) {
      setVersions([])
      return
    }
    let active = true
    setLoadingVersions(true)
    setVersions([])
    setVisibleVersionCount(10)
    setError('')
    const request = channel === 'release'
      ? fetchPackageMarketReleaseVersions({ arch, context: { organizationId }, includeAll: true, packageId: selectedRuleId })
      : fetchPackageMarketCiVersions({ arch, context: { organizationId }, includeAll: true, packageId: selectedRuleId })
    request
      .then((result) => {
        if (active) setVersions(result.versions)
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : '版本列表加载失败')
      })
      .finally(() => {
        if (active) setLoadingVersions(false)
      })
    return () => { active = false }
  }, [arch, channel, open, organizationId, selectedRule?.id])

  function versionValue(version: PackageMarketVersion) {
    return channel === 'ci' ? (version.hash || version.version || version.label) : (version.version || version.label)
  }

  function versionSelectionKey(version: PackageMarketVersion) {
    if (!selectedRule) return ''
    return `${selectedRule.id}:${channel}:${arch}:${versionValue(version)}`
  }

  function selectedVersionItems(version: PackageMarketVersion) {
    const selectionKey = versionSelectionKey(version)
    if (!selectionKey) return []
    return selected.filter((item) => item.selectionKey === selectionKey)
  }

  async function toggleVersion(version: PackageMarketVersion) {
    if (!selectedRule || organizationId == null) return
    const value = versionValue(version)
    const existing = selectedVersionItems(version)
    if (existing.length > 0) {
      setSelected((current) => current.filter((item) => !existing.some((entry) => entry.objectKey === item.objectKey)))
      return
    }
    const conflictingSelection = selected.find((item) => item.sourcePackageId === selectedRule.id)
    if (conflictingSelection) {
      setError(`已选择 ${conflictingSelection.sourcePackageName} ${conflictingSelection.version}，请先移除后再选择其他版本。`)
      return
    }
    const loadingKey = `${selectedRule.id}:${channel}:${arch}:${value}`
    const selectionKey = `${selectedRule.id}:${channel}:${arch}:${value}`
    const requestId = ++versionSelectionRequestRef.current
    setLoadingVersionKey(loadingKey)
    setError('')
    try {
      const detail = await fetchPackageMarketDetail({
        arch,
        channel,
        ciVersion: channel === 'ci' ? value : undefined,
        context: { organizationId },
        includeAll: true,
        packageId: selectedRule.id,
        releaseVersion: channel === 'release' ? value : undefined,
      })
      if (requestId !== versionSelectionRequestRef.current) return
      if (detail.links.length === 0) {
        setError('该版本暂未找到可交付的安装包')
        return
      }
      if (detail.links.some((link) => !link.lastModified || Number.isNaN(new Date(link.lastModified).getTime()))) {
        setError('该版本缺少有效更新时间，无法作为可追溯的验证交付物提交。')
        return
      }
      setSelected((current) => {
        if (current.some((item) => item.sourcePackageId === selectedRule.id)) return current
        const next = [...current]
        detail.links.forEach((link) => {
          if (next.some((item) => item.objectKey === link.objectKey)) return
          next.push({
            arch,
            channel,
            objectKey: link.objectKey,
            objectLastModified: link.lastModified,
            packageName: link.name,
            sizeBytes: link.size,
            sourcePackageId: selectedRule.id,
            sourcePackageName: selectedRule.name,
            selectionKey,
            version: value,
          })
        })
        return next
      })
    } catch (loadError) {
      if (requestId !== versionSelectionRequestRef.current) return
      setError(loadError instanceof Error ? loadError.message : '安装包链接加载失败')
    } finally {
      if (requestId === versionSelectionRequestRef.current) setLoadingVersionKey('')
    }
  }

  function removeSelected(selectionKey: string) {
    setSelected((current) => current.filter((item) => item.selectionKey !== selectionKey))
  }

  const selectedGroups = useMemo(() => {
    const groups = new Map<string, { item: SelectedVerificationPackage; selectionKey: string }>()
    selected.forEach((item) => {
      if (!groups.has(item.sourcePackageId)) groups.set(item.sourcePackageId, { item, selectionKey: item.selectionKey })
    })
    return Array.from(groups.values())
  }, [selected])

  const containerImageValidation = useMemo(() => {
    const seen = new Set<string>()
    return containerImages.map((value) => {
      const parsed = normalizeContainerImageReference(value, { requireTagOrDigest: true })
      if (!parsed.valid) return { error: parsed.error, value }
      const imageKey = containerImageReferenceKey(parsed.value)
      if (seen.has(imageKey)) return { error: '镜像名称重复，请保留其中一项。', value }
      seen.add(imageKey)
      return { value: parsed.value }
    })
  }, [containerImages])
  const normalizedContainerImages = containerImageValidation.flatMap((item) => 'error' in item ? [] : [item.value])
  const canSubmitContainerImages = containerImages.length > 0 && normalizedContainerImages.length === containerImages.length

  function formatVerificationDate(value?: string) {
    if (!value) return '更新时间未知'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '更新时间未知'
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date)
  }

  async function submit(packages = selected) {
    if (!bug) return
    const needsContainerImages = packages.length === 0
    if (needsContainerImages && !canSubmitContainerImages) {
      setContainerImagesTouched(true)
      setError('请逐项填写符合规则的集群镜像名称。')
      return
    }
    const payload = packages.map(verificationPackageSnapshot)
    if (await onSubmit(bug, payload, needsContainerImages ? normalizedContainerImages : [])) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="test-workbench-dialog test-verification-dialog">
        <DialogHeader className="test-verification-header">
          <div>
            <div className="test-verification-kicker"><span><Check size={12} weight="bold" /></span>验证交付物</div>
            <DialogTitle>提交验证</DialogTitle>
            <DialogDescription>可选择一个或多个安装包，也可以不关联安装包。提交后会保存本次验证使用的版本快照。</DialogDescription>
          </div>
        </DialogHeader>
        <div className="test-verification-body">
          <div className="test-verification-picker">
            <div className="test-verification-section-heading">
              <strong>选择验证包</strong>
              <span>可跨安装包和架构累积选择</span>
            </div>
            <div className="test-verification-toolbar">
              <div className="test-verification-field">
                <span>渠道</span>
                <div className="test-verification-segmented" role="tablist" aria-label="安装包渠道">
                  {([
                    ['release', '正式包'],
                    ['ci', '测试包'],
                  ] as const).map(([value, label]) => (
                    <button
                      aria-selected={channel === value}
                      className={`${channel === value ? 'is-active ' : ''}test-verification-channel-${value}`}
                      key={value}
                      role="tab"
                      type="button"
                      onClick={() => {
                        setChannel(value)
                        setRulePage(0)
                        setRuleId('')
                      }}
                    >
                      <span className="test-verification-channel-dot" aria-hidden />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <Label className="test-verification-arch">架构
                <Select value={arch} onValueChange={setArch}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="amd64">amd64</SelectItem><SelectItem value="arm64">arm64</SelectItem></SelectContent>
                </Select>
              </Label>
            </div>
            {error ? <p className="test-form-error">{error}</p> : null}
            <div className="test-verification-browser">
              <section className="test-verification-package-panel">
                <div className="test-verification-panel-heading">
                  <div>
                    <strong>安装包目录</strong>
                    <span>{visibleRules.length} 个可用包</span>
                  </div>
                  <span className="test-verification-page-count">{rulePage + 1} / {rulePageCount}</span>
                </div>
                <div className="test-verification-category-list" role="tablist" aria-label="安装包类别">
                  {categories.map(([value, label]) => (
                    <button
                      aria-selected={category === value}
                      className={category === value ? 'is-active' : undefined}
                      key={value}
                      role="tab"
                      type="button"
                      onClick={() => { setCategory(value); setRulePage(0) }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label className="test-verification-search">
                  <MagnifyingGlass size={15} aria-hidden />
                  <Input
                    type="search"
                    aria-label="搜索安装包"
                    value={query}
                    onChange={(event) => { setQuery(event.target.value); setRulePage(0) }}
                    placeholder="搜索名称或 ID"
                  />
                </label>
                <div className="test-verification-rule-list">
                  {loading ? <p className="test-verification-empty-state">正在加载安装包目录...</p> : null}
                  {!loading && pageRules.length === 0 ? <p className="test-verification-empty-state">没有符合条件的安装包。</p> : null}
                  {pageRules.map((rule) => {
                    const ruleCategory = rule.pageKind?.labelZh || rule.category
                    return (
                      <button
                        className={rule.id === ruleId ? 'test-verification-rule is-selected' : 'test-verification-rule'}
                        key={rule.id}
                        type="button"
                        onClick={() => setRuleId(rule.id)}
                      >
                        <span>
                          <strong>{rule.name}</strong>
                          <small>{rule.id}</small>
                        </span>
                        <em>{ruleCategory}</em>
                      </button>
                    )
                  })}
                </div>
                <nav className="test-verification-pagination" aria-label="安装包分页">
                  <span>{visibleRules.length ? `${rulePage * rulePageSize + 1}-${Math.min((rulePage + 1) * rulePageSize, visibleRules.length)} / ${visibleRules.length}` : '0 个'}</span>
                  <div>
                    <Button aria-label="上一页" title="上一页" size="icon" variant="ghost" disabled={rulePage === 0} onClick={() => setRulePage((current) => Math.max(0, current - 1))}><CaretLeft /></Button>
                    <Button aria-label="下一页" title="下一页" size="icon" variant="ghost" disabled={rulePage >= rulePageCount - 1} onClick={() => setRulePage((current) => Math.min(rulePageCount - 1, current + 1))}><CaretRight /></Button>
                  </div>
                </nav>
              </section>
              <section className="test-verification-version-panel">
                <div className="test-verification-panel-heading">
                  <div>
                    <strong>{selectedRule?.name || '选择安装包'}</strong>
                    <span>{selectedRule ? `${versions.length} 个版本 · ${arch}` : '从左侧目录选择安装包'}</span>
                  </div>
                  {selectedRule && versions.length > 0 ? <span className="test-verification-version-count">显示 {Math.min(visibleVersionCount, versions.length)} / {versions.length}</span> : null}
                </div>
                {loadingVersions ? <p className="test-verification-empty-state">正在加载版本目录...</p> : null}
                {!loadingVersions && selectedRule && versions.length === 0 ? <p className="test-verification-empty-state">该安装包暂无可交付版本。</p> : null}
                {!loadingVersions && !selectedRule ? <p className="test-verification-empty-state">选择安装包后查看所有可用版本。</p> : null}
                {versions.length > 0 ? <div className="test-verification-version-list">
                  {versions.slice(0, visibleVersionCount).map((version, index) => {
                    const value = versionValue(version)
                    const versionKey = `${selectedRule?.id}:${channel}:${arch}:${value}`
                    const chosen = selectedVersionItems(version).length > 0
                    const versionLabel = version.label || version.version || version.hash || `版本 ${index + 1}`
                    return (
                      <button
                        aria-pressed={chosen}
                        className={`test-verification-version-row${chosen ? ' is-selected' : ''}`}
                        key={`${value}-${version.lastModified || index}`}
                        type="button"
                        onClick={() => void toggleVersion(version)}
                        disabled={Boolean(loadingVersionKey)}
                      >
                        <span className="test-verification-version-marker" aria-hidden>{chosen ? <Check size={13} weight="bold" /> : null}</span>
                        <span className="test-verification-version-main">
                          <strong>{versionLabel}</strong>
                          <small>{version.hash && version.hash !== versionLabel ? version.hash : '点击选择此版本的安装包'}</small>
                        </span>
                        <span className="test-verification-version-meta">{formatVerificationDate(version.lastModified)}</span>
                        {loadingVersionKey === versionKey ? <span className="test-verification-version-state">加载中...</span> : chosen ? <span className="test-verification-version-state">已选</span> : null}
                      </button>
                    )
                  })}
                </div> : null}
                {versions.length > visibleVersionCount ? <Button className="test-verification-more" type="button" variant="outline" onClick={() => setVisibleVersionCount((current) => Math.min(current + 10, versions.length))}>加载更多版本（剩余 {versions.length - visibleVersionCount}）</Button> : null}
              </section>
            </div>
            {selectedGroups.length > 0 ? (
              <div className="test-verification-selected">
                <div className="test-verification-selected-heading">
                  <strong>已选安装包</strong>
                  <span>{selectedGroups.length} 个</span>
                </div>
                <div className="test-verification-chips">
                  {selectedGroups.map(({ item, selectionKey }) => (
                    <span className="test-verification-chip" key={selectionKey}>
                      <span>
                        <strong>{item.sourcePackageName}</strong>
                        <small>{item.version || '版本未知'} · {item.arch}</small>
                      </span>
                      <button aria-label={`移除 ${item.sourcePackageName} ${item.version}`} type="button" onClick={() => removeSelected(selectionKey)}>
                        <X size={14} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <section className="test-verification-container-images" aria-labelledby="test-verification-container-images-title">
                <div className="test-verification-section-heading">
                  <div>
                    <strong id="test-verification-container-images-title">关联集群镜像</strong>
                    <span>未关联安装包时，至少填写一个带版本标识的镜像名称</span>
                  </div>
                  <span>{containerImages.length} / 20</span>
                </div>
                <div className="test-verification-container-image-list">
                  {containerImages.map((image, index) => {
                    const validation = containerImageValidation[index]
                    const imageError = validation && 'error' in validation ? validation.error : ''
                    const showError = Boolean(imageError && (containerImagesTouched || image.trim()))
                    return (
                      <div className="test-verification-container-image" key={`container-image-${index}`}>
                        <div className="test-verification-container-image-input">
                          <span aria-hidden className="test-verification-container-image-index">{index + 1}</span>
                          <Input
                            aria-describedby={showError ? `container-image-error-${index}` : undefined}
                            aria-invalid={showError}
                            aria-label={`集群镜像名称 ${index + 1}`}
                            autoCapitalize="none"
                            autoComplete="off"
                            maxLength={512}
                            placeholder="例如：ghcr.io/example/admin:v2.1.0"
                            spellCheck={false}
                            value={image}
                            onChange={(event) => {
                              setContainerImagesTouched(true)
                              setContainerImages((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))
                            }}
                          />
                          <Button
                            aria-label={`移除集群镜像 ${index + 1}`}
                            disabled={containerImages.length === 1}
                            size="icon"
                            title="移除集群镜像"
                            type="button"
                            variant="ghost"
                            onClick={() => setContainerImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                          ><Trash /></Button>
                        </div>
                        {showError ? <p className="test-form-error" id={`container-image-error-${index}`} role="alert">{imageError}</p> : null}
                      </div>
                    )
                  })}
                </div>
                <Button
                  className="test-verification-add-container-image"
                  disabled={containerImages.length >= 20}
                  type="button"
                  variant="outline"
                  onClick={() => setContainerImages((current) => [...current, ''])}
                ><Plus /> 添加镜像</Button>
              </section>
            )}
          </div>
        </div>
        <DialogFooter className="test-verification-footer">
          <div className="test-verification-footer-status">
            <strong>{selectedGroups.length > 0 ? `已选择 ${selectedGroups.length} 个安装包` : `已填写 ${normalizedContainerImages.length} 个集群镜像`}</strong>
            <span>{selectedGroups.length > 0 ? '提交后将记录版本快照，便于后续追溯。' : '每个镜像名称都会在提交前再次校验。'}</span>
          </div>
          <div className="test-verification-actions">
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="button" disabled={busy || (selectedGroups.length === 0 && !canSubmitContainerImages)} onClick={() => void submit()}>{busy ? '提交中...' : selectedGroups.length ? `提交验证（${selectedGroups.length}）` : `提交验证（集群镜像 ${normalizedContainerImages.length}）`}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AssignedTestBugs({
  currentUserId,
  initialBugId,
  organizationId,
  embedded = false,
  onBugSeen,
  onBugsChange,
  onExit,
}: {
  currentUserId?: number
  initialBugId?: number | null
  organizationId: OrganizationContext
  embedded?: boolean
  onBugSeen?: (bug: TestBug) => void
  onBugsChange?: (bugs: TestBug[]) => void
  onExit?: () => void
}) {
  const actionScope = `${currentUserId}:${organizationId}`
  const actionScopeRef = useRef(actionScope)
  useEffect(() => { actionScopeRef.current = actionScope }, [actionScope])
  const [bugs, setBugs] = useState<TestBug[]>([])
  const [mentionMembers, setMentionMembers] = useState<MentionMember[]>([])
  const [departedUserIds, setDepartedUserIds] = useState<number[]>([])
  const [selectedId, setSelectedId] = useState<number>()
  const [shareOpen, setShareOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [transferBug, setTransferBug] = useState<TestBug>()
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const [rejectBug, setRejectBug] = useState<TestBug>()
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [verificationBug, setVerificationBug] = useState<TestBug>()
  const [verificationDialogOpen, setVerificationDialogOpen] = useState(false)
  const [filterDialogOpen, setFilterDialogOpen] = useState(false)
  const [filterJoin, setFilterJoin] = useState<BugFilterJoin>('and')
  const [filterConditions, setFilterConditions] = useState<BugFilterCondition[]>(createDefaultBugFilterConditions)
  const [selectedSpaceId, setSelectedSpaceId] = useState<number>()
  const [searchQuery, setSearchQuery] = useState('')
  const refreshInFlightRef = useRef(false)
  const onBugsChangeRef = useRef(onBugsChange)

  useEffect(() => {
    onBugsChangeRef.current = onBugsChange
  }, [onBugsChange])

  const spaceOptions = useMemo(() => uniqueBugFilterOptions(bugs, (bug) => bug.testSpaceName
    ? {
      label: `${bug.testSpaceName}${bug.testSpaceVersionLabel ? ` · ${bug.testSpaceVersionLabel}` : ''}`,
      value: String(bug.testSpaceId),
    }
    : undefined), [bugs])

  function selectAssignedBugSpace(value: string) {
    const nextId = Number(value)
    if (!Number.isSafeInteger(nextId) || nextId <= 0) return
    setSelectedSpaceId(nextId)
    window.localStorage.setItem(getAssignedBugSpaceStorageKey(currentUserId, organizationId), String(nextId))
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    fetchAssignedTestBugs(organizationId)
      .then((result) => {
        if (!active) return
        setBugs(result.bugs)
        setDepartedUserIds(result.departedUserIds)
        setMentionMembers(result.members ?? [])
        onBugsChangeRef.current?.(result.bugs)
        const rememberedSpaceId = readAssignedBugSpaceId(currentUserId, organizationId)
        const initialBug = initialBugId ? result.bugs.find((bug) => bug.id === initialBugId) : undefined
        const nextSpaceId = initialBug?.testSpaceId
          ?? (rememberedSpaceId && result.bugs.some((bug) => bug.testSpaceId === rememberedSpaceId)
            ? rememberedSpaceId
            : result.bugs[0]?.testSpaceId)
        setSelectedSpaceId(nextSpaceId)
        if (nextSpaceId) {
          window.localStorage.setItem(
            getAssignedBugSpaceStorageKey(currentUserId, organizationId),
            String(nextSpaceId),
          )
        }
        setSelectedId(initialBugId && result.bugs.some((bug) => bug.id === initialBugId)
          ? initialBugId
          : result.bugs[0]?.id)
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Bug 加载失败。')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [currentUserId, initialBugId, organizationId])

  useEffect(() => {
    let active = true
    const refresh = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      if (refreshInFlightRef.current) return
      refreshInFlightRef.current = true
      fetchAssignedTestBugs(organizationId)
        .then((result) => {
          if (!active) return
          setBugs(result.bugs)
          setDepartedUserIds(result.departedUserIds)
          setMentionMembers(result.members ?? [])
          onBugsChangeRef.current?.(result.bugs)
          setSelectedSpaceId((current) => {
            if (current && result.bugs.some((bug) => bug.testSpaceId === current)) return current
            const remembered = readAssignedBugSpaceId(currentUserId, organizationId)
            return remembered && result.bugs.some((bug) => bug.testSpaceId === remembered)
              ? remembered
              : result.bugs[0]?.testSpaceId
          })
          setSelectedId((current) => (
            current && result.bugs.some((bug) => bug.id === current)
              ? current
              : result.bugs[0]?.id
          ))
        })
        .catch(() => undefined)
        .then(() => {
          refreshInFlightRef.current = false
        })
    }
    const interval = window.setInterval(refresh, notificationRefreshIntervalMs)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      active = false
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [currentUserId, organizationId])

  const spaceBugs = useMemo(() => bugs.filter((bug) => bug.testSpaceId === selectedSpaceId), [bugs, selectedSpaceId])
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase('zh-CN')
  const filteredBugs = useMemo(() => spaceBugs.filter((bug) => (
    matchesBugFilterConditions(bug, filterConditions, filterJoin) && (
      !normalizedSearchQuery || [
        `bug-${bug.id}`,
        bug.title,
        bug.environment,
        bug.testCaseTitle,
        bug.testCaseId ? `case-${bug.testCaseId}` : '',
        bug.testCaseFolderName,
        bug.testPlanName,
        bug.reporterName,
        bug.assigneeName,
      ].filter(Boolean).some((value) => String(value).toLocaleLowerCase('zh-CN').includes(normalizedSearchQuery))
    )
  )), [filterConditions, filterJoin, normalizedSearchQuery, spaceBugs])
  const selected = useMemo(
    () => filteredBugs.find((bug) => bug.id === selectedId),
    [filteredBugs, selectedId],
  )
  const filterOptions = useMemo<BugFilterOptions>(() => ({
    assignees: uniqueBugFilterOptions(spaceBugs, (bug) => bug.assigneeUserId && bug.assigneeName
      ? { label: bug.assigneeName, value: String(bug.assigneeUserId) }
      : undefined),
    plans: uniqueBugFilterOptions(spaceBugs, (bug) => bug.testPlanId && bug.testPlanName
      ? { label: bug.testPlanName, value: String(bug.testPlanId) }
      : undefined),
    reporters: uniqueBugFilterOptions(spaceBugs, (bug) => bug.reporterUserId && bug.reporterName
      ? { label: bug.reporterName, value: String(bug.reporterUserId) }
      : undefined),
    spaces: [],
    cases: uniqueBugFilterOptions(spaceBugs, (bug) => bug.testCaseId
      ? { label: `CASE-${bug.testCaseId} ${bug.testCaseTitle || ''}`, value: String(bug.testCaseId) }
      : undefined).map((item) => ({ ...item, folderIds: spaceBugs.find((bug) => String(bug.testCaseId) === item.value)?.testCaseDirectoryPath?.map((folder) => String(folder.id)) ?? [] })),
    folders: bugFolderOptions(spaceBugs),
  }), [spaceBugs])

  useEffect(() => {
    setSelectedId((current) => (
      current && filteredBugs.some((bug) => bug.id === current)
        ? current
        : filteredBugs[0]?.id
    ))
  }, [filteredBugs])

  useEffect(() => {
    if (selected) onBugSeen?.(selected)
  }, [onBugSeen, selected])

  useEffect(() => {
    if (transferDialogOpen || !transferBug) return
    const cleanup = window.setTimeout(() => {
      setTransferBug(undefined)
    }, 180)
    return () => window.clearTimeout(cleanup)
  }, [transferBug, transferDialogOpen])

  async function mutate(operation: () => Promise<{ bugs: TestBug[] }>, confirmed = false, matches: (result: { bugs: TestBug[] }) => boolean = () => false) {
    setBusy(true)
    setError('')
    try {
      const result = confirmed ? await reconcileAction(operation, () => fetchAssignedTestBugs(organizationId), matches) : await operation()
      if (actionScopeRef.current !== actionScope) return false
      setBugs(result.bugs)
      setSelectedId((current) => (
        current && result.bugs.some((bug) => bug.id === current)
          ? current
          : result.bugs[0]?.id
      ))
      onBugsChangeRef.current?.(result.bugs)
      return true
    } catch (mutationError) {
      if (confirmed) throw mutationError
      setError(mutationError instanceof Error ? mutationError.message : '操作失败。')
      return false
    } finally {
      setBusy(false)
    }
  }

  const Root = embedded ? 'section' : 'main'

  return (
    <Root className={embedded ? 'assigned-bugs-workspace' : 'assigned-bugs-shell'}>
      {!embedded ? (
        <header>
          <Button size="icon" variant="ghost" onClick={onExit}><ArrowLeft /></Button>
          <div><h1>Bug 工作台</h1></div>
        </header>
      ) : null}
      <WorkspaceError message={error} />
      {!loading && bugs.length > 0 ? (
        <div className="assigned-bugs-filter-toolbar">
          <Select value={selectedSpaceId ? String(selectedSpaceId) : ''} onValueChange={selectAssignedBugSpace}>
            <SelectTrigger className="assigned-bugs-space-select" aria-label="选择测试空间">
              <SelectValue placeholder="选择测试空间" />
            </SelectTrigger>
            <SelectContent>
              {spaceOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <label className="test-bug-search assigned-bugs-search">
            <MagnifyingGlass aria-hidden />
            <Input
              aria-label="搜索 Bug"
              placeholder="搜索 Bug 标题、编号或关联信息"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
          <Button
            className={filterConditions.length > 0 ? 'todo-filter-open-button active' : 'todo-filter-open-button'}
            type="button"
            variant="outline"
            onClick={() => setFilterDialogOpen(true)}
          >
            <FunnelSimple />
            筛选
            {filterConditions.length > 0 ? (
              <span className="assigned-bugs-filter-count">{filterConditions.length}</span>
            ) : null}
          </Button>
          <span className="assigned-bugs-filter-summary">
            {filterConditions.length > 0 || searchQuery.trim()
              ? `${filteredBugs.length} / ${spaceBugs.length} 条 Bug`
              : `共 ${spaceBugs.length} 条 Bug`}
          </span>
          {searchQuery.trim() ? <Button type="button" variant="ghost" onClick={() => setSearchQuery('')}>清除搜索</Button> : null}
        </div>
      ) : null}
      {loading ? (
        <p className="test-list-empty">正在加载...</p>
      ) : bugs.length === 0 ? (
        <div className="test-inline-empty"><CheckCircle size={32} /><h2>没有可查看的 Bug</h2></div>
      ) : filteredBugs.length === 0 ? (
        <div className="test-inline-empty assigned-bugs-filter-empty">
          <FunnelSimple size={32} />
          <h2>没有符合筛选条件的 Bug</h2>
          <Button type="button" variant="outline" onClick={() => setFilterConditions([])}>
            清除筛选
          </Button>
        </div>
      ) : (
        <div className="test-split-view">
                <div className="test-record-list">
            {filteredBugs.map((bug) => (
              <button key={bug.id} className={bug.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(bug.id)}>
                <div><code>BUG-{bug.id}</code><Badge className={`test-bug-status ${bug.status}`} variant="outline">{bugStatusLabel[bug.status]}</Badge></div>
                <strong>{bug.title}</strong>
                <small>{bug.testSpaceName || '未知测试空间'} · 版本号 {bug.testSpaceVersionLabel || '未指定'} · {formatTimestamp(bug.updatedAt)} · {bug.assigneeName || '未分配'}{bug.assigneeTransferSource === 'offboarding' ? '（离职转移）' : null}</small>
              </button>
            ))}
          </div>
          <div className="test-record-detail">
            {selected ? (
              <>
                <div className="test-detail-heading">
                  <div><code>BUG-{selected.id}</code><h2>{selected.title}</h2></div>
                  <div className="test-detail-heading-actions">
                    {selected.canShare ? <Button variant="outline" disabled={busy} onClick={() => setShareOpen(true)}><LinkSimple /> 分享 Bug</Button> : null}
                    {selected.canTransfer && (selected.transferCandidates?.length ?? 0) > 0 ? (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          setTransferBug(selected)
                          setTransferDialogOpen(true)
                        }}
                      >
                        {selected.assigneeUserId ? <ArrowsLeftRight /> : <UserPlus />}
                        {selected.assigneeUserId ? '转移' : '分配'}
                      </Button>
                    ) : null}
                    {selected.canManage && (
                      selected.status === 'pending_confirmation' || selected.status === 'assigned'
                    ) ? (
                      <Button disabled={busy} onClick={() => void mutate(() => updateAssignedTestBug(organizationId, selected.id, 'in_progress'))}>开始修复</Button>
                    ) : null}
                    {selected.canManage && (
                      selected.status === 'pending_confirmation' || selected.status === 'assigned'
                    ) ? (
                      <Button
                        className="test-bug-reject-button"
                        variant="destructive"
                        disabled={busy}
                        onClick={() => {
                          setRejectBug(selected)
                          setRejectDialogOpen(true)
                        }}
                      >
                        驳回
                      </Button>
                    ) : null}
                    {selected.canManage && selected.status === 'in_progress' ? (
                      <>
                        <Button className="test-bug-reject-button" variant="destructive" disabled>驳回</Button>
                        <Button disabled={busy} onClick={() => { setVerificationBug(selected); setVerificationDialogOpen(true) }}>提交验证</Button>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="test-detail-meta assigned-bug-detail-meta">
                  <span>负责人 <UserName departedUserIds={departedUserIds} name={selected.assigneeName || '未分配'} userId={selected.assigneeUserId} /></span>
                  <span>测试用例 <strong>{selected.testCaseId ? `CASE-${selected.testCaseId} ${selected.testCaseTitle || ''}` : '待补关联'}</strong></span>
                  <span>用例目录 <strong>{selected.testCaseId ? selected.testCaseFolderName || '未分类' : '待补关联'}</strong></span>
                  <span>测试空间 <strong>{selected.testSpaceName || '未记录'}</strong></span>
                  <span>版本号 <strong>{selected.testSpaceVersionLabel || '未指定'}</strong></span>
                  <span>严重程度 <strong>{severityLabel[selected.severity]}</strong></span>
                </div>
                <DetailBlock title="复现步骤" content={selected.reproductionSteps} />
                <DetailBlock title="预期结果" content={selected.expectedResult} />
                <DetailBlock title="实际结果" content={selected.actualResult} />
                <BugVerificationSubmissions bugId={selected.id} submissions={selected.verificationSubmissions} />
                <BugCommentsSection
                  bug={selected}
                  busy={busy}
                  currentUserId={currentUserId}
                  departedUserIds={departedUserIds}
                  draftOwnerUserId={currentUserId}
                  mentionMembers={selected.organizationMembers ?? mentionMembers}
                  placeholder="说明修复内容或提交版本，支持粘贴、拖入或上传图片和视频。"
                  onComment={selected.canComment
                    ? (bug, content) => mutate(() => addAssignedTestBugComment(organizationId, bug.id, content))
                    : undefined}
                  onDeleteComment={selected.canComment
                    ? (bug, comment) => mutate(() => deleteAssignedTestBugComment(organizationId, bug.id, comment.id), true, (result) => result.bugs.some((item) => item.id === bug.id && !item.comments.some((entry) => entry.id === comment.id)))
                    : undefined}
                  onUpdateComment={selected.canComment
                    ? (bug, comment, content) => mutate(() => updateAssignedTestBugComment(organizationId, bug.id, comment.id, content))
                    : undefined}
                />
              </>
            ) : null}
          </div>
        </div>
      )}
      <BugTransferDialog
        bug={transferBug}
        busy={busy}
        open={transferDialogOpen}
        onOpenChange={setTransferDialogOpen}
        onSubmit={(bug, assigneeUserId, reason) => mutate(() => transferAssignedTestBug(organizationId, bug.id, {
          assigneeUserId,
          reason,
        }))}
      />
      <BugRejectDialog
        bug={rejectBug}
        busy={busy}
        open={rejectDialogOpen}
        onOpenChange={setRejectDialogOpen}
        onSubmit={(bug, reason) => mutate(() => rejectAssignedTestBug(organizationId, bug.id, reason), true, (result) => result.bugs.some((item) => item.id === bug.id && item.status === 'rejected'))}
      />
      <BugVerificationDialog
        bug={verificationBug}
        busy={busy}
        onOpenChange={(open) => {
          setVerificationDialogOpen(open)
          if (!open) window.setTimeout(() => setVerificationBug(undefined), 180)
        }}
        onSubmit={(bug, packages, containerImages) => mutate(() => submitAssignedBugVerification(organizationId, bug.id, packages, containerImages))}
        open={verificationDialogOpen}
        organizationId={organizationId}
      />
      {selected ? <BugShareDialog bugId={selected.id} open={shareOpen} onOpenChange={setShareOpen} /> : null}
      <BugFilterBuilderDialog
        conditions={filterConditions}
        includeTestSpace={false}
        join={filterJoin}
        open={filterDialogOpen}
        options={filterOptions}
        onOpenChange={setFilterDialogOpen}
        onApply={(next) => {
          setFilterConditions(next.conditions)
          setFilterJoin(next.join)
        }}
      />
    </Root>
  )
}
