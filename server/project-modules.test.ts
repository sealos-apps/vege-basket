import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Pool, PoolClient } from 'pg'
import { canManageOrganizationProjectModules, projectModuleAvailability } from '../shared/project-modules.ts'
import { decryptText, encryptText, isEncryptedText } from './crypto.ts'
import {
  backfillProjectModuleNames, createOrganizationProjectModule, initializeProjectModules,
  deleteOrganizationProjectModule,
  normalizeOrganizationModuleUpdate, parseProjectModuleId, projectModuleNameLookup,
  requirePersonalProjectModuleManagement, requireProjectModuleName, resolveProjectModuleId,
  updateOrganizationProjectModule,
} from './project-modules.ts'

process.env.APP_ENCRYPTION_ACTIVE_KEY_ID = 'new'
process.env.APP_ENCRYPTION_KEYS = `old:${Buffer.alloc(32, 13).toString('base64')},new:${Buffer.alloc(32, 17).toString('base64')}`

type Call = { sql: string; values: unknown[] }
function fakeClient(answer: (call: Call) => object[] = () => []) {
  const calls: Call[] = []
  let released = false
  const client = {
    query: async (sql: string, values: unknown[] = []) => {
      const call = { sql, values }
      calls.push(call)
      return { rows: answer(call) }
    },
    release: () => { released = true },
  } as unknown as PoolClient
  return { client, calls, released: () => released }
}
const writes = (calls: Call[]) => calls.filter(call => /^\s*(insert|update|delete) /u.test(call.sql))

test('module names are trimmed, bounded and case-sensitive across encryption-key rotation', () => {
  assert.equal(requireProjectModuleName('  支付  '), '支付')
  assert.equal(requireProjectModuleName('项'.repeat(40)).length, 40)
  for (const value of ['', '  ', '项'.repeat(41), null, 5]) assert.throws(() => requireProjectModuleName(value), { status: 400 })
  const old = projectModuleNameLookup('API', 'old')
  assert.equal(old, projectModuleNameLookup('API', 'old'))
  assert.notEqual(old, projectModuleNameLookup('api', 'old'))
  assert.doesNotMatch(old, /API/)
  assert.equal(decryptText(encryptText('API')), 'API')
})

test('module management requires both organization authority and occupational role', () => {
  for (const role of ['owner', 'admin']) assert.equal(canManageOrganizationProjectModules(role, ['organization_admin']), true)
  for (const role of ['member', null, 'viewer']) assert.equal(canManageOrganizationProjectModules(role, ['organization_admin']), false)
  assert.equal(canManageOrganizationProjectModules('owner', ['developer']), false)
})

