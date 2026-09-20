import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isTodoImageSignatureValid,
  legacyTodoImageUrlSecretFromEnvironment,
  todoImageSignature,
} from './todo-image-signature.ts'

test('legacy image secret keeps the old nullish fallback semantics', () => {
  assert.equal(
    legacyTodoImageUrlSecretFromEnvironment({ APP_ENCRYPTION_KEYS: 'encryption-ring' }),
    'encryption-ring',
  )
  assert.equal(
    legacyTodoImageUrlSecretFromEnvironment({
      APP_ENCRYPTION_KEYS: 'encryption-ring',
      FEISHU_OAUTH_STATE_SECRET: 'oauth-secret',
    }),
    'oauth-secret',
  )
  assert.equal(
    legacyTodoImageUrlSecretFromEnvironment({
      APP_ENCRYPTION_KEYS: 'encryption-ring',
      TODO_IMAGE_URL_SECRET: '',
    }),
    '',
  )
})

test('image signature validation accepts retained and legacy fallback keys only', () => {
  const objectKey = 'todo-images/2026-09-17/user-22/image.png'
  const legacySignature = todoImageSignature(objectKey, 'legacy-secret')
  assert.equal(isTodoImageSignatureValid(objectKey, legacySignature, ['current-secret', 'legacy-secret']), true)
  assert.equal(isTodoImageSignatureValid(objectKey, legacySignature, ['current-secret']), false)
  assert.equal(isTodoImageSignatureValid('todo-images/other.png', legacySignature, ['legacy-secret']), false)
})
