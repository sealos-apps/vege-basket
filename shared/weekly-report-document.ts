import {
  isWeeklyReportProfile,
  weeklyReportProfiles,
  type WeeklyReportProfile,
} from './weekly-report-profile.ts'

export const WEEKLY_REPORT_CONTENT_LIMIT = 12_000
export const WEEKLY_REPORT_DOCUMENT_MARKER = '<!-- veges-weekly-report:v3 -->'
export type WeeklyReportTask = {
  id: string
  title: string
  description: string
  progressPercent: number | null
}
export type WeeklyReportItem = {
  id: string
  title: string
  tasks: WeeklyReportTask[]
  risk: string
  plan: string
}
export type WeeklyReportDocument = {
  profile: WeeklyReportProfile
  goal: string
  items: WeeklyReportItem[]
}
export type WeeklyReportProgressSummary = {
  taskCount: number
  measuredTaskCount: number
  percentSum: number
  averagePercent: number | null
  completedCount: number
  inProgressCount: number
  notStartedCount: number
  missingProgressCount: number
  isProvisional: boolean
}
export const createWeeklyReportTask = (id: string): WeeklyReportTask => ({
  id,
  title: '',
  description: '',
  progressPercent: null,
})
export const createWeeklyReportItem = (id: string): WeeklyReportItem => ({
  id,
  title: '',
  tasks: [createWeeklyReportTask(`${id}-task`)],
  risk: '',
  plan: '',
})
export const createWeeklyReportDocument = (
  profile: WeeklyReportProfile,
): WeeklyReportDocument => ({
  profile,
  goal: '',
  items: [createWeeklyReportItem('item-1')],
})
export const hasTaskContent = (task: WeeklyReportTask) =>
  Boolean(
    task.title.trim() ||
    task.description.trim() ||
    task.progressPercent !== null,
  )
export const hasItemContent = (item: WeeklyReportItem) =>
  Boolean(
    item.title.trim() ||
    item.risk.trim() ||
    item.plan.trim() ||
    item.tasks.some(hasTaskContent),
  )
export const isValidTaskPercent = (percent: unknown): percent is number =>
  typeof percent === 'number' &&
  Number.isInteger(percent) &&
  percent >= 0 &&
  percent <= 100
export function weeklyReportTaskStatus(percent: number | null) {
  return !isValidTaskPercent(percent)
    ? '待填写'
    : percent === 0
      ? '未开始'
      : percent === 100
        ? '已完成'
        : '进行中'
}
export function getWeeklyReportProgress(
  items: readonly WeeklyReportItem[],
): WeeklyReportProgressSummary {
  const tasks = items.flatMap((item) => item.tasks).filter(hasTaskContent)
  const measured = tasks.filter((task) =>
    isValidTaskPercent(task.progressPercent),
  )
  const sum = measured.reduce((total, task) => total + task.progressPercent!, 0)
  return {
    taskCount: tasks.length,
    measuredTaskCount: measured.length,
    percentSum: sum,
    averagePercent: measured.length ? sum / measured.length : null,
    completedCount: measured.filter((task) => task.progressPercent === 100)
      .length,
    inProgressCount: measured.filter(
      (task) => task.progressPercent! > 0 && task.progressPercent! < 100,
    ).length,
    notStartedCount: measured.filter((task) => task.progressPercent === 0)
      .length,
    missingProgressCount: tasks.length - measured.length,
    isProvisional: tasks.length !== measured.length,
  }
}
export function combineWeeklyReportProgress(
  values: readonly (WeeklyReportProgressSummary | null)[],
): WeeklyReportProgressSummary {
  const result = getWeeklyReportProgress([])
  for (const value of values) {
    if (!value) continue
    for (const key of [
      'taskCount',
      'measuredTaskCount',
      'percentSum',
      'completedCount',
      'inProgressCount',
      'notStartedCount',
      'missingProgressCount',
    ] as const)
      result[key] += value[key]
  }
  result.averagePercent = result.measuredTaskCount
    ? result.percentSum / result.measuredTaskCount
    : null
  result.isProvisional = result.missingProgressCount > 0
  return result
}
export const formatWeeklyReportPercent = (value: number | null) =>
  value === null ? '—' : `${Number(value.toFixed(1))}%`

