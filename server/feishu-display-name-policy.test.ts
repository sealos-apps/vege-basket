import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const apiSource = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const platformAdminSource = readFileSync(new URL('./platform-admins.ts', import.meta.url), 'utf8')
const organizationSource = readFileSync(new URL('./organizations.ts', import.meta.url), 'utf8')
const accountSettingsSource = readFileSync(
  new URL('../src/components/account-settings-dialog.tsx', import.meta.url),
  'utf8',
)
const platformWorkbenchSource = readFileSync(
  new URL('../src/components/platform-management-workbench.tsx', import.meta.url),
  'utf8',
)

test('only the builtin administrator can write a display name directly', () => {
  assert.match(appSource, /app\.patch\('\/api\/auth\/me'/u)
  assert.match(appSource, /updateBuiltinAdminDisplayName/u)
  assert.match(platformAdminSource, /!row\.is_builtin_admin \|\| row\.grant_kind !== 'builtin'/u)
  assert.match(platformAdminSource, /DISPLAY_NAME_EDIT_FORBIDDEN/u)
  assert.match(platformAdminSource, /input\.actorUserId/u)
  assert.match(platformAdminSource, /values \(\$1::bigint, 'user\.display_name_updated', 'user', \$1::text/u)
  assert.doesNotMatch(appSource, /update users\s+set display_name = \$1,[\s\S]*where id = \$2[\s\S]*app\.post\('\/api\/auth\/feishu\/name-sync'/u)
})

test('non-builtin users update display names only through Feishu synchronization', () => {
  assert.match(appSource, /app\.post\('\/api\/auth\/feishu\/name-sync'/u)
  assert.match(appSource, /app\.post\('\/api\/admin\/users\/:userId\/feishu-name-sync'/u)
  assert.match(appSource, /fetchConfiguredFeishuUserName\(row\.feishu_user_id\)/u)
  assert.match(appSource, /lockedRow\.feishu_user_id !== row\.feishu_user_id/u)
  assert.match(platformAdminSource, /row\.feishu_user_id !== input\.expectedFeishuUserId/u)
  assert.match(platformAdminSource, /BUILTIN_ADMIN_FEISHU_FORBIDDEN/u)
  assert.match(organizationSource, /dependencies\.fetchFeishuUserName\(operatorOpenId\)/u)
  assert.match(organizationSource, /display_name = \$3/u)
  assert.doesNotMatch(organizationSource, /email\.split\('@'\)\[0\]/u)
})

test('builtin administrator cannot bind or synchronize a Feishu identity', () => {
  assert.match(appSource, /account\.rows\[0\]\?\.is_builtin_admin/u)
  assert.match(appSource, /where id = \$3 and not is_builtin_admin/u)
  assert.match(appSource, /and not users\.is_builtin_admin/u)
  assert.match(organizationSource, /matchedUsers\.rows\[0\]\?\.is_builtin_admin/u)
  assert.match(organizationSource, /where id = \$4 and not is_builtin_admin/u)
  assert.match(appSource, /BUILTIN_ADMIN_FEISHU_FORBIDDEN/u)
})

test('client exposes admin editing and Feishu synchronization as separate actions', () => {
  assert.match(apiSource, /export function syncCurrentUserFeishuName/u)
  assert.match(apiSource, /export function syncManagedUserFeishuName/u)
  assert.match(accountSettingsSource, /isBuiltinAdmin \? '保存姓名' : '同步飞书姓名'/u)
  assert.match(accountSettingsSource, /readOnly=\{!isBuiltinAdmin\}/u)
  assert.match(platformWorkbenchSource, /飞书已绑定/u)
  assert.match(platformWorkbenchSource, /飞书未绑定/u)
  assert.match(platformWorkbenchSource, /user\.feishuLinked/u)
  assert.doesNotMatch(platformWorkbenchSource, /修改姓名/u)
})

test('new-user display-name onboarding has been removed', () => {
  assert.doesNotMatch(appSource, /displayNameOnboarding/u)
  assert.doesNotMatch(appSource, /请设置真实姓名/u)
})
