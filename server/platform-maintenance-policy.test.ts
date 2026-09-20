import assert from 'node:assert/strict'
import test from 'node:test'
import { platformLoginAccess } from './platform-maintenance.ts'

test('platform login remains open during normal operation', () => {
  assert.equal(platformLoginAccess({
    maintenance: { active: false, systemForced: false },
    migration: { phase: 'completed' },
  }), 'open')
})

test('manual maintenance allows only platform administrator login', () => {
  assert.equal(platformLoginAccess({
    maintenance: { active: true, systemForced: false },
    migration: { phase: 'completed' },
  }), 'platform-admin-only')
})

test('system-forced maintenance keeps the builtin admin recovery login after migration', () => {
  assert.equal(platformLoginAccess({
    maintenance: { active: true, systemForced: true },
    migration: { phase: 'completed' },
  }), 'builtin-admin-only')
})

test('incomplete or failed migration blocks login until the authentication schema is ready', () => {
  assert.equal(platformLoginAccess({
    maintenance: { active: true, systemForced: true },
    migration: { phase: 'failed' },
  }), 'blocked')
})
