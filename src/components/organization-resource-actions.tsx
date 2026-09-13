import { useEffect, useState, type ReactNode, type FormEvent } from 'react'
import {
  DotsThree,
  PencilSimple,
  Plus,
  Trash,
  Users,
  UserSwitch,
} from '@phosphor-icons/react'
import {
  removeProject,
  requestProjectTransfer,
  updateOrganizationProjectGovernance,
} from '../api'
import type {
  OrganizationDetail,
  OrganizationProject,
} from '../organization-types'
import {
  addTestSpaceMember,
  createTestSpace,
  deleteTestSpace,
  fetchTestSpaceSettings,
  removeTestSpaceMember,
  transferOrganizationTestSpaceOwnership,
  updateTestSpace,
  updateTestSpaceMember,
} from '../test-workbench-api'
import type {
  ManagedTestSpace,
  TestSpaceSettings,
} from '../test-workbench-types'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Input } from './ui/input'
import { Label } from './ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import { Textarea } from './ui/textarea'
import { ConfirmActionDialog } from './confirm-action-dialog'
import { useConfirmAction } from '../hooks/use-confirm-action'

function message(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请重试。'
}
type Refresh = () => Promise<void>
type ProjectAction = 'edit' | 'transfer' | 'delete'
const projectTitles = {
  edit: '编辑项目',
  transfer: '转移项目所有权',
  delete: '删除项目',
}

