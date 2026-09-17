import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import type { QueryResultRow } from 'pg'
import { decryptText, encryptText } from './crypto.ts'
import { pool } from './db.ts'
import { getCurrentPlatformConfig } from './platform-config-store.ts'
import type { PlatformConfig } from './platform-config-schema.ts'
import {
  buildFeishuDigestCardContent,
  dailyTodoDigestKind,
  digestMaxAttempts,
  formatDailyTodoDigest,
  getDigestRetryDelayMs,
  normalizePublicAppUrl,
  resolveDailyDigestSchedule,
  shouldSeedDailyDigestRun,
  type DailyTodoDigestFacts,
  type TodoDigestActivity,
  type TodoDigestOutstandingItem,
} from './todo-digest.ts'

const workerRunLimit = 50
const leaseDurationMinutes = 5
const feishuRequestTimeoutMs = 15_000

type SubscriptionRow = QueryResultRow & {
  id: string
  local_send_time: string
  timezone: string
  updated_at: Date
  user_id: string
}

type DigestRunRow = QueryResultRow & {
  attempts: number
  content: string
  id: string
  local_date: string
  period_end: Date
  period_start: Date
  subscription_id: string
  user_id: string
}

type ActivityRow = QueryResultRow & {
  completed_count: string
  due_date: string
  event_type: 'completed' | 'reopened'
  occurred_at: Date
  priority: string
  project_name: string
  reopened_count: string
  title: string
  todo_id: string | null
}

type OutstandingRow = QueryResultRow & {
  due_date: string
  outstanding_count: string
  overdue_count: string
  priority: string
  project_name: string
  title: string
  todo_id: string
}

type FeishuToken = {
  appId: string
  configRevision: number
  expireAt: number
  token: string
}

let feishuToken: FeishuToken | null = null
let publicAppUrlWarningShown = false
let workerConfig: { config: PlatformConfig; revision: number } | null = null

async function refreshWorkerConfig() {
  const current = await getCurrentPlatformConfig()
  if (!current) throw new Error('Platform configuration is not initialized')
  workerConfig = { config: current.config, revision: current.revision }
  return workerConfig.config
}

function getWorkerConfig() {
  if (!workerConfig) throw new Error('Platform configuration is not loaded')
  return workerConfig.config
}

function getDigestPublicAppUrl() {
  const publicAppUrl = normalizePublicAppUrl(getWorkerConfig().general.publicUrl)
  if (!publicAppUrl && !publicAppUrlWarningShown) {
    publicAppUrlWarningShown = true
    console.warn('APP_PUBLIC_URL is missing or invalid; Feishu digest todo titles will not be linked')
  }
  return publicAppUrl ?? undefined
}

function safeErrorMessage(error: unknown) {
  return (error instanceof Error ? error.message : 'Unknown todo digest worker error').slice(0, 500)
}

function ensureWorkerConfigured() {
  const feishu = getWorkerConfig().feishu
  if (!feishu.deliveryEnabled) return false
  if (!(feishu.appId && feishu.appSecret)) {
    throw new Error('Feishu app credentials are not configured')
  }
  return true
}

