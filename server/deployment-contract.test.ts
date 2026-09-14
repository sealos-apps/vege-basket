import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8')
const sealosTemplate = readFileSync(
  new URL('../.sealos/template/index.yaml', import.meta.url),
  'utf8',
)
const dockerPushWorkflow = readFileSync(
  new URL('../.github/workflows/docker-push.yml', import.meta.url),
  'utf8',
)

test('runtime image installs production dependencies from the canonical lockfile', () => {
  const runtimeStage = dockerfile.slice(dockerfile.indexOf('FROM node:24-alpine AS runtime'))

  assert.match(runtimeStage, /COPY package\.json package-lock\.json \.\//u)
  assert.match(runtimeStage, /npm ci --omit=dev/u)
  assert.doesNotMatch(runtimeStage, /printf[\s\S]*?"dependencies"/u)
})

test('Sealos application and digest worker share one required immutable image input', () => {
  assert.match(
    sealosTemplate,
    /VEGES_IMAGE:[\s\S]*?immutable linux\/amd64 image tag or digest[\s\S]*?required: true/iu,
  )
  assert.equal(sealosTemplate.match(/\$\{\{ inputs\.VEGES_IMAGE \}\}/gu)?.length, 3)
  assert.doesNotMatch(
    sealosTemplate,
    /ghcr\.io\/felixqiu014-wq\/vege-basket:/u,
  )
})

test('Sealos does not grant system administration to a predictable default username', () => {
  const adminInput = sealosTemplate.slice(
    sealosTemplate.indexOf('VEGES_ADMIN_USERNAMES:'),
    sealosTemplate.indexOf('AI_API_BASE:'),
  )
  assert.match(adminInput, /default: ''/u)
  assert.doesNotMatch(adminInput, /default: admin/u)
})

test('main image workflow deploys the same immutable image to both Kubernetes workloads', () => {
  const deployJob = dockerPushWorkflow.slice(dockerPushWorkflow.indexOf('  deploy-k8s:'))

  assert.match(deployJob, /needs: merge-manifest/u)
  assert.match(deployJob, /environment: production/u)
  assert.match(deployJob, /secrets\.KUBE_CONFIG/u)
  assert.match(deployJob, /deployment\/\$K8S_DEPLOYMENT_NAME/u)
  assert.match(deployJob, /cronjob\/\$K8S_CRONJOB_NAME/u)
  assert.match(deployJob, /grep -Fx "\$K8S_DEPLOYMENT_NAME"/u)
  assert.match(deployJob, /grep -Fx 'todo-digest-worker'/u)
  assert.match(deployJob, /rollout status/u)
  assert.match(deployJob, /test "\$DEPLOYMENT_IMAGE" = "\$EXPECTED_IMAGE"/u)
  assert.match(deployJob, /test "\$CRONJOB_IMAGE" = "\$EXPECTED_IMAGE"/u)
})
