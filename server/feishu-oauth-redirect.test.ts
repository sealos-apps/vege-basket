import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildFeishuOAuthBindRedirect,
  buildFeishuOAuthSigninRedirect,
} from './feishu-oauth-redirect.ts'

const appSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

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