async function seedDueDigestRuns(now: Date) {
  const result = await pool.query<SubscriptionRow>(
    `
    select id,
           user_id,
           timezone,
           to_char(local_send_time, 'HH24:MI') as local_send_time,
           updated_at
    from notification_subscriptions
    where kind = $1
      and channel = 'feishu'
      and enabled = true
    order by id
    `,
    [dailyTodoDigestKind],
  )
  let seeded = 0

  for (const subscription of result.rows) {
    try {
      const schedule = resolveDailyDigestSchedule({
        localSendTime: subscription.local_send_time,
        now,
        timeZone: subscription.timezone,
      })
      if (!shouldSeedDailyDigestRun(schedule, subscription.updated_at)) continue

      const inserted = await pool.query(
        `
        insert into notification_digest_runs (
          subscription_id,
          user_id,
          kind,
          local_date,
          period_start,
          period_end,
          status,
          next_attempt_at
        )
        values ($1, $2, $3, $4, $5, $6, 'pending', now())
        on conflict (subscription_id, local_date) do nothing
        `,
        [
          Number(subscription.id),
          Number(subscription.user_id),
          dailyTodoDigestKind,
          schedule.digestLocalDate,
          schedule.periodStart,
          schedule.periodEnd,
        ],
      )
      seeded += inserted.rowCount ?? 0
    } catch (error) {
      console.error('Todo digest subscription schedule is invalid', {
        error: safeErrorMessage(error),
        subscriptionId: Number(subscription.id),
      })
    }
  }

  return seeded
}

async function claimNextDigestRun() {
  const result = await pool.query<DigestRunRow>(
    `
    with expired_terminal_run as (
      update notification_digest_runs
      set status = 'failed',
          lease_until = null,
          last_error = 'Digest delivery lease expired after the final attempt',
          updated_at = now()
      where kind = $1
        and status = 'processing'
        and attempts >= $2
        and (lease_until is null or lease_until <= now())
      returning id
    ), candidate as (
      select id
      from notification_digest_runs
      where kind = $1
        and attempts < $2
        and (
          (status in ('pending', 'retry') and next_attempt_at <= now())
          or (status = 'processing' and (lease_until is null or lease_until <= now()))
        )
      order by next_attempt_at, id
      for update skip locked
      limit 1
    )
    update notification_digest_runs run
    set status = 'processing',
        attempts = run.attempts + 1,
        lease_until = now() + ($3 * interval '1 minute'),
        updated_at = now()
    from candidate
    where run.id = candidate.id
      and run.attempts < $2
      and (
        (run.status in ('pending', 'retry') and run.next_attempt_at <= now())
        or (run.status = 'processing' and (run.lease_until is null or run.lease_until <= now()))
      )
    returning run.id,
              run.subscription_id,
              run.user_id,
              run.local_date::text,
              run.period_start,
              run.period_end,
              run.attempts,
              run.content
    `,
    [dailyTodoDigestKind, digestMaxAttempts, leaseDurationMinutes],
  )
  return result.rows[0] ?? null
}

async function loadDigestFacts(run: DigestRunRow): Promise<DailyTodoDigestFacts> {
  const [activityResult, outstandingResult] = await Promise.all([
    pool.query<ActivityRow>(
      `
      select e.todo_id,
             e.event_type,
             e.title,
             e.due_date::text,
             e.priority,
             e.occurred_at,
             p.name as project_name,
             count(*) filter (where e.event_type = 'completed') over () as completed_count,
             count(*) filter (where e.event_type = 'reopened') over () as reopened_count
      from todo_activity_events e
      join projects p on p.id = e.project_id
      where (e.assignee_user_id = $1 or e.actor_user_id = $1)
        and (
          p.user_id = $1
          or exists (
            select 1
            from project_memberships membership
            where membership.project_id = p.id
              and membership.invited_user_id = $1
              and membership.status = 'active'
          )
        )
        and e.event_type in ('completed', 'reopened')
        and e.occurred_at >= $2
        and e.occurred_at < $3
      order by e.occurred_at, e.id
      limit 40
      `,
      [Number(run.user_id), run.period_start, run.period_end],
    ),
    pool.query<OutstandingRow>(
      `
      select t.id as todo_id,
             t.title,
             t.due_date::text,
             t.priority,
             p.name as project_name,
             count(*) over () as outstanding_count,
             count(*) filter (where t.due_date <= $2::date) over () as overdue_count
      from todos t
      join projects p on p.id = t.project_id
      where (
          t.assignee_user_id = $1
          or (
            t.assignee_user_id is null
            and coalesce(t.created_by_user_id, p.user_id) = $1
          )
        )
        and (
          p.user_id = $1
          or exists (
            select 1
            from project_memberships membership
            where membership.project_id = p.id
              and membership.invited_user_id = $1
              and membership.status = 'active'
          )
        )
        and t.done = false
        and t.confirmation_status = 'confirmed'
      order by t.due_date, case t.priority when 'high' then 0 when 'medium' then 1 else 2 end, t.id
      limit 40
      `,
      [Number(run.user_id), run.local_date],
    ),
  ])
  const firstActivity = activityResult.rows[0]
  const firstOutstanding = outstandingResult.rows[0]
  const activities: TodoDigestActivity[] = activityResult.rows.map((row) => ({
    dueDate: row.due_date,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    priority: row.priority,
    projectName: decryptText(row.project_name),
    title: decryptText(row.title),
    todoId: row.todo_id ? Number(row.todo_id) : null,
  }))
  const outstandingItems: TodoDigestOutstandingItem[] = outstandingResult.rows.map((row) => ({
    dueDate: row.due_date,
    priority: row.priority,
    projectName: decryptText(row.project_name),
    title: decryptText(row.title),
    todoId: Number(row.todo_id),
  }))

  return {
    activities,
    completedCount: Number(firstActivity?.completed_count ?? 0),
    digestLocalDate: run.local_date,
    outstandingCount: Number(firstOutstanding?.outstanding_count ?? 0),
    outstandingItems,
    overdueCount: Number(firstOutstanding?.overdue_count ?? 0),
    reopenedCount: Number(firstActivity?.reopened_count ?? 0),
  }
}

