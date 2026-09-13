import { useEffect, useRef, useState } from 'react'
import { ConfirmActionDialog, type ConfirmActionOptions } from '../components/confirm-action-dialog'
import type { ActionReconciliation } from '../confirmed-action'

type ConfirmRequestOptions = ConfirmActionOptions & {
  reconcile?: () => Promise<ActionReconciliation>
}

type Request = ConfirmRequestOptions & {
  scope: string | number | null
  run: () => Promise<boolean>
  resolve: (succeeded: boolean) => void
}

/** The request owns the target closure; navigation can never rebind it. */
export function useConfirmAction(scope: string | number | null) {
  const [request, setRequest] = useState<Request | null>(null)
  const active = useRef<Request | null>(null)
  useEffect(() => {
    setRequest(null)
    return () => {
      active.current?.resolve(false)
      active.current = null
    }
  }, [scope])

  function confirmAction(options: ConfirmRequestOptions, run: () => Promise<boolean>): Promise<boolean> {
    if (active.current) return Promise.resolve(false)
    return new Promise((resolve) => {
      const next = { ...options, actionKey: options.actionKey ?? `${scope}:${options.title}:${typeof options.description === 'string' ? options.description : ''}`, scope, run, resolve }
      active.current = next
      setRequest(next)
    })
  }

  const confirmationDialog = request && request.scope === scope ? (
    <ConfirmActionDialog
      key={`${request.title}:${request.scope}`}
      {...request}
      open
      onOpenChange={(open) => {
        if (open || active.current !== request) return
        request.resolve(false)
        active.current = null
        setRequest(null)
      }}
      onConfirm={async () => {
        if (active.current !== request) return false
        const succeeded = await request.run()
        if (active.current !== request) return false
        if (succeeded) {
          request.resolve(true)
          active.current = null
          setRequest(null)
        }
        return succeeded
      }}
    />
  ) : null
  return { confirmAction, confirmationDialog }
}
