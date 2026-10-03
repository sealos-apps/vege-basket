import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createClusterImageVerificationScript,
  createDeliveryExecutionScript,
  createOfflineDeliveryExecutionScript,
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

test('builds one deterministic script for object packages, offline URLs, and images', () => {
  assert.equal(
    createDeliveryExecutionScript({
      packages: [{ downloadUrl: 'https://oss.example/app.tar?token=x', objectKey: 'release/app.tar' }],
      offlinePackages: [{ downloadUrl: 'https://downloads.example/app.tar', fileName: 'app.tar' }],
      images: ['ghcr.io/example/worker:v2'],
    }),
    "delivery_dir=\"$(mktemp -d)\" && \\\n" +
      "trap 'rm -rf \"$delivery_dir\"' EXIT && \\\n" +
      "wget 'https://oss.example/app.tar?token=x' -O \"$delivery_dir/app.tar\" && sealos run -f \"$delivery_dir/app.tar\" && \\\n" +
      "wget 'https://downloads.example/app.tar' -O \"$delivery_dir/app-2.tar\" && sealos run -f \"$delivery_dir/app-2.tar\" && \\\n" +
      "sealos run -f 'ghcr.io/example/worker:v2'",
  )
})

test('builds an offline command that runs an already-present archive', () => {
  assert.equal(
    createOfflineDeliveryExecutionScript({ fileName: 'admin-v1.tar' }),
    "sealos run -f 'admin-v1.tar'",
  )
})

test('offline commands keep Values rollback checks when runtime patching is configured', () => {
  const script = createOfflineDeliveryExecutionScript({
    fileName: 'admin-v1.tar',
    runtimeConfig: {
      environmentVariables: [],
      valuesPath: '/root/.sealos/cloud/values/admin.yaml',
      valuesPatch: 'replicas: 3',
    },
  })
  assert.match(script, /\(\n {2}set -e\n/u)
  assert.match(script, /if ! command -v yq[\s\S]*?缺少 yq v4/u)
  assert.match(script, /if ! command -v flock[\s\S]*?缺少 flock/u)
  assert.match(script, /restore_values\(\) \{\n {4}restore_status=\$\?/u)
  assert.match(script, /trap restore_values EXIT/u)
  assert.match(script, /sealos run -f 'admin-v1.tar'/u)
  assert.doesNotMatch(script, /&& \{ echo/u)
})

test('quotes untrusted delivery addresses and never writes archives into the working directory', () => {
  const script = createDeliveryExecutionScript({
    packages: [],
    offlinePackages: [{
      downloadUrl: "https://example.com/package.tar?value=';$()",
      fileName: '.bashrc',
    }],
    images: [],
  })
  assert.match(script, /delivery_dir="\$\(mktemp -d\)"/u)
  assert.match(script, /-O "\$delivery_dir\/\.bashrc"/u)
  assert.match(script, /value='\\'';\$\(\)/u)
  assert.doesNotMatch(script, /-O '\.bashrc'/u)
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

test('adds per-item environment variables without turning Values into sealos parameters', () => {
  const config = {
    environmentVariables: [{ name: 'REGION', value: 'cn-hz' }],
    valuesPath: '/root/.sealos/cloud/values/app.yaml',
    valuesPatch: 'replicas: 3\n',
  }
  const script = createClusterImageVerificationScript([{ image: 'ghcr.io/example/app:v1', runtimeConfig: config }])
  assert.match(script, /delivery_dir="\$\(mktemp -d\)"/u)
  assert.match(script, /sealos run -f 'ghcr\.io\/example\/app:v1' --env 'REGION=cn-hz'/u)
  assert.match(script, /yq ea 'select\(fileIndex == 0\) \* select\(fileIndex == 1\)'/u)
  assert.match(script, /cp -- "\$values_merged" "\$values_path"/u)
  assert.match(script, /restore_values\(\)/u)
  assert.match(script, /无法恢复 Values 文件/u)
  assert.doesNotMatch(script, /restore_values\(\).*\|\| true/u)
  assert.doesNotMatch(script, /--values|HELM_OPTIONS/u)
})
