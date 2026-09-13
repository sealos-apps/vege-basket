import { useEffect, useRef, useState } from 'react'
import { PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import { createProjectSubproject, fetchProjectSubprojects, removeProjectSubproject, updateProjectSubproject } from '../api'
import type { ProjectSubproject } from '../types'
import { Button } from './ui/button'
import { Input } from './ui/input'
import type { WorkspaceData } from '../api'
import { ConfirmActionDialog } from './confirm-action-dialog'
import './project-subprojects-panel.css'

export function ProjectSubprojectsPanel({ projectId, canManage, onChange }: { projectId: number; canManage: boolean; onChange?: (data: WorkspaceData) => void }) {
  const [items, setItems] = useState<ProjectSubproject[]>([])
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const requestGeneration = useRef(0)
  useEffect(() => {
    const generation = ++requestGeneration.current
    fetchProjectSubprojects(projectId).then(data => {
      if (generation === requestGeneration.current) setItems(data)
    }).catch(() => {
      if (generation === requestGeneration.current) setError('子项目加载失败，请重新打开项目。')
    }).finally(() => {
      if (generation === requestGeneration.current) setLoading(false)
    })
    return () => { requestGeneration.current += 1 }
  }, [projectId])
  async function mutate(operation: () => Promise<WorkspaceData>): Promise<boolean> {
    if (busy || loading) return false
    const generation = ++requestGeneration.current
    setBusy(true)
    setError('')
    try {
      const workspace = await operation()
      if (generation !== requestGeneration.current) return false
      onChange?.(workspace)
      setItems(workspace.projects.find(project => project.id === projectId)?.subprojects ?? [])
      setName('')
      setEditingId(null)
      return true
    } catch (failure) {
      if (generation === requestGeneration.current) setError(failure instanceof Error ? failure.message : '保存失败')
      return false
    } finally { if (generation === requestGeneration.current) setBusy(false) }
  }
  return <section className="project-subprojects-panel" aria-label="子项目管理" aria-busy={loading || busy}>
    <div className="project-subprojects-header organization-project-detail-heading"><strong>子项目管理</strong><span>{items.length} 个子项目</span></div>
    {error && <p role="alert">{error}</p>}
    {items.map(item => <div className="project-subproject-row organization-project-detail-heading" key={item.id}>
      <span>{item.name}</span>
      <div><span>{item.taskCount ?? 0} 个任务</span>
        {canManage && <>
          <Button type="button" variant="ghost" size="icon" disabled={busy} title="重命名子项目" aria-label={`重命名${item.name}`} onClick={() => { setEditingId(item.id); setName(item.name) }}><PencilSimple size={16} /></Button>
          <ConfirmActionDialog
            actionKey={`project-subproject-delete:${projectId}:${item.id}`}
            title={`删除子项目“${item.name}”？`}
            description={item.taskCount ? '该子项目已有任务引用，当前不能删除。' : '删除后子项目将无法恢复。'}
            confirmLabel="删除子项目"
            confirmDisabled={Boolean(item.taskCount)}
            onConfirm={() => mutate(() => removeProjectSubproject(projectId, item.id))}
            trigger={<Button type="button" variant="ghost" size="icon" disabled={busy || Boolean(item.taskCount)} title={item.taskCount ? '已有任务引用，不能删除' : '删除子项目'} aria-label={`删除${item.name}`}><Trash size={16} /></Button>}
          />
        </>}
      </div>
    </div>)}
    {loading ? <p role="status">正在加载子项目…</p> : !error && !items.length ? <p>暂无子项目</p> : null}
    {canManage && <form className="organization-project-row-actions" onSubmit={event => {
      event.preventDefault()
      if (!name.trim() || busy) return
      void mutate(() => editingId == null ? createProjectSubproject(projectId, { name }) : updateProjectSubproject(projectId, editingId, { name }))
    }}>
      <Input aria-label="子项目名称" value={name} disabled={busy || loading} placeholder="子项目名称" onChange={event => setName(event.target.value)} />
      <Button type="submit" disabled={busy || loading || !name.trim()}><Plus size={15} />{editingId == null ? '新建子项目' : '保存名称'}</Button>
      {editingId != null && <Button type="button" variant="outline" onClick={() => { setEditingId(null); setName('') }}>取消</Button>}
    </form>}
  </section>
}
