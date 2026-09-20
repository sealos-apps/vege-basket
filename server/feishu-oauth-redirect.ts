import { normalizePlatformPublicOrigin } from '../shared/platform-callback-urls.ts'

function safeReturnPath(value: string) {
  const trimmed = value.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '/'
  const localTarget = new URL(trimmed, 'http://veges.local')
  if (localTarget.origin !== 'http://veges.local') return '/'
  return `${localTarget.pathname}${localTarget.search}${localTarget.hash}`
}

function oauthReturnTarget(publicUrl: string, returnTo: string) {
  const publicOrigin = normalizePlatformPublicOrigin(publicUrl)
  const target = new URL(safeReturnPath(returnTo), publicOrigin || 'http://veges.local')
  return { publicOrigin, target }
}

export function buildFeishuOAuthBindRedirect(
  publicUrl: string,
  returnTo: string,
  status: 'success' | 'error',
  message?: string,
) {
  const { publicOrigin, target } = oauthReturnTarget(publicUrl, returnTo)
  target.searchParams.set('feishuBind', status)
  if (message) target.searchParams.set('feishuBindMessage', message.slice(0, 120))
  return publicOrigin ? target.toString() : `${target.pathname}${target.search}${target.hash}`
}

export function buildFeishuOAuthSigninRedirect(
  publicUrl: string,
  returnTo: string,
  status: 'success' | 'error',
  options: { message?: string; token?: string } = {},
) {
  const { publicOrigin, target } = oauthReturnTarget(publicUrl, returnTo)
  const fragment = new URLSearchParams()
  fragment.set('feishuAuth', status)
  if (options.token) fragment.set('token', options.token)
  if (options.message) fragment.set('feishuAuthMessage', options.message.slice(0, 120))
  target.hash = fragment.toString()
  return publicOrigin ? target.toString() : `${target.pathname}${target.search}${target.hash}`
}
