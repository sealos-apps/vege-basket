/** Explicitly opt in: VEGES_INTEGRATION_DATABASE_URL=... npm run test:resource-management.
 * Creates and removes only a uniquely named schema; never uses public as a fallback.
 */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import pg from 'pg'
import { shareOrganizationTestEnvironments } from './test-environment-sharing.ts'
import { schemaSql } from './schema.ts'

const sourceUrl = process.env.VEGES_INTEGRATION_DATABASE_URL
if (!sourceUrl) throw new Error('VEGES_INTEGRATION_DATABASE_URL must explicitly authorize the integration database')
const schema = `veges_resource_test_${crypto.randomBytes(8).toString('hex')}`
const databaseUrl = new URL(sourceUrl)
databaseUrl.searchParams.set('options', `-c search_path=${schema}`)
const control = new pg.Pool({ connectionString: sourceUrl, max: 1 })
const db = new pg.Pool({ connectionString: databaseUrl.toString(), max: 4 })
const key = crypto.randomBytes(32).toString('base64')
process.env.APP_ENCRYPTION_ACTIVE_KEY_ID = 'integration'
process.env.APP_ENCRYPTION_KEYS = `integration:${key}`
const { encryptText, blindIndex, decryptText } = await import('./crypto.ts')
const listener = net.createServer().listen(0, '127.0.0.1')
await once(listener, 'listening')
const port = (listener.address() as net.AddressInfo).port
await new Promise<void>((resolve) => listener.close(() => resolve()))
const base = `http://127.0.0.1:${port}/api`
const tokens = new Map<number, string>()
let api: ReturnType<typeof spawn> | undefined
let keep = false
let passed = 0

