export class FeishuUserNameError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 502) {
    super(message)
    this.name = 'FeishuUserNameError'
    this.code = code
    this.status = status
  }
}

export function normalizeFeishuUserName(value: unknown) {
  return String(value ?? '').trim().slice(0, 32)
}

export async function fetchFeishuUserName(input: {
  fetchImpl?: typeof fetch
  openId: string
  signal?: AbortSignal
  token: string
}) {
  if (!input.openId.startsWith('ou_')) {
    throw new FeishuUserNameError('FEISHU_ACCOUNT_NOT_LINKED', '该账号尚未绑定飞书。', 409)
  }
  const fetchImpl = input.fetchImpl ?? fetch
  let result: Response
  try {
    result = await fetchImpl(
      `https://open.feishu.cn/open-apis/contact/v3/users/${encodeURIComponent(input.openId)}?user_id_type=open_id`,
      {
        headers: { Authorization: `Bearer ${input.token}` },
        signal: input.signal,
      },
    )
  } catch {
    throw new FeishuUserNameError('FEISHU_NAME_SYNC_UNAVAILABLE', '飞书姓名同步暂时不可用，请稍后重试。')
  }

  let data: {
    code?: number
    data?: {
      user?: {
        en_name?: unknown
        name?: unknown
        nickname?: unknown
        open_id?: unknown
      }
    }
    msg?: string
  }
  try {
    data = await result.json() as typeof data
  } catch {
    throw new FeishuUserNameError('FEISHU_NAME_SYNC_UNAVAILABLE', '飞书姓名同步返回了无效响应。')
  }
  if (!result.ok || data.code !== 0) {
    throw new FeishuUserNameError(
      'FEISHU_NAME_SYNC_FAILED',
      '无法读取飞书姓名，请检查应用通讯录权限和可用范围。',
    )
  }
  const returnedOpenId = String(data.data?.user?.open_id ?? '').trim()
  if (returnedOpenId && returnedOpenId !== input.openId) {
    throw new FeishuUserNameError('FEISHU_IDENTITY_MISMATCH', '飞书返回的用户身份与当前绑定不一致。', 409)
  }
  const displayName = normalizeFeishuUserName(
    data.data?.user?.name ?? data.data?.user?.nickname ?? data.data?.user?.en_name,
  )
  if (!displayName) {
    throw new FeishuUserNameError('FEISHU_NAME_EMPTY', '飞书没有返回可用的姓名。', 422)
  }
  return displayName
}
