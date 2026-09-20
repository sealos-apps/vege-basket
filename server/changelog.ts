import type express from 'express'
import { Router } from 'express'
import { decryptText, encryptText } from './crypto.ts'
import { query } from './db.ts'
import { getAuthenticatedRoleSession } from './roles.ts'
import { isPlatformAdmin } from './platform-admins.ts'

export const changelogTitleMaxLength = 120
export const changelogVersionMaxLength = 40
export const changelogContentMaxLength = 50_000

export type ChangelogPayload = {
  announceOnLogin?: boolean
  content: string
  title: string
  version: string
}

type ChangelogRow = {
  announce_on_login: boolean
  content_encrypted: string
  created_at: Date | string
  created_by_user_id: number | string | null
  id: number | string
  published_at: Date | string
  title_encrypted: string
  updated_at: Date | string
  updated_by_user_id: number | string | null
  version_encrypted: string
}

export function normalizeChangelogPayload(input: unknown): ChangelogPayload | null {
  if (!input || typeof input !== 'object') return null
  const value = input as Record<string, unknown>
  const title = typeof value.title === 'string' ? value.title.trim() : ''
  const version = typeof value.version === 'string' ? value.version.trim() : ''
  const content = typeof value.content === 'string' ? value.content.trim() : ''
  const announceOnLogin = value.announceOnLogin
  if (!title || title.length > changelogTitleMaxLength) return null
  if (version.length > changelogVersionMaxLength) return null
  if (!content || content.length > changelogContentMaxLength) return null
  if (announceOnLogin !== undefined && typeof announceOnLogin !== 'boolean') return null
  return announceOnLogin === undefined
    ? { content, title, version }
    : { announceOnLogin, content, title, version }
}

function serializeChangelogEntry(row: ChangelogRow) {
  return {
    announceOnLogin: row.announce_on_login,
    content: decryptText(row.content_encrypted),
    createdAt: new Date(row.created_at).toISOString(),
    createdByUserId: row.created_by_user_id == null ? null : Number(row.created_by_user_id),
    id: Number(row.id),
    publishedAt: new Date(row.published_at).toISOString(),
    title: decryptText(row.title_encrypted),
    updatedAt: new Date(row.updated_at).toISOString(),
    updatedByUserId: row.updated_by_user_id == null ? null : Number(row.updated_by_user_id),
    version: decryptText(row.version_encrypted),
  }
}

async function getSession(request: express.Request, response: express.Response) {
  const session = await getAuthenticatedRoleSession(request)
  if (!session) {
    response.status(401).json({ error: 'Unauthorized' })
    return null
  }
  return session
}

async function requireSystemAdmin(
  session: Awaited<ReturnType<typeof getAuthenticatedRoleSession>>,
  response: express.Response,
) {
  if (!session || !(await isPlatformAdmin(session.userId))) {
    response.status(403).json({ error: 'System administrator access is required' })
    return false
  }
  return true
}

export const changelogRouter = Router()

changelogRouter.get('/changelog', async (request, response, next) => {
  try {
    const session = await getSession(request, response)
    if (!session) return
    const result = await query<ChangelogRow>(
      `
      select id, title_encrypted, version_encrypted, content_encrypted, announce_on_login,
        created_by_user_id, updated_by_user_id, published_at, created_at, updated_at
      from changelog_entries
      order by published_at desc, id desc
      `,
    )
    response.json({
      canManage: await isPlatformAdmin(session.userId),
      entries: result.rows.map(serializeChangelogEntry),
    })
  } catch (error) {
    next(error)
  }
})

changelogRouter.get('/changelog/announcement', async (request, response, next) => {
  try {
    const session = await getSession(request, response)
    if (!session) return
    const result = await query<ChangelogRow & { unread_count: number | string }>(
      `
      with pending as (
        select entry.id, entry.title_encrypted, entry.version_encrypted,
          entry.content_encrypted, entry.announce_on_login,
          entry.created_by_user_id, entry.updated_by_user_id,
          entry.published_at, entry.created_at, entry.updated_at,
          count(*) over () as unread_count
        from changelog_entries entry
        left join user_changelog_announcement_states state
          on state.user_id = $1::bigint
        where entry.announce_on_login = true
          and entry.id > coalesce(state.last_acknowledged_entry_id, 0::bigint)
      )
      select *
      from pending
      order by id desc
      limit 1
      `,
      [session.userId],
    )
    const row = result.rows[0]
    response.json({
      entry: row ? serializeChangelogEntry(row) : null,
      unreadCount: row ? Number(row.unread_count) : 0,
    })
  } catch (error) {
    next(error)
  }
})

