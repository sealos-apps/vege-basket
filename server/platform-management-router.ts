import { Router, type Response } from 'express'
import { isPlatformSecretField, isPlatformConfigSection } from '../shared/platform-config.ts'
import { validatePackageRulesYaml } from './package-rules-validator.ts'
import { listPlatformAdmins, setManagedPlatformAdmin, updateManagedUserPermissions } from './platform-admins.ts'
import {
  getCurrentPlatformConfig,
  getPlatformConfigHistory,
  getPlatformConfigHistoryDetail,
  PlatformConfigStoreError,
  recordPlatformSecretRevealFailure,
  restorePlatformConfig,
  revealCurrentPlatformSecret,
  savePlatformConfigSection,
} from './platform-config-store.ts'
import { listPlatformRuntimeStatus, refreshPlatformConfig } from './platform-config-runtime.ts'
import { createDefaultPlatformConfig, maskPlatformConfig } from './platform-config-schema.ts'
import { mergePlatformConfigSection } from './platform-config-schema.ts'
import { testPlatformConfigSection } from './platform-config-tests.ts'
import { isUserRole, requirePlatformAdminSession, type UserRole } from './roles.ts'
import {
  checkPlatformOrganizationDeletion,
  createPlatformOrganization,
  deletePlatformOrganization,
  listPlatformOrganizations,
} from './platform-organizations.ts'
import { PlatformConfigTransitionError } from './platform-config-transition.ts'
import { getPlatformSecurityStatus } from './platform-security.ts'
import { getPlatformMutationReceipt, isPlatformMutationScope } from './platform-mutation-receipts.ts'
import { createAiConcurrencyLimiter, createAiRateLimiter } from './ai-rate-limit.ts'
import {
  getPublicPlatformStatus,
  isMaintenanceRequestId,
  listApplicationMigrations,
  listPlatformMaintenanceHistory,
  updatePlatformMaintenance,
} from './platform-maintenance.ts'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const platformTestRateLimiter = createAiRateLimiter({ globalLimit: 30, perUserLimit: 10, windowMs: 60_000 })
const platformTestConcurrencyLimiter = createAiConcurrencyLimiter({ globalLimit: 4, perUserLimit: 1 })

function positiveInteger(value: unknown) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function nonNegativeInteger(value: unknown) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function sendPlatformError(response: Response, error: unknown) {
  if (error instanceof PlatformConfigStoreError) {
    response.status(error.status).json({ error: error.message, code: error.code })
    return true
  }
  if (error instanceof PlatformConfigTransitionError) {
    response.status(error.status).json({ error: error.message, code: error.code })
    return true
  }
  if (error && typeof error === 'object' && 'status' in error && 'code' in error) {
    response.status(Number((error as { status: unknown }).status)).json({
      error: error instanceof Error ? error.message : '平台管理操作失败。',
      code: String((error as { code: unknown }).code),
      ...('blockers' in error ? { blockers: (error as { blockers?: unknown }).blockers } : {}),
    })
    return true
  }
  return false
}

export const platformManagementRouter = Router()

platformManagementRouter.get('/platform-status', (_request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.json(getPublicPlatformStatus())
})

platformManagementRouter.get('/platform-info', async (request, response, next) => {
  void request
  try {
    const current = await getCurrentPlatformConfig()
    response.json({
      displayName: current?.config.general.displayName ?? 'Veges',
      loginMethods: ['password', 'feishu'],
    })
  } catch (error) {
    next(error)
  }
})

platformManagementRouter.get('/admin/platform-config', async (request, response, next) => {
  try {
    if (!(await requirePlatformAdminSession(request, response))) return
    const current = await getCurrentPlatformConfig()
    response.setHeader('Cache-Control', 'no-store')
    response.json({
      config: maskPlatformConfig(current?.config ?? createDefaultPlatformConfig()),
      initialized: Boolean(current),
      revision: current?.revision ?? 0,
    })
  } catch (error) {
    next(error)
  }
})

platformManagementRouter.put('/admin/platform-config/:section', async (request, response, next) => {
  try {
    const session = await requirePlatformAdminSession(request, response)
    if (!session) return
    const section = request.params.section
    const expectedRevision = nonNegativeInteger(request.body?.expectedRevision)
    const requestId = String(request.body?.requestId ?? '')
    if (!isPlatformConfigSection(section) || expectedRevision === null || !uuidPattern.test(requestId)) {
      response.status(400).json({ error: '配置分区、版本或请求编号无效。' })
      return
    }
    if (section === 'packages') {
      const rulesYaml = request.body?.fields?.rulesYaml
      if (typeof rulesYaml !== 'string') {
        response.status(422).json({ error: '包市场规则必须是 YAML 文本。', code: 'PACKAGE_RULES_INVALID' })
        return
      }
      const validation = validatePackageRulesYaml(rulesYaml)
      if (!validation.valid) {
        response.status(422).json({ error: '包市场规则校验失败。', code: 'PACKAGE_RULES_INVALID', validation })
        return
      }
    }
    const result = await savePlatformConfigSection({
      actorUserId: session.userId,
      expectedRevision,
      fields: request.body?.fields ?? {},
      requestId,
      secretActions: request.body?.secrets ?? {},
      section,
    })
    if (result.changed) void refreshPlatformConfig(true).catch(() => undefined)
    response.json(result)
  } catch (error) {
    if (!sendPlatformError(response, error)) next(error)
  }
})

