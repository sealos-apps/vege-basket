import { useRef, useState } from 'react'
import { ImageSquare, UploadSimple, X } from '@phosphor-icons/react'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog'
import { executionImageLimits, validateExecutionImages, type ExecutionImage } from './data'

function imageFromFile(file: File): ExecutionImage {
  return {
    id: crypto.randomUUID(),
    name: file.name || '执行截图',
    size: file.size,
    src: URL.createObjectURL(file),
    type: file.type as ExecutionImage['type'],
  }
}

export function ExecutionImageEditor({ disabled = false, images, onChange }: {
  disabled?: boolean
  images: ExecutionImage[]
  onChange: (images: ExecutionImage[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<ExecutionImage>()

  function addFiles(files: File[]) {
    if (disabled || !files.length) return
    const validationError = validateExecutionImages(images, files)
    if (validationError) {
      setError(validationError)
      return
    }
    setError('')
    onChange([...images, ...files.map(imageFromFile)])
  }

  function pastedFiles(event: React.ClipboardEvent<HTMLElement>) {
    const files = Array.from(event.clipboardData.items)
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((file): file is File => Boolean(file))
    if (!files.length) return
    event.preventDefault()
    addFiles(files)
  }

  return <section className="proto-image-editor">
    <div className="proto-image-editor-heading">
      <div><strong>执行截图（选填）</strong><small>最多 {executionImageLimits.maxCount} 张，单张 10 MiB，总计 30 MiB</small></div>
      <Button type="button" variant="outline" disabled={disabled || images.length >= executionImageLimits.maxCount} onClick={() => inputRef.current?.click()}><UploadSimple />添加截图</Button>
    </div>
    <div
      className={dragging ? 'proto-image-dropzone dragging' : 'proto-image-dropzone'}
      role="group"
      tabIndex={disabled ? -1 : 0}
      aria-label="添加执行截图，可点击、粘贴或拖入图片"
      onClick={() => !disabled && inputRef.current?.click()}
      onPaste={pastedFiles}
      onDragEnter={event => { event.preventDefault(); if (!disabled) setDragging(true) }}
      onDragOver={event => event.preventDefault()}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }}
      onDrop={event => { event.preventDefault(); setDragging(false); addFiles(Array.from(event.dataTransfer.files)) }}
    >
      {images.length ? <div className="proto-image-grid" onClick={event => event.stopPropagation()}>{images.map((image, index) => <figure key={image.id}>
        <button type="button" aria-label={`预览执行截图 ${index + 1}`} onClick={() => setPreview(image)}><img src={image.src} alt={image.name} /></button>
        <button type="button" className="proto-image-remove" aria-label={`删除执行截图 ${index + 1}`} disabled={disabled} onClick={() => { if (image.src.startsWith('blob:')) URL.revokeObjectURL(image.src); onChange(images.filter(item => item.id !== image.id)) }}><X /></button>
        <figcaption title={image.name}>{image.name}</figcaption>
      </figure>)}</div> : <div className="proto-image-dropzone-empty"><ImageSquare /><strong>粘贴或拖入执行截图</strong><span>支持 PNG、JPEG、WebP、GIF</span></div>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <input ref={inputRef} hidden multiple type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; addFiles(files) }} />
    <Dialog open={Boolean(preview)} onOpenChange={open => { if (!open) setPreview(undefined) }}><DialogContent className="proto-image-preview" showCloseButton={false}><DialogTitle>执行截图预览</DialogTitle>{preview && <div><img src={preview.src} alt={preview.name} /><Button type="button" variant="outline" onClick={() => setPreview(undefined)}>关闭</Button></div>}</DialogContent></Dialog>
  </section>
}

export function ExecutionImageGallery({ images = [] }: { images?: ExecutionImage[] }) {
  const [preview, setPreview] = useState<ExecutionImage>()
  if (!images.length) return null
  return <>
    <div className="proto-history-images" role="group" aria-label={`执行截图 ${images.length} 张`}>{images.map((image, index) => <figure key={image.id}>
      <button type="button" aria-label={`预览执行截图 ${index + 1}`} onClick={() => setPreview(image)}><img src={image.src} alt={image.name} /></button>
      <figcaption>{image.name}</figcaption>
    </figure>)}</div>
    <Dialog open={Boolean(preview)} onOpenChange={open => { if (!open) setPreview(undefined) }}><DialogContent className="proto-image-preview" showCloseButton={false}><DialogTitle>执行截图预览</DialogTitle>{preview && <div><img src={preview.src} alt={preview.name} /><Button type="button" variant="outline" onClick={() => setPreview(undefined)}>关闭</Button></div>}</DialogContent></Dialog>
  </>
}
