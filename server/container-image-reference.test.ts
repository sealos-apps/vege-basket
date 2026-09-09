import assert from 'node:assert/strict'
import test from 'node:test'
import { containerImageReferenceKey, normalizeContainerImageReference } from '../shared/container-image-reference.ts'

test('normalizes public container image references for verification delivery', () => {
  assert.deepEqual(
    normalizeContainerImageReference('ghcr.io/example/admin:v2.1.0', { requireTagOrDigest: true }),
    { valid: true, value: 'ghcr.io/example/admin:v2.1.0' },
  )
  assert.deepEqual(
    normalizeContainerImageReference('docker://registry.example/worker@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', { requireTagOrDigest: true }),
    { valid: true, value: 'docker://registry.example/worker@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  )
})

test('rejects unpinned, duplicate-prone, and unsafe verification image references', () => {
  for (const image of [
    'ghcr.io/example/admin',
    'ghcr.io/example/admin:latest --quiet',
    'https://registry.example/admin:v2',
    'localhost:5000/admin:v2',
    '10.0.0.8/admin:v2',
    'registry.local/admin:v2',
    'ghcr.io/example/admin@sha256:short',
  ]) {
    assert.equal(normalizeContainerImageReference(image, { requireTagOrDigest: true }).valid, false)
  }
})

test('deduplicates the same cluster image name and tag without blocking another version', () => {
  const image = 'ghcr.io/example/admin:v2.1.0'
  assert.equal(containerImageReferenceKey(`docker://${image}`), containerImageReferenceKey(image))
  assert.equal(
    containerImageReferenceKey('GHCR.IO/example/admin:v2.1.0'),
    containerImageReferenceKey(image),
  )
  assert.notEqual(
    containerImageReferenceKey('ghcr.io/example/admin:v2.1.1'),
    containerImageReferenceKey(image),
  )
})
