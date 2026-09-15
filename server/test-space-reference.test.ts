import test from 'node:test'
import assert from 'node:assert/strict'
import { formatTestSpaceReference } from '../shared/test-space-reference.ts'

test('test-space references always include the version label', () => {
  assert.equal(formatTestSpaceReference('控制台', 'v2.4.1'), '控制台 · v2.4.1')
  assert.equal(formatTestSpaceReference('控制台', ''), '控制台 · 未指定版本')
  assert.equal(formatTestSpaceReference('', undefined), '未命名测试空间 · 未指定版本')
})
