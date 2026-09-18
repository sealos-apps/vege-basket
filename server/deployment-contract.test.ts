import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { loadAll } from 'js-yaml'

const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8')
const sealosTemplate = readFileSync(
  new URL('../.sealos/template/index.yaml', import.meta.url),
  'utf8',
)
const dockerPushWorkflow = readFileSync(
  new URL('../.github/workflows/docker-push.yml', import.meta.url),
  'utf8',
)
const sealosResources = loadAll(sealosTemplate) as Array<Record<string, unknown>>
const applicationDeployment = sealosResources.find((resource) => resource.kind === 'Deployment') as {
  spec: {
    replicas: number
    template: { spec: { containers: Array<{ env?: Array<{ name: string }>; readinessProbe?: { httpGet?: { path?: string } } }>; initContainers?: unknown[] } }
  }
}

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

test('Sealos injects only startup configuration into application processes', () => {
  const businessEnvironmentKeys = [
    'APP_PUBLIC_URL',
    'VEGES_ADMIN_USERNAMES',
    'AI_API_BASE',
    'AI_API_KEY',
    'AI_MODEL',
    'FEISHU_APP_ID',
    'FEISHU_APP_SECRET',
    'OSS_ENDPOINT',
    'OSS_ACCESS_KEY_ID',
    'OSS_ACCESS_KEY_SECRET',
    'OSS_BUCKET',
    'PACKAGE_MARKET_RULES_FILE',
  ]
  for (const key of businessEnvironmentKeys) {
    assert.doesNotMatch(sealosTemplate, new RegExp(`(?:name:|inputs\\.) ${key}|inputs\\.${key}`, 'u'))
  }
  assert.equal(sealosTemplate.match(/name: APP_ENCRYPTION_KEYS\b/gu)?.length, 2)
  assert.equal(sealosTemplate.match(/name: DATABASE_URL\b/gu)?.length, 2)
  assert.equal(sealosTemplate.match(/name: VEGES_BOOTSTRAP_ADMIN_PASSWORD\b/gu)?.length ?? 0, 0)
  assert.match(sealosTemplate, /kind: Secret[\s\S]*?name: \$\{\{ defaults\.app_name \}\}-bootstrap-admin[\s\S]*?password: \$\{\{ inputs\.VEGES_BOOTSTRAP_ADMIN_PASSWORD \}\}/u)
})

test('Sealos application Deployment uses two single-container Pods without init containers', () => {
  assert.ok(applicationDeployment)
  assert.equal(applicationDeployment.spec.replicas, 2)
  assert.equal(applicationDeployment.spec.template.spec.containers.length, 1)
  assert.equal(applicationDeployment.spec.template.spec.initContainers, undefined)
  assert.equal(applicationDeployment.spec.template.spec.containers[0].readinessProbe?.httpGet?.path, '/api/ready')
  assert.equal(
    applicationDeployment.spec.template.spec.containers[0].env?.some((entry) => entry.name === 'VEGES_BOOTSTRAP_ADMIN_PASSWORD'),
    false,
  )
})

test('Sealos bounds application and digest worker database pools separately', () => {
  assert.match(sealosTemplate, /name: DB_POOL_CONNECTION_TIMEOUT_MS\s+value: '3000'/u)
  assert.match(sealosTemplate, /name: DB_POOL_IDLE_TIMEOUT_MS\s+value: '30000'/u)
  assert.equal(sealosTemplate.match(/name: DB_POOL_MAX\s+value: '10'/gu)?.length, 1)
  assert.equal(sealosTemplate.match(/name: DB_POOL_MAX\s+value: '2'/gu)?.length, 1)
})

test('main image workflow deploys the immutable image to the application Deployment', () => {
  const deployJob = dockerPushWorkflow.slice(dockerPushWorkflow.indexOf('  deploy-k8s:'))

  assert.match(deployJob, /needs: merge-manifest/u)
  assert.match(deployJob, /environment: production/u)
  assert.match(deployJob, /secrets\.KUBE_CONFIG/u)
  assert.match(deployJob, /config view --minify/u)
  assert.match(deployJob, /test -n "\$KUBE_NAMESPACE"/u)
  assert.match(deployJob, /deployment\/\$K8S_DEPLOYMENT_NAME/u)
  assert.match(deployJob, /grep -Fx "\$K8S_DEPLOYMENT_NAME"/u)
  assert.match(deployJob, /rollout status/u)
  assert.match(deployJob, /test "\$DEPLOYMENT_IMAGE" = "\$EXPECTED_IMAGE"/u)
  assert.doesNotMatch(deployJob, /K8S_NAMESPACE|--namespace|K8S_CRONJOB_NAME|cronjob\//u)
})
