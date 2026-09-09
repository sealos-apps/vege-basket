import type express from 'express'
import { Router } from 'express'
import type { PoolClient } from 'pg'
import { decryptText, encryptText } from './crypto.ts'
import { pool } from './db.ts'
import {
  canManageOrganizationWeeklyReports,
  normalizeWeeklyReportRules,
  normalizeOrganizationWeekStart,
  type OrganizationAccessRole,
} from './organization-policy.ts'
import { getAuthenticatedRoleSession } from './roles.ts'
import { normalizePublicAppUrl } from './todo-digest.ts'
import { appendWeeklyReportDeepLink } from '../shared/weekly-report-deep-link.ts'
import { formatShanghaiCalendarDate } from '../shared/calendar-date.ts'
import {
  defaultWeeklyReportRules,
  getShanghaiDateTime,
  getWeeklyReportWindow,
  type WeeklyReportRules,
} from '../shared/weekly-report-availability.ts'
import {
  buildWeeklyReportGenerationSource,
  type WeeklyReportGenerationRole,
  type WeeklyReportJournalFact,
  type WeeklyReportProjectWorkStats,
  type WeeklyReportTesterPlanStats,
  type WeeklyReportWorkStats,
} from './weekly-report-generation.ts'
import { hasCanonicalWeeklyReportStructure } from '../shared/weekly-report-template.ts'

type WeeklyReportSourceKind = 'delivery' | 'milestone' | 'todo'
type WeeklyReportSourceMode = 'ai' | 'manual'

type WeeklyReportSourceRef = {
  id: number
  kind: WeeklyReportSourceKind
  projectId: number
}

type WeeklyReportSourceCandidate = WeeklyReportSourceRef & {
  date: string
  projectName: string
  relatedToMe: boolean
  status: string
  title: string
}

type WeeklyReportRouterDependencies = {
  generateWeeklyReport: (userId: number, source: string) => Promise<{
    error?: string
    message?: string
    status: number
  }>
  resolveFeishuOpenIdByEmail: (email: string) => Promise<string>
  sendFeishuMessage: (params: {
    content: Record<string, unknown> | string
    msgType: 'interactive' | 'text'
    receiveId: string
    receiveIdType: 'open_id'
  }) => Promise<{ messageId?: string } | void>
}

type OrganizationMembership = {
  access_role: OrganizationAccessRole
  organization_id: string
  weekly_report_required: boolean
}

class WeeklyReportError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function asyncRoute(
  handler: (request: express.Request, response: express.Response) => Promise<void>,
) {
  return (request: express.Request, response: express.Response, next: express.NextFunction) => {
    handler(request, response).catch((error) => {
      if (error instanceof WeeklyReportError) {
        response.status(error.status).json({ error: error.message })
        return
      }
      next(error)
    })
  }
}

function positiveId(value: unknown) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function paginationParam(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
) {
  if (value === undefined) return fallback
  const candidate = Array.isArray(value) ? value[0] : value
  if (typeof candidate !== 'string' && typeof candidate !== 'number') {
    throw new WeeklyReportError(400, `${label}参数无效`)
  }
  const parsed = Number(candidate)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new WeeklyReportError(400, `${label}参数无效`)
  }
  return parsed
}

function dateOnly(value: Date | string | null | undefined) {
  return formatShanghaiCalendarDate(value)
}

function displayName(row: { display_name?: string | null; email?: string | null }) {
  return String(row.display_name || row.email || '未知用户')
}

function sanitizeFeishuMarkdownText(value: unknown) {
  return String(value ?? '').replace(/</g, '＜').replace(/>/g, '＞').trim()
}

function normalizeSourceMode(value: unknown): WeeklyReportSourceMode {
  return value === 'ai' ? 'ai' : 'manual'
}

function normalizeSourceRefs(value: unknown) {
  if (!Array.isArray(value)) throw new WeeklyReportError(400, '周报来源格式无效')
  if (value.length > 80) throw new WeeklyReportError(400, '每份周报最多关联 80 个工作项')
  const unique = new Map<string, WeeklyReportSourceRef>()
  for (const item of value) {
    if (!item || typeof item !== 'object') throw new WeeklyReportError(400, '周报来源格式无效')
    const candidate = item as Record<string, unknown>
    const id = positiveId(candidate.id)
    const projectId = positiveId(candidate.projectId)
    const kind = candidate.kind
    if (!id || !projectId || (kind !== 'todo' && kind !== 'delivery' && kind !== 'milestone')) {
      throw new WeeklyReportError(400, '周报来源格式无效')
    }
    unique.set(`${kind}:${id}`, { id, kind, projectId })
  }
  return [...unique.values()]
}

const sourceProjectAccessSql = `
  project.organization_id = $1
  and (
    project.user_id = $2
    or exists (
      select 1 from project_memberships mine
      where mine.project_id = project.id
        and mine.invited_user_id = $2
        and mine.status = 'active'
    )
    or exists (
      select 1
      from organization_memberships manager
      join user_roles role on role.user_id = manager.user_id
      where manager.organization_id = $1
        and manager.user_id = $2
        and manager.status = 'active'
        and role.role = 'organization_admin'
    )
  )`

async function getMembership(client: PoolClient, organizationId: number, userId: number) {
  const result = await client.query<OrganizationMembership>(
    `select organization_id, access_role, weekly_report_required
     from organization_memberships
     where organization_id = $1 and user_id = $2 and status = 'active'`,
    [organizationId, userId],
  )
  return result.rows[0] ?? null
}

async function requireMember(client: PoolClient, organizationId: number, userId: number) {
  const membership = await getMembership(client, organizationId, userId)
  if (!membership) throw new WeeklyReportError(404, '组织不存在')
  return membership
}

