import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Check,
  WarningCircle,
} from '@phosphor-icons/react'

import {
  confirmTodoProposals,
  type WorkspaceData,
} from '@/api'
import type {
  Priority,
  Project,
  ProjectMembership,
  TodoProposal,
} from '@/types'
import {
  defaultTodoProposalDueDate,
  type TodoProposalBatchReviewStatus,
} from '@/todo-proposal-defaults'
import { Badge } from '@/components/ui/badge'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { projectModuleUnavailableLabel } from '../../shared/project-modules'

type EditableTodoProposal = TodoProposal & { clientId: string }

const priorityOptions: Array<{ label: string; value: Priority }> = [
  { label: '高', value: 'high' },
  { label: '中', value: 'medium' },
  { label: '低', value: 'low' },
]

function projectMembers(project: Project | undefined, memberships: ProjectMembership[]) {
  if (!project) return []
  const users = new Map<number, string>([[project.ownerUserId, `${project.ownerName}（Owner）`]])
  for (const membership of memberships) {
    if (
      membership.projectId === project.id &&
      membership.status === 'active' &&
      membership.invitedUserId
    ) {
      users.set(membership.invitedUserId, membership.memberName)
    }
  }
  return Array.from(users, ([id, name]) => ({ id, name }))
}

function confidenceLabel(value: number) {
  const normalized = value <= 1 ? value * 100 : value
  return `${Math.max(0, Math.min(100, Math.round(normalized)))}% 置信度`
}

export type TodoProposalWorkflowHandle = {
  openProposals: (
    batchId: number,
    proposals: TodoProposal[],
    fileName?: string,
    status?: TodoProposalBatchReviewStatus,
  ) => void
  reset: () => void
}

type TodoProposalWorkflowProps = {
  memberships: ProjectMembership[]
  onBusyChange?: (busy: boolean) => void
  onWorkspace: (workspace: WorkspaceData, sessionGeneration: number) => void
  projects: Project[]
  sessionGeneration: number
}

export const TodoProposalWorkflow = forwardRef<
  TodoProposalWorkflowHandle,
  TodoProposalWorkflowProps
