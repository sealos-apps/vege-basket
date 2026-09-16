export const testCaseCsvHeaders = [
  '用例ID',
  '用例名称',
  '所属模块',
  '用例目录',
  '用例等级',
  '用例类型',
  '前置条件',
  '步骤描述',
  '预期结果',
  '备注',
] as const

export const testCaseTypeLabels = {
  functional: '功能',
  performance: '性能',
  regression: '回归',
  security: '安全',
  smoke: '冒烟',
} as const

export type TestCaseCsvType = keyof typeof testCaseTypeLabels

export const testCaseTypeByLabel = Object.fromEntries(
  Object.entries(testCaseTypeLabels).map(([value, label]) => [label, value]),
) as Record<(typeof testCaseTypeLabels)[TestCaseCsvType], TestCaseCsvType>