changelogRouter.put('/changelog/announcement-read-state', async (request, response, next) => {
  try {
    const session = await getSession(request, response)
    if (!session) return
    const throughEntryId = Number(request.body.throughEntryId)
    if (!Number.isSafeInteger(throughEntryId) || throughEntryId <= 0) {
      response.status(400).json({ error: 'Invalid changelog entry id' })
      return
    }
    const result = await query<{ last_acknowledged_entry_id: number | string }>(
      `
      insert into user_changelog_announcement_states (
        user_id, last_acknowledged_entry_id, acknowledged_at
      )
      select $1::bigint, entry.id, now()
      from changelog_entries entry
      where entry.id = $2::bigint
        and entry.announce_on_login = true
      on conflict (user_id) do update
      set last_acknowledged_entry_id = greatest(
            user_changelog_announcement_states.last_acknowledged_entry_id,
            excluded.last_acknowledged_entry_id
          ),
          acknowledged_at = case
            when excluded.last_acknowledged_entry_id >
              user_changelog_announcement_states.last_acknowledged_entry_id
              then now()
            else user_changelog_announcement_states.acknowledged_at
          end
      returning last_acknowledged_entry_id
      `,
      [session.userId, throughEntryId],
    )
    if (!result.rows[0]) {
      response.status(404).json({ error: 'Changelog announcement not found' })
      return
    }
    response.json({
      acknowledgedThroughEntryId: Number(result.rows[0].last_acknowledged_entry_id),
    })
  } catch (error) {
    next(error)
  }
})

changelogRouter.post('/admin/changelog', async (request, response, next) => {
  try {
    const session = await getSession(request, response)
    if (!session) return
    if (!(await requireSystemAdmin(session, response))) return
    const payload = normalizeChangelogPayload(request.body)
    if (!payload) {
      response.status(400).json({ error: '标题、正文或字段长度不符合要求' })
      return
    }
    const result = await query<ChangelogRow>(
      `
      insert into changelog_entries (
        title_encrypted, version_encrypted, content_encrypted, announce_on_login,
        created_by_user_id, updated_by_user_id
      ) values ($1, $2, $3, $4, $5, $5)
      returning id, title_encrypted, version_encrypted, content_encrypted, announce_on_login,
        created_by_user_id, updated_by_user_id, published_at, created_at, updated_at
      `,
      [
        encryptText(payload.title),
        encryptText(payload.version),
        encryptText(payload.content),
        payload.announceOnLogin ?? true,
        session?.userId,
      ],
    )
    response.status(201).json({ entry: serializeChangelogEntry(result.rows[0]) })
  } catch (error) {
    next(error)
  }
})

changelogRouter.patch('/admin/changelog/:id', async (request, response, next) => {
  try {
    const session = await getSession(request, response)
    if (!session) return
    if (!(await requireSystemAdmin(session, response))) return
    const id = Number(request.params.id)
    if (!Number.isSafeInteger(id) || id <= 0) {
      response.status(400).json({ error: 'Invalid changelog id' })
      return
    }
    const payload = normalizeChangelogPayload(request.body)
    if (!payload) {
      response.status(400).json({ error: '标题、正文或字段长度不符合要求' })
      return
    }
    const result = await query<ChangelogRow>(
      `
      update changelog_entries
      set title_encrypted = $1,
          version_encrypted = $2,
          content_encrypted = $3,
          announce_on_login = coalesce($4::boolean, announce_on_login),
          updated_by_user_id = $5,
          updated_at = now()
      where id = $6
      returning id, title_encrypted, version_encrypted, content_encrypted, announce_on_login,
        created_by_user_id, updated_by_user_id, published_at, created_at, updated_at
      `,
      [
        encryptText(payload.title),
        encryptText(payload.version),
        encryptText(payload.content),
        payload.announceOnLogin ?? null,
        session?.userId,
        id,
      ],
    )
    if (!result.rows[0]) {
      response.status(404).json({ error: 'Changelog entry not found' })
      return
    }
    response.json({ entry: serializeChangelogEntry(result.rows[0]) })
  } catch (error) {
    next(error)
  }
})
