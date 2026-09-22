export type ProjectDeliveryMember = {
  userId: number
  name: string
  canPlan: boolean
  canExecute: boolean
}

export type DeliveryCapabilities = {
  canEditPlan: boolean
  canPublish: boolean
  canReassign: boolean
  canExecute: boolean
  canComplete: boolean
  canComment: boolean
}

export function deliveryCapabilities(
  access: { canPlan: boolean; canExecute: boolean; personal: boolean },
  event: { published: boolean; delivered: boolean; assigneeUserId: number | null },
  userId: number,
): DeliveryCapabilities {
  const executor = access.canExecute && (access.personal || event.assigneeUserId === userId)
  const active = event.published && !event.delivered
  return {
    canEditPlan: access.canPlan && !event.published,
    canPublish: access.canPlan && !event.published,
    canReassign: access.canPlan && active,
    canExecute: executor && active,
    canComplete: executor && active,
    canComment: access.canPlan || (executor && event.published),
  }
}

export function parseDeliveryMembers(value: unknown) {
  if (!Array.isArray(value) || value.length > 1000) return null
  const ids = new Set<number>()
  const members: Array<Pick<ProjectDeliveryMember, 'userId' | 'canPlan' | 'canExecute'>> = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || !Number.isSafeInteger(item.userId) || item.userId <= 0
      || ids.has(item.userId) || typeof item.canPlan !== 'boolean' || typeof item.canExecute !== 'boolean'
      || (!item.canPlan && !item.canExecute)) return null
    ids.add(item.userId)
    members.push({ userId: item.userId, canPlan: item.canPlan, canExecute: item.canExecute })
  }
  return members.sort((a, b) => a.userId - b.userId)
}

/** Rebase local edits while preserving unrelated changes made by another manager. */
export function mergeDeliveryMemberDraft(base: ProjectDeliveryMember[], draft: ProjectDeliveryMember[], current: ProjectDeliveryMember[]) {
  const result = new Map(current.map(member => [member.userId, member]))
  const original = new Map(base.map(member => [member.userId, member]))
  for (const member of base) {
    if (!draft.some(next => next.userId === member.userId)) result.delete(member.userId)
  }
  for (const member of draft) {
    const before = original.get(member.userId)
    if (!before || before.canPlan !== member.canPlan || before.canExecute !== member.canExecute) result.set(member.userId, member)
  }
  return [...result.values()].sort((a, b) => a.userId - b.userId)
}
