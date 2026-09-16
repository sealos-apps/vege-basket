import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HTTP_LARGE_RESPONSE_BYTES,
  HTTP_SLOW_REQUEST_MILLIS,
  shouldReportHttpPerformance,
} from './http-performance.ts'

test('reports slow requests independently of response size', () => {
  assert.equal(shouldReportHttpPerformance({
    bytes: 1,
    elapsedMillis: HTTP_SLOW_REQUEST_MILLIS,
  }), true)
})

test('reports large responses independently of request duration', () => {
  assert.equal(shouldReportHttpPerformance({
    bytes: HTTP_LARGE_RESPONSE_BYTES,
    elapsedMillis: 1,
  }), true)
})

test('keeps ordinary requests out of the performance log', () => {
  assert.equal(shouldReportHttpPerformance({
    bytes: HTTP_LARGE_RESPONSE_BYTES - 1,
    elapsedMillis: HTTP_SLOW_REQUEST_MILLIS - 1,
  }), false)
})
