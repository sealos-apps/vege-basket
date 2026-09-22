import { useEffect, useRef, useState } from 'react'
import { fetchProjectDeliveryConfiguration, saveProjectDeliveryConfiguration, type ProjectDeliveryConfiguration } from '../api'
import type { ProjectDeliveryMember } from '../../shared/project-delivery'
import { mergeDeliveryMemberDraft } from '../../shared/project-delivery'
import { isUncertainActionError, reconcileAction } from '../confirmed-action'
import { startVisibleRefreshSchedule } from '../refresh-schedule'
import { ConfirmActionDialog } from './confirm-action-dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import './project-delivery-members-panel.css'

const unresolved = new Map<string, ProjectDeliveryMember[]>()
const signature = (members: ProjectDeliveryMember[]) => JSON.stringify(members.map(({ userId, canPlan, canExecute }) => ({ userId, canPlan, canExecute })).sort((a, b) => a.userId - b.userId))

export function ProjectDeliveryMembersPanel({ organizationId, projectId }: { organizationId: number; projectId: number }) {
  const identity = `${organizationId}:${projectId}`
  const [data, setData] = useState<ProjectDeliveryConfiguration | null>(null)
  const [draft, setDraft] = useState<ProjectDeliveryMember[]>([])
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(() => unresolved.has(identity))
  const locked = useRef(false)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (editing || busy) return
    let active = true
    return (() => {
      const stop = startVisibleRefreshSchedule({
        refresh: async () => {
          try {
            const next = await fetchProjectDeliveryConfiguration(organizationId, projectId)
            if (active) { setData(next); setError('') }
          } catch (failure) {
            if (active) setError(failure instanceof Error ? failure.message : '交付人员加载失败')
            return false
          }
        },
        refreshImmediately: true, intervalMs: 15_000, minRefreshGapMs: 1_000,
        isVisible: () => document.visibilityState === 'visible',
        setInterval: (fn, ms) => window.setInterval(fn, ms), clearInterval: handle => window.clearInterval(handle),
        onFocus: listener => { window.addEventListener('focus', listener); return () => window.removeEventListener('focus', listener) },
        onVisibilityChange: listener => { document.addEventListener('visibilitychange', listener); return () => document.removeEventListener('visibilitychange', listener) },
      })
      return () => { active = false; stop() }
    })()
  }, [organizationId, projectId, editing, busy])

  async function save(): Promise<boolean> {
    if (!data || locked.current || unresolved.has(identity)) return false
    locked.current = true
    setBusy(true)
    setError('')
    try {
      const next = await reconcileAction(
        () => saveProjectDeliveryConfiguration(organizationId, projectId, draft, data.members),
        () => fetchProjectDeliveryConfiguration(organizationId, projectId),
        result => signature(result.members) === signature(draft),
      )
      if (!mounted.current) return false
      setData(next); setEditing(false); setAdding(false)
      return true
    } catch (failure) {
      if (isUncertainActionError(failure)) unresolved.set(identity, draft.map(member => ({ ...member })))
      if (mounted.current) { setUncertain(unresolved.has(identity)); setError(failure instanceof Error ? failure.message : '保存失败') }
      throw failure
    } finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  async function checkConfiguration() {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    try {
      const next = await fetchProjectDeliveryConfiguration(organizationId, projectId)
      if (!mounted.current) return
      const pending = unresolved.get(identity)
      if (pending) {
        if (signature(next.members) === signature(pending)) {
          unresolved.delete(identity)
          setUncertain(false); setData(next); setEditing(false); setAdding(false); setError('')
        } else setError('已读取当前配置，尚不能确认上次保存成功。请稍后再次核对，不会重复提交。')
      } else {
        if (editing && data) setDraft(mergeDeliveryMemberDraft(data.members, draft, next.members))
        setData(next)
        setError(editing ? '已读取最新配置并保留本次修改，请核对人员和职责后重新保存。' : '')
      }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : '核对失败，请稍后重试')
    } finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  const revoked = data?.members.filter(member => {
    const next = draft.find(item => item.userId === member.userId)
    return (member.canPlan && !next?.canPlan) || (member.canExecute && !next?.canExecute)
  }) ?? []
  const invalid = draft.some(member => !member.canPlan && !member.canExecute)
  const disabled = busy || uncertain || invalid || !data || signature(draft) === signature(data.members)
  const candidates = data?.candidates.filter(member => !draft.some(item => item.userId === member.id)
    && `${member.name} ${member.username}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ?? []
  return <section className="delivery-members-panel" aria-label="交付人员配置" aria-busy={busy}>
    <div className="delivery-members-heading"><strong>交付人员</strong>
      {!editing && <Button type="button" size="sm" variant="outline" disabled={!data || uncertain} onClick={() => { setDraft(data!.members.map(member => ({ ...member }))); setEditing(true); setError('') }}>配置</Button>}
      {editing && <Button type="button" size="sm" variant="outline" disabled={busy || uncertain} aria-expanded={adding} onClick={() => setAdding(!adding)}>添加人员</Button>}
    </div>
    {error && <p role="alert">{error}</p>}
    {uncertain && <p role="alert">保存结果尚未确认，请核对当前配置。未确认前不能再次保存。</p>}
    {(uncertain || error) && <Button variant="outline" size="sm" disabled={busy} onClick={() => { void checkConfiguration() }}>{uncertain ? '核对保存结果' : editing ? '读取最新配置并保留修改' : '重新加载'}</Button>}
    {!data && !error && <p role="status">正在加载交付人员…</p>}
    {!editing && data && <dl className="delivery-members-summary">
      <dt>计划管理</dt><dd>{data.members.filter(member => member.canPlan).map(member => member.name).join('、') || '尚未配置'}<small>共 {data.members.filter(member => member.canPlan).length} 人</small></dd>
      <dt>交付执行</dt><dd>{data.members.filter(member => member.canExecute).map(member => member.name).join('、') || '尚未配置'}<small>共 {data.members.filter(member => member.canExecute).length} 人</small></dd>
    </dl>}
    {editing && <>
      {adding && <div className="delivery-member-picker">
        <Input aria-label="搜索组织成员" placeholder="搜索姓名或账号" value={search} onChange={event => setSearch(event.target.value)} />
        <div className="delivery-member-candidates">{candidates.map(member => <label key={member.id}>
          <input type="checkbox" disabled={!member.projectMember || busy || uncertain} checked={false} onChange={() => setDraft(current => [...current, { userId: member.id, name: member.name, canPlan: false, canExecute: false }])} />
          <span>{member.name}<small>{member.username}{!member.projectMember ? ' · 请先通过项目成员管理加入项目' : ''}</small></span>
        </label>)}{!candidates.length && <p>没有可添加的匹配成员</p>}</div>
        <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>完成选择</Button>
      </div>}
      <div className="delivery-members-table-scroll"><table className="delivery-members-table">
        <thead><tr><th>人员</th><th>计划管理</th><th>交付执行</th><th><span className="sr-only">操作</span></th></tr></thead>
        <tbody>{draft.map(member => <tr key={member.userId}><td>{member.name}</td>
          {(['canPlan', 'canExecute'] as const).map(role => <td key={role}><input type="checkbox" aria-label={`${member.name}的${role === 'canPlan' ? '计划管理' : '交付执行'}权限`} checked={member[role]} disabled={busy || uncertain} onChange={event => setDraft(current => current.map(item => item.userId === member.userId ? { ...item, [role]: event.target.checked } : item))} /></td>)}
          <td><Button variant="ghost" size="sm" disabled={busy || uncertain} onClick={() => setDraft(current => current.filter(item => item.userId !== member.userId))}>移除<span className="sr-only">{member.name}</span></Button></td>
        </tr>)}</tbody>
      </table></div>
      {!draft.length && <p>添加组织成员，为其勾选一项或两项职责。</p>}
      <p className="delivery-members-help">计划管理：编制、发布交付计划，指派或转交执行人。<br />交付执行：执行指派给自己的任务，记录反馈并提交完成。</p>
      {invalid && <p role="status">每位人员至少选择一项职责。</p>}
      <div className="delivery-members-actions">
        <Button variant="outline" disabled={busy || uncertain} onClick={() => { setEditing(false); setAdding(false) }}>取消</Button>
        {revoked.length ? <ConfirmActionDialog actionKey={`delivery-members:${identity}:${signature(data?.members ?? [])}`} title="确认调整交付职责？" description={`将取消以下人员的部分或全部交付职责：${revoked.map(member => member.name).join('、')}。未完成任务须先交接，历史记录保留。`} confirmLabel="保存配置" confirmDisabled={disabled} onConfirm={save} trigger={<Button disabled={disabled}>保存配置</Button>} />
          : <Button disabled={disabled} onClick={() => { void save().catch(() => {}) }}>{busy ? '保存中…' : '保存配置'}</Button>}
      </div>
    </>}
  </section>
}
