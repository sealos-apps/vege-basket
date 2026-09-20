export function normalizeOssEndpoint(value: unknown) {
  const rawEndpoint = String(value ?? '').trim()
  if (!rawEndpoint) return ''
  const endpointWithProtocol = /^https?:\/\//iu.test(rawEndpoint)
    ? rawEndpoint
    : `https://${rawEndpoint}`

  let endpoint: URL
  try {
    endpoint = new URL(endpointWithProtocol)
  } catch {
    throw new Error('OSS 地址格式无效。')
  }
  const hostname = endpoint.hostname.toLowerCase()
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
    (endpoint.pathname && endpoint.pathname !== '/') ||
    (hostname !== 'aliyuncs.com' && !hostname.endsWith('.aliyuncs.com'))
  ) {
    throw new Error('OSS 地址必须是受支持的阿里云 OSS HTTPS 地址。')
  }
  endpoint.protocol = 'https:'
  return endpoint.origin
}
