import { CheckCircle, Megaphone, WarningCircle } from '@phosphor-icons/react'
import type { ChangelogEntry } from '@/types'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { MarkdownPreview } from './markdown-preview'

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
})

export function ChangelogAnnouncementDialog({
  busy,
  entry,
  error,
  onAcknowledge,
  open,
  unreadCount,
}: {
  busy: boolean
  entry: ChangelogEntry | null
  error: string
  onAcknowledge: () => void
  open: boolean
  unreadCount: number
}) {
  return (
    <Dialog open={open}>
      <DialogContent
        className="changelog-announcement-dialog"
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        {entry ? (
          <>
            <DialogHeader className="changelog-announcement-header">
              <span className="changelog-announcement-icon" aria-hidden>
                <Megaphone size={22} weight="duotone" />
              </span>
              <div>
                <div className="changelog-announcement-meta">
                  {entry.version ? <span>{entry.version}</span> : null}
                  <time dateTime={entry.publishedAt}>{dateFormatter.format(new Date(entry.publishedAt))}</time>
                </div>
                <DialogTitle>{entry.title}</DialogTitle>
                <DialogDescription>Veges 更新公告</DialogDescription>
              </div>
            </DialogHeader>
            <div className="changelog-announcement-content">
              <MarkdownPreview content={entry.content} />
            </div>
            {error ? <p className="form-error"><WarningCircle size={16} /> {error}</p> : null}
            <DialogFooter className="changelog-announcement-footer">
              <p>{unreadCount > 1 ? `本次已包含 ${unreadCount} 条未读更新。` : '确认后，本公告将不再展示。'}</p>
              <Button type="button" disabled={busy} onClick={onAcknowledge}>
                <CheckCircle size={17} weight="bold" />
                {busy ? '正在确认...' : '我已读'}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
