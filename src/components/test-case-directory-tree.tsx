import type { useDirectoryTreeState } from '../use-case-directory-tree'
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  CaretDown,
  CaretRight,
  DotsThreeVertical,
  Folder,
  FolderOpen,
  FolderPlus,
  SidebarSimple,
} from '@phosphor-icons/react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import {
  createDirectoryIndex,
  countDirectoryCases,
  validateDirectoryPlacement,
} from '../../shared/test-case-directories'
import type { TestCase, TestCaseFolder } from '../test-workbench-types'
import { cn } from '@/lib/utils'

export function DirectoryPicker({
  folders,
  value,
  onChange,
  excluded = new Set<number>(),
  rootLabel = '未分类',
  disabled = false,
}: {
  folders: TestCaseFolder[]
  value: number | null
  onChange: (id: number | null) => void
  excluded?: Set<number>
  rootLabel?: string
  disabled?: boolean
}) {
  const index = useMemo(() => createDirectoryIndex(folders), [folders])
  return (
    <Select
      disabled={disabled}
      value={value === null ? 'root' : String(value)}
      onValueChange={(id) => onChange(id === 'root' ? null : Number(id))}
    >
      <SelectTrigger aria-label="目标目录">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="root">{rootLabel}</SelectItem>
          {[...folders]
            .sort((a, b) =>
              index
                .path(a.id)
                .map((n) => n.name)
                .join(' / ')
                .localeCompare(
                  index
                    .path(b.id)
                    .map((n) => n.name)
                    .join(' / '),
                  'zh-CN',
                ),
            )
            .filter((f) => !excluded.has(f.id))
            .map((f) => (
              <SelectItem key={f.id} value={String(f.id)}>
                {index
                  .path(f.id)
                  .map((n) => n.name)
                  .join(' / ')}
              </SelectItem>
            ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

type DirectoryAction = {
  kind: 'create' | 'edit' | 'delete'
  folder?: TestCaseFolder
  parentId: number | null
}
export function DirectoryTree({
  viewState,
  folders,
  cases,
  selected,
  onSelect,
  onCollapse,
  readOnly,
  busy,
  onCreate,
  onUpdate,
  onDelete,
}: {
  viewState: ReturnType<typeof useDirectoryTreeState>
  folders: TestCaseFolder[]
  cases: TestCase[]
  selected: string
  onSelect: (id: string) => void
  onCollapse: () => void
  readOnly: boolean
  busy: boolean
  onCreate: (name: string, parentId: number | null) => Promise<boolean>
  onUpdate: (
    folder: TestCaseFolder,
    name: string,
    parentId: number | null,
  ) => Promise<boolean>
  onDelete: (folder: TestCaseFolder) => Promise<boolean>
}) {
  const index = useMemo(() => createDirectoryIndex(folders), [folders])
  const counts = useMemo(
    () => countDirectoryCases(folders, cases),
    [folders, cases],
  )
  const { expanded, setExpanded, query, setQuery, focusId, setFocusId } =
    viewState
  const treeRef = useRef<HTMLDivElement>(null)
  const [action, setAction] = useState<DirectoryAction>()
  const matching = useMemo(() => {
    if (!query.trim()) return undefined
    const ids = new Set<number>()
    for (const f of folders)
      if (f.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
        for (const p of index.path(f.id)) ids.add(p.id)
    return ids
  }, [folders, index, query])
  const visible: { folder: TestCaseFolder; depth: number }[] = []
  function visit(parentId: number | null, depth: number) {
    for (const f of index.children.get(parentId) ?? []) {
      if (matching && !matching.has(f.id)) continue
      visible.push({ folder: f, depth })
      if (matching || expanded.has(f.id)) visit(f.id, depth + 1)
    }
  }
  visit(null, 1)
  const visibleIds = [
    'all',
    'uncategorized',
    ...visible.map(({ folder }) => String(folder.id)),
  ]
  const tabStop = visibleIds.includes(focusId) ? focusId : 'all'
  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function focus(id: string) {
    setFocusId(id)
    treeRef.current
      ?.querySelector<HTMLElement>(`[data-directory-id="${id}"]`)
      ?.focus()
  }
  function keyDown(event: KeyboardEvent, id: string) {
    const position = visibleIds.indexOf(id)
    const folder = index.byId.get(Number(id))
    let target: string | undefined
    if (event.key === 'ArrowDown')
      target = visibleIds[Math.min(position + 1, visibleIds.length - 1)]
    if (event.key === 'ArrowUp') target = visibleIds[Math.max(position - 1, 0)]
    if (event.key === 'Home') target = visibleIds[0]
    if (event.key === 'End') target = visibleIds.at(-1)
    if (
      event.key === 'ArrowRight' &&
      folder &&
      index.children.get(folder.id)?.length
    ) {
      if (!expanded.has(folder.id) && !matching) toggle(folder.id)
      else {
        const child = index.children
          .get(folder.id)
          ?.find((node) => !matching || matching.has(node.id))
        if (child) target = String(child.id)
      }
    }
    if (event.key === 'ArrowLeft' && folder) {
      if (expanded.has(folder.id) && !matching) toggle(folder.id)
      else if (folder.parentId !== null) target = String(folder.parentId)
    }
    if (event.key === 'Enter' || event.key === ' ') onSelect(id)
    if (target) focus(target)
    if (
      [
        'ArrowDown',
        'ArrowUp',
        'ArrowRight',
        'ArrowLeft',
        'Home',
        'End',
        'Enter',
        ' ',
      ].includes(event.key)
    )
      event.preventDefault()
  }
  return (
    <aside className="test-directory-panel" aria-label="用例目录">
      <div className="test-directory-heading">
        <strong>用例目录</strong>
        <Button
          size="icon"
          variant="ghost"
          aria-label="收缩用例目录"
          onClick={onCollapse}
        >
          <SidebarSimple />
        </Button>
      </div>
      <Input
        aria-label="搜索目录"
        placeholder="搜索目录…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="test-directory-tools">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setQuery('')
            setExpanded(new Set(folders.map((f) => f.id)))
            setFocusId('all')
          }}
        >
          全部展开
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setQuery('')
            setExpanded(new Set())
            setFocusId('all')
          }}
        >
          全部收起
        </Button>
        {!readOnly && (
          <Button
            size="icon"
            variant="ghost"
            aria-label="新增目录"
            disabled={busy}
            onClick={() =>
              setAction({
                kind: 'create',
                parentId: index.byId.has(Number(selected))
                  ? Number(selected)
                  : null,
              })
            }
          >
            <FolderPlus />
          </Button>
        )}
      </div>
      <div
        role="tree"
        aria-label="用例目录树"
        ref={treeRef}
        className="test-directory-nodes"
      >
        {(['all', 'uncategorized'] as const).map((id) => (
          <div
            key={id}
            role="treeitem"
            aria-level={1}
            aria-selected={selected === id}
            tabIndex={tabStop === id ? 0 : -1}
            data-directory-id={id}
            onFocus={() => setFocusId(id)}
            onKeyDown={(e) => keyDown(e, id)}
            onClick={() => onSelect(id)}
            className={cn('test-directory-node', selected === id && 'active')}
          >
            <Folder />
            <span>{id === 'all' ? '全部用例' : '未分类'}</span>
            <small>
              {id === 'all' ? cases.length : (counts.direct.get(null) ?? 0)}
            </small>
          </div>
        ))}
        {visible.map(({ folder: f, depth }) => {
          const hasChildren = Boolean(index.children.get(f.id)?.length)
          const open = Boolean(matching) || expanded.has(f.id)
          const childCount = index.children.get(f.id)?.length ?? 0
          const directCount = counts.direct.get(f.id) ?? 0
          const reason =
            childCount || directCount
              ? `包含 ${childCount} 个子目录、${directCount} 条直属用例，仅可删除空目录`
              : ''
          return (
            <div
              role="treeitem"
              aria-label={f.name}
              aria-level={depth}
              aria-expanded={hasChildren ? open : undefined}
              aria-selected={selected === String(f.id)}
              tabIndex={tabStop === String(f.id) ? 0 : -1}
              key={f.id}
              data-directory-id={f.id}
              onFocus={() => setFocusId(String(f.id))}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget) keyDown(e, String(f.id))
              }}
              onClick={() => onSelect(String(f.id))}
              className={cn(
                'test-directory-node',
                selected === String(f.id) && 'active',
              )}
              style={{ paddingLeft: 8 + (depth - 1) * 16 }}
              title={index
                .path(f.id)
                .map((p) => p.name)
                .join(' / ')}
            >
              <button
                type="button"
                tabIndex={-1}
                aria-label={`${open ? '收起' : '展开'} ${f.name}`}
                disabled={!hasChildren || Boolean(matching)}
                className="test-directory-chevron"
                onClick={(e) => {
                  e.stopPropagation()
                  toggle(f.id)
                }}
              >
                {hasChildren ? open ? <CaretDown /> : <CaretRight /> : null}
              </button>
              {open && hasChildren ? <FolderOpen /> : <Folder />}
              <span>{f.name}</span>
              <small>{counts.total.get(f.id) ?? 0}</small>
              {!readOnly && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${f.name}目录操作`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <DotsThreeVertical />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        disabled={busy}
                        onSelect={() =>
                          setAction({ kind: 'create', parentId: f.id })
                        }
                      >
                        新增子目录
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={busy}
                        onSelect={() =>
                          setAction({
                            kind: 'edit',
                            folder: f,
                            parentId: f.parentId,
                          })
                        }
                      >
                        编辑 / 移动目录
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={busy || Boolean(reason)}
                        onSelect={() =>
                          setAction({
                            kind: 'delete',
                            folder: f,
                            parentId: f.parentId,
                          })
                        }
                      >
                        删除空目录
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    {reason && (
                      <p className="test-directory-delete-reason">{reason}</p>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )
        })}
        {matching && !visible.length && (
          <p className="test-list-empty">没有匹配的目录</p>
        )}
      </div>
      <small className="test-directory-footnote">
        目录数字包含所有下级用例
      </small>
      {action && (
        <DirectoryActionDialog
          action={action}
          folders={folders}
          cases={cases}
          busy={busy}
          onClose={() => setAction(undefined)}
          onSave={async (name, parentId) => {
            const saved =
              action.kind === 'delete'
                ? await onDelete(action.folder!)
                : action.kind === 'edit'
                  ? await onUpdate(action.folder!, name, parentId)
                  : await onCreate(name, parentId)
            if (saved) {
              setAction(undefined)
              if (parentId !== null)
                setExpanded(
                  (prev) =>
                    new Set([
                      ...prev,
                      ...index.path(parentId).map((p) => p.id),
                    ]),
                )
              if (
                action.kind === 'delete' &&
                selected === String(action.folder!.id)
              )
                onSelect(
                  action.parentId === null ? 'all' : String(action.parentId),
                )
            }
            return saved
          }}
        />
      )}
    </aside>
  )
}

function DirectoryActionDialog({
  action,
  folders,
  cases,
  busy,
  onClose,
  onSave,
}: {
  action: DirectoryAction
  folders: TestCaseFolder[]
  cases: TestCase[]
  busy: boolean
  onClose: () => void
  onSave: (name: string, parentId: number | null) => Promise<boolean>
}) {
  const [name, setName] = useState(action.folder?.name ?? '')
  const [parentId, setParentId] = useState(action.parentId)
  const [error, setError] = useState('')
  const index = createDirectoryIndex(folders)
  const excluded =
    action.folder && index.byId.has(action.folder.id)
      ? index.descendants(action.folder.id)
      : new Set<number>()
  const nonempty =
    action.kind === 'delete' &&
    (folders.some((f) => f.parentId === action.folder!.id) ||
      cases.some((c) => c.folderId === action.folder!.id))
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {action.kind === 'delete'
              ? '删除空目录'
              : action.kind === 'edit'
                ? '编辑 / 移动目录'
                : '新增目录'}
          </DialogTitle>
          <DialogDescription>
            {action.kind === 'delete'
              ? `确认删除“${action.folder!.name}”？仅空目录可删除，提交时会重新检查。`
              : '目录最多 32 层，同一层级名称不可重复。移动目录会保留子目录与用例。'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="test-dialog-form"
          onSubmit={async (e) => {
            e.preventDefault()
            setError('')
            try {
              if (nonempty) throw new Error('目录已非空，无法删除。')
              if (action.kind !== 'delete')
                validateDirectoryPlacement(
                  folders,
                  name,
                  parentId,
                  action.folder?.id,
                )
              if (!(await onSave(name.trim(), parentId)))
                setError('操作失败，请查看工作台错误提示后重试。')
            } catch (err) {
              setError(err instanceof Error ? err.message : '操作失败')
            }
          }}
        >
          {action.kind !== 'delete' && (
            <>
              <Label>
                目录名称
                <Input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Label>
              <Label>
                上级目录
                <DirectoryPicker
                  folders={folders}
                  value={parentId}
                  onChange={setParentId}
                  excluded={excluded}
                  rootLabel="根目录"
                />
              </Label>
            </>
          )}
          {(error || nonempty) && (
            <p role="alert">{error || '目录已非空，无法删除。'}</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              取消
            </Button>
            <Button
              type="submit"
              variant={action.kind === 'delete' ? 'destructive' : 'default'}
              disabled={
                busy ||
                Boolean(nonempty) ||
                (action.kind !== 'delete' && !name.trim())
              }
            >
              {action.kind === 'delete' ? '删除目录' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
