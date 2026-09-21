import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const apiSource = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8')
const clientAppSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const platformAdminSource = readFileSync(new URL('./platform-admins.ts', import.meta.url), 'utf8')
const routerSource = readFileSync(new URL('./platform-management-router.ts', import.meta.url), 'utf8')
const workbenchSource = readFileSync(
  new URL('../src/components/platform-management-workbench.tsx', import.meta.url),
  'utf8',
)
const appSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const runtimeSource = readFileSync(new URL('./platform-config-runtime.ts', import.meta.url), 'utf8')
const configStoreSource = readFileSync(new URL('./platform-config-store.ts', import.meta.url), 'utf8')
const digestWorkerSource = readFileSync(new URL('./todo-digest-worker.ts', import.meta.url), 'utf8')
const cliSource = readFileSync(new URL('./platform-config-cli.ts', import.meta.url), 'utf8')
const platformOrganizationsSource = readFileSync(new URL('./platform-organizations.ts', import.meta.url), 'utf8')
const accountOffboardingSource = readFileSync(new URL('./account-offboarding.ts', import.meta.url), 'utf8')
const maintenanceSource = readFileSync(new URL('./platform-maintenance.ts', import.meta.url), 'utf8')
const migrationsSource = readFileSync(new URL('./database-migrations.ts', import.meta.url), 'utf8')

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

test('Feishu AI retry stays idle before the first platform configuration exists', () => {
  assert.match(runtimeSource, /export function getOptionalPlatformConfigSnapshot/u)
  assert.match(appSource, /getOptionalPlatformConfigSnapshot\(\)\?\.config\.feishu\.aiChatEnabled === true/u)
})

test('platform user controls protect the builtin administrator', () => {
  assert.match(workbenchSource, /user\.isBuiltinAdmin \|\| user\.accountStatus !== 'active'/u)
  assert.match(workbenchSource, /disabled=\{busy \|\| user\.isBuiltinAdmin\}/u)
  assert.match(workbenchSource, /disabled=\{busy \|\| user\.isBuiltinAdmin \|\| user\.id === currentUserId\}/u)
  assert.match(workbenchSource, /内置 admin 的超管权限不可移除/u)
  assert.doesNotMatch(workbenchSource, /返回工作台/u)
})

test('platform administrator candidates come from the server eligibility policy', () => {
  assert.match(workbenchSource, /users\.filter\(\(user\) => user\.platformAdminEligible\)/u)
  assert.match(workbenchSource, /历史飞书账号会按已有 Open ID 识别/u)
  assert.match(apiSource, /platformAdminEligible: boolean/u)
})

