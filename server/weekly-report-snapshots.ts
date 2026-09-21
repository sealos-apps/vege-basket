import { hasItemContent, parseWeeklyReportDocument } from '../shared/weekly-report-document.ts'
import { weeklyReportSourceIdentity, type WeeklyReportItemSources, type WeeklyReportSourceCandidate, type WeeklyReportSourceRef, type WeeklyReportSourceSnapshot } from '../shared/weekly-report-profile.ts'
import { normalizeWeeklyReportSources } from './weekly-report-sources.ts'

export function retainWeeklyReportItemSources(bindings: WeeklyReportItemSources[], refs: WeeklyReportSourceRef[]) {
  // Resource deletion cascades source rows, but must not strand the encrypted draft metadata.
  const retained = new Set(refs.map(weeklyReportSourceIdentity))
  return bindings.map(binding => ({ ...binding, sources: binding.sources.filter(source => retained.has(weeklyReportSourceIdentity(source))) }))
    .filter(binding => binding.sources.length)
}

export function normalizeWeeklyReportItemSources(value: unknown, content: string, refs: WeeklyReportSourceRef[]): WeeklyReportItemSources[] {
  if (value === undefined) return []
  const document = parseWeeklyReportDocument(content)
  if (!Array.isArray(value) || value.length > (document?.items.length ?? 0)) throw new Error('事项来源格式无效')
  const authorized = new Set(refs.map(weeklyReportSourceIdentity))
  const seen = new Set<number>()
  return value.map((entry) => {
    if (!entry || !Number.isSafeInteger(entry.itemIndex) || entry.itemIndex < 0 || entry.itemIndex >= (document?.items.length ?? 0) || seen.has(entry.itemIndex)) throw new Error('事项来源位置无效')
    seen.add(entry.itemIndex)
    const sources = normalizeWeeklyReportSources(entry.sources)
    if (sources.some((source) => !authorized.has(weeklyReportSourceIdentity(source)))) throw new Error('事项来源必须属于已关联工作')
    return { itemIndex: entry.itemIndex, sources }
  })
}

export function buildWeeklyReportSnapshots(content: string, bindings: WeeklyReportItemSources[], candidates: WeeklyReportSourceCandidate[]): WeeklyReportSourceSnapshot[] {
  const document = parseWeeklyReportDocument(content)
  if (!document) return []
  const byIdentity = new Map(candidates.map((candidate) => {
    const source = structuredClone(candidate)
    delete source.personalExecutionRecords
    return [weeklyReportSourceIdentity(source), source] as const
  }))
  const snapshots: WeeklyReportSourceSnapshot[] = []
  let publishedIndex = 0
  document.items.forEach((item, index) => {
    if (!hasItemContent(item)) return
    const sources = (bindings.find((binding) => binding.itemIndex === index)?.sources ?? []).map((ref) => {
      const source = byIdentity.get(weeklyReportSourceIdentity(ref))
      if (!source) throw new Error('关联工作已失效，请重新检查后提交')
      return source
    })
    if (sources.length) snapshots.push({ itemIndex: publishedIndex, sources })
    publishedIndex++
  })
  return snapshots
}
