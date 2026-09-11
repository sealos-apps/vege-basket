import crypto from 'node:crypto'
import type { PoolClient } from 'pg'
import { decryptText, encryptText } from './crypto.ts'
import { pool, query } from './db.ts'
import { managedOrganizationReadScopeSql } from './organization-scope.ts'
import { hashTodoShareToken } from './organization-policy.ts'
import { normalizePublicAppUrl } from './todo-digest.ts'
import { getDepartedUserIds } from './user-lifecycle.ts'

const shareLifetimeMs = 30 * 24 * 60 * 60 * 1_000
const shareLockTimeout = '5s'
const shareStatementTimeout = '15s'

export type TodoShareNote = {
  authorName: string
  authorUserId?: number
  content: string
  createdAt: string
  fromShare: boolean
  id: number
  kind: 'normal' | 'acceptance'
}

export type TodoShareView = {
  assigneeName: string | null
  assigneeUserId?: number
  confirmationStatus: string
  createdAt: string
  creatorName: string
  creatorUserId?: number
  departedUserIds: number[]
  detail: string
  done: boolean
  dueDate: string
  mentionableMembers: Array<{ id: number; name: string }>
  moduleName: string | null
  subprojectName: string | null
  notes: TodoShareNote[]
  priority: string
  projectName: string
  reviewerName: string | null
  reviewerUserId?: number
  title: string
  todoId: number
  updatedAt: string
  viewer: 'anonymous' | 'commenter' | 'member'
  watcherNames: string[]
}

type ShareTodoRow = {
  assignee_display_name: string | null
  assignee_user_id: string | null
  confirmation_status: string
  created_at: Date
  creator_display_name: string | null
  creator_user_id: string
  detail: string
  done: boolean
  due_date: Date | string
  module_name: string | null
  subproject_name: string | null
  priority: string
  project_id: string
  project_name: string
  reviewer_display_name: string | null
  reviewer_user_id: string | null
  title: string
  todo_id: string
  updated_at: Date
}

function publicDisplayName(displayName: string | null) {
  return displayName?.trim() || '未知用户'
}

