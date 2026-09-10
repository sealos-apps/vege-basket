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
  requestTestSpaceTransfer,
  createTestSpace,
  deleteTestSpace,
  fetchTestSpaceSettings,
  removeTestSpaceMember,
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
  const [acknowledged, setAcknowledged] = useState(false)
  const [sent, setSent] = useState(false)
  const [removing, setRemoving] = useState<number | null>(null)
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
  async function mutate(operation: () => Promise<unknown>, close = false) {
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
        if (
          acknowledged &&
          target &&
          (await mutate(() =>
            requestTestSpaceTransfer(space.id, Number(target)),
          ))
        )
          setSent(true)
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
            <p>仅管理已加入当前空间的成员，所有者权限不可直接修改。</p>
            <form
              className="organization-resource-member-form"
              onSubmit={async (event) => {
                event.preventDefault()
                if (
                  canAct &&
                  username &&
                  (await mutate(() =>
                    updateTestSpaceMember(space.id, Number(username), access),
                  ))
                )
                  setNotice('成员权限已保存。')
              }}
            >
              <Label>
                空间成员
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
                      setRemoving(null)
                    }
                  }}
                >
                  <SelectTrigger aria-label="选择当前空间成员">
                    <SelectValue placeholder="选择当前空间的成员" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {space.members
                        .filter(
                          (m) =>
                            m.status === 'active' && m.accessLevel !== 'owner',
                        )
                        .map((m) => (
                          <SelectItem key={m.userId} value={String(m.userId)}>
                            {m.displayName}（{m.username}）
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
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
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={busy || !canAct}
                          aria-label={`移除成员 ${member.displayName}`}
                          onClick={() => setRemoving(member.userId)}
                        >
                          <Trash />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
            </div>
            {removing ? (
              <div role="alert">
                <p>确认移除此成员？移除后将无法访问当前空间。</p>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setRemoving(null)}
                >
                  取消
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await mutate(() =>
                        removeTestSpaceMember(space.id, removing),
                      )
                    ) {
                      setRemoving(null)
                      setUsername('')
                    }
                  }}
                >
                  确认移除
                </Button>
              </div>
            ) : null}
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
              sent ? (
                <p role="status">
                  转移申请已发送，请接收人在测试工作台的通知中心确认，申请 72
                  小时内有效。
                </p>
              ) : (
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
                        <SelectValue placeholder="选择当前空间成员" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {space?.members
                            .filter(
                              (m) =>
                                m.status === 'active' &&
                                m.userId !== space.ownerUserId,
                            )
                            .map((m) => (
                              <SelectItem
                                key={m.userId}
                                value={String(m.userId)}
                              >
                                {m.displayName}（{m.username}）
                              </SelectItem>
                            ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Label>
                  <p>
                    接收人确认后生效，原所有者保留可编辑权限，组织归属与空间数据不变。
                  </p>
                  <label>
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      onChange={(e) => setAcknowledged(e.target.checked)}
                    />{' '}
                    我已确认接收人及所有权变更影响
                  </label>
                </>
              )
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
                {sent ? '关闭' : '取消'}
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
                      ? !target || !acknowledged || sent
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
                      ? sent
                        ? '已发送'
                        : '发送转移申请'
                      : action === 'delete'
                        ? '确认删除'
                        : '保存修改'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
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
