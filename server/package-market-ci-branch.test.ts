import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isValidPackageMarketCiBranch,
  packageMarketCiBranchFromObjectKey,
} from './package-market.ts'

test('package-market CI branches accept only one safe path segment', () => {
  for (const branch of ['main', 'release-1.2', 'feature_test']) {
    assert.equal(isValidPackageMarketCiBranch(branch), true)
  }
  for (const branch of ['', '.', '..', '/main', 'feature/test', 'main branch']) {
    assert.equal(isValidPackageMarketCiBranch(branch), false)
  }
})

test('package-market CI branch snapshots come only from canonical CI object paths', () => {
  assert.equal(
    packageMarketCiBranchFromObjectKey('offline/apps/example/ci/feature-test/a1b2c3/example-amd64.tar.gz'),
    'feature-test',
  )
  assert.equal(packageMarketCiBranchFromObjectKey('offline/apps/example/release/v1/example-amd64.tar.gz'), '')
  assert.equal(packageMarketCiBranchFromObjectKey('offline/apps/example/ci/feature/hash/nested/example-amd64.tar.gz'), '')
})