platformManagementRouter.post(
  '/admin/platform-config/:section/secrets/:field/reveal',
  async (request, response, next) => {
    const session = await requirePlatformAdminSession(request, response)
    if (!session) return
    const fullField = `${request.params.section}.${request.params.field}`
    try {
      const expectedRevision = positiveInteger(request.body?.expectedRevision)
      if (!isPlatformSecretField(fullField) || expectedRevision === null) {
        response.status(403).json({ error: '该字段不允许查看。', code: 'SECRET_FIELD_NOT_REVEALABLE' })
        return
      }
      const result = await revealCurrentPlatformSecret({
        actorUserId: session.userId,
        expectedRevision,
        field: fullField,
      })
      response.setHeader('Cache-Control', 'no-store')
      response.json(result)
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : 'SECRET_REVEAL_FAILED'
      await recordPlatformSecretRevealFailure(session.userId, fullField, code).catch(() => undefined)
      if (!sendPlatformError(response, error)) next(error)
    }
  },
)

platformManagementRouter.post('/admin/platform-config/packages/validate', async (request, response) => {
  if (!(await requirePlatformAdminSession(request, response))) return
  const source = typeof request.body?.rulesYaml === 'string' ? request.body.rulesYaml : ''
  response.json(validatePackageRulesYaml(source))
})

platformManagementRouter.post('/admin/platform-config/:section/test', async (request, response, next) => {
  let releaseTest: (() => void) | null = null
  try {
    const session = await requirePlatformAdminSession(request, response)
    if (!session) return
    const section = request.params.section
    const expectedRevision = nonNegativeInteger(request.body?.expectedRevision)
    if (!isPlatformConfigSection(section) || expectedRevision === null) {
      response.status(400).json({ error: '配置分区或版本无效。' })
      return
    }
    const current = await getCurrentPlatformConfig()
    const revision = current?.revision ?? 0
    if (revision !== expectedRevision) {
      response.status(409).json({ error: '平台配置已更新，请刷新后重试。', code: 'PLATFORM_CONFIG_VERSION_CONFLICT' })
      return
    }
    const candidate = mergePlatformConfigSection(
      current?.config ?? createDefaultPlatformConfig(),
      section,
      request.body?.fields ?? {},
      request.body?.secrets ?? {},
    )
    if (!platformTestRateLimiter.allow(session.userId)) {
      response.status(429).json({ error: '连接测试过于频繁，请稍后再试。', code: 'PLATFORM_TEST_RATE_LIMITED' })
      return
    }
    releaseTest = platformTestConcurrencyLimiter.acquire(session.userId)
    if (!releaseTest) {
      response.status(429).json({ error: '已有连接测试正在运行，请稍后再试。', code: 'PLATFORM_TEST_BUSY' })
      return
    }
    response.setHeader('Cache-Control', 'no-store')
    response.json(await testPlatformConfigSection(candidate, section, {
      action: request.body?.action,
      recipient: request.body?.recipient,
    }))
  } catch (error) {
    if (!sendPlatformError(response, error)) next(error)
  } finally {
    releaseTest?.()
  }
})

platformManagementRouter.get('/admin/platform-config/history', async (request, response, next) => {
  try {
    if (!(await requirePlatformAdminSession(request, response))) return
    response.setHeader('Cache-Control', 'no-store')
    response.json({ history: await getPlatformConfigHistory(Number(request.query.limit ?? 50)) })
  } catch (error) {
    next(error)
  }
})

platformManagementRouter.get('/admin/platform-config/history/:revision', async (request, response, next) => {
  try {
    if (!(await requirePlatformAdminSession(request, response))) return
    const revision = positiveInteger(request.params.revision)
    if (revision === null) {
      response.status(400).json({ error: '配置版本无效。' })
      return
    }
    const detail = await getPlatformConfigHistoryDetail(revision)
    if (!detail) {
      response.status(404).json({ error: '配置版本不存在。' })
      return
    }
    response.setHeader('Cache-Control', 'no-store')
    response.json(detail)
  } catch (error) {
    if (!sendPlatformError(response, error)) next(error)
  }
})

