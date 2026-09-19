import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const serverSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

function sourceBetween(start: string, end: string) {
  const startIndex = serverSource.indexOf(start)
  const endIndex = serverSource.indexOf(end, startIndex + start.length)
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`)
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`)
  return serverSource.slice(startIndex, endIndex)
}

test('password registration is disabled because new users are created by Feishu OAuth', () => {
  const route = sourceBetween(
    "app.post('/api/auth/register'",
    "app.post('/api/auth/login'",
  )
  assert.match(route, /response\.status\(403\)/u)
  assert.match(route, /REGISTRATION_VIA_FEISHU_ONLY/u)
  assert.doesNotMatch(route, /insert into users|createSession/u)
  assert.doesNotMatch(serverSource, /async function registerPasswordUser/u)
})

test('registration invite acceptance verifies the password before locking and validates the live record', () => {
  const helper = sourceBetween(
    'async function acceptProjectInviteTokenWithClient',
    'async function acceptProjectInviteToken(',
  )

  assert.match(helper, /l\.revoked_at is null/u)
  assert.match(helper, /l\.expires_at > now\(\)/u)
  assert.match(helper, /for update of l/u)
  const passwordIndex = helper.indexOf('verifyProjectInvitePassword(snapshot.password_hash, rawPassword)')
  const projectLockIndex = helper.indexOf('lockProjectModules(client')
  assert.ok(passwordIndex >= 0 && passwordIndex < projectLockIndex)
  assert.match(helper, /inviteRow\.password_hash !== snapshot\.password_hash/u)
})

test('maintenance login policy allows platform admins and limits forced recovery to builtin admin', () => {
  const route = sourceBetween(
    "app.post('/api/auth/login'",
    "app.get('/api/auth/me'",
  )
  const policyIndex = route.indexOf('platformLoginAccess(platformStatus)')
  const userQueryIndex = route.indexOf("const user = await query")

  assert.ok(policyIndex >= 0 && policyIndex < userQueryIndex)
  assert.match(route, /loginAccess === 'blocked'/u)
  assert.match(route, /loginAccess === 'builtin-admin-only' && !row\.is_builtin_admin/u)
  assert.match(route, /loginAccess === 'platform-admin-only' && !row\.is_platform_admin/u)
  assert.match(route, /loginAccess === 'open'/u)
  assert.match(route, /平台正在维护，暂时无法登录/u)
  assert.match(route, /当前只允许超级管理员登录/u)
  assert.match(route, /当前只允许内置 admin 登录/u)
  assert.ok(route.indexOf("if (loginAccess === 'open')") < route.indexOf('acceptProjectInviteToken'))
})
