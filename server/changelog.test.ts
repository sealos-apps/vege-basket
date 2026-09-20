import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  changelogContentMaxLength,
  changelogTitleMaxLength,
  changelogVersionMaxLength,
  normalizeChangelogPayload,
} from './changelog.ts'

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const changelogWorkbenchSource = readFileSync(
  new URL('../src/components/changelog-workbench.tsx', import.meta.url),
  'utf8',
)
const changelogServerSource = readFileSync(new URL('./changelog.ts', import.meta.url), 'utf8')
const schemaSource = readFileSync(new URL('./schema.ts', import.meta.url), 'utf8')

test('normalizes a valid changelog payload', () => {
  assert.deepEqual(normalizeChangelogPayload({
    content: '  ## 修复\n\n- 修复问题  ',
    title: '  Veges 1.2.0  ',
    version: '  v1.2.0  ',
  }), {
    content: '## 修复\n\n- 修复问题',
    title: 'Veges 1.2.0',
    version: 'v1.2.0',
  })
})

test('rejects empty and oversized changelog fields', () => {
  assert.equal(normalizeChangelogPayload({ title: '', version: '', content: '正文' }), null)
  assert.equal(normalizeChangelogPayload({
    title: '标题',
    version: 'v1',
    content: 'x'.repeat(changelogContentMaxLength + 1),
  }), null)
  assert.equal(normalizeChangelogPayload({
    title: 'x'.repeat(changelogTitleMaxLength + 1),
    version: 'v1',
    content: '正文',
  }), null)
  assert.equal(normalizeChangelogPayload({
    title: '标题',
    version: 'x'.repeat(changelogVersionMaxLength + 1),
    content: '正文',
  }), null)
})

test('accepts the optional login announcement flag and rejects non-booleans', () => {
  assert.deepEqual(normalizeChangelogPayload({
    announceOnLogin: true,
    content: '正文',
    title: '标题',
    version: 'v1',
  }), {
    announceOnLogin: true,
    content: '正文',
    title: '标题',
    version: 'v1',
  })
  assert.equal(normalizeChangelogPayload({
    announceOnLogin: 'true',
    content: '正文',
    title: '标题',
    version: 'v1',
  }), null)
})

test('login announcements use a server-canonical monotonic read cursor', () => {
  assert.match(schemaSource, /announce_on_login boolean not null default false/u)
  assert.match(schemaSource, /user_changelog_announcement_states[\s\S]*?primary key references users\(id\) on delete cascade/u)
  assert.match(changelogServerSource, /entry\.id > coalesce\(state\.last_acknowledged_entry_id, 0::bigint\)/u)
  assert.match(changelogServerSource, /count\(\*\) over \(\) as unread_count/u)
  assert.match(changelogServerSource, /greatest\([\s\S]*?last_acknowledged_entry_id/u)
  assert.match(changelogServerSource, /payload\.announceOnLogin \?\? true/u)
})

test('the login announcement only closes after canonical acknowledgement', () => {
  assert.match(appSource, /await acknowledgeChangelogAnnouncement\(entry\.id\)[\s\S]*?setChangelogAnnouncement\(null\)/u)
  assert.match(appSource, /catch \(acknowledgeError\)[\s\S]*?await fetchChangelogAnnouncement\(\)/u)
  assert.match(appSource, /!roleSelectionOpen[\s\S]*?invitePasswordRequired/u)
  assert.doesNotMatch(appSource, /displayNameOnboarding/u)
})

test('changelog loads independently from workspace polling and starts collapsed', () => {
  const changelogUsages = [...appSource.matchAll(/<ChangelogWorkbench\b([\s\S]*?)\/>/gu)]
  assert.doesNotMatch(changelogWorkbenchSource, /refreshToken/u)
  assert.ok(changelogUsages.length >= 1)
  assert.ok(changelogUsages.every(([, props]) => !props.includes('refreshToken=')))
  assert.match(changelogWorkbenchSource, /useState<number \| null>\(null\)/u)
  assert.doesNotMatch(changelogWorkbenchSource, /result\.entries\[0\]\?\.id/u)
})

test('tester reads the changelog inside the test workbench without switching personas', () => {
  assert.match(
    appSource,
    /authUser\?\.activeRole === 'tester' && \(view === 'testing' \|\| view === 'changelog'\)/u,
  )
  assert.match(appSource, /workspaceContent=\{view === 'changelog' \? \(/u)
  assert.match(appSource, /onBack=\{\(\) => setView\('testing'\)\}/u)
  assert.match(changelogWorkbenchSource, /onBack\?: \(\) => void/u)
  assert.match(changelogWorkbenchSource, /返回测试工作台/u)
})
