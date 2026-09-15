export type WeeklyReportGenerationRole = 'developer' | 'tester'

export type WeeklyReportJournalFact = {
  date: string
  projectName: string
  content: string
}

export type WeeklyReportProjectWorkStats = {
  projectName: string
  todoTotal: number
  todoCompleted: number
  todoUnfinished: number
  todoPendingReview: number
  deliveryTotal: number
  deliveryDelivered: number
  deliveryUnfinished: number
}

export type WeeklyReportWorkStats = {
  projects: WeeklyReportProjectWorkStats[]
}

export type WeeklyReportTesterPlanStats = {
  planName: string
  testTarget: string
  executed: number
  passed: number
  failed: number
  blocked: number
  skipped: number
}

type GenerationSourceParams = {
  organizationName: string
  userName: string
  weekStart: string
  role: WeeklyReportGenerationRole
  journals: WeeklyReportJournalFact[]
  workStats: WeeklyReportWorkStats
  testerPlans: WeeklyReportTesterPlanStats[]
}

function formatChineseDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value
  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`
}

function formatChinesePeriod(weekStart: string) {
  const date = new Date(`${weekStart}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 6)
  return `${formatChineseDate(weekStart)} 至 ${formatChineseDate(date.toISOString().slice(0, 10))}`
}

function clip(value: string, length: number) {
  return value.replace(/\s+/g, ' ').trim().slice(0, length)
}

function formatDeveloperSource(params: GenerationSourceParams) {
  const journals = params.journals.length
    ? params.journals.map((journal) => (
      `### ${journal.date}\n- 项目：${clip(journal.projectName, 120)}\n  日记：${clip(journal.content, 1_000)}`
    )).join('\n')
    : '暂无项目日记记录。'
  const stats = params.workStats.projects.length
    ? params.workStats.projects.map((project) => (
      `- ${clip(project.projectName, 120)}：待办共 ${project.todoTotal} 条，完成 ${project.todoCompleted} 条，未完成 ${project.todoUnfinished} 条，待验收 ${project.todoPendingReview} 条；交付事件共 ${project.deliveryTotal} 条，已交付 ${project.deliveryDelivered} 条，未完成 ${project.deliveryUnfinished} 条`
    )).join('\n')
    : '暂无项目待办或交付事件统计。'
  return [
    `周报对象：${clip(params.organizationName, 100)} / ${clip(params.userName, 80)}`,
    `周期：${formatChinesePeriod(params.weekStart)}`,
    '请输出可直接编辑的中文 Markdown 周报。项目日记按日期和项目归纳每天的记录，将事实按事项和任务逐项整理。',
    weeklyReportDocumentInstruction(params.role),
    '项目待办和交付事件只能作为数字统计，不得逐条列举其标题、描述或其他明细。',
    '输入事实：项目日记',
    journals,
    '输入事实：项目待办与交付事件统计',
    stats,
  ].join('\n').slice(0, 12_000)
}

function formatTesterSource(params: GenerationSourceParams) {
  const plans = params.testerPlans.length
    ? params.testerPlans.map((plan) => [
      `### 计划：${clip(plan.planName, 160)}`,
      `- 测试对象：${clip(plan.testTarget, 160)}`,
      `- 本周期本人保留的最新执行记录：${plan.executed} 条`,
      `- 通过：${plan.passed} 条，失败：${plan.failed} 条，阻塞：${plan.blocked} 条，跳过：${plan.skipped} 条`,
    ].join('\n')).join('\n')
    : '暂无本周用例执行记录。'
  return [
    `周报对象：${clip(params.organizationName, 100)} / ${clip(params.userName, 80)}`,
    `周期：${formatChinesePeriod(params.weekStart)}`,
    '请输出可直接编辑的中文 Markdown 周报。测试工程师没有项目日记，只总结测试计划和用例执行情况，并将事实按事项和任务逐项整理；必须写清每个测试计划的具体标题和测试对象，不要补写项目待办或交付事件明细。',
    weeklyReportDocumentInstruction(params.role),
    '输入事实：测试计划与用例执行',
    plans,
  ].join('\n').slice(0, 12_000)
}

export function buildWeeklyReportGenerationSource(params: GenerationSourceParams) {
  return params.role === 'tester' ? formatTesterSource(params) : formatDeveloperSource(params)
}
import { weeklyReportDocumentInstruction } from '../shared/weekly-report-document.ts'
