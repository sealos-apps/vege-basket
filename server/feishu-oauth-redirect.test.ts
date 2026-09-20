import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildFeishuOAuthBindRedirect,
  buildFeishuOAuthSigninRedirect,
} from './feishu-oauth-redirect.ts'
import { derivePlatformCallbackUrls } from '../shared/platform-callback-urls.ts'

const appSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

test('Feishu callback addresses derive from one platform public origin', () => {
  assert.deepEqual(derivePlatformCallbackUrls('https://veges.example.com'), {
    eventCallbackUrl: 'https://veges.example.com/api/integrations/feishu/events',
    oauthRedirectUrl: 'https://veges.example.com/api/auth/feishu/oauth/callback',
  })
  assert.deepEqual(derivePlatformCallbackUrls('http://127.0.0.1:5173'), {
    eventCallbackUrl: 'http://127.0.0.1:5173/api/integrations/feishu/events',
    oauthRedirectUrl: 'http://127.0.0.1:5173/api/auth/feishu/oauth/callback',
  })
  assert.deepEqual(derivePlatformCallbackUrls('http://[::1]:5173'), {
    eventCallbackUrl: 'http://[::1]:5173/api/integrations/feishu/events',
    oauthRedirectUrl: 'http://[::1]:5173/api/auth/feishu/oauth/callback',
  })
  assert.equal(derivePlatformCallbackUrls('http://unsafe.example.com'), null)
  assert.equal(derivePlatformCallbackUrls('https://veges.example.com/path'), null)
})

test('Feishu sign-in returns to the configured platform public address', () => {
  assert.equal(
    buildFeishuOAuthSigninRedirect(
      'https://veges.example.com',
      '/?organizationInvite=invite-1',
      'success',
      { token: 'session-token' },
    ),
    'https://veges.example.com/?organizationInvite=invite-1#feishuAuth=success&token=session-token',
  )
  assert.equal(
    buildFeishuOAuthSigninRedirect(
      'http://127.0.0.1:5173',
      '/',
      'success',
      { token: 'local-session' },
    ),
    'http://127.0.0.1:5173/#feishuAuth=success&token=local-session',
  )
})

test('Feishu binding returns to the configured platform path', () => {
  assert.equal(
    buildFeishuOAuthBindRedirect(
      'https://veges.example.com',
      '/settings?tab=account',
      'error',
      '绑定失败',
    ),
    'https://veges.example.com/settings?tab=account&feishuBind=error&feishuBindMessage=%E7%BB%91%E5%AE%9A%E5%A4%B1%E8%B4%A5',
  )
})

test('OAuth return redirects reject unsafe origins and paths', () => {
  assert.equal(
    buildFeishuOAuthSigninRedirect('http://unsafe.example.com', '//attacker.example.com', 'error'),
    '/#feishuAuth=error',
  )
  assert.equal(
    buildFeishuOAuthSigninRedirect('', '/inbox', 'success'),
    '/inbox#feishuAuth=success',
  )
  assert.equal(
    buildFeishuOAuthSigninRedirect('https://veges.example.com', '/\\attacker.example', 'error'),
    'https://veges.example.com/#feishuAuth=error',
  )
})

test('Feishu callback completion uses the configured platform public address', () => {
  assert.match(
    appSource,
    /buildFeishuOAuthSigninRedirect\(platformPublicUrl\(\), state\.returnTo, 'success'/u,
  )
  assert.match(
    appSource,
    /buildFeishuOAuthBindRedirect\(platformPublicUrl\(\), state\.returnTo, 'success'/u,
  )
})

test('Feishu authorization uses the current public address and preserves it in signed state', () => {
  assert.match(appSource, /const redirectUri = getFeishuOAuthRedirectUri\(\)/u)
  assert.match(appSource, /redirectUri,\s*returnTo:/u)
  assert.match(appSource, /redirect_uri', redirectUri/u)
  assert.doesNotMatch(appSource, /getRequestOrigin/u)
})

test('manual maintenance Feishu login reuses only an existing active platform administrator', () => {
  assert.match(appSource, /async function findMaintenanceFeishuPlatformAdmin/u)
  assert.match(appSource, /join platform_admin_grants grant_row on grant_row\.user_id = users\.id/u)
  assert.match(appSource, /users\.feishu_user_id = \$1::text and users\.account_status = 'active'/u)
  assert.match(appSource, /loginAccess === 'platform-admin-only'\s*\? await findMaintenanceFeishuPlatformAdmin/u)
  assert.match(appSource, /invitePassword: loginAccess === 'open'/u)
})
