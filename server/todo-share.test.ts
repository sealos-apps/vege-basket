import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { hashTodoShareToken } from './organization-policy.ts'
import { schemaSql } from './schema.ts'
import { getTodoShareTokenFromPath } from '../src/todo-share-deep-link.ts'

const serverSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const todoShareSource = readFileSync(new URL('./todo-share.ts', import.meta.url), 'utf8')
const todoShareDialogSource = readFileSync(
  new URL('../src/components/todo-share-dialog.tsx', import.meta.url),
  'utf8',
)
const todoShareViewSource = readFileSync(
  new URL('../src/components/todo-share-view.tsx', import.meta.url),
  'utf8',
)
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('Todo share tokens are deterministic one-way digests', () => {
  const token = 'todo-share-token-for-test'
  assert.equal(hashTodoShareToken(token), hashTodoShareToken(token))
  assert.notEqual(hashTodoShareToken(token), token)
})

test('Todo share schema encrypts raw tokens and keeps one active link per todo', () => {
  assert.match(schemaSql, /create table if not exists todo_share_links/i)
  assert.match(schemaSql, /token_hash text not null unique/i)
  assert.match(schemaSql, /token_encrypted text not null/i)
  assert.match(schemaSql, /idx_todo_share_links_active_todo/i)
  assert.match(schemaSql, /where revoked_at is null/i)
  assert.match(schemaSql, /source_share_request_id uuid/i)
  assert.match(schemaSql, /idx_todo_notes_share_request_unique/i)
})

test('Todo share creation allows project members and managed organization administrators', () => {
  assert.match(todoShareSource, /set local lock_timeout/u)
  assert.match(todoShareSource, /set local statement_timeout/u)
  assert.match(todoShareSource, /for update of t/u)
  assert.match(todoShareSource, /membership\.status = 'active'/u)
  assert.match(todoShareSource, /membership\.invited_user_id = \$2/u)
  assert.match(todoShareSource, /managedOrganizationReadScopeSql\('p\.organization_id', '\$2'\)/u)
  assert.doesNotMatch(todoShareSource, /t\.created_by_user_id = \$2 or t\.assignee_user_id = \$2/u)
  assert.match(todoShareSource, /Todo share link revocation timed out/u)
})

test('Todo detail exposes sharing for every project-visible todo', () => {
  const canShareStart = appSource.indexOf('function canShareTodo(todo: Todo)')
  const canShareEnd = appSource.indexOf('function canManageTodo(todo: Todo)', canShareStart)
  const canShareSource = appSource.slice(canShareStart, canShareEnd)
  assert.ok(canShareStart >= 0 && canShareEnd > canShareStart)
  assert.match(canShareSource, /return Boolean\(currentUserId != null && project\)/u)
  assert.doesNotMatch(canShareSource, /readOnly|createdByUserId|assigneeUserId|reviewerUserId|watcherUserIds/u)
})

test('Only project members receive mentionable project members', () => {
  assert.match(todoShareSource, /const hasProjectAccess = Boolean\(memberAccess\.rows\[0\]\)/u)
  assert.match(todoShareSource, /const mentionableMembers = hasProjectAccess/u)
  assert.match(todoShareSource, /viewer: hasProjectAccess \? 'member' : userId \? 'commenter' : 'anonymous'/u)
  assert.doesNotMatch(todoShareSource, /mentionableMembers: await listMentionableMembers/u)
  assert.match(todoShareSource, /authorName: publicDisplayName\(note\.author_display_name\)/u)
  assert.match(todoShareSource, /creatorName: publicDisplayName\(todo\.creator_display_name\)/u)
  assert.match(todoShareSource, /moduleName: todo\.module_name \? decryptText\(todo\.module_name\) : null/u)
  const publicViewStart = todoShareSource.indexOf('async function readView')
  const createLinkStart = todoShareSource.indexOf('export async function createTodoShareLink')
  assert.doesNotMatch(todoShareSource.slice(publicViewStart, createLinkStart), /\.email|_email/u)
  assert.doesNotMatch(todoShareSource, /owner\.email|member\.email/u)
  assert.match(todoShareSource, /filter\(\(members\) => members\.length === 1\)/u)
  assert.match(todoShareSource, /module\.project_id = t\.project_id/u)
})

