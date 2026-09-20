import assert from 'node:assert/strict'
import test from 'node:test'
import { createDefaultPlatformConfig } from './platform-config-schema.ts'
import { inspectGithubWorkflow, testPlatformConfigSection } from './platform-config-tests.ts'

test('GitHub workflow availability requires dispatch inputs and request id run naming', () => {
  assert.deepEqual(inspectGithubWorkflow(`
name: Sync image
run-name: Sync image tar [\${{ inputs.request_id }}]
on:
  workflow_dispatch:
    inputs:
      image: { required: true }
      arch: { required: true }
      request_id: { required: true }
jobs: {}
`), { inputsValid: true, runNameValid: true, valid: true })

  assert.equal(inspectGithubWorkflow(`
on:
  workflow_dispatch:
    inputs:
      image: { required: true }
`).valid, false)
})

test('email test rejects unsupported actions and invalid recipients before connecting', async () => {
  const config = createDefaultPlatformConfig()
  const invalidAction = await testPlatformConfigSection(config, 'email', { action: 'deliver' })
  const invalidRecipient = await testPlatformConfigSection(config, 'email', {
    action: 'send-email',
    recipient: 'not-an-email',
  })

  assert.deepEqual(invalidAction, {
    checks: [{ label: '连接测试', message: '不支持的邮箱测试动作。', ok: false }],
    ok: false,
  })
  assert.deepEqual(invalidRecipient, {
    checks: [{ label: '连接测试', message: '测试收件地址格式无效。', ok: false }],
    ok: false,
  })
})