async function requireWeeklyReportAssignee(
  client: PoolClient,
  organizationId: number,
  userId: number,
) {
  const result = await client.query<OrganizationMembership>(
    `select organization_id, access_role, weekly_report_required
     from organization_memberships
     where organization_id = $1
       and user_id = $2
       and status = 'active'
       and weekly_report_required = true
     for update`,
    [organizationId, userId],
  )
  if (!result.rows[0]) {
    const membership = await getMembership(client, organizationId, userId)
    if (!membership) throw new WeeklyReportError(404, '组织不存在')
    throw new WeeklyReportError(403, '当前无需填写周报')
  }
  return result.rows[0]
}

async function requireWeeklyReportManager(client: PoolClient, organizationId: number, userId: number) {
  const membership = await requireMember(client, organizationId, userId)
  const roles = await client.query<{ role: string }>(
    'select role from user_roles where user_id = $1 order by role',
    [userId],
  )
  if (!canManageOrganizationWeeklyReports(membership.access_role, roles.rows.map((row) => row.role))) {
    throw new WeeklyReportError(403, '需要组织管理员权限')
  }
  return membership
}

async function normalizeWeek(client: PoolClient, organizationId: number, value: unknown) {
  const organization = await client.query<{ week_starts_on: number }>(
    'select week_starts_on from organizations where id = $1',
    [organizationId],
  )
  if (!organization.rows[0]) throw new WeeklyReportError(404, '组织不存在')
  const weekStart = normalizeOrganizationWeekStart(value, organization.rows[0].week_starts_on)
  if (!weekStart || weekStart !== String(value)) {
    throw new WeeklyReportError(400, '周报周期无效')
  }
  return weekStart
}

async function getWeeklyReportRules(client: PoolClient, organizationId: number): Promise<WeeklyReportRules> {
  const organization = await client.query<{
    weekly_report_close_day: number
    weekly_report_close_time: string
    weekly_report_open_day: number
    weekly_report_open_time: string
  }>(
    `select weekly_report_open_day, weekly_report_open_time,
       weekly_report_close_day, weekly_report_close_time
     from organizations where id = $1`,
    [organizationId],
  )
  return normalizeWeeklyReportRules({
    closeDay: String(organization.rows[0]?.weekly_report_close_day ?? ''),
    closeTime: String(organization.rows[0]?.weekly_report_close_time ?? '').slice(0, 5),
    openDay: String(organization.rows[0]?.weekly_report_open_day ?? ''),
    openTime: String(organization.rows[0]?.weekly_report_open_time ?? '').slice(0, 5),
  }) ?? defaultWeeklyReportRules
}

