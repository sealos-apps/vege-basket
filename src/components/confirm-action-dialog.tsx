import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AlertDialog } from 'radix-ui'
import { SpinnerGap } from '@phosphor-icons/react'
import { isUncertainActionError, type ActionReconciliation } from '../confirmed-action'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'

// Keep unresolved writes blocked across cancel/reopen until a canonical page reload.
const unresolvedActions = new Set<string>()
const pendingActions = new Set<string>()

export type ConfirmActionOptions = {
  actionKey?: string
  title: string
  description: ReactNode
  confirmLabel: string
  variant?: 'default' | 'destructive'
  confirmationName?: string
}

type Props = ConfirmActionOptions & {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onConfirm: () => Promise<boolean>
  trigger?: ReactNode
  error?: string
  busy?: boolean
  confirmDisabled?: boolean
  children?: ReactNode
  reconcile?: () => Promise<ActionReconciliation>
}

export function ConfirmActionDialog({
  open: controlledOpen, onOpenChange, onConfirm, trigger, title, description,
  confirmLabel, variant = 'destructive', confirmationName, error: externalError,
  busy = false, reconcile, confirmDisabled = false, children, actionKey,
}: Props) {
  const identity = actionKey ?? `${title}:${confirmationName ?? ''}:${typeof description === 'string' ? description : ''}`
  const [localOpen, setLocalOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(() => unresolvedActions.has(identity))
  const [name, setName] = useState('')
  const open = controlledOpen ?? localOpen
  const locked = useRef(false)
  const mounted = useRef(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const nameId = useId()
  const isBusy = pending || busy

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    setName('')
    const unresolved = unresolvedActions.has(identity)
    setUncertain(unresolved)
    setError(unresolved ? '结果尚未确认，请刷新页面核对后再操作。' : '')
  }, [open, confirmationName, identity])

  function changeOpen(next: boolean) {
    if (locked.current || busy) return
    setLocalOpen(next)
    onOpenChange?.(next)
  }

  async function submit(checkOnly = false) {
    if (locked.current || busy || (!checkOnly && (confirmDisabled || uncertain || (confirmationName !== undefined && name !== confirmationName)))) return
    if (!checkOnly && unresolvedActions.has(identity)) {
      setUncertain(true)
      setError('结果尚未确认，请刷新页面核对后再操作。')
      return
    }
    if (pendingActions.has(identity)) {
      setError('原请求仍在处理中，请等待结果后再操作。')
      return
    }
    pendingActions.add(identity)
    locked.current = true
    setPending(true)
    setError('')
    let succeeded = false
    try {
      if (checkOnly && reconcile) {
        const result = await reconcile()
        if (!mounted.current) return
        succeeded = result === 'succeeded'
        setUncertain(result === 'unknown')
        if (result === 'unknown') unresolvedActions.add(identity)
        else unresolvedActions.delete(identity)
        if (result === 'unknown') setError('结果尚未确认，请刷新页面核对后再操作。')
        if (result === 'unchanged') setError('已核对，操作尚未完成。请重新确认后提交。')
      } else {
        succeeded = await onConfirm()
        if (!mounted.current) return
        if (!succeeded) setError('操作未完成，请检查提示后重试。')
      }
    } catch (failure) {
      const unknown = isUncertainActionError(failure)
      if (unknown) unresolvedActions.add(identity)
      if (!mounted.current) return
      setUncertain(unknown)
      setError(unknown
        ? `${failure instanceof Error ? failure.message + '\n' : ''}结果尚未确认，请刷新页面核对后再操作。`
        : failure instanceof Error ? failure.message : '操作未完成，请稍后重试。')
    } finally {
      pendingActions.delete(identity)
      locked.current = false
      if (mounted.current) {
        setPending(false)
        if (succeeded) {
          unresolvedActions.delete(identity)
          setUncertain(false)
          setLocalOpen(false)
          onOpenChange?.(false)
        }
      }
    }
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={changeOpen}>
      {trigger ? <AlertDialog.Trigger ref={triggerRef} asChild>{trigger}</AlertDialog.Trigger> : null}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/35" />
        <AlertDialog.Content
          ref={contentRef}
          data-slot="dialog-content"
          className="fixed left-1/2 top-1/2 z-50 grid max-h-[85dvh] w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border bg-background p-5 shadow-lg outline-none"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            if (document.activeElement instanceof HTMLElement && !contentRef.current?.contains(document.activeElement)) {
              returnFocusRef.current = document.activeElement
            }
            cancelRef.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const target = triggerRef.current ?? returnFocusRef.current
            requestAnimationFrame(() => { if (target?.isConnected) target.focus() })
          }}
          onEscapeKeyDown={(event) => { if (locked.current || busy) event.preventDefault() }}
        >
          <div className="grid min-w-0 gap-2">
            <AlertDialog.Title className="break-words text-base font-semibold">{title}</AlertDialog.Title>
            <AlertDialog.Description asChild>
              <div className="break-words whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{description}</div>
            </AlertDialog.Description>
          </div>
          {children ? <fieldset disabled={isBusy} className="grid min-w-0 gap-3">{children}</fieldset> : null}
          {confirmationName !== undefined ? (
            <div className="grid gap-2">
              <Label htmlFor={nameId}>输入“{confirmationName}”确认</Label>
              <Input id={nameId} autoComplete="off" disabled={isBusy} value={name} onChange={(event) => setName(event.target.value)} />
            </div>
          ) : null}
          {externalError || error ? <p role="alert" className="break-words whitespace-pre-wrap text-sm text-destructive">{externalError || error}</p> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button ref={cancelRef} disabled={isBusy} type="button" variant="outline">取消</Button>
            </AlertDialog.Cancel>
            {uncertain && reconcile ? <Button disabled={isBusy} type="button" variant="outline" onClick={() => void submit(true)}>核对结果</Button> : null}
            <Button
              disabled={isBusy || confirmDisabled || uncertain || (confirmationName !== undefined && name !== confirmationName)}
              type="button"
              variant={variant}
              onClick={() => void submit()}
            >
              {isBusy ? <SpinnerGap className="animate-spin" /> : null}
              {isBusy ? '正在处理…' : confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
