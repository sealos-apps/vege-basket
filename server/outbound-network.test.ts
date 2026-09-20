import assert from 'node:assert/strict'
import test from 'node:test'
import {
  OutboundNetworkTargetError,
  resolvePublicNetworkHost,
} from './outbound-network.ts'

test('outbound target resolution accepts and deduplicates public addresses', async () => {
  const addresses = await resolvePublicNetworkHost('service.example.com', async () => [
    { address: '8.8.8.8', family: 4 },
    { address: '8.8.8.8', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ])
  assert.deepEqual(addresses, [
    { address: '8.8.8.8', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ])
})

test('outbound target resolution rejects a hostname when any answer is private', async () => {
  await assert.rejects(
    resolvePublicNetworkHost('mixed.example.com', async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]),
    OutboundNetworkTargetError,
  )
})

test('outbound target resolution rejects private IP literals without DNS', async () => {
  await assert.rejects(resolvePublicNetworkHost('10.0.0.1'), OutboundNetworkTargetError)
})
