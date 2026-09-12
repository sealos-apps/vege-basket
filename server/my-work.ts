import type { MyWorkData, MyWorkFilters, MyWorkItem } from '../src/my-work-types.ts'
import { decryptText } from './crypto.ts'
import { query } from './db.ts'
import { managedOrganizationReadScopeSql } from './organization-scope.ts'
import { workBucket, workItemKey } from './my-work-policy.ts'
import type { OrganizationContext } from '../shared/organization-context.ts'

type MyWorkRow = {
  kind: MyWorkItem['kind']
  source_id: string
  project_id: string | null
  organization_id: string | null
  project_name: string | null
  context_name: string | null
  creator_name: string | null
  can_complete: boolean | null
  title: string
  status: string
  priority: 'high' | 'medium' | 'low' | null
  offboarding_transferred_from_name: string | null
  due_at: string | null
  updated_at: Date
  relation: MyWorkItem['relation']
}

function localDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function weekEnd(today: string) {
  const date = new Date(`${today}T00:00:00Z`)
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + (7 - day))
  return date.toISOString().slice(0, 10)
}

function searchable(item: MyWorkItem, q?: string) {
  if (!q) return true
  const needle = q.toLocaleLowerCase()
  return [item.title, item.projectName, item.contextName, item.creatorName, item.status]
    .filter(Boolean)
    .some((value) => value?.toLocaleLowerCase().includes(needle))
}

