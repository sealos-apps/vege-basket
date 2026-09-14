import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { PoolClient } from 'pg'
import { encryptText } from './crypto.ts'
import {
  getProjectMemberTaskBlockers,
  hasMemberTaskBlockers,
  memberTaskBlockerMessage,
} from './project-membership-policy.ts'
import {
  canTransferProjectOrganization,
  getProjectOrganizationTransferBlockers,
  getProjectOrganizationTransferBlockersByTarget,
} from './project-organization-transfer.ts'

process.env.APP_ENCRYPTION_ACTIVE_KEY_ID = 'test'
process.env.APP_ENCRYPTION_KEYS = `test:${Buffer.alloc(32, 19).toString('base64')}`

type Call = { sql: string; values: unknown[] }

function fakeClient(answer: (call: Call) => object[]) {
  return {
    query: async (sql: string, values: unknown[] = []) => ({ rows: answer({ sql, values }) }),
  } as unknown as PoolClient
}

test('transfer preflight reports missing people, pending invitations, and missing or disabled used modules', async () => {
  const client = fakeClient(({ sql }) => {
    if (sql.includes('project_people as')) {
      return [{ display_name: '缺少成员', email: 'missing@example.com', organization_id: '5', user_id: '7' }]
    }
    if (sql.includes('pending_count')) return [{ pending_count: '2', unbound_active_count: '1' }]
    if (sql.includes('having target.id is null')) {
      return [
        { enabled: null, name: encryptText('支付'), organization_id: '5', project_module_id: '11', target_module_id: null, todo_count: '3' },
        { enabled: false, name: encryptText('登录'), organization_id: '5', project_module_id: '12', target_module_id: '22', todo_count: '1' },
      ]
    }
    return []
  })
  const blockers = await getProjectOrganizationTransferBlockers(client, 3, 5)
  assert.deepEqual(blockers, {
    missingMembers: [{ name: '缺少成员', userId: 7 }],
    pendingInvitationCount: 2,
    unboundActiveMemberCount: 1,
    unavailableModules: [
      { name: '支付', projectModuleId: 11, reason: 'missing', todoCount: 3 },
      { name: '登录', projectModuleId: 12, reason: 'disabled', todoCount: 1 },
    ],
  })
  assert.equal(canTransferProjectOrganization(blockers), false)
})

test('transfer eligibility needs no blockers and checks only modules referenced by todos', async () => {
  const client = fakeClient(({ sql }) => sql.includes('pending_count')
    ? [{ pending_count: '0', unbound_active_count: '0' }]
    : [])
  const blockers = await getProjectOrganizationTransferBlockers(client, 3, 5)
  assert.deepEqual(blockers, {
    missingMembers: [],
    pendingInvitationCount: 0,
    unboundActiveMemberCount: 0,
    unavailableModules: [],
  })
  assert.equal(canTransferProjectOrganization(blockers), true)
})

test('transfer option preflight batches all target organizations into three queries', async () => {
  const calls: Call[] = []
  const client = fakeClient((call) => {
    calls.push(call)
    if (call.sql.includes('project_people as')) {
      return [{ display_name: null, email: 'member@example.com', organization_id: '8', user_id: '9' }]
    }
    if (call.sql.includes('pending_count')) return [{ pending_count: '0', unbound_active_count: '0' }]
    return []
  })
  const blockers = await getProjectOrganizationTransferBlockersByTarget(client, 3, [5, 8])
  assert.equal(calls.length, 3)
  assert.deepEqual(calls[0]?.values, [3, [5, 8]])
  assert.deepEqual(blockers.get(5)?.missingMembers, [])
  assert.deepEqual(blockers.get(8)?.missingMembers, [{ name: 'member@example.com', userId: 9 }])
})

test('project member task policy treats only actionable work as a blocker', async () => {
  const blockers = await getProjectMemberTaskBlockers(fakeClient(() => [{
    milestone_count: '1',
    package_event_count: '2',
    todo_count: '3',
  }]), 4, 8)
  assert.deepEqual(blockers, { milestones: 1, packageEvents: 2, todos: 3 })
  assert.equal(hasMemberTaskBlockers(blockers), true)
  assert.match(memberTaskBlockerMessage(blockers), /待处理待办 3 项.*未交付事件 2 项.*未结束里程碑 1 项/u)
  assert.equal(hasMemberTaskBlockers({ milestones: 0, packageEvents: 0, todos: 0 }), false)
})

