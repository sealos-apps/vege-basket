export type ProjectModuleAvailability = {
  selectable: boolean
  unavailableReason?: 'disabled' | 'legacy'
}

export function normalizeProjectModuleName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  return name.length > 0 && name.length <= 40 ? name : null
}

export function canManageOrganizationProjectModules(
  accessRole: string | null,
  assignedRoles: readonly string[],
) {
  return (accessRole === 'owner' || accessRole === 'admin') && assignedRoles.includes('organization_admin')
}

export function projectModuleAvailability(
  projectOrganizationId: number | null,
  moduleOrganizationId: number | null,
  enabled: boolean,
): ProjectModuleAvailability {
  if (projectOrganizationId === null) return { selectable: true }
  if (moduleOrganizationId !== projectOrganizationId) {
    return { selectable: false, unavailableReason: 'legacy' }
  }
  return enabled ? { selectable: true } : { selectable: false, unavailableReason: 'disabled' }
}

export function projectModuleUnavailableLabel(module: ProjectModuleAvailability) {
  return module.selectable ? '' : module.unavailableReason === 'legacy' ? '历史模块' : '已停用'
}
