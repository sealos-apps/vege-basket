import { ArrowLeft, DownloadSimple, FilePdf } from '@phosphor-icons/react'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog'
import { DetailBlock } from '../../components/test-workbench'
import type { TestResult } from '../../test-workbench-types'
import { finalResult, formatTime, latest, resultLabels, type Plan } from './data'
import type { PrototypeExecution } from './workbench-data'
import { ExecutionImageGallery } from './execution-images'

export function ExecutionHistory({ records, legacyResult, legacyNote, chronological = false }: {
  records: PrototypeExecution[]; legacyResult: TestResult; legacyNote?: string; chronological?: boolean
}) {
  if (!records.length) return <div className="proto-empty-history"><strong>暂无执行记录</strong><p>{legacyResult === 'untested' ? '该用例尚未执行。' : `历史结果：${resultLabels[legacyResult]}。原执行人及时间未记录。`}</p>{legacyNote && <DetailBlock title="历史执行备注" content={legacyNote} />}</div>
  return <div className="proto-history">{(chronological ? records : [...records].reverse()).map(record => <article key={record.id}>
    <header><div><Badge variant="outline" className={`proto-result proto-${record.result}`}>{resultLabels[record.result]}</Badge><strong>第 {records.indexOf(record) + 1} 次记录</strong>{record === records.at(-1) && <span className="proto-latest">最新</span>}</div><small>{record.actor} · {formatTime(record.time)}</small></header>
    <dl><dt>实际结果</dt><dd>{record.actual || '未填写'}</dd><dt>执行备注</dt><dd>{record.note || '未填写'}</dd></dl><ExecutionImageGallery images={record.images} />
  </article>)}</div>
}

export function PlanReport({ snapshot, onClose }: { snapshot: { plan: Plan; time: string }; onClose: () => void }) {
  const { plan, time } = snapshot
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}><DialogContent className="proto-report proto-report-overlay" showCloseButton={false} aria-describedby={undefined}>
    <header className="proto-report-toolbar"><Button variant="ghost" onClick={onClose}><ArrowLeft />返回测试计划</Button><div><FilePdf /><DialogTitle>执行文档预览</DialogTitle><Badge variant="outline">全计划 · {plan.cases.length} 个用例</Badge></div><Button onClick={() => window.print()}><DownloadSimple />打印 / 保存 PDF</Button></header>
    <div className="proto-report-layout"><nav className="proto-report-toc" aria-label="执行文档目录"><strong>文档目录</strong><a href="#report-overview">计划信息与结果汇总</a>{plan.cases.map(item => <a key={item.id} href={`#report-case-${item.id}`}><span>{item.caseCode}</span>{item.title}</a>)}</nav><div className="proto-pages">
      <section className="proto-paper" id="report-overview"><div className="proto-paper-brand"><img src="/favicon.svg" alt="Veges" /><strong>Veges</strong><span>测试执行文档</span></div><p className="proto-report-code">PLAN-{plan.id}</p><h1>{plan.name}</h1>
        <dl className="proto-report-meta"><dt>测试空间</dt><dd>{plan.spaceName}</dd><dt>关联项目</dt><dd>{plan.projectName}</dd><dt>负责人</dt><dd>{plan.ownerName}</dd><dt>执行周期</dt><dd>{plan.period}</dd><dt>执行环境 / 版本</dt><dd>{plan.environment} / {plan.version}</dd><dt>计划状态</dt><dd>{plan.status}</dd><dt>导出时间</dt><dd>{formatTime(time)}（北京时间）</dd><dt>导出范围</dt><dd>全计划 {plan.cases.length} 个用例，含未执行用例</dd></dl>
        <h2>结果汇总</h2><div className="proto-report-counts">{Object.entries(resultLabels).map(([value, label]) => <div key={value}><strong>{plan.cases.filter(item => finalResult(item) === value).length}</strong><span>{label}</span></div>)}</div>
        <table><thead><tr><th>用例</th><th>最终结果</th><th>记录数</th></tr></thead><tbody>{plan.cases.map(item => <tr key={item.id}><td><span className="proto-report-code">{item.caseCode}</span><br />{item.title}</td><td>{resultLabels[finalResult(item)]}{!item.history.length && item.legacyResult !== 'untested' ? '（历史结果）' : ''}</td><td>{item.history.length}</td></tr>)}</tbody></table>
        <p className="proto-report-footnote">最终结果取最新一次保存的记录。重置为未执行不删除历史。无可追溯记录的历史结果单独标注。</p>
      </section>
      {plan.cases.map(item => <section className="proto-paper proto-case-paper" id={`report-case-${item.id}`} key={item.id}><div className="proto-paper-running"><span>{plan.name}</span><span>PLAN-{plan.id}</span></div><p className="proto-report-code">{item.caseCode}</p><h2>{item.title}</h2><div className="proto-report-final"><strong>最终结果：{resultLabels[finalResult(item)]}</strong><span>{latest(item) ? `${latest(item)!.actor} · ${formatTime(latest(item)!.time)}` : item.legacyResult !== 'untested' ? '历史结果 · 执行人及时间未记录' : '尚未执行'}</span></div>
        <DetailBlock title="前置条件" content={item.preconditions} /><DetailBlock title="测试步骤" content={item.steps.join('\n')} /><DetailBlock title="预期结果" content={item.expected} />
        <h3 className="proto-report-history-title">执行记录（{item.history.length}）</h3><ExecutionHistory records={item.history} legacyResult={finalResult(item)} legacyNote={item.legacyNote} chronological />
      </section>)}
    </div></div>
  </DialogContent></Dialog>
}
