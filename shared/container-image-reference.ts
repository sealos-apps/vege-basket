export const maxContainerImageReferenceLength = 512

export type ContainerImageReferenceResult =
  | { error: string; valid: false }
  | { valid: true; value: string }

export function containerImageReferenceKey(image: string) {
  const imageBody = image.startsWith('docker://') ? image.slice('docker://'.length) : image
  const digestIndex = imageBody.indexOf('@sha256:')
  if (digestIndex >= 0) {
    return `${imageBody.slice(0, digestIndex).toLowerCase()}${imageBody.slice(digestIndex).toLowerCase()}`
  }
  const slashIndex = imageBody.lastIndexOf('/')
  const tagIndex = imageBody.lastIndexOf(':')
  return tagIndex > slashIndex
    ? `${imageBody.slice(0, tagIndex).toLowerCase()}${imageBody.slice(tagIndex)}`
    : imageBody.toLowerCase()
}

function isPrivateIpv4(hostname: string) {
  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }
  return octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
}

function hasUnsafeRegistry(imageBody: string) {
  const firstSegment = imageBody.split('/')[0].toLowerCase()
  if (!firstSegment.includes('.') && !firstSegment.includes(':')) return false
  const hostname = firstSegment.replace(/:\d+$/, '')
  return hostname === 'localhost' || hostname.endsWith('.local') || isPrivateIpv4(hostname)
}

function hasTagOrDigest(imageBody: string) {
  const digestIndex = imageBody.lastIndexOf('@')
  if (digestIndex >= 0) {
    return digestIndex > 0 && /^sha256:[a-fA-F0-9]{64}$/.test(imageBody.slice(digestIndex + 1))
  }
  const lastSlash = imageBody.lastIndexOf('/')
  const tagIndex = imageBody.lastIndexOf(':')
  return tagIndex > lastSlash && /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(imageBody.slice(tagIndex + 1))
}

export function normalizeContainerImageReference(
  value: unknown,
  options: { requireTagOrDigest?: boolean } = {},
): ContainerImageReferenceResult {
  if (typeof value !== 'string') return { error: '容器镜像名称不能为空。', valid: false }
  const image = value.trim()
  const imageBody = containerImageReferenceKey(image)
  if (
    image.length === 0 ||
    image.length > maxContainerImageReferenceLength ||
    imageBody.length === 0 ||
    imageBody.includes('://') ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/.test(imageBody) ||
    imageBody.endsWith('/') ||
    hasUnsafeRegistry(imageBody)
  ) {
    return { error: '镜像名称不符合容器镜像命名规则。', valid: false }
  }
  if (options.requireTagOrDigest && !hasTagOrDigest(imageBody)) {
    return { error: '镜像名称必须包含 :tag 或 @sha256: 摘要。', valid: false }
  }
  return { valid: true, value: image }
}