async function call<T = unknown>(user: number, path: string, method = 'GET', body?: unknown, expected = 200) {
  const result = await fetch(`${base}${path}`, {
    method, headers: { Authorization: `Bearer ${tokens.get(user)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await result.json()
  assert.equal(result.status, expected, `${method} ${path}: ${JSON.stringify(data)}`)
  passed++
  return data as T
}
async function createProject(owner = 1, organizationId: number | null = 1) {
  const r = await db.query('insert into projects(user_id,organization_id,name,status) values($1,$2,$3,\'active\') returning id', [owner, organizationId, encryptText('权限验收项目')])
  return Number(r.rows[0].id)
}
async function createSpace(version: string, organizationId = 1) {
  const r = await db.query('insert into test_spaces(owner_user_id,organization_id,name,version_label,version_label_lookup) values(1,$1,$2,$3,$4) returning id', [organizationId, encryptText('权限验收空间'), encryptText(version), blindIndex(version)])
  const id = Number(r.rows[0].id)
  await db.query("insert into test_space_memberships(test_space_id,user_id,access_level,status) values($1,1,'owner','active')", [id])
  return id
}
try {
  await control.query(`create schema ${schema}`)
  await db.query(schemaSql)
  await db.query(schemaSql)
  for (let id = 1; id <= 7; id++) {
    await db.query('insert into users(id,email,display_name) values($1,$2,$3)', [id, `resource-user-${id}`, ['','原所有者','组织管理员','接收成员','仅职业管理员','仅组织管理员','外部成员','只读成员'][id]])
    const roles = [2,4].includes(id) ? ['organization_admin'] : ['tester']
    for (const role of roles) await db.query('insert into user_roles(user_id,role) values($1,$2)', [id, role])
    const token = crypto.randomBytes(32).toString('hex')
    tokens.set(id, token)
    await db.query("insert into sessions(token,user_id,expires_at,active_role) values($1,$2,now()+interval '1 day','tester')", [token,id])
  }
  for (const id of [1,2]) {
    await db.query('insert into organizations(id,owner_user_id,name,name_lookup) values($1,1,$2,$3)', [id, encryptText(`验收组织${id}`), blindIndex(`验收组织${id}`)])
    for (const user of [1,2,3,4,5,7]) await db.query("insert into organization_memberships(organization_id,user_id,access_role,status) values($1,$2,$3,'active')", [id,user,user === 1 ? 'owner' : [2,5].includes(user) ? 'admin' : 'member'])
  }
  fs.mkdirSync('.context', { recursive: true })
  const log = fs.openSync('.context/resource-integration-api.log', 'w', 0o600)
  api = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, DATABASE_URL: databaseUrl.toString(), PORT: String(port), APP_PUBLIC_URL: `http://127.0.0.1:${port}`, FEISHU_DELIVERY_ENABLED:'false', FEISHU_AI_CHAT_ENABLED:'false', FEISHU_APP_ID:'', FEISHU_APP_SECRET:'', AI_API_KEY:'', AI_API_BASE:'', AI_MODEL:'', GITHUB_ACTIONS_TOKEN:'', VEGES_ADMIN_USERNAMES:'' },
    stdio: ['ignore',log,log], detached: true,
  })
  fs.closeSync(log)
  let ready = false
  for (let i = 0; i < 100; i++) {
    if (api.exitCode !== null) throw new Error('Integration API exited; inspect the private integration log')
    try { if ((await fetch(`${base}/health`)).ok) { ready = true; break } } catch { /* booting */ }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  assert.ok(ready, 'API must start within 20 seconds')
  const project = await createProject()
  const personal = await createProject(1,null)
  const space = await createSpace('v1')
  const workspace = await call<{ projects: Array<{ id: number; ownerUserId: number; accessRole: string; canManageSettings: boolean; readOnly: boolean }> }>(2,'/workspace')
  const visible = workspace.projects.find((p: { id: number }) => p.id === project)
  assert.ok(visible, 'Managed project should be visible')
  assert.equal(visible.ownerUserId,1)
  assert.equal(visible.accessRole,'member')
  assert.equal(visible.canManageSettings,true)
  assert.equal(visible.readOnly,true)
  // Organization management must work without switching the business persona.
  await db.query("update sessions set active_role='developer' where user_id=2")
  await call(2, '/test-spaces/settings')
  await call(2, '/test-workbench', 'GET', undefined, 403)
  await call(2, `/test-spaces/${space}/subjects`, 'POST', {name:'禁止业务写入'}, 403)
  await db.query("update sessions set active_role='developer' where user_id=5")
  await call(5, '/test-spaces/settings', 'GET', undefined, 403)
  await db.query("update sessions set active_role='tester' where user_id=5")
  const organization = await call<{ canManageTestSpaces: boolean; projects: Array<{id:number; description:string; tags:string[]; canManageSettings:boolean; canTransferOwnership:boolean}> }>(2, '/organizations/1')
  assert.equal(organization.canManageTestSpaces, true)
  const organizationProject = organization.projects.find((item) => item.id === project)!
  assert.equal(organizationProject.canManageSettings, true)
  assert.equal(organizationProject.canTransferOwnership, true)
  assert.equal(typeof organizationProject.description, 'string')
  assert.ok(Array.isArray(organizationProject.tags))
  await call(2, '/test-spaces', 'POST', {name:'组织页新建空间', versionLabel:'v-create', organizationId:1}, 201)
  for (const user of [4,5,6,7]) await call(user,`/projects/${project}`,'PATCH',{name:'越权'},404)
  await call(2,`/projects/${personal}`,'PATCH',{name:'越权个人项目'},404)
  await call(2,`/projects/${project}`,'PATCH',{name:'管理员重命名',description:'管理员编辑',tags:['验收']})
  await call(2,`/projects/${project}/feishu`,'PATCH',{feishuChatEnabled:false},404)
  await call(2,`/projects/${project}/invitations`,'POST',{username:'resource-user-3'},201)
  let memberships = await db.query('select * from project_memberships where project_id=$1',[project])
  assert.equal(Number(memberships.rows[0].owner_user_id),1)
  await call(2,`/projects/${project}/invite-link`,'POST',{},201)
  await call(2,`/projects/${project}/invite-link`,'DELETE')
  await call(2,`/projects/${project}/invitations/${memberships.rows[0].id}`,'DELETE')
  await call(2,`/organizations/1/projects/${project}/members`,'POST',{userId:3},201)
  memberships = await db.query('select * from project_memberships where project_id=$1',[project])
  await call(2,`/organizations/1/projects/${project}/members/${memberships.rows[0].id}`,'DELETE')
  await call(4,`/organizations/1/projects/${project}/members`,'POST',{userId:3},403)
  for (const user of [4,5,6,7]) await call(user,`/test-spaces/${space}`,'PATCH',{name:'越权',versionLabel:'v1'},404)
  await call(2,`/test-spaces/${space}`,'PATCH',{name:'管理员测试空间',versionLabel:'v1'})
  await call(2,`/test-spaces/${space}/members`,'POST',{username:'resource-user-6',accessLevel:'editor'},400)
  await call(2,`/test-spaces/${space}/members`,'POST',{username:'resource-user-3',accessLevel:'owner'},400)
  await Promise.all([1,2,3].map(() => call(2,`/test-spaces/${space}/members`,'POST',{username:'resource-user-3',accessLevel:'viewer'},201)))
  await call(2,`/test-spaces/${space}/members`,'POST',{username:'resource-user-3',accessLevel:'editor'},201)
  assert.equal((await db.query('select access_level from test_space_memberships where test_space_id=$1 and user_id=3',[space])).rows[0].access_level,'viewer')
  await call(2,`/test-spaces/${space}/members/3`,'PATCH',{accessLevel:'editor'})
  await call(2,`/test-spaces/${space}/members/1`,'PATCH',{accessLevel:'viewer'},404)
  await call(2,`/test-spaces/${space}/members/3`,'DELETE')
  await call(2,`/test-spaces/${space}/invitations`,'POST',{username:'resource-user-3',accessLevel:'viewer'},201)
  await call(2,`/test-spaces/${space}/members`,'POST',{username:'resource-user-3',accessLevel:'editor'},201)
  assert.equal((await db.query('select status from test_space_memberships where test_space_id=$1 and user_id=3',[space])).rows[0].status,'active')
  await call(2,`/test-spaces/${space}/invite-link`,'POST',{accessLevel:'viewer'},201)
  await call(2,`/test-spaces/${space}/invite-link`,'DELETE')
  await db.query("update organization_memberships set access_role='member' where organization_id=2 and user_id=2")
  await call(2,`/test-spaces/${space}`,'PATCH',{name:'管理员测试空间',versionLabel:'v1',organizationId:2},403)
  await db.query("update organization_memberships set access_role='admin' where organization_id=2 and user_id=2")
  await db.query("update organization_memberships set status='removed' where organization_id=2 and user_id=3")
  await call(2,`/test-spaces/${space}`,'PATCH',{name:'管理员测试空间',versionLabel:'v1',organizationId:2},409)
  await db.query("update organization_memberships set status='active' where organization_id=2 and user_id=3")
  const conflict = await createSpace('v1',2)
  await call(2,`/test-spaces/${space}`,'PATCH',{name:'管理员测试空间',versionLabel:'v1',organizationId:2},409)
  await call(2,`/test-spaces/${conflict}`,'DELETE',{confirmationName:'权限验收空间'})
  await call(2,`/test-spaces/${space}`,'PATCH',{name:'管理员测试空间',versionLabel:'v1',organizationId:2})
  await call(2,`/test-spaces/${space}`,'PATCH',{name:'管理员测试空间',versionLabel:'v1',organizationId:null})
  await call(2,`/test-spaces/${space}`,'PATCH',{name:'失权修改',versionLabel:'v1'},404)
  await call(1,`/test-spaces/${space}`,'PATCH',{name:'管理员测试空间',versionLabel:'v1',organizationId:1})
  // Environment configuration and space settings must not invert organization/resource locks.
  await Promise.all([
    call(2,'/organizations/1/test-environments','POST',{name:'并发环境',accessUrl:'https://example.com',testSpaceIds:[space]}),
    call(2,`/test-spaces/${space}`,'PATCH',{name:'管理员测试空间',versionLabel:'v1'}),
  ])
  // Simulate offboarding's organization lock. The waiting edit must not hold the
  // project advisory lock, which offboarding needs to finish its transaction.
  const blocker = await db.connect()
  try {
    await blocker.query('begin')
    await blocker.query('select id from organizations where id=1 for update')
    const edit = call(2,`/projects/${project}`,'PATCH',{name:'锁顺序验收'})
    await new Promise((resolve) => setTimeout(resolve, 150))
    const available = await blocker.query('select pg_try_advisory_xact_lock(hashtextextended($1,0)) as available',[`ai-project:${project}`])
    assert.equal(available.rows[0].available,true,'An edit waiting for the organization must not block offboarding')
    await blocker.query('commit')
    await edit
  } finally {
    await blocker.query('rollback')
    blocker.release()
  }
  // An administrator may initiate a transfer to themselves; old owner becomes a member.
  let transfer = await call<{ transferId: number }>(2,`/projects/${project}/transfer`,'POST',{organizationId:1,targetUserId:2},201)
  const receipt = (await db.query('select requested_by_user_id,previous_owner_user_id from project_transfer_requests where id=$1',[transfer.transferId])).rows[0]
  assert.equal(Number(receipt.requested_by_user_id),2)
  assert.equal(Number(receipt.previous_owner_user_id),1)
  await call(2,`/project-transfers/${transfer.transferId}/respond`,'POST',{action:'accept'})
  assert.equal(Number((await db.query('select user_id from projects where id=$1',[project])).rows[0].user_id),2)
  assert.equal(Number((await db.query('select invited_user_id from project_memberships where project_id=$1',[project])).rows[0].invited_user_id),1)
  await call(2,`/project-transfers/${transfer.transferId}/respond`,'POST',{action:'accept'},409)
  const transferProject = await createProject()
  transfer = await call<{ transferId: number }>(2,`/projects/${transferProject}/transfer`,'POST',{organizationId:1,targetUserId:3},201)
  await db.query("update organization_memberships set access_role='member' where organization_id=1 and user_id=2")
  await call(3,`/project-transfers/${transfer.transferId}/respond`,'POST',{action:'accept'},409)
  await db.query("update organization_memberships set access_role='admin' where organization_id=1 and user_id=2")
  transfer = await call<{ transferId: number }>(1,`/projects/${personal}/transfer`,'POST',{organizationId:1,targetUserId:3},201)
  await db.query('update project_transfer_requests set previous_owner_user_id=null where id=$1',[transfer.transferId])
  await call(3,`/project-transfers/${transfer.transferId}/respond`,'POST',{action:'accept'})
  transfer = await call<{ transferId: number }>(2,`/projects/${transferProject}/transfer`,'POST',{organizationId:1,targetUserId:3},201)
  await call(3,`/project-transfers/${transfer.transferId}/respond`,'POST',{action:'decline'})
  await call(2,`/projects/${transferProject}`,'DELETE')
  await call(2,`/test-spaces/${space}`,'DELETE',{confirmationName:'错误确认'},409)
  await call(2,`/test-spaces/${space}`,'DELETE',{confirmationName:'管理员测试空间'})
  assert.equal((await db.query('select active_role from sessions where user_id=2')).rows[0].active_role, 'developer')
  // Unified project edit is one transaction: invalid health must not save the name.
  const mergedProject = await createProject()
  await call(2,`/organizations/1/projects/${mergedProject}/governance`,'PATCH',{name:'不可部分保存',healthStatus:'at_risk',healthNote:''},400)
  assert.equal(decryptText((await db.query('select name from projects where id=$1',[mergedProject])).rows[0].name),'权限验收项目')
  await call(2,`/organizations/1/projects/${mergedProject}/governance`,'PATCH',{name:'合并编辑',description:'统一事务',tags:['回归'],status:'paused',healthStatus:'at_risk',healthNote:'待联调'})
  const merged = (await db.query('select * from projects where id=$1',[mergedProject])).rows[0]
  assert.equal(decryptText(merged.name),'合并编辑');assert.equal(merged.status,'paused');assert.equal(merged.health_status,'at_risk');assert.equal(decryptText(merged.health_note_encrypted),'待联调')
  await call(4,`/organizations/1/projects/${mergedProject}/governance`,'PATCH',{name:'越权',healthStatus:'on_track'},403)
  // Organization environments are shared, including spaces created concurrently or later.
  const envData = await call<{testEnvironments:Array<{id:number;name:string;testSpaceIds:number[]}>}>(2,'/organizations/1/test-environments','POST',{name:'共享环境',accessUrl:'https://shared.example.com'})
  const envId=envData.testEnvironments.find(e=>e.name==='共享环境')!.id
  await Promise.all([
    call(2,'/test-spaces','POST',{name:'新共享空间',versionLabel:'v-shared-new',organizationId:1},201),
    call(2,'/organizations/1/test-environments','POST',{name:'并发共享配置',accessUrl:'https://concurrent.example.com'}),
  ])
  let missing=await db.query(`select e.id from test_environments e join test_spaces s on s.organization_id=e.organization_id left join test_environment_spaces a on a.test_environment_id=e.id and a.test_space_id=s.id where e.organization_id=1 and a.test_space_id is null`)
  assert.equal(missing.rowCount,0)
  await call(2,`/organizations/1/test-environments/${envId}`,'PATCH',{name:'共享环境已编辑',accessUrl:'https://new.example.com',testSpaceIds:[]})
  missing=await db.query(`select e.id from test_environments e join test_spaces s on s.organization_id=e.organization_id left join test_environment_spaces a on a.test_environment_id=e.id and a.test_space_id=s.id where e.id=$1 and a.test_space_id is null`,[envId]);assert.equal(missing.rowCount,0)
  await call(4,`/organizations/1/test-environments/${envId}`,'PATCH',{name:'越权环境',accessUrl:'https://bad.example.com'},403)
  await call(2,`/organizations/2/test-environments/${envId}`,'DELETE',undefined,404)
  const sharedSpace=Number((await db.query("select id from test_spaces where version_label_lookup=$1",[blindIndex('v-shared-new')])).rows[0].id)
  await call(2,`/test-spaces/${sharedSpace}`,'PATCH',{name:'移入组织二',versionLabel:'v-shared-new',organizationId:2})
  assert.equal((await db.query('select 1 from test_environment_spaces where test_space_id=$1 and test_environment_id=$2',[sharedSpace,envId])).rowCount,0)
  await call(2,`/test-spaces/${sharedSpace}`,'PATCH',{name:'移回组织一',versionLabel:'v-shared-new',organizationId:1})
  assert.equal((await db.query('select 1 from test_environment_spaces where test_space_id=$1 and test_environment_id=$2',[sharedSpace,envId])).rowCount,1)
  // A concurrent space move cannot restore an old organization's binding.
  const mover=await db.connect(),creator=await db.connect()
  try {
    await mover.query('begin');await creator.query('begin')
    await mover.query('select id from organizations where id in (1,2) order by id for share')
    await mover.query('select id from test_spaces where id=$1 for update',[sharedSpace])
    await mover.query('update test_spaces set organization_id=2 where id=$1',[sharedSpace])
    await mover.query('delete from test_environment_spaces where test_space_id=$1',[sharedSpace])
    await creator.query('select id from organizations where id=1 for share')
    const created=await creator.query(`insert into test_spaces(owner_user_id,organization_id,name,version_label,version_label_lookup) values(1,1,$1,$2,$3) returning id`,[encryptText('并发创建空间'),encryptText('v-race-sharing'),blindIndex('v-race-sharing')])
    const newId=Number(created.rows[0].id)
    let started!:()=>void
    const initiated=new Promise<void>(resolve=>{started=resolve})
    const sync=(async()=>{started();await shareOrganizationTestEnvironments(creator,1,newId)})()
    await initiated
    await new Promise(resolve=>setTimeout(resolve,100))
    await mover.query('commit')
    await sync;await creator.query('commit')
    assert.equal((await db.query(`select 1 from test_environment_spaces a join test_spaces s on s.id=a.test_space_id join test_environments e on e.id=a.test_environment_id where s.organization_id is distinct from e.organization_id`)).rowCount,0)
  } finally {await mover.query('rollback');await creator.query('rollback');mover.release();creator.release()}
  // Existing rows receive sharing on the idempotent startup path.
  const ownershipSpace=await createSpace('v-ownership')
  await db.query(schemaSql);await db.query(schemaSql)
  assert.equal((await db.query('select 1 from test_environment_spaces where test_space_id=$1 and test_environment_id=$2',[ownershipSpace,envId])).rowCount,1)
  // Organization management transfers immediately to an eligible organization member,
  // even before that member has joined the space. The regular request flow remains separate.
  const directTransferSpace=await createSpace('v-direct-transfer')
  await call(4,`/organizations/1/test-spaces/${directTransferSpace}/transfer`,'POST',{targetUserId:3},404)
  await call(2,`/organizations/1/test-spaces/${directTransferSpace}/transfer`,'POST',{targetUserId:6},409)
  await db.query("update user_roles set role='developer' where user_id=3 and role='tester'")
  await call(2,`/organizations/1/test-spaces/${directTransferSpace}/transfer`,'POST',{targetUserId:3},409)
  await db.query("update user_roles set role='tester' where user_id=3 and role='developer'")
  await call(2,`/test-spaces/${directTransferSpace}/members`,'POST',{username:'resource-user-3',accessLevel:'viewer'},201)
  const pendingDirectReplacement=await call<{transferId:number}>(2,`/test-spaces/${directTransferSpace}/transfer`,'POST',{targetUserId:3},201)
  await call(2,`/organizations/1/test-spaces/${directTransferSpace}/transfer`,'POST',{targetUserId:4})
  assert.equal((await db.query('select status from test_space_transfer_requests where id=$1',[pendingDirectReplacement.transferId])).rows[0].status,'cancelled')
  assert.equal(Number((await db.query('select owner_user_id from test_spaces where id=$1',[directTransferSpace])).rows[0].owner_user_id),4)
  assert.equal((await db.query('select access_level from test_space_memberships where test_space_id=$1 and user_id=1',[directTransferSpace])).rows[0].access_level,'editor')
  assert.equal((await db.query('select access_level from test_space_memberships where test_space_id=$1 and user_id=4',[directTransferSpace])).rows[0].access_level,'owner')
  await call(3,`/test-space-transfers/${pendingDirectReplacement.transferId}/respond`,'POST',{action:'accept'},409)
  await call(2,`/test-spaces/${ownershipSpace}/members`,'POST',{username:'resource-user-3',accessLevel:'viewer'},201)
  await call(4,`/test-spaces/${ownershipSpace}/transfer`,'POST',{targetUserId:3},404)
  await call(2,`/test-spaces/${ownershipSpace}/transfer`,'POST',{targetUserId:7},409)
  await call(2,`/test-spaces/${ownershipSpace}/transfer`,'POST',{targetUserId:1},400)
  await db.query("update user_roles set role='developer' where user_id=3 and role='tester'")
  await call(2,`/test-spaces/${ownershipSpace}/transfer`,'POST',{targetUserId:3},409)
  await db.query("update user_roles set role='tester' where user_id=3 and role='developer'")
  let ownership=await call<{transferId:number}>(2,`/test-spaces/${ownershipSpace}/transfer`,'POST',{targetUserId:3},201)
  const targetSettings=await call<{ownershipTransfers:Array<{id:number}>}>(3,'/test-spaces/settings')
  assert.ok(targetSettings.ownershipTransfers.some(t=>t.id===ownership.transferId))
  const otherSettings=await call<{ownershipTransfers:Array<{id:number}>}>(7,'/test-spaces/settings')
  assert.ok(!otherSettings.ownershipTransfers.some(t=>t.id===ownership.transferId))
  await call(7,`/test-space-transfers/${ownership.transferId}/respond`,'POST',{action:'accept'},404)
  await db.query("update organization_memberships set access_role='member' where organization_id=1 and user_id=2")
  await call(3,`/test-space-transfers/${ownership.transferId}/respond`,'POST',{action:'accept'},409)
  await db.query("update organization_memberships set access_role='admin' where organization_id=1 and user_id=2")
  await call(2,`/test-spaces/${ownershipSpace}/members/3`,'DELETE')
  await call(3,`/test-space-transfers/${ownership.transferId}/respond`,'POST',{action:'accept'},409)
  await call(2,`/test-spaces/${ownershipSpace}/members`,'POST',{username:'resource-user-3',accessLevel:'viewer'},201)
  await call(3,`/test-space-transfers/${ownership.transferId}/respond`,'POST',{action:'decline'})
  assert.equal(Number((await db.query('select owner_user_id from test_spaces where id=$1',[ownershipSpace])).rows[0].owner_user_id),1)
  ownership=await call<{transferId:number}>(2,`/test-spaces/${ownershipSpace}/transfer`,'POST',{targetUserId:3},201)
  await db.query("update test_space_transfer_requests set expires_at=now()-interval '1 second' where id=$1",[ownership.transferId])
  await call(3,`/test-space-transfers/${ownership.transferId}/respond`,'POST',{action:'accept'},409)
  ownership=await call<{transferId:number}>(2,`/test-spaces/${ownershipSpace}/transfer`,'POST',{targetUserId:3},201)
  await call(3,`/test-space-transfers/${ownership.transferId}/respond`,'POST',{action:'accept'})
  await call(3,`/test-space-transfers/${ownership.transferId}/respond`,'POST',{action:'accept'},409)
  assert.equal(Number((await db.query('select owner_user_id from test_spaces where id=$1',[ownershipSpace])).rows[0].owner_user_id),3)
  assert.equal((await db.query('select access_level from test_space_memberships where test_space_id=$1 and user_id=1',[ownershipSpace])).rows[0].access_level,'editor')
  assert.equal((await db.query('select access_level from test_space_memberships where test_space_id=$1 and user_id=3',[ownershipSpace])).rows[0].access_level,'owner')
  await call(2,`/organizations/1/test-environments/${envId}`,'DELETE')
  assert.equal((await db.query('select 1 from test_environment_spaces where test_environment_id=$1',[envId])).rowCount,0)
  // Leave demonstrable records only when the operator explicitly requests browser QA.
  if (process.env.VEGES_KEEP_TEST_RUNTIME === 'true') {
    const demoProject = await createProject()
    const demoSpace = await createSpace('v-ui')
    fs.writeFileSync('.context/resource-integration-state.json', JSON.stringify({schema, port, pid:api.pid, databaseUrl:databaseUrl.toString(), token:tokens.get(2), recipientToken:tokens.get(3), project:demoProject, space:demoSpace}), {mode:0o600})
    api.unref()
    keep = true
  }
  console.log(`Resource management integration passed: ${passed} HTTP assertions, idempotent schema, concurrent direct admission, and canonical ownership checks.`)
} finally {
  if (!keep) {
    if (api && api.exitCode === null) { api.kill('SIGTERM'); await once(api,'exit') }
    await control.query(`drop schema if exists ${schema} cascade`)
  }
  await db.end()
  await control.end()
}
