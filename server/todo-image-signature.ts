import crypto from 'node:crypto'

/**
 * Keep validating URLs emitted before platform configuration was introduced.
 * The old implementation used nullish fallback, so an explicitly empty value
 * must not silently select a different secret.
 */
export function legacyTodoImageUrlSecretFromEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const value = env.TODO_IMAGE_URL_SECRET ?? env.FEISHU_OAUTH_STATE_SECRET ?? env.APP_ENCRYPTION_KEYS ?? ''
  return String(value)
}

export function todoImageSignature(objectKey: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(objectKey).digest('base64url')
}

export function isTodoImageSignatureValid(objectKey: string, signature: string, secrets: readonly string[]) {
  if (!signature) return false
  const signatureBuffer = Buffer.from(signature)
  const seen = new Set<string>()
  return secrets.some((secret) => {
    if (!secret || seen.has(secret)) return false
    seen.add(secret)
    const expectedBuffer = Buffer.from(todoImageSignature(objectKey, secret))
    return expectedBuffer.length === signatureBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
  })
}