function uniqueNamedMembers(rows: Array<{ display_name: string | null; user_id: string }>) {
  const membersByName = new Map<string, Array<{ name: string; userId: number }>>()
  for (const row of rows) {
    const name = row.display_name?.trim()
    const userId = Number(row.user_id)
    if (!name || !Number.isSafeInteger(userId) || userId <= 0) continue
    const key = name.toLocaleLowerCase('zh-CN')
    const existing = membersByName.get(key) ?? []
    if (!existing.some((member) => member.userId === userId)) existing.push({ name, userId })
    membersByName.set(key, existing)
  }
  return Array.from(membersByName.values())
    .filter((members) => members.length === 1)
    .map(([member]) => member)
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
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

function publicTodoShareUrl(token: string) {
  const path = `/share/todo/${encodeURIComponent(token)}`
  const origin = normalizePublicAppUrl(process.env.APP_PUBLIC_URL)
  return origin ? `${origin}${path}` : path
}

async function listMentionableMembers(projectId: number) {
  const result = await query<{
    display_name: string | null
    user_id: string
  }>(
    `
    select p.user_id, owner.display_name
    from projects p
    join users owner on owner.id = p.user_id
    where p.id = $1
    union
    select pm.invited_user_id as user_id, member.display_name
    from project_memberships pm
    join users member on member.id = pm.invited_user_id
    where pm.project_id = $1
      and pm.status = 'active'
      and pm.invited_user_id is not null
    order by user_id
    `,
    [projectId],
  )
  return uniqueNamedMembers(result.rows).map((member, index) => ({
    id: index + 1,
    name: member.name,
  }))
}

function extractMentionNames(value: string) {
  return Array.from(value.matchAll(/@([^\s@，。；：、,.!?！？()（）【】[\]<>《》"'“”]+)(?=$|[\s，。；：、,.!?！？()（）【】[\]<>《》"'“”])/g))
    .map((match) => match[1]?.trim().toLocaleLowerCase('zh-CN') ?? '')
    .filter(Boolean)
}

function containsMarkdownImage(value: string) {
  return /!\[[^\]\n]*\]\([^\n)]+\)/u.test(value)
}

async function readView(token: string, userId?: number | null): Promise<TodoShareView> {
  const result = await query<ShareTodoRow>(
    `
    select t.id as todo_id, t.project_id, t.title, t.detail, t.due_date, t.priority,
           t.done, t.confirmation_status, t.created_at, t.updated_at,
           p.name as project_name, module.name as module_name,
           subproject.name as subproject_name,
           creator.id as creator_user_id, creator.display_name as creator_display_name,
           assignee.id as assignee_user_id, assignee.display_name as assignee_display_name,
           reviewer.id as reviewer_user_id, reviewer.display_name as reviewer_display_name
    from todo_share_links link
    join todos t on t.id = link.todo_id
    join projects p on p.id = t.project_id
    left join project_subprojects subproject on subproject.id = t.subproject_id and subproject.project_id = t.project_id
    join users creator on creator.id = coalesce(t.created_by_user_id, p.user_id)
    left join project_modules module
      on module.id = t.project_module_id
     and module.project_id = t.project_id
    left join users assignee on assignee.id = t.assignee_user_id
    left join users reviewer on reviewer.id = t.reviewer_user_id
    where link.token_hash = $1
      and link.revoked_at is null
      and link.expires_at > now()
    limit 1
    `,
    [hashTodoShareToken(token)],
  )
  const todo = result.rows[0]
  if (!todo) throw shareError('Todo share link is invalid or expired', 404)

  const [notes, watchers, memberAccess] = await Promise.all([
    query<{
      author_display_name: string | null
      author_user_id: string | null
      content: string
      created_at: Date
      from_share: boolean
      id: string
      kind: 'normal' | 'acceptance'
    }>(
      `
      select note.id, note.content, note.kind, note.created_at,
             note.source_share_link_id is not null as from_share,
             author.id as author_user_id, author.display_name as author_display_name
      from (
        select id, author_user_id, content, kind, created_at, source_share_link_id
        from todo_notes
        where todo_id = $1
          and source_operation_id is null
          and kind in ('normal', 'acceptance')
        order by created_at desc, id desc
        limit 100
      ) note
      left join users author on author.id = note.author_user_id
      order by note.created_at, note.id
      `,
      [todo.todo_id],
    ),
    query<{ display_name: string | null }>(
      `
      select watcher.display_name
      from todo_watchers todo_watcher
      join users watcher on watcher.id = todo_watcher.user_id
      where todo_watcher.todo_id = $1
      order by todo_watcher.watched_at, todo_watcher.user_id
      `,
      [todo.todo_id],
    ),
    userId
      ? query<{ id: string }>(
          `
          select p.id
          from projects p
          left join project_memberships membership
            on membership.project_id = p.id
           and membership.status = 'active'
           and membership.invited_user_id = $2
          where p.id = $1
            and (p.user_id = $2 or membership.id is not null)
          limit 1
          `,
          [todo.project_id, userId],
        )
      : Promise.resolve({ rows: [] as Array<{ id: string }> }),
  ])
  const hasProjectAccess = Boolean(memberAccess.rows[0])
  const mentionableMembers = hasProjectAccess
    ? await listMentionableMembers(Number(todo.project_id))
    : []

  return {
    assigneeName: todo.assignee_user_id
      ? publicDisplayName(todo.assignee_display_name)
      : null,
    assigneeUserId: todo.assignee_user_id ? Number(todo.assignee_user_id) : undefined,
    confirmationStatus: todo.confirmation_status,
    createdAt: todo.created_at.toISOString(),
    creatorName: publicDisplayName(todo.creator_display_name),
    creatorUserId: Number(todo.creator_user_id),
    departedUserIds: await getDepartedUserIds(),
    detail: decryptText(todo.detail),
    done: todo.done,
    dueDate: todo.due_date instanceof Date
      ? todo.due_date.toISOString().slice(0, 10)
      : String(todo.due_date).slice(0, 10),
    mentionableMembers,
    moduleName: todo.module_name ? decryptText(todo.module_name) : null,
    subprojectName: todo.subproject_name ? decryptText(todo.subproject_name) : null,
    notes: notes.rows.map((note) => ({
      authorName: publicDisplayName(note.author_display_name),
      authorUserId: note.author_user_id ? Number(note.author_user_id) : undefined,
      content: decryptText(note.content),
      createdAt: note.created_at.toISOString(),
      fromShare: note.from_share,
      id: Number(note.id),
      kind: note.kind,
    })),
    priority: todo.priority,
    projectName: decryptText(todo.project_name),
    reviewerName: todo.reviewer_user_id
      ? publicDisplayName(todo.reviewer_display_name)
      : null,
    reviewerUserId: todo.reviewer_user_id ? Number(todo.reviewer_user_id) : undefined,
    title: decryptText(todo.title),
    todoId: Number(todo.todo_id),
    updatedAt: todo.updated_at.toISOString(),
    viewer: hasProjectAccess ? 'member' : userId ? 'commenter' : 'anonymous',
    watcherNames: watchers.rows.map((watcher) => publicDisplayName(watcher.display_name)),
  }
}

export async function getTodoShareView(token: string, userId?: number | null) {
  return readView(token, userId)
}

export async function createTodoShareLink(todoId: number, userId: number) {
  let token: string
  try {
    token = await transaction(async (client) => {
      await client.query(`set local lock_timeout = '${shareLockTimeout}'`)
      await client.query(`set local statement_timeout = '${shareStatementTimeout}'`)
      const todoResult = await client.query<{ id: string }>(
        `
        select t.id
        from todos t
        join projects p on p.id = t.project_id
        left join project_memberships membership
          on membership.project_id = p.id
         and membership.status = 'active'
         and membership.invited_user_id = $2
        where t.id = $1
          and (
            p.user_id = $2
            or membership.id is not null
            or ${managedOrganizationReadScopeSql('p.organization_id', '$2')}
          )
        for update of t
        `,
        [todoId, userId],
      )
      if (!todoResult.rows[0]) throw shareError('Todo share access denied', 404)
      const active = await client.query<{ token_encrypted: string }>(
        `select token_encrypted from todo_share_links
         where todo_id = $1 and revoked_at is null and expires_at > now()
         order by created_at desc limit 1 for update`,
        [todoId],
      )
      if (active.rows[0]) return decryptText(active.rows[0].token_encrypted)
      await client.query(
        `update todo_share_links set revoked_at = now()
         where todo_id = $1 and revoked_at is null`,
        [todoId],
      )
      const next = shareToken()
      await client.query(
        `insert into todo_share_links (todo_id, created_by_user_id, token_hash, token_encrypted, expires_at)
         values ($1, $2, $3, $4, $5)`,
        [todoId, userId, hashTodoShareToken(next), encryptText(next), new Date(Date.now() + shareLifetimeMs)],
      )
      return next
    })
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
    if (code === '55P03' || code === '57014') {
      throw shareError('Todo share link generation timed out', 503)
    }
    throw error
  }
  return { expiresInDays: 30, url: publicTodoShareUrl(token) }
}

export async function revokeTodoShareLink(todoId: number, userId: number) {
  try {
    return await transaction(async (client) => {
      await client.query(`set local lock_timeout = '${shareLockTimeout}'`)
      await client.query(`set local statement_timeout = '${shareStatementTimeout}'`)
      const todoResult = await client.query<{ id: string }>(
        `
        select t.id
        from todos t
        join projects p on p.id = t.project_id
        left join project_memberships membership
          on membership.project_id = p.id
         and membership.status = 'active'
         and membership.invited_user_id = $2
        where t.id = $1
          and (
            p.user_id = $2
            or membership.id is not null
            or ${managedOrganizationReadScopeSql('p.organization_id', '$2')}
          )
        for update of t
        `,
        [todoId, userId],
      )
      if (!todoResult.rows[0]) throw shareError('Todo share access denied', 404)
      const result = await client.query(
        `update todo_share_links
         set revoked_at = now()
         where todo_id = $1 and revoked_at is null
         returning id`,
        [todoId],
      )
      if (!result.rows[0]) throw shareError('Todo share access denied', 404)
      return { ok: true as const }
    })
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
    if (code === '55P03' || code === '57014') {
      throw shareError('Todo share link revocation timed out', 503)
    }
    throw error
  }
}

export async function addTodoShareComment(
  token: string,
  userId: number,
  content: string,
  requestId: string,
) {
  if (containsMarkdownImage(content)) {
    throw shareError('Todo share comments do not support image Markdown', 400)
  }
  const mentionedNames = new Set(extractMentionNames(content))
  try {
    return await transaction(async (client) => {
      await client.query(`set local lock_timeout = '${shareLockTimeout}'`)
      await client.query(`set local statement_timeout = '${shareStatementTimeout}'`)
      const candidateLink = await client.query<{ todo_id: string }>(
        `select todo_id
         from todo_share_links
         where token_hash = $1
           and revoked_at is null
           and expires_at > now()`,
        [hashTodoShareToken(token)],
      )
      const todoId = candidateLink.rows[0]?.todo_id
      if (!todoId) throw shareError('Todo share link is invalid or expired', 404)
      await client.query('select id from todos where id = $1 for update', [todoId])
      const link = await client.query<{ id: string; project_id: string; todo_id: string }>(
      `
      select link.id, t.project_id, link.todo_id
      from todo_share_links link
      join todos t on t.id = link.todo_id
      where link.token_hash = $1
        and link.todo_id = $2
        and link.revoked_at is null
        and link.expires_at > now()
      for update of link
      `,
        [hashTodoShareToken(token), todoId],
      )
      const row = link.rows[0]
      if (!row) throw shareError('Todo share link is invalid or expired', 404)

      const replay = await client.query<{ id: string }>(
        `select id
         from todo_notes
         where source_share_link_id = $1
           and author_user_id = $2
           and source_share_request_id = $3::uuid
         limit 1`,
        [row.id, userId, requestId],
      )
      if (replay.rows[0]) {
        return { created: false as const, noteId: Number(replay.rows[0].id), todoId: Number(row.todo_id) }
      }

      const quota = await client.query<{
        link_day_count: string
        link_minute_count: string
        user_day_count: string
        user_minute_count: string
      }>(
        `select count(*) filter (
                  where created_at >= clock_timestamp() - interval '1 minute'
                )::text as link_minute_count,
                count(*) filter (
                  where author_user_id = $2
                    and created_at >= clock_timestamp() - interval '1 minute'
                )::text as user_minute_count,
                count(*) filter (
                  where created_at >= clock_timestamp() - interval '1 day'
                )::text as link_day_count,
                count(*) filter (
                  where author_user_id = $2
                    and created_at >= clock_timestamp() - interval '1 day'
                )::text as user_day_count
         from todo_notes
         where source_share_link_id = $1`,
        [row.id, userId],
      )
      const counts = quota.rows[0]
      if (
        Number(counts?.user_minute_count ?? 0) >= 5 ||
        Number(counts?.link_minute_count ?? 0) >= 10 ||
        Number(counts?.user_day_count ?? 0) >= 50 ||
        Number(counts?.link_day_count ?? 0) >= 200
      ) {
        throw shareError('Todo share comment rate limit exceeded', 429)
      }

      const mentionableMembers = mentionedNames.size > 0
        ? await client.query<{ display_name: string | null; user_id: string }>(
          `
          with authorized_project as (
            select p.id, p.user_id
            from projects p
            left join project_memberships viewer_membership
              on viewer_membership.project_id = p.id
             and viewer_membership.status = 'active'
             and viewer_membership.invited_user_id = $2
            where p.id = $1
              and (p.user_id = $2 or viewer_membership.id is not null)
          )
          select p.user_id, owner.display_name
          from authorized_project p
          join users owner on owner.id = p.user_id
          union
          select membership.invited_user_id as user_id, member.display_name
          from project_memberships membership
          join users member on member.id = membership.invited_user_id
          join authorized_project p on p.id = membership.project_id
          where membership.project_id = $1
            and membership.status = 'active'
            and membership.invited_user_id is not null
          `,
          [row.project_id, userId],
        )
        : { rows: [] as Array<{ display_name: string | null; user_id: string }> }
      const mentionedUserIds = uniqueNamedMembers(mentionableMembers.rows)
        .filter((member) => mentionedNames.has(member.name.toLocaleLowerCase('zh-CN')))
        .map((member) => member.userId)
      const inserted = await client.query<{ id: string }>(
        `insert into todo_notes (
           todo_id, author_user_id, content, source_share_link_id, source_share_request_id
         )
         values ($1, $2, $3, $4, $5::uuid)
         returning id`,
        [row.todo_id, userId, encryptText(content), row.id, requestId],
      )
      const noteId = Number(inserted.rows[0]?.id ?? 0)
      for (const mentionedUserId of new Set(mentionedUserIds)) {
        await client.query(
          `insert into todo_note_mentions (todo_note_id, mentioned_user_id)
           values ($1, $2)
           on conflict (todo_note_id, mentioned_user_id) do nothing`,
          [noteId, mentionedUserId],
        )
      }
      return { created: true as const, noteId, todoId: Number(row.todo_id) }
    })
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
    if (code === '55P03' || code === '57014' || code === '40P01') {
      throw shareError('Todo share comment timed out', 503)
    }
    throw error
  }
}
