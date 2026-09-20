import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'

import {
  AI_TURN_DOCUMENT_TITLE_MAX_CHARACTERS,
  AiTurnDocumentError,
  createAiTurnDocument,
  deriveAiTurnDocumentTitle,
  type AiTurnDocumentDependencies,
} from './ai-turn-document.ts'

const conversationId = '11111111-1111-4111-8111-111111111111'
const turnId = '22222222-2222-4222-8222-222222222222'
const serverIndexSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

type HarnessOptions = {
  activeMember?: boolean
  assistantContent?: string | null
  contextKind?: string
  conversationProjectId?: string | null
  intentKind?: string
  ownerUserId?: string
  status?: string
  turnBelongsToConversation?: boolean
  userContent?: string
}

function queryResult<Row extends QueryResultRow>(rows: Row[] = []): QueryResult<Row> {
  return {
    command: '',
    fields: [],
    oid: 0,
    rowCount: rows.length,
    rows,
  }
}

function createHarness(options: HarnessOptions = {}) {
  const queries: Array<{ params: unknown[]; text: string }> = []
  const summaries = new Map<string, number>()
  let nextSummaryId = 41
  const values = {
    activeMember: options.activeMember ?? true,
    assistantContent: options.assistantContent === undefined ? 'enc:先处理发布验证，再补充运行手册。' : options.assistantContent,
    contextKind: options.contextKind ?? 'project',
    conversationProjectId: options.conversationProjectId === undefined ? '17' : options.conversationProjectId,
    intentKind: options.intentKind ?? 'chat',
    ownerUserId: options.ownerUserId ?? '3',
    status: options.status ?? 'completed',
    turnBelongsToConversation: options.turnBelongsToConversation ?? true,
    userContent: options.userContent ?? 'enc: 请帮我梳理\n下一步应该怎么做？ ',
  }

  const client = {
    query: async (text: string, params: unknown[] = []) => {
      queries.push({ params, text })
      if (text.includes('from ai_conversations')) {
        return queryResult([{
          contextKind: values.contextKind,
          projectId: values.conversationProjectId,
        }])
      }
      if (text.includes('from projects where')) {
        return queryResult([{ ownerUserId: values.ownerUserId }])
      }
      if (text.includes('from project_memberships')) {
        return queryResult(values.activeMember ? [{ id: '9' }] : [])
      }
      if (text.includes('from ai_turns')) {
        return queryResult(values.turnBelongsToConversation ? [{
          assistantContent: values.assistantContent,
          intentKind: values.intentKind,
          status: values.status,
          userContent: values.userContent,
        }] : [])
      }
      if (text.includes('from summaries') && text.includes('source_turn_id = $1')) {
        const id = summaries.get(String(params[0]))
        return queryResult(
          id && params[1] === 7 && params[2] === 17 ? [{ id: String(id) }] : [],
        )
      }
      if (text.includes('insert into summaries')) {
        const sourceTurnId = String(params[5])
        if (summaries.has(sourceTurnId)) return queryResult([])
        const id = nextSummaryId
        nextSummaryId += 1
        summaries.set(sourceTurnId, id)
        return queryResult([{ id: String(id) }])
      }
      return queryResult()
    },
    release: () => undefined,
  } as unknown as PoolClient
  const database = {
    connect: async () => client,
  } as unknown as Pick<Pool, 'connect'>
  const dependencies: AiTurnDocumentDependencies = {
    database,
    decryptText: (value) => value.startsWith('enc:') ? value.slice(4) : value,
    encryptText: (value) => `encrypted:${value}`,
  }
  return { dependencies, queries }
}

function input() {
  return { conversationId, turnId, userId: 7 }
}

test('rejects malformed identifiers before opening a transaction', async () => {
  const { dependencies, queries } = createHarness()
  const invalidInputs = [
    { conversationId: 'not-a-uuid', turnId, userId: 7 },
    { conversationId, turnId: 'not-a-uuid', userId: 7 },
    { conversationId, turnId, userId: 0 },
  ]

  for (const invalidInput of invalidInputs) {
    await assert.rejects(
      createAiTurnDocument(invalidInput, dependencies),
      (error: unknown) =>
        error instanceof AiTurnDocumentError && error.code === 'AI_ID_INVALID',
    )
  }
  assert.deepEqual(queries, [])
})

