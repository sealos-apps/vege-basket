import assert from 'node:assert/strict'
import test from 'node:test'
import { parseProjectSubprojectId, requireProjectSubprojectName, requireProjectSubprojectManager, resolveProjectSubprojectId } from './project-subprojects.ts'
import type { PoolClient } from 'pg'
import { readFileSync } from 'node:fs'

const panelSource = readFileSync(new URL('../src/components/project-subprojects-panel.tsx', import.meta.url), 'utf8')

test('subproject identifiers reject coercible objects, booleans and noncanonical strings', () => {
  for (const value of [true, false, [], [1], {}, 0, -1, 1.5, Infinity, NaN,
    '01', '1e2', '0x10', ' 1 ', '1.0', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseProjectSubprojectId(value), { status: 400 })
  }
  assert.equal(parseProjectSubprojectId(42), 42)
  assert.equal(parseProjectSubprojectId('42'), 42)
  for (const value of [null, undefined, '']) assert.equal(parseProjectSubprojectId(value), null)
})

test('subproject names trim whitespace and bound Unicode characters', () => {
  assert.equal(requireProjectSubprojectName('  客户 B  '), '客户 B')
  assert.equal(requireProjectSubprojectName('𠮷'.repeat(40)), '𠮷'.repeat(40))
  for (const value of ['', '   ', null, 42, '𠮷'.repeat(41)]) {
    assert.throws(() => requireProjectSubprojectName(value), { status: 400 })
  }
})

test('subproject governance allows owners and rejects missing administrator qualifications', async () => {
  const statements: string[] = []
  const client = { query: async (sql: string) => {
    statements.push(sql)
    return { rows: statements.length === 1 ? [{ user_id: '7', organization_id: '3' }] : [] }
  } } as unknown as PoolClient
  await requireProjectSubprojectManager(client, 1, 7)
  assert.equal(statements.length, 1)
  assert.match(statements[0], /for update/)
  statements.length = 0
  await assert.rejects(requireProjectSubprojectManager(client, 1, 8), { status: 403 })
  assert.match(statements[1], /access_role in \('owner', 'admin'\)/)
  assert.match(statements[1], /role.role = 'organization_admin'/)
  assert.match(statements[1], /for share of membership, role/)
})

test('task binding rejects subprojects outside the requested project', async () => {
  const client = { query: async (_sql: string, values: unknown[]) => {
    assert.deepEqual(values, [8, 2])
    return { rows: [] }
  } } as unknown as PoolClient
  await assert.rejects(resolveProjectSubprojectId(client, 2, 8), { status: 400 })
  assert.equal(await resolveProjectSubprojectId(client, 2, null), null)
})

test('subproject deletion uses the shared confirmation dialog', () => {
  assert.match(panelSource, /ConfirmActionDialog/u)
  assert.match(panelSource, /project-subproject-delete:/u)
  assert.doesNotMatch(panelSource, /window\.confirm/u)
})

test('subproject dialog hides only its header and keeps item rows visible', () => {
  const panelStyles = readFileSync(new URL('../src/components/project-subprojects-panel.css', import.meta.url), 'utf8')
  assert.match(panelSource, /project-subprojects-header organization-project-detail-heading/u)
  assert.match(panelSource, /project-subproject-row organization-project-detail-heading/u)
  assert.match(panelStyles, /\.project-subprojects-dialog \.project-subprojects-panel > \.project-subprojects-header\s*\{\s*display:\s*none;/u)
  assert.doesNotMatch(panelStyles, /\.project-subprojects-dialog \.project-subprojects-panel > \.organization-project-detail-heading\s*\{/u)
})
