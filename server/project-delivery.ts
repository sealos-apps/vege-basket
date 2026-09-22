import type { PoolClient } from 'pg'
import { query } from './db.ts'
import { encryptText } from './crypto.ts'
import { lockProjectMutation } from './project-lock.ts'
import { lockOrganizationModuleCatalog } from './project-modules.ts'
import { deliveryCapabilities, type DeliveryCapabilities, type ProjectDeliveryMember } from '../shared/project-delivery.ts'

type Client = { query: typeof query }
export class ProjectDeliveryError extends Error {
  readonly status: number
  constructor(message: string, status = 403) { super(message); this.status = status }
}

export function rethrowDeliveryLockError(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error && error.code === '55P03') {
    throw new ProjectDeliveryError('成员正在变更或办理离职，请稍后重新核对配置', 409)
  }
  throw error
}

async function lockDeliveryParticipant(client: PoolClient, projectId: number, userId: number) {
  try {
    // Offboarding starts at the account row. Never wait for that reverse lock order.
    await client.query('select id from users where id = $1 for share nowait', [userId])
    await client.query(`select om.user_id from organization_memberships om join projects p on p.organization_id = om.organization_id
      where p.id = $1 and om.user_id = $2 for share of om nowait`, [projectId, userId])
    await client.query(`select id from project_memberships where project_id = $1 and invited_user_id = $2 for share nowait`, [projectId, userId])
  } catch (error) { rethrowDeliveryLockError(error) }
}

export async function lockDeliveryProject(client: PoolClient, projectId: number) {
  const before = await client.query<{ organization_id: string | null }>('select organization_id from projects where id = $1', [projectId])
  if (!before.rows[0]) throw new ProjectDeliveryError('项目不存在', 404)
  const organizationId = before.rows[0].organization_id
  if (organizationId) await lockOrganizationModuleCatalog(client, Number(organizationId))
  await lockProjectMutation(client, projectId)
  const after = await client.query<{ organization_id: string | null }>('select organization_id from projects where id = $1 for update', [projectId])
  if (!after.rows[0] || after.rows[0].organization_id !== organizationId) {
    throw new ProjectDeliveryError('项目所属组织已变化，请刷新后重试', 409)
  }
  return organizationId ? Number(organizationId) : null
}

export async function deliveryAccess(projectId: number, userId: number, client: Client = { query }) {
  const result = await client.query<{ personal: boolean; can_plan: boolean; can_execute: boolean }>(`
    select p.organization_id is null as personal,
      (p.organization_id is null or coalesce(d.can_plan, false)) as can_plan,
      (p.organization_id is null or coalesce(d.can_execute, false)) as can_execute
    from projects p
    join users u on u.id = $2 and u.account_status = 'active'
    left join project_delivery_members d on d.project_id = p.id and d.user_id = u.id
      and d.organization_id = p.organization_id
    where p.id = $1
      and (p.user_id = $2 or exists(select 1 from project_memberships pm
        where pm.project_id = p.id and pm.invited_user_id = $2 and pm.status = 'active'))
      and (p.organization_id is null or exists(select 1 from organization_memberships om
        where om.organization_id = p.organization_id and om.user_id = $2 and om.status = 'active'))`, [projectId, userId])
  const row = result.rows[0]
  return { personal: row?.personal ?? false, canPlan: row?.can_plan ?? false, canExecute: row?.can_execute ?? false }
}

export async function listDeliveryMembers(projectId: number, client: Client = { query }): Promise<ProjectDeliveryMember[]> {
  const result = await client.query<{ user_id: string; name: string; can_plan: boolean; can_execute: boolean }>(`
    select u.id as user_id, coalesce(nullif(u.display_name, ''), u.email) as name,
      d.can_plan, d.can_execute
    from project_delivery_members d join projects p on p.id = d.project_id and p.organization_id = d.organization_id
    join users u on u.id = d.user_id and u.account_status = 'active'
    join organization_memberships om on om.organization_id = p.organization_id and om.user_id = u.id and om.status = 'active'
    where p.id = $1 and (p.user_id = u.id or exists(select 1 from project_memberships pm
      where pm.project_id = p.id and pm.invited_user_id = u.id and pm.status = 'active'))
    order by u.id`, [projectId])
  return result.rows.map((row) => ({ userId: Number(row.user_id), name: row.name, canPlan: row.can_plan, canExecute: row.can_execute }))
}

export async function authorizeDelivery(
  client: PoolClient, projectId: number, userId: number,
  permission: 'plan' | keyof DeliveryCapabilities,
  target?: { eventId?: number; operationId?: number; groupId?: number; commentId?: number },
) {
  await lockDeliveryProject(client, projectId)
  await lockDeliveryParticipant(client, projectId, userId)
  const access = await deliveryAccess(projectId, userId, client)
  if (permission === 'plan' && !target) {
    if (!access.canPlan) throw new ProjectDeliveryError('仅项目计划管理人员可以制定交付计划')
    return
  }
  const result = await client.query<{ id: string; assignee_user_id: string | null; published_at: Date | null; status: string }>(`
    select e.id, e.assignee_user_id, e.published_at, e.status from project_package_events e
    where e.project_id = $1
      and ($2::bigint is null or e.id = $2::bigint)
      and ($3::bigint is null or exists(select 1 from project_package_operations o where o.id = $3::bigint and o.project_package_event_id = e.id))
      and ($4::bigint is null or exists(select 1 from project_package_groups g where g.id = $4::bigint and g.project_package_event_id = e.id))
      and ($5::bigint is null or exists(select 1 from project_package_event_comments c where c.id = $5::bigint and c.project_package_event_id = e.id))
    for update of e`, [projectId, target?.eventId ?? null, target?.operationId ?? null, target?.groupId ?? null, target?.commentId ?? null])
  const event = result.rows[0]
  if (!event || result.rows.length !== 1) throw new ProjectDeliveryError('交付任务不存在', 404)
  const capabilities = deliveryCapabilities(access, {
    assigneeUserId: event.assignee_user_id ? Number(event.assignee_user_id) : null,
    published: Boolean(event.published_at), delivered: event.status === 'delivered',
  }, userId)
  const allowed = permission === 'plan' ? capabilities.canEditPlan : capabilities[permission]
  if (!allowed) throw new ProjectDeliveryError('当前人员或任务状态不允许此交付操作')
  return event
}

export async function requireDeliveryAssignee(client: PoolClient, projectId: number, userId: number | null, required: boolean) {
  if (userId == null && !required) return
  if (userId && Number.isSafeInteger(userId) && userId > 0) await lockDeliveryParticipant(client, projectId, userId)
  if (!userId || !Number.isSafeInteger(userId) || userId <= 0 || !(await deliveryAccess(projectId, userId, client)).canExecute) {
    throw new ProjectDeliveryError('请选择本项目有效的交付执行人员', 400)
  }
}

export async function auditDelivery(client: Client, organizationId: number, projectId: number, userId: number, action: string, detail: unknown) {
  await client.query(`insert into organization_audit_events
    (organization_id, actor_user_id, action, subject_type, subject_id, detail)
    values ($1, $2, $3, 'project', $4, $5)`,
  [organizationId, userId, action, String(projectId), encryptText(JSON.stringify(detail))])
}
