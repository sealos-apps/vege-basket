import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import { parse as parseDotenv } from 'dotenv'
import { validatePackageRulesYaml } from './package-rules-validator.ts'
import { parseLegacyPlatformConfig } from './platform-legacy-config.ts'
import { createDefaultPlatformConfig, platformConfigSchemaVersion } from './platform-config-schema.ts'
import { normalizePlatformPublicOrigin } from '../shared/platform-callback-urls.ts'

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))

function option(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? String(process.argv[index + 1] ?? '').trim() : ''
}

function commandName() {
  return process.argv[2] ?? ''
}

function readEnvironmentFile() {
  const filename = option('--env-file')
  if (!filename) throw new Error('需要通过 --env-file 明确指定旧配置文件。')
  const resolved = path.resolve(filename)
  const source = fs.readFileSync(resolved, 'utf8')
  return { env: parseDotenv(source), filename: resolved }
}

function applyStartupEnvironment(env: Record<string, string>) {
  for (const key of [
    'DATABASE_URL',
    'APP_ENCRYPTION_KEYS',
    'APP_ENCRYPTION_ACTIVE_KEY_ID',
    'DB_POOL_MAX',
    'DB_POOL_CONNECTION_TIMEOUT_MS',
    'DB_POOL_IDLE_TIMEOUT_MS',
  ]) {
    if (!process.env[key] && key in env) process.env[key] = env[key]
  }
}

function loadRules(env: Record<string, string>, envFilename: string) {
  const configured = env.PACKAGE_MARKET_RULES_FILE || env.TRIAL_COMBO_PACKAGE_RULES_FILE
  const filename = configured
    ? path.resolve(path.dirname(envFilename), configured)
    : path.join(serverDirectory, 'trial-combo-package-rules.yaml')
  return { filename, source: fs.readFileSync(filename, 'utf8') }
}

function validatePublicUrl(value: string) {
  const origin = normalizePlatformPublicOrigin(value)
  if (!origin) throw new Error('--public-url 必须是无账号、路径、查询参数和片段的 HTTPS 地址；本地开发可使用回环 HTTP 地址。')
  return origin
}

async function readHiddenLine(prompt: string) {
  if (!process.stdin.isTTY) throw new Error('该命令需要交互式终端输入密码。')
  process.stderr.write(prompt)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  let value = ''
  try {
    return await new Promise<string>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        for (const byte of chunk) {
          if (byte === 3) {
            process.stdin.off('data', onData)
            reject(new Error('操作已取消。'))
            return
          }
          if (byte === 13 || byte === 10) {
            process.stdin.off('data', onData)
            process.stderr.write('\n')
            resolve(value)
            return
          }
          if (byte === 127 || byte === 8) value = value.slice(0, -1)
          else if (byte >= 32) value += String.fromCharCode(byte)
        }
      }
      process.stdin.on('data', onData)
    })
  } finally {
    process.stdin.setRawMode(false)
    process.stdin.pause()
  }
}

async function inspect() {
  const { env, filename } = readEnvironmentFile()
  const rules = loadRules(env, filename)
  const imported = parseLegacyPlatformConfig(env, rules.source)
  const validation = validatePackageRulesYaml(rules.source)
  console.log(JSON.stringify({
    adminAccounts: imported.adminUsernames,
    businessKeys: Object.keys(env).filter((key) => ![
      'DATABASE_URL', 'APP_ENCRYPTION_KEYS', 'APP_ENCRYPTION_ACTIVE_KEY_ID',
    ].includes(key)).sort(),
    ignoredUnimplementedKeys: imported.ignoredUnimplementedKeys,
    packageRules: {
      filename: rules.filename,
      ruleCount: validation.ruleCount,
      valid: validation.valid,
      errors: validation.errors,
    },
    unknownKeys: imported.unknownKeys,
  }, null, 2))
  if (!validation.valid) process.exitCode = 1
}

