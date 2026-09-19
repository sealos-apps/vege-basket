import assert from 'node:assert/strict'
import test from 'node:test'
import { PrototypeStore } from '../src/prototypes/test-plan/mock-api'
import { reportSnapshot, type PrototypeExecution } from '../src/prototypes/test-plan/workbench-data'
import { validateExecutionImages, type ExecutionImage } from '../src/prototypes/test-plan/data'

const request = (store: PrototypeStore, path: string, method: string, payload?: unknown) =>
  store.handle(new URL(path, 'http://prototype.local'), method, payload ? JSON.stringify(payload) : '')
const execution = (id: string, result: PrototypeExecution['result']): PrototypeExecution => ({
  id, result, actual: '本次实际结果', note: '', actor: '林晓', time: '2026-09-17T04:00:00Z',
})

test('latest save wins; retry and reset preserve previous history and other plans', () => {
  const store = new PrototypeStore()
  const count = store.histories[24101].length
  store.appendExecution(24101, execution('first', 'failed'))
  store.appendExecution(24101, execution('second', 'passed'))
  store.appendExecution(24101, execution('first', 'failed'))
  assert.equal(store.data.planCases.find(row => row.id === 24101)?.result, 'passed')
  assert.equal(store.histories[24101].length, count + 2)
  store.appendExecution(24101, execution('reset', 'untested'))
  assert.equal(store.data.planCases.find(row => row.id === 24101)?.result, 'untested')
  assert.equal(store.histories[24101].length, count + 3)
  assert.equal(store.histories[23101].length, 1)
})

test('report captures all plan snapshots, legacy notes and canonical case identifiers', () => {
  const store = new PrototypeStore()
  const legacy = store.data.planCases.find(row => row.result !== 'untested' && !store.histories[row.id]?.length)!
  legacy.resultNote = '历史备注必须保留'
  const report = reportSnapshot(store.data, store.histories, 24)
  assert.equal(report.cases.length, 8)
  assert.equal(report.cases.find(row => row.id === legacy.id)?.legacyNote, '历史备注必须保留')
  assert.equal(report.cases[0].caseCode, 'CASE-101')
  const original = structuredClone(report)
  store.appendExecution(24101, execution('later', 'failed'))
  store.data.cases[0].title = '用例库新版本'
  store.data.plans[0].name = '计划已更名'
  assert.deepEqual(report, original)
  assert.notEqual(report.cases[0].title, store.data.cases[0].title)
})

test('plan create, edit and append keep existing snapshots and history', async () => {
  const store = new PrototypeStore()
  const payload = { name: '新增计划', testSubjectIds: [1], caseIds: [101], testEnvironmentId: 1 }
  assert.equal((await request(store, '/api/test-spaces/1/plans', 'POST', payload)).status, 200)
  const plan = store.data.plans.find(row => row.name === payload.name)!
  const first = store.data.planCases.find(row => row.testPlanId === plan.id)!
  store.data.cases[0].title = '源用例已变更'
  store.appendExecution(first.id, execution('record', 'passed'))
  assert.equal(plan.status, 'in_progress')
  assert.equal((await request(store, `/api/test-spaces/1/plans/${plan.id}/details`, 'PATCH', { ...payload, name: '编辑计划', caseIds: [101, 102] })).status, 200)
  assert.equal(store.data.planCases.filter(row => row.testPlanId === plan.id).length, 2)
  assert.notEqual(first.snapshotTitle, store.data.cases[0].title)
  assert.equal(store.histories[first.id].length, 1)
  assert.equal((await request(store, `/api/test-spaces/1/plans/${plan.id}/cases/${first.id}`, 'DELETE')).status, 400)
  assert.equal((await request(store, `/api/test-spaces/1/plans/${plan.id}`, 'DELETE')).status, 200)
  assert.equal(store.histories[first.id], undefined)
})

test('quick result changes append history and completed plans remain executable', async () => {
  const store = new PrototypeStore()
  assert.equal((await request(store, '/api/test-spaces/1/plan-cases/23101', 'PATCH', { result: 'failed' })).status, 200)
  assert.equal(store.histories[23101].length, 2)
  assert.equal(store.data.plans.find(plan => plan.id === 23)?.status, 'completed')
  assert.equal((await request(store, '/api/test-spaces/1/plan-cases/23101', 'PATCH', { result: 'invalid' })).status, 400)
  assert.equal(store.histories[23101].length, 2)
})

test('unsupported Bug subroutes fail without mutating the Bug', async () => {
  const store = new PrototypeStore()
  await request(store, '/api/test-spaces/1/bugs', 'POST', { title: '失败用例', testCaseId: 102, actualResult: '实际失败' })
  const bug = structuredClone(store.data.bugs[0])
  assert.equal((await request(store, `/api/test-spaces/1/bugs/${bug.id}/transfer-space`, 'POST', { targetSpaceId: 2, targetTestCaseId: 101 })).status, 501)
  assert.deepEqual(store.data.bugs[0], bug)
})

test('execution images survive append and immutable report snapshots', () => {
  const store = new PrototypeStore()
  const image: ExecutionImage = { id: 'image-1', name: '登录失败.png', size: 128, src: 'data:image/png;base64,AA==', type: 'image/png' }
  store.appendExecution(24102, { ...execution('with-image', 'failed'), images: [image] })
  const report = reportSnapshot(store.data, store.histories, 24)
  assert.deepEqual(report.cases.find(item => item.id === 24102)?.history.at(-1)?.images, [image])
  store.histories[24102].at(-1)!.images![0].name = '后来修改.png'
  assert.equal(report.cases.find(item => item.id === 24102)?.history.at(-1)?.images?.[0].name, '登录失败.png')
})

test('execution image limits reject unsupported, oversized and excessive batches', () => {
  const file = (name: string, size: number, type: string) => ({ name, size, type }) as File
  assert.match(validateExecutionImages([], [file('记录.txt', 1, 'text/plain')]), /格式不支持/)
  assert.match(validateExecutionImages([], [file('超大.png', 10 * 1024 * 1024 + 1, 'image/png')]), /超过 10 MiB/)
  assert.match(validateExecutionImages([], Array.from({ length: 7 }, (_, index) => file(`${index}.png`, 1, 'image/png'))), /最多上传 6 张/)
  assert.match(validateExecutionImages([], [file('1.png', 10 * 1024 * 1024, 'image/png'), file('2.png', 10 * 1024 * 1024, 'image/png'), file('3.png', 10 * 1024 * 1024, 'image/png'), file('4.png', 1, 'image/png')]), /总大小不能超过 30 MiB/)
  assert.equal(validateExecutionImages([], [file('有效.webp', 1024, 'image/webp')]), '')
})