// Quote every content line, including empty lines. Markdown headings, fences, lists and
// literal field labels cannot escape their field, and whitespace survives round trips.
const quote = (text: string) =>
  text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
export function serializeWeeklyReportDocument(document: WeeklyReportDocument) {
  const labels = weeklyReportProfiles[document.profile]
  const lines = [
    WEEKLY_REPORT_DOCUMENT_MARKER,
    `<!-- profile:${document.profile} -->`,
    `## ${labels.goal}`,
    quote(document.goal),
  ]
  document.items.forEach((item, index) => {
    lines.push(
      `## 事项 ${index + 1}`,
      '### 事项名称',
      quote(item.title),
      `### ${labels.progress}`,
    )
    item.tasks.forEach((task, taskIndex) => {
      if (
        task.progressPercent !== null &&
        !isValidTaskPercent(task.progressPercent)
      )
        throw new Error('任务进度须为 0–100 的整数')
      lines.push(
        `#### 任务 ${taskIndex + 1}`,
        '##### 任务名称',
        quote(task.title),
        '##### 任务进展',
        quote(task.description),
        '##### 任务进度',
        task.progressPercent === null ? '待填写' : `${task.progressPercent}%`,
      )
    })
    lines.push(
      `### ${labels.risk}`,
      quote(item.risk),
      `### ${labels.plan}`,
      quote(item.plan),
    )
  })
  lines.push('<!-- /veges-weekly-report -->')
  return lines.join('\n')
}

export function parseWeeklyReportDocument(
  content: string,
): WeeklyReportDocument | null {
  const lines = content.trim().split('\n')
  let cursor = 0
  const take = (expected: string) => {
    if (lines[cursor++] !== expected)
      throw new Error('Invalid weekly report structure')
  }
  const text = () => {
    const block: string[] = []
    while (lines[cursor]?.startsWith('> ')) block.push(lines[cursor++].slice(2))
    if (!block.length) throw new Error('Missing weekly report field')
    return block.join('\n')
  }
  try {
    take(WEEKLY_REPORT_DOCUMENT_MARKER)
    const match = /^<!-- profile:(developer|tester) -->$/.exec(
      lines[cursor++] ?? '',
    )
    if (!match || !isWeeklyReportProfile(match[1])) return null
    const profile = match[1],
      labels = weeklyReportProfiles[profile]
    take(`## ${labels.goal}`)
    const document: WeeklyReportDocument = { profile, goal: text(), items: [] }
    while (lines[cursor]?.startsWith('## 事项 ')) {
      const id = `item-${document.items.length + 1}`
      take(`## 事项 ${document.items.length + 1}`)
      take('### 事项名称')
      const item: WeeklyReportItem = {
        id,
        title: text(),
        tasks: [],
        risk: '',
        plan: '',
      }
      take(`### ${labels.progress}`)
      while (lines[cursor]?.startsWith('#### 任务 ')) {
        take(`#### 任务 ${item.tasks.length + 1}`)
        take('##### 任务名称')
        const title = text()
        take('##### 任务进展')
        const description = text()
        take('##### 任务进度')
        const percent = lines[cursor++]
        if (
          percent !== '待填写' &&
          !/^(?:0|[1-9]\d?|100)%$/.test(percent ?? '')
        )
          return null
        item.tasks.push({
          id: `${id}-task-${item.tasks.length + 1}`,
          title,
          description,
          progressPercent:
            percent === '待填写' ? null : Number(percent.slice(0, -1)),
        })
      }
      take(`### ${labels.risk}`)
      item.risk = text()
      take(`### ${labels.plan}`)
      item.plan = text()
      document.items.push(item)
    }
    take('<!-- /veges-weekly-report -->')
    return cursor === lines.length ? document : null
  } catch {
    return null
  }
}
export function weeklyReportValidationError(
  document: WeeklyReportDocument,
): string | null {
  const items = document.items.filter(hasItemContent)
  if (!items.length) return '请至少填写一个事项及一项任务'
  for (const [index, item] of items.entries()) {
    if (!item.title.trim()) return `请填写事项 ${index + 1} 的名称`
    const tasks = item.tasks.filter(hasTaskContent)
    if (!tasks.length) return `事项 ${index + 1} 至少需要一项任务`
    for (const [taskIndex, task] of tasks.entries()) {
      if (
        !task.title.trim() ||
        !task.description.trim() ||
        !isValidTaskPercent(task.progressPercent)
      )
        return `请补齐事项 ${index + 1}、任务 ${taskIndex + 1} 的名称、进展和 0–100 的整数进度`
    }
  }
  return null
}
export function weeklyReportContentProgress(content: string) {
  const document = parseWeeklyReportDocument(content)
  return document ? getWeeklyReportProgress(document.items) : null
}
export function weeklyReportDocumentInstruction(profile: WeeklyReportProfile) {
  const example = createWeeklyReportDocument(profile)
  example.items[0].title =
    profile === 'tester' ? '测试计划名称' : '工作事项名称'
  example.items[0].tasks[0] = {
    id: 'task',
    title: '任务名称',
    description: '输入事实支持的本周进展',
    progressPercent: null,
  }
  return [
    '必须输出如下 v3 Markdown 结构。可按连续编号增加事项和任务，字段内容每行以 "> " 开始。',
    '任务进度必须写“待填写”，不要从状态、完成类措辞、用例通过率或执行率猜测百分比。风险和计划没有事实时留空，不要输出“暂无风险”。',
    '不要按维度拆成全局章节，不要在文档标记之外添加解释或代码围栏。',
    serializeWeeklyReportDocument(example),
  ].join('\n')
}

