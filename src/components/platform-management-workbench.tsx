import { useEffect, useRef, useState, type ReactNode } from 'react'
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
} from '@phosphor-icons/react'
import {
  createPlatformOrganization,
  deletePlatformOrganization,
  fetchOffboardingPreview,
  fetchManagedUsers,
  fetchPlatformConfig,
  fetchPlatformConfigHistory,
  fetchPlatformOrganizations,
  fetchPlatformRuntimeStatus,
  fetchPlatformSecurityStatus,
  offboardManagedUser,
  revealPlatformSecret,
  restorePlatformConfigRevision,
  savePlatformConfigSection,
  testPlatformConfigSection,
  updateManagedUserPermissions,
  updateManagedUserStatus,
  validatePlatformPackageRules,
  ApiError,
  type ManagedUser,
  type OffboardingPreview,
  type UserRole,
} from '@/api'
import type {
  PlatformConfig,
  PlatformConfigResponse,
  PlatformConfigSection,
  PlatformOrganization,
  PlatformRuntimeStatus,
  PlatformSecurityStatus,
  SecretState,
} from '@/platform-management-types'
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

type Tab = PlatformConfigSection | 'users' | 'organizations' | 'security' | 'runtime'
type SecretDrafts = Record<string, string>

const tabs: Array<{ group: string; icon: typeof GearSix; id: Tab; label: string }> = [
  { group: '平台', icon: GearSix, id: 'general', label: '平台信息' },
  { group: '平台', icon: UserGear, id: 'users', label: '用户与角色' },
  { group: '平台', icon: Buildings, id: 'organizations', label: '组织管理' },
  { group: '服务配置', icon: Cpu, id: 'ai', label: '全局 AI' },
  { group: '服务配置', icon: PaperPlaneTilt, id: 'email', label: '邮箱配置' },
  { group: '服务配置', icon: Cloud, id: 'storage', label: '对象存储' },
  { group: '服务配置', icon: Database, id: 'packages', label: '包市场规则' },
  { group: '服务配置', icon: PaperPlaneTilt, id: 'feishu', label: '飞书对接' },
  { group: '服务配置', icon: GithubLogo, id: 'github', label: 'GitHub Actions' },
  { group: '审计', icon: ShieldCheck, id: 'security', label: '数据安全' },
  { group: '审计', icon: ClockCounterClockwise, id: 'runtime', label: '版本与运行状态' },
]

const sectionSecretFields: Partial<Record<PlatformConfigSection, string[]>> = {
  ai: ['apiKey'],
  email: ['password'],
  feishu: ['appSecret', 'verificationToken', 'webhookBasicPassword'],
  github: ['token'],
  storage: ['accessKeyId', 'accessKeySecret', 'urlSecret'],
}

const roleValues: UserRole[] = ['developer', 'tester', 'organization_admin']

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

function SecretField({
  field,
  label,
  onChange,
  onClear,
  onError,
  onReveal,
  state,
  value,
}: {
  field: string
  label: string
  onChange: (value: string) => void
  onClear: () => void
  onError: (error: unknown) => void
  onReveal: () => Promise<string>
  state: SecretState
  value: string
}) {
  const [shown, setShown] = useState(false)
  const [revealed, setRevealed] = useState('')
  const [busy, setBusy] = useState(false)
  const revealRequest = useRef(0)
  const displayValue = value || revealed

  useEffect(() => {
    revealRequest.current += 1
    setShown(false)
    setRevealed('')
  }, [field, state.configured])

  useEffect(() => {
    const clear = () => {
      if (document.visibilityState !== 'hidden') return
      revealRequest.current += 1
      setRevealed('')
      setShown(false)
    }
    document.addEventListener('visibilitychange', clear)
    return () => {
      revealRequest.current += 1
      document.removeEventListener('visibilitychange', clear)
    }
  }, [])

  async function toggle() {
    if (shown) {
      revealRequest.current += 1
      setShown(false)
      setRevealed('')
      return
    }
    if (!value && state.configured && state.revealable) {
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
    if (!revealed) return
    const timer = window.setTimeout(() => {
      setRevealed('')
      setShown(false)
    }, 30_000)
    return () => window.clearTimeout(timer)
  }, [revealed])

  return (
    <Field label={label} hint={state.configured && !value ? '已保存' : undefined}>
      <div className="platform-secret-input">
        <Input
          autoComplete="new-password"
          type={shown ? 'text' : 'password'}
          placeholder={state.configured ? '保留已保存值' : '尚未配置'}
          value={displayValue}
          onBlur={() => {
            revealRequest.current += 1
            if (revealed) {
              setRevealed('')
              setShown(false)
            }
          }}
          onChange={(event) => {
            setRevealed('')
            onChange(event.target.value)
          }}
        />
        <Button size="icon" variant="ghost" type="button" disabled={busy || (!value && !state.revealable)} title={shown ? '隐藏' : '显示'} onMouseDown={(event) => event.preventDefault()} onClick={() => void toggle()}>
          {busy ? <SpinnerGap className="animate-spin" /> : shown ? <EyeSlash /> : <Eye />}
        </Button>
        <Button size="icon" variant="ghost" type="button" disabled={!value && !state.configured} title="清除凭据" onClick={onClear}><Trash /></Button>
      </div>
    </Field>
  )
}

