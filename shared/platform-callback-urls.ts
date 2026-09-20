export type PlatformCallbackUrls = {
  eventCallbackUrl: string
  oauthRedirectUrl: string
}

export function normalizePlatformPublicOrigin(value: string) {
  try {
    const url = new URL(value.trim())
    const localHttp = url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname.toLowerCase())
    if (
      (url.protocol !== 'https:' && !localHttp) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash
    ) return ''
    return url.origin
  } catch {
    return ''
  }
}

export function derivePlatformCallbackUrls(publicUrl: string): PlatformCallbackUrls | null {
  const origin = normalizePlatformPublicOrigin(publicUrl)
  if (!origin) return null
  return {
    eventCallbackUrl: `${origin}/api/integrations/feishu/events`,
    oauthRedirectUrl: `${origin}/api/auth/feishu/oauth/callback`,
  }
}