function normalizeCalendarDate(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const date = new Date(`${raw}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw ? raw : null
}

async function normalizeExistingReportWeek(
  client: PoolClient,
  organizationId: number,
  userId: number,
  value: unknown,
) {
  const weekStart = normalizeCalendarDate(value)
  if (!weekStart) throw new WeeklyReportError(400, '周报周期无效')
  const organization = await client.query<{ week_starts_on: number }>(
    'select week_starts_on from organizations where id = $1',
    [organizationId],
  )
  if (!organization.rows[0]) throw new WeeklyReportError(404, '组织不存在')
  if (normalizeOrganizationWeekStart(weekStart, organization.rows[0].week_starts_on) === weekStart) {
    return weekStart
  }
  const existing = await client.query<{ id: string }>(
    `select id
     from organization_weekly_reports
     where organization_id = $1 and user_id = $2 and week_start = $3
     limit 1`,
    [organizationId, userId, weekStart],
  )
  if (existing.rows[0]) return weekStart
  // A report link can outlive a change to the organization's week start rule.
  // Keep exact historical rows addressable, but map a stale, valid calendar
  // date to the current canonical week instead of rejecting the editor.
  return normalizeOrganizationWeekStart(weekStart, organization.rows[0].week_starts_on) ?? weekStart
}

async function loadSourceCandidates(
  client: PoolClient,
  organizationId: number,
  userId: number,
): Promise<WeeklyReportSourceCandidate[]> {
  const todos = await client.query<{
      date: Date | string
      id: string
      project_id: string
      project_name: string
      related_to_me: boolean
      status: string
      title: string
    }>(
      `select todo.id, todo.project_id, project.name as project_name, todo.title,
         case when todo.done then 'completed' else todo.confirmation_status end as status,
         coalesce(todo.completed_at, todo.updated_at, todo.created_at) as date,
         ($2::bigint = any(array[
           project.user_id,
           todo.created_by_user_id,
           todo.assignee_user_id,
           todo.watcher_user_id,
           todo.reviewer_user_id,
           todo.completed_by_user_id
         ]::bigint[])) as related_to_me
       from todos todo
       join projects project on project.id = todo.project_id
       where ${sourceProjectAccessSql}
       order by todo.updated_at desc, todo.id desc
       limit 160`,
      [organizationId, userId],
    )
  const events = await client.query<{
      date: Date | string
      id: string
      project_id: string
      project_name: string
      related_to_me: boolean
      status: string
      title: string
    }>(
      `select event.id, event.project_id, project.name as project_name, event.title,
         event.status, coalesce(event.delivery_date, event.updated_at::date) as date,
         ($2::bigint = any(array[
           project.user_id,
           event.created_by_user_id,
           event.assignee_user_id,
           event.assigned_by_user_id
         ]::bigint[])) as related_to_me
       from project_package_events event
       join projects project on project.id = event.project_id
       where ${sourceProjectAccessSql}
       order by event.updated_at desc, event.id desc
       limit 120`,
      [organizationId, userId],
    )
  const milestones = await client.query<{
      date: Date | string
      id: string
      project_id: string
      project_name: string
      related_to_me: boolean
      status: string
      title: string
    }>(
      `select milestone.id, milestone.project_id, project.name as project_name,
         milestone.title, milestone.status, milestone.target_date as date,
         ($2::bigint = any(array[
           project.user_id,
           milestone.responsible_user_id,
           milestone.created_by_user_id,
           milestone.updated_by_user_id,
           milestone.submitted_by_user_id,
           milestone.completed_by_user_id
         ]::bigint[])) as related_to_me
       from project_milestones milestone
       join projects project on project.id = milestone.project_id
       where ${sourceProjectAccessSql}
       order by milestone.target_date desc, milestone.id desc
       limit 120`,
      [organizationId, userId],
    )
  const mapRows = (
    kind: WeeklyReportSourceKind,
    rows: typeof todos.rows,
  ): WeeklyReportSourceCandidate[] => rows.map((row) => ({
    date: dateOnly(row.date),
    id: Number(row.id),
    kind,
    projectId: Number(row.project_id),
    projectName: decryptText(row.project_name),
    relatedToMe: row.related_to_me,
    status: row.status,
    title: decryptText(row.title),
  }))
  return [
    ...mapRows('todo', todos.rows),
    ...mapRows('delivery', events.rows),
    ...mapRows('milestone', milestones.rows),
  ]
}

async function validateSourceRefs(
  client: PoolClient,
  organizationId: number,
  userId: number,
  refs: WeeklyReportSourceRef[],
) {
  if (refs.length === 0) return
  const grouped = {
    delivery: refs.filter((ref) => ref.kind === 'delivery').map((ref) => ref.id),
    milestone: refs.filter((ref) => ref.kind === 'milestone').map((ref) => ref.id),
    todo: refs.filter((ref) => ref.kind === 'todo').map((ref) => ref.id),
  }
  const todos = await client.query<{ id: string; project_id: string }>(
      `select todo.id, todo.project_id
       from todos todo
       join projects project on project.id = todo.project_id
       where ${sourceProjectAccessSql} and todo.id = any($3::bigint[])`,
      [organizationId, userId, grouped.todo],
    )
  const events = await client.query<{ id: string; project_id: string }>(
      `select event.id, event.project_id
       from project_package_events event
       join projects project on project.id = event.project_id
       where ${sourceProjectAccessSql} and event.id = any($3::bigint[])`,
      [organizationId, userId, grouped.delivery],
    )
  const milestones = await client.query<{ id: string; project_id: string }>(
      `select milestone.id, milestone.project_id
       from project_milestones milestone
       join projects project on project.id = milestone.project_id
       where ${sourceProjectAccessSql} and milestone.id = any($3::bigint[])`,
      [organizationId, userId, grouped.milestone],
    )
  const authorized = new Set([
    ...todos.rows.map((row) => `todo:${row.id}:${row.project_id}`),
    ...events.rows.map((row) => `delivery:${row.id}:${row.project_id}`),
    ...milestones.rows.map((row) => `milestone:${row.id}:${row.project_id}`),
  ])
  if (refs.some((ref) => !authorized.has(`${ref.kind}:${ref.id}:${ref.projectId}`))) {
    throw new WeeklyReportError(403, '存在无权关联的周报来源')
  }
}

function assertAuthorizedSources(
  refs: WeeklyReportSourceRef[],
  candidates: WeeklyReportSourceCandidate[],
) {
  const authorized = new Map(candidates.map((source) => [`${source.kind}:${source.id}`, source]))
  for (const ref of refs) {
    const candidate = authorized.get(`${ref.kind}:${ref.id}`)
    if (!candidate || candidate.projectId !== ref.projectId) {
      throw new WeeklyReportError(403, '存在无权关联的周报来源')
    }
  }
}

async function replaceDraftSources(
  client: PoolClient,
  reportId: number,
  refs: WeeklyReportSourceRef[],
) {
  await client.query(
    'delete from organization_weekly_report_sources where report_id = $1 and revision_id is null',
    [reportId],
  )
  for (const ref of refs) {
    await client.query(
      `insert into organization_weekly_report_sources
        (report_id, project_id, todo_id, package_event_id, milestone_id)
       values ($1, $2, $3, $4, $5)`,
      [
        reportId,
        ref.projectId,
        ref.kind === 'todo' ? ref.id : null,
        ref.kind === 'delivery' ? ref.id : null,
        ref.kind === 'milestone' ? ref.id : null,
      ],
    )
  }
}

async function saveDraft(params: {
  content: string
  expectedVersion: number
  organizationId: number
  sourceMode: WeeklyReportSourceMode
  sources: WeeklyReportSourceRef[]
  userId: number
  weekStart: string
}) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
      [`weekly-report:${params.organizationId}:${params.userId}:${params.weekStart}`],
    )
    await requireWeeklyReportAssignee(client, params.organizationId, params.userId)
    const weekStart = await normalizeExistingReportWeek(
      client,
      params.organizationId,
      params.userId,
      params.weekStart,
    )
    await validateSourceRefs(client, params.organizationId, params.userId, params.sources)
    const current = await client.query<{
      draft_version: number
      id: string
      published_revision_id: string | null
    }>(
      `select id, draft_version, published_revision_id
       from organization_weekly_reports
       where organization_id = $1 and user_id = $2 and week_start = $3
       for update`,
      [params.organizationId, params.userId, weekStart],
    )
    const report = current.rows[0]
    if ((report?.draft_version ?? 0) !== params.expectedVersion) {
      throw new WeeklyReportError(409, '周报已在其他窗口更新，请刷新后重试')
    }
    let reportId: number
    if (!report) {
      const rules = await getWeeklyReportRules(client, params.organizationId)
      const window = getWeeklyReportWindow({ rules, weekStart })
      const now = getShanghaiDateTime()
      if (now < window.opensAt || now > window.closesAt) {
        throw new WeeklyReportError(409, '当前不在周报可填写时段内')
      }
      const inserted = await client.query<{ id: string }>(
        `insert into organization_weekly_reports (
           organization_id, user_id, week_start, content, status,
           draft_content, draft_version, draft_source_mode
         ) values ($1, $2, $3, $4, 'draft', $4, 1, $5)
         returning id`,
        [params.organizationId, params.userId, weekStart, encryptText(params.content), params.sourceMode],
      )
      reportId = Number(inserted.rows[0].id)
    } else {
      reportId = Number(report.id)
      await client.query(
        `update organization_weekly_reports
         set draft_content = $1,
             draft_version = draft_version + 1,
             draft_source_mode = $2,
             content = case when published_revision_id is null then $1 else content end,
             status = case when published_revision_id is null then 'draft' else status end,
             updated_at = now()
         where id = $3`,
        [encryptText(params.content), params.sourceMode, reportId],
      )
    }
    await replaceDraftSources(client, reportId, params.sources)
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

async function getWeeklyReport(organizationId: number, userId: number, weekStart: string) {
  const client = await pool.connect()
  try {
    await requireMember(client, organizationId, userId)
    const normalizedWeekStart = await normalizeExistingReportWeek(client, organizationId, userId, weekStart)
    const reportResult = await client.query<{
      draft_content: string
      draft_source_mode: WeeklyReportSourceMode
      draft_version: number
      id: string
      published_content: string | null
      published_draft_version: number | null
      published_revision_number: number | null
      published_submitted_at: Date | null
    }>(
      `select report.id, report.draft_content, report.draft_version,
         report.draft_source_mode, revision.content as published_content,
         revision.draft_version as published_draft_version,
         revision.revision_number as published_revision_number,
         revision.submitted_at as published_submitted_at
       from organization_weekly_reports report
       left join organization_weekly_report_revisions revision
         on revision.id = report.published_revision_id
       where report.organization_id = $1 and report.user_id = $2 and report.week_start = $3`,
      [organizationId, userId, normalizedWeekStart],
    )
    const report = reportResult.rows[0]
    const sources = report
      ? await client.query<{
        id: string
        kind: WeeklyReportSourceKind
        project_id: string
      }>(
        `select project_id,
           case
             when todo_id is not null then 'todo'
             when package_event_id is not null then 'delivery'
             else 'milestone'
           end as kind,
           coalesce(todo_id, package_event_id, milestone_id) as id
         from organization_weekly_report_sources
         where report_id = $1 and revision_id is null
         order by id`,
        [report.id],
      )
      : { rows: [] }
    const draftVersion = report?.draft_version ?? 0
    const publishedRevision = report?.published_revision_number ?? null
    const state = !report
      ? 'empty'
      : !publishedRevision
        ? 'draft'
        : report.published_draft_version === draftVersion
          ? 'submitted'
          : 'modified'
    return {
      content: report ? decryptText(report.draft_content) : '',
      draftVersion,
      publishedContent: report?.published_content ? decryptText(report.published_content) : '',
      publishedRevision,
      sourceMode: report?.draft_source_mode ?? 'manual',
      sources: sources.rows.map((source) => ({
        id: Number(source.id),
        kind: source.kind,
        projectId: Number(source.project_id),
      })),
      state,
      submittedAt: report?.published_submitted_at?.toISOString() ?? null,
      weekStart: normalizedWeekStart,
    }
  } finally {
    client.release()
  }
}

async function listWeeklyReports(
  organizationId: number,
  userId: number,
  limit: number,
  offset: number,
) {
  const client = await pool.connect()
  try {
    await requireMember(client, organizationId, userId)
    const countResult = await client.query<{ total: string }>(
      `select count(*) as total
       from organization_weekly_reports
       where organization_id = $1 and user_id = $2`,
      [organizationId, userId],
    )
    const reportResult = await client.query<{
      draft_version: number
      published_draft_version: number | null
      published_revision_number: number | null
      published_submitted_at: Date | null
      source_count: string
      updated_at: Date
      week_start: Date | string
    }>(
      `select report.week_start, report.draft_version, report.updated_at,
         revision.draft_version as published_draft_version,
         revision.revision_number as published_revision_number,
         revision.submitted_at as published_submitted_at,
         (
           select count(*)
           from organization_weekly_report_sources source
           where source.report_id = report.id and source.revision_id is null
         ) as source_count
       from organization_weekly_reports report
       left join organization_weekly_report_revisions revision
         on revision.id = report.published_revision_id
       where report.organization_id = $1 and report.user_id = $2
       order by report.week_start desc, report.id desc
       limit $3 offset $4`,
      [organizationId, userId, limit, offset],
    )
    return {
      items: reportResult.rows.map((report) => ({
        publishedRevision: report.published_revision_number,
        sourceCount: Number(report.source_count),
        state: !report.published_revision_number
          ? 'draft'
          : report.published_draft_version === report.draft_version
            ? 'submitted'
            : 'modified',
        submittedAt: report.published_submitted_at?.toISOString() ?? null,
        updatedAt: report.updated_at.toISOString(),
        weekStart: dateOnly(report.week_start),
      })),
      limit,
      offset,
      total: Number(countResult.rows[0]?.total ?? 0),
    }
  } finally {
    client.release()
  }
}

async function submitWeeklyReport(params: {
  expectedVersion: number
  organizationId: number
  userId: number
  weekStart: string
}) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
      [`weekly-report:${params.organizationId}:${params.userId}:${params.weekStart}`],
    )
    await requireWeeklyReportAssignee(client, params.organizationId, params.userId)
    const weekStart = await normalizeExistingReportWeek(
      client,
      params.organizationId,
      params.userId,
      params.weekStart,
    )
    const current = await client.query<{
      draft_content: string
      draft_source_mode: WeeklyReportSourceMode
      draft_version: number
      id: string
    }>(
      `select id, draft_content, draft_version, draft_source_mode
       from organization_weekly_reports
       where organization_id = $1 and user_id = $2 and week_start = $3
       for update`,
      [params.organizationId, params.userId, weekStart],
    )
    const report = current.rows[0]
    if (!report || report.draft_version !== params.expectedVersion) {
      throw new WeeklyReportError(409, '周报已更新，请刷新后重新确认')
    }
    const content = decryptText(report.draft_content).trim()
    if (!content) throw new WeeklyReportError(400, '周报正文不能为空')
    const nextRevision = await client.query<{ revision_number: number }>(
      `select coalesce(max(revision_number), 0) + 1 as revision_number
       from organization_weekly_report_revisions where report_id = $1`,
      [report.id],
    )
    const revision = await client.query<{ id: string }>(
      `insert into organization_weekly_report_revisions (
         report_id, revision_number, draft_version, content, source_mode,
         submitted_by_user_id
       ) values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [
        report.id,
        nextRevision.rows[0].revision_number,
        report.draft_version,
        report.draft_content,
        report.draft_source_mode,
        params.userId,
      ],
    )
    await client.query(
      `insert into organization_weekly_report_sources (
         report_id, revision_id, project_id, todo_id, package_event_id, milestone_id
       )
       select report_id, $2, project_id, todo_id, package_event_id, milestone_id
       from organization_weekly_report_sources
       where report_id = $1 and revision_id is null`,
      [report.id, revision.rows[0].id],
    )
    await client.query(
      `update organization_weekly_reports
       set published_revision_id = $1,
           content = draft_content,
           status = 'submitted',
           submitted_at = now(),
           updated_at = now()
       where id = $2`,
      [revision.rows[0].id, report.id],
    )
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function weeklyReportPeriod(weekStart: string) {
  return {
    start: `${weekStart}T00:00:00+08:00`,
    end: `${shiftDate(weekStart, 7)}T00:00:00+08:00`,
  }
}

type WeeklyReportGenerationFacts = {
  journals: WeeklyReportJournalFact[]
  testerPlans: WeeklyReportTesterPlanStats[]
  workStats: WeeklyReportWorkStats
}

const emptyWorkStats = (): WeeklyReportWorkStats => ({ projects: [] })

function countValue(value: string | number | null | undefined) {
  return Number(value ?? 0)
}

async function loadGenerationFacts(
  client: PoolClient,
  organizationId: number,
  userId: number,
  weekStart: string,
  role: WeeklyReportGenerationRole,
): Promise<WeeklyReportGenerationFacts> {
  const period = weeklyReportPeriod(weekStart)
  if (role === 'tester') {
    const plans = await client.query<{
      blocked: string
      executed: string
      failed: string
      passed: string
      plan_name: string
      skipped: string
      test_target: string
    }>(
      `select p.id, p.name as plan_name, subject.name as test_target,
         count(pc.id)::int as executed,
         (count(pc.id) filter (where pc.result = 'passed'))::int as passed,
         (count(pc.id) filter (where pc.result = 'failed'))::int as failed,
         (count(pc.id) filter (where pc.result = 'blocked'))::int as blocked,
         (count(pc.id) filter (where pc.result = 'skipped'))::int as skipped
       from test_plans p
       join test_spaces space on space.id = p.test_space_id
       join test_subjects subject on subject.id = p.test_subject_id
       join test_plan_cases pc on pc.test_plan_id = p.id
       left join test_space_memberships mine
         on mine.test_space_id = p.test_space_id
        and mine.user_id = $2::bigint
        and mine.status = 'active'
       where space.organization_id = $1::bigint
         and (mine.test_space_id is not null or exists (
           select 1
           from organization_memberships manager
           join user_roles organization_admin_role
             on organization_admin_role.user_id = manager.user_id
            and organization_admin_role.role = 'organization_admin'
           where manager.organization_id = $1::bigint
             and manager.user_id = $2::bigint
             and manager.status = 'active'
         ))
         and pc.executed_by_user_id = $2::bigint
         and pc.executed_at >= $3::timestamptz
         and pc.executed_at < $4::timestamptz
       group by p.id, p.name, subject.name
       order by p.id`,
      [organizationId, userId, period.start, period.end],
    )
    return {
      journals: [],
      testerPlans: plans.rows.map((row) => ({
        blocked: countValue(row.blocked),
        executed: countValue(row.executed),
        failed: countValue(row.failed),
        passed: countValue(row.passed),
        planName: decryptText(row.plan_name),
        skipped: countValue(row.skipped),
        testTarget: decryptText(row.test_target),
      })),
      workStats: emptyWorkStats(),
    }
  }

  const journals = await client.query<{
    content: string
    journal_date: string
    project_name: string
  }>(
    `select to_char(journal.created_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD') as journal_date,
       project.name as project_name, journal.content
     from journal_entries journal
     join projects project on project.id = journal.project_id
     where ${sourceProjectAccessSql}
       and (journal.author_user_id = $2::bigint
         or (journal.author_user_id is null and project.user_id = $2::bigint))
       and journal.created_at >= $3::timestamptz
       and journal.created_at < $4::timestamptz
     order by journal.created_at, journal.id`,
    [organizationId, userId, period.start, period.end],
  )
  const todoStats = await client.query<{
    completed: string
    pending_review: string
    project_id: string
    project_name: string
    total: string
    unfinished: string
  }>(
    `select project.id::text as project_id, project.name as project_name,
       count(*)::int as total,
       (count(*) filter (where todo.done))::int as completed,
       (count(*) filter (where not todo.done and todo.confirmation_status = 'pending_review'))::int as pending_review,
       (count(*) filter (where not todo.done and todo.confirmation_status <> 'rejected'))::int as unfinished
     from todos todo
     join projects project on project.id = todo.project_id
     where ${sourceProjectAccessSql}
       and $2::bigint = any(array[
         project.user_id, todo.created_by_user_id, todo.assignee_user_id,
         todo.watcher_user_id, todo.reviewer_user_id, todo.completed_by_user_id
       ]::bigint[])
       and todo.updated_at >= $3::timestamptz
       and todo.updated_at < $4::timestamptz
     group by project.id, project.name
     order by project.id`,
    [organizationId, userId, period.start, period.end],
  )
  const deliveryStats = await client.query<{
    delivered: string
    project_id: string
    project_name: string
    total: string
  }>(
    `select project.id::text as project_id, project.name as project_name,
       count(*)::int as total,
       (count(*) filter (where event.status = 'delivered'))::int as delivered
     from project_package_events event
     join projects project on project.id = event.project_id
     where ${sourceProjectAccessSql}
       and $2::bigint = any(array[
         project.user_id, event.created_by_user_id, event.assignee_user_id,
         event.assigned_by_user_id
       ]::bigint[])
       and event.updated_at >= $3::timestamptz
       and event.updated_at < $4::timestamptz
     group by project.id, project.name
     order by project.id`,
    [organizationId, userId, period.start, period.end],
  )
  const projectStats = new Map<string, WeeklyReportProjectWorkStats>()
  for (const row of todoStats.rows) {
    projectStats.set(row.project_id, {
      projectName: decryptText(row.project_name),
      todoTotal: countValue(row.total),
      todoCompleted: countValue(row.completed),
      todoPendingReview: countValue(row.pending_review),
      todoUnfinished: countValue(row.unfinished),
      deliveryTotal: 0,
      deliveryDelivered: 0,
      deliveryUnfinished: 0,
    })
  }
  for (const row of deliveryStats.rows) {
    const existing = projectStats.get(row.project_id) ?? {
      projectName: decryptText(row.project_name),
      todoTotal: 0,
      todoCompleted: 0,
      todoPendingReview: 0,
      todoUnfinished: 0,
      deliveryTotal: 0,
      deliveryDelivered: 0,
      deliveryUnfinished: 0,
    }
    existing.deliveryTotal = countValue(row.total)
    existing.deliveryDelivered = countValue(row.delivered)
    existing.deliveryUnfinished = existing.deliveryTotal - existing.deliveryDelivered
    projectStats.set(row.project_id, existing)
  }
  const workStats: WeeklyReportWorkStats = { projects: [...projectStats.values()] }
  return {
    journals: journals.rows.map((row) => ({
      content: decryptText(row.content),
      date: row.journal_date,
      projectName: decryptText(row.project_name),
    })),
    testerPlans: [],
    workStats,
  }
}

function shanghaiDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).formatToParts(new Date())
  const pick = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((part) => part.type === type)?.value ?? ''
  )
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}

