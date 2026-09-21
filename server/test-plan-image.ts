import crypto from 'node:crypto'
import { getOssObject, putOssObject } from './package-market.ts'
import { getLegacyPlatformSecrets } from './platform-config-store.ts'
import { getPlatformConfigSnapshot } from './platform-config-runtime.ts'

export const testPlanImageMaxTotalBytes = 30 * 1024 * 1024
export const testPlanImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
export type TestPlanImageContentType = typeof testPlanImageTypes[number]

export function testPlanImageUploadMaxBytes() {
  return Math.min(testPlanImageMaxTotalBytes, getPlatformConfigSnapshot().config.storage.uploadMaxBytes)
}

export function normalizeTestPlanImageContentType(value: unknown): TestPlanImageContentType | '' {
  const contentType = String(value ?? '').split(';')[0].trim().toLowerCase()
  return testPlanImageTypes.includes(contentType as TestPlanImageContentType)
    ? contentType as TestPlanImageContentType
    : ''
}

function imageExtension(contentType: TestPlanImageContentType) {
  return contentType === 'image/jpeg' ? 'jpg' : contentType.slice('image/'.length)
}

function imagePrefix() {
  const objectPrefix = getPlatformConfigSnapshot().config.storage.objectPrefix.replace(/\/+$/, '')
  return `${objectPrefix}/test-plan-executions/`
}

export function createTestPlanImageObjectKey(userId: number, contentType: TestPlanImageContentType) {
  return `${imagePrefix()}${new Date().toISOString().slice(0, 10)}/user-${userId}/${crypto.randomUUID()}.${imageExtension(contentType)}`
}

export function isTestPlanImageObjectKey(objectKey: string, ownerUserId?: number) {
  return objectKey.startsWith(imagePrefix()) && !objectKey.includes('..') && objectKey.length <= 512
    && (ownerUserId === undefined || objectKey.includes(`/user-${ownerUserId}/`))
}

export function testPlanImageSignature(objectKey: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(objectKey).digest('base64url')
}

export async function isTestPlanImageSignatureValid(objectKey: string, signature: string) {
  const configuredSecret = getPlatformConfigSnapshot().config.storage.urlSecret
  const secrets = [configuredSecret, ...(await getLegacyPlatformSecrets('todo_image_url'))]
    .filter(Boolean)
  const provided = Buffer.from(signature)
  return secrets.some((secret) => {
    const expected = Buffer.from(testPlanImageSignature(objectKey, secret))
    return expected.length === provided.length && crypto.timingSafeEqual(expected, provided)
  })
}

export function testPlanImageUrl(objectKey: string) {
  const secret = getPlatformConfigSnapshot().config.storage.urlSecret
  if (!secret) throw new Error('TODO_IMAGE_URL_SECRET or APP_ENCRYPTION_KEYS must be set')
  return `/api/test-plan-images?key=${encodeURIComponent(objectKey)}&sig=${encodeURIComponent(testPlanImageSignature(objectKey, secret))}`
}

export async function putTestPlanImage(objectKey: string, body: Buffer, contentType: TestPlanImageContentType) {
  await putOssObject(objectKey, body, contentType)
}

export async function getTestPlanImage(objectKey: string) {
  return getOssObject(objectKey)
}
