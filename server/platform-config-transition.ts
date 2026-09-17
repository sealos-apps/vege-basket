import type { PoolClient } from 'pg'
import type { PlatformConfig } from './platform-config-schema.ts'

export class PlatformConfigTransitionError extends Error {
  readonly code: string
  readonly status = 409

  constructor(code: string, message: string) {
    super(message)
    this.name = 'PlatformConfigTransitionError'
    this.code = code
  }
}

export function changesConfiguredStorageLocation(current: PlatformConfig, next: PlatformConfig) {
  const locationConfigured = Boolean(current.storage.endpoint && current.storage.bucket)
  return locationConfigured && (
    current.storage.endpoint !== next.storage.endpoint ||
    current.storage.bucket !== next.storage.bucket ||
    current.storage.objectPrefix !== next.storage.objectPrefix
  )
}

export function changesConfiguredFeishuApp(current: PlatformConfig, next: PlatformConfig) {
  return Boolean(current.feishu.appId) && current.feishu.appId !== next.feishu.appId
}

export async function assertPlatformConfigTransitionAllowed(
  client: PoolClient,
  current: PlatformConfig,
  next: PlatformConfig,
) {
  if (changesConfiguredStorageLocation(current, next)) {
    const usage = await client.query<{ used: boolean }>(
      `select (
         exists(select 1 from platform_storage_usage where singleton = true)
         or exists(select 1 from project_package_items where object_key <> '')
         or exists(select 1 from test_bug_verification_packages where object_key <> '')
         or exists(select 1 from image_sync_workflow_runs where status = 'completed')
       ) as used`,
    )
    if (usage.rows[0]?.used) {
      throw new PlatformConfigTransitionError(
        'STORAGE_MIGRATION_REQUIRED',
        '对象存储地址、存储桶或对象前缀已投入使用，修改前必须完成专门的数据迁移。',
      )
    }
  }

  if (!changesConfiguredFeishuApp(current, next)) return
  const usage = await client.query<{ used: boolean }>(
    `select (
       exists(select 1 from users where feishu_user_id <> '')
       or exists(select 1 from feishu_ai_messages where status in ('pending', 'processing'))
       or exists(select 1 from notification_digest_runs where status in ('pending', 'processing', 'retry'))
       or exists(select 1 from notification_deliveries where channel = 'feishu' and status = 'pending')
     ) as used`,
  )
  if (usage.rows[0]?.used) {
    throw new PlatformConfigTransitionError(
      'FEISHU_APP_MIGRATION_REQUIRED',
      '已有飞书身份绑定或待处理任务，修改应用 ID 前必须完成专门的数据迁移。',
    )
  }
}
