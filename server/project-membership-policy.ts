import type { PoolClient } from 'pg'

type QueryClient = Pick<PoolClient, 'query'>

export type ProjectMemberTaskBlockers = {
  milestones: number
  packageEvents: number
  todos: number
}

export type OrganizationMemberTaskBlockers = ProjectMemberTaskBlockers & {
  bugs: number
  testPlans: number
}

export async function getProjectMemberTaskBlockers(
  client: QueryClient,
  projectId: number,
  userId: number,
): Promise<ProjectMemberTaskBlockers> {
  const result = await client.query<{
    milestone_count: string
    package_event_count: string
    todo_count: string
  }>(
    `select
       (select count(distinct todo.id)
          from todos todo
         where todo.project_id = $1::bigint
           and (todo.done = false or todo.confirmation_status = 'pending_review')
           and (
             todo.assignee_user_id = $2::bigint
             or todo.reviewer_user_id = $2::bigint
             or todo.watcher_user_id = $2::bigint
             or exists (
               select 1 from todo_watchers watcher
                where watcher.todo_id = todo.id and watcher.user_id = $2::bigint
             )
           ))::text as todo_count,
       (select count(*) from project_package_events event
         where event.project_id = $1::bigint and event.assignee_user_id = $2::bigint
           and event.status <> 'delivered')::text as package_event_count,
       (select count(*) from project_milestones milestone
         where milestone.project_id = $1::bigint and milestone.responsible_user_id = $2::bigint
           and milestone.status in ('pending', 'in_review'))::text as milestone_count`,
    [projectId, userId],
  )
  const row = result.rows[0]
  return {
    milestones: Number(row?.milestone_count ?? 0),
    packageEvents: Number(row?.package_event_count ?? 0),
    todos: Number(row?.todo_count ?? 0),
  }
}

export async function getOrganizationMemberTaskBlockers(
  client: QueryClient,
  organizationId: number,
  userId: number,
): Promise<OrganizationMemberTaskBlockers> {
  const result = await client.query<{
    bug_count: string
    milestone_count: string
    package_event_count: string
    plan_count: string
    todo_count: string
  }>(
    `select
       (select count(distinct todo.id)
          from todos todo
          join projects project on project.id = todo.project_id
         where project.organization_id = $1::bigint
           and (todo.done = false or todo.confirmation_status = 'pending_review')
           and (
             todo.assignee_user_id = $2::bigint
             or todo.reviewer_user_id = $2::bigint
             or todo.watcher_user_id = $2::bigint
             or exists (
               select 1 from todo_watchers watcher
                where watcher.todo_id = todo.id and watcher.user_id = $2::bigint
             )
           ))::text as todo_count,
       (select count(*) from project_package_events event
          join projects project on project.id = event.project_id
         where project.organization_id = $1::bigint and event.assignee_user_id = $2::bigint
           and event.status <> 'delivered')::text as package_event_count,
       (select count(*) from project_milestones milestone
          join projects project on project.id = milestone.project_id
         where project.organization_id = $1::bigint and milestone.responsible_user_id = $2::bigint
           and milestone.status in ('pending', 'in_review'))::text as milestone_count,
       (select count(*) from test_bugs bug
          join test_spaces space on space.id = bug.test_space_id
         where space.organization_id = $1::bigint and bug.assignee_user_id = $2::bigint
           and bug.status not in ('closed', 'rejected'))::text as bug_count,
       (select count(*) from test_plans plan
          join test_spaces space on space.id = plan.test_space_id
         where space.organization_id = $1::bigint and plan.owner_user_id = $2::bigint
           and plan.status in ('draft', 'in_progress'))::text as plan_count`,
    [organizationId, userId],
  )
  const row = result.rows[0]
  return {
    bugs: Number(row?.bug_count ?? 0),
    milestones: Number(row?.milestone_count ?? 0),
    packageEvents: Number(row?.package_event_count ?? 0),
    testPlans: Number(row?.plan_count ?? 0),
    todos: Number(row?.todo_count ?? 0),
  }
}

export function hasMemberTaskBlockers(blockers: ProjectMemberTaskBlockers | OrganizationMemberTaskBlockers) {
  return Object.values(blockers).some((count) => count > 0)
}

export function memberTaskBlockerMessage(blockers: ProjectMemberTaskBlockers | OrganizationMemberTaskBlockers) {
  const labels: Array<[keyof OrganizationMemberTaskBlockers, string]> = [
    ['todos', '待处理待办'],
    ['packageEvents', '未交付事件'],
    ['milestones', '未结束里程碑'],
    ['bugs', '未关闭 Bug'],
    ['testPlans', '进行中测试计划'],
  ]
  const counts = blockers as Partial<OrganizationMemberTaskBlockers>
  const details = labels.flatMap(([key, label]) => {
    const count = counts[key] ?? 0
    return count ? [`${label} ${count} 项`] : []
  })
  return `该成员仍有关联任务（${details.join('、')}），请先完成或重新指派后再移除。`
}