test('module ids and update payloads reject ambiguous or unsupported values', () => {
  for (const value of [true, [], {}, -1, 0, 1.1, 'NaN', Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => parseProjectModuleId(value), { status: 400 })
  assert.equal(parseProjectModuleId(null), null)
  assert.equal(parseProjectModuleId('12'), 12)
  assert.deepEqual(normalizeOrganizationModuleUpdate({ enabled: false }), { name: undefined, enabled: false })
  for (const value of [{}, [], { enabled: 'false' }, { name: 'a', organizationId: 2 }]) assert.throws(() => normalizeOrganizationModuleUpdate(value), { status: 400 })
})

test('personal, enabled, disabled and unmatched organization modules have distinct availability', () => {
  assert.deepEqual(projectModuleAvailability(null, null, false), { selectable: true })
  assert.deepEqual(projectModuleAvailability(1, 1, true), { selectable: true })
  assert.deepEqual(projectModuleAvailability(1, 1, false), { selectable: false, unavailableReason: 'disabled' })
  assert.deepEqual(projectModuleAvailability(1, 2, true), { selectable: false, unavailableReason: 'legacy' })
  assert.deepEqual(projectModuleAvailability(1, null, true), { selectable: false, unavailableReason: 'legacy' })
})

function moduleClient(organizationId: string | null, catalog: { organization_id: string; enabled: boolean } | null) {
  return fakeClient(({ sql, values }) => {
    if (sql.includes('from project_modules pm')) {
      assert.deepEqual(values, [11, 3])
      return [{ organization_id: organizationId, organization_module_id: catalog ? '21' : null }]
    }
    if (sql.includes('from organization_project_modules')) return catalog ? [catalog] : []
    return []
  })
}

test('new selections reject disabled, legacy and cross-organization modules, while unchanged history survives', async () => {
  for (const catalog of [null, { organization_id: '1', enabled: false }, { organization_id: '2', enabled: true }]) {
    const { client } = moduleClient('1', catalog)
    await assert.rejects(resolveProjectModuleId(client, 3, 11), { code: 'PROJECT_MODULE_UNAVAILABLE', status: 409 })
    assert.equal(await resolveProjectModuleId(client, 3, 11, 11), 11)
    await assert.rejects(resolveProjectModuleId(client, 3, 11, 12), { status: 409 })
    assert.equal(await resolveProjectModuleId(client, 3, null, 11), null)
  }
})

test('selection scopes the module to its project and locks current catalog state', async () => {
  const { client, calls } = moduleClient('1', { organization_id: '1', enabled: true })
  assert.equal(await resolveProjectModuleId(client, 3, 11), 11)
  assert.ok(calls.every(call => call.sql.includes('for share')))
  await assert.rejects(resolveProjectModuleId(fakeClient().client, 9, 11, 11), { status: 400 })
  assert.equal(await resolveProjectModuleId(moduleClient(null, null).client, 3, 11), 11)
})

test('legacy management routes reject organization projects even for their owner', async () => {
  await assert.rejects(requirePersonalProjectModuleManagement(fakeClient(() => [{ user_id: '4', organization_id: '1' }]).client, 3, 4), { code: 'PROJECT_MODULES_MANAGED_BY_ORGANIZATION' })
  await assert.rejects(requirePersonalProjectModuleManagement(fakeClient(() => [{ user_id: '4', organization_id: null }]).client, 3, 5), { status: 403 })
  await requirePersonalProjectModuleManagement(fakeClient(() => [{ user_id: '4', organization_id: null }]).client, 3, 4)
})

test('catalog creation encrypts normalized names and rejects duplicate inserts before synchronization', async () => {
  const { client, calls } = fakeClient(({ sql }) => sql.includes('select lookup_key_id') ? [{ lookup_key_id: 'old' }] : [])
  await assert.rejects(createOrganizationProjectModule(client, 1, ' 支付 '), { code: 'PROJECT_MODULE_NAME_CONFLICT' })
  assert.equal(writes(calls).length, 1)
  assert.equal(decryptText(writes(calls)[0].values[1] as string), '支付')
  assert.equal(writes(calls)[0].values[2], projectModuleNameLookup('支付', 'old'))
})

test('rename collisions leave catalog, snapshots and history untouched', async () => {
  const { client, calls } = fakeClient(({ sql }) => {
    if (sql.includes('select name, name_lookup')) return [{ name: encryptText('原名称'), name_lookup: projectModuleNameLookup('原名称', 'old'), enabled: true }]
    if (sql.includes('select lookup_key_id')) return [{ lookup_key_id: 'old' }]
    if (sql.includes('union all')) return [{ conflict: 1 }]
    return []
  })
  await assert.rejects(updateOrganizationProjectModule(client, 1, 2, normalizeOrganizationModuleUpdate({ name: '历史名称' })), { code: 'PROJECT_MODULE_NAME_CONFLICT' })
  assert.deepEqual(writes(calls), [])
})

test('disable changes only catalog state and never deletes historical mappings', async () => {
  const { client, calls } = fakeClient(() => [{ name: encryptText('支付'), name_lookup: 'lookup', enabled: true }])
  await updateOrganizationProjectModule(client, 1, 2, normalizeOrganizationModuleUpdate({ enabled: false }))
  assert.equal(writes(calls).length, 1)
  assert.equal(writes(calls)[0].values[2], false)
  assert.deepEqual(writes(calls)[0].values.slice(3), [2, 1])
})

test('disable rechecks current task usage and rejects modules still referenced', async () => {
  const { client, calls } = fakeClient(({ sql }) => {
    if (sql.includes('select name, name_lookup')) return [{ name: encryptText('支付'), name_lookup: 'lookup', enabled: true }]
    if (sql.includes('count(t.id)')) return [{ usage_count: 2 }]
    return []
  })
  await assert.rejects(updateOrganizationProjectModule(client, 1, 2, normalizeOrganizationModuleUpdate({ enabled: false })), {
    code: 'PROJECT_MODULE_IN_USE', status: 409,
  })
  assert.equal(writes(calls).length, 0)
})

test('disabled modules can be deleted while preserving local history mappings', async () => {
  const { client, calls } = fakeClient(({ sql }) => {
    if (sql.includes('select enabled')) return [{ enabled: false }]
    return []
  })
  await deleteOrganizationProjectModule(client, 1, 2)
  assert.match(calls[1].sql, /update project_modules pm set organization_module_id = null/u)
  assert.match(calls[2].sql, /delete from organization_project_modules/u)
})

test('enabled modules cannot be deleted', async () => {
  await assert.rejects(deleteOrganizationProjectModule(fakeClient(({ sql }) => sql.includes('select enabled') ? [{ enabled: true }] : []).client, 1, 2), {
    code: 'PROJECT_MODULE_ENABLED', status: 409,
  })
})

test('legacy normalization preserves the first id and rebinds both todo and proposal references before merging', async () => {
  const { client, calls } = fakeClient(({ sql }) => {
    if (sql.includes('select lookup_key_id')) return [{ lookup_key_id: 'old' }]
    if (sql.includes('select id, project_id')) return [
      { id: '11', project_id: '3', name: '支付', name_lookup: null },
      { id: '12', project_id: '3', name: ' 支付 ', name_lookup: null },
      { id: '13', project_id: '4', name: '支付', name_lookup: null },
    ]
    return []
  })
  await backfillProjectModuleNames(client)
  const mutations = writes(calls)
  assert.ok(isEncryptedText(mutations[0].values[0] as string))
  assert.equal(mutations[0].values[2], '11')
  assert.match(mutations[1].sql, /update todos/)
  assert.match(mutations[2].sql, /update ai_todo_proposals/)
  assert.match(mutations[3].sql, /delete from project_modules/)
  assert.deepEqual(mutations[1].values, ['11', '12'])
  assert.equal(mutations[4].values[2], '13')
})

test('completed initialization never reimports later unmatched personal modules', async () => {
  const { client, calls, released } = fakeClient(({ sql }) => sql.includes('select initialized_at') ? [{ initialized_at: new Date(), lookup_key_id: 'old' }] : [])
  await initializeProjectModules({ connect: async () => client } as unknown as Pick<Pool, 'connect'>)
  assert.equal(writes(calls).length, 1)
  assert.equal(calls.at(-1)?.sql, 'commit')
  assert.equal(released(), true)
})

test('failed initial name backfill rolls back its receipt and releases the client', async () => {
  const { client, calls, released } = fakeClient(({ sql }) => {
    if (sql.includes('select initialized_at')) return [{ initialized_at: null, lookup_key_id: 'old' }]
    if (sql.includes('select lookup_key_id')) return [{ lookup_key_id: 'old' }]
    if (sql.includes('select id, project_id')) return [{ id: '1', project_id: '2', name: ' ', name_lookup: null }]
    return []
  })
  await assert.rejects(initializeProjectModules({ connect: async () => client } as unknown as Pick<Pool, 'connect'>), { status: 400 })
  assert.equal(calls.at(-1)?.sql, 'rollback')
  assert.equal(calls.some(call => call.sql.includes('initialized_at = now()')), false)
  assert.equal(released(), true)
})

test('AI confirmation retains history through parsing and checks availability under the project lock', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
  assert.match(source, /purpose === 'confirmation' \|\| module.selectable/u)
  assert.match(source, /contextProjectId \?\? undefined,\s*'confirmation'/u)
  const start = source.indexOf('async function lockAiTodoProposalTarget(')
  const end = source.indexOf('\nasync function ', start + 1)
  assert.match(source.slice(start, end), /await resolveProjectModuleId\(client, projectId, proposal.moduleId\)/u)
})

test('catalog writes and deletion take project locks before manager row locks, without blocking audit foreign keys', () => {
  const moduleSource = readFileSync(new URL('./project-modules.ts', import.meta.url), 'utf8')
  const catalogStart = moduleSource.indexOf('export async function lockOrganizationModuleCatalog(')
  const catalogEnd = moduleSource.indexOf('\nexport async function ', catalogStart + 1)
  assert.match(moduleSource.slice(catalogStart, catalogEnd), /from organizations where id = \$1 for key share/u)
  const source = readFileSync(new URL('./organizations.ts', import.meta.url), 'utf8')
  for (const anchor of ['async function mutateOrganizationProjectModule(', "router.delete('/organizations/:organizationId',"]) {
    const start = source.indexOf(anchor)
    assert.ok(start >= 0)
    const catalogLock = source.indexOf('await lockOrganizationModuleCatalog(', start)
    const projectLocks = source.indexOf('await lockOrganizationModuleProjects(', catalogLock)
    const managerLock = source.indexOf('await lockManagedOrganization(', catalogLock)
    assert.ok(catalogLock < projectLocks && projectLocks < managerLock)
  }
})