test('transfer transaction follows lock order, preserves local module ids, and applies boundary side effects', () => {
  const source = readFileSync(new URL('./organizations.ts', import.meta.url), 'utf8')
  const start = source.indexOf("router.post('/organizations/:organizationId/projects/:projectId/organization-transfer'")
  const end = source.indexOf("router.post('/organizations/:organizationId/projects/:projectId/members'", start)
  const route = source.slice(start, end)
  const catalogLock = route.indexOf('lockOrganizationModuleCatalog')
  const projectLock = route.indexOf('lockProjectModules')
  const projectRowLock = route.indexOf('for update')
  const managerLock = route.indexOf('lockOrganizationProjectManagers')
  const firstWrite = route.indexOf('detachOrganizationProjectModules')
  assert.ok(catalogLock >= 0 && catalogLock < projectLock)
  assert.ok(projectLock < projectRowLock && projectRowLock < managerLock && managerLock < firstWrite)
  assert.match(route, /getProjectOrganizationTransferBlockers\(client/u)
  assert.match(route, /transferableScope[\s\S]+pool\.connect/u)
  assert.match(route, /detachOrganizationProjectModules\(client, sourceOrganizationId!, projectId\)[\s\S]+syncOrganizationProjectModules\(client, targetOrganizationId, projectId\)/u)
  assert.doesNotMatch(route, /delete from project_modules/u)
  assert.match(route, /project\.transferred_out/u)
  assert.match(route, /project\.transferred_in/u)
  assert.match(route, /project_transfer_requests[\s\S]+status = 'revoked'/u)
  assert.match(route, /project_invite_links set revoked_at/u)
  assert.match(route, /project_integrations set enabled = false/u)
  assert.match(route, /organization_weekly_report_sources[\s\S]+revision_id is null/u)
})

test('both project member removal paths block active assignments without clearing history', () => {
  const organizationSource = readFileSync(new URL('./organizations.ts', import.meta.url), 'utf8')
  const organizationStart = organizationSource.indexOf("router.delete('/organizations/:organizationId/projects/:projectId/members/:membershipId'")
  const organizationEnd = organizationSource.indexOf("router.patch('/organizations/:organizationId/projects/:projectId/governance'", organizationStart)
  const organizationRoute = organizationSource.slice(organizationStart, organizationEnd)
  const indexSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
  const settingsStart = indexSource.indexOf("app.delete('/api/projects/:projectId/invitations/:membershipId'")
  const settingsEnd = indexSource.indexOf("app.post('/api/projects/:projectId/modules'", settingsStart)
  const settingsRoute = indexSource.slice(settingsStart, settingsEnd)
  for (const route of [organizationRoute, settingsRoute]) {
    assert.match(route, /getProjectMemberTaskBlockers/u)
    assert.match(route, /PROJECT_MEMBER_HAS_TASKS/u)
    assert.doesNotMatch(route, /update todos\s+set assignee_user_id = null/u)
    assert.doesNotMatch(route, /delete from todo_watchers/u)
  }
})

test('organization member removal blocks project and test work instead of clearing assignments', () => {
  const source = readFileSync(new URL('./organizations.ts', import.meta.url), 'utf8')
  const start = source.indexOf("router.delete('/organizations/:organizationId/members/:userId'")
  const end = source.indexOf('async function respondWithOrganizationDetail', start)
  const route = source.slice(start, end)
  assert.match(route, /getOrganizationMemberTaskBlockers/u)
  assert.match(route, /ORGANIZATION_MEMBER_HAS_TASKS/u)
  assert.doesNotMatch(route, /update test_bugs/u)
  assert.doesNotMatch(route, /update todos set assignee_user_id = null/u)
})

test('organization workbench exposes transfer preflight and uncertain-result reconciliation', () => {
  const source = readFileSync(new URL('../src/components/organization-workbench.tsx', import.meta.url), 'utf8')
  assert.match(source, /title="迁移所属组织"/u)
  assert.match(source, /fetchProjectOrganizationTransferOptions/u)
  assert.match(source, /confirmDisabled=\{loading \|\| !selectedOption\?\.eligible\}/u)
  assert.match(source, /actionKey=\{`project-organization-transfer:\$\{detail\.id\}:\$\{project\.id\}`\}/u)
  assert.match(source, /attemptedTargetIdRef\.current = selectedOption\.id/u)
  assert.match(source, /const target = await fetchOrganization\(attemptedTargetId\)/u)
  assert.match(source, /const source = await fetchOrganization\(detail\.id\)/u)
  assert.match(source, /response\.blockers[\s\S]+eligible: false/u)
  assert.match(source, /unboundActiveMemberCount/u)
})

test('invite-link password verification finishes before organization and project locks', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
  const start = source.indexOf('async function acceptProjectInviteTokenWithClient')
  const end = source.indexOf('async function acceptProjectInviteToken(', start)
  const acceptInvite = source.slice(start, end)
  const passwordCheck = acceptInvite.indexOf('verifyProjectInvitePassword(snapshot.password_hash')
  const organizationLock = acceptInvite.indexOf("select id from organizations where id = $1 for share")
  const projectLock = acceptInvite.indexOf('lockProjectModules')
  assert.ok(passwordCheck >= 0 && passwordCheck < organizationLock && organizationLock < projectLock)
  assert.match(acceptInvite, /inviteRow\.password_hash !== snapshot\.password_hash/u)
})
