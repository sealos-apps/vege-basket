import type { PoolClient } from 'pg'
import {
  blindIndex,
  decryptText,
  encryptText,
  isEncryptedText,
} from './crypto.ts'

/** The caller owns the transaction. Validate every sibling group before writing. */
export async function backfillCaseDirectoryEncryption(client: PoolClient) {
  await client.query('select id from test_spaces order by id for update')
  await client.query('select id from test_subjects order by id for update')
  const result = await client.query<{
    id: string
    test_subject_id: string
    parent_id: string | null
    name: string
    name_lookup: string | null
  }>(
    'select id, test_subject_id, parent_id, name, name_lookup from test_case_folders order by id for update',
  )
  const seen = new Set<string>()
  const updates = result.rows.map((row) => {
    const name = decryptText(row.name).trim()
    const key = JSON.stringify([
      row.test_subject_id,
      row.parent_id,
      name.toLowerCase(),
    ])
    if (seen.has(key))
      throw new Error(
        'Duplicate sibling directory names found; resolve them before backfill',
      )
    seen.add(key)
    return { row, lookup: blindIndex(name) }
  })
  for (const { row, lookup } of updates) {
    if (isEncryptedText(row.name) && row.name_lookup === lookup) continue
    await client.query(
      'update test_case_folders set name = $1, name_lookup = $2 where id = $3',
      [
        isEncryptedText(row.name) ? row.name : encryptText(row.name),
        lookup,
        Number(row.id),
      ],
    )
  }
}
