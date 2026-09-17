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
  assert.equal(sealosTemplate.match(/\$\{\{ inputs\.VEGES_IMAGE \}\}/gu)?.length, 4)
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
  assert.equal(sealosTemplate.match(/name: APP_ENCRYPTION_KEYS\b/gu)?.length, 3)
  assert.equal(sealosTemplate.match(/name: DATABASE_URL\b/gu)?.length, 3)
  assert.equal(sealosTemplate.match(/name: VEGES_BOOTSTRAP_ADMIN_PASSWORD\b/gu)?.length, 1)
})

test('Sealos initializes schema, builtin admin, fixed callbacks, and default platform config before startup', () => {
  const initializer = sealosTemplate.slice(sealosTemplate.indexOf('- name: initialize-platform'))
  assert.match(initializer, /npm run db:init/u)
  assert.match(initializer, /platform:config -- initialize/u)
  assert.match(initializer, /\/api\/integrations\/feishu\/events/u)
  assert.match(initializer, /\/api\/auth\/feishu\/oauth\/callback/u)
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
