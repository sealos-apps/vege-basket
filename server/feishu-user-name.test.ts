import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FeishuUserNameError,
  fetchFeishuUserName,
  normalizeFeishuUserName,
} from './feishu-user-name.ts'

test('normalizes a Feishu name to the existing display-name contract', () => {
  assert.equal(normalizeFeishuUserName('  Zhang San  '), 'Zhang San')
  assert.equal(normalizeFeishuUserName('a'.repeat(40)), 'a'.repeat(32))
})

test('reads the canonical Feishu name by open ID', async () => {
  const displayName = await fetchFeishuUserName({
    fetchImpl: async (url, init) => {
      assert.equal(
        url,
        'https://open.feishu.cn/open-apis/contact/v3/users/ou_user?user_id_type=open_id',
      )
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer tenant-token')
      return new Response(JSON.stringify({
        code: 0,
        data: { user: { name: '张三', open_id: 'ou_user' } },
      }))
    },
    openId: 'ou_user',
    token: 'tenant-token',
  })
  assert.equal(displayName, '张三')
})

test('rejects unbound users and empty or mismatched Feishu identities', async () => {
  await assert.rejects(
    fetchFeishuUserName({ openId: '', token: 'tenant-token' }),
    (error: unknown) => error instanceof FeishuUserNameError && error.code === 'FEISHU_ACCOUNT_NOT_LINKED',
  )
  await assert.rejects(
    fetchFeishuUserName({
      fetchImpl: async () => new Response(JSON.stringify({
        code: 0,
        data: { user: { name: '张三', open_id: 'ou_other' } },
      })),
      openId: 'ou_user',
      token: 'tenant-token',
    }),
    (error: unknown) => error instanceof FeishuUserNameError && error.code === 'FEISHU_IDENTITY_MISMATCH',
  )
  await assert.rejects(
    fetchFeishuUserName({
      fetchImpl: async () => new Response(JSON.stringify({ code: 0, data: { user: {} } })),
      openId: 'ou_user',
      token: 'tenant-token',
    }),
    (error: unknown) => error instanceof FeishuUserNameError && error.code === 'FEISHU_NAME_EMPTY',
  )
})

test('returns a safe error when Feishu rejects the directory request', async () => {
  await assert.rejects(
    fetchFeishuUserName({
      fetchImpl: async () => new Response(JSON.stringify({ code: 999, msg: 'secret detail' }), { status: 403 }),
      openId: 'ou_user',
      token: 'tenant-token',
    }),
    (error: unknown) => error instanceof FeishuUserNameError &&
      error.code === 'FEISHU_NAME_SYNC_FAILED' && !error.message.includes('secret detail'),
  )
})
