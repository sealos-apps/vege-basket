import crypto from 'node:crypto'

type EncryptionEnvelope = {
  alg: 'aes-256-gcm'
  ct: string
  iv: string
  kid: string
  tag: string
  v: 1
}

const encryptedPrefix = 'veges:enc:'
const blindIndexPrefix = 'veges:idx:'
const keyedDigestPrefix = 'veges:mac:'
let cachedKeys: Map<string, Buffer> | null = null

function parseKeys() {
  if (cachedKeys) return cachedKeys

  const rawKeys = process.env.APP_ENCRYPTION_KEYS ?? ''
  const keys = new Map<string, Buffer>()

  for (const pair of rawKeys.split(',').map((item) => item.trim()).filter(Boolean)) {
    const separatorIndex = pair.indexOf(':')
    if (separatorIndex < 1) continue
    const keyId = pair.slice(0, separatorIndex).trim()
    const key = Buffer.from(pair.slice(separatorIndex + 1).trim(), 'base64')
    if (!keyId || key.length !== 32) continue
    keys.set(keyId, key)
  }

  cachedKeys = keys
  return keys
}

function getActiveKeyId() {
  return (process.env.APP_ENCRYPTION_ACTIVE_KEY_ID ?? '').trim()
}

function getActiveKey() {
  const activeKeyId = getActiveKeyId()
  const key = parseKeys().get(activeKeyId)
  if (!activeKeyId || !key) {
    throw new Error('APP_ENCRYPTION_ACTIVE_KEY_ID must match a 32-byte key in APP_ENCRYPTION_KEYS')
  }
  return { key, keyId: activeKeyId }
}

function getKey(keyId: string) {
  const key = parseKeys().get(keyId)
  if (!key) throw new Error(`Encryption key ${keyId} is not configured`)
  return key
}

export function assertEncryptionConfigured() {
  getActiveKey()
}

export function getEncryptionKeyStatus() {
  const keys = parseKeys()
  const activeKeyId = getActiveKeyId()
  return {
    activeKeyId,
    algorithm: 'AES-256-GCM' as const,
    configured: Boolean(activeKeyId && keys.has(activeKeyId)),
    retainedKeyIds: [...keys.keys()].sort(),
  }
}

export function isEncryptedText(value: unknown) {
  return typeof value === 'string' && value.startsWith(encryptedPrefix)
}

export function encryptText(value: string) {
  const { key, keyId } = getActiveKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const envelope: EncryptionEnvelope = {
    alg: 'aes-256-gcm',
    ct: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    kid: keyId,
    tag: cipher.getAuthTag().toString('base64'),
    v: 1,
  }
  return `${encryptedPrefix}${Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64')}`
}

export function decryptText(value: string) {
  if (!isEncryptedText(value)) return value
  const envelope = JSON.parse(
    Buffer.from(value.slice(encryptedPrefix.length), 'base64').toString('utf8'),
  ) as EncryptionEnvelope
  if (envelope.v !== 1 || envelope.alg !== 'aes-256-gcm') {
    throw new Error('Unsupported encrypted payload')
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getKey(envelope.kid),
    Buffer.from(envelope.iv, 'base64'),
  )
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ct, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

export function encryptJson(value: unknown) {
  return encryptText(JSON.stringify(value))
}

export function decryptJson<T>(value: string, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(decryptText(value)) as T
  } catch {
    return fallback
  }
}

export function blindIndex(value: string) {
  const normalized = value.trim().toLowerCase()
  const { key, keyId } = getActiveKey()
  const digest = crypto.createHmac('sha256', key).update(normalized).digest('base64url')
  return `${blindIndexPrefix}${keyId}:${digest}`
}

export function keyedDigest(value: string, requestedKeyId?: string) {
  const active = getActiveKey()
  const keyId = requestedKeyId ?? active.keyId
  const key = requestedKeyId ? getKey(requestedKeyId) : active.key
  const digest = crypto.createHmac('sha256', key).update(value, 'utf8').digest('base64url')
  return `${keyedDigestPrefix}${keyId}:${digest}`
}

export function verifyKeyedDigest(value: string, expected: string) {
  if (!expected.startsWith(keyedDigestPrefix)) return false
  const separator = expected.indexOf(':', keyedDigestPrefix.length)
  if (separator <= keyedDigestPrefix.length || separator === expected.length - 1) return false
  const keyId = expected.slice(keyedDigestPrefix.length, separator)
  let actual: string
  try {
    actual = keyedDigest(value, keyId)
  } catch {
    return false
  }
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
}
