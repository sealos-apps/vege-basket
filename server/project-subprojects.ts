import type { PoolClient } from 'pg'
import { decryptText, encryptText, keyedDigest } from './crypto.ts'

export class ProjectSubprojectError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, message: string, status = 409) { super(message); this.code = code; this.status = status }
}

export function requireProjectSubprojectName(value: unknown) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name || [...name].length > 40) throw new ProjectSubprojectError('PROJECT_SUBPROJECT_NAME_INVALID', '子项目名称须包含 1–40 个字符。', 400)
  return name
}

export function parseProjectSubprojectId(value: unknown): number | null {
  if (value == null || value === '') return null
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new ProjectSubprojectError('PROJECT_SUBPROJECT_INVALID', '请选择有效的项目子项目。', 400)
  return id
}

export async function projectSubprojectNameLookup(client: Pick<PoolClient, 'query'>, name: string) {
  const result = await client.query<{ lookup_key_id: string }>('select lookup_key_id from project_module_settings where id = 1')
  return keyedDigest(JSON.stringify(['project-subproject-name', name]), result.rows[0]?.lookup_key_id ?? process.env.APP_ENCRYPTION_ACTIVE_KEY_ID ?? 'active')
}

export async function lockProjectSubprojects(client: Pick<PoolClient, 'query'>, projectId: number) {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1::text, 0))', [`ai-project:${projectId}`])
}

export async function listProjectSubprojects(client: Pick<PoolClient, 'query'>, projectId: number) {
  const result = await client.query<{id:string; project_id:string; name:string; created_at:Date; updated_at:Date; task_count:string}>(
    `select s.id, s.project_id, s.name, s.created_at, s.updated_at,
            count(t.id)::text as task_count
       from project_subprojects s left join todos t on t.subproject_id = s.id
      where s.project_id = $1 group by s.id order by s.created_at, s.id`, [projectId])
  return result.rows.map(row => ({ id: Number(row.id), projectId: Number(row.project_id), name: decryptText(row.name), createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), taskCount: Number(row.task_count) }))
}

export async function resolveProjectSubprojectId(client: Pick<PoolClient, 'query'>, projectId: number, value: unknown) {
  const id = parseProjectSubprojectId(value)
  if (id === null) return null
  const result = await client.query('select 1 from project_subprojects where id = $1 and project_id = $2', [id, projectId])
  if (!result.rows[0]) throw new ProjectSubprojectError('PROJECT_SUBPROJECT_INVALID', '子项目不属于当前项目，请重新选择。', 400)
  return id
}

export async function createProjectSubproject(client: Pick<PoolClient, 'query'>, projectId: number, name: string) {
  const result = await client.query(`insert into project_subprojects (project_id, name, name_lookup) values ($1, $2, $3) on conflict (project_id, name_lookup) do nothing returning id`, [projectId, encryptText(name), await projectSubprojectNameLookup(client, name)])
  if (!result.rows[0]) throw new ProjectSubprojectError('PROJECT_SUBPROJECT_NAME_CONFLICT', '此子项目已存在。')
  return Number(result.rows[0].id)
}