test('active sessions refresh platform administrator grants without reloading the workspace', () => {
  assert.match(appSource, /app\.get\('\/api\/auth\/context'/u)
  assert.match(appSource, /request\.path === '\/auth\/context'/u)
  assert.match(apiSource, /export function fetchCurrentAuthContext\(\)/u)
  assert.match(apiSource, /request<\{ user: AuthUser \}>\('\/api\/auth\/context'\)/u)

  const clientSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(clientSource, /fetchCurrentAuthContext\(\)/u)
  assert.match(clientSource, /sameAuthContext\(current, result\.user\)/u)
  assert.match(clientSource, /authContextRefreshIntervalMs/u)
})

test('account disabling reports the canonical mutation result to the confirmation dialog', () => {
  assert.match(workbenchSource, /const result = await updateManagedUserStatus\(user, status\)/u)
  assert.match(workbenchSource, /accountStatus: result\.accountStatus/u)
  assert.match(workbenchSource, /permissionVersion: result\.permissionVersion/u)
  assert.match(workbenchSource, /onConfirm=\{\(\) => disableUser\(user\)\}/u)
  assert.doesNotMatch(workbenchSource, /await setUserStatus\(user, 'disabled'\); return true/u)
})

test('successful platform configuration writes clear plaintext drafts before refresh', () => {
  const saveStart = workbenchSource.indexOf('async function saveSection')
  const saveEnd = workbenchSource.indexOf('async function testSection', saveStart)
  const saveSource = workbenchSource.slice(saveStart, saveEnd)

  assert.ok(saveSource.indexOf('await savePlatformConfigSection') < saveSource.indexOf('setSecrets({})'))
  assert.ok(saveSource.indexOf('setSecrets({})') < saveSource.indexOf('await loadConfig()'))
})

test('unchanged platform configuration does not create a version or trigger a reload', () => {
  const saveStart = configStoreSource.indexOf('export async function savePlatformConfigSection')
  const saveEnd = configStoreSource.indexOf('export async function revealCurrentPlatformSecret', saveStart)
  const saveSource = configStoreSource.slice(saveStart, saveEnd)
  const restoreStart = configStoreSource.indexOf('export async function restorePlatformConfig')
  const restoreEnd = configStoreSource.indexOf('export async function getLegacyPlatformSecrets', restoreStart)
  const restoreSource = configStoreSource.slice(restoreStart, restoreEnd)

  assert.ok(saveSource.indexOf('changes.length === 0') < saveSource.indexOf('insert into platform_config_versions'))
  assert.ok(restoreSource.indexOf('changes.length === 0') < restoreSource.indexOf('insert into platform_config_versions'))
  assert.match(saveSource, /noop:save:/u)
  assert.match(restoreSource, /noop:restore/u)
  assert.match(routerSource, /if \(result\.changed\) void refreshPlatformConfig/u)
  assert.match(workbenchSource, /disabled=\{busy \|\| !sectionChanged\}/u)
})

test('platform configuration history exposes safe change and restore previews', () => {
  assert.match(routerSource, /\/admin\/platform-config\/history\/:revision/u)
  assert.match(workbenchSource, /恢复此版本将产生的变化/u)
  assert.match(workbenchSource, /当前配置没有变化，未生成新版本/u)
  assert.match(workbenchSource, />还原<\/Button>/u)
  assert.doesNotMatch(workbenchSource, /撤销修改/u)
})

test('GitHub Actions configuration has no enable switch', () => {
  assert.doesNotMatch(workbenchSource, /启用 GitHub Actions/u)
  assert.doesNotMatch(workbenchSource, /draft\.github\.enabled/u)
})

test('platform secrets use the prototype replacement dialog contract', () => {
  assert.match(workbenchSource, /editorValue\.length < 8/u)
  assert.match(workbenchSource, />更新草稿</u)
  assert.match(workbenchSource, /allowGenerate=\{section === 'storage' && field === 'urlSecret'\}/u)
  assert.match(workbenchSource, /生成随机密钥/u)
  assert.match(workbenchSource, /setEditorValue\(''\)/u)
  assert.doesNotMatch(workbenchSource, /确认新/u)
  assert.doesNotMatch(workbenchSource, /confirmation:/u)
})

test('platform management removes the legacy Feishu analysis webhook settings', () => {
  assert.doesNotMatch(workbenchSource, /通知账号/u)
  assert.doesNotMatch(workbenchSource, /Webhook 访问账号/u)
  assert.doesNotMatch(workbenchSource, /Webhook 密码/u)
  assert.match(workbenchSource, /platformConfigRuntimeOverallStatus/u)
  assert.match(runtimeSource, /interval '5 minutes'/u)
  assert.match(runtimeSource, /'loading'/u)
  assert.match(runtimeSource, /'offline'/u)
  assert.doesNotMatch(appSource, /app\.post\('\/api\/integrations\/feishu\/conversation-analysis'/u)
})

test('Feishu callback addresses derive from the editable platform public address', () => {
  assert.doesNotMatch(routerSource, /fixedCallbacks|getPlatformInstanceSettings/u)
  assert.doesNotMatch(configStoreSource, /platform_instance_settings/u)
  assert.doesNotMatch(cliSource, /event-callback-url|oauth-redirect-url|platform_instance_settings/u)
  assert.match(cliSource, /option\('--public-url'\)/u)
  assert.match(workbenchSource, /derivePlatformCallbackUrls\(draft\.general\.publicUrl\)/u)
  assert.match(workbenchSource, /根据公网地址自动生成/u)
  assert.match(appSource, /derivePlatformCallbackUrls\(platformPublicUrl\(\)\)/u)
  assert.match(appSource, /PLATFORM_PUBLIC_URL_REQUIRED/u)
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

test('maintenance mode blocks business APIs while keeping administrator recovery routes', () => {
  assert.match(appSource, /app\.use\('\/api', platformMaintenanceMiddleware\)/u)
  assert.match(maintenanceSource, /code: 'PLATFORM_MAINTENANCE'/u)
  assert.match(maintenanceSource, /'\/admin\/platform-config'/u)
  assert.match(maintenanceSource, /'\/admin\/platform-maintenance'/u)
  assert.match(maintenanceSource, /'\/admin\/users'/u)
  assert.match(maintenanceSource, /'\/admin\/organizations'/u)
  assert.match(maintenanceSource, /PLATFORM_MAINTENANCE_DISABLE_BLOCKED/u)
  assert.match(maintenanceSource, /result_changed/u)
  assert.match(maintenanceSource, /when \$1::boolean and maintenance_enabled then enabled_by_user_id/u)
  assert.match(maintenanceSource, /insert into platform_maintenance_periods/u)
  assert.match(maintenanceSource, /duration_seconds = greatest/u)
  assert.equal(maintenanceSource.match(/rowCount === 0 && current\.enabled_by_user_id !== null/gu)?.length, 2)
  assert.match(maintenanceSource, /export async function listPlatformMaintenanceHistory/u)
  assert.match(routerSource, /\/admin\/platform-maintenance\/history/u)
  assert.match(workbenchSource, /维护开始与结束时间由数据库记录/u)
  assert.match(workbenchSource, /maintenanceDurationLabel/u)
  assert.match(workbenchSource, /系统正在强制维护/u)
  assert.match(workbenchSource, /maintenanceAppliedCount/u)
  assert.match(workbenchSource, /platform-migration-row/u)
  assert.match(workbenchSource, /手动维护期间仅允许超级管理员登录/u)
  assert.match(apiSource, /requestPlatformMutation\('maintenance'/u)
  assert.match(clientAppSource, /!workspaceLoaded && !maintenanceAdmin/u)
  assert.match(clientAppSource, /超级管理员登录/u)
  assert.match(clientAppSource, /内置管理员登录/u)
  assert.match(clientAppSource, /飞书登录只匹配已有超级管理员账号/u)
})

test('automatic database migrations are serialized, checksummed, and recorded', () => {
  assert.match(migrationsSource, /const migrationId = '20260921_schema_v6'/u)
  assert.match(migrationsSource, /pg_try_advisory_lock/u)
  assert.match(migrationsSource, /createHash\('sha256'\)\.update\(schemaSql\)/u)
  assert.match(migrationsSource, /DATABASE_MIGRATION_CHECKSUM_MISMATCH/u)
  assert.match(migrationsSource, /insert into application_migrations/u)
  assert.match(migrationsSource, /isRetryableDatabaseConnectionError/u)
  assert.ok(migrationsSource.indexOf('client = await pool.connect()') < migrationsSource.indexOf("status = { phase: 'running', startedAt }", migrationsSource.indexOf('client = await pool.connect()')))
  assert.ok(appSource.indexOf('app.listen(port') < appSource.indexOf('runAutomaticDatabaseMigrations()'))
  assert.ok(appSource.indexOf("app.use('/api', platformMaintenanceMiddleware)") < appSource.indexOf("app.post('/api/todo-images'"))
  assert.match(appSource, /request\.path === '\/health' \|\| request\.path === '\/ready'/u)
})
