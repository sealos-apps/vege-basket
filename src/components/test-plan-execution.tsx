import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { Check, ImageSquare, NotePencil, UploadSimple, X } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { uploadTestPlanExecutionImage } from '@/api'
import { appendTestPlanExecution } from '@/test-workbench-api'
import type { TestPlan, TestPlanCase, TestPlanExecutionImage, TestResult, TestWorkbenchData } from '@/test-workbench-types'

const imageLimits = { maxCount: 6, maxTotalBytes: 30 * 1024 * 1024 } as const
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const resultLabels: Record<TestResult, string> = { untested: '未执行', passed: '通过', failed: '失败', blocked: '阻塞', skipped: '跳过' }

type DraftImage = TestPlanExecutionImage & { objectKey?: string; uploading?: boolean }

function formatExecutionTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function formatMiB(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} MiB`
}

function imageError(existing: DraftImage[], files: File[], maxFileBytes: number) {
  if (!files.length) return '请选择图片。'
  if (existing.length + files.length > imageLimits.maxCount) return `每条执行记录最多上传 ${imageLimits.maxCount} 张图片。`
  const unsupported = files.find((file) => !imageTypes.has(file.type))
  if (unsupported) return `“${unsupported.name}”格式不支持，请选择 PNG、JPEG、WebP 或 GIF 图片。`
  const oversized = files.find((file) => file.size > maxFileBytes)
  if (oversized) return `“${oversized.name}”超过 ${formatMiB(maxFileBytes)}，请压缩后重试。`
  if ([...existing, ...files.map((file) => ({ size: file.size }))].reduce((sum, item) => sum + item.size, 0) > imageLimits.maxTotalBytes) {
    return '本条执行记录的图片总大小不能超过 30 MiB。'
  }
  return ''
}

function ExecutionImages({ images, disabled, onRemove, onPreview }: {
  disabled?: boolean
  images: DraftImage[]
  onPreview: (image: DraftImage) => void
  onRemove?: (image: DraftImage) => void
}) {
  return <div className="test-plan-execution-images" aria-label={`执行截图 ${images.length} 张`}>
    {images.map((image, index) => <figure key={image.id} className="test-plan-execution-image">
      <button type="button" aria-label={`预览执行截图 ${index + 1}`} onClick={(event) => { event.stopPropagation(); onPreview(image) }} disabled={!image.src}>
        <img src={image.src} alt={image.name} />
        {image.uploading ? <span>上传中</span> : null}
      </button>
      {onRemove ? <button type="button" aria-label={`删除执行截图 ${index + 1}`} onClick={(event) => { event.stopPropagation(); onRemove(image) }} disabled={disabled || image.uploading}><X /></button> : null}
      <figcaption title={image.name}>{image.name}</figcaption>
    </figure>)}
  </div>
}

export function TestPlanExecutionPanel({ plan, planCase, commit, maxImageBytes: configuredMaxImageBytes }: {
  commit: (operation: () => Promise<TestWorkbenchData>) => Promise<boolean>
  maxImageBytes?: number
  plan: TestPlan
  planCase: TestPlanCase
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const objectUrlsRef = useRef<string[]>([])
  const [tab, setTab] = useState<'history' | 'record'>('history')
  const [result, setResult] = useState<TestResult>(planCase.result === 'untested' ? 'passed' : planCase.result)
  const [actualResult, setActualResult] = useState('')
  const [note, setNote] = useState('')
  const [images, setImages] = useState<DraftImage[]>([])
  const [preview, setPreview] = useState<TestPlanExecutionImage | undefined>()
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const history = planCase.executions ?? []
  const maxImageBytes = Math.max(1, Math.min(configuredMaxImageBytes ?? 10 * 1024 * 1024, imageLimits.maxTotalBytes))
  const usedImageBytes = images.reduce((total, image) => total + image.size, 0)
  const remainingImageBytes = Math.max(0, imageLimits.maxTotalBytes - usedImageBytes)
  const remainingImageCount = Math.max(0, imageLimits.maxCount - images.length)

  useEffect(() => () => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  async function addFiles(files: File[]) {
    if (saving || images.some((image) => image.uploading) || !files.length) return
    const currentImageBytes = images.reduce((total, image) => total + image.size, 0)
    const validation = imageError(images, files, Math.min(maxImageBytes, Math.max(0, imageLimits.maxTotalBytes - currentImageBytes)))
    if (validation) { setError(validation); return }
    setError('')
    const pending = files.map((file) => {
      const src = URL.createObjectURL(file)
      objectUrlsRef.current.push(src)
      return { id: Math.round(Math.random() * Number.MAX_SAFE_INTEGER), name: file.name || '执行截图', size: file.size, src, type: file.type as DraftImage['type'], uploading: true, file }
    })
    setImages((current) => [...current, ...pending])
    try {
      const uploads = await Promise.all(files.map(uploadTestPlanExecutionImage))
      setImages((current) => current.map((image) => {
        const index = pending.findIndex((candidate) => candidate.id === image.id)
        const uploaded = uploads[index]
        return uploaded ? { ...image, objectKey: uploaded.objectKey, src: uploaded.imageUrl, type: uploaded.contentType, uploading: false } : image
      }))
      pending.forEach((item) => URL.revokeObjectURL(item.src))
    } catch (uploadError) {
      setImages((current) => current.filter((image) => !pending.some((item) => item.id === image.id)))
      setError(uploadError instanceof Error ? uploadError.message : '执行截图上传失败，请稍后重试。')
    }
  }

  function paste(event: ClipboardEvent<HTMLElement>) {
    const files = Array.from(event.clipboardData.items).filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter((file): file is File => Boolean(file))
    if (!files.length) return
    event.preventDefault()
    void addFiles(files)
  }

  function drop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    void addFiles(Array.from(event.dataTransfer.files))
  }

  async function save() {
    if (saving || images.some((image) => image.uploading || !image.objectKey)) return
    setSaving(true); setError(''); setSaved(false)
    try {
      const success = await commit(() => appendTestPlanExecution(plan.testSpaceId, planCase.id, {
        actualResult,
        clientId: crypto.randomUUID(),
        images: images.map((image) => ({ contentType: image.type, fileName: image.name, fileSize: image.size, objectKey: image.objectKey! })),
        note,
        result,
      }))
      if (!success) throw new Error('保存失败，填写内容已保留。')
      setActualResult(''); setNote(''); setImages([]); setSaved(true); setTab('history')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败，填写内容已保留。')
    } finally {
      setSaving(false)
    }
  }

  return <div className="test-plan-execution-panel">
    <Tabs value={tab} onValueChange={(value) => setTab(value as 'history' | 'record')}>
      <TabsList aria-label="用例执行"><TabsTrigger value="history">执行历史 ({history.length})</TabsTrigger><TabsTrigger value="record">记录执行</TabsTrigger></TabsList>
      {saved ? <p className="test-plan-execution-success" role="status"><Check />执行记录已保存，最终结果：{resultLabels[planCase.result]}</p> : null}
      <TabsContent value="history">
        {history.length ? <div className="test-plan-execution-history">{[...history].reverse().map((record, index) => <article key={record.id}>
          <header><div><Badge variant="outline" className={`test-execution-result-badge test-execution-result-${record.result}`}>{resultLabels[record.result]}</Badge><strong className="test-execution-history-index">第 {history.length - index} 次记录</strong>{index === 0 ? <span className="test-execution-history-latest">最新</span> : null}</div><small>{record.actorName || '未知执行人'} · {formatExecutionTime(record.executedAt)}</small></header>
          <dl><dt>实际结果</dt><dd>{record.actualResult || '未填写'}</dd><dt>执行备注</dt><dd>{record.note || '未填写'}</dd></dl>
          {record.images.length ? <ExecutionImages images={record.images} onPreview={setPreview} /> : null}
        </article>)}</div> : <div className="test-plan-execution-empty"><strong>暂无执行记录</strong><p>{planCase.result === 'untested' ? '该用例尚未执行。' : `历史结果：${resultLabels[planCase.result]}，原执行人及时间未记录。`}</p></div>}
        <Button variant="outline" onClick={() => setTab('record')}><NotePencil />记录下一次执行</Button>
      </TabsContent>
      <TabsContent value="record">
        <div className="test-plan-execution-form">
          <div className="test-plan-execution-form-heading"><strong>第 {history.length + 1} 次记录</strong><span>保存后由最新记录决定最终结果</span></div>
          <Label>执行结果<Select value={result} onValueChange={(value) => setResult(value as TestResult)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(resultLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Label>
          <Label>实际结果（选填）<Textarea maxLength={10000} value={actualResult} onChange={(event) => setActualResult(event.target.value)} /></Label>
          <Label>执行备注（选填）<Textarea maxLength={5000} value={note} onChange={(event) => setNote(event.target.value)} /></Label>
          <section className="test-plan-execution-image-editor">
            <div><div><strong>执行截图（选填）</strong><small>最多 {imageLimits.maxCount} 张，剩余 {remainingImageCount} 张；已用 {formatMiB(usedImageBytes)} / {formatMiB(imageLimits.maxTotalBytes)}，剩余 {formatMiB(remainingImageBytes)}；单张上限 {formatMiB(Math.min(maxImageBytes, remainingImageBytes))}</small></div><Button type="button" variant="outline" disabled={saving || images.length >= imageLimits.maxCount || remainingImageBytes === 0} onClick={() => inputRef.current?.click()}><UploadSimple />添加截图</Button></div>
            <div className="test-plan-execution-dropzone" role="group" tabIndex={saving || images.some((image) => image.uploading) || !remainingImageCount || !remainingImageBytes ? -1 : 0} aria-label="添加执行截图，可点击、粘贴或拖入图片" onClick={() => !saving && !images.some((image) => image.uploading) && remainingImageCount > 0 && remainingImageBytes > 0 && inputRef.current?.click()} onPaste={paste} onDragOver={(event) => event.preventDefault()} onDrop={drop}>
              {images.length ? <ExecutionImages images={images} disabled={saving} onPreview={setPreview} onRemove={(image) => setImages((current) => current.filter((item) => item.id !== image.id))} /> : <div><ImageSquare /><strong>粘贴或拖入执行截图</strong><span>支持 PNG、JPEG、WebP、GIF</span></div>}
            </div>
            <input ref={inputRef} hidden multiple type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void addFiles(files) }} />
          </section>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <footer><span>当前最终结果：{resultLabels[planCase.result]}</span><Button type="button" disabled={saving || images.some((image) => image.uploading)} onClick={() => void save()}><Check />{saving ? '保存中' : '保存执行记录'}</Button></footer>
        </div>
      </TabsContent>
    </Tabs>
    <Dialog open={Boolean(preview)} onOpenChange={(open) => { if (!open) setPreview(undefined) }}><DialogContent className="test-plan-execution-preview" showCloseButton={false}><DialogTitle>执行截图预览</DialogTitle>{preview ? <div><img src={preview.src} alt={preview.name} /><Button variant="outline" onClick={() => setPreview(undefined)}>关闭</Button></div> : null}</DialogContent></Dialog>
  </div>
}
