import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Buildings,
  CheckCircle,
  ClockCounterClockwise,
  Cloud,
  Copy,
  Cpu,
  Database,
  Eye,
  EyeSlash,
  GearSix,
  GithubLogo,
  MagnifyingGlass,
  PaperPlaneTilt,
  Plus,
  ShieldCheck,
  SpinnerGap,
  Trash,
  UserGear,
  UserMinus,
  WarningCircle,
  Wrench,
} from '@phosphor-icons/react'
import {
  createPlatformOrganization,
  deletePlatformOrganization,
  fetchOffboardingPreview,
  fetchManagedUsers,
  fetchPlatformConfig,
  fetchPlatformConfigHistory,
  fetchPlatformConfigHistoryDetail,
  fetchPlatformOrganizations,
  fetchPlatformRuntimeStatus,
  fetchPlatformSecurityStatus,
  fetchPlatformMaintenance,
  fetchPlatformMaintenanceHistory,
  fetchApplicationMigrations,
  offboardManagedUser,
  revealPlatformSecret,
  restorePlatformConfigRevision,
  savePlatformConfigSection,
  setPlatformAdmin,
  testPlatformConfigSection,
  updateManagedUserPermissions,
  updateManagedUserStatus,
  updatePlatformMaintenance,
  validatePlatformPackageRules,
  ApiError,
  type ManagedUser,
  type OffboardingPreview,
  type UserRole,
} from '@/api'
import type {
  PlatformConfig,
  PlatformConfigChangeGroup,
  PlatformConfigHistoryDetail,
  PlatformConfigHistoryItem,
  PlatformConfigResponse,
  PlatformConfigSection,
  PlatformMaintenanceRecord,
  PlatformOrganization,
  PlatformRuntimeStatus,
  PlatformSecurityStatus,
  PlatformStatus,
  ApplicationMigration,
  SecretState,
} from '@/platform-management-types'
import {
  platformConfigRevisionProgress,
  platformConfigRuntimeOverallStatus,
  platformConfigSectionHasDraftChanges,
} from '../../shared/platform-config'
import { derivePlatformCallbackUrls } from '../../shared/platform-callback-urls'
import { maintenanceDurationLabel } from '../../shared/maintenance-duration'
import { userRoleLabel } from '@/user-roles'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import './platform-management-workbench.css'

type Tab = PlatformConfigSection | 'users' | 'organizations' | 'maintenance' | 'security' | 'runtime' | 'history'
type SecretDrafts = Record<string, string | undefined>
type UserTab = 'users' | 'admins'

const tabs: Array<{ group: string; icon: typeof GearSix; id: Tab; label: string }> = [
  { group: '平台', icon: GearSix, id: 'general', label: '平台信息' },
  { group: '平台', icon: UserGear, id: 'users', label: '用户与角色' },
  { group: '平台', icon: Buildings, id: 'organizations', label: '组织管理' },
  { group: '平台', icon: Wrench, id: 'maintenance', label: '维护模式' },
  { group: '服务配置', icon: Cpu, id: 'ai', label: '全局 AI' },
  { group: '服务配置', icon: PaperPlaneTilt, id: 'email', label: '邮箱配置' },
  { group: '服务配置', icon: Cloud, id: 'storage', label: '对象存储' },
  { group: '服务配置', icon: Database, id: 'packages', label: '包市场规则' },
  { group: '服务配置', icon: PaperPlaneTilt, id: 'feishu', label: '飞书对接' },
  { group: '服务配置', icon: GithubLogo, id: 'github', label: 'GitHub Actions' },
  { group: '审计', icon: ShieldCheck, id: 'security', label: '数据安全' },
  { group: '审计', icon: ClockCounterClockwise, id: 'runtime', label: '版本与运行状态' },
  { group: '审计', icon: ClockCounterClockwise, id: 'history', label: '配置历史' },
]

const sectionSecretFields: Partial<Record<PlatformConfigSection, string[]>> = {
  ai: ['apiKey'],
  email: ['password'],
  feishu: ['appSecret', 'verificationToken'],
  github: ['token'],
  storage: ['accessKeyId', 'accessKeySecret', 'urlSecret'],
}

const roleValues: UserRole[] = ['developer', 'tester', 'organization_admin']
const configTabs: PlatformConfigSection[] = ['general', 'ai', 'email', 'storage', 'packages', 'feishu', 'github']

function cloneConfig(config: PlatformConfig) {
  return structuredClone(config)
}

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function sectionFields(config: PlatformConfig, section: PlatformConfigSection) {
  const value = { ...config[section] } as Record<string, unknown>
  for (const secret of sectionSecretFields[section] ?? []) delete value[secret]
  if (section === 'feishu') delete value.oauthStateSecret
  return value
}

function Field({ children, hint, label }: { children: ReactNode; hint?: string; label: string }) {
  return <Label className="platform-field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</Label>
}

function ToggleField({ checked, label, onChange }: { checked: boolean; label: string; onChange: (value: boolean) => void }) {
  return <label className="platform-toggle"><span>{label}</span><Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} /></label>
}

function HistoryChanges({
  compact = false,
  emptyLabel,
  groups,
}: {
  compact?: boolean
  emptyLabel: string
  groups: PlatformConfigChangeGroup[]
}) {
  if (groups.length === 0) return <p className="platform-history-empty">{emptyLabel}</p>
  return <div className={compact ? 'platform-history-changes compact' : 'platform-history-changes'}>{groups.map((group) => (
    <section key={group.section}>
      <h5>{group.sectionLabel}</h5>
      <div>{group.changes.map((change) => (
        <div className="platform-history-change" key={change.field}>
          <strong>{change.label}</strong>
          {compact ? <span>{change.kind === 'long-text' ? '内容将恢复' : `${change.before} → ${change.after}`}</span> : change.kind === 'long-text' ? (
            <details>
              <summary>查看修改前后内容</summary>
              <div className="platform-history-text-diff">
                <div><span>修改前</span><pre>{change.before}</pre></div>
                <div><span>修改后</span><pre>{change.after}</pre></div>
              </div>
            </details>
          ) : <span>{change.before} <span aria-hidden="true">→</span> {change.after}</span>}
        </div>
      ))}</div>
    </section>
  ))}</div>
}

function generateRandomSecret() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) => (
    value.toString(16).padStart(2, '0')
  )).join('')
}

