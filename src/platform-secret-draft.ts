export type PlatformSecretDraftValidationInput = {
  confirmation: string
  configured: boolean
  editing: boolean
  touched: boolean
  value: string
}

export function validatePlatformSecretDraft({
  confirmation,
  configured,
  editing,
  touched,
  value,
}: PlatformSecretDraftValidationInput) {
  if (!editing || (!configured && !touched && !value && !confirmation)) return ''
  if (!value || !confirmation) return '请完整输入新值和确认值。'
  if (value !== confirmation) return '两次输入不一致。'
  return ''
}
