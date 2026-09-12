import crypto from 'node:crypto'
import type { PoolClient } from 'pg'
import { decryptText, encryptText } from './crypto.ts'
import { pool, query } from './db.ts'
import { bugCaseDirectoryJoinSql, serializeBugCaseDirectory, type BugCaseDirectoryRow } from './bug-case-directory.ts'
import { managedOrganizationReadScopeSql } from './organization-scope.ts'
import { hashBugShareToken } from './organization-policy.ts'
import { normalizePublicAppUrl } from './todo-digest.ts'
import { getDepartedUserIds } from './user-lifecycle.ts'

const shareLifetimeMs = 30 * 24 * 60 * 60 * 1_000
const shareLockTimeout = '5s'
const shareStatementTimeout = '15s'

export type BugShareComment = {
  authorName: string
  authorUserId?: number
  content: string
  createdAt: string
  id: number
}

export type BugShareMentionableMember = {
  id: number
  name: string
}

export type BugShareView = {
  assigneeName: string | null
  assigneeUserId?: number
  bugId: number
  comments: BugShareComment[]
  createdAt: string
  departedUserIds: number[]
  environment: string
  expectedResult: string
  actualResult: string
  priority: string
  projectName: string | null
  organizationId?: number | null
  reproductionSteps: string
  severity: string
  mentionableMembers: BugShareMentionableMember[]
  status: string
  testPlanName: string | null
  testSpaceName: string
  testSubjectName: string
  testCaseId?: number
  testCaseTitle?: string
  testCaseFolderName?: string
  title: string
  updatedAt: string
  viewer: 'anonymous' | 'commenter' | 'assignee'
}

type ShareBugRow = {
  test_case_id: string | null
  test_case_title: string | null
  test_case_directory_path: BugCaseDirectoryRow
  actual_result: string
  assignee_display_name: string | null
  assignee_user_id: string | null
  bug_id: string
  created_at: Date
  environment: string
  expected_result: string
  organization_id: string | null
  project_name: string | null
  priority: string
  reproduction_steps: string
  severity: string
  status: string
  test_plan_name: string | null
  test_space_name: string
  test_subject_name: string
  title: string
  updated_at: Date
}

function extractMentionNames(value: string) {
  return Array.from(value.matchAll(/@([^\s@，。；：、,.!?！？()（）【】[\]<>《》"'“”]+)(?=$|[\s，。；：、,.!?！？()（）【】[\]<>《》"'“”])/g))
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean)
}

function shareError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status })
}

function shareToken() {
  return crypto.randomBytes(32).toString('base64url')
}

