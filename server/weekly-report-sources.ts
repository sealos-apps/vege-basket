import type { PoolClient } from 'pg'
import { decryptText } from './crypto.ts'
import { managedOrganizationReadScopeSql } from './organization-scope.ts'
import { formatShanghaiCalendarDate } from '../shared/calendar-date.ts'
import {
  allowsWeeklyReportSource,
  weeklyReportProfiles,
  weeklyReportSourceIdentity,
  type WeeklyReportProfile,
  type WeeklyReportSourceCandidate,
  type WeeklyReportSourceKind,
  type WeeklyReportSourceRef,
} from '../shared/weekly-report-profile.ts'

export function weeklyReportPeriod(weekStart: string) {
  const end = new Date(`${weekStart}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate() + 7)
  return {
    start: `${weekStart}T00:00:00+08:00`,
    endExclusive: `${end.toISOString().slice(0, 10)}T00:00:00+08:00`,
  }
}
export const sourceProjectAccessSql = `project.organization_id = $1::bigint and (
  project.user_id = $2::bigint or exists (
    select 1 from project_memberships mine where mine.project_id = project.id
      and mine.invited_user_id = $2::bigint and mine.status = 'active'
  ) or ${managedOrganizationReadScopeSql('project.organization_id', '$2::bigint')})`
export const sourceSpaceAccessSql = `(space.owner_user_id = $2::bigint or exists (
  select 1 from test_space_memberships mine where mine.test_space_id = space.id
    and mine.user_id = $2::bigint and mine.status = 'active'
) or ${managedOrganizationReadScopeSql('space.organization_id', '$2::bigint')})`
const within = (value: string) =>
  `${value} >= $3::timestamptz and ${value} < $4::timestamptz`
const matchedActivity = (events: string) =>
  `(select max(activity.at) from (${events}) activity where ${within('activity.at')})`
const todoMatchedDateSql =
  matchedActivity(`select todo.created_at as at union all select todo.completed_at
  union all select todo.due_date::timestamp at time zone 'Asia/Shanghai'
  union all select occurred_at from todo_activity_events where todo_id = todo.id
  union all select created_at from todo_notes where todo_id = todo.id`)
const deliveryMatchedDateSql =
  matchedActivity(`select event.created_at as at union all select event.published_at
  union all select created_at from project_package_event_comments where project_package_event_id = event.id
  union all select greatest(event.delivery_start_at, $3::timestamptz)
    where event.delivery_start_at < $4::timestamptz and event.delivery_end_at >= $3::timestamptz`)
const milestoneMatchedDateSql =
  matchedActivity(`select milestone.created_at as at union all select milestone.submitted_at union all select milestone.completed_at
  union all select milestone.target_date::timestamp at time zone 'Asia/Shanghai'
  union all select created_at from project_milestone_events where milestone_id = milestone.id`)
const planMatchedDateSql = matchedActivity(`select plan.created_at as at
  union all select pc.executed_at from test_plan_cases pc where pc.test_plan_id = plan.id
    and pc.executed_by_user_id = $2::bigint and pc.result <> 'untested'
  union all select greatest(coalesce(plan.starts_on, plan.ends_on)::timestamp at time zone 'Asia/Shanghai', $3::timestamptz)
    where (coalesce(plan.starts_on, plan.ends_on)::timestamp at time zone 'Asia/Shanghai') < $4::timestamptz
      and (coalesce(plan.ends_on, plan.starts_on)::timestamp at time zone 'Asia/Shanghai') >= $3::timestamptz`)
export const todoPeriodSql = `${todoMatchedDateSql} is not null`
export const deliveryPeriodSql = `${deliveryMatchedDateSql} is not null`
const milestonePeriodSql = `${milestoneMatchedDateSql} is not null`
const planPeriodSql = `${planMatchedDateSql} is not null`
// Latest closure only; comments cannot qualify a Bug. Timestamp + ID orders ties.
const bugMatchedDateSql = `(case when bug.status = 'closed' then (
  select e.created_at from test_bug_events e where e.test_bug_id = bug.id
    and e.event_type = 'status_changed' and e.next_status = 'closed'
  order by e.created_at desc, e.id desc limit 1
) when bug.status = 'in_progress' then (
  select max(evidence.at) from (
    select greatest(e.created_at, $3::timestamptz) as at from test_bug_events e
    where e.test_bug_id = bug.id and e.event_type = 'status_changed'
      and e.next_status = 'in_progress' and e.created_at < $4::timestamptz
      and coalesce((select stop.created_at from test_bug_events stop
        where stop.test_bug_id = bug.id and stop.event_type = 'status_changed'
          and stop.next_status <> 'in_progress' and (stop.created_at, stop.id) > (e.created_at, e.id)
        order by stop.created_at, stop.id limit 1), clock_timestamp()) > $3::timestamptz
    union all select e.created_at from test_bug_events e
    where e.test_bug_id = bug.id and e.event_type = 'status_changed'
      and e.previous_status = 'in_progress' and e.created_at > $3::timestamptz and e.created_at < $4::timestamptz
  ) evidence
) end)`
export const bugPeriodSql = `(bug.status in ('in_progress', 'closed') and ${within(bugMatchedDateSql)})`

export function normalizeWeeklyReportSources(
  value: unknown,
): WeeklyReportSourceRef[] {
  if (!Array.isArray(value) || value.length > 80)
    throw new Error('周报来源格式无效，每份最多关联 80 项')
  const result = new Map<string, WeeklyReportSourceRef>()
  for (const source of value) {
    if (!source || typeof source !== 'object')
      throw new Error('周报来源格式无效')
    const { id, kind } = source
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('周报来源 ID 无效')
    let ref: WeeklyReportSourceRef
    if (kind === 'todo' || kind === 'delivery' || kind === 'milestone') {
      if (!Number.isSafeInteger(source.projectId) || source.projectId < 1)
        throw new Error('周报项目来源无效')
      ref = { id, kind, projectId: source.projectId }
    } else if (kind === 'bug' || kind === 'test_plan') {
      if (!Number.isSafeInteger(source.testSpaceId) || source.testSpaceId < 1)
        throw new Error('周报测试空间来源无效')
      ref = { id, kind, testSpaceId: source.testSpaceId }
    } else throw new Error('周报来源类型无效')
    const key = `${kind}:${id}`,
      previous = result.get(key)
    if (
      previous &&
      weeklyReportSourceIdentity(previous) !== weeklyReportSourceIdentity(ref)
    )
      throw new Error('周报来源所属资源不一致')
    result.set(key, ref)
  }
  return [...result.values()]
}

type SourceRow = {
  id: string
  parent_id: string
  parent_name: string
  title: string
  status: string
  date: Date | string
  related_to_me: boolean
  version_label?: string
  subjects?: Array<{ id: number; name: string }>
  total?: string
  passed?: string
  failed?: string
  blocked?: string
  skipped?: string
}
const projectSources = {
  todo: {
    table: 'todos todo',
    alias: 'todo',
    title: 'todo.title',
    status:
      "case when todo.done then 'completed' else todo.confirmation_status end",
    period: todoPeriodSql,
    date: todoMatchedDateSql,
    related:
      '$2::bigint = any(array[project.user_id,todo.created_by_user_id,todo.assignee_user_id,todo.watcher_user_id,todo.reviewer_user_id,todo.completed_by_user_id]::bigint[])',
  },
  delivery: {
    table: 'project_package_events event',
    alias: 'event',
    title: 'event.title',
    status: 'event.status',
    period: deliveryPeriodSql,
    date: deliveryMatchedDateSql,
    related:
      '$2::bigint = any(array[project.user_id,event.created_by_user_id,event.assignee_user_id,event.assigned_by_user_id]::bigint[])',
  },
  milestone: {
    table: 'project_milestones milestone',
    alias: 'milestone',
    title: 'milestone.title',
    status: 'milestone.status',
    period: milestonePeriodSql,
    date: milestoneMatchedDateSql,
    related:
      '$2::bigint = any(array[project.user_id,milestone.responsible_user_id,milestone.created_by_user_id,milestone.updated_by_user_id,milestone.submitted_by_user_id,milestone.completed_by_user_id]::bigint[])',
  },
} as const

export async function loadWeeklyReportSources(
  client: PoolClient,
  params: {
    organizationId: number
    userId: number
    weekStart: string
    profile: WeeklyReportProfile
    refs?: WeeklyReportSourceRef[]
    enforcePeriod?: boolean
    allowHistoricalKinds?: boolean
  },
) {
  const {
    organizationId,
    userId,
    weekStart,
    profile,
    refs,
    enforcePeriod = true,
  } = params
  const period = weeklyReportPeriod(weekStart)
  const kinds =
    params.allowHistoricalKinds && refs
      ? [...new Set(refs.map((r) => r.kind))]
      : [...weeklyReportProfiles[profile].sourceKinds]
  const sources: WeeklyReportSourceCandidate[] = [],
    truncated: Partial<Record<WeeklyReportSourceKind, boolean>> = {}
  for (const kind of kinds) {
    const ids = refs
      ? refs.filter((ref) => ref.kind === kind).map((ref) => ref.id)
      : null
    if (ids && !ids.length) continue
    const limit = kind === 'todo' ? 160 : 120
    const args = [
      organizationId,
      userId,
      period.start,
      period.endExclusive,
      ids,
      enforcePeriod,
    ]
    let sql: string
    if (kind === 'todo' || kind === 'delivery' || kind === 'milestone') {
      const definition = projectSources[kind],
        { alias } = definition
      sql = `select ${alias}.id, project.id as parent_id, project.name as parent_name,
        ${definition.title} as title, ${definition.status} as status,
        coalesce(${definition.date}, ${alias}.created_at) as date, coalesce((${definition.related}), false) as related_to_me
        from ${definition.table} join projects project on project.id = ${alias}.project_id
        where ${sourceProjectAccessSql} and ($5::bigint[] is null or ${alias}.id = any($5::bigint[]))
          and (not $6::boolean or (${definition.period}))
        order by ${alias}.updated_at desc, ${alias}.id desc ${ids ? '' : `limit ${limit + 1}`}`
    } else if (kind === 'bug') {
      const access =
        profile === 'developer'
          ? `(bug.assignee_user_id = $2::bigint or ${managedOrganizationReadScopeSql('space.organization_id', '$2::bigint')})`
          : sourceSpaceAccessSql
      sql = `select bug.id, space.id as parent_id, space.name as parent_name, bug.title, bug.status,
        coalesce(${bugMatchedDateSql}, bug.created_at) as date, coalesce(bug.assignee_user_id = $2::bigint or bug.reporter_user_id = $2::bigint or exists (
          select 1 from test_bug_events e where e.test_bug_id = bug.id and e.actor_user_id = $2::bigint
            and e.event_type = 'status_changed' and ${within('e.created_at')}
        ), false) as related_to_me
        from test_bugs bug join test_spaces space on space.id = bug.test_space_id
        where space.organization_id = $1::bigint and ${access}
          and ($5::bigint[] is null or bug.id = any($5::bigint[])) and (not $6::boolean or ${bugPeriodSql})
        order by bug.updated_at desc, bug.id desc ${ids ? '' : `limit ${limit + 1}`}`
    } else {
      sql = `select plan.id, space.id as parent_id, space.name as parent_name, plan.name as title, plan.status, plan.version_label,
        coalesce(${planMatchedDateSql}, plan.created_at) as date,
        coalesce(plan.owner_user_id = $2::bigint or plan.created_by_user_id = $2::bigint or counts.total > 0, false) as related_to_me,
        counts.*, (select coalesce(jsonb_agg(jsonb_build_object('id', subject.id, 'name', subject.name) order by subject.id), '[]'::jsonb)
          from test_subjects subject where subject.id in (select relation.test_subject_id from test_plan_subjects relation where relation.test_plan_id = plan.id)) as subjects
        from test_plans plan join test_spaces space on space.id = plan.test_space_id
        cross join lateral (select count(*)::int as total,
          (count(*) filter (where pc.result = 'passed'))::int as passed,
          (count(*) filter (where pc.result = 'failed'))::int as failed,
          (count(*) filter (where pc.result = 'blocked'))::int as blocked,
          (count(*) filter (where pc.result = 'skipped'))::int as skipped
          from test_plan_cases pc where pc.test_plan_id = plan.id and pc.executed_by_user_id = $2::bigint
            and pc.result <> 'untested' and ${within('pc.executed_at')}) counts
        where space.organization_id = $1::bigint and ${sourceSpaceAccessSql}
          and ($5::bigint[] is null or plan.id = any($5::bigint[])) and (not $6::boolean or (${planPeriodSql}))
        order by plan.updated_at desc, plan.id desc ${ids ? '' : `limit ${limit + 1}`}`
    }
    const result = await client.query<SourceRow>(sql, args)
    truncated[kind] = !ids && result.rows.length > limit
    for (const row of ids ? result.rows : result.rows.slice(0, limit)) {
      const date = formatShanghaiCalendarDate(row.date)
      const source: WeeklyReportSourceCandidate = {
        id: Number(row.id),
        ...(kind === 'bug' || kind === 'test_plan'
          ? { kind, testSpaceId: Number(row.parent_id) }
          : { kind, projectId: Number(row.parent_id) }),
        title: decryptText(row.title),
        projectName: decryptText(row.parent_name),
        status: row.status,
        date,
        matchedDate: date,
        matchReason:
          kind === 'bug'
            ? row.status === 'closed'
              ? '本周期关闭'
              : '修复区间与本周期相交'
            : '活动或计划日期命中本周期',
        relatedToMe: row.related_to_me,
      }
      if (kind === 'test_plan')
        Object.assign(source, {
          testSpaceName: source.projectName,
          versionLabel: decryptText(row.version_label ?? ''),
          testSubjects:
            row.subjects?.map((subject) => ({
              id: Number(subject.id),
              name: decryptText(subject.name),
            })) ?? [],
          personalExecutionStats: {
            total: Number(row.total),
            passed: Number(row.passed),
            failed: Number(row.failed),
            blocked: Number(row.blocked),
            skipped: Number(row.skipped),
          },
        })
      if (kind === 'bug') source.testSpaceName = source.projectName
      sources.push(source)
    }
  }
  return {
    sources,
    truncated,
    period,
    allowedSourceKinds: [...weeklyReportProfiles[profile].sourceKinds],
  }
}

export async function validateWeeklyReportSources(
  client: PoolClient,
  params: Parameters<typeof loadWeeklyReportSources>[1] & {
    refs: WeeklyReportSourceRef[]
    lock?: boolean
  },
) {
  if (
    !params.allowHistoricalKinds &&
    params.refs.some(
      (ref) => !allowsWeeklyReportSource(params.profile, ref.kind),
    )
  )
    throw new Error('当前周报身份不能关联此类工作')
  // Lock canonical resource rows before final eligibility checks. Bug transitions also
  // lock the Bug, so status validation and revision creation cannot straddle a transition.
  if (params.lock)
    await validateWeeklyReportSources(client, { ...params, lock: false })
  if (params.lock)
    for (const kind of ['bug', 'test_plan'] as const) {
      const ids = params.refs
        .filter((ref) => ref.kind === kind)
        .map((ref) => ref.id)
        .sort((a, b) => a - b)
      if (ids.length)
        await client.query(
          `select id from ${kind === 'bug' ? 'test_bugs' : 'test_plans'} where id = any($1::bigint[]) order by id for update`,
          [ids],
        )
    }
  const result = await loadWeeklyReportSources(client, params)
  const authorized = new Set(result.sources.map(weeklyReportSourceIdentity))
  if (
    params.refs.some((ref) => !authorized.has(weeklyReportSourceIdentity(ref)))
  )
    throw new Error(
      '有关联工作已不符合当前身份、权限、周期或 Bug 状态条件，请移除后重试',
    )
  return result.sources
}