function SecretField({
  allowGenerate,
  draftValue,
  field,
  label,
  onChange,
  onError,
  onReveal,
  state,
}: {
  allowGenerate: boolean
  draftValue: string
  field: string
  label: string
  onChange: (value: string) => void
  onError: (error: unknown) => void
  onReveal: () => Promise<string>
  state: SecretState
}) {
  const [shown, setShown] = useState(false)
  const [revealed, setRevealed] = useState('')
  const [busy, setBusy] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorValue, setEditorValue] = useState('')
  const [editorShown, setEditorShown] = useState(false)
  const [editorError, setEditorError] = useState('')
  const revealRequest = useRef(0)
  const editorInputId = useId()
  const configured = state.configured || Boolean(draftValue)

  useEffect(() => {
    revealRequest.current += 1
    setShown(false)
    setRevealed('')
  }, [draftValue, field, state.configured])

  useEffect(() => {
    const hide = () => {
      revealRequest.current += 1
      setRevealed('')
      setShown(false)
      setEditorShown(false)
    }
    const hideWhenDocumentLeaves = () => {
      if (document.visibilityState === 'hidden') hide()
    }
    document.addEventListener('visibilitychange', hideWhenDocumentLeaves)
    window.addEventListener('blur', hide)
    return () => {
      revealRequest.current += 1
      document.removeEventListener('visibilitychange', hideWhenDocumentLeaves)
      window.removeEventListener('blur', hide)
    }
  }, [])

  async function toggle() {
    if (shown) {
      revealRequest.current += 1
      setShown(false)
      setRevealed('')
      return
    }
    if (!draftValue && state.configured && state.revealable) {
      setBusy(true)
      const requestId = ++revealRequest.current
      try {
        const value = await onReveal()
        if (requestId !== revealRequest.current) return
        setRevealed(value)
      } catch (revealError) {
        onError(revealError)
        return
      } finally {
        setBusy(false)
      }
    }
    setShown(true)
  }

  useEffect(() => {
    if (!shown) return
    const timer = window.setTimeout(() => {
      setRevealed('')
      setShown(false)
    }, 30_000)
    return () => window.clearTimeout(timer)
  }, [shown])

  function resetEditor() {
    setEditorValue('')
    setEditorShown(false)
    setEditorError('')
  }

  function changeEditorOpen(open: boolean) {
    if (!open) resetEditor()
    setEditorOpen(open)
  }

  function openEditor() {
    revealRequest.current += 1
    setRevealed('')
    setShown(false)
    resetEditor()
    setEditorOpen(true)
  }

  function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (editorValue.length < 8) {
      setEditorError('请输入至少 8 位的新值。')
      return
    }
    onChange(editorValue)
    setEditorOpen(false)
    resetEditor()
  }

  return (
    <>
      <div className="platform-field">
        <span>{label}</span>
        <div className="platform-secret-control">
          <span className={shown ? 'platform-secret-plain' : 'platform-secret-dots'}>
            {shown ? draftValue || revealed : configured ? '••••••••••••' : '未配置'}
          </span>
          {configured ? <span className="platform-secret-state">{draftValue ? '待保存' : '已配置'}</span> : null}
          <Button
            aria-pressed={shown}
            size="icon"
            variant="ghost"
            type="button"
            disabled={busy || (!draftValue && (!state.configured || !state.revealable))}
            title={shown ? `隐藏${label}` : `显示${label}`}
            onClick={() => void toggle()}
          >
            {busy ? <SpinnerGap className="animate-spin" /> : shown ? <EyeSlash /> : <Eye />}
          </Button>
          <Button type="button" variant="ghost" onClick={openEditor}>{configured ? '替换' : '设置'}</Button>
        </div>
      </div>
      <Dialog open={editorOpen} onOpenChange={changeEditorOpen}>
        <DialogContent>
          <form className="platform-secret-dialog" onSubmit={submitEditor}>
            <DialogHeader>
              <DialogTitle>{configured ? '替换' : '设置'}{label}</DialogTitle>
              <DialogDescription>新值将先加入当前页草稿，点击页面底部的“保存更改”后才会生效。</DialogDescription>
            </DialogHeader>
            <Label className="platform-secret-dialog-field" htmlFor={editorInputId}>
              <span>新值</span>
              <div className="platform-secret-dialog-input">
                <Input
                  autoFocus
                  aria-describedby={editorError ? `${editorInputId}-error` : undefined}
                  aria-invalid={Boolean(editorError)}
                  autoComplete="new-password"
                  id={editorInputId}
                  type={editorShown ? 'text' : 'password'}
                  placeholder={`输入新的${label}`}
                  value={editorValue}
                  onChange={(event) => {
                    setEditorValue(event.target.value)
                    setEditorError('')
                  }}
                />
                <Button
                  aria-label={editorShown ? '隐藏新值' : '显示新值'}
                  aria-pressed={editorShown}
                  size="icon"
                  title={editorShown ? '隐藏新值' : '显示新值'}
                  type="button"
                  variant="ghost"
                  onClick={() => setEditorShown((current) => !current)}
                >
                  {editorShown ? <EyeSlash /> : <Eye />}
                </Button>
              </div>
            </Label>
            {allowGenerate ? <Button className="platform-secret-generate" type="button" variant="link" onClick={() => { setEditorValue(generateRandomSecret()); setEditorError('') }}>生成随机密钥</Button> : null}
            {editorError ? <p className="form-error" id={`${editorInputId}-error`} role="alert">{editorError}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => changeEditorOpen(false)}>取消</Button>
              <Button type="submit">更新草稿</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function PlatformManagementWorkbench({
  currentUserId,
  sidebarNavigationHost,
  topbarActionHost,
  onAuthorizationLost,
}: {
  currentUserId: number
  sidebarNavigationHost: HTMLDivElement | null
  topbarActionHost: HTMLDivElement | null
  onAuthorizationLost: () => void
}) {
  const [tab, setTab] = useState<Tab>('general')
  const [userTab, setUserTab] = useState<UserTab>('users')
  const [loaded, setLoaded] = useState<PlatformConfigResponse>()
  const [draft, setDraft] = useState<PlatformConfig>()
  const [secrets, setSecrets] = useState<SecretDrafts>({})
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [organizations, setOrganizations] = useState<PlatformOrganization[]>([])
  const [runtime, setRuntime] = useState<PlatformRuntimeStatus>()
  const [maintenance, setMaintenance] = useState<PlatformStatus>()
  const [maintenanceMessage, setMaintenanceMessage] = useState('')
  const [maintenanceRecords, setMaintenanceRecords] = useState<PlatformMaintenanceRecord[]>([])
  const [maintenanceRecordsCursor, setMaintenanceRecordsCursor] = useState<number>()
  const [maintenanceRecordsLoading, setMaintenanceRecordsLoading] = useState(false)
  const [maintenanceClock, setMaintenanceClock] = useState(() => Date.now())
  const [migrations, setMigrations] = useState<ApplicationMigration[]>([])
  const [security, setSecurity] = useState<PlatformSecurityStatus>()
  const [history, setHistory] = useState<PlatformConfigHistoryItem[]>([])
  const [historyDetail, setHistoryDetail] = useState<PlatformConfigHistoryDetail>()
  const [historyDetailLoading, setHistoryDetailLoading] = useState(false)
  const [rolloutRevision, setRolloutRevision] = useState<number>()
  const [runtimeCheckFailed, setRuntimeCheckFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [testResult, setTestResult] = useState('')
  const [testEmailRecipient, setTestEmailRecipient] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [organizationName, setOrganizationName] = useState('')
  const [ownerUserId, setOwnerUserId] = useState('')
  const [grantUserId, setGrantUserId] = useState('')
  const [grantAdminOpen, setGrantAdminOpen] = useState(false)
  const [organizationSearch, setOrganizationSearch] = useState('')
  const [offboardingUser, setOffboardingUser] = useState<ManagedUser>()
  const [offboardingPreview, setOffboardingPreview] = useState<OffboardingPreview>()
  const [offboardingSelections, setOffboardingSelections] = useState<Record<number, string>>({})

  function handleError(value: unknown, fallback: string) {
    if (value instanceof ApiError && (value.status === 401 || value.status === 403)) {
      setSecrets({})
      onAuthorizationLost()
      return
    }
    setError(messageOf(value, fallback))
  }

  async function loadConfig() {
    const response = await fetchPlatformConfig()
    setLoaded(response)
    setDraft(cloneConfig(response.config))
    setSecrets({})
  }

  async function loadUsers() {
    const { users: nextUsers } = await fetchManagedUsers()
    setUsers(nextUsers)
  }

  async function loadOrganizations(search = organizationSearch) {
    const response = await fetchPlatformOrganizations(search)
    setOrganizations(response.organizations)
  }

  async function loadRuntime() {
    const [runtimeResponse, historyResponse, maintenanceResponse] = await Promise.all([
      fetchPlatformRuntimeStatus(),
      fetchPlatformConfigHistory(),
      fetchPlatformMaintenance(),
    ])
    setRuntime(runtimeResponse)
    setMaintenance(maintenanceResponse)
    setMaintenanceMessage(maintenanceResponse.maintenance.message)
    setRuntimeCheckFailed(false)
    setHistory(historyResponse.history)
  }

  useEffect(() => {
    setBusy(true)
    Promise.all([
      loadConfig(),
      loadUsers(),
      fetchPlatformOrganizations().then((response) => setOrganizations(response.organizations)),
      fetchPlatformSecurityStatus().then(setSecurity),
      fetchApplicationMigrations().then((response) => setMigrations(response.migrations)),
      fetchPlatformMaintenanceHistory().then((response) => {
        setMaintenanceRecords(response.records)
        setMaintenanceRecordsCursor(response.nextCursor)
      }),
      loadRuntime(),
    ])
      .catch((loadError) => handleError(loadError, '平台信息读取失败。'))
      .finally(() => setBusy(false))
    // The workbench performs one initial snapshot load; authorization failures unmount it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => setSecrets({}), [])

  const hasActiveMaintenanceRecord = maintenanceRecords.some((record) => record.status === 'active')

  useEffect(() => {
    if (!hasActiveMaintenanceRecord) return
    const timer = window.setInterval(() => setMaintenanceClock(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [hasActiveMaintenanceRecord])

  useEffect(() => {
    if (!loaded?.revision) return
    let active = true
    const timer = window.setInterval(() => {
      void Promise.all([fetchPlatformRuntimeStatus(), fetchPlatformMaintenance()])
        .then(([response, maintenanceResponse]) => {
          if (active) {
            setRuntime(response)
            setMaintenance(maintenanceResponse)
            setRuntimeCheckFailed(false)
          }
        })
        .catch(() => { if (active) setRuntimeCheckFailed(true) })
    }, rolloutRevision ? 2_000 : 5_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [loaded?.revision, rolloutRevision])

  async function changeMaintenance(enabled: boolean) {
    if (!maintenance) return false
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await updatePlatformMaintenance(
        enabled,
        enabled ? maintenanceMessage : '',
        maintenance.maintenance.revision,
      )
      const [next, historyResponse] = await Promise.all([
        fetchPlatformMaintenance(),
        fetchPlatformMaintenanceHistory(),
      ])
      setMaintenance(next)
      setMaintenanceMessage(next.maintenance.message)
      setMaintenanceRecords(historyResponse.records)
      setMaintenanceRecordsCursor(historyResponse.nextCursor)
      setNotice(enabled ? '平台已进入维护模式。' : '维护模式已结束，业务访问已恢复。')
      return true
    } catch (changeError) {
      if (changeError instanceof ApiError && changeError.responseBody && typeof changeError.responseBody === 'object' &&
          'blockers' in changeError.responseBody && Array.isArray(changeError.responseBody.blockers)) {
        setError(`当前还不能结束维护：${changeError.responseBody.blockers.join('、')}`)
      } else {
        handleError(changeError, '维护状态更新失败。')
      }
      return false
    } finally {
      setBusy(false)
    }
  }

  async function loadMoreMaintenanceRecords() {
    if (!maintenanceRecordsCursor || maintenanceRecordsLoading) return
    setMaintenanceRecordsLoading(true)
    try {
      const response = await fetchPlatformMaintenanceHistory(maintenanceRecordsCursor)
      setMaintenanceRecords((current) => [...current, ...response.records])
      setMaintenanceRecordsCursor(response.nextCursor)
    } catch (loadError) {
      handleError(loadError, '维护记录读取失败。')
    } finally {
      setMaintenanceRecordsLoading(false)
    }
  }

  function updateSection<K extends PlatformConfigSection>(section: K, patch: Partial<PlatformConfig[K]>) {
    setDraft((current) => current ? { ...current, [section]: { ...current[section], ...patch } } : current)
    setNotice('')
    setRolloutRevision(undefined)
    setTestResult('')
  }

  function updateSecret(section: PlatformConfigSection, field: string, value: string) {
    const path = `${section}.${field}`
    setSecrets((current) => ({ ...current, [path]: value }))
    setNotice('')
    setRolloutRevision(undefined)
    setTestResult('')
  }

  function secretActions(section: PlatformConfigSection) {
    return Object.fromEntries((sectionSecretFields[section] ?? []).map((field) => {
      const path = `${section}.${field}`
      if (secrets[path]) return [field, { action: 'replace' as const, value: secrets[path] }]
      return [field, { action: 'keep' as const }]
    }))
  }

  async function saveSection(section: PlatformConfigSection) {
    if (!draft || !loaded) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await savePlatformConfigSection(section, {
        expectedRevision: loaded.revision,
        fields: sectionFields(draft, section),
        requestId: crypto.randomUUID(),
        secrets: secretActions(section),
      })
      setSecrets({})
      await loadConfig()
      if (result.changed) {
        setRolloutRevision(result.revision)
      } else {
        setRolloutRevision(undefined)
        setNotice('当前配置没有变化，未生成新版本。')
      }
      await loadRuntime()
    } catch (saveError) {
      handleError(saveError, '配置保存失败。')
    } finally {
      setBusy(false)
    }
  }

  function restoreSection(section: PlatformConfigSection) {
    if (!loaded) return
    setDraft((current) => current
      ? { ...current, [section]: cloneConfig(loaded.config)[section] }
      : current)
    setSecrets((current) => Object.fromEntries(
      Object.entries(current).filter(([path]) => !path.startsWith(`${section}.`)),
    ))
    setNotice('')
    setRolloutRevision(undefined)
    setTestResult('')
  }

  async function openHistoryDetail(revision: number) {
    setHistoryDetailLoading(true)
    setError('')
    try {
      setHistoryDetail(await fetchPlatformConfigHistoryDetail(revision))
    } catch (detailError) {
      handleError(detailError, '配置历史详情读取失败。')
    } finally {
      setHistoryDetailLoading(false)
    }
  }

  async function restoreRevision(targetRevision: number) {
    if (!loaded) return false
    const result = await restorePlatformConfigRevision(targetRevision, loaded.revision)
    setSecrets({})
    await loadConfig()
    if (result.changed) {
      setNotice('')
      setRolloutRevision(result.revision)
    } else {
      setRolloutRevision(undefined)
      setNotice(`当前配置已与版本 v${targetRevision} 一致，未生成新版本。`)
    }
    await loadRuntime()
    setHistoryDetail(undefined)
    return true
  }

  async function testSection(section: PlatformConfigSection, action: 'connect' | 'send-email' = 'connect') {
    if (!draft || !loaded) return
    setBusy(true)
    setError('')
    setTestResult('')
    try {
      const result = await testPlatformConfigSection(section, {
        action,
        expectedRevision: loaded.revision,
        fields: sectionFields(draft, section),
        ...(action === 'send-email' ? { recipient: testEmailRecipient.trim() } : {}),
        secrets: secretActions(section),
      })
      setTestResult(result.checks.map((check) => `${check.ok ? '通过' : '失败'}：${check.label}，${check.message}`).join('\n'))
    } catch (testError) {
      handleError(testError, '连接测试失败。')
    } finally {
      setBusy(false)
    }
  }

  async function reveal(section: PlatformConfigSection, field: string) {
    if (!loaded) return ''
    const result = await revealPlatformSecret(section, field, loaded.revision)
    return result.value
  }

  async function saveUser(user: ManagedUser) {
    setBusy(true)
    setError('')
    try {
      await updateManagedUserPermissions(user.id, {
        expectedVersion: user.permissionVersion,
        platformAdmin: user.platformAdmin,
        roles: user.roles,
      })
      if (user.id === currentUserId && !user.platformAdmin) {
        onAuthorizationLost()
        return
      }
      await loadUsers()
      setNotice(`已更新 ${user.displayName} 的角色与权限。`)
    } catch (saveError) {
      handleError(saveError, '用户权限保存失败。')
    } finally {
      setBusy(false)
    }
  }

  async function setUserStatus(user: ManagedUser, status: 'active' | 'disabled'): Promise<boolean> {
    setBusy(true)
    setError('')
    try {
      const result = await updateManagedUserStatus(user, status)
      setUsers((current) => current.map((item) => item.id === user.id ? {
        ...item,
        accountStatus: result.accountStatus,
        permissionVersion: result.permissionVersion,
      } : item))
      setNotice(status === 'active' ? '账号已启用。' : '账号已停用，现有登录会话已失效。')
      return true
    } finally {
      setBusy(false)
    }
  }

  async function enableUser(user: ManagedUser) {
    try {
      await setUserStatus(user, 'active')
    } catch (saveError) {
      handleError(saveError, '账号状态更新失败。')
    }
  }

  async function disableUser(user: ManagedUser) {
    try {
      return await setUserStatus(user, 'disabled')
    } catch (saveError) {
      if (saveError instanceof ApiError && (saveError.status === 401 || saveError.status === 403)) {
        handleError(saveError, '账号状态更新失败。')
        return false
      }
      throw saveError
    }
  }

  async function grantPlatformAdmin() {
    const user = users.find((item) => item.id === Number(grantUserId))
    if (!user) return
    setBusy(true)
    setError('')
    try {
      await setPlatformAdmin(user.id, true, user.permissionVersion)
      setGrantAdminOpen(false)
      setGrantUserId('')
      await loadUsers()
      setNotice(`已授予 ${user.displayName} 超级管理员权限。`)
    } catch (grantError) {
      handleError(grantError, '授予超级管理员失败。')
    } finally {
      setBusy(false)
    }
  }

  async function revokePlatformAdmin(user: ManagedUser): Promise<boolean> {
    setBusy(true)
    setError('')
    try {
      await setPlatformAdmin(user.id, false, user.permissionVersion)
      await loadUsers()
      setNotice(`已移除 ${user.displayName} 的超级管理员权限。`)
      return true
    } catch (revokeError) {
      handleError(revokeError, '移除超级管理员失败。')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function openOffboarding(user: ManagedUser) {
    setBusy(true)
    setError('')
    try {
      const preview = await fetchOffboardingPreview(user.id)
      setOffboardingUser(user)
      setOffboardingPreview(preview)
      setOffboardingSelections(Object.fromEntries(preview.organizations.map((organization) => [organization.id, ''])))
    } catch (previewError) {
      handleError(previewError, '离职信息读取失败。')
    } finally {
      setBusy(false)
    }
  }

  async function submitOffboarding() {
    if (!offboardingUser || !offboardingPreview) return
    const selections = offboardingPreview.organizations.map((organization) => ({
      organizationId: organization.id,
      targetAdminUserId: Number(offboardingSelections[organization.id]),
    }))
    if (selections.some((selection) => !Number.isSafeInteger(selection.targetAdminUserId) || selection.targetAdminUserId <= 0)) {
      setError('请为每个组织选择接收管理员。')
      return
    }
    setBusy(true)
    setError('')
    try {
      await offboardManagedUser(offboardingUser, selections)
      setOffboardingUser(undefined)
      setOffboardingPreview(undefined)
      await loadUsers()
      setNotice('离职交接已完成。')
    } catch (offboardingError) {
      handleError(offboardingError, '离职操作失败。')
    } finally {
      setBusy(false)
    }
  }

  async function createOrganization() {
    const userId = Number(ownerUserId)
    if (!organizationName.trim() || !Number.isSafeInteger(userId)) return
    setBusy(true)
    setError('')
    try {
      await createPlatformOrganization(organizationName, userId)
      setCreateOpen(false)
      setOrganizationName('')
      setOwnerUserId('')
      await loadOrganizations()
      setNotice('组织已创建。')
    } catch (createError) {
      handleError(createError, '组织创建失败。')
    } finally {
      setBusy(false)
    }
  }

  const selected = tabs.find((item) => item.id === tab) ?? tabs[0]
  const eligibleOwners = users.filter((user) => user.accountStatus === 'active' && (user.isBuiltinAdmin || user.feishuIdentityVerified))
  const platformAdminCandidates = users.filter((user) => user.platformAdminEligible)

  if (!draft || !loaded) {
    return <div className="platform-loading">{busy ? <SpinnerGap className="animate-spin" /> : null}{error || '正在读取平台配置…'}</div>
  }

  const callbackUrls = derivePlatformCallbackUrls(draft.general.publicUrl)

  const secret = (section: PlatformConfigSection, field: string, label: string, state: SecretState) => (
    <SecretField
      key={`${section}.${field}:${loaded.revision}`}
      allowGenerate={section === 'storage' && field === 'urlSecret'}
      draftValue={secrets[`${section}.${field}`] ?? ''}
      field={`${section}.${field}`}
      label={label}
      state={state}
      onChange={(value) => updateSecret(section, field, value)}
      onError={(revealError) => handleError(revealError, '凭据读取失败。')}
      onReveal={() => reveal(section, field)}
    />
  )

  const platformSidebarNavigation = sidebarNavigationHost
    ? createPortal(
      <nav className="nav-list platform-sidebar-nav" aria-label="平台管理导航">
        {[...new Set(tabs.map((item) => item.group))].map((group) => (
          <div className="nav-group" key={group} role="group" aria-label={group}>
            <div className="nav-group-label">{group}</div>
            {tabs.filter((item) => item.group === group).map((item) => {
              const Icon = item.icon
              return (
                <Button
                  aria-current={tab === item.id ? 'page' : undefined}
                  className={tab === item.id ? 'nav-button active' : 'nav-button'}
                  key={item.id}
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setTab(item.id)
                    setSecrets({})
                    setError('')
                    setNotice('')
                    setTestResult('')
                  }}
                >
                  <Icon size={18} />
                  {item.label}
                </Button>
              )
            })}
          </div>
        ))}
      </nav>,
      sidebarNavigationHost,
    )
    : null

  const activeConfigSection = configTabs.includes(tab as PlatformConfigSection)
    ? tab as PlatformConfigSection
    : null
  const sectionChanged = Boolean(
    activeConfigSection && loaded && draft && platformConfigSectionHasDraftChanges(
      loaded.config as unknown as Record<string, unknown>,
      draft as unknown as Record<string, unknown>,
      activeConfigSection,
      secrets,
    ),
  )
  const runtimeStatus = runtime ? platformConfigRuntimeOverallStatus(runtime) : 'loading'
  const onlineInstances = runtime?.instances.filter((instance) => instance.status !== 'offline') ?? []
  const maintenanceAppliedCount = maintenance
    ? onlineInstances.filter((instance) => instance.operationalRevision === maintenance.maintenance.revision).length
    : 0
  const rollout = runtime && rolloutRevision
    ? platformConfigRevisionProgress(runtime, rolloutRevision)
    : null
  const rolloutMessage = rollout
    ? runtimeCheckFailed
      ? `版本 v${rollout.targetRevision} 已保存，状态确认失败，正在重试。`
      : rollout.state === 'applied'
        ? `版本 v${rollout.targetRevision} 已由全部 ${rollout.onlineCount} 个在线 API 实例加载完成。`
        : rollout.state === 'error'
          ? `版本 v${rollout.targetRevision} 已保存，但有 ${rollout.errorCount} 个在线 API 实例加载异常。`
          : rollout.state === 'offline'
            ? `版本 v${rollout.targetRevision} 已保存，当前没有在线 API 实例。`
            : rollout.state === 'superseded'
              ? `版本 v${rollout.targetRevision} 已被更新的配置版本替代，请刷新页面确认。`
              : `版本 v${rollout.targetRevision} 已保存，正在等待在线 API 实例加载（${rollout.appliedCount}/${rollout.onlineCount}）。`
    : ''
  const platformTopbarActions = topbarActionHost
    ? createPortal(
      <div className="platform-topbar-status" aria-label="平台配置状态">
        <span>配置 v{loaded.revision}</span>
        <Badge variant={runtimeStatus === 'applied' ? 'secondary' : runtimeStatus === 'error' ? 'destructive' : 'outline'}>
          {runtimeStatus === 'applied' ? <CheckCircle /> : runtimeStatus === 'loading' ? <SpinnerGap className="animate-spin" /> : <WarningCircle />}
          {runtimeStatus === 'applied' ? '已生效' : runtimeStatus === 'error' ? '加载异常' : runtimeStatus === 'offline' ? '无在线实例' : '加载中'}
        </Badge>
      </div>,
      topbarActionHost,
    )
    : null

  return (
    <>
      {platformSidebarNavigation}
      {platformTopbarActions}
      <div className="platform-workbench">
        <section className="platform-content">
          <div className="platform-section-title"><div><h3>{selected.label}</h3><p>{tab === 'organizations' ? '组织只在这里创建和删除；存在业务或历史数据时禁止删除。' : tab === 'users' ? '账号由飞书自动注册；内置 admin 的超管权限不可移除。' : '保存后由各服务实例自动加载，无需重启。'}</p></div></div>
          {error ? <div className="platform-alert error" role="alert">{error}</div> : null}
          {rolloutMessage ? <div className={`platform-alert ${rollout?.state === 'applied' ? 'success' : rollout?.state === 'error' || rollout?.state === 'superseded' ? 'error' : ''}`} role="status">{rollout?.state === 'loading' ? <SpinnerGap className="animate-spin" /> : rollout?.state === 'applied' ? <CheckCircle /> : <WarningCircle />}{rolloutMessage}</div> : null}
          {notice ? <div className="platform-alert success" role="status"><CheckCircle />{notice}</div> : null}
          {testResult ? <div className="platform-alert" role="status">{testResult}</div> : null}

          {tab === 'general' ? <div className="platform-form-grid">
            <Field label="平台名称"><Input value={draft.general.displayName} onChange={(event) => updateSection('general', { displayName: event.target.value })} /></Field>
            <Field label="公网地址" hint="用于飞书回调、登录完成后的回跳和站内链接"><Input placeholder="https://veges.example.com" value={draft.general.publicUrl} onChange={(event) => updateSection('general', { publicUrl: event.target.value })} /></Field>
          </div> : null}

          {tab === 'ai' ? <div className="platform-form-grid">
            <Field label="接口地址"><Input placeholder="https://api.example.com/v1" value={draft.ai.apiBase} onChange={(event) => updateSection('ai', { apiBase: event.target.value })} /></Field>
            {secret('ai', 'apiKey', '接口密钥', draft.ai.apiKey)}
            <Field label="模型"><Input value={draft.ai.model} onChange={(event) => updateSection('ai', { model: event.target.value })} /></Field>
            <Field label="每用户请求上限"><Input type="number" value={draft.ai.rateLimit} onChange={(event) => updateSection('ai', { rateLimit: Number(event.target.value) })} /></Field>
            <Field label="全局请求上限"><Input type="number" value={draft.ai.globalRateLimit} onChange={(event) => updateSection('ai', { globalRateLimit: Number(event.target.value) })} /></Field>
            <Field label="限制窗口（秒）"><Input type="number" value={draft.ai.rateWindowMs / 1000} onChange={(event) => updateSection('ai', { rateWindowMs: Number(event.target.value) * 1000 })} /></Field>
            <Field label="单条消息字符数"><Input type="number" value={draft.ai.maxMessageLength} onChange={(event) => updateSection('ai', { maxMessageLength: Number(event.target.value) })} /></Field>
            <Field label="上下文字符数"><Input type="number" value={draft.ai.maxContextChars} onChange={(event) => updateSection('ai', { maxContextChars: Number(event.target.value) })} /></Field>
          </div> : null}

          {tab === 'email' ? <div className="platform-form-grid">
            <ToggleField label="启用邮件服务" checked={draft.email.enabled} onChange={(enabled) => updateSection('email', { enabled })} />
            <Field label="SMTP 服务器"><Input value={draft.email.host} onChange={(event) => updateSection('email', { host: event.target.value })} /></Field>
            <Field label="端口"><Input type="number" value={draft.email.port} onChange={(event) => updateSection('email', { port: Number(event.target.value) })} /></Field>
            <Field label="连接安全"><Select value={draft.email.security} onValueChange={(security: 'implicit-tls' | 'starttls') => updateSection('email', { security })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="implicit-tls">TLS</SelectItem><SelectItem value="starttls">STARTTLS</SelectItem></SelectContent></Select></Field>
            <Field label="访问账号"><Input value={draft.email.username} onChange={(event) => updateSection('email', { username: event.target.value })} /></Field>
            {secret('email', 'password', '密码', draft.email.password)}
            <Field label="发件人名称"><Input value={draft.email.fromName} onChange={(event) => updateSection('email', { fromName: event.target.value })} /></Field>
            <Field label="发件地址"><Input type="email" value={draft.email.fromAddress} onChange={(event) => updateSection('email', { fromAddress: event.target.value })} /></Field>
            <Field label="测试收件地址" hint="只用于本次测试，不会保存"><Input type="email" value={testEmailRecipient} onChange={(event) => setTestEmailRecipient(event.target.value)} /></Field>
            <Button variant="outline" type="button" disabled={busy || !testEmailRecipient.trim()} onClick={() => void testSection('email', 'send-email')}><PaperPlaneTilt />发送测试邮件</Button>
          </div> : null}

          {tab === 'storage' ? <div className="platform-form-grid">
            <div className="platform-always-on"><CheckCircle />对象存储始终开启</div>
            <Field label="服务地址"><Input value={draft.storage.endpoint} onChange={(event) => updateSection('storage', { endpoint: event.target.value })} /></Field>
            <Field label="存储桶"><Input value={draft.storage.bucket} onChange={(event) => updateSection('storage', { bucket: event.target.value })} /></Field>
            {secret('storage', 'accessKeyId', '访问账号', draft.storage.accessKeyId)}
            {secret('storage', 'accessKeySecret', '访问密钥', draft.storage.accessKeySecret)}
            <Field label="附件大小（MB）"><Input type="number" value={draft.storage.uploadMaxBytes / 1024 / 1024} onChange={(event) => updateSection('storage', { uploadMaxBytes: Number(event.target.value) * 1024 * 1024 })} /></Field>
            <Field label="对象前缀"><Input value={draft.storage.objectPrefix} onChange={(event) => updateSection('storage', { objectPrefix: event.target.value })} /></Field>
            {secret('storage', 'urlSecret', '附件签名密钥', draft.storage.urlSecret)}
          </div> : null}

          {tab === 'packages' ? <div className="platform-form-grid single">
            <Field label="下载链接有效期（秒）"><Input type="number" value={draft.packages.downloadExpireSeconds} onChange={(event) => updateSection('packages', { downloadExpireSeconds: Number(event.target.value) })} /></Field>
            <Field label="规则内容（YAML）" hint="保存前会校验字段、路径、占位符、父级关系与循环引用。"><Textarea className="platform-rules-editor" spellCheck={false} value={draft.packages.rulesYaml} onChange={(event) => updateSection('packages', { rulesYaml: event.target.value })} /></Field>
            <Button variant="outline" type="button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { const result = await validatePlatformPackageRules(draft.packages.rulesYaml); setTestResult(result.valid ? `校验通过，共 ${result.ruleCount} 条规则。` : result.errors.map((item) => item.message).join('\n')) } catch (validationError) { handleError(validationError, '规则校验失败。') } finally { setBusy(false) } }}><CheckCircle />校验规则</Button>
          </div> : null}

          {tab === 'feishu' ? <div className="platform-form-grid">
            <Field label="App ID"><Input value={draft.feishu.appId} onChange={(event) => updateSection('feishu', { appId: event.target.value })} /></Field>
            {secret('feishu', 'appSecret', 'App Secret', draft.feishu.appSecret)}
            {secret('feishu', 'verificationToken', '验证令牌', draft.feishu.verificationToken)}
            <ToggleField label="启用业务通知" checked={draft.feishu.deliveryEnabled} onChange={(deliveryEnabled) => updateSection('feishu', { deliveryEnabled })} />
            <Field label="事件回调地址" hint="根据公网地址自动生成；修改公网地址后请同步更新飞书开放平台。"><div className="platform-copy-field"><Input readOnly value={callbackUrls?.eventCallbackUrl ?? '请先配置有效的公网地址'} /><Button disabled={!callbackUrls} size="icon" variant="ghost" title="复制" type="button" onClick={() => callbackUrls && void navigator.clipboard.writeText(callbackUrls.eventCallbackUrl)}><Copy /></Button></div></Field>
            <Field label="登录重定向地址" hint="根据公网地址自动生成；修改公网地址后请同步更新飞书开放平台。"><div className="platform-copy-field"><Input readOnly value={callbackUrls?.oauthRedirectUrl ?? '请先配置有效的公网地址'} /><Button disabled={!callbackUrls} size="icon" variant="ghost" title="复制" type="button" onClick={() => callbackUrls && void navigator.clipboard.writeText(callbackUrls.oauthRedirectUrl)}><Copy /></Button></div></Field>
          </div> : null}

          {tab === 'github' ? <div className="platform-form-grid">
            {secret('github', 'token', '访问令牌', draft.github.token)}
            <Field label="仓库地址"><Input value={draft.github.repositoryUrl} onChange={(event) => updateSection('github', { repositoryUrl: event.target.value })} /></Field>
            <Field label="工作流文件"><Input value={draft.github.workflowFile} onChange={(event) => updateSection('github', { workflowFile: event.target.value })} /></Field>
            <Field label="分支"><Input value={draft.github.branch} onChange={(event) => updateSection('github', { branch: event.target.value })} /></Field>
            <Field label="下载链接有效期（秒）"><Input type="number" value={draft.github.downloadExpireSeconds} onChange={(event) => updateSection('github', { downloadExpireSeconds: Number(event.target.value) })} /></Field>
          </div> : null}

          {tab === 'users' ? <>
            <div className="platform-subtabs" role="tablist" aria-label="用户视图">
              <Button type="button" variant="ghost" className={userTab === 'users' ? 'active' : ''} onClick={() => setUserTab('users')}>全部用户 <Badge variant="outline">{users.length}</Badge></Button>
              <Button type="button" variant="ghost" className={userTab === 'admins' ? 'active' : ''} onClick={() => setUserTab('admins')}>超级管理员 <Badge variant="outline">{users.filter((user) => user.platformAdmin).length}</Badge></Button>
              {userTab === 'admins' ? <Button className="platform-subtab-action" type="button" onClick={() => setGrantAdminOpen(true)}><Plus />授予超级管理员</Button> : null}
            </div>
            <div className="platform-table-list">
              {users.filter((user) => userTab === 'users' || user.platformAdmin).map((user) => (
                <article key={user.id} className="platform-user-row">
                  <div className="platform-user-name">
                    <strong>{user.displayName}{user.isBuiltinAdmin ? <Badge>内置</Badge> : null}</strong>
                    <small>
                      {user.username} · {user.registrationSource === 'feishu' ? '飞书注册' : user.registrationSource === 'builtin' ? '内置账号' : '历史账号'} · {user.accountStatus === 'active' ? '正常' : user.accountStatus === 'disabled' ? '已停用' : '已离职'}
                    </small>
                  </div>
                  {userTab === 'users' ? (
                    <div className="platform-role-options">
                      {roleValues.map((role) => (
                        <label key={role}>
                          <Checkbox
                            checked={user.roles.includes(role)}
                            disabled={busy || user.accountStatus === 'departed'}
                            onCheckedChange={() => setUsers((current) => current.map((item) => item.id === user.id ? {
                              ...item,
                              roles: item.roles.includes(role)
                                ? item.roles.filter((value) => value !== role)
                                : [...item.roles, role],
                            } : item))}
                          />
                          {userRoleLabel[role]}
                        </label>
                      ))}
                    </div>
                  ) : <div className="platform-admin-source"><ShieldCheck />{user.isBuiltinAdmin ? '系统内置' : '平台授权'}</div>}
                  <label className="platform-admin-option">{user.platformAdmin ? <Badge variant="secondary">超级管理员</Badge> : null}</label>
                  <div className="platform-user-actions">
                    {userTab === 'users' ? <Button size="sm" variant="outline" disabled={busy || user.roles.length === 0 || user.accountStatus === 'departed'} onClick={() => void saveUser(user)}>保存权限</Button> : user.isBuiltinAdmin ? <span className="platform-locked-admin"><ShieldCheck />不可移除</span> : <ConfirmActionDialog actionKey={`platform-admin-revoke:${user.id}`} title={`移除“${user.displayName}”的超级管理员权限？`} description="移除后该账号仍可使用已有职业角色，但不能进入平台管理。" confirmLabel="确认移除" trigger={<Button size="sm" variant="destructive" disabled={busy}>移除权限</Button>} onConfirm={() => revokePlatformAdmin(user)} />}
                    {userTab === 'users' ? (user.accountStatus === 'disabled' ? (
                      <Button size="sm" variant="outline" disabled={busy || user.isBuiltinAdmin} onClick={() => void enableUser(user)}>启用</Button>
                    ) : (
                      <ConfirmActionDialog
                        actionKey={`platform-user-disable:${user.id}`}
                        title={`停用账号“${user.displayName}”？`}
                        description="停用后现有登录会话立即失效；再次启用后才能访问平台。"
                        confirmLabel="确认停用"
                        trigger={<Button size="sm" variant="outline" disabled={busy || user.isBuiltinAdmin || user.accountStatus !== 'active'}>停用账号</Button>}
                        onConfirm={() => disableUser(user)}
                      />
                    )) : null}
                    {userTab === 'users' && user.accountStatus !== 'departed' ? <Button size="sm" variant="destructive" disabled={busy || user.isBuiltinAdmin || user.id === currentUserId} onClick={() => void openOffboarding(user)}><UserMinus />离职</Button> : null}
                  </div>
                </article>
              ))}
            </div>
          </> : null}

          {tab === 'organizations' ? <div className="platform-organizations"><div className="platform-list-tools"><div className="platform-search"><MagnifyingGlass /><Input placeholder="搜索组织或所有者" value={organizationSearch} onChange={(event) => setOrganizationSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void loadOrganizations() }} /></div><Button variant="outline" onClick={() => void loadOrganizations()} disabled={busy}>查询</Button><Button onClick={() => setCreateOpen(true)} disabled={busy}><Plus />新建组织</Button></div><div className="platform-table-list">{organizations.map((organization) => <article className="platform-organization-row" key={organization.id}><div><strong>{organization.name}</strong><small>所有者：{organization.owner.displayName}</small></div><div className="platform-counts"><span>{organization.memberCount} 成员</span><span>{organization.projectCount} 项目</span><span>{organization.testSpaceCount} 测试空间</span></div><Badge variant={organization.canDelete ? 'secondary' : 'outline'}>{organization.canDelete ? '空组织' : `${organization.blockers.reduce((sum, item) => sum + item.count, 0)} 项关联数据`}</Badge><ConfirmActionDialog actionKey={`platform-organization-delete:${organization.id}`} title={`删除组织“${organization.name}”？`} description={organization.canDelete ? '仅删除组织壳和唯一所有者关系，操作不可恢复。' : '该组织仍有关联业务或历史数据，当前不能删除。'} confirmationName={organization.name} confirmLabel="删除组织" confirmDisabled={!organization.canDelete} trigger={<Button size="icon" variant="destructive" title="删除组织"><Trash /></Button>} onConfirm={async () => { await deletePlatformOrganization(organization.id, organization.name); await loadOrganizations(); return true }} /></article>)}</div></div> : null}

          {tab === 'maintenance' ? <div className="platform-maintenance">
            <div className="platform-runtime-summary">
              <div><span>当前状态</span><strong>{maintenance?.maintenance.active ? '维护中' : '正常运行'}</strong></div>
              <div><span>数据库迁移</span><strong>{maintenance?.migration.phase === 'completed' ? '已完成' : maintenance?.migration.phase === 'failed' ? '失败' : '进行中'}</strong></div>
              <div><span>状态版本</span><strong>v{maintenance?.maintenance.revision ?? 0}</strong></div>
              <div><span>实例已加载</span><strong>{maintenanceAppliedCount}/{onlineInstances.length}</strong></div>
            </div>
            {maintenance?.maintenance.systemForced ? <div className="platform-alert error" role="status"><WarningCircle />系统正在强制维护：{maintenance.maintenance.systemReasons.join('、')}</div> : null}
            <section className="platform-maintenance-control">
              <div className="platform-maintenance-heading">
                <div>
                  <h4>访问控制</h4>
                  <p>{maintenance?.maintenance.systemForced
                    ? '系统强制维护期间只允许内置 admin 登录；普通业务接口返回 503。'
                    : maintenance?.maintenance.manual
                      ? '手动维护期间仅允许超级管理员登录，普通用户无法建立新会话。'
                      : '进入维护后仅允许超级管理员登录，并暂停普通业务接口。'}</p>
                </div>
                <Badge className={maintenance?.maintenance.active ? 'platform-maintenance-status active' : 'platform-maintenance-status'} variant={maintenance?.maintenance.active ? 'outline' : 'secondary'}>{maintenance?.maintenance.active ? '维护中' : '业务开放'}</Badge>
              </div>
              <div className="platform-maintenance-form">
                <Field label="维护说明" hint="登录页和已登录普通用户看到的提示"><Textarea disabled={busy} maxLength={500} value={maintenanceMessage} onChange={(event) => setMaintenanceMessage(event.target.value)} /></Field>
                <div className="platform-maintenance-actions">
                  {maintenance?.maintenance.manual && maintenanceMessage !== maintenance.maintenance.message ? <Button type="button" variant="outline" disabled={busy} onClick={() => void changeMaintenance(true)}><CheckCircle />更新说明</Button> : null}
                  {maintenance?.maintenance.manual ? <ConfirmActionDialog
                    actionKey={`platform-maintenance-disable:${maintenance.maintenance.revision}`}
                    title="结束维护模式？"
                    description="系统会检查数据库迁移、必填平台配置和所有在线 API 实例的加载状态。"
                    confirmLabel="结束维护"
                    trigger={<Button disabled={busy || maintenance.maintenance.systemForced}><CheckCircle />结束维护</Button>}
                    onConfirm={() => changeMaintenance(false)}
                  /> : <ConfirmActionDialog
                    actionKey={`platform-maintenance-enable:${maintenance?.maintenance.revision ?? 0}`}
                    title="进入维护模式？"
                    description="普通用户的新登录和普通业务请求将被立即拒绝；超级管理员仍可登录并完成平台管理。"
                    confirmLabel="进入维护"
                    trigger={<Button disabled={busy} variant="destructive"><Wrench />进入维护</Button>}
                    onConfirm={() => changeMaintenance(true)}
                  />}
                </div>
              </div>
            </section>
            <section className="platform-maintenance-history">
              <div className="platform-maintenance-heading"><div><h4>维护记录</h4><p>维护开始与结束时间由数据库记录，结束维护时自动保存最终时长。</p></div></div>
              {maintenanceRecords.length > 0 ? <>
                <div className="platform-maintenance-record-list">
                  <div className="platform-maintenance-record-header" aria-hidden><span>状态</span><span>维护说明</span><span>维护人</span><span>开始时间</span><span>结束时间</span><span>维护时长</span></div>
                  {maintenanceRecords.map((record) => {
                    const durationSeconds = record.durationSeconds ?? Math.max(
                      0,
                      Math.floor((maintenanceClock - new Date(record.startedAt).getTime()) / 1_000),
                    )
                    return <div className="platform-maintenance-record-row" key={record.id}>
                      <Badge variant={record.status === 'active' ? 'outline' : 'secondary'}>{record.status === 'active' ? '维护中' : '已结束'}</Badge>
                      <div className="platform-maintenance-record-message"><strong>{record.message || '未填写维护说明'}</strong></div>
                      <div className="platform-maintenance-record-actor" data-label="维护人"><strong>{record.startedBy?.displayName ?? '未知账号'}</strong>{record.startedBy?.username && record.startedBy.username !== record.startedBy.displayName ? <small>{record.startedBy.username}</small> : null}</div>
                      <time data-label="开始时间" dateTime={record.startedAt}>{new Date(record.startedAt).toLocaleString('zh-CN')}</time>
                      <div className="platform-maintenance-record-ended" data-label="结束时间">{record.endedAt ? <><time dateTime={record.endedAt}>{new Date(record.endedAt).toLocaleString('zh-CN')}</time><small>由 {record.endedBy?.displayName ?? '未知账号'} 结束</small></> : <strong>进行中</strong>}</div>
                      <strong className="platform-maintenance-record-duration" data-label="维护时长">{maintenanceDurationLabel(durationSeconds)}</strong>
                    </div>
                  })}
                </div>
                {maintenanceRecordsCursor ? <div className="platform-maintenance-record-more"><Button type="button" variant="outline" disabled={maintenanceRecordsLoading} onClick={() => void loadMoreMaintenanceRecords()}>{maintenanceRecordsLoading ? <SpinnerGap className="animate-spin" /> : null}加载更多</Button></div> : null}
              </> : <p className="platform-empty-note">暂无人工维护记录。</p>}
            </section>
            <section className="platform-migrations">
              <div className="platform-maintenance-heading"><div><h4>自动迁移记录</h4><p>数据库结构与数据升级由应用副本协调执行。</p></div></div>
              {migrations.length > 0 ? <div className="platform-migration-list">
                <div className="platform-migration-header" aria-hidden><span>迁移版本</span><span>内容</span><span>耗时</span><span>完成时间</span></div>
                {migrations.map((migration) => <div className="platform-migration-row" key={migration.id}>
                  <code>{migration.id}</code>
                  <span>{migration.name}</span>
                  <strong>{migration.durationMs} ms</strong>
                  <time>{new Date(migration.appliedAt).toLocaleString('zh-CN')}</time>
                </div>)}
              </div> : <p className="platform-empty-note">暂无已完成的迁移。</p>}
            </section>
          </div> : null}

          {tab === 'security' ? <div className="platform-security"><div className="platform-runtime-summary"><div><span>应用加密</span><strong>{security?.configured ? '已启用' : '配置异常'}</strong></div><div><span>加密算法</span><strong>{security?.algorithm ?? '未知'}</strong></div><div><span>活动密钥标识</span><strong>{security?.activeKeyId || '未配置'}</strong></div></div><section><h4>密钥保留状态</h4><p>现有密文引用的旧密钥必须继续保留。这里只显示标识，不显示密钥材料。</p><div className="platform-key-list">{security?.retainedKeyIds.map((keyId) => <Badge key={keyId} variant={keyId === security.activeKeyId ? 'default' : 'outline'}>{keyId}{keyId === security.activeKeyId ? '（当前）' : ''}</Badge>)}</div></section><section><h4>加密覆盖</h4><div className="platform-security-check"><CheckCircle /><span>平台配置与历史版本使用应用层加密存储</span></div><div className="platform-security-check"><CheckCircle /><span>敏感业务文本使用应用层加密存储</span></div></section><section><h4>最近巡检</h4>{security?.lastInspection ? <div className="platform-inspection"><Badge variant={security.lastInspection.status === 'passed' ? 'secondary' : 'destructive'}>{security.lastInspection.status === 'passed' ? '通过' : '失败'}</Badge><span>{security.lastInspection.result.summary || '巡检已记录'}</span><time>{new Date(security.lastInspection.createdAt).toLocaleString('zh-CN')}</time></div> : <p>尚无巡检记录。迁移或密钥轮换后应运行已授权的数据加密巡检。</p>}</section></div> : null}

          {tab === 'runtime' ? <div className="platform-runtime"><div className="platform-runtime-summary"><div><span>数据库当前版本</span><strong>v{runtime?.activeRevision ?? loaded.revision}</strong></div><div><span>在线 API 实例</span><strong>{runtime?.instances.filter((instance) => instance.status !== 'offline').length ?? 0}</strong></div><div><span>定时任务</span><strong>运行时加载</strong></div></div><section><h4>服务实例</h4>{runtime?.instances.map((instance) => <div className="platform-runtime-row" key={instance.instanceId}><span className={`platform-runtime-dot ${instance.status}`} /><code>{instance.instanceId.slice(0, 8)}</code><span>{instance.status === 'applied' ? '已生效' : instance.status === 'error' ? '加载异常' : instance.status === 'offline' ? '已离线' : '加载中'}</span><strong>{instance.appliedRevision ? `v${instance.appliedRevision}` : '未加载'}</strong><time>{new Date(instance.heartbeatAt).toLocaleString('zh-CN')}</time></div>)}</section></div> : null}
          {tab === 'history' ? <div className="platform-runtime"><section><h4>配置历史</h4><div className="platform-history-list">{history.map((item) => <div className="platform-history-row" key={item.revision}><div className="platform-history-version"><strong>v{item.revision}</strong>{item.revision === loaded.revision ? <Badge variant="secondary">当前版本</Badge> : null}</div><div className="platform-history-summary"><strong>{item.restoredFromRevision ? `恢复自 v${item.restoredFromRevision}` : item.sourceLabel}</strong><span>{item.changedSections.length > 0 ? item.changedSections.map((section) => `${section.sectionLabel} ${section.count} 项`).join('、') : '没有可见配置变化'}</span></div><span>{item.createdBy}</span><time>{new Date(item.createdAt).toLocaleString('zh-CN')}</time><Button size="sm" variant="outline" disabled={historyDetailLoading} onClick={() => void openHistoryDetail(item.revision)}>{historyDetailLoading ? <SpinnerGap className="animate-spin" /> : null}查看详情</Button></div>)}</div></section></div> : null}

          {activeConfigSection ? <footer className="platform-savebar"><Button variant="outline" type="button" disabled={busy || !sectionChanged} onClick={() => restoreSection(activeConfigSection)}>还原</Button>{(['ai', 'email', 'storage', 'feishu', 'github'] as PlatformConfigSection[]).includes(activeConfigSection) ? <Button variant="outline" type="button" disabled={busy} onClick={() => void testSection(activeConfigSection)}>{busy ? <SpinnerGap className="animate-spin" /> : <CheckCircle />}{tab === 'email' ? '测试连接' : '测试可用性'}</Button> : null}<Button type="button" disabled={busy || !sectionChanged} onClick={() => void saveSection(activeConfigSection)}>{busy ? <SpinnerGap className="animate-spin" /> : <CheckCircle />}保存更改</Button></footer> : null}
        </section>
      </div>

      <Dialog open={Boolean(historyDetail)} onOpenChange={(open) => { if (!open) setHistoryDetail(undefined) }}>
        <DialogContent fixedHeader className="platform-history-dialog">
          {historyDetail ? <>
            <DialogHeader>
              <DialogTitle>配置版本 v{historyDetail.version.revision}</DialogTitle>
              <DialogDescription>
                {historyDetail.restoredFromRevision ? `恢复自 v${historyDetail.restoredFromRevision}` : historyDetail.version.sourceLabel}
                {' · '}{historyDetail.version.createdBy}
                {' · '}{new Date(historyDetail.version.createdAt).toLocaleString('zh-CN')}
              </DialogDescription>
            </DialogHeader>
            <div className="platform-history-detail">
              <section>
                <h4>{historyDetail.previousRevision ? `本次相对 v${historyDetail.previousRevision} 的变更` : '初始配置内容'}</h4>
                <HistoryChanges groups={historyDetail.changesFromPrevious} emptyLabel="该版本没有可见配置变化。" />
              </section>
              {historyDetail.version.revision !== historyDetail.currentRevision ? <section>
                <h4>恢复此版本将产生的变化</h4>
                <HistoryChanges groups={historyDetail.changesFromCurrent} emptyLabel="当前配置已经与此版本一致，恢复不会生成新版本。" />
              </section> : null}
              <p className="platform-history-note">回调地址随该版本的公网地址生成；用户权限和组织数据不会改变。</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setHistoryDetail(undefined)}>关闭</Button>
              {historyDetail.version.revision !== historyDetail.currentRevision ? <ConfirmActionDialog
                actionKey={`platform-config-restore:${historyDetail.currentRevision}:${historyDetail.version.revision}`}
                title={`恢复到版本 v${historyDetail.version.revision}？`}
                description={<div className="platform-history-restore-preview"><p>恢复会按以下差异创建一个新版本，并由在线 API 实例自动加载。</p><HistoryChanges compact groups={historyDetail.changesFromCurrent} emptyLabel="当前配置已经与此版本一致，不会生成新版本。" /><p>回调地址随公网地址恢复；用户权限和组织数据不会改变。</p></div>}
                confirmLabel="恢复此版本"
                variant="default"
                trigger={<Button disabled={historyDetail.changesFromCurrent.length === 0}>恢复此版本</Button>}
                onConfirm={() => restoreRevision(historyDetail.version.revision)}
              /> : null}
            </DialogFooter>
          </> : null}
        </DialogContent>
      </Dialog>
      <Dialog open={grantAdminOpen} onOpenChange={setGrantAdminOpen}><DialogContent><DialogHeader><DialogTitle>授予超级管理员</DialogTitle><DialogDescription>只能选择已启用且已核实飞书身份的用户。历史飞书账号会按已有 Open ID 识别。</DialogDescription></DialogHeader><div className="platform-dialog-fields"><Field label="选择用户"><Select disabled={platformAdminCandidates.length === 0} value={grantUserId} onValueChange={setGrantUserId}><SelectTrigger><SelectValue placeholder={platformAdminCandidates.length === 0 ? '没有可授权用户' : '选择用户'} /></SelectTrigger><SelectContent>{platformAdminCandidates.map((user) => <SelectItem key={user.id} value={String(user.id)}>{user.displayName}（{user.username}）</SelectItem>)}</SelectContent></Select>{platformAdminCandidates.length === 0 ? <p className="platform-history-empty">当前没有符合条件的用户。</p> : null}</Field></div><DialogFooter><Button variant="outline" onClick={() => setGrantAdminOpen(false)}>取消</Button><Button disabled={busy || !grantUserId} onClick={() => void grantPlatformAdmin()}>确认授权</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent><DialogHeader><DialogTitle>新建组织</DialogTitle><DialogDescription>所有者必须是已核实飞书身份的有效用户，或内置 admin。</DialogDescription></DialogHeader><div className="platform-dialog-fields"><Field label="组织名称"><Input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} /></Field><Field label="所有者"><Select value={ownerUserId} onValueChange={setOwnerUserId}><SelectTrigger><SelectValue placeholder="选择所有者" /></SelectTrigger><SelectContent>{eligibleOwners.map((user) => <SelectItem key={user.id} value={String(user.id)}>{user.displayName}（{user.username}）</SelectItem>)}</SelectContent></Select></Field></div><DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button><Button disabled={busy || !organizationName.trim() || !ownerUserId} onClick={() => void createOrganization()}>创建组织</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={Boolean(offboardingUser && offboardingPreview)} onOpenChange={(open) => { if (!open && !busy) { setOffboardingUser(undefined); setOffboardingPreview(undefined) } }}><DialogContent className="offboarding-dialog"><DialogHeader><DialogTitle>办理离职</DialogTitle><DialogDescription>{offboardingUser?.displayName} 的账号将被禁用，组织内资源和工作归属将按下方选择处理。</DialogDescription></DialogHeader><div className="offboarding-organizations">{offboardingPreview?.organizations.map((organization) => <section key={organization.id} className="offboarding-organization"><div className="offboarding-organization-heading"><strong>{organization.name}</strong><small>待办 {organization.openTodoCount} 条 · Bug {organization.bugCount} 个</small></div><Select value={offboardingSelections[organization.id] ?? ''} onValueChange={(value) => setOffboardingSelections((current) => ({ ...current, [organization.id]: value }))} disabled={busy || organization.admins.length === 0}><SelectTrigger aria-label={`${organization.name} 接收管理员`}><SelectValue placeholder="选择接收管理员" /></SelectTrigger><SelectContent>{organization.admins.map((admin) => <SelectItem key={admin.id} value={String(admin.id)}>{admin.displayName} · {admin.username}</SelectItem>)}</SelectContent></Select>{organization.ownedProjects.length > 0 ? <small>将转移项目 {organization.ownedProjects.length} 个</small> : null}{organization.ownedTestSpaces.length > 0 ? <small>将转移测试空间 {organization.ownedTestSpaces.length} 个</small> : null}{organization.admins.length === 0 ? <p className="form-error">该组织没有可接收的组织管理员。</p> : null}</section>)}</div><DialogFooter><Button variant="outline" disabled={busy} onClick={() => { setOffboardingUser(undefined); setOffboardingPreview(undefined) }}>取消</Button><Button variant="destructive" disabled={busy || !offboardingPreview?.organizations.every((organization) => organization.admins.length > 0)} onClick={() => void submitOffboarding()}>{busy ? '处理中...' : '确认离职'}</Button></DialogFooter></DialogContent></Dialog>
    </>
  )
}
