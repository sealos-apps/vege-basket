import { pool, query } from './db.ts'
import { assertEncryptionConfigured, encryptJson, encryptText } from './crypto.ts'
import { schemaSql } from './schema.ts'
import { initializeProjectModules } from './project-modules.ts'

const today = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
}).format(new Date())

async function insertProject({
  journals,
  name,
  risks,
  status,
  tags,
  todos,
  userId,
}: {
  journals: Array<{ content: string; createdAt: string }>
  name: string
  risks: string[]
  status: string
  tags: string[]
  todos: Array<{ title: string; dueDate: string; priority: string; done: boolean }>
  userId: number
}) {
  const projectResult = await query<{ id: string }>(
    `
    insert into projects (user_id, name, status, tags, tags_encrypted)
    values ($1, $2, $3, '{}', $4)
    returning id
    `,
    [userId, encryptText(name), status, encryptJson(tags)],
  )
  const projectId = Number(projectResult.rows[0].id)

  for (const journal of journals) {
    await query(
      `
      insert into journal_entries (project_id, content, created_at, author_user_id, visibility)
      values ($1, $2, $3::timestamp at time zone 'Asia/Shanghai', $4, 'private')
      `,
      [projectId, encryptText(journal.content), journal.createdAt, userId],
    )
  }

  for (const risk of risks) {
    await query(
      `
      insert into risks (project_id, content)
      values ($1, $2)
      on conflict (project_id, content) do nothing
      `,
      [projectId, encryptText(risk)],
    )
  }

  for (const todo of todos) {
    await query(
      `
      insert into todos (project_id, title, due_date, priority, done, created_by_user_id)
      values ($1, $2, $3, $4, $5, $6)
      `,
      [projectId, encryptText(todo.title), todo.dueDate, todo.priority, todo.done, userId],
    )
  }

  return projectId
}

async function main() {
  assertEncryptionConfigured()
  await query(schemaSql)
  await initializeProjectModules(pool)

  const userResult = await query<{ id: string }>(
    `
    insert into users (email, password_hash)
    values ($1, $2)
    on conflict (email) do update set email = excluded.email
    returning id
    `,
    ['felix', 'project-baskets'],
  )
  const userId = Number(userResult.rows[0].id)

  const countResult = await query<{ count: string }>(
    'select count(*)::text as count from projects where user_id = $1',
    [userId],
  )

  if (Number(countResult.rows[0].count) === 0) {
    const projectOneId = await insertProject({
      userId,
      name: 'AIGC 内容工作台',
      status: 'active',
      tags: ['AI', '内容生产', 'MVP'],
      risks: ['模型输出质量波动，需要确认评估标准'],
      journals: [
        {
          createdAt: `${today} 15:20:00`,
          content:
            '确认第一版以批量生成和人工精修为核心，不做复杂团队协作。下一步需要整理内容模板和评估维度。',
        },
        {
          createdAt: '2026-05-14 18:40:00',
          content:
            '和设计侧讨论了编辑器结构，决定先保留单栏写作体验，把素材面板放到右侧抽屉。',
        },
      ],
      todos: [
        {
          title: '整理内容模板的评估维度',
          dueDate: today,
          priority: 'high',
          done: false,
        },
      ],
    })

    const projectTwoId = await insertProject({
      userId,
      name: '数据看板重构',
      status: 'active',
      tags: ['数据', '体验优化'],
      risks: ['旧指标口径不一致，可能影响上线验收'],
      journals: [
        {
          createdAt: `${today} 11:05:00`,
          content:
            '梳理了核心指标口径，发现转化漏斗和留存报表的数据源不一致，需要约业务方统一定义。',
        },
      ],
      todos: [
        {
          title: '约业务方确认转化漏斗口径',
          dueDate: today,
          priority: 'high',
          done: false,
        },
      ],
    })

    await insertProject({
      userId,
      name: '内部知识库迁移',
      status: 'paused',
      tags: ['知识库', '迁移'],
      risks: ['历史文档质量参差，自动整理前需要抽样检查'],
      journals: [
        {
          createdAt: '2026-05-14 19:06:00',
          content:
            '导入了第一批历史 Markdown。暂时不做结构化解析，先进入草稿箱，后续用 AI 帮助归类。',
        },
      ],
      todos: [
        {
          title: '抽样检查 20 篇迁移文档',
          dueDate: '2026-05-17',
          priority: 'medium',
          done: false,
        },
      ],
    })

    await insertProject({
      userId,
      name: '支付链路稳定性',
      status: 'completed',
      tags: ['交易', '稳定性'],
      risks: [],
      journals: [
        {
          createdAt: '2026-05-12 17:30:00',
          content: '完成异常重试策略复盘，产出上线后监控清单。',
        },
      ],
      todos: [
        {
          title: '补充监控清单归档链接',
          dueDate: '2026-05-13',
          priority: 'low',
          done: true,
        },
      ],
    })

    await query(
      `
      insert into draft_items (user_id, source, content, suggested_project_id, processed, created_at)
      values
        ($1, 'manual', $2, $3, false, now()),
        ($1, 'feishu', $4, $5, false, now()),
        ($1, 'manual', $6, null, true, now() - interval '1 day')
      `,
      [
        userId,
        encryptText('想到一个 AIGC 工作台的关键点：生成结果需要能按品牌语气做二次筛选，不只是批量产出。'),
        projectOneId,
        encryptText('飞书群转发：业务方反馈数据看板里“激活用户”的口径和周报不一致，希望本周先统一。'),
        projectTwoId,
        encryptText('知识库迁移可以先用 AI 做主题聚类，但不要自动改原文。'),
      ],
    )

    await query(
      `
      insert into summaries (project_id, type, title, period, content)
      values ($1, 'weekly', $2, $3, $4)
      `,
      [
        projectOneId,
        encryptText('第 20 周周总结'),
        encryptText('2026-05-11 至 2026-05-15'),
        encryptText('本周明确了 AIGC 内容工作台的第一版边界：批量生成、人工精修、模板评估。主要风险是模型输出质量稳定性，建议下周先建立小样本评估表。'),
      ],
    )
  }

  console.log('Database schema is ready.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
