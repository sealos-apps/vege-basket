import type { AiTodoPriority } from './ai-todo-proposals.ts'
import { normalizePublicAppUrl } from './todo-digest.ts'

export type FeishuAiProposalCardItem = {
  assigneeName: string | null
  dueDate: string | null
  moduleName: string | null
  priority: AiTodoPriority
  projectName: string | null
  title: string
}

const priorityLabels: Record<AiTodoPriority, string> = {
  high: '高',
  low: '低',
  medium: '中',
}

export function isFeishuAiChatEnabled(value: unknown = false) {
  return String(value ?? '').trim().toLowerCase() === 'true'
}

export function shouldRetainFeishuAiSource(params: {
  contextKind: 'conversation-analysis' | 'general' | 'project'
  hasPendingTodoProposals: boolean
  outcomeType: 'summary' | 'todo-proposals' | null
}) {
  return params.contextKind === 'conversation-analysis' ||
    params.hasPendingTodoProposals ||
    params.outcomeType === 'todo-proposals'
}

export function buildFeishuAiReviewUrl(
  batchId: number,
  publicAppUrl = '',
  nodeEnv = process.env.NODE_ENV,
) {
  if (!Number.isSafeInteger(batchId) || batchId <= 0) return null
  const origin = normalizePublicAppUrl(publicAppUrl, nodeEnv)
  if (!origin) return null
  const url = new URL(origin)
  url.searchParams.set('aiTodoBatch', String(batchId))
  return url.toString()
}

function escapeLarkMarkdown(value: unknown) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('*', '\\*')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]')
    .replaceAll('`', '\\`')
    .trim()
}

function boundedMarkdown(value: unknown, maxLength: number) {
  const text = escapeLarkMarkdown(value)
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}…`
}

export function buildFeishuAiReplyCard(message: string) {
  return {
    config: { wide_screen_mode: true },
    elements: [
      {
        tag: 'div',
        text: {
          content: boundedMarkdown(message, 12_000) || '分析已完成。',
          tag: 'lark_md',
        },
      },
      {
        tag: 'note',
        elements: [{ content: '可以直接回复这条私聊继续追问。', tag: 'plain_text' }],
      },
    ],
    header: {
      template: 'green',
      title: { content: 'Veges AI', tag: 'plain_text' },
    },
  }
}

export function buildFeishuAiTodoProposalCard(params: {
  batchId: number
  proposals: FeishuAiProposalCardItem[]
  reviewUrl: string | null
}) {
  const lines = params.proposals.slice(0, 20).map((proposal, index) => {
    const metadata = [
      proposal.projectName ? `项目：${boundedMarkdown(proposal.projectName, 80)}` : '项目：待确认',
      `截止：${proposal.dueDate || '待确认'}`,
      `优先级：${priorityLabels[proposal.priority]}`,
      proposal.moduleName ? `模块：${boundedMarkdown(proposal.moduleName, 80)}` : '',
      proposal.assigneeName ? `负责人：${boundedMarkdown(proposal.assigneeName, 80)}` : '',
    ].filter(Boolean).join(' · ')
    return `**${index + 1}. ${boundedMarkdown(proposal.title, 160)}**\n${metadata}`
  })
  const actions: Array<Record<string, unknown>> = [
    {
      tag: 'button',
      text: { content: '创建全部', tag: 'plain_text' },
      type: 'primary',
      value: {
        action: 'feishu_ai_todo_confirm_all',
        batchId: params.batchId,
      },
    },
  ]
  if (params.reviewUrl) {
    actions.push({
      tag: 'button',
      text: { content: '进入 Veges 编辑', tag: 'plain_text' },
      type: 'default',
      url: params.reviewUrl,
    })
  }
  return {
    config: { wide_screen_mode: true },
    elements: [
      {
        tag: 'div',
        text: {
          content: lines.join('\n\n') || '没有可展示的待办候选。',
          tag: 'lark_md',
        },
      },
      { actions, tag: 'action' },
      {
        tag: 'note',
        elements: [{
          content: '待确认项目的待办会先暂存至草稿箱；截止日期待确认或需调整复杂字段时，请进入 Veges 编辑。',
          tag: 'plain_text',
        }],
      },
    ],
    header: {
      template: 'green',
      title: {
        content: `已提取 ${params.proposals.length} 条待办候选`,
        tag: 'plain_text',
      },
    },
  }
}
