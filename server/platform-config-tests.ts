import OSS from 'ali-oss'
import nodemailer from 'nodemailer'
import * as yaml from 'js-yaml'
import { requestAiChatCompletion } from './ai-provider.ts'
import { createPinnedHttpsAgent, resolvePublicNetworkHost } from './outbound-network.ts'
import { normalizeOssEndpoint } from './package-market.ts'
import type { PlatformConfig } from './platform-config-schema.ts'

type TestResult = {
  checks: Array<{ label: string; ok: boolean; message: string }>
  ok: boolean
}

async function boundedFetch(url: string, init: RequestInit = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    return await fetch(url, { ...init, redirect: 'error', signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function result(label: string, ok: boolean, message: string): TestResult {
  return { checks: [{ label, message, ok }], ok }
}

async function testAi(config: PlatformConfig): Promise<TestResult> {
  await requestAiChatCompletion({
    apiKey: config.ai.apiKey,
    baseUrl: config.ai.apiBase,
    maxContextChars: config.ai.maxContextChars,
    maxMessageLength: config.ai.maxMessageLength,
    model: config.ai.model,
  }, {
    messages: [{ content: '只回复 OK', role: 'user' }],
    systemPrompt: '这是连通性检查。只回复 OK。',
    temperature: 0,
    timeoutMs: 15_000,
  })
  return result('AI 服务', true, '模型请求成功。')
}

async function testStorage(config: PlatformConfig): Promise<TestResult> {
  const storage = config.storage
  const endpoint = new URL(normalizeOssEndpoint(storage.endpoint))
  const addresses = await resolvePublicNetworkHost(endpoint.hostname)
  const agent = createPinnedHttpsAgent(addresses)
  const client = new OSS({
    accessKeyId: storage.accessKeyId,
    accessKeySecret: storage.accessKeySecret,
    bucket: storage.bucket,
    endpoint: endpoint.origin,
    secure: true,
    agent,
  } as OSS.Options & { agent: typeof agent })
  try {
    await client.list({ 'max-keys': 1 }, {})
  } finally {
    agent.destroy()
  }
  return result('对象存储', true, '存储桶读取成功。')
}

async function testFeishu(config: PlatformConfig): Promise<TestResult> {
  const response = await boundedFetch(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      body: JSON.stringify({ app_id: config.feishu.appId, app_secret: config.feishu.appSecret }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  )
  const body = await response.json() as { code?: number; msg?: string; tenant_access_token?: string }
  if (!response.ok || body.code !== 0 || !body.tenant_access_token) {
    throw new Error(body.msg || `飞书返回 HTTP ${response.status}`)
  }
  return result('飞书应用', true, '应用凭据可用。')
}

function githubRepository(config: PlatformConfig) {
  const url = new URL(config.github.repositoryUrl)
  const [owner, repo] = url.pathname.split('/').filter(Boolean)
  return { apiRoot: `https://api.github.com/repos/${owner}/${repo}`, owner, repo }
}

export function inspectGithubWorkflow(source: string) {
  try {
    const document = yaml.load(source) as Record<string, unknown> | null
    const dispatch = document?.on && typeof document.on === 'object'
      ? (document.on as Record<string, unknown>).workflow_dispatch
      : undefined
    const inputs = dispatch && typeof dispatch === 'object'
      ? (dispatch as Record<string, unknown>).inputs
      : undefined
    const inputNames = inputs && typeof inputs === 'object' ? Object.keys(inputs) : []
    const runName = typeof document?.['run-name'] === 'string' ? document['run-name'] : ''
    const requiredInputs = ['arch', 'image', 'request_id']
    return {
      inputsValid: requiredInputs.every((input) => inputNames.includes(input)),
      runNameValid: runName.includes('request_id'),
      valid: Boolean(dispatch) && requiredInputs.every((input) => inputNames.includes(input)) && runName.includes('request_id'),
    }
  } catch {
    return { inputsValid: false, runNameValid: false, valid: false }
  }
}

async function testGithub(config: PlatformConfig): Promise<TestResult> {
  const target = githubRepository(config)
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${config.github.token}`,
    'User-Agent': 'veges-platform-config-test',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const workflowPath = `.github/workflows/${config.github.workflowFile}`
  const [repository, workflow, branch, workflowSource] = await Promise.all([
    boundedFetch(target.apiRoot, { headers }),
    boundedFetch(`${target.apiRoot}/actions/workflows/${encodeURIComponent(config.github.workflowFile)}`, { headers }),
    boundedFetch(`${target.apiRoot}/branches/${encodeURIComponent(config.github.branch)}`, { headers }),
    boundedFetch(`${target.apiRoot}/contents/${workflowPath}?ref=${encodeURIComponent(config.github.branch)}`, { headers }),
  ])
  const workflowMetadata = workflow.ok ? await workflow.json() as { state?: string } : {}
  const contentBody = workflowSource.ok
    ? await workflowSource.json() as { content?: string; encoding?: string }
    : {}
  const source = contentBody.encoding === 'base64' && contentBody.content
    ? Buffer.from(contentBody.content.replace(/\s/gu, ''), 'base64').toString('utf8')
    : ''
  const inspection = inspectGithubWorkflow(source)
  const checks = [
    {
      label: '仓库',
      message: repository.ok ? '仓库可访问。' : `仓库检查返回 HTTP ${repository.status}。`,
      ok: repository.ok,
    },
    {
      label: '工作流',
      message: workflow.ok && workflowMetadata.state === 'active'
        ? '工作流可访问且已启用。'
        : workflow.ok ? '工作流存在但未启用。' : `工作流检查返回 HTTP ${workflow.status}。`,
      ok: workflow.ok && workflowMetadata.state === 'active',
    },
    {
      label: '分支',
      message: branch.ok ? '分支可访问。' : `分支检查返回 HTTP ${branch.status}。`,
      ok: branch.ok,
    },
    {
      label: '触发契约',
      message: inspection.valid
        ? '工作流包含 image、arch、request_id 输入和请求编号对账名称。'
        : workflowSource.ok ? '工作流缺少所需输入或 request_id 对账名称。' : `工作流内容检查返回 HTTP ${workflowSource.status}。`,
      ok: workflowSource.ok && inspection.valid,
    },
  ]
  return { checks, ok: checks.every((check) => check.ok) }
}

function testRecipient(value: unknown) {
  const recipient = typeof value === 'string' ? value.trim() : ''
  if (recipient.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(recipient)) {
    throw new Error('测试收件地址格式无效。')
  }
  return recipient
}

async function testEmail(
  config: PlatformConfig,
  options: { action?: unknown; recipient?: unknown },
): Promise<TestResult> {
  const email = config.email
  const action = options.action ?? 'connect'
  if (action !== 'connect' && action !== 'send-email') throw new Error('不支持的邮箱测试动作。')
  const recipient = action === 'send-email' ? testRecipient(options.recipient) : undefined
  const addresses = await resolvePublicNetworkHost(email.host)
  const transporter = nodemailer.createTransport({
    auth: { pass: email.password, user: email.username },
    connectionTimeout: 15_000,
    disableFileAccess: true,
    disableUrlAccess: true,
    greetingTimeout: 15_000,
    host: addresses[0].address,
    name: email.host,
    port: email.port,
    requireTLS: email.security === 'starttls',
    secure: email.security === 'implicit-tls',
    socketTimeout: 15_000,
    tls: { servername: email.host },
  })
  try {
    if (action === 'send-email') {
      await transporter.sendMail({
        from: { address: email.fromAddress, name: email.fromName || undefined },
        subject: 'Veges 平台邮箱测试',
        text: '这是一封由 Veges 平台管理发送的测试邮件。',
        to: recipient,
      })
      return result('测试邮件', true, '测试邮件已提交给 SMTP 服务器。')
    }
    await transporter.verify()
    return result('邮件服务器', true, 'SMTP 连接与认证成功。')
  } finally {
    transporter.close()
  }
}

export async function testPlatformConfigSection(
  config: PlatformConfig,
  section: string,
  options: { action?: unknown; recipient?: unknown } = {},
): Promise<TestResult> {
  try {
    if (section === 'ai') return await testAi(config)
    if (section === 'storage') return await testStorage(config)
    if (section === 'feishu') return await testFeishu(config)
    if (section === 'github') return await testGithub(config)
    if (section === 'email') return await testEmail(config, options)
    return result('配置', false, '该分区不提供连通性测试。')
  } catch (error) {
    const secretValues = [
      config.ai.apiKey,
      config.email.password,
      config.feishu.appSecret,
      config.feishu.verificationToken,
      config.github.token,
      config.storage.accessKeyId,
      config.storage.accessKeySecret,
      config.storage.urlSecret,
    ].filter((value) => value.length >= 4).sort((left, right) => right.length - left.length)
    let message = error instanceof Error ? error.message : '连接测试失败。'
    for (const secret of secretValues) message = message.split(secret).join('[已隐藏]')
    message = message.replace(/Bearer\s+\S+/giu, 'Bearer [已隐藏]')
    return result(
      section === 'github' ? 'GitHub Actions' : '连接测试',
      false,
      message.slice(0, 240),
    )
  }
}
