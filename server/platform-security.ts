import { decryptJson, getEncryptionKeyStatus } from './crypto.ts'
import { query } from './db.ts'

type StoredInspectionResult = {
  encryptedFieldCount?: number
  legacyPlaintextCount?: number
  referencedKeyIds?: string[]
  summary?: string
}

export async function getPlatformSecurityStatus() {
  const [inspection, retainedSecrets] = await Promise.all([
    query<{
      created_at: Date
      recorded_by: string | null
      result_encrypted: string
      status: 'failed' | 'passed'
    }>(
      `select inspection.status, inspection.result_encrypted, inspection.created_at,
              coalesce(nullif(users.display_name, ''), users.email) as recorded_by
         from platform_security_inspections inspection
         left join users on users.id = inspection.recorded_by_user_id
        order by inspection.created_at desc, inspection.id desc
        limit 1`,
    ),
    query<{ key_id: string; purpose_count: string }>(
      `select key_id, count(*)::text as purpose_count
         from platform_security_secrets
        where retired_at is null
        group by key_id
        order by key_id`,
    ),
  ])
  const keyStatus = getEncryptionKeyStatus()
  const row = inspection.rows[0]
  const result = row ? decryptJson<StoredInspectionResult>(row.result_encrypted, {}) : null
  return {
    ...keyStatus,
    applicationEncryption: {
      configurationHistory: true,
      sensitiveBusinessText: true,
    },
    lastInspection: row ? {
      createdAt: row.created_at.toISOString(),
      recordedBy: row.recorded_by ?? '系统',
      result,
      status: row.status,
    } : null,
    retainedVerificationSecrets: retainedSecrets.rows.map((item) => ({
      keyId: item.key_id,
      purposeCount: Number(item.purpose_count),
    })),
  }
}
