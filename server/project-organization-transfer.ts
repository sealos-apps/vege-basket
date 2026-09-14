import type { PoolClient } from 'pg'
import { decryptText } from './crypto.ts'

type QueryClient = Pick<PoolClient, 'query'>

export type ProjectOrganizationTransferBlockers = {
  missingMembers: Array<{ name: string; userId: number }>
  pendingInvitationCount: number
  unboundActiveMemberCount: number
  unavailableModules: Array<{
    name: string
    projectModuleId: number
    reason: 'disabled' | 'missing'
    todoCount: number
  }>
}

export class ProjectOrganizationTransferError extends Error {
  readonly code = 'PROJECT_ORGANIZATION_TRANSFER_BLOCKED'
  readonly status = 409
  readonly blockers: ProjectOrganizationTransferBlockers

  constructor(blockers: ProjectOrganizationTransferBlockers) {
    super('目标组织尚未满足项目迁移条件，请处理阻塞项后重试。')
    this.blockers = blockers
  }
}

export function canTransferProjectOrganization(blockers: ProjectOrganizationTransferBlockers) {
  return blockers.missingMembers.length === 0
    && blockers.pendingInvitationCount === 0
    && blockers.unboundActiveMemberCount === 0
    && blockers.unavailableModules.length === 0
}

export async function getProjectOrganizationTransferBlockers(
  client: QueryClient,
  projectId: number,
  targetOrganizationId: number,
): Promise<ProjectOrganizationTransferBlockers> {
  const blockersByTarget = await getProjectOrganizationTransferBlockersByTarget(
    client,
    projectId,
    [targetOrganizationId],
  )
  return blockersByTarget.get(targetOrganizationId) ?? emptyTransferBlockers()
}

function emptyTransferBlockers(): ProjectOrganizationTransferBlockers {
  return { missingMembers: [], pendingInvitationCount: 0, unboundActiveMemberCount: 0, unavailableModules: [] }
}

export async function getProjectOrganizationTransferBlockersByTarget(
  client: QueryClient,
  projectId: number,
  targetOrganizationIds: number[],
): Promise<Map<number, ProjectOrganizationTransferBlockers>> {
  const uniqueTargetIds = [...new Set(targetOrganizationIds)]
  const blockersByTarget = new Map(
    uniqueTargetIds.map((organizationId) => [organizationId, emptyTransferBlockers()]),
  )
  if (!uniqueTargetIds.length) return blockersByTarget

  const [missingMembers, pendingInvitations, unavailableModules] = await Promise.all([
    client.query<{ display_name: string | null; email: string; organization_id: string; user_id: string }>(
      `with target_organizations as (
         select unnest($2::bigint[]) as organization_id
       ), project_people as (
         select project.user_id from projects project where project.id = $1::bigint
         union
         select membership.invited_user_id from project_memberships membership
          where membership.project_id = $1::bigint and membership.status = 'active'
            and membership.invited_user_id is not null
       )
       select target.organization_id, person.user_id, account.display_name, account.email
         from target_organizations target
         cross join project_people person
         join users account on account.id = person.user_id
        where not exists (
          select 1 from organization_memberships membership
           where membership.organization_id = target.organization_id
             and membership.user_id = person.user_id and membership.status = 'active'
        )
        order by target.organization_id,
                 lower(coalesce(nullif(account.display_name, ''), account.email)), person.user_id`,
      [projectId, uniqueTargetIds],
    ),
    client.query<{ pending_count: string; unbound_active_count: string }>(
      `select
         count(*) filter (where status = 'pending')::text as pending_count,
         count(*) filter (where status = 'active' and invited_user_id is null)::text as unbound_active_count
       from project_memberships where project_id = $1::bigint`,
      [projectId],
    ),
    client.query<{
      enabled: boolean | null
      name: string
      organization_id: string
      project_module_id: string
      target_module_id: string | null
      todo_count: string
    }>(
      `with target_organizations as (
         select unnest($2::bigint[]) as organization_id
       )
       select target_organization.organization_id, module.id as project_module_id,
              module.name, count(todo.id)::text as todo_count,
              target.id as target_module_id, target.enabled
         from target_organizations target_organization
         cross join project_modules module
         join todos todo on todo.project_module_id = module.id
         left join organization_project_modules target
           on target.organization_id = target_organization.organization_id
          and target.name_lookup = module.name_lookup
        where module.project_id = $1::bigint
        group by target_organization.organization_id, module.id, target.id, target.enabled
        having target.id is null or target.enabled = false
        order by target_organization.organization_id, module.id`,
      [projectId, uniqueTargetIds],
    ),
  ])

  const pendingInvitationCount = Number(pendingInvitations.rows[0]?.pending_count ?? 0)
  const unboundActiveMemberCount = Number(pendingInvitations.rows[0]?.unbound_active_count ?? 0)
  for (const blockers of blockersByTarget.values()) {
    blockers.pendingInvitationCount = pendingInvitationCount
    blockers.unboundActiveMemberCount = unboundActiveMemberCount
  }
  for (const row of missingMembers.rows) {
    blockersByTarget.get(Number(row.organization_id))?.missingMembers.push({
      name: String(row.display_name || row.email),
      userId: Number(row.user_id),
    })
  }
  for (const row of unavailableModules.rows) {
    blockersByTarget.get(Number(row.organization_id))?.unavailableModules.push({
      name: decryptText(row.name),
      projectModuleId: Number(row.project_module_id),
      reason: row.target_module_id === null ? 'missing' : 'disabled',
      todoCount: Number(row.todo_count),
    })
  }
  return blockersByTarget
}
