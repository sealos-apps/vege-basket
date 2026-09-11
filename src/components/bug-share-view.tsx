import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Bug, ChatCircleDots, SignIn, SpinnerGap, X } from '@phosphor-icons/react'
import { addBugShareComment, fetchBugShare } from '../bug-share-api'
import type { BugShareView as BugShareData } from '../bug-share-types'
import type { AuthUser } from '../api'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { MentionTextarea } from './mention-textarea'
import { MarkdownPreview } from './markdown-preview'
import { UserName } from './user-name'

const statusLabels: Record<string, string> = {
  assigned: '已分配',
  closed: '已关闭',
  duplicate: '重复 Bug',
  in_progress: '处理中',
  new: '新建',
  pending_confirmation: '待确认',
  pending_verification: '待验证',
  reopened: '已重开',
  rejected: '已驳回',
}
const severityLabels: Record<string, string> = {
  blocker: '阻塞',
  critical: '严重',
  major: '主要',
  minor: '次要',
  trivial: '轻微',
}
const priorityLabels: Record<string, string> = { high: '高优先级', low: '低优先级', medium: '中优先级' }

function ShareText({ label, onPreviewImage, value }: { label: string; onPreviewImage: (image: { alt: string; src: string }) => void; value: string }) {
  const hasContent = Boolean(value.trim())
  return (
    <section className="bug-share-field">
      <h3>{label}</h3>
      {hasContent ? (
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
      ) : <div className="bug-share-plain-text">未填写</div>}
    </section>
  )
}

export function BugShareView({ authUser, onBack, onBackToVeges, onLogin, onOpenAssignedBug, token }: {
  authUser: AuthUser | null
  onBack?: () => void
  onBackToVeges?: () => void
  onLogin: () => void
  onOpenAssignedBug: (bugId: number, organizationId: number | null) => void
  token: string
}) {
  const [data, setData] = useState<BugShareData | null>(null)
  const [error, setError] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [previewImage, setPreviewImage] = useState<{ alt: string; src: string } | null>(null)
  const redirected = useRef(false)

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    setError('')
    fetchBugShare(token)
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
  }, [token, authUser?.id])

  useEffect(() => {
    if (
      !data ||
      !authUser ||
      data.viewer !== 'assignee' ||
      data.organizationId === undefined ||
      redirected.current
    ) return
    redirected.current = true
    onOpenAssignedBug(data.bugId, data.organizationId)
  }, [authUser, data, onOpenAssignedBug])

  async function submitComment(event: React.FormEvent) {
    event.preventDefault()
    if (!comment.trim() || busy) return
    setBusy(true)
    try {
      setData(await addBugShareComment(token, comment.trim()))
      setComment('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '评论发送失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  if (busy && !data) return <main className="bug-share-screen"><SpinnerGap className="spin" size={28} /><span>正在加载 Bug...</span></main>
  if (error && !data) return <main className="bug-share-screen"><Bug size={32} /><h1>这个分享链接暂时不可用</h1><p>{error}</p>{onBack ? <Button variant="outline" onClick={onBack}><ArrowLeft /> 返回</Button> : null}</main>

  return <main className="bug-share-screen">
    <div className="bug-share-shell">
      <header className="bug-share-header"><div><span className="eyebrow">Veges · Bug 分享</span><h1>{data?.title || 'Bug'}</h1><p>BUG-{data?.bugId} · {data?.testSpaceName || '测试工作台'}</p></div>{authUser && onBackToVeges ? <Button className="bug-share-return-button" variant="outline" onClick={onBackToVeges}><ArrowLeft /> 返回 Veges</Button> : onBack ? <Button variant="ghost" onClick={onBack}><ArrowLeft /> 返回</Button> : null}</header>
      {data ? <>
        <div className="bug-share-badges"><span>{statusLabels[data.status] || data.status}</span><span>{severityLabels[data.severity] || data.severity}</span><span>{priorityLabels[data.priority] || data.priority}</span>{data.projectName ? <span>{data.projectName}</span> : null}</div>
        <div className="bug-share-meta"><span>测试用例：{data.testCaseId ? `CASE-${data.testCaseId} ${data.testCaseTitle || ''}` : '待补关联'}</span><span>用例目录：{data.testCaseId ? data.testCaseFolderName || '未分类' : '待补关联'}</span>{data.testPlanName ? <span>测试计划：{data.testPlanName}</span> : null}{data.assigneeName ? <span>负责人：<UserName departedUserIds={data.departedUserIds} name={data.assigneeName} userId={data.assigneeUserId} /></span> : null}<span>更新时间：{new Date(data.updatedAt).toLocaleString()}</span></div>
        <div className="bug-share-fields"><ShareText label="环境" onPreviewImage={setPreviewImage} value={data.environment} /><ShareText label="复现步骤" onPreviewImage={setPreviewImage} value={data.reproductionSteps} /><ShareText label="预期结果" onPreviewImage={setPreviewImage} value={data.expectedResult} /><ShareText label="实际结果" onPreviewImage={setPreviewImage} value={data.actualResult} /></div>
        <section className="bug-share-comments"><div className="bug-share-section-title"><h2>评论</h2><span><ChatCircleDots /> {data.comments.length}</span></div>{data.comments.map((item) => <article key={item.id}><UserName departedUserIds={data.departedUserIds} name={item.authorName} userId={item.authorUserId} /><time>{new Date(item.createdAt).toLocaleString()}</time><div
          className="bug-share-comment-markdown bug-share-markdown"
          onClick={(event) => {
            const target = event.target
            if (target instanceof HTMLImageElement) {
              setPreviewImage({ alt: target.alt || '图片', src: target.currentSrc || target.src })
            }
          }}
        ><MarkdownPreview content={item.content} /></div></article>)}{authUser ? <form onSubmit={submitComment}><MentionTextarea aria-label="评论内容" members={data.mentionableMembers} menuClassName="bug-share-mention-menu" maxLength={5000} onChange={setComment} placeholder="写下你的评论，输入 @ 可提及组织成员。" value={comment} /><Button disabled={busy || !comment.trim()}>发表评论</Button></form> : <div className="bug-share-login-prompt"><span>登录后可以评论这个 Bug。</span><Button className="bug-share-login-button" variant="default" onClick={onLogin}><SignIn /> 登录</Button></div>}</section>
      </> : null}
      <Dialog open={Boolean(previewImage)} onOpenChange={(open) => { if (!open) setPreviewImage(null) }}>
        <DialogContent className="bug-share-image-preview-dialog" showCloseButton={false}>
          <DialogTitle className="bug-share-image-preview-title">图片预览</DialogTitle>
          {previewImage ? <div className="bug-share-image-preview-shell">
            <img className="bug-share-image-preview" src={previewImage.src} alt={previewImage.alt} />
            <button aria-label="关闭图片预览" className="bug-share-image-preview-close" type="button" onClick={() => setPreviewImage(null)}><X size={18} /></button>
          </div> : null}
        </DialogContent>
      </Dialog>
    </div>
  </main>
}