>(function TodoProposalWorkflow({
  memberships,
  onBusyChange,
  onWorkspace,
  projects,
  sessionGeneration,
}, ref) {
  const [fileName, setFileName] = useState('')
  const [batchId, setBatchId] = useState<number | null>(null)
  const [batchStatus, setBatchStatus] = useState<TodoProposalBatchReviewStatus>('pending')
  const [proposals, setProposals] = useState<EditableTodoProposal[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [reviewOpen, setReviewOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const confirmationRequestIdRef = useRef(0)
  const selectedCount = selectedIds.size
  const allSelected = proposals.length > 0 && selectedCount === proposals.length
  const readOnly = batchStatus !== 'pending'
  const showWorkflowStatus = Boolean(fileName || proposals.length || error)

  useImperativeHandle(ref, () => ({
    openProposals,
    reset: resetWorkflow,
  }))

  useEffect(() => {
    onBusyChange?.(confirming)
  }, [confirming, onBusyChange])

  useEffect(() => () => {
    confirmationRequestIdRef.current += 1
    onBusyChange?.(false)
  }, [onBusyChange])

  const invalidSelectedProposal = useMemo(
    () => proposals.find((proposal) => selectedIds.has(proposal.clientId) && (
      !proposal.projectId || !proposal.title.trim() || !proposal.dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(proposal.dueDate)
    )),
    [proposals, selectedIds],
  )

  const unavailableSelectedModule = proposals.some(proposal => selectedIds.has(proposal.clientId)
    && proposal.moduleId !== null
    && !projects.find(project => project.id === proposal.projectId)?.modules.some(module => module.id === proposal.moduleId && module.selectable))

  function clearProposalReviewState() {
    setBatchId(null)
    setBatchStatus('pending')
    setProposals([])
    setSelectedIds(new Set())
    setReviewOpen(false)
  }

  function resetWorkflow() {
    confirmationRequestIdRef.current += 1
    clearProposalReviewState()
    setFileName('')
    setError('')
  }

  function openProposals(
    nextBatchId: number,
    nextProposals: TodoProposal[],
    requestedFileName = 'AI 对话输入.md',
    status: TodoProposalBatchReviewStatus = 'pending',
  ) {
    confirmationRequestIdRef.current += 1
    setConfirming(false)
    setError('')
    setFileName(requestedFileName)
    const reviewOpenedAt = new Date()
    const editable = nextProposals.map((proposal, index) => ({
      ...proposal,
      clientId: `${nextBatchId}-${index}`,
      dueDate: defaultTodoProposalDueDate(proposal.dueDate, status, reviewOpenedAt),
    }))
    setBatchId(nextBatchId)
    setBatchStatus(status)
    setProposals(editable)
    setSelectedIds(new Set(editable.map((proposal) => proposal.clientId)))
    setReviewOpen(true)
  }

  function updateProposal(clientId: string, patch: Partial<TodoProposal>) {
    setProposals((current) => current.map((proposal) =>
      proposal.clientId === clientId ? { ...proposal, ...patch } : proposal,
    ))
    setError('')
  }

  function toggleProposal(clientId: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(clientId)) next.delete(clientId)
      else next.add(clientId)
      return next
    })
  }

  async function confirmSelected() {
    if (batchId == null || confirming || selectedCount === 0) return
    if (unavailableSelectedModule) {
      setError('选中的提案包含已停用或不可用的模块，请重新选择模块或选择“无模块”。')
      return
    }
    if (invalidSelectedProposal) {
      setError('请为选中的提案填写项目、标题和有效截止日期。')
      return
    }

    const selected = proposals
      .filter((proposal) => selectedIds.has(proposal.clientId))
      .map((proposal) => ({
        assigneeUserId: proposal.assigneeUserId,
        confidence: proposal.confidence,
        detail: proposal.detail,
        dueDate: proposal.dueDate,
        moduleId: proposal.moduleId,
        priority: proposal.priority,
        projectId: proposal.projectId,
        sourceExcerpt: proposal.sourceExcerpt,
        title: proposal.title,
      }))
    setConfirming(true)
    setError('')
    const requestId = confirmationRequestIdRef.current + 1
    confirmationRequestIdRef.current = requestId
    const requestSessionGeneration = sessionGeneration
    try {
      const workspace = await confirmTodoProposals(batchId, selected)
      if (confirmationRequestIdRef.current !== requestId) return
      onWorkspace(workspace, requestSessionGeneration)
      setReviewOpen(false)
      setBatchId(null)
      setProposals([])
      setSelectedIds(new Set())
      setFileName('')
    } catch (confirmError) {
      if (confirmationRequestIdRef.current !== requestId) return
      setError(
        confirmError instanceof Error && confirmError.message
          ? confirmError.message
          : '待办创建失败，已保留你的修改，请重试。',
      )
    } finally {
      if (confirmationRequestIdRef.current === requestId) setConfirming(false)
    }
  }

  return (
    <>
      {showWorkflowStatus ? (
        <section className="todo-proposal-workflow">
          {fileName ? <small className="todo-proposal-file-name">{fileName}</small> : null}
          {proposals.length > 0 && !reviewOpen ? (
            <Button
              disabled={confirming}
              type="button"
              onClick={() => setReviewOpen(true)}
            >
              <Check size={16} weight="bold" />
              {readOnly ? '查看' : '继续审核'} {proposals.length} 项提案
            </Button>
          ) : null}
          {error && !reviewOpen ? <p className="form-error" role="alert">{error}</p> : null}
        </section>
      ) : null}

      <Dialog open={reviewOpen} onOpenChange={(open) => !confirming && setReviewOpen(open)}>
        <DialogContent
          aria-busy={confirming}
          className="todo-proposal-dialog"
          showCloseButton={!confirming}
        >
          <DialogHeader>
            <DialogTitle>{readOnly ? '查看 AI 待办提案' : '确认 AI 待办提案'}</DialogTitle>
            <DialogDescription>
              {readOnly
                ? `${fileName} 的提案批次已${batchStatus === 'confirmed' ? '确认' : '丢弃'}，当前仅供查看。`
                : `已分析 ${fileName}。检查归属和日期，只会创建你勾选的待办。`}
            </DialogDescription>
          </DialogHeader>

          <div className="todo-proposal-review-toolbar">
            <span>{readOnly ? `共 ${proposals.length} 项` : `已选择 ${selectedCount} / ${proposals.length}`}</span>
            {!readOnly ? (
              <Button
                disabled={confirming}
                size="sm"
                type="button"
                variant="ghost"
                onClick={() => setSelectedIds(
                  allSelected ? new Set() : new Set(proposals.map((proposal) => proposal.clientId)),
                )}
              >
                {allSelected ? '取消全选' : '全选'}
              </Button>
            ) : null}
          </div>

          <div className="todo-proposal-list">
            {proposals.map((proposal, index) => {
              const project = projects.find((item) => item.id === proposal.projectId)
              const members = projectMembers(project, memberships)
              const selected = selectedIds.has(proposal.clientId)
              return (
                <article
                  className={selected ? 'todo-proposal-item is-selected' : 'todo-proposal-item'}
                  key={proposal.clientId}
                >
                  <div className="todo-proposal-item-header">
                    <label className="todo-proposal-selection">
                      <input
                        checked={selected}
                        disabled={confirming || readOnly}
                        type="checkbox"
                        onChange={() => toggleProposal(proposal.clientId)}
                      />
                      <span>{selected ? <Check size={13} weight="bold" /> : null}</span>
                      提案 {index + 1}
                    </label>
                    <Badge variant="outline">{confidenceLabel(proposal.confidence)}</Badge>
                  </div>

                  <div className="todo-proposal-grid">
                    <Label>
                      项目
                      <Select
                        disabled={confirming || readOnly}
                        value={proposal.projectId ? String(proposal.projectId) : 'none'}
                        onValueChange={(value) => updateProposal(proposal.clientId, {
                          assigneeUserId: null,
                          moduleId: null,
                          projectId: value === 'none' ? null : Number(value),
                        })}
                      >
                        <SelectTrigger><SelectValue placeholder="选择项目" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">请选择项目</SelectItem>
                          {projects.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Label>
                    <Label>
                      模块
                      <Select
                        disabled={confirming || readOnly || !project}
                        value={proposal.moduleId ? String(proposal.moduleId) : 'none'}
                        onValueChange={(value) => updateProposal(proposal.clientId, {
                          moduleId: value === 'none' ? null : Number(value),
                        })}
                      >
                        <SelectTrigger><SelectValue placeholder="不指定模块" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">不指定模块</SelectItem>
                          {project?.modules.filter(module => module.selectable || module.id === proposal.moduleId).map((module) => (
                            <SelectItem key={module.id} value={String(module.id)} disabled={!module.selectable}>
                              {module.name}{!module.selectable ? `（${projectModuleUnavailableLabel(module)}）` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Label>
                    <Label>
                      负责人
                      <Select
                        disabled={confirming || readOnly || !project}
                        value={proposal.assigneeUserId ? String(proposal.assigneeUserId) : 'none'}
                        onValueChange={(value) => updateProposal(proposal.clientId, {
                          assigneeUserId: value === 'none' ? null : Number(value),
                        })}
                      >
                        <SelectTrigger><SelectValue placeholder="暂不指派" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">暂不指派</SelectItem>
                          {members.map((member) => <SelectItem key={member.id} value={String(member.id)}>{member.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Label>
                    <Label>
                      截止日期
                      <Input
                        disabled={confirming || readOnly}
                        type="date"
                        value={proposal.dueDate ?? ''}
                        onChange={(event) => updateProposal(proposal.clientId, { dueDate: event.target.value || null })}
                      />
                    </Label>
                    <Label>
                      优先级
                      <Select
                        disabled={confirming || readOnly}
                        value={proposal.priority}
                        onValueChange={(value) => updateProposal(proposal.clientId, { priority: value as Priority })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {priorityOptions.map((priority) => <SelectItem key={priority.value} value={priority.value}>{priority.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Label>
                    <Label className="todo-proposal-title-field">
                      标题
                      <Input
                        disabled={confirming || readOnly}
                        maxLength={160}
                        value={proposal.title}
                        onChange={(event) => updateProposal(proposal.clientId, { title: event.target.value })}
                      />
                    </Label>
                    <Label className="todo-proposal-detail-field">
                      详情
                      <Textarea
                        disabled={confirming || readOnly}
                        rows={3}
                        value={proposal.detail}
                        onChange={(event) => updateProposal(proposal.clientId, { detail: event.target.value })}
                      />
                    </Label>
                  </div>
                  {proposal.sourceExcerpt ? (
                    <blockquote className="todo-proposal-source">来源：{proposal.sourceExcerpt}</blockquote>
                  ) : null}
                </article>
              )
            })}
          </div>

          {error ? (
            <p className="form-error todo-proposal-error" role="alert">
              <WarningCircle size={16} weight="fill" /> {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button disabled={confirming} type="button" variant="outline" onClick={() => setReviewOpen(false)}>
              {readOnly ? '关闭' : '稍后处理'}
            </Button>
            {!readOnly ? (
              <Button
                disabled={confirming || selectedCount === 0}
                type="button"
                onClick={() => void confirmSelected()}
              >
                {confirming ? '正在创建' : `确认创建 ${selectedCount} 项`}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
})
