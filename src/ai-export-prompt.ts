export type AiPromptExportInput = {
  title: string
  scope: string[]
  fields: string[]
  data: string
  instructions?: string[]
}

export function buildAiExportPrompt({ title, scope, fields, data, instructions = [] }: AiPromptExportInput) {
  const scopeText = scope.length ? scope.map((item) => `- ${item}`).join('\n') : '- 无数据'
  const fieldText = fields.length ? fields.map((item) => `- ${item}`).join('\n') : '- 无字段说明'
  const instructionText = instructions.length
    ? instructions.map((item) => `- ${item}`).join('\n')
    : '- 请先概括事实，再给出可执行的分析结论。'
  return [
    '# Veges AI 数据分析提示词',
    '',
    `## 导出标题\n${title}`,
    '',
    '## 导出范围',
    scopeText,
    '',
    '## 数据字段',
    fieldText,
    '',
    '## 数据内容',
    '```text',
    data.trim() || '无数据',
    '```',
    '',
    '## AI 分析要求',
    instructionText,
    '',
    '## 约束',
    '- 仅基于以上数据回答，不要补充未提供的事实。',
    '- 区分已确认、待确认、进行中和缺失数据。',
    '- 输出结论时保留日期、人员、项目和任务的原始上下文。',
  ].join('\n')
}

export function downloadMarkdownFile(fileName: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName.endsWith('.md') ? fileName : `${fileName}.md`
  link.click()
  URL.revokeObjectURL(url)
}