async function transaction<T>(handler: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await handler(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export function buildBugShareUrl(token: string) {
  const path = `/share/bug/${encodeURIComponent(token)}`
  const origin = normalizePublicAppUrl(process.env.APP_PUBLIC_URL)
  return origin ? `${origin}${path}` : path
}

async function readView(token: string, userId?: number | null) {
  const result = await query<ShareBugRow>(
    `
    select b.id as bug_id, b.title, b.severity, b.priority, b.status, b.test_case_id,
           linked_case.title as test_case_title,
           case_directory.path as test_case_directory_path,
           b.environment, b.reproduction_steps, b.expected_result, b.actual_result,
           b.created_at, b.updated_at, b.assignee_user_id,
           space.organization_id,
           space.name as test_space_name,
           subject.name as test_subject_name,
           plan.name as test_plan_name,
           project.name as project_name,
           assignee.display_name as assignee_display_name
    from bug_share_links link
    join test_bugs b on b.id = link.test_bug_id
    join test_spaces space on space.id = b.test_space_id
    join test_subjects subject on subject.id = b.test_subject_id
    left join test_cases linked_case on linked_case.id = b.test_case_id and linked_case.test_space_id = b.test_space_id
    ${bugCaseDirectoryJoinSql}
    left join test_plans plan on plan.id = b.test_plan_id
    left join projects project on project.id = plan.project_id
    left join users assignee on assignee.id = b.assignee_user_id
    where link.token_hash = $1
      and link.revoked_at is null
      and link.expires_at > now()
    limit 1
    `,
    [hashBugShareToken(token)],
  )
  const bug = result.rows[0]
  if (!bug) throw shareError('Bug share link is invalid or expired', 404)
  const mentionableMembers = bug.organization_id
    ? await query<{
        display_name: string | null
        email: string | null
        id: string
      }>(
        `
        select u.id, u.display_name, u.email
        from organization_memberships membership
        join users u on u.id = membership.user_id
        where membership.organization_id = $1
          and membership.status = 'active'
        order by lower(coalesce(nullif(u.display_name, ''), u.email)), u.id
        `,
        [bug.organization_id],
      )
    : { rows: [] as Array<{ display_name: string | null; email: string | null; id: string }> }
  const comments = await query<{
    author_display_name: string | null
    author_user_id: string | null
    content: string
    created_at: Date
    id: string
  }>(
    `
    select c.id, c.author_user_id, c.content, c.created_at,
           u.display_name as author_display_name
    from test_bug_comments c
    left join users u on u.id = c.author_user_id
    where c.test_bug_id = $1 and c.kind = 'comment'
    order by c.created_at, c.id
    `,
    [bug.bug_id],
  )
  const viewer = userId && Number(bug.assignee_user_id) === userId
    ? 'assignee'
    : userId ? 'commenter' : 'anonymous'
  return {
    assigneeName: bug.assignee_display_name || null,
    assigneeUserId: bug.assignee_user_id ? Number(bug.assignee_user_id) : undefined,
    bugId: Number(bug.bug_id),
    comments: comments.rows.map((comment) => ({
      authorName: comment.author_display_name || '未知用户',
      authorUserId: comment.author_user_id ? Number(comment.author_user_id) : undefined,
      content: decryptText(comment.content),
      createdAt: comment.created_at.toISOString(),
      id: Number(comment.id),
    })),
    createdAt: bug.created_at.toISOString(),
    departedUserIds: await getDepartedUserIds(),
    environment: decryptText(bug.environment),
    expectedResult: decryptText(bug.expected_result),
    actualResult: decryptText(bug.actual_result),
    mentionableMembers: mentionableMembers.rows.map((member) => ({
      id: Number(member.id),
      name: member.display_name || member.email || '未知用户',
    })),
    priority: bug.priority,
    projectName: bug.project_name ? decryptText(bug.project_name) : null,
    organizationId: viewer === 'assignee'
      ? (bug.organization_id ? Number(bug.organization_id) : null)
      : undefined,
    reproductionSteps: decryptText(bug.reproduction_steps),
    severity: bug.severity,
    status: bug.status,
    testPlanName: bug.test_plan_name ? decryptText(bug.test_plan_name) : null,
    testSpaceName: decryptText(bug.test_space_name),
    testSubjectName: decryptText(bug.test_subject_name),
    testCaseId: bug.test_case_id ? Number(bug.test_case_id) : undefined,
    testCaseTitle: bug.test_case_title ? decryptText(bug.test_case_title) : undefined,
    testCaseFolderName: serializeBugCaseDirectory(bug.test_case_directory_path).testCaseFolderName,
    title: decryptText(bug.title),
    updatedAt: bug.updated_at.toISOString(),
    viewer,
  } satisfies BugShareView
}

async function resolveBugShareMentionUserIds(token: string, content: string) {
  const names = extractMentionNames(content).map((name) => name.toLocaleLowerCase('zh-CN'))
  if (names.length === 0) return []
  const result = await query<{ id: string }>(
    `
    select distinct u.id
    from bug_share_links link
    join test_bugs b on b.id = link.test_bug_id
    join test_spaces space on space.id = b.test_space_id
    join organization_memberships membership
      on membership.organization_id = space.organization_id
     and membership.status = 'active'
    join users u on u.id = membership.user_id
    where link.token_hash = $1
      and link.revoked_at is null
      and link.expires_at > now()
      and lower(coalesce(nullif(u.display_name, ''), u.email)) = any($2::text[])
    order by u.id
    `,
    [hashBugShareToken(token), names],
  )
  return result.rows.map((row) => Number(row.id)).filter((id) => Number.isSafeInteger(id) && id > 0)
}

export async function getBugShareView(token: string, userId?: number | null) {
  return readView(token, userId)
}

export async function createBugShareLink(bugId: number, userId: number) {
  let token: string
  try {
    token = await transaction(async (client) => {
      await client.query(`set local lock_timeout = '${shareLockTimeout}'`)
      await client.query(`set local statement_timeout = '${shareStatementTimeout}'`)
      const bugResult = await client.query<{ id: string }>(
        `
        select b.id
        from test_bugs b
        join test_spaces space on space.id = b.test_space_id
        where b.id = $1
          and (b.reporter_user_id = $2 or b.assignee_user_id = $2 or ${managedOrganizationReadScopeSql('space.organization_id', '$2')})
        for update of b
        `,
        [bugId, userId],
      )
      if (!bugResult.rows[0]) throw shareError('Bug share access denied', 404)
      const active = await client.query<{ token_encrypted: string }>(
        `select token_encrypted from bug_share_links
         where test_bug_id = $1 and revoked_at is null and expires_at > now()
         order by created_at desc limit 1 for update`,
        [bugId],
      )
      if (active.rows[0]) return decryptText(active.rows[0].token_encrypted)
      await client.query(
        `update bug_share_links set revoked_at = now()
         where test_bug_id = $1 and revoked_at is null`,
        [bugId],
      )
      const next = shareToken()
      await client.query(
        `insert into bug_share_links (test_bug_id, created_by_user_id, token_hash, token_encrypted, expires_at)
         values ($1, $2, $3, $4, $5)`,
        [bugId, userId, hashBugShareToken(next), encryptText(next), new Date(Date.now() + shareLifetimeMs)],
      )
      return next
    })
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
    if (code === '55P03' || code === '57014') {
      throw shareError('Bug share link generation timed out', 503)
    }
    throw error
  }
  return { expiresInDays: 30, url: buildBugShareUrl(token) }
}

export async function revokeBugShareLink(bugId: number, userId: number) {
  const result = await query(
    `
    update bug_share_links link
       set revoked_at = now()
      from test_bugs b
      join test_spaces space on space.id = b.test_space_id
     where link.test_bug_id = b.id
       and b.id = $1
       and link.revoked_at is null
       and (b.reporter_user_id = $2 or b.assignee_user_id = $2 or ${managedOrganizationReadScopeSql('space.organization_id', '$2')})
     returning link.id
    `,
    [bugId, userId],
  )
  if (!result.rows[0]) throw shareError('Bug share access denied', 404)
  return { ok: true as const }
}

export async function addBugShareComment(token: string, userId: number, content: string) {
  let commentId = 0
  const bugId = await transaction(async (client) => {
    const link = await client.query<{ test_bug_id: string }>(
      `select test_bug_id from bug_share_links
       where token_hash = $1 and revoked_at is null and expires_at > now()
       for update`,
      [hashBugShareToken(token)],
    )
    const bugId = link.rows[0]?.test_bug_id
    if (!bugId) throw shareError('Bug share link is invalid or expired', 404)
    const inserted = await client.query<{ id: string }>(
      `insert into test_bug_comments (test_bug_id, author_user_id, content, kind)
       values ($1, $2, $3, 'comment')
       returning id`,
      [bugId, userId, encryptText(content)],
    )
    commentId = Number(inserted.rows[0]?.id ?? 0)
    return Number(bugId)
  })
  return {
    bugId,
    commentId,
    view: await readView(token, userId),
  }
}

export { resolveBugShareMentionUserIds }
