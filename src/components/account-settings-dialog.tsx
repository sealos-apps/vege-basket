import { ConfirmActionDialog } from './confirm-action-dialog'
import {
  Bell,
  LinkSimple,
  LockKey,
  UserCircle,
} from '@phosphor-icons/react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react'

import {
  createFeishuOAuthUrl,
  fetchNotificationSubscription,
  updateCurrentPassword,
  updateNotificationSubscription,
  type AuthUser,
} from '@/api'
import type { NotificationSubscription } from '@/types'
import { Button } from '@/components/ui/button'
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
import { Separator } from '@/components/ui/separator'
import { TimePicker } from '@/components/ui/time-picker'

type AccountSettingsSection = 'profile' | 'notifications' | 'security'
type MutationToken = {
  generation: number
  id: number
}

export type AccountSettingsDialogProps = {
  open: boolean
  user: AuthUser | null
  onDisconnectFeishu: () => Promise<AuthUser>
  onOpenChange: (open: boolean) => void
  onSaveProfile: (payload: { displayName: string }) => Promise<void>
  returnFocusRef?: RefObject<HTMLElement | null>
}

const defaultSubscription: NotificationSubscription = {
  enabled: false,
  localSendTime: '10:00',
  timezone: 'Asia/Shanghai',
}

function getDisplayName(user: AuthUser | null) {
  if (!user) return 'Veges'
  return user.displayName || user.username
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function AccountSettingsDialog({
  open,
  user,
  onDisconnectFeishu,
  onOpenChange,
  onSaveProfile,
  returnFocusRef,
}: AccountSettingsDialogProps) {
  const [section, setSection] = useState<AccountSettingsSection>('profile')
  const [savedDisplayName, setSavedDisplayName] = useState<string | null>(null)
  const [feishuDisconnected, setFeishuDisconnected] = useState(false)

  const [profileDraft, setProfileDraft] = useState(getDisplayName(user))
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileSuccess, setProfileSuccess] = useState('')

  const [feishuBusy, setFeishuBusy] = useState(false)
  const [feishuError, setFeishuError] = useState('')
  const [feishuSuccess, setFeishuSuccess] = useState('')

  const [persistedSubscription, setPersistedSubscription] =
    useState<NotificationSubscription>(defaultSubscription)
  const [subscriptionDraft, setSubscriptionDraft] =
    useState<NotificationSubscription>(defaultSubscription)
  const [subscriptionLoading, setSubscriptionLoading] = useState(false)
  const [subscriptionLoadError, setSubscriptionLoadError] = useState('')
  const [subscriptionSaving, setSubscriptionSaving] = useState(false)
  const [subscriptionSaveError, setSubscriptionSaveError] = useState('')
  const [subscriptionSuccess, setSubscriptionSuccess] = useState('')

  const [currentPasswordDraft, setCurrentPasswordDraft] = useState('')
  const [nextPasswordDraft, setNextPasswordDraft] = useState('')
  const [confirmPasswordDraft, setConfirmPasswordDraft] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')

  const wasOpenRef = useRef(false)
  const openGenerationRef = useRef(0)
  const nextMutationIdRef = useRef(0)
  const activeMutationIdRef = useRef<number | null>(null)
  const subscriptionRequestIdRef = useRef(0)
  const profileInputRef = useRef<HTMLInputElement>(null)
  const notificationPrimaryActionRef = useRef<HTMLButtonElement>(null)
  const securityInputRef = useRef<HTMLInputElement>(null)

  const displayName = savedDisplayName ?? getDisplayName(user)
  const feishuLinked = !feishuDisconnected && Boolean(user?.feishuLinked)
  const feishuEmail = feishuDisconnected ? '' : user?.feishuEmail ?? ''
  const profileChanged = profileDraft.trim() !== displayName.trim()
  const subscriptionChanged =
    subscriptionDraft.enabled !== persistedSubscription.enabled ||
    subscriptionDraft.localSendTime !== persistedSubscription.localSendTime
  const notificationMutationBusy = feishuBusy || subscriptionSaving
  const accountMutationBusy = profileBusy || notificationMutationBusy || passwordBusy
  const notificationSummary = subscriptionLoading
    ? '正在读取'
    : subscriptionLoadError
      ? '读取失败'
      : `飞书${feishuLinked ? '已绑定' : '未绑定'} · 推送${persistedSubscription.enabled ? '已开启' : '已关闭'}`

  const loadSubscription = useCallback(async () => {
    const requestId = subscriptionRequestIdRef.current + 1
    subscriptionRequestIdRef.current = requestId
    setSubscriptionLoading(true)
    setSubscriptionLoadError('')
    setSubscriptionSuccess('')
    try {
      const result = await fetchNotificationSubscription()
      if (subscriptionRequestIdRef.current === requestId) {
        setPersistedSubscription(result.subscription)
        setSubscriptionDraft(result.subscription)
      }
    } catch (error) {
      if (subscriptionRequestIdRef.current === requestId) {
        setSubscriptionLoadError(
          getErrorMessage(error, '无法读取每日推送设置，请稍后重试。'),
        )
      }
    } finally {
      if (subscriptionRequestIdRef.current === requestId) {
        setSubscriptionLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      openGenerationRef.current += 1
      activeMutationIdRef.current = null
      setSection('profile')
      setSavedDisplayName(null)
      setFeishuDisconnected(false)
      setProfileDraft(getDisplayName(user))
      setProfileBusy(false)
      setProfileError('')
      setProfileSuccess('')
      setFeishuBusy(false)
      setFeishuError('')
      setFeishuSuccess('')
      setPersistedSubscription(defaultSubscription)
      setSubscriptionDraft(defaultSubscription)
      setSubscriptionSaveError('')
      setSubscriptionSuccess('')
      setSubscriptionSaving(false)
      setPasswordError('')
      setPasswordSuccess('')
      setPasswordBusy(false)
      setCurrentPasswordDraft('')
      setNextPasswordDraft('')
      setConfirmPasswordDraft('')
      void loadSubscription()
    }

    if (!open && wasOpenRef.current) {
      openGenerationRef.current += 1
      activeMutationIdRef.current = null
      subscriptionRequestIdRef.current += 1
      setSection('profile')
      setProfileError('')
      setProfileSuccess('')
      setProfileBusy(false)
      setFeishuError('')
      setFeishuSuccess('')
      setFeishuBusy(false)
      setSubscriptionLoadError('')
      setSubscriptionSaveError('')
      setSubscriptionSuccess('')
      setSubscriptionLoading(false)
      setSubscriptionSaving(false)
      setCurrentPasswordDraft('')
      setNextPasswordDraft('')
      setConfirmPasswordDraft('')
      setPasswordError('')
      setPasswordSuccess('')
      setPasswordBusy(false)
    }

    wasOpenRef.current = open
  }, [loadSubscription, open, user])

  function beginMutation(): MutationToken | null {
    if (activeMutationIdRef.current !== null) return null
    const id = nextMutationIdRef.current + 1
    nextMutationIdRef.current = id
    activeMutationIdRef.current = id
    return { generation: openGenerationRef.current, id }
  }

  function isMutationCurrent(token: MutationToken) {
    return (
      activeMutationIdRef.current === token.id &&
      openGenerationRef.current === token.generation
    )
  }

  function finishMutation(token: MutationToken) {
    if (activeMutationIdRef.current === token.id) {
      activeMutationIdRef.current = null
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && activeMutationIdRef.current !== null) return
    onOpenChange(nextOpen)
  }

  function selectSection(nextSection: AccountSettingsSection) {
    if (accountMutationBusy || nextSection === section) return
    setSection(nextSection)
    window.requestAnimationFrame(() => {
      if (nextSection === 'profile') profileInputRef.current?.focus()
      if (nextSection === 'notifications') notificationPrimaryActionRef.current?.focus()
      if (nextSection === 'security') securityInputRef.current?.focus()
    })
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const displayNameValue = profileDraft.trim()
    if (!displayNameValue) {
      setProfileError('昵称不能为空。')
      return
    }

    const mutation = beginMutation()
    if (!mutation) return

    setProfileBusy(true)
    setProfileError('')
    setProfileSuccess('')
    try {
      await onSaveProfile({ displayName: displayNameValue })
      if (!isMutationCurrent(mutation)) return
      setSavedDisplayName(displayNameValue)
      setProfileDraft(displayNameValue)
      setProfileSuccess('个人资料已保存。')
    } catch (error) {
      if (isMutationCurrent(mutation)) {
        setProfileError(getErrorMessage(error, '保存失败，请稍后重试。'))
      }
    } finally {
      const isCurrent = isMutationCurrent(mutation)
      finishMutation(mutation)
      if (isCurrent) setProfileBusy(false)
    }
  }

  async function bindFeishuAccount() {
    const mutation = beginMutation()
    if (!mutation) return

    setFeishuBusy(true)
    setFeishuError('')
    setFeishuSuccess('')
    setSubscriptionSuccess('')
    try {
      const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`
      const result = await createFeishuOAuthUrl({ returnTo })
      if (!isMutationCurrent(mutation)) return
      window.location.assign(result.url)
    } catch (error) {
      if (isMutationCurrent(mutation)) {
        setFeishuError(getErrorMessage(error, '飞书授权链接生成失败，请稍后重试。'))
      }
    } finally {
      const isCurrent = isMutationCurrent(mutation)
      finishMutation(mutation)
      if (isCurrent) setFeishuBusy(false)
    }
  }

  async function disconnectFeishu() {
    const mutation = beginMutation()
    if (!mutation) return false

    setFeishuBusy(true)
    setFeishuError('')
    setFeishuSuccess('')
    try {
      const result = await onDisconnectFeishu()
      if (!isMutationCurrent(mutation)) return false
      subscriptionRequestIdRef.current += 1
      setFeishuDisconnected(true)
      setSavedDisplayName(result.displayName || result.username)
      setPersistedSubscription((current) => ({ ...current, enabled: false }))
      setSubscriptionDraft((current) => ({ ...current, enabled: false }))
      setSubscriptionLoading(false)
      setSubscriptionSaveError('')
      setSubscriptionSuccess('')
      setFeishuSuccess('飞书账号已解除绑定。')
      return true
    } finally {
      const isCurrent = isMutationCurrent(mutation)
      finishMutation(mutation)
      if (isCurrent) setFeishuBusy(false)
    }
  }

  async function saveSubscription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(subscriptionDraft.localSendTime)) {
      setSubscriptionSaveError('请输入有效的 24 小时时间。')
      return
    }
    if (subscriptionDraft.enabled && !feishuLinked) {
      setSubscriptionSaveError('请先绑定飞书账号，再开启每日推送。')
      return
    }

    const mutation = beginMutation()
    if (!mutation) return

    setSubscriptionSaving(true)
    setSubscriptionSaveError('')
    setSubscriptionSuccess('')
    try {
      const result = await updateNotificationSubscription({
        enabled: subscriptionDraft.enabled,
        localSendTime: subscriptionDraft.localSendTime,
      })
      if (!isMutationCurrent(mutation)) return
      setPersistedSubscription(result.subscription)
      setSubscriptionDraft(result.subscription)
      setSubscriptionSuccess('通知设置已保存。')
    } catch (error) {
      if (isMutationCurrent(mutation)) {
        setSubscriptionSaveError(
          getErrorMessage(error, '每日推送设置保存失败，请稍后重试。'),
        )
      }
    } finally {
      const isCurrent = isMutationCurrent(mutation)
      finishMutation(mutation)
      if (isCurrent) setSubscriptionSaving(false)
    }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!currentPasswordDraft || nextPasswordDraft.length < 6) {
      setPasswordError('请输入旧密码，并确保新密码不少于 6 位。')
      return
    }
    if (nextPasswordDraft !== confirmPasswordDraft) {
      setPasswordError('两次输入的新密码不一致。')
      return
    }

    const mutation = beginMutation()
    if (!mutation) return

    setPasswordBusy(true)
    setPasswordError('')
    setPasswordSuccess('')
    try {
      await updateCurrentPassword({
        currentPassword: currentPasswordDraft,
        nextPassword: nextPasswordDraft,
      })
      if (!isMutationCurrent(mutation)) return
      setCurrentPasswordDraft('')
      setNextPasswordDraft('')
      setConfirmPasswordDraft('')
      setPasswordSuccess('登录密码已更新。')
    } catch (error) {
      if (isMutationCurrent(mutation)) {
        setPasswordError(getErrorMessage(error, '修改失败，请确认旧密码是否正确。'))
      }
    } finally {
      const isCurrent = isMutationCurrent(mutation)
      finishMutation(mutation)
      if (isCurrent) setPasswordBusy(false)
    }
  }

  function renderDetailHeader(title: string, description: string) {
    return (
      <div className="account-settings-detail-header">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="account-settings-dialog"
        showCloseButton={!accountMutationBusy}
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef?.current) return
          event.preventDefault()
          returnFocusRef.current.focus()
        }}
      >
        <aside className="account-settings-sidebar">
          <DialogHeader className="account-settings-sidebar-header">
            <DialogTitle>账户设置</DialogTitle>
            <DialogDescription>
              {user?.username ? `${user.username} · 当前登录账号` : '当前账户尚未登录'}
            </DialogDescription>
          </DialogHeader>
          <nav className="account-settings-nav" aria-label="账户设置分类">
            <Button
              aria-current={section === 'profile' ? 'page' : undefined}
              className="account-settings-nav-item"
              data-active={section === 'profile'}
              disabled={accountMutationBusy}
              type="button"
              variant="ghost"
              onClick={() => selectSection('profile')}
            >
              <UserCircle aria-hidden="true" size={18} weight="duotone" />
              <span className="account-settings-nav-copy">
                <strong>个人资料</strong>
                <small>{displayName}</small>
              </span>
            </Button>
            <Button
              aria-current={section === 'notifications' ? 'page' : undefined}
              className="account-settings-nav-item"
              data-active={section === 'notifications'}
              disabled={accountMutationBusy}
              type="button"
              variant="ghost"
              onClick={() => selectSection('notifications')}
            >
              <Bell aria-hidden="true" size={18} weight="duotone" />
              <span className="account-settings-nav-copy">
                <strong>飞书通知</strong>
                <small>{notificationSummary}</small>
              </span>
            </Button>
            <Button
              aria-current={section === 'security' ? 'page' : undefined}
              className="account-settings-nav-item"
              data-active={section === 'security'}
              disabled={accountMutationBusy}
              type="button"
              variant="ghost"
              onClick={() => selectSection('security')}
            >
              <LockKey aria-hidden="true" size={18} weight="duotone" />
              <span className="account-settings-nav-copy">
                <strong>登录安全</strong>
                <small>修改登录密码</small>
              </span>
            </Button>
          </nav>
        </aside>

        <section className="account-settings-panel">
        {section === 'profile' ? (
          <>
            {renderDetailHeader(
              '个人资料',
              user?.username ? `当前登录账号：${user.username}` : '维护当前账户的显示昵称。',
            )}
            <form className="account-settings-detail-form" onSubmit={saveProfile}>
              <div className="account-settings-detail-body">
                <Label>
                  昵称
                  <Input
                    autoFocus
                    ref={profileInputRef}
                    aria-describedby={profileError ? 'account-settings-profile-error' : undefined}
                    aria-invalid={Boolean(profileError)}
                    autoComplete="off"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    data-protonpass-ignore="true"
                    disabled={profileBusy}
                    maxLength={32}
                    name="veges-account-display-name"
                    required
                    spellCheck={false}
                    value={profileDraft}
                    onChange={(event) => {
                      setProfileDraft(event.target.value)
                      setProfileError('')
                      setProfileSuccess('')
                    }}
                  />
                </Label>
                {profileError ? (
                  <p className="form-error" id="account-settings-profile-error" role="alert">
                    {profileError}
                  </p>
                ) : null}
                {profileSuccess ? (
                  <p className="form-success" role="status" aria-live="polite">
                    {profileSuccess}
                  </p>
                ) : null}
              </div>
              <DialogFooter className="account-settings-detail-actions">
                <Button
                  aria-busy={profileBusy}
                  disabled={profileBusy || !profileDraft.trim() || !profileChanged}
                  type="submit"
                >
                  {profileBusy ? '保存中...' : '保存资料'}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : null}

        {section === 'notifications' ? (
          <>
            {renderDetailHeader('飞书通知', '管理飞书绑定和每日待办推送。')}
            <form
              className="account-settings-detail-form account-settings-notification-form"
              onSubmit={saveSubscription}
            >
              <div className="account-settings-detail-body account-settings-notification-body">
                <section
                  className="account-settings-notification-section"
                  aria-labelledby="account-settings-feishu-title"
                >
                  <div className="account-settings-notification-heading">
                    <div>
                      <strong id="account-settings-feishu-title">飞书账号</strong>
                      <small>
                        {feishuLinked
                          ? feishuEmail || '已绑定，可接收个人通知和群内 @。'
                          : '未绑定，绑定后可接收个人通知和群内 @。'}
                      </small>
                    </div>
                    <div className="account-settings-notification-actions">
                      <Button
                        ref={notificationPrimaryActionRef}
                        aria-busy={notificationMutationBusy}
                        disabled={notificationMutationBusy || !user}
                        type="button"
                        variant={feishuLinked ? 'outline' : 'default'}
                        onClick={() => void bindFeishuAccount()}
                      >
                        <LinkSimple size={16} />
                        {feishuBusy ? '处理中...' : feishuLinked ? '重新绑定' : '绑定飞书'}
                      </Button>
                      {feishuLinked ? (
                        <ConfirmActionDialog
                          key={`${user?.id}:${open}`}
                          actionKey={`disconnect-feishu:${user?.id}`}
                          title="解除飞书账号绑定？"
                          description="解除后将停止通过此账号接收飞书通知和待办日报，日报订阅也会关闭。需要时可重新绑定并开启订阅。"
                          confirmLabel="解除绑定"
                          onConfirm={disconnectFeishu}
                          trigger={(
                            <Button
                              aria-busy={notificationMutationBusy}
                              disabled={notificationMutationBusy}
                              type="button"
                              variant="destructive"
                            >
                              解除绑定
                            </Button>
                          )}
                        />
                      ) : null}
                    </div>
                  </div>
                  {feishuError ? (
                    <p className="form-error" role="alert">
                      {feishuError}
                    </p>
                  ) : null}
                  {feishuSuccess ? (
                    <p className="form-success" role="status" aria-live="polite">
                      {feishuSuccess}
                    </p>
                  ) : null}
                </section>
                <Separator />
                <section
                  className="account-settings-notification-section"
                  aria-labelledby="account-settings-digest-title"
                >
                  <div className="account-settings-notification-heading">
                    <div>
                      <strong id="account-settings-digest-title">每日待办完成推送</strong>
                      <small>每天发送上一完整自然日的完成情况。</small>
                    </div>
                    {!subscriptionLoading && !subscriptionLoadError ? (
                      <label className="account-settings-notification-toggle">
                        <input
                          aria-describedby={
                            subscriptionSaveError
                              ? 'account-settings-subscription-error'
                              : undefined
                          }
                          aria-invalid={Boolean(subscriptionSaveError)}
                          aria-labelledby="account-settings-digest-title account-settings-digest-toggle-state"
                          checked={subscriptionDraft.enabled}
                          disabled={
                            notificationMutationBusy ||
                            (!feishuLinked && !subscriptionDraft.enabled)
                          }
                          type="checkbox"
                          onChange={(event) => {
                            setSubscriptionDraft((current) => ({
                              ...current,
                              enabled: event.target.checked,
                            }))
                            setSubscriptionSaveError('')
                            setSubscriptionSuccess('')
                          }}
                        />
                        <span aria-hidden="true" />
                        <small id="account-settings-digest-toggle-state">
                          {subscriptionDraft.enabled ? '已开启' : '已关闭'}
                        </small>
                      </label>
                    ) : null}
                  </div>

                  {subscriptionLoading ? (
                    <p className="account-settings-inline-status" role="status">
                      正在读取推送设置...
                    </p>
                  ) : null}

                  {!subscriptionLoading && subscriptionLoadError ? (
                    <div className="account-settings-load-error">
                      <p className="form-error" role="alert">
                        {subscriptionLoadError}
                      </p>
                      <Button
                        disabled={notificationMutationBusy}
                        type="button"
                        variant="outline"
                        onClick={() => void loadSubscription()}
                      >
                        重新读取
                      </Button>
                    </div>
                  ) : null}

                  {!subscriptionLoading && !subscriptionLoadError ? (
                    <>
                    {subscriptionDraft.enabled ? (
                      <div className="account-settings-notification-time">
                        <div className="grid gap-2">
                          <Label htmlFor="account-settings-digest-time">
                            推送时间
                          </Label>
                          <TimePicker
                            aria-describedby={
                              subscriptionSaveError
                                ? 'account-settings-subscription-error'
                                : undefined
                            }
                            aria-invalid={Boolean(subscriptionSaveError)}
                            aria-label="推送时间"
                            disabled={notificationMutationBusy || !feishuLinked}
                            id="account-settings-digest-time"
                            value={subscriptionDraft.localSendTime}
                            onValueChange={(localSendTime) => {
                              setSubscriptionDraft((current) => ({
                                ...current,
                                localSendTime,
                              }))
                              setSubscriptionSaveError('')
                              setSubscriptionSuccess('')
                            }}
                          />
                        </div>
                        <span className="account-settings-notification-timezone">
                          {subscriptionDraft.timezone || 'Asia/Shanghai'}
                        </span>
                      </div>
                    ) : null}
                    {!feishuLinked ? (
                      <p className="account-settings-notification-note">
                        绑定飞书账号后才能开启个人推送。
                      </p>
                    ) : null}
                    {subscriptionSaveError ? (
                      <p
                        className="form-error"
                        id="account-settings-subscription-error"
                        role="alert"
                      >
                        {subscriptionSaveError}
                      </p>
                    ) : null}
                    {subscriptionSuccess ? (
                      <p className="form-success" role="status" aria-live="polite">
                        {subscriptionSuccess}
                      </p>
                    ) : null}
                    </>
                  ) : null}
                </section>
              </div>
              <DialogFooter className="account-settings-detail-actions">
                <Button
                  aria-busy={subscriptionLoading || notificationMutationBusy}
                  disabled={
                    subscriptionLoading ||
                    Boolean(subscriptionLoadError) ||
                    notificationMutationBusy ||
                    !subscriptionChanged ||
                    (subscriptionDraft.enabled && !feishuLinked)
                  }
                  type="submit"
                >
                  {subscriptionLoading
                    ? '读取中...'
                    : subscriptionSaving
                      ? '保存中...'
                      : '保存通知设置'}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : null}

        {section === 'security' ? (
          <>
            {renderDetailHeader('登录安全', '修改当前账户的登录密码。')}
            <form
              autoComplete="off"
              className="account-settings-detail-form"
              data-1p-ignore="true"
              data-lpignore="true"
              data-protonpass-ignore="true"
              onSubmit={savePassword}
            >
              <div aria-hidden="true" className="autofill-decoys">
                <input autoComplete="username" name="username" tabIndex={-1} type="text" />
                <input autoComplete="current-password" name="password" tabIndex={-1} type="password" />
                <input autoComplete="new-password" name="new-password" tabIndex={-1} type="password" />
              </div>
              <div className="account-settings-detail-body account-settings-security-fields">
                <Label>
                  旧密码
                  <Input
                    autoFocus
                    ref={securityInputRef}
                    aria-describedby={passwordError ? 'account-settings-password-error' : undefined}
                    aria-invalid={Boolean(passwordError)}
                    autoComplete="new-password"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    data-protonpass-ignore="true"
                    disabled={passwordBusy}
                    name="veges-account-current-secret"
                    required
                    type="password"
                    value={currentPasswordDraft}
                    onChange={(event) => {
                      setCurrentPasswordDraft(event.target.value)
                      setPasswordError('')
                      setPasswordSuccess('')
                    }}
                  />
                </Label>
                <Label>
                  新密码
                  <Input
                    aria-describedby={passwordError ? 'account-settings-password-error' : undefined}
                    aria-invalid={Boolean(passwordError)}
                    autoComplete="new-password"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    data-protonpass-ignore="true"
                    disabled={passwordBusy}
                    minLength={6}
                    name="veges-account-next-secret"
                    required
                    type="password"
                    value={nextPasswordDraft}
                    onChange={(event) => {
                      setNextPasswordDraft(event.target.value)
                      setPasswordError('')
                      setPasswordSuccess('')
                    }}
                  />
                </Label>
                <Label>
                  确认新密码
                  <Input
                    aria-describedby={passwordError ? 'account-settings-password-error' : undefined}
                    aria-invalid={Boolean(passwordError)}
                    autoComplete="new-password"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    data-protonpass-ignore="true"
                    disabled={passwordBusy}
                    minLength={6}
                    name="veges-account-confirm-secret"
                    required
                    type="password"
                    value={confirmPasswordDraft}
                    onChange={(event) => {
                      setConfirmPasswordDraft(event.target.value)
                      setPasswordError('')
                      setPasswordSuccess('')
                    }}
                  />
                </Label>
                {passwordError ? (
                  <p className="form-error" id="account-settings-password-error" role="alert">
                    {passwordError}
                  </p>
                ) : null}
                {passwordSuccess ? (
                  <p className="form-success" role="status" aria-live="polite">
                    {passwordSuccess}
                  </p>
                ) : null}
              </div>
              <DialogFooter className="account-settings-detail-actions">
                <Button aria-busy={passwordBusy} disabled={passwordBusy} type="submit">
                  {passwordBusy ? '修改中...' : '修改密码'}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : null}
        </section>
      </DialogContent>
    </Dialog>
  )
}