async function loadCollection(client: PoolClient, organizationId: number, weekStart: string) {
  const result = await client.query<{
    display_name: string | null
    draft_version: number | null
    email: string
    feishu_email: string | null
    feishu_user_id: string | null
    published_content: string | null
    published_draft_version: number | null
    revision_number: number | null
    submitted_at: Date | null
    user_id: string
  }>(
    `select membership.user_id, users.email, users.display_name,
       users.feishu_email, users.feishu_user_id,
       report.draft_version, revision.content as published_content,
       revision.draft_version as published_draft_version,
       revision.revision_number, revision.submitted_at
     from organization_memberships membership
     join users on users.id = membership.user_id
     left join organization_weekly_reports report
       on report.organization_id = membership.organization_id
      and report.user_id = membership.user_id
      and report.week_start = $2
     left join organization_weekly_report_revisions revision
       on revision.id = report.published_revision_id
     where membership.organization_id = $1
       and membership.status = 'active'
       and membership.weekly_report_required = true
       and lower(users.email) <> 'admin'
     order by lower(coalesce(nullif(users.display_name, ''), users.email))`,
    [organizationId, weekStart],
  )
  return result.rows.map((row) => ({
    content: row.published_content ? decryptText(row.published_content) : '',
    feishuBound: Boolean(row.feishu_user_id || row.feishu_email),
    memberName: displayName(row),
    state: !row.draft_version
      ? 'empty'
      : !row.revision_number
        ? 'draft'
        : row.published_draft_version === row.draft_version
          ? 'submitted'
          : 'modified',
    submittedAt: row.submitted_at?.toISOString() ?? null,
    userId: Number(row.user_id),
    revision: row.revision_number,
  }))
}

