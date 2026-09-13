import {
  Check,
  ChatCircleDots,
  CircleNotch,
  ClockCounterClockwise,
  DotsThree,
  PencilSimple,
  Plus,
  Trash,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { useId, useState, type FormEvent, type Ref } from 'react'
import {
  groupAiConversationsByDate,
  type AiConversationHistoryLoadState,
  type AiConversationListItem,
} from '@/ai-conversation-state'
import { Button } from '@/components/ui/button'
import { ConfirmActionDialog } from './confirm-action-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type MaybePromise = Promise<void> | void

export type AiConversationHistoryPanelProps = {
  className?: string
  conversations: AiConversationListItem[]
  currentConversationId: string | null
  error: string
  hasLoaded: boolean
  loadState: AiConversationHistoryLoadState
  nextCursor: string | null
  now?: Date
  panelRef?: Ref<HTMLElement>
  onClose: () => void
  onCreateConversation: () => void
  onDeleteConversation: (conversationId: string) => MaybePromise
  onLoadMore: () => MaybePromise
  onRenameConversation: (conversationId: string, title: string) => MaybePromise
  onRetry: () => MaybePromise
  onSelectConversation: (conversation: AiConversationListItem) => MaybePromise
}

export function AiConversationHistoryPanel({
  className,
  conversations,
  currentConversationId,
  error,
  hasLoaded,
  loadState,
  nextCursor,
  now = new Date(),
  panelRef,
  onClose,
  onCreateConversation,
  onDeleteConversation,
  onLoadMore,
  onRenameConversation,
  onRetry,
  onSelectConversation,
}: AiConversationHistoryPanelProps) {
  const titleId = useId()
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renameError, setRenameError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<AiConversationListItem | null>(null)
  const [actionBusyId, setActionBusyId] = useState<string | null>(null)
  const groups = groupAiConversationsByDate(conversations, now)
  const initialLoading = loadState === 'loading-initial' && conversations.length === 0
  const loadingMore = loadState === 'loading-more'

  function beginRename(conversation: AiConversationListItem) {
    setRenamingId(conversation.id)
    setRenameDraft(conversation.title)
    setRenameError('')
  }

  function cancelRename() {
    if (actionBusyId === renamingId) return
    setRenamingId(null)
    setRenameDraft('')
    setRenameError('')
  }

  async function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!renamingId || actionBusyId) return

    const nextTitle = renameDraft.trim()
    if (!nextTitle) {
      setRenameError('标题不能为空。')
      return
    }

    const current = conversations.find((conversation) => conversation.id === renamingId)
    if (current?.title === nextTitle) {
      cancelRename()
      return
    }

    setActionBusyId(renamingId)
    setRenameError('')
    try {
      await onRenameConversation(renamingId, nextTitle)
      setRenamingId(null)
      setRenameDraft('')
    } catch (renameFailure) {
      setRenameError(actionErrorMessage(renameFailure, '重命名失败，请重试。'))
    } finally {
      setActionBusyId(null)
    }
  }

  function requestDelete(conversation: AiConversationListItem) {
    setDeleteTarget(conversation)
  }

  async function confirmDelete() {
    if (!deleteTarget || actionBusyId) return false
    setActionBusyId(deleteTarget.id)
    try {
      await onDeleteConversation(deleteTarget.id)
      return true
    } finally { setActionBusyId(null) }
  }

  return (
    <nav
      ref={panelRef}
      aria-busy={loadState !== 'idle'}
      aria-labelledby={titleId}
      className={cn(
        'flex h-full min-h-0 w-full flex-col overflow-hidden border-l bg-background [letter-spacing:0] max-[1100px]:border-l-0',
        className,
      )}
      tabIndex={-1}
    >
      <header className="flex min-h-[50px] shrink-0 items-center justify-between gap-2 border-b px-2.5 py-1.5 pl-3.5">
        <div className="flex min-w-0 items-center gap-2 text-foreground">
          <ClockCounterClockwise aria-hidden size={17} weight="duotone" />
          <h2 className="m-0 truncate text-sm font-semibold [letter-spacing:0]" id={titleId}>
            历史对话
          </h2>
          <span className="min-w-5 rounded-full bg-muted px-1.5 py-0.5 text-center text-[11px] leading-[1.3] text-muted-foreground tabular-nums">
            {conversations.length}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            aria-label="开始新对话"
            size="icon"
            title="开始新对话"
            type="button"
            variant="ghost"
            onClick={onCreateConversation}
          >
            <Plus aria-hidden size={16} weight="bold" />
          </Button>
          <Button
            aria-label="关闭历史对话"
            size="icon"
            title="关闭"
            type="button"
            variant="ghost"
            onClick={onClose}
          >
            <X aria-hidden size={16} />
          </Button>
        </div>
      </header>

      {error && conversations.length > 0 ? (
        <div
          className="mx-2.5 mt-2.5 flex shrink-0 items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-destructive"
          role="alert"
        >
          <WarningCircle aria-hidden className="mt-0.5 shrink-0" size={16} weight="fill" />
          <p className="m-0 min-w-0 flex-1 text-xs leading-5">{error}</p>
          <Button size="xs" type="button" variant="outline" onClick={() => void onRetry()}>
            重试
          </Button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3 pt-1.5">
        {initialLoading ? (
          <div className="grid min-h-56 place-content-center justify-items-center gap-2 text-muted-foreground" role="status">
            <CircleNotch aria-hidden className="animate-spin" size={22} />
            <span className="text-xs">正在读取历史对话…</span>
          </div>
        ) : error && conversations.length === 0 ? (
          <div className="grid min-h-56 place-content-center justify-items-center gap-2 px-5 text-center" role="alert">
            <WarningCircle aria-hidden className="text-destructive" size={25} weight="duotone" />
            <strong className="text-sm font-semibold [letter-spacing:0]">无法读取历史对话</strong>
            <span className="max-w-[28ch] text-xs leading-5 text-muted-foreground">{error}</span>
            <Button className="mt-1" size="sm" type="button" variant="outline" onClick={() => void onRetry()}>
              重新加载
            </Button>
          </div>
        ) : hasLoaded && conversations.length === 0 ? (
          <div className="grid min-h-56 place-content-center justify-items-center gap-2 px-5 text-center">
            <ChatCircleDots aria-hidden className="text-muted-foreground" size={26} weight="duotone" />
            <strong className="text-sm font-semibold [letter-spacing:0]">还没有历史对话</strong>
            <span className="max-w-[28ch] text-xs leading-5 text-muted-foreground">
              发送第一条消息后，对话会自动保存在这里。
            </span>
            <Button className="mt-1" size="sm" type="button" onClick={onCreateConversation}>
              <Plus aria-hidden size={14} weight="bold" />
              开始新对话
            </Button>
          </div>
        ) : (
          <div className="grid gap-3">
            {groups.map((group) => {
              const groupId = `${titleId}-${group.key}`
              return (
                <section aria-labelledby={groupId} className="grid gap-0.5" key={group.key}>
                  <h3
                    className="m-0 px-2 pb-1 pt-2 text-[11px] font-semibold text-muted-foreground [letter-spacing:0]"
                    id={groupId}
                  >
                    {group.label}
                  </h3>
                  <ul className="m-0 grid list-none gap-0.5 p-0">
                    {group.conversations.map((conversation) => {
                      const current = currentConversationId === conversation.id
                      const renaming = renamingId === conversation.id
                      const busy = actionBusyId === conversation.id
                      return (
                        <li
                          className={cn(
                            'group grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center rounded-md border border-transparent transition-colors',
                            current && 'border-primary/20 bg-primary/7',
                            !current && 'hover:bg-muted/60',
                          )}
                          key={conversation.id}
                        >
                          {renaming ? (
                            <form className="col-span-2 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5 p-1.5" onSubmit={(event) => void submitRename(event)}>
                              <div className="min-w-0">
                                <Input
                                  autoFocus
                                  aria-label="对话标题"
                                  aria-invalid={Boolean(renameError)}
                                  className="h-8 text-sm [letter-spacing:0]"
                                  disabled={busy}
                                  maxLength={80}
                                  value={renameDraft}
                                  onChange={(event) => {
                                    setRenameDraft(event.target.value)
                                    setRenameError('')
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Escape') {
                                      event.preventDefault()
                                      event.stopPropagation()
                                      cancelRename()
                                    }
                                  }}
                                />
                                {renameError ? (
                                  <span className="mt-1 block text-[11px] leading-4 text-destructive" role="alert">
                                    {renameError}
                                  </span>
                                ) : null}
                              </div>
                              <Button
                                aria-label="保存标题"
                                disabled={busy || !renameDraft.trim()}
                                size="icon-sm"
                                title="保存"
                                type="submit"
                                variant="ghost"
                              >
                                {busy
                                  ? <CircleNotch aria-hidden className="animate-spin" size={15} />
                                  : <Check aria-hidden size={15} weight="bold" />}
                              </Button>
                              <Button
                                aria-label="取消重命名"
                                disabled={busy}
                                size="icon-sm"
                                title="取消"
                                type="button"
                                variant="ghost"
                                onClick={cancelRename}
                              >
                                <X aria-hidden size={15} />
                              </Button>
                            </form>
                          ) : (
                            <>
                              <button
                                aria-current={current ? 'page' : undefined}
                                className="min-w-0 cursor-pointer border-0 bg-transparent px-2.5 py-2 text-left outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring"
                                type="button"
                                onClick={() => void onSelectConversation(conversation)}
                              >
                                <strong className="block overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold text-foreground [letter-spacing:0]">
                                  {conversation.title}
                                </strong>
                                <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
                                  <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                                    {conversationContextLabel(conversation)}
                                  </span>
                                  <span aria-hidden>·</span>
                                  {current ? (
                                    <>
                                      <span className="shrink-0 font-medium text-primary">当前</span>
                                      <span aria-hidden>·</span>
                                    </>
                                  ) : null}
                                  <time className="shrink-0 tabular-nums" dateTime={conversation.lastTurnAt}>
                                    {formatConversationTime(conversation.lastTurnAt)}
                                  </time>
                                </span>
                              </button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    aria-label={`管理对话：${conversation.title}`}
                                    className="mr-1 opacity-70 group-hover:opacity-100 focus-visible:opacity-100"
                                    disabled={busy}
                                    size="icon-sm"
                                    title="更多操作"
                                    type="button"
                                    variant="ghost"
                                  >
                                    <DotsThree aria-hidden size={17} weight="bold" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onSelect={() => beginRename(conversation)}>
                                    <PencilSimple aria-hidden />
                                    重命名
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onSelect={() => requestDelete(conversation)}
                                  >
                                    <Trash aria-hidden />
                                    删除对话
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })}

            {nextCursor ? (
              <Button
                className="mx-auto mt-1"
                disabled={loadingMore}
                size="sm"
                type="button"
                variant="ghost"
                onClick={() => void onLoadMore()}
              >
                {loadingMore ? <CircleNotch aria-hidden className="animate-spin" /> : null}
                {loadingMore ? '正在加载…' : '加载更早对话'}
              </Button>
            ) : null}
          </div>
        )}
      </div>

      <ConfirmActionDialog
        key={deleteTarget?.id}
        actionKey={`delete-conversation:${deleteTarget?.id}`}
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title={`删除对话“${deleteTarget?.title ?? ''}”？`}
        description="聊天记录和未确认的待办提案将永久删除。正在处理的对话将停止；已保存的文档和已确认的待办保留。"
        confirmLabel="删除对话"
        onConfirm={confirmDelete}
      />

    </nav>
  )
}

function conversationContextLabel(conversation: AiConversationListItem) {
  if (conversation.contextType === 'project') {
    return conversation.projectName || '项目对话'
  }
  if (conversation.contextType === 'conversation-analysis') return '对话分析'
  return '通用对话'
}

function formatConversationTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
  }).format(date)
}

function actionErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}
