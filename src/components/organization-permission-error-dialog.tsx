import { WarningCircle } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'

export function OrganizationPermissionErrorDialog({
  message,
  onOpenChange,
}: {
  message: string
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={Boolean(message)} onOpenChange={onOpenChange}>
      <DialogContent className="organization-permission-error-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WarningCircle size={20} weight="duotone" aria-hidden />
            组织权限校验失败
          </DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>知道了</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
