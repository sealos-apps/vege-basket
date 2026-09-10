import assert from 'node:assert/strict'
import test from 'node:test'
import type { PoolClient } from 'pg'
import { lockResourceManager } from './resource-management.ts'
import { canCompleteProjectTransfer } from './project-transfer.ts'

function resourceClient(ownerUserId: number, organizationId: number | null, authorized = false) {
  const statements: string[] = []
  const client = { query: async (sql: string) => {
    statements.push(sql)
    if (sql.includes('from projects') || sql.includes('from test_spaces')) {
      return { rows: [{ owner_user_id: String(ownerUserId), organization_id: organizationId === null ? null : String(organizationId) }] }
    }
    return { rows: sql.includes('from organization_memberships') && authorized ? [{ user_id: '2' }] : [] }
  } } as unknown as Pick<PoolClient, 'query'>
  return { client, statements }
}

test('resource administration preserves the real owner and rejects an unscoped administrator', async () => {
  const personal = resourceClient(1, null, true)
  assert.equal(await lockResourceManager(personal.client, 'project', 10, 2), null)
  const managed = resourceClient(1, 3, true)
  assert.deepEqual(await lockResourceManager(managed.client, 'project', 10, 2), { ownerUserId: 1, organizationId: 3 })
  const organizationLock = managed.statements.findIndex((sql) => sql.includes('from organizations'))
  const projectLock = managed.statements.findIndex((sql) => sql.includes('pg_advisory_xact_lock'))
  assert.ok(organizationLock >= 0 && projectLock > organizationLock)
  assert.match(managed.statements.at(-1)!, /for share of membership, role/u)
  assert.match(managed.statements.at(-1)!, /access_role in \('owner', 'admin'\)/u)
  assert.equal(await lockResourceManager(resourceClient(1, 3).client, 'test-space', 10, 2), null)
  assert.deepEqual(await lockResourceManager(personal.client, 'test-space', 10, 1), { ownerUserId: 1, organizationId: null })
})

test('a pending administrator transfer cannot survive lost authority, changed ownership or changed organization', async () => {
  const transfer = { projectId: 10, organizationId: 3, requestedByUserId: 2, previousOwnerUserId: 1 }
  assert.equal(await canCompleteProjectTransfer(resourceClient(1, 3, true).client, transfer), true)
  assert.equal(await canCompleteProjectTransfer(resourceClient(1, 3, false).client, transfer), false)
  assert.equal(await canCompleteProjectTransfer(resourceClient(4, 3, true).client, transfer), false)
  assert.equal(await canCompleteProjectTransfer(resourceClient(1, 4, true).client, transfer), false)
  assert.equal(await canCompleteProjectTransfer(resourceClient(1, null, true).client, transfer), false)
  assert.equal(await canCompleteProjectTransfer(resourceClient(1, null).client, { ...transfer, requestedByUserId: 1 }), true)
})
