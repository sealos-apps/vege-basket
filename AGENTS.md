# AGENTS.md

## Repository Shape

Veges is a React/Vite client and Express/PostgreSQL server shipped as one Node 24
container. Read `docs/architecture.md` before changing cross-module behavior,
`docs/references.md` for current interfaces and environment variables, and
`docs/runbook.md` before runtime or deployment work. The early PRD under `docs/` is
historical product context; current code and these operational docs take precedence.

## Ownership Boundaries

- Keep browser behavior in `src/`; database access, secrets, authorization, and external
  credentials belong in `server/`.
- `server/index.ts` owns HTTP trust boundaries. Every protected route must authenticate,
  and every nested project resource must be joined or checked against the authorized
  project ID.
- `server/schema.ts` owns database constraints. Application validation improves errors;
  database uniqueness and foreign keys preserve integrity under concurrency.
- Multi-table mutations must use one `PoolClient` transaction. Validate the complete
  request before the first write and roll back every partial failure.
- When one PostgreSQL placeholder is reused across `CASE`, `coalesce`, or differently
  typed columns, cast every SQL occurrence explicitly. JavaScript parameter values do
  not resolve parse-time ambiguity between types such as `text` and `bigint`.
- Keep client contracts in `src/api.ts` and `src/types.ts` synchronized with server
  response shapes.
- Keep occupational roles separate from resource permissions. Test and Bug workbenches
  require the active `tester` or `developer` persona. An assigned `organization_admin`
  role may assume any business persona. In organizations where the account also has active
  `owner` or `admin` membership, it may govern attached project lifecycle status, health,
  and milestones, and receives organization-scoped read access to projects, test spaces,
  and Bugs. Other resource mutations still require the original project membership,
  test-space access, creator, or Bug-assignee permission. System-administrator access comes
  only from `VEGES_ADMIN_USERNAMES`, not from an occupational role.
- Keep document editors on the existing Markdown string contract. When registering
  `CodeBlockLowlight`, disable StarterKit's plain code block, preserve fenced-language
  metadata, highlight only an explicit supported language, and normalize link marks to
  HTTP or HTTPS before parsing or saving them.

## Security And Data Invariants

- Never commit or log database URLs, session tokens, encryption keys, AI keys, Feishu
  secrets, OSS credentials, or signed URLs.
- Sensitive project text must use `encryptText` on write and `decryptText` on read. New
  encrypted columns require an idempotent `db:encrypt-existing` path for legacy rows.
  Retain old keys while any stored envelope references them.
- Do not weaken AI URL validation: HTTPS only, no embedded credentials, public DNS/IPs
  only, and no redirect following. Pin validated addresses to the outbound AI connection
  while preserving the original hostname for TLS SNI and the HTTP Host header.
- Shared AI uses only `AI_API_BASE`, `AI_API_KEY`, and `AI_MODEL`. Do not restore
  user-level AI settings. While shared AI is configured, password registration must
  require an active project invite; keep both per-user and instance-wide request limits.
- AI conversations are private to one user and have an immutable `general`, `project`, or
  `conversation-analysis` context. Changing or removing `@项目` starts a blank conversation;
  never rebind an existing conversation or combine history from different contexts. General
  chat receives no implicit project or workspace facts. Only an explicit current daily or
  weekly `workspace-review` intent may load cross-project facts in a general conversation.
  Persist every source project in `ai_turn_project_sources`; reauthorize those sources before
  returning the turn or including it in later model history. Keep the source row after project
  deletion so deleted or inaccessible facts cannot reappear through general chat history.
- PostgreSQL is the canonical AI-history source. Before creating a turn, classify its semantic
  intent with the shared server AI provider using strict JSON and no project or workspace facts.
  Ambiguous, negated, capability-discussion, and historical-period input must remain `chat`; do
  not restore regex routing or silently downgrade a classifier failure. Bind the classification
  to the user, turn UUID, exact content/attachments, and source context in
  `ai_intent_classifications`. The first claim alone may call the classifier; replay returns the
  stored encrypted result, and canonical turn creation consumes it in the same transaction that
  writes the turn. Store only the bounded kind/period result in the receipt; hydrate todo source
  content from the revalidated canonical input during consumption. Bind exact input with a keyed
  digest that verifies through its stored retained-key ID, opportunistically delete terminal or
  abandoned receipts after seven days, and keep classification HTTP rate/concurrency limits
  separate from first-claim provider admission. An unconsumed completed classification expires
  after two minutes so receipts cannot stockpile future provider work; bound canonical turn model
  execution separately per user and application replica. A consumed receipt may be satisfied only
  by the existing canonical turn lookup; it must never create a replacement turn after conversation
  deletion. Use PostgreSQL `clock_timestamp()` for receipt lease and TTL decisions so transaction
  lock waits cannot freeze liveness time. A dropped classification request must abort its provider
  call. The browser may receive only the bounded DTO and cannot submit a trusted intent or todo
  source. Derive target conversation context through the shared pure helper, while the server
  remains responsible for authorization and HTTP error mapping.
