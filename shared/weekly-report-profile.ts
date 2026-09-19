export type WeeklyReportProfile = 'developer' | 'tester'
export type WeeklyReportSourceKind =
  'todo' | 'delivery' | 'milestone' | 'bug' | 'test_plan'

export const weeklyReportProfiles = {
  developer: {
    label: '开发周报',
    goal: '本周重点工作目标',
    item: '工作事项',
    progress: '本周进展',
    risk: '风险问题',
    plan: '下周计划',
    sourceKinds: ['todo', 'delivery', 'milestone', 'bug'],
  },
  tester: {
    label: '测试周报',
    goal: '本周测试目标',
    item: '测试事项',
    progress: '本周测试进展',
    risk: '质量风险与测试阻塞',
    plan: '下周测试计划',
    sourceKinds: ['test_plan', 'bug'],
  },
} as const

export function isWeeklyReportProfile(
  value: unknown,
): value is WeeklyReportProfile {
  return value === 'developer' || value === 'tester'
}

export function allowsWeeklyReportSource(
  profile: WeeklyReportProfile,
  kind: WeeklyReportSourceKind,
) {
  return (
    weeklyReportProfiles[profile]
      .sourceKinds as readonly WeeklyReportSourceKind[]
  ).includes(kind)
}

export type WeeklyReportSourceRef = {
  id: number
} & (
  | { kind: 'todo' | 'delivery' | 'milestone'; projectId: number }
  | { kind: 'bug' | 'test_plan'; testSpaceId: number }
)

export type WeeklyReportExecutionStats = {
  total: number
  passed: number
  failed: number
  blocked: number
  skipped: number
}

export type WeeklyReportSourceCandidate = WeeklyReportSourceRef & {
  date: string
  matchedDate: string
  matchReason: string
  projectName: string
  relatedToMe: boolean
  status: string
  title: string
  testSpaceName?: string
  testSubjects?: Array<{ id: number; name: string }>
  versionLabel?: string
  personalExecutionStats?: WeeklyReportExecutionStats
}

export type WeeklyReportSourceResult = {
  sources: WeeklyReportSourceCandidate[]
  allowedSourceKinds: WeeklyReportSourceKind[]
  activeProfile: WeeklyReportProfile
  reportProfile: WeeklyReportProfile | null
  period: { start: string; endExclusive: string }
  truncated: Partial<Record<WeeklyReportSourceKind, boolean>>
}

export function weeklyReportSourceIdentity(source: WeeklyReportSourceRef) {
  return `${source.kind}:${source.id}:${'projectId' in source ? source.projectId : source.testSpaceId}`
}
