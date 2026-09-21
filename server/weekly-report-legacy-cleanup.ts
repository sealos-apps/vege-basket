import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { parse as parseDotenv } from 'dotenv'
import pg from 'pg'
import { decryptText, encryptText } from './crypto.ts'
import { convertLegacyWeeklyReport } from '../shared/weekly-report-document.ts'

type ReportContent = { report_profile: string | null; content: string; draft_content: string }
type RevisionContent = { report_profile: string | null; content: string }

// A recognizable legacy report can contain older free-form Markdown revisions.
// Protect every structured marker, including damaged or future documents.
export function isLegacyWeeklyReport(report: ReportContent, revisions: RevisionContent[]) {
  if (report.report_profile !== null || revisions.some(revision => revision.report_profile !== null)) return false
  const contents = [report.content, report.draft_content, ...revisions.map(revision => revision.content)]
    .map(content => content.trim()).filter(Boolean)
  const drafts = [report.content, report.draft_content].map(content => content.trim()).filter(Boolean)
  return drafts.length > 0
    && contents.every(content => !content.includes('veges-weekly-report:'))
    && drafts.every(content => convertLegacyWeeklyReport(content, 'developer') !== null)
}

async function main() {
  const { values } = parseArgs({ options: {
    'env-file': { type: 'string' },
    apply: { type: 'boolean', default: false },
    'expected-count': { type: 'string' },
    backup: { type: 'string' },
  } })
  if (!values['env-file']) throw new Error('需要 --env-file')
  if (values.apply && (!values.backup || !/^\d+$/.test(values['expected-count'] ?? ''))) {
    throw new Error('执行需要 --backup 和 --expected-count')
  }
  const env = parseDotenv(fs.readFileSync(path.resolve(values['env-file']), 'utf8'))
  if (!env.DATABASE_URL) throw new Error('配置缺少 DATABASE_URL')
  for (const key of ['APP_ENCRYPTION_KEYS', 'APP_ENCRYPTION_ACTIVE_KEY_ID']) {
    process.env[key] = env[key] ?? ''
  }
  const db = new pg.Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5_000 })
  await db.connect()
  try {
    await db.query(values.apply ? 'begin' : 'begin isolation level repeatable read read only')
    await db.query("set local lock_timeout = '5s'")
    await db.query("set local statement_timeout = '30s'")
    if (values.apply) {
      // Freeze report writes and derived summaries while classifying and backing up.
      await db.query(`lock table organization_weekly_reports,
        organization_weekly_report_revisions, organization_weekly_report_sources,
        organization_weekly_report_test_sources, organization_weekly_summaries
        in share row exclusive mode`)
    }
    const reports = (await db.query<ReportContent & { id: string }>('select * from organization_weekly_reports order by id')).rows
    const revisions = (await db.query<RevisionContent & { report_id: string }>('select * from organization_weekly_report_revisions order by id')).rows
    const candidates = reports.filter(report => isLegacyWeeklyReport({
      ...report, content: decryptText(report.content), draft_content: decryptText(report.draft_content),
    }, revisions.filter(revision => revision.report_id === report.id).map(revision => ({
      ...revision, content: decryptText(revision.content),
    }))))
    const ids = candidates.map(report => report.id)
    const summaries = (await db.query(`select summary.* from organization_weekly_summaries summary
      where exists (select 1 from organization_weekly_reports report
        where report.id = any($1::bigint[]) and report.published_revision_id is not null
          and report.organization_id = summary.organization_id and report.week_start = summary.week_start)
      order by summary.id`, [ids])).rows
    const counts = { reports: ids.length, revisions: revisions.filter(revision => ids.includes(revision.report_id)).length,
      summaries: summaries.length, retainedReports: reports.length - ids.length }
    if (!values.apply) {
      await db.query('rollback')
      console.log(JSON.stringify({ mode: 'inspect', ...counts }))
      return
    }
    if (Number(values['expected-count']) !== ids.length) throw new Error('候选数量发生变化')
    const sources = (await db.query('select * from organization_weekly_report_sources where report_id = any($1::bigint[]) order by id', [ids])).rows
    const testSources = (await db.query('select * from organization_weekly_report_test_sources where report_id = any($1::bigint[]) order by id', [ids])).rows
    const backup = JSON.stringify({ version: 1, createdAt: new Date().toISOString(), reports: candidates,
      revisions: revisions.filter(revision => ids.includes(revision.report_id)), sources, testSources, summaries })
    const encrypted = encryptText(backup)
    if (decryptText(encrypted) !== backup) throw new Error('备份校验失败')
    const backupFd = fs.openSync(path.resolve(values.backup!), 'wx', 0o600)
    try { fs.writeFileSync(backupFd, encrypted); fs.fsyncSync(backupFd) } finally { fs.closeSync(backupFd) }
    await db.query('delete from organization_weekly_summaries where id = any($1::bigint[])', [summaries.map(summary => summary.id)])
    const deleted = await db.query('delete from organization_weekly_reports where id = any($1::bigint[])', [ids])
    if (deleted.rowCount !== ids.length) throw new Error('删除数量不一致')
    await db.query('commit')
    console.log(JSON.stringify({ mode: 'applied', ...counts, sources: sources.length, testSources: testSources.length }))
  } catch (error) {
    await db.query('rollback').catch(() => undefined)
    throw error
  } finally { await db.end() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    // Database errors may contain connection details or decrypted input.
    console.error('旧格式周报清理未确认完成，请先检查参数、密钥、数据库状态和备份，再重新只读核对。')
    process.exitCode = 1
  })
}