// Only an unambiguous legacy template can be converted. Unknown headings, fences,
// duplicate field labels and free-form Markdown stay in the original editor.
export function convertLegacyWeeklyReport(
  content: string,
  profile: WeeklyReportProfile,
): WeeklyReportDocument | null {
  if (
    content.includes(WEEKLY_REPORT_DOCUMENT_MARKER) ||
    /```|~~~/u.test(content)
  )
    return null
  const normalized = content.replace(/\r\n/g, '\n').trim()
  const blocks = normalized.split(/\n\s*---\s*\n/u)
  const document: WeeklyReportDocument = { profile, goal: '', items: [] }
  if (blocks[0]?.startsWith('## 本周重点工作目标：')) {
    document.goal = blocks
      .shift()!
      .slice('## 本周重点工作目标：'.length)
      .replace(/^\n\n/u, '')
    if (/^#{1,6} /mu.test(document.goal)) return null
  }
  for (const block of blocks) {
    const match =
      /^## 事项(?:[一二三四五六七八九十]+|\d+)：([^\n]*)\n+([\s\S]*)$/u.exec(
        block.trim(),
      )
    if (!match || /^#{1,6} /mu.test(match[2])) return null
    const fields = [
      ...match[2].matchAll(/^- (本周进展|风险问题|下周计划)：/gmu),
    ]
    if (
      fields.length !== 3 ||
      fields.map((f) => f[1]).join(',') !== '本周进展,风险问题,下周计划' ||
      fields[0].index !== 0
    )
      return null
    const values = fields.map((field, index) =>
      match[2]
        .slice(
          field.index! + field[0].length,
          fields[index + 1]?.index ?? match[2].length,
        )
        .replace(/\n$/u, ''),
    )
    const item = createWeeklyReportItem(`legacy-${document.items.length + 1}`)
    item.title = match[1]
    item.risk = values[1]
    item.plan = values[2]
    item.tasks[0].title = match[1]
    item.tasks[0].description = values[0]
    document.items.push(item)
  }
  return document.items.length ? document : null
}

export function prepareGeneratedWeeklyReport(
  content: string,
  profile: WeeklyReportProfile,
): string | null {
  if (content.length > WEEKLY_REPORT_CONTENT_LIMIT) return null
  const document = parseWeeklyReportDocument(content)
  if (!document || document.profile !== profile) return null
  for (const item of document.items)
    for (const task of item.tasks) task.progressPercent = null
  return serializeWeeklyReportDocument(document)
}
