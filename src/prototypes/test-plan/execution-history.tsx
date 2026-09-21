import { Badge } from '../../components/ui/badge'
import { DetailBlock } from '../../components/test-workbench'
import type { TestResult } from '../../test-workbench-types'
import { formatTime, resultLabels } from './data'
import type { PrototypeExecution } from './workbench-data'
import { ExecutionImageGallery } from './execution-images'

export function ExecutionHistory({ records, legacyResult, legacyNote }: {
  records: PrototypeExecution[]
  legacyResult: TestResult
  legacyNote?: string
}) {
  if (!records.length) return <div className="proto-empty-history"><strong>暂无执行记录</strong><p>{legacyResult === 'untested' ? '该用例尚未执行。' : `历史结果：${resultLabels[legacyResult]}。原执行人及时间未记录。`}</p>{legacyNote && <DetailBlock title="历史执行备注" content={legacyNote} />}</div>
  return <div className="proto-history">{[...records].reverse().map((record, index) => <article key={record.id}>
    <header><div><Badge variant="outline" className={`proto-result proto-${record.result}`}>{resultLabels[record.result]}</Badge><strong>第 {records.length - index} 次记录</strong>{index === 0 && <span className="proto-latest">最新</span>}</div><small>{record.actor} · {formatTime(record.time)}</small></header>
    <dl><dt>实际结果</dt><dd>{record.actual || '未填写'}</dd><dt>执行备注</dt><dd>{record.note || '未填写'}</dd></dl><ExecutionImageGallery images={record.images} />
  </article>)}</div>
}
