import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, Info, ListChecks, PencilSimple, Plus, Trash, Warning, X } from '@phosphor-icons/react'
import { createOrganizationProjectModule, deleteOrganizationProjectModule, updateOrganizationProjectModule } from '../api'
import type { OrganizationDetail, OrganizationProjectModule } from '../organization-types'
import { normalizeProjectModuleName } from '../../shared/project-modules'
import { Button } from './ui/button'
import { Input } from './ui/input'

export function OrganizationProjectModulesPanel({ organizationId, modules, disabled = false, onSaved }: {
  organizationId: number
  modules: OrganizationProjectModule[]
  disabled?: boolean
  onSaved: (detail: OrganizationDetail) => void
}) {
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [pendingDisable, setPendingDisable] = useState<OrganizationProjectModule | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const generation = useRef(0)
  const savingRef = useRef(false)
  const busy = disabled || saving
  const enabledCount = modules.filter(module => module.enabled).length

  useEffect(() => () => { generation.current += 1 }, [])

  function validatedName(value: string, exceptId?: number) {
    const name = normalizeProjectModuleName(value)
    if (!name) {
      setError('模块名称须包含 1–40 个字符。')
      return null
    }
    if (modules.some(module => module.id !== exceptId && module.name === name)) {
      setError('此模块已存在，请使用其他名称或启用已有模块。')
      return null
    }
    return name
  }

  async function save(operation: () => Promise<OrganizationDetail>, success: string, afterSave?: () => void) {
    if (disabled || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError('')
    setNotice('')
    const requestGeneration = generation.current
    try {
      const detail = await operation()
      // Refresh the workspace even if the user closed this dialog during the save.
      onSaved(detail)
      if (requestGeneration !== generation.current) return
      afterSave?.()
      setNotice(success)
    } catch (saveError) {
      if (requestGeneration === generation.current) {
        setError(saveError instanceof Error ? saveError.message : '模块保存失败，请重试。')
      }
    } finally {
      savingRef.current = false
      if (requestGeneration === generation.current) setSaving(false)
    }
  }

  function addModule(event: FormEvent) {
    event.preventDefault()
    const name = validatedName(draft)
    if (!name) return
    void save(() => createOrganizationProjectModule(organizationId, name), '模块已添加，组织下所有项目均可使用。', () => setDraft(''))
  }

  function renameModule(event: FormEvent, module: OrganizationProjectModule) {
    event.preventDefault()
    const name = validatedName(renameDraft, module.id)
    if (!name) return
    void save(() => updateOrganizationProjectModule(organizationId, module.id, { name }), '模块名称已更新，已有待办同步显示新名称。', () => setEditingId(null))
  }

  return (
    <section className="organization-project-modules" aria-labelledby="organization-project-modules-heading" aria-busy={saving}>
      <div className="organization-project-modules-heading">
        <h3 id="organization-project-modules-heading">项目模块</h3>
        <span>{enabledCount} 个已启用{modules.length > enabledCount ? ` · ${modules.length - enabledCount} 个已停用` : ''}</span>
      </div>
      <p className="organization-project-modules-description">组织下所有项目统一使用，项目内无需单独配置。</p>
      <form className="organization-project-modules-add" onSubmit={addModule}>
        <Input aria-label="新模块名称" aria-invalid={Boolean(error) && editingId === null} disabled={busy}
          maxLength={40} placeholder="输入模块名称，例如：支付与订单" value={draft}
          onChange={event => { setDraft(event.target.value); setError(''); setNotice('') }} />
        <Button type="submit" disabled={busy || !draft.trim()}><Plus size={16} />新增模块</Button>
      </form>
      {error ? <p className="organization-project-modules-error" role="alert">{error}</p> : null}
      {modules.length ? (
        <div className="organization-project-modules-list">
          <div className="organization-project-modules-columns"><span>模块名称</span><span>使用次数</span><span>状态</span></div>
          {modules.map(module => (
            <div className="organization-project-module-row" key={module.id}>
              {editingId === module.id ? (
                <form className="organization-project-module-edit" onSubmit={event => renameModule(event, module)}>
                  <Input autoFocus aria-label={`修改 ${module.name} 的名称`} aria-invalid={Boolean(error)} disabled={busy}
                    maxLength={40} value={renameDraft} onChange={event => { setRenameDraft(event.target.value); setError('') }}
                    onKeyDown={event => {
                      if (event.key === 'Escape') { event.stopPropagation(); setEditingId(null); setError('') }
                    }} />
                  <Button type="submit" size="icon" disabled={busy || !renameDraft.trim()} aria-label="保存模块名称"><Check size={16} /></Button>
                  <Button type="button" size="icon" variant="ghost" disabled={busy} aria-label="取消改名"
                    onClick={() => { setEditingId(null); setError('') }}><X size={16} /></Button>
                </form>
              ) : (
                <>
                  <span className="organization-project-module-name" data-enabled={module.enabled}>
                    <span aria-hidden className="organization-project-module-dot" />
                    <span>{module.name}</span>
                    {!module.enabled ? <small>已停用</small> : null}
                  </span>
                  <Button type="button" size="icon" variant="ghost" disabled={busy} aria-label={`编辑 ${module.name}`}
                    title={`编辑 ${module.name}`} onClick={() => {
                      setEditingId(module.id); setRenameDraft(module.name); setError(''); setNotice(''); setPendingDisable(null)
                  }}><PencilSimple size={16} /></Button>
                  {!module.enabled ? <Button type="button" size="icon" variant="ghost" disabled={busy}
                    aria-label={`删除 ${module.name}`} title="删除已停用模块" onClick={() => {
                      if (window.confirm(`删除已停用模块“${module.name}”？已有任务的历史归属会保留。`)) {
                        void save(() => deleteOrganizationProjectModule(organizationId, module.id), `「${module.name}」已删除。`)
                      }
                    }}><Trash size={16} /></Button> : null}
                </>
              )}
              <span className="organization-project-module-usage">{module.usageCount} 次</span>
              <button type="button" role="switch" aria-checked={module.enabled} disabled={busy || (module.enabled && module.usageCount > 0)}
                aria-label={`${module.enabled ? '停用' : '启用'} ${module.name}`} className="organization-project-module-switch"
                title={module.enabled && module.usageCount > 0 ? `已有 ${module.usageCount} 个任务使用，不能停用` : `${module.enabled ? '停用' : '启用'} ${module.name}`}
                onClick={() => {
                  setEditingId(null); setError(''); setNotice('')
                  if (module.enabled) setPendingDisable(module)
                  else void save(() => updateOrganizationProjectModule(organizationId, module.id, { enabled: true }), `「${module.name}」已启用。`)
                }}><span /></button>
            </div>
          ))}
        </div>
      ) : (
        <div className="organization-project-modules-empty">
          <ListChecks size={28} /><strong>还没有项目模块</strong>
          <p>添加后，组织下的项目即可使用。<br />暂不配置也可以创建“无模块”的待办。</p>
        </div>
      )}
      {pendingDisable ? (
        <div className="organization-project-module-confirm" role="alert">
          <strong><Warning size={18} />停用「{pendingDisable.name}」？</strong>
          <p>停用后组织下所有项目不能再选择此模块，已有待办保留原模块归属。之后可随时重新启用。</p>
          <div>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setPendingDisable(null)}>取消</Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={() => void save(
              () => updateOrganizationProjectModule(organizationId, pendingDisable.id, { enabled: false }),
              `「${pendingDisable.name}」已停用，历史待办归属保留。`, () => setPendingDisable(null),
            )}>{saving ? '保存中…' : '确认停用'}</Button>
          </div>
        </div>
      ) : <p className="organization-project-modules-hint"><Info size={15} />使用次数包含已完成任务。停用仅影响后续选择，已有待办的模块归属会保留。</p>}
      {notice ? <p className="organization-project-modules-notice" role="status">{notice}</p> : null}
    </section>
  )
}