test('Todo share exposes only standalone normal and acceptance notes', () => {
  assert.match(todoShareSource, /source_operation_id is null/u)
  assert.match(todoShareSource, /kind in \('normal', 'acceptance'\)/u)
  assert.match(todoShareSource, /limit 100/u)
  assert.doesNotMatch(todoShareSource, /todo_activity_events/u)
})

test('Todo share comments encrypt notes and persist mentions in one transaction', () => {
  assert.match(todoShareSource, /insert into todo_notes/u)
  assert.match(todoShareSource, /encryptText\(content\)/u)
  assert.match(todoShareSource, /insert into todo_note_mentions/u)
  assert.match(serverSource, /result\.created && result\.noteId > 0/u)
  assert.match(serverSource, /enqueueTodoNoteDeliveries\(result\.noteId\)/u)
  assert.match(todoShareSource, /source_share_request_id = \$3::uuid/u)
  assert.match(todoShareSource, /select id from todos where id = \$1 for update/u)
  assert.match(todoShareSource, /Todo share comment rate limit exceeded/u)
  assert.match(todoShareSource, /Todo share comments do not support image Markdown/u)
  assert.match(todoShareSource, /with authorized_project as/u)
  assert.match(todoShareSource, /viewer_membership\.invited_user_id = \$2/u)
  assert.match(todoShareSource, /join authorized_project p on p\.id = membership\.project_id/u)
})

test('Todo share HTTP boundary keeps public reads private and comments authenticated', () => {
  assert.match(serverSource, /app\.get\('\/api\/todo-shares\/:token'/u)
  assert.match(serverSource, /app\.post\('\/api\/todo-shares\/:token\/comments'/u)
  assert.match(serverSource, /response\.setHeader\('Cache-Control', 'private, no-store'\)/u)
  assert.match(serverSource, /response\.setHeader\('Referrer-Policy', 'no-referrer'\)/u)
  assert.match(serverSource, /response\.setHeader\('X-Robots-Tag', 'noindex'\)/u)
  assert.match(serverSource, /Content-Security-Policy/u)
  assert.match(serverSource, /todoShareCommentTokenConcurrencyLimiter/u)
  assert.match(serverSource, /登录后才能留言/u)
})

test('Todo share dialog ignores stale link requests', () => {
  assert.match(todoShareDialogSource, /const requestIdRef = useRef\(0\)/u)
  assert.match(todoShareDialogSource, /requestIdRef\.current !== requestId/u)
  assert.match(todoShareDialogSource, /requestIdRef\.current \+= 1/u)
})

test('Todo share view keeps trusted notes in Markdown and shared comments in plain text', () => {
  assert.match(todoShareViewSource, /<MarkdownPreview content=\{value\} \/>/u)
  assert.match(todoShareViewSource, /target instanceof HTMLImageElement/u)
  assert.match(todoShareViewSource, /note\.fromShare/u)
  assert.match(todoShareViewSource, /todo-share-comment-text/u)
  assert.match(todoShareViewSource, /members=\{data\.mentionableMembers\}/u)
  assert.match(todoShareViewSource, /输入 @ 可提及项目成员/u)
  assert.match(todoShareViewSource, /登录后可以留言备注/u)
  assert.match(todoShareViewSource, /data\?\.viewer === 'member'/u)
})

test('Todo share deep links accept one encoded token segment only', () => {
  assert.equal(getTodoShareTokenFromPath('/share/todo/abc-123'), 'abc-123')
  assert.equal(getTodoShareTokenFromPath('/share/todo/a%20b/'), 'a b')
  assert.equal(getTodoShareTokenFromPath('/share/todo/'), null)
  assert.equal(getTodoShareTokenFromPath('/share/todo/a/b'), null)
  assert.equal(getTodoShareTokenFromPath('/projects'), null)
})
