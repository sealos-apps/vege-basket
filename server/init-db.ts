import { pool, query } from './db.ts'
import { assertEncryptionConfigured } from './crypto.ts'
import { initializeProjectModules } from './project-modules.ts'
import { schemaSql } from './schema.ts'

async function main() {
  assertEncryptionConfigured()
  await query(schemaSql)
  await initializeProjectModules(pool)
  console.log('Database schema initialized')
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error)
    await pool.end()
    process.exitCode = 1
  })
