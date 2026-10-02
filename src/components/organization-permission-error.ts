const organizationPermissionErrorPattern = /组织.*?(?:权限|管理权限).*?(?:已变化|校验未通过|失去|required)|(?:Target )?organization (?:access changed|management access could not be verified|management access is required)|权限已变化|失去.*管理权限/iu

export function isOrganizationPermissionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return organizationPermissionErrorPattern.test(message)
}

export function organizationPermissionErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message.trim() : String(error ?? '').trim()
  return message || '组织权限校验未通过，请刷新后重试；如仍失败，请确认你是该组织 Owner/Admin。'
}
