import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  CaretDown,
  FileText,
  PencilSimple,
  WarningCircle,
} from '@phosphor-icons/react'
import type { ChangelogEntry } from '@/types'
import {
  createChangelogEntry,
  fetchChangelog,
  formatApiErrorDiagnostic,
  updateChangelogEntry,
} from '@/api'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { MarkdownPreview } from './markdown-preview'
import { MarkdownWysiwygEditor } from './markdown-wysiwyg-editor'

type EditorMode = 'create' | 'edit'

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  day: '2-digit',
  hour: '2-digit',
  hour12: false,
  minute: '2-digit',
  month: '2-digit',
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
})

function formatChangelogDate(value: string) {
  return dateFormatter.format(new Date(value)).replace(/\//g, '-')
}

function getExcerpt(content: string) {
  const plainText = content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[-#>*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plainText.length > 160 ? `${plainText.slice(0, 157)}...` : plainText
}

export function ChangelogWorkbench({
  createRequest = 0,
  onBack,
  onCanManageChange,
  onEditorModeChange,
}: {
  createRequest?: number
  onBack?: () => void
  onCanManageChange?: (canManage: boolean) => void
  onEditorModeChange?: (open: boolean) => void
}) {
  const [entries, setEntries] = useState<ChangelogEntry[]>([])
  const [canManage, setCanManage] = useState(false)
  const [expandedEntryId, setExpandedEntryId] = useState<number | null>(null)
  const [editorMode, setEditorMode] = useState<EditorMode | null>(null)
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
  const [versionDraft, setVersionDraft] = useState('')
  const [contentDraft, setContentDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    onCanManageChange?.(false)
    fetchChangelog()
      .then((result) => {
        if (!alive) return
        setEntries(result.entries)
        setCanManage(result.canManage)
        onCanManageChange?.(result.canManage)
      })
      .catch((loadError) => {
        if (alive) setError(formatApiErrorDiagnostic(loadError, '更新日志加载失败，请稍后重试。'))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [onCanManageChange])

  useEffect(() => {
    onEditorModeChange?.(Boolean(editorMode))
    return () => onEditorModeChange?.(false)
  }, [editorMode, onEditorModeChange])

  useEffect(() => {
    if (createRequest === 0 || !canManage) return
    setEditorMode('create')
    setEditingEntryId(null)
    setTitleDraft('')
    setVersionDraft('')
    setContentDraft('')
    setError('')
  }, [canManage, createRequest])

  const expandedEntry = useMemo(
    () => entries.find((entry) => entry.id === expandedEntryId) ?? null,
    [entries, expandedEntryId],
  )

  function openEditEditor(entry: ChangelogEntry) {
    setEditorMode('edit')
    setEditingEntryId(entry.id)
    setTitleDraft(entry.title)
    setVersionDraft(entry.version)
    setContentDraft(entry.content)
    setError('')
  }

  function closeEditor() {
    setEditorMode(null)
    setEditingEntryId(null)
    setError('')
  }

  async function saveEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const payload = {
      content: contentDraft,
      title: titleDraft,
      version: versionDraft,
    }
    if (!payload.title.trim() || !payload.content.trim()) {
      setError('请填写日志标题和正文。')
      return
    }
    setSaving(true)
    setError('')
    try {
      const result = editorMode === 'edit' && editingEntryId != null
        ? await updateChangelogEntry(editingEntryId, payload)
        : await createChangelogEntry(payload)
      setEntries((current) => editorMode === 'edit'
        ? current.map((entry) => entry.id === result.entry.id ? result.entry : entry)
        : [result.entry, ...current])
      setExpandedEntryId(result.entry.id)
      closeEditor()
    } catch (saveError) {
      setError(formatApiErrorDiagnostic(saveError, '更新日志保存失败，请稍后重试。'))
    } finally {
      setSaving(false)
    }
  }

  if (editorMode) {
    return (
      <section className="changelog-workbench is-editor">
        <div className="changelog-editor-header">
          <Button className="ghost-button" type="button" variant="outline" disabled={saving} onClick={closeEditor}>
            <ArrowLeft size={16} /> 返回更新日志
          </Button>
        </div>
        <Card className="panel changelog-editor-panel">
          <form className="changelog-editor-form" onSubmit={(event) => void saveEntry(event)}>
            <div className="changelog-editor-fields">
              <Label>
                日志标题
                <Input
                  maxLength={120}
                  placeholder="例如：Veges 1.2.0"
                  required
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                />
              </Label>
              <Label>
                版本号
                <Input
                  maxLength={40}
                  placeholder="例如：v1.2.0，可选"
                  value={versionDraft}
                  onChange={(event) => setVersionDraft(event.target.value)}
                />
              </Label>
            </div>
            <div className="changelog-editor-content-label">
              <span>更新内容</span>
              <MarkdownWysiwygEditor
                ariaLabel="更新日志正文"
                placeholder="记录本次更新的功能、修复和改进。"
                value={contentDraft}
                onChange={setContentDraft}
              />
            </div>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="changelog-editor-actions">
              <Button type="button" variant="outline" disabled={saving} onClick={closeEditor}>取消</Button>
              <Button className="solid-button" type="submit" disabled={saving}>
                {saving ? '保存中...' : '保存并发布'}
              </Button>
            </div>
          </form>
        </Card>
      </section>
    )
  }

  return (
    <section className="changelog-workbench">
      {onBack ? (
        <div className="changelog-editor-header">
          <Button className="ghost-button" type="button" variant="outline" onClick={onBack}>
            <ArrowLeft size={16} /> 返回测试工作台
          </Button>
        </div>
      ) : null}
      {loading ? (
        <Card className="panel changelog-state-panel"><p className="empty-state">正在加载更新日志...</p></Card>
      ) : error ? (
        <Card className="panel changelog-state-panel">
          <p className="form-error"><WarningCircle size={16} /> {error}</p>
        </Card>
      ) : entries.length === 0 ? (
        <Card className="panel changelog-state-panel">
          <FileText size={22} />
          <strong>还没有更新日志</strong>
          <p>Veges 的新功能和重要改进会记录在这里。</p>
        </Card>
      ) : (
        <Card className="panel changelog-list-panel">
          <div className="changelog-list" aria-label="更新日志列表">
            {entries.map((entry) => {
              const expanded = entry.id === expandedEntryId
              return (
                <article className={expanded ? 'changelog-entry is-expanded' : 'changelog-entry'} key={entry.id}>
                  <button
                    aria-expanded={expanded}
                    className="changelog-entry-trigger"
                    type="button"
                    onClick={() => setExpandedEntryId(expanded ? null : entry.id)}
                  >
                    <span className="changelog-entry-copy">
                      <span className="changelog-entry-meta">
                        {entry.version ? <span className="changelog-version">{entry.version}</span> : null}
                        <span>{formatChangelogDate(entry.publishedAt)}</span>
                      </span>
                      <strong>{entry.title}</strong>
                      <span className="changelog-entry-excerpt">{getExcerpt(entry.content)}</span>
                    </span>
                    <CaretDown className="changelog-entry-chevron" size={18} weight="bold" />
                  </button>
                  {expanded ? (
                    <div className="changelog-entry-detail">
                      <MarkdownPreview content={entry.content} />
                      {canManage ? (
                        <div className="changelog-entry-actions">
                          <Button className="ghost-button" type="button" variant="outline" onClick={() => openEditEditor(entry)}>
                            <PencilSimple size={16} /> 编辑日志
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        </Card>
      )}
      {expandedEntry ? <span className="sr-only">当前展开：{expandedEntry.title}</span> : null}
    </section>
  )
}
