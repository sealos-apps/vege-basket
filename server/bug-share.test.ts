import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { hashBugShareToken } from './organization-policy.ts'
import { schemaSql } from './schema.ts'

const bugShareSource = readFileSync(new URL('./bug-share.ts', import.meta.url), 'utf8')
const bugShareDialogSource = readFileSync(
  new URL('../src/components/bug-share-dialog.tsx', import.meta.url),
  'utf8',
)
const bugShareViewSource = readFileSync(
  new URL('../src/components/bug-share-view.tsx', import.meta.url),
  'utf8',
)

test('Bug share tokens are deterministic one-way digests', () => {
  const token = 'share-token-for-test'
  assert.equal(hashBugShareToken(token), hashBugShareToken(token))
  assert.notEqual(hashBugShareToken(token), token)
})

test('Bug share schema keeps raw tokens encrypted and links revocable', () => {
  assert.match(schemaSql, /create table if not exists bug_share_links/i)
  assert.match(schemaSql, /token_hash text not null unique/i)
  assert.match(schemaSql, /token_encrypted text not null/i)
  assert.match(schemaSql, /where revoked_at is null/i)
})

test('Bug share creation bounds database waits while retaining the authorization row lock', () => {
  assert.match(bugShareSource, /set local lock_timeout/u)
  assert.match(bugShareSource, /set local statement_timeout/u)
  assert.match(bugShareSource, /for update of b/u)
})

test('Bug share links fall back to a same-site path when no public origin is configured', () => {
  assert.match(bugShareSource, /return origin \? `\$\{origin\}\$\{path\}` : path/u)
  assert.doesNotMatch(bugShareSource, /Public sharing is not configured/u)
})

test('Bug shares retain the space version and module for Bugs without a test case', () => {
  assert.match(bugShareSource, /space\.version_label as test_space_version_label/u)
  assert.match(bugShareSource, /organization_module\.name as organization_module_name/u)
  assert.match(bugShareSource, /left join test_subjects subject on subject\.id = b\.test_subject_id/u)
  assert.match(bugShareSource, /testSubjectName: bug\.test_subject_name \? decryptText\(bug\.test_subject_name\) : '未关联一级目录'/u)
  assert.match(bugShareSource, /testSpaceVersionLabel: bug\.test_space_version_label \? decryptText\(bug\.test_space_version_label\)/u)
  assert.match(bugShareSource, /moduleName: bug\.organization_module_name \? decryptText\(bug\.organization_module_name\)/u)
  assert.match(bugShareViewSource, /formatTestSpaceReference\(data\.testSpaceName, data\.testSpaceVersionLabel\)/u)
  assert.match(bugShareViewSource, /data\.moduleName \|\| '无模块'/u)
})

test('Bug share dialog ignores a stale link request after its Bug or open state changes', () => {
  assert.match(bugShareDialogSource, /const requestIdRef = useRef\(0\)/u)
  assert.match(bugShareDialogSource, /requestIdRef\.current !== requestId/u)
  assert.match(bugShareDialogSource, /requestIdRef\.current \+= 1/u)
})

test('Bug share view renders Markdown screenshots as thumbnails with an image preview dialog', () => {
  assert.match(bugShareViewSource, /import \{ MarkdownPreview \} from '\.\/markdown-preview'/u)
  assert.match(bugShareViewSource, /import \{ MentionTextarea \} from '\.\/mention-textarea'/u)
  assert.match(bugShareViewSource, /className="bug-share-markdown"/u)
  assert.match(bugShareViewSource, /target instanceof HTMLImageElement/u)
  assert.match(bugShareViewSource, /className="bug-share-image-preview"/u)
  assert.match(bugShareViewSource, /图片预览/u)
  assert.match(bugShareViewSource, /target\.currentSrc \|\| target\.src/u)
  assert.match(bugShareViewSource, /bug-share-comment-markdown/u)
  assert.match(bugShareViewSource, /<MarkdownPreview content=\{item\.content\} \/>/u)
  assert.match(bugShareViewSource, /members=\{data\.mentionableMembers\}/u)
  assert.match(bugShareViewSource, /输入 @ 可提及组织成员/u)
  assert.match(bugShareSource, /resolveBugShareMentionUserIds/u)
  assert.match(bugShareSource, /mentionableMembers/u)
})
