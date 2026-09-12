import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChatCircleDots, CheckSquare, SignIn, SpinnerGap, X } from '@phosphor-icons/react'
import { addTodoShareComment, fetchTodoShare } from '../todo-share-api'
import type { TodoShareView as TodoShareData } from '../todo-share-types'
import type { AuthUser } from '../api'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { MentionTextarea } from './mention-textarea'
import { MarkdownPreview } from './markdown-preview'
import { UserName } from './user-name'

const priorityLabels: Record<string, string> = { high: '高优先级', low: '低优先级', medium: '中优先级' }
const confirmationLabels: Record<string, string> = {
  acceptance_failed: '验收未通过',
  confirmed: '已确认',
  pending_review: '待验收',
  rejected: '已驳回',
}

function TodoShareMarkdown({ onPreviewImage, value }: {
  onPreviewImage: (image: { alt: string; src: string }) => void
  value: string
}) {
  return value.trim() ? (
    <div
      className="bug-share-markdown"
      onClick={(event) => {
        const target = event.target
        if (target instanceof HTMLImageElement) {
          onPreviewImage({ alt: target.alt || '图片', src: target.currentSrc || target.src })
        }
      }}
    >
      <MarkdownPreview content={value} />
    </div>
  ) : <div className="bug-share-plain-text">未填写</div>
}

export function TodoShareView({ authUser, onBackToShare, onLogin, onOpenTodo, token }: {
  authUser: AuthUser | null
  onBackToShare?: () => void
  onLogin: () => void
  onOpenTodo: (todoId: number) => void
  token: string
}) {
  const [data, setData] = useState<TodoShareData | null>(null)
  const [error, setError] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [previewImage, setPreviewImage] = useState<{ alt: string; src: string } | null>(null)
  const commentRequestRef = useRef<{ content: string; id: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    setError('')
    fetchTodoShare(token)
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '分享链接不可用。')
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => { cancelled = true }
  }, [authUser?.id, token])

  async function submitComment(event: React.FormEvent) {
    event.preventDefault()
    const content = comment.trim()
    if (!content || busy) return
    const request = commentRequestRef.current?.content === content
      ? commentRequestRef.current
      : { content, id: crypto.randomUUID() }
    commentRequestRef.current = request
    setBusy(true)
    setError('')
    try {
      await addTodoShareComment(token, content, request.id)
      commentRequestRef.current = null
      setComment('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '留言发送失败，请稍后重试。')
      setBusy(false)
      return
    }
    try {
      setData(await fetchTodoShare(token))
    } catch {
      setError('留言已保存，但列表刷新失败。')
    } finally {
      setBusy(false)
    }
  }

  if (busy && !data) {
    return <main className="bug-share-screen"><SpinnerGap className="spin" size={28} /><span>正在加载待办...</span></main>
  }
  if (error && !data) {
    return <main className="bug-share-screen"><CheckSquare size={32} /><h1>这个分享链接暂时不可用</h1><p>{error}</p></main>
  }

  return (
    <main className="bug-share-screen todo-share-screen">
      <div className="bug-share-shell todo-share-shell">
        <header className="bug-share-header">
          <div>
            <span className="eyebrow">Veges · 待办分享</span>
            <h1>{data?.title || '待办'}</h1>
            <p>TODO-{data?.todoId} · {data?.projectName || '项目待办'}{data?.subprojectName ? ` / ${data.subprojectName}` : ''}</p>
          </div>
          {data?.viewer === 'member' ? (
            <Button className="bug-share-return-button" variant="outline" onClick={() => onOpenTodo(data.todoId)}>
              <ArrowLeft /> 在 Veges 打开
            </Button>
          ) : onBackToShare ? (
            <Button variant="ghost" onClick={onBackToShare}><ArrowLeft /> 返回分享</Button>
          ) : null}
        </header>
        {data ? (
          <>
            <div className="bug-share-badges">
              <span>{data.done ? '已完成' : '未完成'}</span>
              <span>{confirmationLabels[data.confirmationStatus] || data.confirmationStatus}</span>
              <span>{priorityLabels[data.priority] || data.priority}</span>
              {data.moduleName ? <span>{data.moduleName}</span> : null}
            </div>
            <div className="bug-share-meta">
              <span>创建人：<UserName departedUserIds={data.departedUserIds} name={data.creatorName} userId={data.creatorUserId} /></span>
              {data.assigneeName ? <span>负责人：<UserName departedUserIds={data.departedUserIds} name={data.assigneeName} userId={data.assigneeUserId} /></span> : null}
              {data.reviewerName ? <span>验收人：<UserName departedUserIds={data.departedUserIds} name={data.reviewerName} userId={data.reviewerUserId} /></span> : null}
              {data.watcherNames.length > 0 ? <span>关注人：{data.watcherNames.join('、')}</span> : null}
              <span>截止日期：{data.dueDate}</span>
              <span>更新时间：{new Date(data.updatedAt).toLocaleString()}</span>
            </div>
            <section className="bug-share-field todo-share-detail">
              <h3>待办详情</h3>
              <TodoShareMarkdown onPreviewImage={setPreviewImage} value={data.detail} />
            </section>
            <section className="bug-share-comments">
              <div className="bug-share-section-title">
                <h2>留言备注</h2>
                <span><ChatCircleDots /> {data.notes.length}</span>
              </div>
              {data.notes.length === 0 ? <p className="bug-share-empty">还没有留言备注。</p> : null}
              {data.notes.map((note) => (
                <article key={note.id}>
                  <UserName departedUserIds={data.departedUserIds} name={note.authorName} userId={note.authorUserId} />
                  {note.kind === 'acceptance' ? <span className="todo-share-note-kind">验收备注</span> : null}
                  <time>{new Date(note.createdAt).toLocaleString()}</time>
                  <div className="bug-share-comment-markdown">
                    {note.fromShare
                      ? <p className="todo-share-comment-text">{note.content}</p>
                      : <TodoShareMarkdown onPreviewImage={setPreviewImage} value={note.content} />}
                  </div>
                </article>
              ))}
              {authUser ? (
                <form onSubmit={submitComment}>
                  <MentionTextarea
                    aria-label="留言内容"
                    members={data.mentionableMembers}
                    menuClassName="bug-share-mention-menu"
                    maxLength={5000}
                    onChange={setComment}
                    placeholder="写下留言备注，输入 @ 可提及项目成员。"
                    value={comment}
                  />
                  <Button disabled={busy || !comment.trim()}>添加留言</Button>
                </form>
              ) : (
                <div className="bug-share-login-prompt">
                  <span>登录后可以留言备注。</span>
                  <Button className="bug-share-login-button" onClick={onLogin}><SignIn /> 登录</Button>
                </div>
              )}
              {error ? <p className="bug-share-error">{error}</p> : null}
            </section>
          </>
        ) : null}
        <Dialog open={Boolean(previewImage)} onOpenChange={(open) => { if (!open) setPreviewImage(null) }}>
          <DialogContent className="bug-share-image-preview-dialog" showCloseButton={false}>
            <DialogTitle className="bug-share-image-preview-title">图片预览</DialogTitle>
            {previewImage ? (
              <div className="bug-share-image-preview-shell">
                <img className="bug-share-image-preview" src={previewImage.src} alt={previewImage.alt} />
                <button aria-label="关闭图片预览" className="bug-share-image-preview-close" type="button" onClick={() => setPreviewImage(null)}><X size={18} /></button>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      </div>
    </main>
  )
}