export async function getMyWork(
  userId: number,
  organizationId: OrganizationContext,
  filters: MyWorkFilters,
): Promise<MyWorkData> {
  const result = await query<MyWorkRow>(
    `
    select * from (
      select 'todo'::text as kind, t.id as source_id, t.project_id, p.organization_id,
        p.name as project_name, subproject.name as context_name,
        coalesce(nullif(todo_creator.display_name, ''), todo_creator.email)::text as creator_name,
        (
          t.reviewer_user_id = $1::bigint
          and (t.confirmation_status = 'pending_review' or t.done)
        ) as can_complete,
        t.title,
        case when t.done then 'completed' else t.confirmation_status end as status,
        t.priority, t.due_date::text as due_at, t.updated_at,
        case
          when t.reviewer_user_id = $1 then 'reviewer'
          else 'assignee'
        end as relation,
        (
          select coalesce(nullif(departed_user.display_name, ''), departed_user.email)
          from account_offboarding_asset_transfers transfer
          join users departed_user on departed_user.id = transfer.previous_assignee_user_id
          where transfer.asset_type = 'todo'
            and transfer.asset_id = t.id
            and transfer.next_assignee_user_id = $1::bigint
            and transfer.action = 'transferred'
          order by transfer.created_at desc, transfer.id desc
          limit 1
        ) as offboarding_transferred_from_name
      from todos t
      join projects p on p.id = t.project_id
      left join project_subprojects subproject on subproject.id = t.subproject_id and subproject.project_id = t.project_id
      left join users todo_creator on todo_creator.id = t.created_by_user_id
      left join project_memberships mine
        on mine.project_id = p.id and mine.invited_user_id = $1 and mine.status = 'active'
      where (
          (
            t.assignee_user_id = $1
            and t.confirmation_status <> 'pending_review'
          )
          or t.reviewer_user_id = $1
        )
        and (${managedOrganizationReadScopeSql('p.organization_id', '$1')} or p.user_id = $1 or mine.id is not null)
        and t.confirmation_status <> 'rejected'
      union all
      select 'delivery'::text, e.id, e.project_id, p.organization_id, p.name, null::text,
        coalesce(nullif(delivery_creator.display_name, ''), delivery_creator.email)::text,
        null::boolean,
        e.title,
        e.status, null::text, e.delivery_date::text, e.updated_at, 'assignee'::text,
        null::text as offboarding_transferred_from_name
      from project_package_events e
      join projects p on p.id = e.project_id
      left join users delivery_creator on delivery_creator.id = e.created_by_user_id
      left join project_memberships mine
        on mine.project_id = p.id and mine.invited_user_id = $1 and mine.status = 'active'
      where e.assignee_user_id = $1
        and (${managedOrganizationReadScopeSql('p.organization_id', '$1')} or p.user_id = $1 or mine.id is not null)
      union all
      select 'milestone'::text, m.id, m.project_id, p.organization_id, p.name, null::text,
        coalesce(nullif(milestone_creator.display_name, ''), milestone_creator.email)::text,
        null::boolean,
        m.title,
        m.status, null::text, m.target_date::text, m.updated_at, 'responsible'::text,
        null::text as offboarding_transferred_from_name
      from project_milestones m
      join projects p on p.id = m.project_id
      left join users milestone_creator on milestone_creator.id = m.created_by_user_id
      left join project_memberships mine
        on mine.project_id = p.id and mine.invited_user_id = $1 and mine.status = 'active'
      where m.responsible_user_id = $1
        and (${managedOrganizationReadScopeSql('p.organization_id', '$1')} or p.user_id = $1 or mine.id is not null)
      union all
      select 'bug'::text, b.id, bug_project.id, space.organization_id, bug_project.name, space.name,
        coalesce(nullif(bug_creator.display_name, ''), bug_creator.email)::text,
        null::boolean,
        b.title,
        b.status, b.priority, null::text, b.updated_at, 'assignee'::text,
        null::text as offboarding_transferred_from_name
      from test_bugs b
      join test_spaces space on space.id = b.test_space_id
      left join test_plans bug_plan
        on bug_plan.id = b.test_plan_id and bug_plan.test_space_id = b.test_space_id
      left join projects bug_project on bug_project.id = bug_plan.project_id
      left join users bug_creator on bug_creator.id = b.reporter_user_id
      left join test_space_memberships mine
        on mine.test_space_id = b.test_space_id and mine.user_id = $1 and mine.status = 'active'
      where b.assignee_user_id = $1
    ) work
    where work.organization_id is not distinct from $6::bigint
      and ($3::bigint is null or work.project_id = $3)
      and (
        $5::text is null
        or ($5::text = '__unrecorded__' and work.creator_name is null)
        or work.creator_name = $5::text
      )
      and (
        $2::text = 'all'
        or work.status = $2::text
        or concat(work.kind, ':', work.status) = $2::text
        or (
          $2::text = 'open'
          and not (
            (work.kind = 'todo' and work.status in ('completed', 'rejected'))
            or (work.kind = 'delivery' and work.status in ('delivered', 'cancelled'))
            or (work.kind = 'milestone' and work.status in ('achieved', 'cancelled'))
            or (work.kind = 'bug' and work.status in ('closed', 'rejected', 'duplicate'))
          )
        )
      )
    order by case when work.due_at is null then 1 else 0 end,
      case when $4::text = 'due_desc' then work.due_at end desc nulls last,
      case when $4::text = 'due_asc' then work.due_at end asc nulls last,
      work.updated_at desc, work.source_id desc
    limit 500
    `,
    [
      userId,
      filters.status ?? 'open',
      filters.projectId ?? null,
      filters.sort ?? 'due_desc',
      filters.creator ?? null,
      organizationId,
    ],
  )

  const items = result.rows.map((row): MyWorkItem => ({
    id: workItemKey(row.kind, Number(row.source_id)),
    kind: row.kind,
    sourceId: Number(row.source_id),
    projectId: row.project_id ? Number(row.project_id) : undefined,
    projectName: row.project_name ? decryptText(row.project_name) : undefined,
    contextName: row.context_name ? decryptText(row.context_name) : undefined,
    creatorName: row.creator_name ?? undefined,
    canComplete: row.can_complete ?? undefined,
    title: decryptText(row.title),
    status: row.status,
    priority: row.priority ?? undefined,
    offboardingTransferredFromName: row.offboarding_transferred_from_name ?? undefined,
    dueAt: row.due_at ?? undefined,
    updatedAt: row.updated_at.toISOString(),
    relation: row.relation,
  })).filter((item) => item.kind === (filters.kind ?? item.kind) && searchable(item, filters.q))

  const today = localDate(new Date())
  const end = weekEnd(today)
  const summary = items.reduce<MyWorkData['summary']>((result, item) => {
    result.all += 1
    const bucket = workBucket(item.dueAt, today, end)
    if (bucket === 'overdue') result.overdue += 1
    if (bucket === 'today') result.today += 1
    if (bucket === 'today' || bucket === 'this_week') result.thisWeek += 1
    return result
  }, { all: 0, overdue: 0, today: 0, thisWeek: 0 })

  const offset = Number(filters.cursor ?? 0)
  const limit = filters.limit ?? 50
  const page = items.slice(offset, offset + limit)
  return {
    organizationId,
    items: page,
    summary,
    nextCursor: offset + limit < items.length ? String(offset + limit) : undefined,
  }
}