export function OrganizationProjectActions({
  project,
  detail,
  onRefresh,
  disabled,
}: {
  project: OrganizationProject
  detail: OrganizationDetail
  onRefresh: Refresh
  disabled: boolean
}) {
  const [action, setAction] = useState<ProjectAction | null>(null)
  return (
    <>
      {project.canManageSettings ? (
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => setAction('edit')}
        >
          <PencilSimple />
          编辑项目
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={`管理项目 ${project.name}`}
            title="项目操作"
            size="icon"
            variant="ghost"
            disabled={disabled}
          >
            <DotsThree />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            {project.canTransferOwnership ? (
              <DropdownMenuItem onSelect={() => setAction('transfer')}>
                <UserSwitch /> 所有权转移
              </DropdownMenuItem>
            ) : null}
            {project.canDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setAction('delete')}
                >
                  <Trash /> 删除项目
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {action ? (
        <ProjectActionDialog
          key={`${project.id}:${action}`}
          action={action}
          project={project}
          detail={detail}
          onClose={() => setAction(null)}
          onRefresh={onRefresh}
        />
      ) : null}
    </>
  )
}

function ProjectActionDialog({
  action,
  project,
  detail,
  onClose,
  onRefresh,
}: {
  action: ProjectAction
  project: OrganizationProject
  detail: OrganizationDetail
  onClose: () => void
  onRefresh: Refresh
}) {
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description)
  const [tags, setTags] = useState(project.tags.join('，'))
  const [status, setStatus] = useState(project.status)
  const [healthStatus, setHealthStatus] = useState(project.healthStatus)
  const [healthNote, setHealthNote] = useState(project.healthNote)
  const [target, setTarget] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const candidates = detail.members.filter(
    (member) => member.id !== project.ownerUserId,
  )
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (action === 'delete') await removeProject(project.id)
      else if (action === 'transfer')
        await requestProjectTransfer(project.id, {
          organizationId: detail.id,
          targetUserId: Number(target),
        })
      else
        await updateOrganizationProjectGovernance(detail.id, project.id, {
          name: name.trim(),
          description,
          tags: tags.split(/[\s,，、]+/u).filter(Boolean),
          status,
          healthStatus,
          healthNote: healthNote.trim(),
        })
      if (action === 'transfer') setSent(true)
      await onRefresh()
      if (action !== 'transfer') onClose()
    } catch (failure) {
      setError(message(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent fixedHeader className="organization-project-edit-dialog">
        <DialogHeader>
          <DialogTitle>{projectTitles[action]}</DialogTitle>
          <DialogDescription>
            {action === 'transfer'
              ? `当前所有者：${project.ownerName}。接收人需在通知中心确认，申请 72 小时内有效。`
              : `在 ${detail.name} 内管理「${project.name}」。`}
          </DialogDescription>
        </DialogHeader>
        <form
          className="organization-resource-form"
          onSubmit={(event) => void submit(event)}
        >
          {error ? (
            <p role="alert" className="organization-error">
              {error}
            </p>
          ) : null}
          {sent ? (
            <p role="status">
              转移申请已发送，等待接收人在通知中心确认。确认后原所有者保留普通项目成员身份。
            </p>
          ) : (
            <>
              {action === 'edit' ? (
                <Label>
                  项目名称
                  <Input
                    required
                    maxLength={80}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Label>
              ) : null}
              {action === 'edit' ? (
                <>
                  <Label>
                    项目简介
                    <Textarea
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  </Label>
                  <Label>
                    项目标签
                    <Input
                      value={tags}
                      onChange={(event) => setTags(event.target.value)}
                      placeholder="用逗号或空格分隔"
                    />
                  </Label>
                </>
              ) : null}
              {action === 'edit' ? (
                <>
                  <div className="organization-project-edit-status">
                    <Label>
                      生命周期状态
                      <Select
                        value={status}
                        onValueChange={(value) => {
                          if (value) setStatus(value as typeof status)
                        }}
                      >
                        <SelectTrigger aria-label="生命周期状态">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {Object.entries({
                              active: '进行中',
                              paused: '暂停',
                              completed: '已完成',
                              archived: '已归档',
                            }).map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Label>
                    <Label>
                      项目健康度
                      <Select
                        value={healthStatus}
                        onValueChange={(value) => {
                          if (value)
                            setHealthStatus(value as typeof healthStatus)
                        }}
                      >
                        <SelectTrigger aria-label="项目健康度">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {Object.entries({
                              on_track: '正常',
                              at_risk: '有风险',
                              off_track: '已失控',
                            }).map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Label>
                  </div>
                  <Label>
                    健康度说明{healthStatus === 'on_track' ? '（可选）' : ''}
                    <Textarea
                      maxLength={1000}
                      required={healthStatus !== 'on_track'}
                      value={healthNote}
                      onChange={(event) => setHealthNote(event.target.value)}
                    />
                  </Label>
                </>
              ) : null}
              {action === 'transfer' ? (
                <Label>
                  新所有者
                  <Select
                    value={target}
                    onValueChange={(value) => {
                      if (value) setTarget(value)
                    }}
                  >
                    <SelectTrigger aria-label="选择项目新所有者">
                      <SelectValue placeholder="选择组织成员" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {candidates.map((member) => (
                          <SelectItem key={member.id} value={String(member.id)}>
                            {member.displayName}（{member.username}）
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {candidates.length === 0 ? (
                    <small>组织内没有其他可接收成员。</small>
                  ) : null}
                </Label>
              ) : null}
              {action === 'delete' ? (
                <>
                  <p>删除后，项目下的日记、待办和总结将一并删除，无法撤销。</p>
                  <Label>
                    输入项目名称确认
                    <Input
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      placeholder={project.name}
                    />
                  </Label>
                </>
              ) : null}
            </>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              {sent ? '关闭' : '取消'}
            </Button>
            {!sent ? (
              <Button
                type="submit"
                variant={action === 'delete' ? 'destructive' : 'default'}
                disabled={
                  busy ||
                  (action === 'delete'
                    ? confirmation !== project.name
                    : action === 'transfer'
                      ? !target
                      : !name.trim() ||
                        (healthStatus !== 'on_track' && !healthNote.trim()))
                }
              >
                {busy
                  ? '处理中…'
                  : action === 'transfer'
                    ? '发送转移申请'
                    : action === 'delete'
                      ? '确认删除'
                      : '保存修改'}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type SpaceAction = 'create' | 'edit' | 'members' | 'transfer' | 'delete'
const spaceTitles = {
  create: '新建测试空间',
  edit: '编辑测试空间',
  members: '测试空间成员管理',
  transfer: '测试空间所有权转移',
  delete: '删除测试空间',
}

export function OrganizationTestSpaces({
  heading,
  detail,
  onRefresh,
}: {
  heading?: ReactNode
  detail: OrganizationDetail
  onRefresh: Refresh
}) {
  const [selection, setSelection] = useState<{
    id?: number
    action: SpaceAction
  } | null>(null)
  return (
    <>
      <header>
        <div className="organization-section-heading">
          {heading ?? (
            <>
              <h3>组织测试空间</h3>
              <span>{detail.testSpaces.length}</span>
            </>
          )}
        </div>
        {detail.canManageTestSpaces ? (
          <Button onClick={() => setSelection({ action: 'create' })}>
            <Plus /> 新建测试空间
          </Button>
        ) : null}
      </header>
      <div className="organization-list">
        {detail.testSpaces.map((space) => (
          <div
            className="organization-resource-row organization-test-space-row"
            key={space.id}
          >
            <div>
              <strong>{space.name}</strong>
              <span>
                {space.versionLabel || '未指定版本'} · 所有者：{space.ownerName}
              </span>
            </div>
            <div className="organization-resource-counts">
              <span>{space.planCount} 计划</span>
              <span>{space.bugCount} Bug</span>
            </div>
            {detail.canManageTestSpaces ? (
              <div className="organization-resource-actions">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelection({ id: space.id, action: 'edit' })}
                >
                  <PencilSimple /> 编辑
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setSelection({ id: space.id, action: 'members' })
                  }
                >
                  <Users /> 成员管理
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`管理测试空间 ${space.name}`}
                    >
                      <DotsThree />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        onSelect={() =>
                          setSelection({ id: space.id, action: 'transfer' })
                        }
                      >
                        <UserSwitch />
                        所有权转移
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() =>
                          setSelection({ id: space.id, action: 'delete' })
                        }
                      >
                        <Trash /> 删除测试空间
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : null}
          </div>
        ))}
        {detail.testSpaces.length === 0 ? (
          <p className="organization-empty">暂无组织测试空间。</p>
        ) : null}
      </div>
      {selection ? (
        <SpaceActionDialog
          key={`${detail.id}:${selection.id}:${selection.action}`}
          detail={detail}
          spaceId={selection.id}
          action={selection.action}
          onClose={() => setSelection(null)}
          onRefresh={onRefresh}
        />
      ) : null}
    </>
  )
}

function SpaceActionDialog({
  detail,
  spaceId,
  action,
  onClose,
  onRefresh,
}: {
  detail: OrganizationDetail
  spaceId?: number
  action: SpaceAction
  onClose: () => void
  onRefresh: Refresh
}) {
  const [settings, setSettings] = useState<TestSpaceSettings | null>(null)
  const [name, setName] = useState('')
  const [version, setVersion] = useState('')
  const [target, setTarget] = useState('')
  const [username, setUsername] = useState('')
  const [access, setAccess] = useState<'editor' | 'viewer'>('editor')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const space = settings?.spaces.find(
    (item) => item.id === spaceId && item.organizationId === detail.id,
  )
  const eligibleOrganizationMembers = detail.members.filter(
    (member) =>
      member.id !== space?.ownerUserId &&
      (member.roles.includes('tester') ||
        member.roles.includes('organization_admin')),
  )
  const transferTarget = eligibleOrganizationMembers.find(
    (member) => String(member.id) === target,
  )
  const { confirmAction, confirmationDialog } = useConfirmAction(
    `${detail.id}:${spaceId ?? 'new'}:${action}`,
  )
  useEffect(() => {
    let active = true
    fetchTestSpaceSettings()
      .then((result) => {
        if (!active) return
        setSettings(result)
        const current = result.spaces.find(
          (item) => item.id === spaceId && item.organizationId === detail.id,
        )
        if (current) {
          setName(current.name)
          setVersion(current.versionLabel ?? '')
        } else if (spaceId)
          setError('测试空间已移出当前组织，或你已失去管理权限。')
      })
      .catch((failure) => {
        if (active) setError(message(failure))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [spaceId, detail.id])
  const canAct =
    action === 'create'
      ? detail.canManageTestSpaces
      : Boolean(
          space &&
            (action === 'members'
              ? space.canManageMembers
              : action === 'delete'
                ? space.canDelete
                : action === 'transfer'
                  ? space.canTransferOwnership
                  : space.canManageSettings),
        )
  async function mutate(
    operation: () => Promise<unknown>,
    close = false,
    rethrowFailure = false,
  ): Promise<boolean> {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await operation()
      if (result && typeof result === 'object' && 'spaces' in result)
        setSettings(result as TestSpaceSettings)
      await onRefresh()
      if (close) onClose()
      return true
    } catch (failure) {
      setError(message(failure))
      if (rethrowFailure) throw failure
      return false
    } finally {
      setBusy(false)
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canAct) return
    if (action === 'create')
      await mutate(
        () => createTestSpace(name.trim(), version.trim(), detail.id),
        true,
      )
    else if (space) {
      if (action === 'delete')
        await mutate(() => deleteTestSpace(space.id, confirmation), true)
      else if (action === 'transfer') {
        if (target && transferTarget)
          await confirmAction(
            {
              title: `立即转移测试空间“${space.name}”？`,
              description: `所有权将立即转移给 ${transferTarget.displayName}，无需对方确认。${space.members.find((member) => member.userId === space.ownerUserId)?.displayName ?? '原所有者'}将保留可编辑权限。`,
              confirmLabel: '立即转移所有权',
              variant: 'default',
              reconcile: async () => {
                const next = await fetchTestSpaceSettings()
                const transferred = next.spaces.find(
                  (item) => item.id === space.id,
                )?.ownerUserId === Number(target)
                if (!transferred) return 'unchanged'
                setSettings(next)
                await onRefresh()
                onClose()
                return 'succeeded'
              },
            },
            () =>
              mutate(
                () =>
                  transferOrganizationTestSpaceOwnership(
                    detail.id,
                    space.id,
                    Number(target),
                  ),
                true,
                true,
              ),
          )
      } else
        await mutate(
          () =>
            updateTestSpace(space.id, {
              name: name.trim(),
              versionLabel: version.trim(),
              organizationId: space.organizationId,
            }),
          true,
        )
    }
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !busy) onClose()
        }}
      >
        <DialogContent className="organization-resource-dialog" fixedHeader>
        <DialogHeader>
          <DialogTitle>{spaceTitles[action]}</DialogTitle>
          <DialogDescription>
            {action === 'create'
              ? `新空间将直接归属 ${detail.name}。`
              : `${detail.name} · ${space?.name ?? '测试空间'}`}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="organization-error">
            {error}
          </p>
        ) : null}
        {loading ? (
          <p role="status">正在加载…</p>
        ) : action === 'members' && space ? (
          <>
            <p>选择当前组织的有效测试成员加入空间或调整权限，所有者权限不可直接修改。</p>
            <form
              className="organization-resource-member-form"
              onSubmit={async (event) => {
                event.preventDefault()
                const selected = eligibleOrganizationMembers.find(
                  (member) => String(member.id) === username,
                )
                const current = space.members.find(
                  (member) =>
                    member.userId === Number(username) &&
                    member.status === 'active',
                )
                if (
                  canAct &&
                  selected &&
                  (await mutate(() =>
                    current
                      ? updateTestSpaceMember(space.id, selected.id, access)
                      : addTestSpaceMember(space.id, selected.username, access),
                  ))
                )
                  setNotice(current ? '成员权限已保存。' : '成员已加入测试空间。')
              }}
            >
              <Label>
                组织成员
                <Select
                  value={username}
                  onValueChange={(value) => {
                    if (value) {
                      setUsername(value)
                      setAccess(
                        space.members.find((m) => String(m.userId) === value)
                          ?.accessLevel === 'viewer'
                          ? 'viewer'
                          : 'editor',
                      )
                    }
                  }}
                >
                  <SelectTrigger aria-label="选择当前组织成员">
                    <SelectValue placeholder="选择当前组织成员" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {eligibleOrganizationMembers.map((member) => (
                          <SelectItem key={member.id} value={String(member.id)}>
                            {member.displayName}（{member.username}）
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {eligibleOrganizationMembers.length === 0 ? (
                  <small>组织内没有具备测试空间资格的其他成员。</small>
                ) : null}
              </Label>
              <Label>
                成员权限
                <AccessSelect
                  value={access}
                  onChange={setAccess}
                  disabled={busy}
                  label="成员访问权限"
                />
              </Label>
              <Button disabled={busy || !canAct || !username} type="submit">
                保存权限
              </Button>
            </form>
            {notice ? <p role="status">{notice}</p> : null}
            <div className="organization-list">
              {space.members
                .filter((member) => member.status === 'active')
                .map((member) => (
                  <div
                    key={member.userId}
                    className="organization-resource-row"
                  >
                    <div>
                      <strong>{member.displayName}</strong>
                      <span>
                        {member.username} ·{' '}
                        {member.status === 'pending'
                          ? '待接受'
                          : member.status === 'active'
                            ? '已加入'
                            : '已拒绝'}
                      </span>
                    </div>
                    {member.accessLevel === 'owner' ? (
                      <span>所有者</span>
                    ) : (
                      <div className="organization-resource-actions">
                        <span>
                          {member.accessLevel === 'editor' ? '可编辑' : '只读'}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || !canAct}
                          onClick={() => {
                            setUsername(String(member.userId))
                            setAccess(
                              member.accessLevel === 'viewer'
                                ? 'viewer'
                                : 'editor',
                            )
                          }}
                        >
                          管理
                        </Button>
                        <ConfirmActionDialog
                          actionKey={`organization-test-space-member-remove:${detail.id}:${space.id}:${member.userId}`}
                          title={`移除测试空间成员“${member.displayName}”？`}
                          description={`该成员将失去“${space.name}”的测试空间访问权限，已有测试数据保留。`}
                          confirmLabel="移除成员"
                          onConfirm={async () => {
                            const removed = await mutate(() =>
                              removeTestSpaceMember(space.id, member.userId),
                              false,
                              true,
                            )
                            if (removed) setUsername('')
                            return removed
                          }}
                          reconcile={async () => {
                            const next = await fetchTestSpaceSettings()
                            const current = next.spaces.find(
                              (item) => item.id === space.id,
                            )
                            if (!current) return 'unknown'
                            setSettings(next)
                            await onRefresh()
                            return current.members.some(
                              (item) => item.userId === member.userId,
                            )
                              ? 'unchanged'
                              : 'succeeded'
                          }}
                          trigger={(
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={busy || !canAct}
                              aria-label={`移除成员 ${member.displayName}`}
                            >
                              <Trash />
                            </Button>
                          )}
                        />
                      </div>
                    )}
                  </div>
                ))}
            </div>
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={onClose}>
                关闭
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className="organization-resource-form"
            onSubmit={(event) => void submit(event)}
          >
            {!canAct && !error ? (
              <p role="alert">你已失去此操作的管理权限，请关闭后刷新列表。</p>
            ) : null}
            {action === 'create' || action === 'edit' ? (
              <Label>
                空间名称
                <Input
                  required
                  maxLength={80}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Label>
            ) : null}
            {action === 'create' || action === 'edit' ? (
              <Label>
                版本号
                <Input
                  required
                  maxLength={80}
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                />
                <small>同一组织内版本号不能重复。</small>
              </Label>
            ) : null}
            {action === 'transfer' ? (
              <>
                <Label>
                  新所有者
                  <Select
                    value={target}
                    onValueChange={(value) => {
                      if (value) setTarget(value)
                    }}
                  >
                    <SelectTrigger aria-label="空间新所有者">
                      <SelectValue placeholder="选择当前组织成员" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {eligibleOrganizationMembers.map((member) => (
                          <SelectItem key={member.id} value={String(member.id)}>
                            {member.displayName}（{member.username}）
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {eligibleOrganizationMembers.length === 0 ? (
                    <small>组织内没有具备测试空间资格的其他成员。</small>
                  ) : null}
                </Label>
                <p>确认后立即生效，无需接收人申请或确认。原所有者保留可编辑权限，组织归属与空间数据不变。</p>
              </>
            ) : null}
            {action === 'delete' ? (
              <>
                <p>
                  将永久删除空间内的测试对象、用例、计划、Bug 和评论，无法撤销。
                </p>
                <Label>
                  输入空间名称确认
                  <Input
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    placeholder={space?.name}
                  />
                </Label>
              </>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onClose}
              >
                取消
              </Button>
              <Button
                type="submit"
                variant={action === 'delete' ? 'destructive' : 'default'}
                disabled={
                  busy ||
                  !canAct ||
                  (action === 'delete'
                    ? confirmation !== space?.name
                    : action === 'transfer'
                      ? !transferTarget
                      : !name.trim() ||
                        ((action === 'create' || action === 'edit') &&
                          !version.trim()))
                }
              >
                {busy
                  ? '处理中…'
                  : action === 'create'
                    ? '创建测试空间'
                    : action === 'transfer'
                      ? '确认转移'
                      : action === 'delete'
                        ? '确认删除'
                        : '保存修改'}
              </Button>
            </DialogFooter>
          </form>
        )}
        </DialogContent>
      </Dialog>
      {confirmationDialog}
    </>
  )
}

function AccessSelect({
  value,
  onChange,
  disabled,
  label,
}: {
  value: Exclude<ManagedTestSpace['accessLevel'], 'owner'>
  onChange: (value: 'editor' | 'viewer') => void
  disabled: boolean
  label: string
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next === 'editor' || next === 'viewer') onChange(next)
      }}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="editor">可编辑</SelectItem>
          <SelectItem value="viewer">只读</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