- The browser submits one new user turn, its client UUID, and optional text attachments after the
  classification receipt is complete; it must never submit assistant history. Keep turn creation
  idempotent, permit only one processing turn per conversation, and use
  lease-token checks so cancellation, retry, or a stale provider response cannot write twice.
  A cancel that arrives before turn creation must leave a bounded server-canonical
  `ai_turn_cancellations` claim so every delayed replay is rejected before it can call the
  provider. Serialize claim lookup and creation with the per-user cancellation advisory lock,
  and never rebind a turn UUID claim to another conversation. Do not hold a database transaction
  open while calling the external AI provider.
- Ordinary AI replies remain conversation history by default. Converting a completed project-chat
  reply to a document must submit only its conversation and turn IDs; read canonical content and
  recheck project access on the server in the insert transaction. Link the encrypted `reply`
  summary through `source_turn_id`, keep it visible only to its creating user, never serialize it
  as a generated-summary turn outcome, and preserve the unique one-turn/one-document invariant.
- Keep AI turn transport on the shared `started`, `delta`, `progress`, `heartbeat`, `completed`,
  `failed`, and `cancelled` SSE contract. Ordinary chat and conversation analysis may stream
  text deltas; project summaries, workspace reviews, and todo extraction may expose only fixed
  progress phases until the canonical result is committed. A dropped browser connection must not cancel canonical
  execution, while an explicit stop must still use the cancel route. Recheck project access and
  the active lease before every project-bound delta or completion. Treat PostgreSQL, not a
  terminal stream frame or partial text, as the final turn and artifact source of truth.
- Recheck project access when listing, reading, sending, retrying, and completing a project
  conversation. Lost access hides the conversation; project deletion removes it. Deleting a
  conversation must preserve saved summaries and already-created todos, while a linked pending
  proposal batch may be deleted with its source turn. Record a permanent
  `ai_conversation_tombstones` row before deleting conversation history so a delayed request
  cannot recreate the same conversation UUID.
- Project-bound AI turn creation/completion, proposal confirmation, and project deletion must
  share the same project advisory lock. Acquire multiple project locks in numeric order.
- Keep Veges AI as one composer-only chat surface with no visible capability tabs or
  assistant modes. The empty conversation may show one row of three prompt cards, but each
  card must send a complete natural-language message through the same composer path and
  disappear once the user types, attaches a file, or sends. Trigger summary, Markdown todo
  extraction, and conversation analysis only from explicit natural-language intent;
  ambiguous input remains ordinary chat. Select at most one project context through `@`,
  store its project ID separately from display text, and keep capability routing internal.
  Proposal review and result artifacts may open on demand instead of remaining beside the
  conversation.
- Keep processing, stream-reconciliation, failed, and cancelled feedback inside the related
  assistant message. A known terminal state must release the composer immediately; any follow-up
  canonical fetch is best-effort. Do not add a second page-level error banner for the same turn,
  and do not visually dim the user's source message when the assistant turn fails.
- AI composer attachments are browser-read text, not separately uploaded objects. Accept
  at most four supported text files, 64 KiB each and 20,000 combined characters; keep the
  original name and content encrypted with the source turn while returning only safe name/size
  metadata to the browser. Never derive project identity from attachment content or filenames.
  Invalidate pending file reads before a project change, context removal, conversation reset,
  or unmount so stale content cannot reappear in another project context.
- Dedicated project-summary generation requires a selected `@` project ID and current
  daily or weekly intent. Do not broaden a missing project context to the whole workspace,
  and do not map historical date wording onto the current daily or weekly endpoint.
