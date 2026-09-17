import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const apiSource = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8')
const platformAdminSource = readFileSync(new URL('./platform-admins.ts', import.meta.url), 'utf8')
const routerSource = readFileSync(new URL('./platform-management-router.ts', import.meta.url), 'utf8')
const workbenchSource = readFileSync(
  new URL('../src/components/platform-management-workbench.tsx', import.meta.url),
  'utf8',
)
const appSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const digestWorkerSource = readFileSync(new URL('./todo-digest-worker.ts', import.meta.url), 'utf8')
const cliSource = readFileSync(new URL('./platform-config-cli.ts', import.meta.url), 'utf8')
const platformOrganizationsSource = readFileSync(new URL('./platform-organizations.ts', import.meta.url), 'utf8')
const accountOffboardingSource = readFileSync(new URL('./account-offboarding.ts', import.meta.url), 'utf8')

test('standalone platform administrator mutations are idempotent and audited', () => {
  const routeStart = routerSource.indexOf("platformManagementRouter.post('/admin/platform-admins'")
  const routeEnd = routerSource.indexOf("platformManagementRouter.get('/admin/organizations'", routeStart)
  const route = routerSource.slice(routeStart, routeEnd)
  const clientStart = apiSource.indexOf('export function setPlatformAdmin')
  const client = apiSource.slice(clientStart, apiSource.indexOf('export function fetchPlatformOrganizations', clientStart))

  assert.match(route, /requestId = String\(request\.body\?\.requestId \?\? ''\)/u)
  assert.equal(route.match(/uuidPattern\.test\(requestId\)/gu)?.length, 2)
  assert.equal(route.match(/requestId,/gu)?.length, 2)
  assert.match(client, /const requestId = crypto\.randomUUID\(\)/u)
  assert.match(client, /body: JSON\.stringify\(\{ userId, expectedVersion, requestId \}\)/u)
  assert.match(platformAdminSource, /from platform_user_mutation_receipts/u)
  assert.match(platformAdminSource, /'platform-admin'/u)
  assert.match(platformAdminSource, /request_id\)\s*\n\s*values/u)
})

test('user mutation replay verifies the stored action discriminator', () => {
  assert.match(platformAdminSource, /action !== 'platform-admin'/u)
  assert.match(platformAdminSource, /action !== 'permissions'/u)
  assert.match(accountOffboardingSource, /action !== 'offboard'/u)
  assert.match(accountOffboardingSource, /action !== 'status'/u)
})

test('package configuration save rejects non-text rules before persistence', () => {
  const routeStart = routerSource.indexOf("platformManagementRouter.put('/admin/platform-config/:section'")
  const routeEnd = routerSource.indexOf("'/admin/platform-config/:section/secrets/:field/reveal'", routeStart)
  const route = routerSource.slice(routeStart, routeEnd)

  assert.match(route, /typeof rulesYaml !== 'string'/u)
  assert.ok(route.indexOf("typeof rulesYaml !== 'string'") < route.indexOf('savePlatformConfigSection({'))
})

test('Feishu tenant tokens are isolated by platform configuration revision', () => {
  for (const source of [appSource, digestWorkerSource]) {
    assert.match(source, /configRevision: number/u)
    assert.match(source, /configRevision ===/u)
  }
})

test('platform user controls protect the builtin administrator', () => {
  assert.match(workbenchSource, /user\.isBuiltinAdmin \|\| user\.accountStatus !== 'active'/u)
  assert.match(workbenchSource, /disabled=\{busy \|\| user\.isBuiltinAdmin\}/u)
  assert.match(workbenchSource, /disabled=\{busy \|\| user\.isBuiltinAdmin \|\| user\.id === currentUserId\}/u)
  assert.match(workbenchSource, /内置 admin 的超管权限不可移除/u)
  assert.doesNotMatch(workbenchSource, /返回工作台/u)
})

test('builtin administrator bootstrap validates the complete existing account', () => {
  const bootstrapStart = cliSource.indexOf('async function bootstrapAdmin')
  const bootstrapEnd = cliSource.indexOf('async function initializeFreshInstall', bootstrapStart)
  const bootstrap = cliSource.slice(bootstrapStart, bootstrapEnd)

  assert.match(bootstrap, /grant_row\.grant_kind/u)
  assert.match(bootstrap, /existing\.account_status !== 'active'/u)
  assert.match(bootstrap, /existing\.grant_kind !== 'builtin'/u)
  assert.ok(bootstrap.indexOf("existing.account_status !== 'active'") < bootstrap.indexOf("console.log('内置 admin 已初始化。')"))
})

test('platform organization search does not silently truncate the directory', () => {
  const listStart = platformOrganizationsSource.indexOf('export async function listPlatformOrganizations')
  const listEnd = platformOrganizationsSource.indexOf('export async function createPlatformOrganization', listStart)
  const listSource = platformOrganizationsSource.slice(listStart, listEnd)

  assert.doesNotMatch(listSource, /limit 1000/u)
})