platformManagementRouter.post('/admin/platform-config/restore', async (request, response, next) => {
  try {
    const session = await requirePlatformAdminSession(request, response)
    if (!session) return
    const expectedRevision = positiveInteger(request.body?.expectedRevision)
    const targetRevision = positiveInteger(request.body?.targetRevision)
    const requestId = String(request.body?.requestId ?? '')
    if (expectedRevision === null || targetRevision === null || !uuidPattern.test(requestId)) {
      response.status(400).json({ error: '配置版本或请求编号无效。' })
      return
    }
    const result = await restorePlatformConfig({
      actorUserId: session.userId,
      expectedRevision,
      requestId,
      targetRevision,
    })
    if (result.changed) void refreshPlatformConfig(true).catch(() => undefined)
    response.json(result)
  } catch (error) {
    if (!sendPlatformError(response, error)) next(error)
  }
})

platformManagementRouter.get('/admin/platform-config/runtime', async (request, response, next) => {
  try {
    if (!(await requirePlatformAdminSession(request, response))) return
    response.json(await listPlatformRuntimeStatus())
  } catch (error) {
    next(error)
  }
})

platformManagementRouter.get('/admin/platform-maintenance', async (request, response, next) => {
  try {
    if (!(await requirePlatformAdminSession(request, response))) return
    response.setHeader('Cache-Control', 'no-store')
    response.json(getPublicPlatformStatus())
  } catch (error) {
    next(error)
  }
})

platformManagementRouter.get('/admin/platform-maintenance/history', async (request, response, next) => {
  try {
    if (!(await requirePlatformAdminSession(request, response))) return
    const beforeId = request.query.beforeId === undefined
      ? undefined
      : positiveInteger(request.query.beforeId)
    const limit = request.query.limit === undefined ? 20 : positiveInteger(request.query.limit)
    if (beforeId === null || limit === null) {
      response.status(400).json({ error: '维护记录分页参数无效。' })
      return
    }
    response.setHeader('Cache-Control', 'no-store')
    response.json(await listPlatformMaintenanceHistory({ beforeId, limit: Math.min(limit, 100) }))
  } catch (error) {
    next(error)
  }
})

platformManagementRouter.put('/admin/platform-maintenance', async (request, response, next) => {
  try {
    const session = await requirePlatformAdminSession(request, response)
    if (!session) return
    const expectedRevision = positiveInteger(request.body?.expectedRevision)
    const requestId = String(request.body?.requestId ?? '')
    if (typeof request.body?.enabled !== 'boolean' || expectedRevision === null || !isMaintenanceRequestId(requestId)) {
      response.status(400).json({ error: '维护状态、版本或请求编号无效。' })
      return
    }
    response.json(await updatePlatformMaintenance({
      actorUserId: session.userId,
      enabled: request.body.enabled,
      expectedRevision,
      message: typeof request.body.message === 'string' ? request.body.message : '',
      requestId,
    }))
  } catch (error) {
    if (!sendPlatformError(response, error)) next(error)
  }
})

platformManagementRouter.get('/admin/platform-migrations', async (request, response, next) => {
  try {
    if (!(await requirePlatformAdminSession(request, response))) return
    response.setHeader('Cache-Control', 'no-store')
    response.json({ migrations: await listApplicationMigrations() })
  } catch (error) {
    next(error)
  }
})

platformManagementRouter.get('/admin/platform-security', async (request, response, next) => {
  try {
    if (!(await requirePlatformAdminSession(request, response))) return
    response.setHeader('Cache-Control', 'no-store')
    response.json(await getPlatformSecurityStatus())
  } catch (error) {
    next(error)
  }
})

platformManagementRouter.get('/admin/platform-mutations/:scope/:requestId', async (request, response, next) => {
  try {
    const session = await requirePlatformAdminSession(request, response)
    if (!session) return
    const scope = request.params.scope
    const requestId = request.params.requestId
    if (!isPlatformMutationScope(scope) || !uuidPattern.test(requestId)) {
      response.status(400).json({ error: '操作范围或请求编号无效。' })
      return
    }
    response.setHeader('Cache-Control', 'no-store')
    response.json(await getPlatformMutationReceipt(session.userId, scope, requestId))
  } catch (error) {
    next(error)
  }
})

platformManagementRouter.get('/admin/platform-admins', async (request, response, next) => {
  try {
    if (!(await requirePlatformAdminSession(request, response))) return
    response.json({ admins: await listPlatformAdmins() })
  } catch (error) {
    next(error)
  }
})