function buildReminderCard(params: {
  organizationName: string
  requestedByName: string
  weekStart: string
  url: string
}) {
  return {
    config: { wide_screen_mode: true },
    elements: [
      {
        tag: 'div',
        text: {
          content: `${sanitizeFeishuMarkdownText(params.requestedByName)} 提醒你填写「${sanitizeFeishuMarkdownText(params.organizationName)}」${params.weekStart} 当周的周报。`,
          tag: 'lark_md',
        },
      },
      {
        actions: [{
          tag: 'button',
          text: { content: '去填写', tag: 'plain_text' },
          type: 'primary',
          url: params.url,
        }],
        tag: 'action',
      },
    ],
    header: {
      template: 'green',
      title: { content: '周报填写提醒', tag: 'plain_text' },
    },
  }
}

export function createWeeklyReportRouter(dependencies: WeeklyReportRouterDependencies) {
  const router = Router()

  router.get('/weekly-reports/:organizationId', asyncRoute(async (request, response) => {
    const session = await getAuthenticatedRoleSession(request)
    if (!session) {
      response.status(401).json({ error: 'Unauthorized' })
      return
    }
    const organizationId = positiveId(request.params.organizationId)
    if (!organizationId) throw new WeeklyReportError(400, '组织参数无效')
    const limit = paginationParam(request.query.limit, 10, 1, 50, '分页大小')
    const offset = paginationParam(request.query.offset, 0, 0, 100_000, '分页位置')
    response.json(await listWeeklyReports(organizationId, session.userId, limit, offset))
  }))

  router.get('/weekly-reports/:organizationId/:weekStart', asyncRoute(async (request, response) => {
    const session = await getAuthenticatedRoleSession(request)
    if (!session) {
      response.status(401).json({ error: 'Unauthorized' })
      return
    }
    const organizationId = positiveId(request.params.organizationId)
    if (!organizationId) throw new WeeklyReportError(400, '组织参数无效')
    const weekStart = routeParam(request.params.weekStart)
    response.json(await getWeeklyReport(organizationId, session.userId, weekStart))
  }))

  router.get('/weekly-reports/:organizationId/:weekStart/sources', asyncRoute(async (request, response) => {
    const session = await getAuthenticatedRoleSession(request)
    if (!session) {
      response.status(401).json({ error: 'Unauthorized' })
      return
    }
    const organizationId = positiveId(request.params.organizationId)
    if (!organizationId) throw new WeeklyReportError(400, '组织参数无效')
    const client = await pool.connect()
    try {
      await requireMember(client, organizationId, session.userId)
      await normalizeExistingReportWeek(
        client,
        organizationId,
        session.userId,
        routeParam(request.params.weekStart),
      )
      response.json({ sources: await loadSourceCandidates(client, organizationId, session.userId) })
    } finally {
      client.release()
    }
  }))

  router.put('/weekly-reports/:organizationId/:weekStart/draft', asyncRoute(async (request, response) => {
    const session = await getAuthenticatedRoleSession(request)
    if (!session) {
      response.status(401).json({ error: 'Unauthorized' })
      return
    }
    const organizationId = positiveId(request.params.organizationId)
    const expectedVersion = Number(request.body?.expectedVersion)
    if (!organizationId || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      throw new WeeklyReportError(400, '周报版本参数无效')
    }
    const content = String(request.body?.content ?? '').trim().slice(0, 12_000)
    const sources = normalizeSourceRefs(request.body?.sources ?? [])
    await saveDraft({
      content,
      expectedVersion,
      organizationId,
      sourceMode: normalizeSourceMode(request.body?.sourceMode),
      sources,
      userId: session.userId,
      weekStart: routeParam(request.params.weekStart),
    })
    response.json(await getWeeklyReport(organizationId, session.userId, routeParam(request.params.weekStart)))
  }))

  router.post('/weekly-reports/:organizationId/:weekStart/generate', asyncRoute(async (request, response) => {
    const session = await getAuthenticatedRoleSession(request)
    if (!session) {
      response.status(401).json({ error: 'Unauthorized' })
      return
    }
    const organizationId = positiveId(request.params.organizationId)
    const expectedVersion = Number(request.body?.expectedVersion)
    if (!organizationId || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      throw new WeeklyReportError(400, '周报版本参数无效')
    }
    const requestedSources = normalizeSourceRefs(request.body?.sources ?? [])
    const client = await pool.connect()
    let organizationName: string
    let userName: string
    let generationSources: WeeklyReportSourceCandidate[]
    let generationFacts: WeeklyReportGenerationFacts
    let normalizedWeekStart: string
    try {
      await requireWeeklyReportAssignee(client, organizationId, session.userId)
      normalizedWeekStart = await normalizeExistingReportWeek(
        client,
        organizationId,
        session.userId,
        routeParam(request.params.weekStart),
      )
      const organization = await client.query<{ name: string; user_name: string }>(
        `select organization.name,
           coalesce(nullif(users.display_name, ''), users.email)::text as user_name
         from organizations organization
         join users on users.id = $2::bigint
         where organization.id = $1::bigint`,
        [organizationId, session.userId],
      )
      if (!organization.rows[0]) throw new WeeklyReportError(404, '组织不存在')
      organizationName = decryptText(organization.rows[0].name)
      userName = organization.rows[0].user_name
      const candidates = await loadSourceCandidates(client, organizationId, session.userId)
      assertAuthorizedSources(requestedSources, candidates)
      generationSources = requestedSources.length > 0
        ? requestedSources.map((ref) => candidates.find((candidate) => (
          candidate.kind === ref.kind && candidate.id === ref.id
        ))!).filter(Boolean)
        : candidates.filter((candidate) => candidate.relatedToMe).slice(0, 80)
      generationFacts = await loadGenerationFacts(
        client,
        organizationId,
        session.userId,
        normalizedWeekStart,
        session.activeRole === 'tester' ? 'tester' : 'developer',
      )
    } finally {
      client.release()
    }
    const generated = await dependencies.generateWeeklyReport(
      session.userId,
      buildWeeklyReportGenerationSource({
        organizationName,
        userName,
        weekStart: normalizedWeekStart,
        role: session.activeRole === 'tester' ? 'tester' : 'developer',
        journals: generationFacts.journals,
        testerPlans: generationFacts.testerPlans,
        workStats: generationFacts.workStats,
      }),
    )
    if (!generated.message) {
      response.status(generated.status).json({ error: generated.error ?? 'AI 周报生成失败' })
      return
    }
    if (!hasCanonicalWeeklyReportStructure(generated.message)) {
      response.status(502).json({ error: 'AI 返回的周报结构不完整，请重试' })
      return
    }
    const refs = generationSources.map(({ id, kind, projectId }) => ({ id, kind, projectId }))
    await saveDraft({
      content: generated.message,
      expectedVersion,
      organizationId,
      sourceMode: 'ai',
      sources: refs,
      userId: session.userId,
      weekStart: normalizedWeekStart,
    })
    response.json(await getWeeklyReport(organizationId, session.userId, normalizedWeekStart))
  }))

  router.post('/weekly-reports/:organizationId/:weekStart/submit', asyncRoute(async (request, response) => {
    const session = await getAuthenticatedRoleSession(request)
    if (!session) {
      response.status(401).json({ error: 'Unauthorized' })
      return
    }
    const organizationId = positiveId(request.params.organizationId)
    const expectedVersion = Number(request.body?.expectedVersion)
    if (!organizationId || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new WeeklyReportError(400, '周报版本参数无效')
    }
    await submitWeeklyReport({
      expectedVersion,
      organizationId,
      userId: session.userId,
      weekStart: routeParam(request.params.weekStart),
    })
    response.json(await getWeeklyReport(organizationId, session.userId, routeParam(request.params.weekStart)))
  }))

  router.get('/organizations/:organizationId/weekly-report-collection/:weekStart', asyncRoute(async (request, response) => {
    const session = await getAuthenticatedRoleSession(request)
    if (!session) {
      response.status(401).json({ error: 'Unauthorized' })
      return
    }
    const organizationId = positiveId(request.params.organizationId)
    if (!organizationId) throw new WeeklyReportError(400, '组织参数无效')
    const client = await pool.connect()
    try {
      await requireWeeklyReportManager(client, organizationId, session.userId)
      const weekStart = await normalizeWeek(client, organizationId, routeParam(request.params.weekStart))
      response.json({ members: await loadCollection(client, organizationId, weekStart), weekStart })
    } finally {
      client.release()
    }
  }))

  router.post('/organizations/:organizationId/weekly-report-reminders/:weekStart', asyncRoute(async (request, response) => {
    const session = await getAuthenticatedRoleSession(request)
    if (!session) {
      response.status(401).json({ error: 'Unauthorized' })
      return
    }
    const organizationId = positiveId(request.params.organizationId)
    if (!organizationId) throw new WeeklyReportError(400, '组织参数无效')
    const targetUserIds = Array.isArray(request.body?.userIds)
      ? [...new Set(request.body.userIds
        .map((value: unknown) => positiveId(value))
        .filter((id: number | null): id is number => Boolean(id)))]
      : []
    if (targetUserIds.length === 0) throw new WeeklyReportError(400, '请选择需要提醒的成员')
    if (targetUserIds.length > 100) throw new WeeklyReportError(400, '单次最多提醒 100 名成员')
    const client = await pool.connect()
    let weekStart: string
    let organizationName: string
    let requesterName: string
    let candidates: Array<{
      email: string
      feishu_email: string | null
      feishu_user_id: string | null
      user_id: string
    }>
    try {
      await requireWeeklyReportManager(client, organizationId, session.userId)
      weekStart = await normalizeWeek(client, organizationId, routeParam(request.params.weekStart))
      const organization = await client.query<{
        name: string
        requester_display_name: string | null
        requester_email: string
      }>(
        `select organization.name, users.email as requester_email,
           users.display_name as requester_display_name
         from organizations organization
         join users on users.id = $2
         where organization.id = $1`,
        [organizationId, session.userId],
      )
      organizationName = decryptText(organization.rows[0].name)
      requesterName = displayName({
        display_name: organization.rows[0].requester_display_name,
        email: organization.rows[0].requester_email,
      })
      const members = await client.query<{
        email: string
        feishu_email: string | null
        feishu_user_id: string | null
        user_id: string
      }>(
        `select membership.user_id, users.email, users.feishu_email, users.feishu_user_id
         from organization_memberships membership
         join users on users.id = membership.user_id
         left join organization_weekly_reports report
           on report.organization_id = membership.organization_id
          and report.user_id = membership.user_id
          and report.week_start = $2
         where membership.organization_id = $1
           and membership.status = 'active'
           and membership.weekly_report_required = true
           and lower(users.email) <> 'admin'
           and report.published_revision_id is null
           and coalesce(report.status, 'draft') <> 'submitted'
           and membership.user_id = any($3::bigint[])
         order by membership.user_id`,
        [organizationId, weekStart, targetUserIds],
      )
      candidates = members.rows
    } finally {
      client.release()
    }
    if (candidates.length === 0) {
      response.json({ failed: 0, sent: 0, skipped: targetUserIds.length })
      return
    }
    const publicAppUrl = normalizePublicAppUrl(process.env.APP_PUBLIC_URL)
    if (!publicAppUrl) throw new WeeklyReportError(503, 'APP_PUBLIC_URL 未配置，无法生成填写链接')
    const url = appendWeeklyReportDeepLink(publicAppUrl, organizationId, weekStart)
    const totals = { failed: 0, sent: 0, skipped: 0 }
    for (const candidate of candidates) {
      let openId = String(candidate.feishu_user_id ?? '').trim()
      const feishuEmail = String(candidate.feishu_email ?? '').trim().toLowerCase()
      if (!openId.startsWith('ou_') && feishuEmail) {
        try {
          openId = await dependencies.resolveFeishuOpenIdByEmail(feishuEmail)
        } catch {
          openId = ''
        }
      }
      const reminder = await pool.query<{ id: string; status: string }>(
        `insert into organization_weekly_report_reminders (
           organization_id, target_user_id, requested_by_user_id,
           week_start, reminder_day, status
         ) values ($1, $2, $3, $4, $5, 'pending')
         on conflict (organization_id, target_user_id, week_start, reminder_day)
         do update set
           requested_by_user_id = excluded.requested_by_user_id,
           status = case
             when organization_weekly_report_reminders.status = 'sent' then 'sent'
             else 'pending'
           end,
           last_error = case
             when organization_weekly_report_reminders.status = 'sent'
               then organization_weekly_report_reminders.last_error
             else ''
           end,
           updated_at = now()
         returning id, status`,
        [organizationId, candidate.user_id, session.userId, weekStart, shanghaiDate()],
      )
      if (reminder.rows[0].status === 'sent') {
        totals.skipped += 1
        continue
      }
      if (!openId.startsWith('ou_')) {
        await pool.query(
          `update organization_weekly_report_reminders
           set status = 'skipped', last_error = '未绑定飞书账号', updated_at = now()
           where id = $1`,
          [reminder.rows[0].id],
        )
        totals.skipped += 1
        continue
      }
      try {
        await dependencies.sendFeishuMessage({
          content: buildReminderCard({
            organizationName,
            requestedByName: requesterName,
            url,
            weekStart,
          }),
          msgType: 'interactive',
          receiveId: openId,
          receiveIdType: 'open_id',
        })
        await pool.query(
          `update organization_weekly_report_reminders
           set status = 'sent', last_error = '', delivered_at = now(), updated_at = now()
           where id = $1`,
          [reminder.rows[0].id],
        )
        totals.sent += 1
      } catch (error) {
        await pool.query(
          `update organization_weekly_report_reminders
           set status = 'failed', last_error = $2, updated_at = now()
           where id = $1`,
          [
            reminder.rows[0].id,
            error instanceof Error ? error.message.slice(0, 500) : '飞书消息发送失败',
          ],
        )
        totals.failed += 1
      }
    }
    response.json(totals)
  }))

  return router
}
