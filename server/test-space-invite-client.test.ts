import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

// Exercise the actual dialog handler without mounting the unrelated workbench.
const source = ts.createSourceFile('test-workbench.tsx', fs.readFileSync(
  new URL('../src/components/test-workbench.tsx', import.meta.url), 'utf8',
), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const dialog = source.statements.find((node) => ts.isFunctionDeclaration(node)
  && node.name?.text === 'TestSpaceSettingsDialog') as ts.FunctionDeclaration
const handler = dialog.body!.statements.find((node) => ts.isFunctionDeclaration(node)
  && node.name?.text === 'copyInviteLink')!

async function copyAs(isOwner: boolean, canManageMembers: boolean) {
  const requests: unknown[] = []
  const clipboard: string[] = []
  const statuses: string[] = []
  const busy: boolean[] = []
  await vm.runInNewContext(`${handler.getText(source)}\ncopyInviteLink()`, {
    selectedSpace: { id: 42, name: '测试空间' }, isOwner, canManageMembers,
    encryptedInviteShare: false, inviteLinkAccess: 'viewer', inviteExpiresInMinutes: 10,
    setBusy: (value: boolean) => busy.push(value),
    setInviteLinkStatus: (value: string) => statuses.push(value),
    createTestSpaceInviteLink: async (id: number, payload: unknown) => {
      requests.push({ id, payload })
      return { token: 'test-token', expiresInMinutes: 10 }
    },
    buildTestSpaceInviteUrl: (token: string) => `https://example.test/invite/${token}`,
    navigator: { clipboard: { writeText: async (value: string) => clipboard.push(value) } },
    formatInviteDuration: () => '10 分钟',
  })
  return { requests, clipboard, statuses, busy }
}

test('organization manager can copy a test-space invite without synthetic ownership', async () => {
  const result = await copyAs(false, true)
  assert.equal(result.requests.length, 1)
  assert.deepEqual(result.clipboard, ['https://example.test/invite/test-token'])
  assert.equal(result.statuses.at(-1), '已复制，10 分钟内有效')
  assert.deepEqual(result.busy, [true, false])
})

test('owner can copy invites while a viewer cannot call the invite API or clipboard', async () => {
  assert.equal((await copyAs(true, true)).requests.length, 1)
  assert.deepEqual(await copyAs(false, false), {
    requests: [], clipboard: [], statuses: [], busy: [],
  })
})