async function verify() {
  const { env, filename } = readEnvironmentFile()
  applyStartupEnvironment(env)
  const rules = loadRules(env, filename)
  const imported = parseLegacyPlatformConfig(env, rules.source)
  const { pool } = await import('./db.ts')
  try {
    const client = await pool.connect()
    try {
      await client.query('begin read only')
      const tables = await client.query<{ schema_exists: boolean; platform_exists: boolean }>(
        `select to_regclass('public.users') is not null as schema_exists,
                to_regclass('public.platform_config_versions') is not null as platform_exists`,
      )
      if (!tables.rows[0]?.schema_exists) throw new Error('users 表不存在，请先审核并执行 db:init。')
      const admins = imported.adminUsernames.length > 0
        ? await client.query<{ account_status: string; email: string }>(
            `select email, account_status from users where lower(btrim(email)) = any($1::text[])`,
            [imported.adminUsernames],
          )
        : { rows: [] }
      const found = new Map(admins.rows.map((row) => [row.email.trim().toLowerCase(), row.account_status]))
      const unresolvedAdmins = imported.adminUsernames.filter((username) =>
        username !== 'admin' && found.get(username) !== 'active')
      await client.query('rollback')
      console.log(JSON.stringify({
        platformSchemaPresent: tables.rows[0].platform_exists,
        unresolvedAdminAccounts: unresolvedAdmins,
      }, null, 2))
      if (unresolvedAdmins.length > 0) process.exitCode = 1
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
  }
}

async function bootstrapAdmin(recover = false) {
  const { env } = readEnvironmentFile()
  applyStartupEnvironment(env)
  const [{ pool }, { assertEncryptionConfigured }] = await Promise.all([
    import('./db.ts'),
    import('./crypto.ts'),
  ])
  assertEncryptionConfigured()
  try {
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query(
        'select pg_advisory_xact_lock(hashtextextended($1::text, 0))',
        ['veges:platform-administration'],
      )
      const users = await client.query<{
        account_status: string
        grant_kind: 'builtin' | 'managed' | null
        id: string
        is_builtin_admin: boolean
        password_hash: string
      }>(
        `select users.id, users.password_hash, users.account_status, users.is_builtin_admin,
                grant_row.grant_kind
           from users
           left join platform_admin_grants grant_row on grant_row.user_id = users.id
          where lower(btrim(users.email)) = 'admin'
          for update of users`,
      )
      if (users.rows.length > 1) throw new Error('存在多个规范化为 admin 的账号，必须先人工解决。')
      const existing = users.rows[0]
      if (existing?.is_builtin_admin && !recover) {
        if (
          existing.account_status !== 'active' || !existing.password_hash ||
          existing.grant_kind !== 'builtin'
        ) {
          throw new Error('现有内置 admin 状态、密码或授权无效，请显式运行 recover-admin。')
        }
        await client.query('commit')
        console.log('内置 admin 已初始化。')
        return
      }
      if (existing && !recover && (existing.account_status !== 'active' || !existing.password_hash)) {
        throw new Error('现有 admin 状态或密码无效，请显式运行 recover-admin。')
      }
      let passwordHash = existing?.password_hash ?? ''
      if (!existing || recover || !passwordHash) {
        const password = await readHiddenLine('请输入 admin 密码：')
        const confirmation = await readHiddenLine('请再次输入 admin 密码：')
        if (password.length < 12 || password !== confirmation) {
          throw new Error('密码必须至少 12 位且两次输入一致。')
        }
        passwordHash = await bcrypt.hash(password, 12)
      }
      const userId = existing
        ? Number(existing.id)
        : Number((await client.query<{ id: string }>(
            `insert into users
              (email, display_name, password_hash, account_status, is_builtin_admin, registration_source)
             values ('admin', 'admin', $1, 'active', true, 'builtin') returning id`,
            [passwordHash],
          )).rows[0].id)
      await client.query(
        `update users set email = 'admin', password_hash = $1, account_status = 'active',
                disabled_at = null, disabled_by_user_id = null,
                departed_at = null, departed_by_user_id = null,
                registration_source = 'builtin', is_builtin_admin = true
          where id = $2`,
        [passwordHash, userId],
      )
      await client.query(
        `insert into platform_admin_grants (user_id, grant_kind, source)
         values ($1, 'builtin', $2)
         on conflict (user_id) do nothing`,
        [userId, recover ? 'maintenance' : 'bootstrap'],
      )
      await client.query(
        `insert into platform_user_permission_versions (user_id, revision)
         values ($1, 1) on conflict (user_id) do nothing`,
        [userId],
      )
      await client.query(
        `insert into platform_bootstrap_receipts (step, source)
         values ('builtin_admin', $1)
         on conflict (step) do update set source = excluded.source, completed_at = now()`,
        [recover ? 'maintenance' : 'bootstrap'],
      )
      await client.query('commit')
      console.log(recover ? '内置 admin 登录能力已恢复。' : '内置 admin 已初始化。')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
  }
}

async function initializeFreshInstall() {
  const publicUrl = validatePublicUrl(option('--public-url'))
  const password = String(process.env.VEGES_BOOTSTRAP_ADMIN_PASSWORD ?? '')
  const rulesSource = fs.readFileSync(path.join(serverDirectory, 'trial-combo-package-rules.yaml'), 'utf8')
  const validation = validatePackageRulesYaml(rulesSource)
  if (!validation.valid) throw new Error(`内置包市场规则无效：${validation.errors[0]?.message ?? '未知错误'}`)
  const [{ pool }, { assertEncryptionConfigured, encryptText }] = await Promise.all([
    import('./db.ts'),
    import('./crypto.ts'),
  ])
  assertEncryptionConfigured()
  try {
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query(
        'select pg_advisory_xact_lock(hashtextextended($1::text, 0))',
        ['veges:platform-administration'],
      )
      const state = await client.query<{ active_revision: string | null }>(
        'select active_revision from platform_config_state where singleton = true for update',
      )
      const builtin = await client.query<{ id: string }>(
        `select users.id from users
          join platform_admin_grants grant_row on grant_row.user_id = users.id
         where users.is_builtin_admin and lower(btrim(users.email)) = 'admin'
           and users.account_status = 'active' and users.password_hash <> ''
           and grant_row.grant_kind = 'builtin'
         for update of users`,
      )
      if (state.rows[0]?.active_revision) {
        if (builtin.rows.length !== 1) {
          throw new Error('平台已经初始化，但内置 admin 不完整；请按恢复流程处理。')
        }
        await client.query('commit')
        console.log('平台已经初始化，本次未写入。')
        return
      }
      const userCount = Number((await client.query<{ count: string }>('select count(*)::text as count from users')).rows[0].count)
      if (userCount > 0 || builtin.rows.length > 0) {
        throw new Error('检测到未迁移的已有数据；请使用 inspect、verify、bootstrap-admin 和 import 完成升级。')
      }
      if (password.length < 12) throw new Error('VEGES_BOOTSTRAP_ADMIN_PASSWORD 必须至少 12 位。')
      const passwordHash = await bcrypt.hash(password, 12)
      const insertedUser = await client.query<{ id: string }>(
        `insert into users
          (email, display_name, password_hash, account_status, is_builtin_admin, registration_source)
         values ('admin', 'admin', $1, 'active', true, 'builtin') returning id`,
        [passwordHash],
      )
      const userId = Number(insertedUser.rows[0].id)
      await client.query(
        `insert into platform_admin_grants (user_id, grant_kind, source)
         values ($1, 'builtin', 'bootstrap')`,
        [userId],
      )
      await client.query(
        `insert into user_roles (user_id, role) values ($1, 'developer')
         on conflict do nothing`,
        [userId],
      )
      await client.query(
        `insert into platform_user_permission_versions (user_id, revision)
         values ($1, 1)`,
        [userId],
      )
      const config = createDefaultPlatformConfig()
      config.general.publicUrl = publicUrl
      config.packages.rulesYaml = rulesSource
      config.feishu.oauthStateSecret = crypto.randomBytes(32).toString('base64url')
      config.storage.urlSecret = crypto.randomBytes(32).toString('base64url')
      const version = await client.query<{ revision: string }>(
        `insert into platform_config_versions
          (schema_version, payload_encrypted, created_by_user_id, source)
         values ($1, $2, $3, 'bootstrap') returning revision`,
        [platformConfigSchemaVersion, encryptText(JSON.stringify(config)), userId],
      )
      const revision = Number(version.rows[0].revision)
      await client.query(
        `update platform_config_state set active_revision = $1, updated_at = now()
          where singleton = true`,
        [revision],
      )
      await client.query(
        `insert into platform_bootstrap_receipts (step, source)
         values ('builtin_admin', 'bootstrap'), ('fresh_platform_config', 'bootstrap')`,
      )
      await client.query('commit')
      console.log(`平台已初始化，当前配置版本为 ${revision}。`)
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
  }
}

async function importLegacy() {
  const { env, filename } = readEnvironmentFile()
  applyStartupEnvironment(env)
  const rules = loadRules(env, filename)
  const validation = validatePackageRulesYaml(rules.source)
  if (!validation.valid) throw new Error(`包市场规则校验失败：${validation.errors[0]?.message ?? '未知错误'}`)
  const imported = parseLegacyPlatformConfig(env, rules.source)
  const [{ pool }, { encryptText }] = await Promise.all([
    import('./db.ts'),
    import('./crypto.ts'),
  ])
  try {
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query(
        'select pg_advisory_xact_lock(hashtextextended($1::text, 0))',
        ['veges:platform-administration'],
      )
      const completed = await client.query(
        `select step from platform_bootstrap_receipts where step = 'legacy_platform_config_import' for update`,
      )
      if (completed.rows[0]) {
        await client.query('commit')
        console.log('旧平台配置已经导入，本次未写入。')
        return
      }
      const builtin = await client.query<{ id: string }>(
        `select users.id from users
          join platform_admin_grants grant_row on grant_row.user_id = users.id
         where users.is_builtin_admin and grant_row.grant_kind = 'builtin' for update of users`,
      )
      if (!builtin.rows[0]) throw new Error('请先运行 bootstrap-admin。')
      const current = await client.query<{ active_revision: string | null }>(
        'select active_revision from platform_config_state where singleton = true for update',
      )
      if (current.rows[0]?.active_revision) throw new Error('平台配置已经存在，拒绝用旧 env 覆盖。')

      for (const username of imported.adminUsernames) {
        if (username === 'admin') continue
        const target = await client.query<{ id: string }>(
          `select id from users where lower(btrim(email)) = $1 and account_status = 'active'`,
          [username],
        )
        if (!target.rows[0]) throw new Error(`旧超级管理员账号不存在或无效：${username}`)
        await client.query(
          `insert into platform_admin_grants
            (user_id, grant_kind, source, granted_by_user_id)
           values ($1, 'managed', 'env_import', $2)
           on conflict (user_id) do nothing`,
          [Number(target.rows[0].id), Number(builtin.rows[0].id)],
        )
      }
      const version = await client.query<{ revision: string }>(
        `insert into platform_config_versions
          (schema_version, payload_encrypted, created_by_user_id, source)
         values ($1, $2, $3, 'env_import') returning revision`,
        [platformConfigSchemaVersion, encryptText(JSON.stringify(imported.config)), Number(builtin.rows[0].id)],
      )
      const revision = Number(version.rows[0].revision)
      await client.query(
        `update platform_config_state set active_revision = $1, updated_at = now()
          where singleton = true`,
        [revision],
      )
      if (imported.legacyTodoImageUrlSecret) {
        await client.query(
          `insert into platform_security_secrets
            (purpose, key_id, secret_encrypted, legacy_verify_only)
           values ('todo_image_url', 'legacy-env-import', $1, true)`,
          [encryptText(imported.legacyTodoImageUrlSecret)],
        )
      }
      await client.query(
        `insert into platform_bootstrap_receipts (step, source)
         values ('legacy_platform_config_import', 'env_import')`,
      )
      await client.query(`select pg_notify('veges_platform_config', $1)`, [String(revision)])
      await client.query('commit')
      console.log(JSON.stringify({
        ignoredUnimplementedKeys: imported.ignoredUnimplementedKeys,
        importedAdminCount: imported.adminUsernames.filter((value) => value !== 'admin').length,
        revision,
        unknownKeys: imported.unknownKeys,
      }, null, 2))
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
  }
}

async function main() {
  switch (commandName()) {
    case 'inspect': return inspect()
    case 'verify': return verify()
    case 'bootstrap-admin': return bootstrapAdmin(false)
    case 'recover-admin': return bootstrapAdmin(true)
    case 'initialize': return initializeFreshInstall()
    case 'import': return importLegacy()
    default: throw new Error('命令必须是 inspect、verify、bootstrap-admin、recover-admin、initialize 或 import。')
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
