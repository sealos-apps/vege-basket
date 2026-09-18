import assert from 'node:assert/strict'
import test from 'node:test'
import { hasVerifiedFeishuIdentity } from './platform-admins.ts'

test('historical Feishu Open ID remains eligible without a migrated verification timestamp', () => {
  assert.equal(hasVerifiedFeishuIdentity({
    feishuUserId: 'ou_historical_user',
    registrationSource: 'legacy_unknown',
    verifiedAt: null,
  }), true)
})

test('new accounts require both a Feishu Open ID and OAuth verification evidence', () => {
  assert.equal(hasVerifiedFeishuIdentity({
    feishuUserId: 'ou_new_user',
    registrationSource: 'feishu',
    verifiedAt: null,
  }), false)
  assert.equal(hasVerifiedFeishuIdentity({
    feishuUserId: 'email@example.com',
    registrationSource: 'feishu',
    verifiedAt: new Date(),
  }), false)
  assert.equal(hasVerifiedFeishuIdentity({
    feishuUserId: 'ou_verified_user',
    registrationSource: 'feishu',
    verifiedAt: new Date(),
  }), true)
})
