import type { TestPlanCase } from './test-workbench-types'

function imageAlt(value: string) {
  return value.replace(/[\]\r\n]/g, ' ').trim() || '执行截图'
}

export function testPlanExecutionBugEvidence(planCase: TestPlanCase) {
  const latest = planCase.executions?.at(-1)
  if (!latest) return planCase.resultNote
  const images = latest.images.map((image) => `![${imageAlt(image.name)}](${image.src})`)
  return [latest.actualResult, ...images].filter(Boolean).join('\n\n')
}
