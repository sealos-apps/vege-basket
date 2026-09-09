import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createClusterImageVerificationScript,
  createPackageVerificationScript,
} from './verification-deployment-script.ts'

test('builds a per-archive download and run command without retaining the link', () => {
  const script = createPackageVerificationScript([
    {
      downloadUrl: 'https://download.example.invalid/releases/admin-v1.tar?temporary=true',
      objectKey: 'offline/apps/admin/admin-v1.tar',
    },
  ])
  assert.equal(
    script,
    "wget 'https://download.example.invalid/releases/admin-v1.tar?temporary=true' -O 'admin-v1.tar' && sealos run -f 'admin-v1.tar'",
  )
})

test('chains multiple cluster images and gives duplicate archive names separate files', () => {
  assert.equal(
    createClusterImageVerificationScript(['ghcr.io/example/admin:v1', 'ghcr.io/example/worker:v1']),
    "sealos run -f 'ghcr.io/example/admin:v1' && \\\nsealos run -f 'ghcr.io/example/worker:v1'",
  )
  assert.match(
    createPackageVerificationScript([
      { downloadUrl: 'https://download.example.invalid/a', objectKey: 'one/admin.tar' },
      { downloadUrl: 'https://download.example.invalid/b', objectKey: 'two/admin.tar' },
    ]),
    /-O 'admin-2\.tar'/u,
  )
})
