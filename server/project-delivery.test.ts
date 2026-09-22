import assert from 'node:assert/strict'
import test from 'node:test'
import { deliveryCapabilities, mergeDeliveryMemberDraft, parseDeliveryMembers } from '../shared/project-delivery.ts'

const reader = { canPlan: false, canExecute: false, personal: false }
const planner = { ...reader, canPlan: true }
const executor = { ...reader, canExecute: true }
const draft = { published: false, delivered: false, assigneeUserId: 2 }
const active = { ...draft, published: true }

test('unconfigured developers, owners and administrators receive no delivery writes', () => {
  for (const event of [draft, active, { ...active, delivered: true }]) {
    assert.ok(Object.values(deliveryCapabilities(reader, event, 2)).every(value => value === false))
  }
})

test('planning and execution are independent project capabilities', () => {
  assert.equal(deliveryCapabilities(planner, draft, 1).canPublish, true)
  assert.equal(deliveryCapabilities(planner, active, 1).canReassign, true)
  assert.equal(deliveryCapabilities(planner, active, 1).canComplete, false)
  assert.equal(deliveryCapabilities(planner, active, 1).canExecute, false)
  assert.equal(deliveryCapabilities(executor, draft, 2).canPublish, false)
  assert.equal(deliveryCapabilities(executor, active, 2).canExecute, true)
  assert.equal(deliveryCapabilities(executor, active, 2).canComplete, true)
  assert.equal(deliveryCapabilities(executor, active, 2).canReassign, false)
})

test('project executor roster alone does not authorize another person’s task', () => {
  assert.ok(Object.values(deliveryCapabilities(executor, active, 3)).every(value => value === false))
  assert.equal(deliveryCapabilities(executor, { ...active, assigneeUserId: 3 }, 2).canComplete, false)
  assert.equal(deliveryCapabilities(executor, { ...active, assigneeUserId: 3 }, 3).canComplete, true)
})

test('dual duty permits the whole workflow only for the assigned executor', () => {
  const dual = { ...planner, canExecute: true }
  assert.equal(deliveryCapabilities(dual, draft, 1).canPublish, true)
  assert.equal(deliveryCapabilities(dual, active, 1).canComplete, false)
  assert.equal(deliveryCapabilities(dual, active, 2).canComplete, true)
})

test('publication freezes plans and completion freezes execution but retains feedback', () => {
  const dual = { ...planner, canExecute: true }
  for (const event of [active, { ...active, delivered: true }]) {
    const capabilities = deliveryCapabilities(dual, event, 2)
    assert.equal(capabilities.canEditPlan, false)
    assert.equal(capabilities.canPublish, false)
  }
  const completed = deliveryCapabilities(dual, { ...active, delivered: true }, 2)
  assert.equal(completed.canComplete, false)
  assert.equal(completed.canReassign, false)
  assert.equal(completed.canExecute, false)
  assert.equal(completed.canComment, true)
})

test('unassigned drafts can be planned and published tasks without an assignee cannot execute', () => {
  assert.equal(deliveryCapabilities(planner, { ...draft, assigneeUserId: null }, 1).canEditPlan, true)
  assert.equal(deliveryCapabilities(executor, { ...active, assigneeUserId: null }, 2).canExecute, false)
})

test('personal project direct membership keeps existing planning and completion permissions', () => {
  const personal = { personal: true, canPlan: true, canExecute: true }
  assert.equal(deliveryCapabilities(personal, draft, 1).canPublish, true)
  assert.equal(deliveryCapabilities(personal, active, 1).canComplete, true)
})

test('roster supports multiple people and dual duties with strict complete-input validation', () => {
  const rows = [{ userId: 3, canPlan: true, canExecute: true }, { userId: 1, canPlan: true, canExecute: false }, { userId: 2, canPlan: false, canExecute: true }]
  assert.deepEqual(parseDeliveryMembers(rows)?.map(member => member.userId), [1, 2, 3])
  assert.deepEqual(parseDeliveryMembers([]), [])
  for (const invalid of [null, {}, [null], [rows[0], rows[0]], [{ ...rows[0], userId: '3' }], [{ ...rows[0], userId: -1 }], [{ ...rows[0], userId: 1.2 }], [{ ...rows[0], canExecute: 'false' }], [{ ...rows[0], canPlan: false, canExecute: false }], Array(1001).fill(rows[0])]) {
    assert.equal(parseDeliveryMembers(invalid), null)
  }
})

test('configuration conflict recovery preserves local edits and unrelated concurrent additions', () => {
  const a = { userId: 1, name: '张三', canPlan: true, canExecute: false }
  const b = { userId: 2, name: '李四', canPlan: false, canExecute: true }
  const c = { userId: 3, name: '王五', canPlan: true, canExecute: true }
  assert.deepEqual(mergeDeliveryMemberDraft([a, b], [{ ...a, canExecute: true }], [a, b, c]), [{ ...a, canExecute: true }, c])
  assert.deepEqual(mergeDeliveryMemberDraft([a], [a], [{ ...a, canExecute: true }, c]), [{ ...a, canExecute: true }, c])
})
