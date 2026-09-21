import { useRef, useState, useSyncExternalStore } from 'react'
import { Check, Moon, NotePencil, Sun } from '@phosphor-icons/react'
import { TestWorkbench, type TestPlanPresentation } from '../../components/test-workbench'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
import type { TestPlanCase, TestResult, TestWorkbenchData } from '../../test-workbench-types'
import type { PrototypeStore } from './mock-api'
import { resultLabels } from './data'
import { ExecutionHistory } from './execution-history'
import { ExecutionImageEditor } from './execution-images'
import type { ExecutionImage } from './data'

type Draft = { id: string; result: TestResult; actual: string; note: string; images: ExecutionImage[] }

function ExecutionPanel({ row, store, initialTab, drafts, commit }: {
  row: TestPlanCase
  store: PrototypeStore
  initialTab: string
  drafts: Map<number, Draft>
  commit: (operation: () => Promise<TestWorkbenchData>) => Promise<boolean>
}) {
  useSyncExternalStore(store.subscribe, store.getRevision)
  const [tab, setTab] = useState(initialTab)
  const [draft, setDraft] = useState(() => drafts.get(row.id) ?? { id: crypto.randomUUID(), result: row.result === 'untested' ? 'passed' : row.result, actual: '', note: '', images: [] })
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const locked = useRef(false)
  const history = store.histories[row.id] ?? []
  const current = store.data.planCases.find(item => item.id === row.id) ?? row
  function change(patch: Partial<Draft>) {
    const next = { ...draft, ...patch }
    setDraft(next); drafts.set(row.id, next); setSaved(false)
  }
  return <div className="proto-execution-panel"><Tabs value={tab} onValueChange={setTab}>
    <TabsList aria-label="用例执行"><TabsTrigger value="history">执行历史 ({history.length})</TabsTrigger><TabsTrigger value="record">记录执行</TabsTrigger></TabsList>
    {saved && <p role="status" className="proto-success"><Check />执行记录已保存，最终结果：{resultLabels[current.result]}</p>}
    <TabsContent value="history"><ExecutionHistory records={history} legacyResult={current.result} legacyNote={current.resultNote} /><Button variant="outline" onClick={() => setTab('record')}><NotePencil />记录下一次执行</Button></TabsContent>
    <TabsContent value="record"><form className="proto-form" onSubmit={async event => {
      event.preventDefault()
      if (locked.current) return
      locked.current = true
      setSaving(true)
      try {
        const success = await commit(async () => {
          store.appendExecution(row.id, { ...draft, actor: '林晓', time: new Date().toISOString() })
          return structuredClone(store.data)
        })
        if (!success) throw new Error('保存失败，填写内容已保留。')
        drafts.delete(row.id)
        setDraft({ id: crypto.randomUUID(), result: draft.result, actual: '', note: '', images: [] })
        setError(''); setSaved(true); setTab('history')
      } catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败，填写内容已保留。') }
      finally { locked.current = false; setSaving(false) }
    }}>
      <div className="proto-form-heading"><strong>第 {history.length + 1} 次记录</strong><span>执行人：林晓</span></div>
      <div><Label htmlFor="execution-result">执行结果</Label><Select value={draft.result} onValueChange={value => change({ result: value as TestResult })}><SelectTrigger id="execution-result"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{Object.entries(resultLabels).map(([value, label]) => <SelectItem value={value} key={value}>{label}</SelectItem>)}</SelectGroup></SelectContent></Select></div>
      <div><Label htmlFor="execution-actual">实际结果（选填）</Label><Textarea id="execution-actual" maxLength={10000} value={draft.actual} onChange={event => change({ actual: event.target.value })} /></div>
      <div><Label htmlFor="execution-note">执行备注（选填）</Label><Textarea id="execution-note" maxLength={5000} value={draft.note} onChange={event => change({ note: event.target.value })} /></div>
      <ExecutionImageEditor disabled={saving} images={draft.images} maxFileBytes={store.data.testPlanImageMaxBytes} onChange={images => change({ images })} />
      {draft.result === 'untested' && <p className="form-note">最终结果将重置为未执行，已有执行历史保留。</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
      <footer><span>当前最终结果：{resultLabels[current.result]}</span><Button type="submit" disabled={saving}><Check />{saving ? '保存中' : '保存执行记录'}</Button></footer>
    </form></TabsContent>
  </Tabs></div>
}

export function TestPlanPrototype({ store }: { store: PrototypeStore }) {
  useSyncExternalStore(store.subscribe, store.getRevision)
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const drafts = useRef(new Map<number, Draft>())
  const requestedRecord = useRef<number | undefined>(undefined)
  const presentation: TestPlanPresentation = {
    rowBlockSize: 116,
    caseActions: (row, openDetail) => <Button variant="outline" onClick={() => { requestedRecord.current = row.id; openDetail() }}><NotePencil />记录执行</Button>,
    caseMetadata: row => {
      const history = store.histories[row.id] ?? []
      const latest = history.at(-1)
      return <small className="proto-row-metadata">{latest ? `${history.length} 次记录 · ${latest.actor} · ${new Date(latest.time).toLocaleString('zh-CN', { hour12: false })}` : row.result === 'untested' ? '暂无执行记录' : '历史结果 · 暂无执行记录'}</small>
    },
    caseDetail: (row, commit) => <ExecutionPanel key={row.id} row={row} store={store} initialTab={requestedRecord.current === row.id ? 'record' : 'history'} drafts={drafts.current} commit={commit} />,
    onDetailClose: () => { requestedRecord.current = undefined },
    bugActualResult: row => {
      const latest = store.histories[row.id]?.at(-1)
      if (!latest) return row.resultNote
      const images = (latest.images ?? []).map(image => `![${image.name.replace(/[\]\r\n]/g, ' ')}](${image.src})`)
      return [latest.actual, ...images].filter(Boolean).join('\n\n')
    },
  }
  return <div className="proto-live-workbench">
    <TestWorkbench currentUserId={900001} projects={[{ id: 1, name: 'Veges 工作台' }]} planPresentation={presentation} accountMenu={
      <div className="proto-account"><span className="proto-avatar">林</span><div><strong>林晓</strong><Badge variant="outline">原型 · 示例数据</Badge></div><Button variant="ghost" size="icon" title={dark ? '切换浅色主题' : '切换深色主题'} aria-label={dark ? '切换浅色主题' : '切换深色主题'} onClick={() => { document.documentElement.classList.toggle('dark', !dark); setDark(!dark) }}>{dark ? <Sun /> : <Moon />}</Button></div>
    } />
  </div>
}