test('saves canonical completed project chat content as a reply document', async () => {
  const { dependencies, queries } = createHarness()

  assert.deepEqual(await createAiTurnDocument(input(), dependencies), {
    created: true,
    summaryId: 41,
  })

  const projectLockIndex = queries.findIndex(({ text }) => text.includes('pg_advisory_xact_lock'))
  const lockedConversationIndex = queries.findIndex(({ text }) =>
    text.includes('from ai_conversations') && text.includes('for share'))
  assert.ok(projectLockIndex >= 0 && projectLockIndex < lockedConversationIndex)
  assert.ok(queries.some(({ text }) =>
    text.includes('from project_memberships') && text.includes("status = 'active'") && text.includes('for share')))

  const insert = queries.find(({ text }) => text.includes('insert into summaries'))
  assert.ok(insert)
  assert.match(insert.text, /'reply'/u)
  assert.match(insert.text, /on conflict \(source_turn_id\)/u)
  assert.ok(queries.some(({ params, text }) =>
    text.includes('from summaries') &&
    text.includes('source_turn_id = $1') &&
    text.includes('user_id = $2') &&
    text.includes('project_id = $3') &&
    params[1] === 7 &&
    params[2] === 17))
  assert.deepEqual(insert.params, [
    7,
    17,
    'encrypted:请帮我梳理 下一步应该怎么做？',
    'encrypted:对话文档',
    'encrypted:先处理发布验证，再补充运行手册。',
    turnId,
  ])
  assert.equal(queries.at(-1)?.text, 'commit')
})

test('derives a visible bounded title from the canonical question', () => {
  assert.equal(deriveAiTurnDocumentTitle('\n\t 接下来怎么办？\u0000 '), '接下来怎么办？')
  assert.equal(deriveAiTurnDocumentTitle(''), 'AI 对话回复')
  const title = deriveAiTurnDocumentTitle('问'.repeat(100))
  assert.equal(Array.from(title).length, AI_TURN_DOCUMENT_TITLE_MAX_CHARACTERS)
  assert.match(title, /\.\.\.$/u)
})

test('workspace visibility keeps reply documents private to their creator', () => {
  const summariesQuery = serverIndexSource.match(
    /select id, project_id, source_turn_id, type, title, period, content, created_at[\s\S]*?order by created_at desc, id desc/u,
  )?.[0] ?? ''

  assert.match(summariesQuery, /where \(\s*user_id = \$1/u)
  assert.match(
    summariesQuery,
    /type <> 'reply'[\s\S]*?p\.id = summaries\.project_id/u,
  )
  assert.match(summariesQuery, /p\.user_id = \$1/u)
  assert.match(summariesQuery, /managedOrganizationReadScopeSql\('p\.organization_id'\)/u)
})

test('rejects invalid conversation context, turn state, turn intent, and blank replies', async (t) => {
  const cases: Array<{
    code: string
    name: string
    options: HarnessOptions
  }> = [
    {
      code: 'AI_DOCUMENT_PROJECT_CONTEXT_REQUIRED',
      name: 'general conversation',
      options: { contextKind: 'general', conversationProjectId: null },
    },
    {
      code: 'AI_DOCUMENT_TURN_NOT_COMPLETED',
      name: 'processing turn',
      options: { status: 'processing' },
    },
    {
      code: 'AI_DOCUMENT_TURN_UNSUPPORTED',
      name: 'project-summary turn',
      options: { intentKind: 'project-summary' },
    },
    {
      code: 'AI_DOCUMENT_ASSISTANT_EMPTY',
      name: 'blank assistant content',
      options: { assistantContent: 'enc:   ' },
    },
    {
      code: 'AI_TURN_NOT_FOUND',
      name: 'turn from another conversation',
      options: { turnBelongsToConversation: false },
    },
  ]

  for (const item of cases) {
    await t.test(item.name, async () => {
      const { dependencies, queries } = createHarness(item.options)
      await assert.rejects(
        createAiTurnDocument(input(), dependencies),
        (error: unknown) => error instanceof AiTurnDocumentError && error.code === item.code,
      )
      assert.equal(queries.at(-1)?.text, 'rollback')
      assert.equal(queries.some(({ text }) => text.includes('insert into summaries')), false)
    })
  }
})

test('hides a project after active membership is lost inside the transaction', async () => {
  const { dependencies, queries } = createHarness({ activeMember: false })

  await assert.rejects(
    createAiTurnDocument(input(), dependencies),
    (error: unknown) =>
      error instanceof AiTurnDocumentError &&
      error.code === 'AI_PROJECT_NOT_FOUND' &&
      error.status === 404,
  )
  assert.equal(queries.at(-1)?.text, 'rollback')
  assert.equal(queries.some(({ text }) => text.includes('from ai_turns')), false)
})

test('repeated saves return the same summary and report whether it was created', async () => {
  const { dependencies } = createHarness({ ownerUserId: '7' })

  const first = await createAiTurnDocument(input(), dependencies)
  const second = await createAiTurnDocument(input(), dependencies)

  assert.deepEqual(first, { created: true, summaryId: 41 })
  assert.deepEqual(second, { created: false, summaryId: 41 })
})

test('conflict reconciliation returns the concurrently-created summary id', async () => {
  const { dependencies } = createHarness({ ownerUserId: '7' })

  const results = await Promise.all([
    createAiTurnDocument(input(), dependencies),
    createAiTurnDocument(input(), dependencies),
  ])

  assert.deepEqual(results.map(({ created }) => created).sort(), [false, true])
  assert.deepEqual(new Set(results.map(({ summaryId }) => summaryId)), new Set([41]))
})
