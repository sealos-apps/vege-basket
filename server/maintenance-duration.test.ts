import assert from 'node:assert/strict'
import test from 'node:test'
import { maintenanceDurationLabel } from '../shared/maintenance-duration.ts'

test('formats maintenance durations from persisted seconds', () => {
  assert.equal(maintenanceDurationLabel(0), '少于 1 分钟')
  assert.equal(maintenanceDurationLabel(59), '少于 1 分钟')
  assert.equal(maintenanceDurationLabel(60), '1 分钟')
  assert.equal(maintenanceDurationLabel(42 * 60), '42 分钟')
  assert.equal(maintenanceDurationLabel((2 * 60 + 15) * 60), '2 小时 15 分钟')
  assert.equal(maintenanceDurationLabel(24 * 60 * 60), '1 天')
  assert.equal(maintenanceDurationLabel((27 * 60 + 30) * 60), '1 天 3 小时')
})
