import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bugDiscoveryDifficulties,
  parseBugDiscoveryAssessment,
  type BugDiscoveryAssessment,
} from '../shared/bug-discovery-difficulty.ts'

test('creation requires an explicit high, medium or low discovery difficulty', () => {
  for (const discoveryDifficulty of [undefined, null, '', 'pending', 'HIGH', 'unknown', 1, [], {}]) {
    assert.equal(parseBugDiscoveryAssessment({ discoveryDifficulty }).valid, false)
  }
  for (const discoveryDifficulty of bugDiscoveryDifficulties) {
    const discoveryDifficultyReason = discoveryDifficulty === 'high' ? '并发请求交错时触发，需要核对数据。' : ''
    assert.deepEqual(parseBugDiscoveryAssessment({ discoveryDifficulty, discoveryDifficultyReason }), {
      valid: true, value: { discoveryDifficulty, discoveryDifficultyReason },
    })
  }
})

test('high difficulty requires non-blank textual evidence and bounds its size', () => {
  for (const discoveryDifficultyReason of [undefined, null, '', ' \n\t\u3000 ', 42, {}, [], '字'.repeat(1001)]) {
    assert.equal(parseBugDiscoveryAssessment({ discoveryDifficulty: 'high', discoveryDifficultyReason }).valid, false)
  }
  assert.equal(parseBugDiscoveryAssessment({ discoveryDifficulty: 'high', discoveryDifficultyReason: '字'.repeat(1000) }).valid, true)
  assert.deepEqual(parseBugDiscoveryAssessment({ discoveryDifficulty: 'high', discoveryDifficultyReason: '  并发操作\n核对数据  ' }), {
    valid: true, value: { discoveryDifficulty: 'high', discoveryDifficultyReason: '并发操作\n核对数据' },
  })
})

test('medium and low evidence is optional, but supplied invalid values are rejected', () => {
  for (const discoveryDifficulty of ['medium', 'low']) {
    assert.deepEqual(parseBugDiscoveryAssessment({ discoveryDifficulty }), {
      valid: true, value: { discoveryDifficulty, discoveryDifficultyReason: '' },
    })
    for (const discoveryDifficultyReason of [null, 1, {}, '字'.repeat(1001)]) {
      assert.equal(parseBugDiscoveryAssessment({ discoveryDifficulty, discoveryDifficultyReason }).valid, false)
    }
  }
})

test('partial edits preserve the locked canonical assessment and validate the merged result', () => {
  const current: BugDiscoveryAssessment = { discoveryDifficulty: 'high', discoveryDifficultyReason: '长时间运行后连接耗尽' }
  assert.deepEqual(parseBugDiscoveryAssessment({}, current), { valid: true, value: current })
  assert.deepEqual(parseBugDiscoveryAssessment({ discoveryDifficulty: 'low' }, current), {
    valid: true, value: { ...current, discoveryDifficulty: 'low' },
  })
  assert.equal(parseBugDiscoveryAssessment({ discoveryDifficultyReason: '' }, current).valid, false)
  assert.equal(parseBugDiscoveryAssessment({ discoveryDifficulty: null }, current).valid, false)
  assert.deepEqual(parseBugDiscoveryAssessment({ discoveryDifficulty: 'medium', discoveryDifficultyReason: '' }, current), {
    valid: true, value: { discoveryDifficulty: 'medium', discoveryDifficultyReason: '' },
  })
  const legacy: BugDiscoveryAssessment = { discoveryDifficulty: 'medium', discoveryDifficultyReason: '' }
  assert.equal(parseBugDiscoveryAssessment({ discoveryDifficulty: 'high' }, legacy).valid, false)
  assert.equal(parseBugDiscoveryAssessment({ discoveryDifficulty: 'high', discoveryDifficultyReason: '依赖特定时序' }, legacy).valid, true)
})