async function persistDigestContent(runId: number, content: string) {
  await pool.query(
    `
    update notification_digest_runs
    set content = $2,
        updated_at = now()
    where id = $1
      and status = 'processing'
    `,
    [runId, encryptText(content)],
  )
}

async function resolveFeishuOpenId(userId: number) {
  const result = await pool.query<{ feishu_user_id: string | null }>(
    'select feishu_user_id from users where id = $1',
    [userId],
  )
  const openId = String(result.rows[0]?.feishu_user_id ?? '').trim()
  return openId.startsWith('ou_') ? openId : null
}

async function isDigestSubscriptionEnabled(subscriptionId: number, userId: number) {
  const result = await pool.query<{ enabled: boolean }>(
    `
    select enabled
    from notification_subscriptions
    where id = $1
      and user_id = $2
      and kind = $3
      and channel = 'feishu'
    `,
    [subscriptionId, userId, dailyTodoDigestKind],
  )
  return result.rows[0]?.enabled === true
}

async function getFeishuTenantAccessToken() {
  const now = Date.now()
  const { appId, appSecret } = getWorkerConfig().feishu
  const configRevision = workerConfig?.revision ?? 0
  if (
    feishuToken?.appId === appId &&
    feishuToken.configRevision === configRevision &&
    feishuToken.expireAt > now + 60_000
  ) return feishuToken.token
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), feishuRequestTimeoutMs)

  try {
    const result = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      body: JSON.stringify({
        app_id: appId,
        app_secret: appSecret,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: controller.signal,
    })
    const data = await result.json() as {
      code?: number
      expire?: number
      msg?: string
      tenant_access_token?: string
    }
    if (!result.ok || data.code !== 0 || !data.tenant_access_token) {
      throw new Error(`Failed to fetch Feishu tenant token: ${data.msg ?? result.statusText}`)
    }
    feishuToken = {
      appId,
      configRevision,
      expireAt: now + Math.max(60, data.expire ?? 7_000) * 1_000,
      token: data.tenant_access_token,
    }
    return feishuToken.token
  } finally {
    clearTimeout(timeout)
  }
}

