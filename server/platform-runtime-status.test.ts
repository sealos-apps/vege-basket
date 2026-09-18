import assert from 'node:assert/strict'
import test from 'node:test'
import {
  platformConfigRuntimeOverallStatus,
  type PlatformConfigRuntimeInstance,
} from '../shared/platform-config.ts'

function runtimeInstance(
  status: PlatformConfigRuntimeInstance['status'],
  instanceId: string,
): PlatformConfigRuntimeInstance {
  return {
    appliedRevision: status === 'loading' ? 1 : 2,
    heartbeatAt: new Date().toISOString(),
    instanceId,
    processKind: 'api',
    status,
  }
}

test('offline runtime records do not block an applied online instance', () => {
  const status = platformConfigRuntimeOverallStatus({
    activeRevision: 2,
    cronJob: { mode: 'load-on-run' },
    instances: [
      runtimeInstance('offline', 'stale-instance'),
      runtimeInstance('applied', 'online-instance'),
    ],
  })

  assert.equal(status, 'applied')
})

test('online runtime errors take precedence over loading instances', () => {
  const status = platformConfigRuntimeOverallStatus({
    activeRevision: 2,
    cronJob: { mode: 'load-on-run' },
    instances: [
      runtimeInstance('loading', 'loading-instance'),
      runtimeInstance('error', 'failed-instance'),
    ],
  })

  assert.equal(status, 'error')
})

test('an online instance on an older revision keeps the runtime loading', () => {
  const status = platformConfigRuntimeOverallStatus({
    activeRevision: 2,
    cronJob: { mode: 'load-on-run' },
    instances: [runtimeInstance('loading', 'loading-instance')],
  })

  assert.equal(status, 'loading')
})

test('a runtime with no online instances is offline', () => {
  const status = platformConfigRuntimeOverallStatus({
    activeRevision: 2,
    cronJob: { mode: 'load-on-run' },
    instances: [runtimeInstance('offline', 'stale-instance')],
  })

  assert.equal(status, 'offline')
  assert.equal(platformConfigRuntimeOverallStatus({
    activeRevision: 2,
    cronJob: { mode: 'load-on-run' },
    instances: [],
  }), 'offline')
})
