import assert from 'node:assert/strict'
import test from 'node:test'
import { validatePlatformSecretDraft } from '../src/platform-secret-draft.ts'

test('configured secrets require two matching values after replacement starts', () => {
  assert.equal(validatePlatformSecretDraft({
    configured: true,
    editing: false,
    touched: false,
    value: '',
    confirmation: '',
  }), '')
  assert.equal(validatePlatformSecretDraft({
    configured: true,
    editing: true,
    touched: false,
    value: '',
    confirmation: '',
  }), '请完整输入新值和确认值。')
  assert.equal(validatePlatformSecretDraft({
    configured: true,
    editing: true,
    touched: true,
    value: 'new-secret',
    confirmation: 'different-secret',
  }), '两次输入不一致。')
  assert.equal(validatePlatformSecretDraft({
    configured: true,
    editing: true,
    touched: true,
    value: 'new-secret',
    confirmation: 'new-secret',
  }), '')
})

test('optional unconfigured secrets stay valid until the user starts entering one', () => {
  assert.equal(validatePlatformSecretDraft({
    configured: false,
    editing: true,
    touched: false,
    value: '',
    confirmation: '',
  }), '')
  assert.equal(validatePlatformSecretDraft({
    configured: false,
    editing: true,
    touched: true,
    value: '',
    confirmation: '',
  }), '请完整输入新值和确认值。')
  assert.equal(validatePlatformSecretDraft({
    configured: false,
    editing: true,
    touched: true,
    value: 'new-secret',
    confirmation: '',
  }), '请完整输入新值和确认值。')
  assert.equal(validatePlatformSecretDraft({
    configured: false,
    editing: true,
    touched: true,
    value: 'new-secret',
    confirmation: 'new-secret',
  }), '')
})