export function PlatformManagementWorkbench({
  currentUserId,
  onAuthorizationLost,
}: {
  currentUserId: number
  onAuthorizationLost: () => void
}) {
  const [tab, setTab] = useState<Tab>('general')
  const [loaded, setLoaded] = useState<PlatformConfigResponse>()
  const [draft, setDraft] = useState<PlatformConfig>()
  const [secrets, setSecrets] = useState<SecretDrafts>({})
  const [clearedSecrets, setClearedSecrets] = useState<Set<string>>(new Set())
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [organizations, setOrganizations] = useState<PlatformOrganization[]>([])
  const [runtime, setRuntime] = useState<PlatformRuntimeStatus>()
  const [security, setSecurity] = useState<PlatformSecurityStatus>()
  const [history, setHistory] = useState<Array<{ createdAt: string; createdBy: string; revision: number; source: string }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [testResult, setTestResult] = useState('')
  const [testEmailRecipient, setTestEmailRecipient] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [organizationName, setOrganizationName] = useState('')
  const [ownerUserId, setOwnerUserId] = useState('')
  const [organizationSearch, setOrganizationSearch] = useState('')
  const [offboardingUser, setOffboardingUser] = useState<ManagedUser>()
  const [offboardingPreview, setOffboardingPreview] = useState<OffboardingPreview>()
  const [offboardingSelections, setOffboardingSelections] = useState<Record<number, string>>({})

  function handleError(value: unknown, fallback: string) {
    if (value instanceof ApiError && (value.status === 401 || value.status === 403)) {
      setSecrets({})
      setClearedSecrets(new Set())
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
    setClearedSecrets(new Set())
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
    const [runtimeResponse, historyResponse] = await Promise.all([
      fetchPlatformRuntimeStatus(),
      fetchPlatformConfigHistory(),
    ])
    setRuntime(runtimeResponse)
    setHistory(historyResponse.history)
  }

  useEffect(() => {
    setBusy(true)
    Promise.all([
      loadConfig(),
      loadUsers(),
      fetchPlatformOrganizations().then((response) => setOrganizations(response.organizations)),
      fetchPlatformSecurityStatus().then(setSecurity),
      loadRuntime(),
    ])
      .catch((loadError) => handleError(loadError, '平台信息读取失败。'))
      .finally(() => setBusy(false))
    // The workbench performs one initial snapshot load; authorization failures unmount it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => setSecrets({}), [])

  function updateSection<K extends PlatformConfigSection>(section: K, patch: Partial<PlatformConfig[K]>) {
    setDraft((current) => current ? { ...current, [section]: { ...current[section], ...patch } } : current)
    setNotice('')
    setTestResult('')
  }

  function updateSecret(section: PlatformConfigSection, field: string, value: string) {
    const path = `${section}.${field}`
    setSecrets((current) => ({ ...current, [path]: value }))
    setClearedSecrets((current) => {
      const next = new Set(current)
      next.delete(path)
      return next
    })
  }

  function clearSecret(section: PlatformConfigSection, field: string) {
    const path = `${section}.${field}`
    setSecrets((current) => ({ ...current, [path]: '' }))
    setClearedSecrets((current) => new Set(current).add(path))
  }

  function secretActions(section: PlatformConfigSection) {
    return Object.fromEntries((sectionSecretFields[section] ?? []).map((field) => {
      const path = `${section}.${field}`
      if (clearedSecrets.has(path)) return [field, { action: 'clear' as const }]
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
      await loadConfig()
      setNotice(`配置已保存为版本 ${result.revision}，服务正在自动加载。`)
      await loadRuntime()
    } catch (saveError) {
      handleError(saveError, '配置保存失败。')
    } finally {
      setBusy(false)
    }
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

  async function setUserStatus(user: ManagedUser, status: 'active' | 'disabled') {
    setBusy(true)
    setError('')
    try {
      await updateManagedUserStatus(user, status)
      await loadUsers()
      setNotice(status === 'active' ? '账号已启用。' : '账号已禁用。')
    } catch (saveError) {
      handleError(saveError, '账号状态更新失败。')
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

  if (!draft || !loaded) {
    return <div className="platform-loading">{busy ? <SpinnerGap className="animate-spin" /> : null}{error || '正在读取平台配置…'}</div>
  }

  const secret = (section: PlatformConfigSection, field: string, label: string, state: SecretState) => (
    <SecretField
      key={`${section}.${field}:${loaded.revision}`}
      field={`${section}.${field}`}
      label={label}
      state={state}
      value={secrets[`${section}.${field}`] ?? ''}
      onChange={(value) => updateSecret(section, field, value)}
      onClear={() => clearSecret(section, field)}
      onError={(revealError) => handleError(revealError, '凭据读取失败。')}
      onReveal={() => reveal(section, field)}
    />
  )

  return (
    <div className="platform-workbench">
      <header className="platform-heading">
        <div><span className="platform-kicker"><ShieldCheck /> 超级管理员</span><h2>平台管理</h2><p>统一管理平台服务、账号权限和组织生命周期。</p></div>
        <div className="platform-revision"><span>当前配置</span><strong>v{loaded.revision}</strong></div>
      </header>
      <div className="platform-layout">
        <nav className="platform-nav" aria-label="平台管理导航">
          {[...new Set(tabs.map((item) => item.group))].map((group) => <div key={group}><span>{group}</span>{tabs.filter((item) => item.group === group).map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => { setTab(item.id); setError(''); setNotice(''); setTestResult('') }}><Icon />{item.label}</button> })}</div>)}
        </nav>
        <section className="platform-content">
          <div className="platform-section-title"><div><h3>{selected.label}</h3><p>{tab === 'organizations' ? '组织只在这里创建和删除；存在业务或历史数据时禁止删除。' : tab === 'users' ? '账号由飞书自动注册；内置 admin 的超管权限不可移除。' : '保存后由各服务实例自动加载，无需重启。'}</p></div></div>
          {error ? <div className="platform-alert error" role="alert">{error}</div> : null}
          {notice ? <div className="platform-alert success" role="status"><CheckCircle />{notice}</div> : null}
          {testResult ? <div className="platform-alert" role="status">{testResult}</div> : null}

          {tab === 'general' ? <div className="platform-form-grid">
            <Field label="平台名称"><Input value={draft.general.displayName} onChange={(event) => updateSection('general', { displayName: event.target.value })} /></Field>
            <Field label="公网地址" hint="用于生成站内链接"><Input placeholder="https://veges.example.com" value={draft.general.publicUrl} onChange={(event) => updateSection('general', { publicUrl: event.target.value })} /></Field>
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
            <Field label="通知账号"><Select value={draft.feishu.webhookUserId ? String(draft.feishu.webhookUserId) : 'none'} onValueChange={(value) => updateSection('feishu', { webhookUserId: value === 'none' ? null : Number(value) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">未选择</SelectItem>{eligibleOwners.map((user) => <SelectItem key={user.id} value={String(user.id)}>{user.displayName}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Webhook 访问账号"><Input value={draft.feishu.webhookBasicUser} onChange={(event) => updateSection('feishu', { webhookBasicUser: event.target.value })} /></Field>
            {secret('feishu', 'webhookBasicPassword', 'Webhook 密码', draft.feishu.webhookBasicPassword)}
            <ToggleField label="启用飞书通知" checked={draft.feishu.deliveryEnabled} onChange={(deliveryEnabled) => updateSection('feishu', { deliveryEnabled })} />
            <Field label="事件回调地址"><div className="platform-copy-field"><Input readOnly value={loaded.fixedCallbacks?.eventCallbackUrl ?? '尚未初始化'} /><Button size="icon" variant="ghost" title="复制" type="button" onClick={() => void navigator.clipboard.writeText(loaded.fixedCallbacks?.eventCallbackUrl ?? '')}><Copy /></Button></div></Field>
            <Field label="登录重定向地址"><div className="platform-copy-field"><Input readOnly value={loaded.fixedCallbacks?.oauthRedirectUrl ?? '尚未初始化'} /><Button size="icon" variant="ghost" title="复制" type="button" onClick={() => void navigator.clipboard.writeText(loaded.fixedCallbacks?.oauthRedirectUrl ?? '')}><Copy /></Button></div></Field>
          </div> : null}

          {tab === 'github' ? <div className="platform-form-grid">
            <ToggleField label="启用 GitHub Actions" checked={draft.github.enabled} onChange={(enabled) => updateSection('github', { enabled })} />
            {secret('github', 'token', '访问令牌', draft.github.token)}
            <Field label="仓库地址"><Input value={draft.github.repositoryUrl} onChange={(event) => updateSection('github', { repositoryUrl: event.target.value })} /></Field>
            <Field label="工作流文件"><Input value={draft.github.workflowFile} onChange={(event) => updateSection('github', { workflowFile: event.target.value })} /></Field>
            <Field label="分支"><Input value={draft.github.branch} onChange={(event) => updateSection('github', { branch: event.target.value })} /></Field>
            <Field label="下载链接有效期（秒）"><Input type="number" value={draft.github.downloadExpireSeconds} onChange={(event) => updateSection('github', { downloadExpireSeconds: Number(event.target.value) })} /></Field>
          </div> : null}

          {tab === 'users' ? <div className="platform-table-list">{users.map((user) => <article key={user.id} className="platform-user-row"><div className="platform-user-name"><strong>{user.displayName}{user.isBuiltinAdmin ? <Badge>内置</Badge> : null}</strong><small>{user.username} · {user.registrationSource === 'feishu' ? '飞书注册' : user.registrationSource === 'builtin' ? '内置账号' : '历史账号'} · {user.accountStatus === 'active' ? '正常' : user.accountStatus === 'disabled' ? '已禁用' : '已离职'}</small></div><div className="platform-role-options">{roleValues.map((role) => <label key={role}><Checkbox checked={user.roles.includes(role)} disabled={busy || user.accountStatus === 'departed'} onCheckedChange={() => setUsers((current) => current.map((item) => item.id === user.id ? { ...item, roles: item.roles.includes(role) ? item.roles.filter((value) => value !== role) : [...item.roles, role] } : item))} />{userRoleLabel[role]}</label>)}</div><label className="platform-admin-option"><Checkbox checked={user.platformAdmin} disabled={busy || user.isBuiltinAdmin || user.accountStatus !== 'active' || (!user.feishuIdentityVerified && !user.isBuiltinAdmin)} onCheckedChange={(checked) => setUsers((current) => current.map((item) => item.id === user.id ? { ...item, platformAdmin: checked === true } : item))} />超级管理员</label><div className="platform-user-actions"><Button size="sm" variant="outline" disabled={busy || user.roles.length === 0 || user.accountStatus === 'departed'} onClick={() => void saveUser(user)}>保存权限</Button>{user.accountStatus === 'disabled' ? <Button size="sm" variant="outline" disabled={busy || user.isBuiltinAdmin} onClick={() => void setUserStatus(user, 'active')}>启用</Button> : <ConfirmActionDialog actionKey={`platform-user-disable:${user.id}`} title={`禁用账号“${user.displayName}”？`} description="账号会立即退出登录；再次启用后才能访问平台。" confirmLabel="确认禁用" trigger={<Button size="sm" variant="outline" disabled={busy || user.isBuiltinAdmin || user.accountStatus !== 'active'}>禁用</Button>} onConfirm={async () => { await setUserStatus(user, 'disabled'); return true }} />}{user.accountStatus !== 'departed' ? <Button size="sm" variant="destructive" disabled={busy || user.isBuiltinAdmin || user.id === currentUserId} onClick={() => void openOffboarding(user)}><UserMinus />离职</Button> : null}</div></article>)}</div> : null}

          {tab === 'organizations' ? <div className="platform-organizations"><div className="platform-list-tools"><div className="platform-search"><MagnifyingGlass /><Input placeholder="搜索组织或所有者" value={organizationSearch} onChange={(event) => setOrganizationSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void loadOrganizations() }} /></div><Button variant="outline" onClick={() => void loadOrganizations()} disabled={busy}>查询</Button><Button onClick={() => setCreateOpen(true)} disabled={busy}><Plus />新建组织</Button></div><div className="platform-table-list">{organizations.map((organization) => <article className="platform-organization-row" key={organization.id}><div><strong>{organization.name}</strong><small>所有者：{organization.owner.displayName}</small></div><div className="platform-counts"><span>{organization.memberCount} 成员</span><span>{organization.projectCount} 项目</span><span>{organization.testSpaceCount} 测试空间</span></div><Badge variant={organization.canDelete ? 'secondary' : 'outline'}>{organization.canDelete ? '空组织' : `${organization.blockers.reduce((sum, item) => sum + item.count, 0)} 项关联数据`}</Badge><ConfirmActionDialog actionKey={`platform-organization-delete:${organization.id}`} title={`删除组织“${organization.name}”？`} description={organization.canDelete ? '仅删除组织壳和唯一所有者关系，操作不可恢复。' : '该组织仍有关联业务或历史数据，当前不能删除。'} confirmationName={organization.name} confirmLabel="删除组织" confirmDisabled={!organization.canDelete} trigger={<Button size="icon" variant="destructive" title="删除组织"><Trash /></Button>} onConfirm={async () => { await deletePlatformOrganization(organization.id, organization.name); await loadOrganizations(); return true }} /></article>)}</div></div> : null}

          {tab === 'security' ? <div className="platform-security"><div className="platform-runtime-summary"><div><span>应用加密</span><strong>{security?.configured ? '已启用' : '配置异常'}</strong></div><div><span>加密算法</span><strong>{security?.algorithm ?? '未知'}</strong></div><div><span>活动密钥标识</span><strong>{security?.activeKeyId || '未配置'}</strong></div></div><section><h4>密钥保留状态</h4><p>现有密文引用的旧密钥必须继续保留。这里只显示标识，不显示密钥材料。</p><div className="platform-key-list">{security?.retainedKeyIds.map((keyId) => <Badge key={keyId} variant={keyId === security.activeKeyId ? 'default' : 'outline'}>{keyId}{keyId === security.activeKeyId ? '（当前）' : ''}</Badge>)}</div></section><section><h4>加密覆盖</h4><div className="platform-security-check"><CheckCircle /><span>平台配置与历史版本使用应用层加密存储</span></div><div className="platform-security-check"><CheckCircle /><span>敏感业务文本使用应用层加密存储</span></div></section><section><h4>最近巡检</h4>{security?.lastInspection ? <div className="platform-inspection"><Badge variant={security.lastInspection.status === 'passed' ? 'secondary' : 'destructive'}>{security.lastInspection.status === 'passed' ? '通过' : '失败'}</Badge><span>{security.lastInspection.result.summary || '巡检已记录'}</span><time>{new Date(security.lastInspection.createdAt).toLocaleString('zh-CN')}</time></div> : <p>尚无巡检记录。迁移或密钥轮换后应运行已授权的数据加密巡检。</p>}</section></div> : null}

          {tab === 'runtime' ? <div className="platform-runtime"><div className="platform-runtime-summary"><div><span>数据库当前版本</span><strong>v{runtime?.activeRevision ?? loaded.revision}</strong></div><div><span>API 实例</span><strong>{runtime?.instances.length ?? 0}</strong></div><div><span>定时任务</span><strong>运行时加载</strong></div></div><section><h4>服务实例</h4>{runtime?.instances.map((instance) => <div className="platform-runtime-row" key={instance.instanceId}><span className={`platform-runtime-dot ${instance.status}`} /><code>{instance.instanceId.slice(0, 8)}</code><span>{instance.status === 'applied' ? '已生效' : instance.status === 'error' ? '加载异常' : '状态未知'}</span><strong>{instance.appliedRevision ? `v${instance.appliedRevision}` : '未加载'}</strong><time>{new Date(instance.heartbeatAt).toLocaleString('zh-CN')}</time></div>)}</section><section><h4>配置历史</h4>{history.map((item) => <div className="platform-history-row" key={item.revision}><strong>v{item.revision}</strong><span>{item.createdBy}</span><time>{new Date(item.createdAt).toLocaleString('zh-CN')}</time><ConfirmActionDialog title={`恢复到版本 v${item.revision}？`} description="恢复会创建一个新版本并自动热更新，不会改变固定回调、用户权限或组织数据。" confirmLabel="确认恢复" trigger={<Button size="sm" variant="outline" disabled={item.revision === loaded.revision}>恢复</Button>} onConfirm={async () => { await restorePlatformConfigRevision(item.revision, loaded.revision); await Promise.all([loadConfig(), loadRuntime()]); return true }} /></div>)}</section></div> : null}

          {(['general', 'ai', 'email', 'storage', 'packages', 'feishu', 'github'] as Tab[]).includes(tab) ? <footer className="platform-savebar"><Button variant="outline" type="button" disabled={busy} onClick={() => { setDraft(cloneConfig(loaded.config)); setSecrets({}); setClearedSecrets(new Set()); setTestResult('') }}>撤销修改</Button>{(['ai', 'email', 'storage', 'feishu', 'github'] as Tab[]).includes(tab) ? <Button variant="outline" type="button" disabled={busy} onClick={() => void testSection(tab as PlatformConfigSection)}>{busy ? <SpinnerGap className="animate-spin" /> : <CheckCircle />}{tab === 'email' ? '测试连接' : '测试可用性'}</Button> : null}<Button type="button" disabled={busy} onClick={() => void saveSection(tab as PlatformConfigSection)}>{busy ? <SpinnerGap className="animate-spin" /> : <CheckCircle />}保存更改</Button></footer> : null}
        </section>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent><DialogHeader><DialogTitle>新建组织</DialogTitle><DialogDescription>所有者必须是已核实飞书身份的有效用户，或内置 admin。</DialogDescription></DialogHeader><div className="platform-dialog-fields"><Field label="组织名称"><Input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} /></Field><Field label="所有者"><Select value={ownerUserId} onValueChange={setOwnerUserId}><SelectTrigger><SelectValue placeholder="选择所有者" /></SelectTrigger><SelectContent>{eligibleOwners.map((user) => <SelectItem key={user.id} value={String(user.id)}>{user.displayName}（{user.username}）</SelectItem>)}</SelectContent></Select></Field></div><DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button><Button disabled={busy || !organizationName.trim() || !ownerUserId} onClick={() => void createOrganization()}>创建组织</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={Boolean(offboardingUser && offboardingPreview)} onOpenChange={(open) => { if (!open && !busy) { setOffboardingUser(undefined); setOffboardingPreview(undefined) } }}><DialogContent className="offboarding-dialog"><DialogHeader><DialogTitle>办理离职</DialogTitle><DialogDescription>{offboardingUser?.displayName} 的账号将被禁用，组织内资源和工作归属将按下方选择处理。</DialogDescription></DialogHeader><div className="offboarding-organizations">{offboardingPreview?.organizations.map((organization) => <section key={organization.id} className="offboarding-organization"><div className="offboarding-organization-heading"><strong>{organization.name}</strong><small>待办 {organization.openTodoCount} 条 · Bug {organization.bugCount} 个</small></div><Select value={offboardingSelections[organization.id] ?? ''} onValueChange={(value) => setOffboardingSelections((current) => ({ ...current, [organization.id]: value }))} disabled={busy || organization.admins.length === 0}><SelectTrigger aria-label={`${organization.name} 接收管理员`}><SelectValue placeholder="选择接收管理员" /></SelectTrigger><SelectContent>{organization.admins.map((admin) => <SelectItem key={admin.id} value={String(admin.id)}>{admin.displayName} · {admin.username}</SelectItem>)}</SelectContent></Select>{organization.ownedProjects.length > 0 ? <small>将转移项目 {organization.ownedProjects.length} 个</small> : null}{organization.ownedTestSpaces.length > 0 ? <small>将转移测试空间 {organization.ownedTestSpaces.length} 个</small> : null}{organization.admins.length === 0 ? <p className="form-error">该组织没有可接收的组织管理员。</p> : null}</section>)}</div><DialogFooter><Button variant="outline" disabled={busy} onClick={() => { setOffboardingUser(undefined); setOffboardingPreview(undefined) }}>取消</Button><Button variant="destructive" disabled={busy || !offboardingPreview?.organizations.every((organization) => organization.admins.length > 0)} onClick={() => void submitOffboarding()}>{busy ? '处理中...' : '确认离职'}</Button></DialogFooter></DialogContent></Dialog>
    </div>
  )
}
