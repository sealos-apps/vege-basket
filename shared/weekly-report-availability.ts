export const submittedWeeklyReportCreationReason = '本周已提交过周报，无法新建，请前往列表处编辑修改。'

export type WeeklyReportRules = {
  openDay: number
  openTime: string
  closeDay: number
  closeTime: string
}

export const defaultWeeklyReportRules: WeeklyReportRules = {
  closeDay: 1,
  closeTime: '23:59',
  openDay: 5,
  openTime: '00:00',
}

function normalizeDay(value: unknown) {
  const day = Number(value)
  return Number.isSafeInteger(day) && day >= 1 && day <= 7 ? day : null
}

export function normalizeWeeklyReportTime(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!/^\d{2}:\d{2}$/.test(raw)) return null
  const [hour, minute] = raw.split(':').map(Number)
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? raw : null
}

export function normalizeWeeklyReportRules(value: {
  openDay?: unknown
  openTime?: unknown
  closeDay?: unknown
  closeTime?: unknown
} | null | undefined): WeeklyReportRules | null {
  const openDay = normalizeDay(value?.openDay)
  const closeDay = normalizeDay(value?.closeDay)
  const openTime = normalizeWeeklyReportTime(value?.openTime)
  const closeTime = normalizeWeeklyReportTime(value?.closeTime)
  if (!openDay || !closeDay || !openTime || !closeTime) return null

  // The next report starts at the same day/time in T+1 week. The current
  // report must close before that point so two filling windows cannot overlap.
  if (closeDay > openDay || (closeDay === openDay && closeTime >= openTime)) return null
  return { closeDay, closeTime, openDay, openTime }
}

function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function formatBoundary(date: string, time: string) {
  return `${date.replaceAll('-', '/')} ${time}`
}

function boundaryForWeek(
  weekStart: string,
  day: number,
  time: string,
  nextWeek = false,
  seconds = '00',
) {
  return `${shiftIsoDate(weekStart, (nextWeek ? 7 : 0) + day - 1)}T${time}:${seconds}`
}

export function getWeeklyReportWindow(params: {
  rules?: WeeklyReportRules
  weekStart: string
}) {
  const rules = normalizeWeeklyReportRules(params.rules ?? defaultWeeklyReportRules)
    ?? defaultWeeklyReportRules
  return {
    closesAt: boundaryForWeek(params.weekStart, rules.closeDay, rules.closeTime, true, '59'),
    opensAt: boundaryForWeek(params.weekStart, rules.openDay, rules.openTime),
  }
}

export function getShanghaiDateTime(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).formatToParts(value)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`
}

function organizationWeekStart(today: string, weekStartsOn: number) {
  const date = new Date(`${today}T00:00:00Z`)
  const startDay = weekStartsOn === 7 ? 0 : weekStartsOn
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() - startDay + 7) % 7))
  return date.toISOString().slice(0, 10)
}

export function getWeeklyReportRulesExample(params: {
  today: string
  weekStartsOn: number
  rules: WeeklyReportRules
}) {
  const rules = normalizeWeeklyReportRules(params.rules)
  if (!rules) return null
  const weekStart = organizationWeekStart(params.today, params.weekStartsOn)
  return {
    weekStart,
    weekEnd: shiftIsoDate(weekStart, 6),
    ...getWeeklyReportWindow({ rules, weekStart }),
    nextOpensAt: getWeeklyReportWindow({ rules, weekStart: shiftIsoDate(weekStart, 7) }).opensAt,
  }
}

export function getWeeklyReportTargetWeekStart(params: {
  now: string
  rules?: WeeklyReportRules
  weekStartsOn: number
}) {
  const rules = normalizeWeeklyReportRules(params.rules ?? defaultWeeklyReportRules)
    ?? defaultWeeklyReportRules
  const current = organizationWeekStart(params.now.slice(0, 10), params.weekStartsOn)
  const previous = shiftIsoDate(current, -7)
  const previousWindow = getWeeklyReportWindow({ rules, weekStart: previous })
  return params.now <= previousWindow.closesAt && params.now >= previousWindow.opensAt
    ? previous
    : current
}

export function getWeeklyReportCreationAvailability(params: {
  loading: boolean
  now?: string
  rules?: WeeklyReportRules
  submitted: boolean
  today: string
  weekStart: string
}) {
  const rules = normalizeWeeklyReportRules(params.rules ?? defaultWeeklyReportRules)
    ?? defaultWeeklyReportRules
  const window = getWeeklyReportWindow({ rules, weekStart: params.weekStart })
  const activationDate = window.opensAt.slice(0, 10)
  const deadlineDate = window.closesAt.slice(0, 10)
  const now = params.now ?? `${params.today}T00:00:00`
  if (params.submitted) {
    return {
      activationDate,
      deadlineDate,
      enabled: false,
      reason: submittedWeeklyReportCreationReason,
    }
  }
  if (now < window.opensAt) {
    return {
      activationDate,
      deadlineDate,
      enabled: false,
      reason: `本周周报可提交时间：${formatBoundary(activationDate, rules.openTime)} 至 ${formatBoundary(deadlineDate, rules.closeTime)}。`,
    }
  }
  if (now > window.closesAt) {
    return {
      activationDate,
      deadlineDate,
      enabled: false,
      reason: `本周周报提交已截止，截止时间为 ${formatBoundary(deadlineDate, rules.closeTime)}。`,
    }
  }
  if (params.loading) {
    return {
      activationDate,
      deadlineDate,
      enabled: false,
      reason: '正在确认本周周报状态。',
    }
  }
  return { activationDate, deadlineDate, enabled: true, reason: '' }
}