- Explicit current-day or current-week workspace review runs only without `@项目` and without
  attachments. Load the authorized project catalog, the user's own period journals, scoped todo
  activity, current actionable todos, and current risks on the server. Owner projects may expose
  all project todo facts; member projects may expose only the user's related activity and assigned
  todos. Keep bounded detail samples labeled as samples rather than reporting partial totals as
  exhaustive.
- Conversation analysis must clear visible project context because that agent does not
  receive project facts. Selecting a non-null `@` project must atomically restore the
  project-aware agent before a message can be sent.
- Do not sign or fetch arbitrary OSS object keys. Package keys must match configured
  rules/templates; todo images use their dedicated prefix and HMAC signature.
- Feishu event challenges and events require the verification token. Conversation
  analysis requires configured Basic authentication.
- Feishu AI chat must remain opt-in, private-chat only, and limited to users bound by
  `feishu_user_id`. It must reuse canonical AI intent receipts, turns, rate limits, and
  authorization; inbound source content and processing errors remain encrypted.
- Keep daily digest run content as encrypted, deterministic, readable text. Feishu
  delivery may wrap it in a passive JSON 2.0 card, but must not add callbacks, buttons,
  arbitrary URLs, or other actions. A todo title may link only to a server-generated
  same-site URL built from validated `APP_PUBLIC_URL` and its positive canonical todo ID.
  Escape current user-controlled item text for Lark Markdown, and render legacy `Veges
  待办日报 | YYYY-MM-DD` bodies as Markdown literals before retrying them.
- Organization project modules are managed only by active organization owner/admin members
  with the `organization_admin` account role. Keep project-local module IDs as stable todo/AI
  foreign keys; disabled/unmatched history may be retained, never newly selected. Catalog
  changes and attachment/deletion take the organization advisory lock, then sorted project
  locks, then manager membership/role locks. Do not strengthen the initial organization
  `FOR KEY SHARE` lock before project locks: governance audit foreign keys would deadlock.
  Keep names encrypted and retain the lookup key recorded in `project_module_settings`
  across active encryption-key rotation. Initialization imports the organization name union
  once; workspace reads must never backfill it.
- Test-case directory and assignment writes must lock the test space, then test subject,
  then resources, and recheck access in the transaction. Lock multiple spaces and subjects
  in numeric order for space imports. Directories may be deleted only when they have no
  child directories or directly assigned cases; never silently reassign their contents.
  Preserve encrypted names, sibling-scoped blind indexes, and existing case/plan snapshots.
- Concurrency invariants belong in PostgreSQL unique indexes plus conflict-safe SQL, not
  select-before-insert checks alone.
- Todo completion and reopen transitions must lock the todo row inside the same
  transaction before updating `completed_at`, `completed_by_user_id`, or activity events.

## Database Safety

New Bugs must reference a canonical case in the same test space; derive the subject from
the case and keep the composite database FK. Never infer legacy case associations from
titles. Referenced cases and subjects with Bugs cannot be deleted individually. Bug directory
filters use the case's current folder, and Bug lists must not be scoped by selected subject.
Single-Bug space transfers require an existing destination case and clear execution links.

Never execute database writes unless the user explicitly authorizes them. Starting
`server/index.ts`, `npm run dev:api`, `npm run db:init`, and
`npm run db:encrypt-existing` all mutate the configured database because startup applies
`schemaSql`. Do not point local verification at production.

## Verification

Use current, non-database checks first:

```bash
npm run build
npm run lint
npm test
git diff --check
```

For scoped work, run ESLint against the touched TypeScript files. The focused Node test
suite covers notification policy, OSS endpoint normalization, AI provider and parsing
rules, AI conversation domain/client state, rate limiting, and digest scheduling; do not claim
database, OSS, Feishu, browser, or deployment behavior is verified unless that surface
was exercised in an authorized environment.

## Deployment

- Production container images default to `linux/amd64`; publish ARM only when explicitly
  requested.
- Use immutable image tags or digests. Keep `VEGES_IMAGE` as the single Sealos template
  source for `originImageName`, the application container, and the todo-digest CronJob;
  verify both live workload images after deployment.
- `.sealos/build/build-result.json` and `.sealos/state.json` are receipts, not proof of
  current source or runtime state.
- App rollback does not roll back PostgreSQL. Keep a pre-release database snapshot and
  the complete encryption key ring for any deploy-affecting schema or encryption change.
- Do not deploy, publish, run migrations, or mutate production without explicit approval.
