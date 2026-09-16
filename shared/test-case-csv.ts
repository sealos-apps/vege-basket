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

export const testCaseCsvFieldGuidance = [
  { field: '用例ID', required: false, rule: '留空或填写 CASE-数字；已存在则覆盖，未找到则新增', example: 'CASE-2846' },
  { field: '用例名称', required: true, rule: '最多 160 个字符', example: '扩容超限提示' },
  { field: '所属模块', required: false, rule: '必须与当前测试空间所属组织中已启用的模块同名；留空表示无模块', example: '以当前可用模块为准' },
  { field: '用例目录', required: false, rule: '填写以 ~ 开头的完整根路径，并使用 ~ 分隔层级；目录名中的 ~ 写为 \\~，反斜杠写为 \\\\；留空表示根目录，不存在的目录自动创建', example: '~License~业务~资源扩容配额控制' },
  { field: '用例等级', required: true, rule: '只能填写 P0、P1 或 P2', example: 'P0' },
  { field: '用例类型', required: true, rule: '功能、回归、冒烟、安全或性能', example: '功能' },
  { field: '前置条件', required: false, rule: '最多 5000 个字符', example: '用户已登录' },
  { field: '步骤描述', required: false, rule: '最多 10000 个字符，可在单元格内换行', example: '[1] 打开页面\n[2] 提交配置' },
  { field: '预期结果', required: false, rule: '最多 10000 个字符', example: '显示配额超限提示' },
  { field: '备注', required: false, rule: '最多 5000 个字符', example: '覆盖 AC-001' },
] as const

export const testCaseTypeByLabel = Object.fromEntries(
  Object.entries(testCaseTypeLabels).map(([value, label]) => [label, value]),
) as Record<(typeof testCaseTypeLabels)[TestCaseCsvType], TestCaseCsvType>
