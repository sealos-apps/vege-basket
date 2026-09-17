import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseMyWorkFilters, workBucket, workItemKey } from './my-work-policy.ts'

const myWorkSource = readFileSync(new URL('./my-work.ts', import.meta.url), 'utf8')
const myWorkWorkbenchSource = readFileSync(new URL('../src/components/my-work-workbench.tsx', import.meta.url), 'utf8')
const myWorkWorkbenchCss = readFileSync(new URL('../src/components/my-work-workbench.css', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8')
const serverSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

test('parses bounded my work filters', () => {
  assert.deepEqual(parseMyWorkFilters({ kind: 'bug', limit: '999', cursor: '-1' }), {
    kind: 'bug',
    limit: 50,
    status: 'open',
    sort: 'due_desc',
    cursor: undefined,
    projectId: undefined,
    creator: undefined,
    q: undefined,
  })
})

test('accepts concrete work statuses and falls back for unknown values', () => {
  assert.equal(parseMyWorkFilters({ status: 'confirmed' }).status, 'confirmed')
  assert.equal(parseMyWorkFilters({ status: 'acceptance_failed' }).status, 'acceptance_failed')
  assert.equal(parseMyWorkFilters({ creator: '  邱天丰  ' }).creator, '邱天丰')
  assert.equal(parseMyWorkFilters({ status: 'todo:confirmed' }).status, 'todo:confirmed')
  assert.equal(parseMyWorkFilters({ status: 'pending_verification' }).status, 'pending_verification')
  assert.equal(parseMyWorkFilters({ status: 'unknown:confirmed' }).status, 'open')
  assert.equal(parseMyWorkFilters({ status: 'not-a-status' }).status, 'open')
})

test('defaults my work sorting to descending due dates', () => {
  assert.equal(parseMyWorkFilters({}).sort, 'due_desc')
  assert.equal(parseMyWorkFilters({ sort: 'due_asc' }).sort, 'due_asc')
  assert.equal(parseMyWorkFilters({ sort: 'updated' }).sort, 'due_desc')
})

test('classifies due date buckets', () => {
  assert.equal(workBucket('2026-07-28', '2026-07-29', '2026-08-02'), 'overdue')
  assert.equal(workBucket('2026-07-29', '2026-07-29', '2026-08-02'), 'today')
  assert.equal(workBucket('2026-08-02', '2026-07-29', '2026-08-02'), 'this_week')
  assert.equal(workBucket('2026-08-03', '2026-08-02', '2026-08-02'), 'later')
  assert.equal(workBucket(undefined, '2026-07-29', '2026-08-02'), 'unscheduled')
})

test('builds stable work item keys', () => {
  assert.equal(workItemKey('todo', 42), 'todo:42')
})

test('moves submitted todos from the assignee list to the effective reviewer', () => {
  assert.match(myWorkSource, /t\.assignee_user_id = \$1\s+and t\.confirmation_status <> 'pending_review'/u)
  assert.match(myWorkSource, /t\.reviewer_user_id = \$1/u)
  assert.match(myWorkSource, /when t\.reviewer_user_id = \$1 then 'reviewer'/u)
  assert.doesNotMatch(myWorkSource, /coalesce\(t\.reviewer_user_id, t\.created_by_user_id, p\.user_id\) = \$1/u)
})

test('does not treat a todo creator or project owner as responsible without an explicit assignment', () => {
  assert.match(myWorkSource, /t\.assignee_user_id = \$1\s+and t\.confirmation_status <> 'pending_review'/u)
  assert.match(myWorkSource, /or t\.reviewer_user_id = \$1/u)
  assert.doesNotMatch(myWorkSource, /coalesce\(t\.created_by_user_id, p\.user_id\) = \$1/u)
})

test('renders failed acceptance status in Chinese', () => {
  assert.match(myWorkWorkbenchSource, /acceptance_failed: '验收未通过'/u)
})

test('renders Bug confirmation status in Chinese', () => {
  assert.match(myWorkWorkbenchSource, /pending_confirmation: '待确认'/u)
})

test('renders My Work grid rows with valid table descendants', () => {
  assert.match(myWorkWorkbenchSource, /className="my-work-table-header-group" role="rowgroup"/u)
  assert.match(myWorkWorkbenchSource, /className="my-work-table-body" role="rowgroup"/u)
  assert.match(myWorkWorkbenchSource, /role="columnheader"/u)
  assert.match(myWorkWorkbenchSource, /className="my-work-table-cell my-work-main-cell" role="cell">\s*<button/u)
  assert.doesNotMatch(myWorkWorkbenchSource, /role="row">\s*<button/u)
})

test('renders My Work secondary text with the readable workbench token', () => {
  assert.match(myWorkWorkbenchCss, /--my-work-muted-readable:\s*var\(--muted-text\)/u)
  assert.match(myWorkWorkbenchCss, /--my-work-positive-readable:/u)
  assert.doesNotMatch(myWorkWorkbenchCss, /color:\s*var\(--muted-foreground\)/u)
})

test('marks todos transferred through offboarding', () => {
  assert.match(myWorkSource, /account_offboarding_asset_transfers/u)
  assert.match(myWorkSource, /offboarding_transferred_from_name/u)
  assert.match(myWorkSource, /previous_assignee_user_id/u)
  assert.match(myWorkSource, /transfer.next_assignee_user_id = \$1::bigint/u)
  assert.match(myWorkWorkbenchSource, /item\.offboardingTransferredFromName/u)
  assert.match(myWorkWorkbenchSource, /-离职转移/u)
  assert.match(myWorkWorkbenchSource, /离职转移/u)
})

test('scopes my work to the requested organization context', () => {
  assert.match(myWorkSource, /p\.organization_id/u)
  assert.match(myWorkSource, /space\.organization_id/u)
  assert.match(myWorkSource, /work\.organization_id is not distinct from \$6::bigint/u)
  assert.match(myWorkSource, /organizationId,/u)
  assert.match(apiSource, /fetchMyWork\(organizationId: OrganizationContext/u)
  assert.match(apiSource, /params\.set\('organizationId', serializeOrganizationContext\(organizationId\)\)/u)
  assert.match(serverSource, /app\.get\('\/api\/my-work'/u)
  assert.match(serverSource, /parseOrganizationContext\(request\.query\.organizationId\)/u)
})
