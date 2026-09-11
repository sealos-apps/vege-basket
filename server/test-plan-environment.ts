import type { PoolClient } from 'pg'
import { decryptText, encryptText } from './crypto.ts'

export type PlanEnvironmentSnapshot = {
  environment: string
  environment_access_url: string
  test_environment_id: string | null
}

function invalid(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status })
}

/** Call inside the plan transaction, after locking and authorizing the plan. */
export async function resolvePlanEnvironment(
  client: PoolClient,
  spaceId: number,
  requestedId: unknown,
  current?: PlanEnvironmentSnapshot & { status: string },
): Promise<PlanEnvironmentSnapshot> {
  if (requestedId === undefined && current) return current
  const id = typeof requestedId === 'number' ? requestedId : NaN
  if (!Number.isSafeInteger(id) || id <= 0) {
    invalid('请选择当前测试空间已配置的环境。')
  }
  if (current && Number(current.test_environment_id) === id) return current
  if (current && current.status !== 'draft') {
    invalid('测试计划开始执行后不能更换环境。', 409)
  }
  const result = await client.query<{ id: string; name: string; access_url: string }>(
    `select e.id, e.name, e.access_url
     from test_environment_spaces a
     join test_environments e on e.id = a.test_environment_id
     where a.test_space_id = $1 and e.id = $2
     for share of a, e`,
    [spaceId, id],
  )
  const environment = result.rows[0]
  if (!environment) invalid('所选环境未分配给当前测试空间。')
  return {
    test_environment_id: environment.id,
    environment: encryptText(decryptText(environment.name)),
    environment_access_url: encryptText(decryptText(environment.access_url)),
  }
}
