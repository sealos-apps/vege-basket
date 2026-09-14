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

test('shared-AI password registration accepts project or organization invites inside the user transaction', () => {
  const registration = sourceBetween(
    'async function registerPasswordUser',
    'async function getProjectAccess',
  )
  const route = sourceBetween(
    "app.post('/api/auth/register'",
    "app.post('/api/auth/login'",
  )
  const insertIndex = registration.indexOf('insert into users')
  const projectAcceptIndex = registration.indexOf('acceptProjectInviteTokenWithClient')
  const organizationAcceptIndex = registration.indexOf('acceptOrganizationInviteTokenWithClient')
  const commitIndex = registration.indexOf("client.query('commit')")
  const registrationIndex = route.indexOf('registerPasswordUser')
  const sessionIndex = route.indexOf('createSession')

  assert.ok(insertIndex >= 0)
  assert.ok(insertIndex < projectAcceptIndex)
  assert.ok(projectAcceptIndex < organizationAcceptIndex)
  assert.ok(organizationAcceptIndex < commitIndex)
  assert.ok(registrationIndex >= 0)
  assert.ok(registrationIndex < sessionIndex)
  assert.match(
    registration,
    /if \(params\.requireInvite && !projectInviteAccepted && !organizationInviteAccepted\) \{[\s\S]*?client\.query\('rollback'\)/u,
  )
  assert.doesNotMatch(route, /isActiveProjectInviteToken/u)
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
