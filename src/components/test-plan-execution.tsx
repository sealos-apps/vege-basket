import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { ArrowLeft, Check, DownloadSimple, ImageSquare, NotePencil, UploadSimple, X } from '@phosphor-icons/react'
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

const imageLimits = { maxCount: 6, maxFileBytes: 10 * 1024 * 1024, maxTotalBytes: 30 * 1024 * 1024 } as const
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const resultLabels: Record<TestResult, string> = { untested: '未执行', passed: '通过', failed: '失败', blocked: '阻塞', skipped: '跳过' }
const printImageTimeoutMs = 2500

type DraftImage = TestPlanExecutionImage & { objectKey?: string; uploading?: boolean }

function formatExecutionTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function waitForPrintImage(image: HTMLImageElement) {
  if (image.complete) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    const finish = (loaded: boolean) => {
      window.clearTimeout(timer)
      image.removeEventListener('load', onLoad)
      image.removeEventListener('error', onError)
      resolve(loaded)
    }
    const onLoad = () => finish(true)
    const onError = () => finish(false)
    image.addEventListener('load', onLoad, { once: true })
    image.addEventListener('error', onError, { once: true })
    const timer = window.setTimeout(() => finish(false), printImageTimeoutMs)
  })
}

function imageError(existing: DraftImage[], files: File[]) {
  if (!files.length) return '请选择图片。'
  if (existing.length + files.length > imageLimits.maxCount) return `每条执行记录最多上传 ${imageLimits.maxCount} 张图片。`
  const unsupported = files.find((file) => !imageTypes.has(file.type))
  if (unsupported) return `“${unsupported.name}”格式不支持，请选择 PNG、JPEG、WebP 或 GIF 图片。`
  const oversized = files.find((file) => file.size > imageLimits.maxFileBytes)
  if (oversized) return `“${oversized.name}”超过 10 MiB，请压缩后重试。`
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

export function TestPlanExecutionPanel({ plan, planCase, commit }: {
  commit: (operation: () => Promise<TestWorkbenchData>) => Promise<boolean>
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

  useEffect(() => () => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  async function addFiles(files: File[]) {
    if (saving || !files.length) return
    const validation = imageError(images, files)
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
          <header><div><Badge variant="outline">{resultLabels[record.result]}</Badge><strong>第 {history.length - index} 次记录</strong>{index === 0 ? <span>最新</span> : null}</div><small>{record.actorName || '未知执行人'} · {formatExecutionTime(record.executedAt)}</small></header>
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
            <div><div><strong>执行截图（选填）</strong><small>最多 6 张，单张 10 MiB，总计 30 MiB</small></div><Button type="button" variant="outline" disabled={saving || images.length >= imageLimits.maxCount} onClick={() => inputRef.current?.click()}><UploadSimple />添加截图</Button></div>
            <div className="test-plan-execution-dropzone" role="group" tabIndex={saving ? -1 : 0} aria-label="添加执行截图，可点击、粘贴或拖入图片" onClick={() => !saving && inputRef.current?.click()} onPaste={paste} onDragOver={(event) => event.preventDefault()} onDrop={drop}>
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

export function TestPlanExecutionReport({ plan, planCases, onClose }: {
  onClose: () => void
  plan: TestPlan
  planCases: TestPlanCase[]
}) {
  const counts = Object.keys(resultLabels).map((result) => ({ label: resultLabels[result as TestResult], result: result as TestResult, total: planCases.filter((item) => item.result === result).length }))
  const [printing, setPrinting] = useState(false)
  const [printStatus, setPrintStatus] = useState('')
  async function printReport() {
    if (printing) return
    setPrinting(true)
    setPrintStatus('正在准备 PDF，图片加载最长等待 2.5 秒。')
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    const images = Array.from(document.querySelectorAll<HTMLImageElement>('.test-plan-execution-report-images img'))
    const loaded = await Promise.all(images.map(waitForPrintImage))
    loaded.forEach((ready, index) => {
      if (!ready) images[index].removeAttribute('src')
    })
    if (loaded.some((item) => !item)) setPrintStatus('部分截图加载超时，已继续导出文字和已加载内容。')
    try {
      window.print()
    } finally {
      setPrinting(false)
      if (!loaded.some((item) => !item)) setPrintStatus('已打开系统打印窗口。')
    }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}><DialogContent className="test-plan-execution-report" showCloseButton={false} aria-describedby={undefined}>
    <header className="test-plan-execution-report-toolbar"><Button variant="ghost" onClick={onClose}><ArrowLeft />返回测试计划</Button><div><strong>执行文档预览</strong><Badge variant="outline">全计划 · {planCases.length} 个用例</Badge></div><Button disabled={printing} onClick={() => void printReport()}><DownloadSimple />{printing ? '准备导出…' : '打印 / 保存 PDF'}</Button></header>
    {printStatus ? <p className="test-plan-execution-print-status" role="status" aria-live="polite">{printStatus}</p> : null}
    <main className="test-plan-execution-report-paper"><div className="test-plan-execution-report-brand"><strong>Veges</strong><span>测试执行文档</span></div><code>PLAN-{plan.id}</code><h1>{plan.name}</h1><p>执行环境：{plan.environment || '未设置'} · 版本：{plan.versionLabel || '未设置'}</p><p>导出范围：全计划 {planCases.length} 个用例，含未执行用例</p>
      <h2>结果汇总</h2><div className="test-plan-execution-report-counts">{counts.map((item) => <div key={item.result}><strong>{item.total}</strong><span>{item.label}</span></div>)}</div>
      {planCases.map((item) => <section className="test-plan-execution-report-case" key={item.id}><code>CASE-{item.testCaseId ?? 'SNAPSHOT'}</code><h2>{item.snapshotTitle}</h2><p><strong>最终结果：{resultLabels[item.result]}</strong></p><dl><dt>前置条件</dt><dd>{item.snapshotPreconditions || '未填写'}</dd><dt>测试步骤</dt><dd>{item.snapshotSteps || '未填写'}</dd><dt>预期结果</dt><dd>{item.snapshotExpectedResult || '未填写'}</dd></dl><h3>执行记录（{item.executions?.length ?? 0}）</h3>{item.executions?.length ? [...item.executions].sort((a, b) => a.id - b.id).map((record) => <article key={record.id}><strong>{resultLabels[record.result]}</strong><span>{record.actorName || '未知执行人'} · {formatExecutionTime(record.executedAt)}</span><p>{record.actualResult || '未填写'}</p><p>{record.note || '未填写'}</p>{record.images.length ? <div className="test-plan-execution-report-images">{record.images.map((image) => <img key={image.id} src={image.src} alt={image.name} />)}</div> : null}</article>) : <p>暂无可追溯执行记录。</p>}</section>)}
    </main>
  </DialogContent></Dialog>
}