platformManagementRouter.patch('/admin/users/:userId/permissions', async (request, response, next) => {
  try {
    const session = await requirePlatformAdminSession(request, response)
    if (!session) return
    const targetUserId = positiveInteger(request.params.userId)
    const expectedVersion = nonNegativeInteger(request.body?.expectedVersion)
    const requestId = String(request.body?.requestId ?? '')
    const roles: UserRole[] = Array.isArray(request.body?.roles)
      ? Array.from(new Set((request.body.roles as unknown[]).filter(isUserRole)))
      : []
    if (
      targetUserId === null || expectedVersion === null || !uuidPattern.test(requestId) ||
      roles.length === 0 || typeof request.body?.platformAdmin !== 'boolean'
    ) {
      response.status(400).json({ error: '用户权限、权限版本或请求编号无效。' })
      return
    }
    response.json(await updateManagedUserPermissions({
      actorUserId: session.userId,
      expectedVersion,
      platformAdmin: request.body.platformAdmin,
      requestId,
      roles,
      targetUserId,
    }))
  } catch (error) {
    if (!sendPlatformError(response, error)) next(error)
  }
})

platformManagementRouter.post('/admin/platform-admins', async (request, response, next) => {
  try {
    const session = await requirePlatformAdminSession(request, response)
    if (!session) return
    const targetUserId = positiveInteger(request.body?.userId)
    const expectedVersion = nonNegativeInteger(request.body?.expectedVersion)
    const requestId = String(request.body?.requestId ?? '')
    if (targetUserId === null || expectedVersion === null || !uuidPattern.test(requestId)) {
      response.status(400).json({ error: '用户、权限版本或请求编号无效。' })
      return
    }
    response.json(await setManagedPlatformAdmin({
      actorUserId: session.userId,
      enabled: true,
      expectedVersion,
      requestId,
      targetUserId,
    }))
  } catch (error) {
    if (!sendPlatformError(response, error)) next(error)
  }
})

platformManagementRouter.delete('/admin/platform-admins/:userId', async (request, response, next) => {
  try {
    const session = await requirePlatformAdminSession(request, response)
    if (!session) return
    const targetUserId = positiveInteger(request.params.userId)
    const expectedVersion = nonNegativeInteger(request.body?.expectedVersion)
    const requestId = String(request.body?.requestId ?? '')
    if (targetUserId === null || expectedVersion === null || !uuidPattern.test(requestId)) {
      response.status(400).json({ error: '用户、权限版本或请求编号无效。' })
      return
    }
    response.json(await setManagedPlatformAdmin({
      actorUserId: session.userId,
      enabled: false,
      expectedVersion,
      requestId,
      targetUserId,
    }))
  } catch (error) {
    if (!sendPlatformError(response, error)) next(error)
  }
})

platformManagementRouter.get('/admin/organizations', async (request, response, next) => {
  try {
    if (!(await requirePlatformAdminSession(request, response))) return
    const page = positiveInteger(request.query.page) ?? 1
    const pageSize = Math.min(positiveInteger(request.query.pageSize) ?? 20, 100)
    response.json(await listPlatformOrganizations({
      page,
      pageSize,
      search: String(request.query.search ?? '').slice(0, 120),
    }))
  } catch (error) {
    if (!sendPlatformError(response, error)) next(error)
  }
})

platformManagementRouter.post('/admin/organizations', async (request, response, next) => {
  try {
    const session = await requirePlatformAdminSession(request, response)
    if (!session) return
    const ownerUserId = positiveInteger(request.body?.ownerUserId)
    const requestId = String(request.body?.requestId ?? '')
    if (ownerUserId === null || !uuidPattern.test(requestId)) {
      response.status(400).json({ error: '组织所有者或请求编号无效。' })
      return
    }
    const organization = await createPlatformOrganization({
      actorUserId: session.userId,
      name: request.body?.name,
      ownerUserId,
      requestId,
    })
    response.status(201).json(organization)
  } catch (error) {
    if (!sendPlatformError(response, error)) next(error)
  }
})

platformManagementRouter.get('/admin/organizations/:organizationId/deletion-check', async (request, response, next) => {
  try {
    if (!(await requirePlatformAdminSession(request, response))) return
    const organizationId = positiveInteger(request.params.organizationId)
    if (organizationId === null) {
      response.status(400).json({ error: '组织编号无效。' })
      return
    }
    response.json(await checkPlatformOrganizationDeletion(organizationId))
  } catch (error) {
    if (!sendPlatformError(response, error)) next(error)
  }
})

platformManagementRouter.delete('/admin/organizations/:organizationId', async (request, response, next) => {
  try {
    const session = await requirePlatformAdminSession(request, response)
    if (!session) return
    const organizationId = positiveInteger(request.params.organizationId)
    const requestId = String(request.body?.requestId ?? '')
    if (organizationId === null || !uuidPattern.test(requestId)) {
      response.status(400).json({ error: '组织编号或请求编号无效。' })
      return
    }
    response.json(await deletePlatformOrganization({
      actorUserId: session.userId,
      confirmationName: request.body?.confirmationName,
      organizationId,
      requestId,
    }))
  } catch (error) {
    if (!sendPlatformError(response, error)) next(error)
  }
})