async function sendFeishuDigest(openId: string, content: string) {
  const token = await getFeishuTenantAccessToken()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), feishuRequestTimeoutMs)

  try {
    const result = await fetch(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
      {
        body: JSON.stringify({
          content: buildFeishuDigestCardContent(content, getDigestPublicAppUrl()),
          msg_type: 'interactive',
          receive_id: openId,
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal: controller.signal,
      },
    )
    const data = await result.json() as { code?: number; msg?: string }
    if (!result.ok || data.code !== 0) {
      throw new Error(`Feishu digest send failed: ${data.msg ?? result.statusText}`)
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function markDigestSent(runId: number) {
  await pool.query(
    `
    update notification_digest_runs
    set status = 'sent',
        lease_until = null,
        last_error = '',
        delivered_at = now(),
        updated_at = now()
    where id = $1
      and status = 'processing'
    `,
    [runId],
  )
}

async function markDigestSkipped(runId: number, reason: string) {
  await pool.query(
    `
    update notification_digest_runs
    set status = 'skipped',
        lease_until = null,
        last_error = $2,
        updated_at = now()
    where id = $1
      and status = 'processing'
    `,
    [runId, reason.slice(0, 500)],
  )
}

async function markDigestFailed(run: DigestRunRow, error: unknown) {
  const terminal = run.attempts >= digestMaxAttempts
  const nextAttemptAt = new Date(Date.now() + getDigestRetryDelayMs(run.attempts))
  await pool.query(
    `
    update notification_digest_runs
    set status = $2,
        lease_until = null,
        next_attempt_at = $3,
        last_error = $4,
        updated_at = now()
    where id = $1
      and status = 'processing'
    `,
    [
      Number(run.id),
      terminal ? 'failed' : 'retry',
      nextAttemptAt,
      safeErrorMessage(error),
    ],
  )
  return terminal
}

async function processDigestRun(run: DigestRunRow) {
  try {
    await refreshWorkerConfig()
    if (!ensureWorkerConfigured()) {
      await markDigestSkipped(Number(run.id), 'Feishu delivery is disabled')
      return 'skipped' as const
    }
    if (!await isDigestSubscriptionEnabled(Number(run.subscription_id), Number(run.user_id))) {
      await markDigestSkipped(Number(run.id), 'Daily todo digest subscription is disabled')
      return 'skipped' as const
    }
    const openId = await resolveFeishuOpenId(Number(run.user_id))
    if (!openId) {
      await markDigestSkipped(Number(run.id), 'Feishu account is not bound to an open_id')
      return 'skipped' as const
    }

    let content = run.content ? decryptText(run.content) : ''
    if (!content) {
      content = formatDailyTodoDigest(await loadDigestFacts(run))
      await persistDigestContent(Number(run.id), content)
    }
    await sendFeishuDigest(openId, content)
    await markDigestSent(Number(run.id))
    return 'sent' as const
  } catch (error) {
    console.error('Todo digest delivery failed', {
      error: safeErrorMessage(error),
      runId: Number(run.id),
    })
    const terminal = await markDigestFailed(run, error)
    return terminal ? 'failed' as const : 'retry' as const
  }
}

export async function runTodoDigestWorker(now = new Date()) {
  await refreshWorkerConfig()
  if (!ensureWorkerConfigured()) {
    return { failed: 0, processed: 0, retry: 0, seeded: 0, sent: 0, skipped: 0 }
  }

  const seeded = await seedDueDigestRuns(now)
  const totals = { failed: 0, processed: 0, retry: 0, seeded, sent: 0, skipped: 0 }
  while (totals.processed < workerRunLimit) {
    const run = await claimNextDigestRun()
    if (!run) break
    const result = await processDigestRun(run)
    totals[result] += 1
    totals.processed += 1
  }
  return totals
}

async function main() {
  try {
    const totals = await runTodoDigestWorker()
    console.log('Todo digest worker completed', totals)
  } catch (error) {
    console.error('Todo digest worker failed', { error: safeErrorMessage(error) })
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (entrypoint === import.meta.url) void main()
