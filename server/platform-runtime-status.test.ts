import assert from 'node:assert/strict'
import test from 'node:test'
import {
  platformConfigRevisionProgress,
  platformConfigRuntimeOverallStatus,
  platformConfigSectionHasDraftChanges,
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

test('revision progress reports applied, error, offline, and superseded states', () => {
  const runtime = {
    activeRevision: 2,
    cronJob: { mode: 'load-on-run' as const },
    instances: [
      runtimeInstance('applied', 'applied-instance'),
      runtimeInstance('loading', 'loading-instance'),
      runtimeInstance('offline', 'stale-instance'),
    ],
  }
  assert.deepEqual(platformConfigRevisionProgress(runtime, 2), {
    appliedCount: 1,
    errorCount: 0,
    onlineCount: 2,
    state: 'loading',
    targetRevision: 2,
  })
  runtime.instances[1] = runtimeInstance('error', 'failed-instance')
  assert.equal(platformConfigRevisionProgress(runtime, 2).state, 'error')
  assert.equal(platformConfigRevisionProgress({ ...runtime, activeRevision: 3 }, 2).state, 'superseded')
  assert.equal(platformConfigRevisionProgress({ ...runtime, instances: [] }, 2).state, 'offline')
})

test('section draft detection includes ordinary and secret changes', () => {
  const loaded = { general: { displayName: 'Veges' }, ai: { model: 'model-a' } }
  assert.equal(platformConfigSectionHasDraftChanges(loaded, structuredClone(loaded), 'general', {}), false)
  assert.equal(platformConfigSectionHasDraftChanges(
    loaded,
    { ...loaded, general: { displayName: 'Veges Next' } },
    'general',
    {},
  ), true)
  assert.equal(platformConfigSectionHasDraftChanges(loaded, structuredClone(loaded), 'ai', {
    'ai.apiKey': 'replacement-secret',
  }), true)
})
