import { decryptText } from './crypto.ts'
import { query } from './db.ts'

export type PlatformMutationScope = 'config' | 'maintenance' | 'organizations' | 'users'

export function isPlatformMutationScope(value: string): value is PlatformMutationScope {
  return value === 'config' || value === 'maintenance' || value === 'organizations' || value === 'users'
}

export async function getPlatformMutationReceipt(
  actorUserId: number,
  scope: PlatformMutationScope,
  requestId: string,
) {
  if (scope === 'config') {
    const result = await query<{
      action: string
      created_at: Date
      result_revision: string | null
    }>(
      `select action, result_revision, created_at
         from platform_config_mutation_receipts
        where actor_user_id = $1 and request_id = $2::uuid`,
      [actorUserId, requestId],
    )
    const row = result.rows[0]
    return row ? {
      action: row.action,
      createdAt: row.created_at.toISOString(),
      found: true as const,
      result: {
        changed: !row.action.startsWith('noop:'),
        revision: row.result_revision ? Number(row.result_revision) : null,
      },
      scope,
    } : { found: false as const, scope }
  }

  if (scope === 'users') {
    const result = await query<{
      action: string
      created_at: Date
      result_encrypted: string | null
      result_revision: string
      target_user_id: string
    }>(
      `select action, target_user_id, result_revision, result_encrypted, created_at
         from platform_user_mutation_receipts
        where actor_user_id = $1 and request_id = $2::uuid`,
      [actorUserId, requestId],
    )
    const row = result.rows[0]
    return row ? {
      action: row.action,
      createdAt: row.created_at.toISOString(),
      found: true as const,
      result: row.result_encrypted
        ? JSON.parse(decryptText(row.result_encrypted)) as unknown
        : { targetUserId: Number(row.target_user_id), version: Number(row.result_revision) },
      scope,
    } : { found: false as const, scope }
  }

  if (scope === 'maintenance') {
    const result = await query<{
      created_at: Date
      result_changed: boolean
      result_enabled: boolean
      result_revision: string
    }>(
      `select result_enabled, result_revision, result_changed, created_at
         from platform_operational_mutation_receipts
        where actor_user_id = $1 and request_id = $2::uuid`,
      [actorUserId, requestId],
    )
    const row = result.rows[0]
    return row ? {
      action: 'maintenance',
      createdAt: row.created_at.toISOString(),
      found: true as const,
      result: {
        changed: row.result_changed,
        enabled: row.result_enabled,
        replayed: true,
        revision: Number(row.result_revision),
      },
      scope,
    } : { found: false as const, scope }
  }

  const result = await query<{
    action: string
    created_at: Date
    result_encrypted: string
  }>(
    `select action, result_encrypted, created_at
       from platform_organization_mutation_receipts
      where actor_user_id = $1 and request_id = $2::uuid`,
    [actorUserId, requestId],
  )
  const row = result.rows[0]
  return row ? {
    action: row.action,
    createdAt: row.created_at.toISOString(),
    found: true as const,
    result: JSON.parse(decryptText(row.result_encrypted)) as unknown,
    scope,
  } : { found: false as const, scope }
}
