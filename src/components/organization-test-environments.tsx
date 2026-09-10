import { useState, useEffect, type ReactNode } from 'react'
import { Plus, PencilSimple, Trash, LinkSimple } from '@phosphor-icons/react'
import {
  createOrganizationTestEnvironment,
  updateOrganizationTestEnvironment,
  deleteOrganizationTestEnvironment,
} from '../api'
import type {
  OrganizationDetail,
  OrganizationTestEnvironment,
} from '../organization-types'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog'
function EmptyRow({ text }: { text: string }) {
  return <p className="organization-empty">{text}</p>
}
export function OrganizationTestEnvironmentPanel({
  busy,
  detail,
  onMutate,
  heading,
}: {
  heading?: ReactNode
  busy: boolean
  detail: OrganizationDetail
  onMutate: (operation: () => Promise<OrganizationDetail>) => Promise<boolean>
}) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingEnvironment, setEditingEnvironment] =
    useState<OrganizationTestEnvironment>()
  const [deleteTarget, setDeleteTarget] =
    useState<OrganizationTestEnvironment>()
  const environments = detail.testEnvironments ?? []

  function openCreate() {
    setEditingEnvironment(undefined)
    setEditorOpen(true)
  }

  function openEdit(environment: OrganizationTestEnvironment) {
    setEditingEnvironment(environment)
    setEditorOpen(true)
  }

  return (
    <section className="organization-section organization-resource-panel organization-test-environments-panel">
      <header>
        <div className="organization-section-heading">
          {heading ?? (
            <>
              <h3>测试环境</h3>
              <span>{environments.length}</span>
            </>
          )}
        </div>
        {detail.canManageTestEnvironments ? (
          <Button disabled={busy} type="button" onClick={openCreate}>
            <Plus size={16} /> 新建测试环境
          </Button>
        ) : null}
      </header>
      {detail.canManageTestEnvironments ? (
        <p className="organization-test-environments-intro">
          组织共享：只需配置一次，所有测试空间自动使用。在此修改会同步到整个组织。
        </p>
      ) : (
        <p className="organization-test-environments-intro">
          组织共享环境，当前账号没有维护权限。
        </p>
      )}
      <div className="organization-test-environment-list">
        {environments.map((environment) => {
          return (
            <article
              className="organization-test-environment-row"
              key={environment.id}
            >
              <div className="organization-test-environment-main">
                <strong>{environment.name}</strong>
                <a
                  href={environment.accessUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {environment.accessUrl}
                  <LinkSimple size={14} aria-hidden />
                </a>
                <span>组织共享</span>
              </div>
              {detail.canManageTestEnvironments ? (
                <div className="organization-test-environment-actions">
                  <Button
                    aria-label={`编辑测试环境 ${environment.name}`}
                    disabled={busy}
                    size="icon"
                    title="编辑测试环境"
                    type="button"
                    variant="ghost"
                    onClick={() => openEdit(environment)}
                  >
                    <PencilSimple size={16} />
                  </Button>
                  <Button
                    aria-label={`删除测试环境 ${environment.name}`}
                    disabled={busy}
                    size="icon"
                    title="删除测试环境"
                    type="button"
                    variant="ghost"
                    onClick={() => setDeleteTarget(environment)}
                  >
                    <Trash size={16} />
                  </Button>
                </div>
              ) : null}
            </article>
          )
        })}
        {environments.length === 0 ? (
          <EmptyRow text="还没有测试环境配置" />
        ) : null}
      </div>
      <TestEnvironmentEditorDialog
        busy={busy}
        environment={editingEnvironment}
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open)
          if (!open) setEditingEnvironment(undefined)
        }}
        onSave={(payload) =>
          onMutate(() =>
            editingEnvironment
              ? updateOrganizationTestEnvironment(
                  detail.id,
                  editingEnvironment.id,
                  payload,
                )
              : createOrganizationTestEnvironment(detail.id, payload),
          )
        }
      />
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(undefined)
        }}
      >
        <DialogContent className="organization-test-environment-dialog">
          <DialogHeader>
            <DialogTitle>删除测试环境</DialogTitle>
            <DialogDescription>
              删除“{deleteTarget?.name}”后，本组织所有测试空间的新建 Bug
              将不能再选择该环境；已有 Bug 会保留创建时的环境信息。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={busy}
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(undefined)}
            >
              取消
            </Button>
            <Button
              disabled={busy || !deleteTarget}
              type="button"
              variant="destructive"
              onClick={async () => {
                if (!deleteTarget) return
                const saved = await onMutate(() =>
                  deleteOrganizationTestEnvironment(detail.id, deleteTarget.id),
                )
                if (saved) setDeleteTarget(undefined)
              }}
            >
              <Trash size={16} /> 删除环境
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function TestEnvironmentEditorDialog({
  busy,
  environment,
  onOpenChange,
  onSave,
  open,
}: {
  busy: boolean
  environment?: OrganizationTestEnvironment
  onOpenChange: (open: boolean) => void
  onSave: (payload: { accessUrl: string; name: string }) => Promise<boolean>
  open: boolean
}) {
  const [name, setName] = useState('')
  const [accessUrl, setAccessUrl] = useState('')

  useEffect(() => {
    if (!open) return
    setName(environment?.name ?? '')
    setAccessUrl(environment?.accessUrl ?? '')
  }, [environment?.accessUrl, environment?.id, environment?.name, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        fixedHeader
        className="organization-test-environment-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {environment ? '编辑测试环境' : '新建测试环境'}
          </DialogTitle>
          <DialogDescription>
            配置组织共享环境，保存后所有测试空间均可使用。
          </DialogDescription>
        </DialogHeader>
        <form
          className="organization-test-environment-form"
          onSubmit={async (event) => {
            event.preventDefault()
            const saved = await onSave({
              accessUrl: accessUrl.trim(),
              name: name.trim(),
            })
            if (saved) onOpenChange(false)
          }}
        >
          <Label>
            环境名称
            <Input
              autoFocus
              maxLength={120}
              placeholder="例如：预发布环境"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Label>
          <Label>
            访问地址
            <Input
              inputMode="url"
              maxLength={2048}
              placeholder="例如：https://staging.example.com"
              type="url"
              value={accessUrl}
              onChange={(event) => setAccessUrl(event.target.value)}
            />
          </Label>

          <DialogFooter>
            <Button
              disabled={busy}
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button disabled={busy || !name.trim() || !accessUrl.trim()}>
              {environment ? '保存环境' : '创建环境'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
