import type { TestResult } from '../../test-workbench-types'

export const resultLabels: Record<TestResult, string> = {
  untested: '未执行', passed: '通过', failed: '失败', blocked: '阻塞', skipped: '跳过',
}

export const executionImageLimits = {
  maxCount: 6,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 30 * 1024 * 1024,
} as const

export const executionImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

export type ExecutionImage = {
  id: string
  name: string
  size: number
  src: string
  type: typeof executionImageTypes[number]
}

export type Execution = {
  id: string
  result: TestResult
  actual: string
  note: string
  actor: string
  time: string
  images?: ExecutionImage[]
}

export function validateExecutionImages(existing: ExecutionImage[], files: Array<Pick<File, 'name' | 'size' | 'type'>>, maxFileBytes = executionImageLimits.maxFileBytes) {
  if (!files.length) return '请选择图片。'
  if (existing.length + files.length > executionImageLimits.maxCount) return `每条执行记录最多上传 ${executionImageLimits.maxCount} 张图片。`
  const unsupported = files.find(file => !executionImageTypes.includes(file.type as ExecutionImage['type']))
  if (unsupported) return `“${unsupported.name}”格式不支持，请选择 PNG、JPEG、WebP 或 GIF 图片。`
  const oversized = files.find(file => file.size > maxFileBytes)
  if (oversized) return `“${oversized.name}”超过 ${maxFileBytes / 1024 / 1024} MiB，请压缩后重试。`
  const totalBytes = [...existing, ...files].reduce((total, item) => total + item.size, 0)
  if (totalBytes > executionImageLimits.maxTotalBytes) return '本条执行记录的图片总大小不能超过 30 MiB。'
  return ''
}

export type PlanCase = {
  id: number
  title: string
  folder: string
  priority: string
  preconditions: string
  steps: string[]
  expected: string
  legacyResult?: TestResult
  legacyNote?: string
  caseCode?: string
  history: Execution[]
}

export type Plan = {
  id: number
  name: string
  status: '草稿' | '执行中' | '已完成' | '已终止'
  ownerName?: string
  spaceName?: string
  projectName?: string
  environment: string
  version: string
  period: string
  description: string
  cases: PlanCase[]
}

function record(id: string, result: Execution['result'], actual: string, time: string, note = '', actor = '林晓'): Execution {
  return { id, result, actual, time: `2026-09-17T${time}:00+08:00`, note, actor }
}

export const initialPlans: Plan[] = [
  {
    id: 24, name: 'v2.8 核心流程回归', status: '执行中', environment: '预发布环境', version: 'v2.8.0-rc.2',
    period: '2026-09-16 至 2026-09-18',
    description: '验证账号登录、项目协作与待办流转核心链路，覆盖本次版本修复项。',
    cases: [
      {
        id: 101, title: '使用正确的账号密码登录', folder: '账号与权限 / 登录', priority: 'P0',
        preconditions: '已有激活的测试账号，当前处于未登录状态。',
        steps: ['打开登录页面。', '输入正确的用户名和密码。', '点击登录，检查工作台与账号信息。'],
        expected: '成功进入工作台，展示当前账号名称；刷新页面后保持登录状态。',
        history: [record('101-1', 'passed', '登录成功，工作台及用户信息展示正确；刷新后会话正常。', '09:12')],
      },
      {
        id: 102, title: '邀请成员后同步项目访问权限', folder: '项目协作 / 成员管理', priority: 'P0',
        preconditions: '项目负责人已登录；受邀账号未加入该项目。',
        steps: ['负责人向测试账号发送项目邀请。', '使用受邀账号接受邀请。', '进入项目并刷新页面，检查项目可见性及成员权限。'],
        expected: '接受邀请后立即获得对应权限，项目出现在列表中，刷新后权限仍然生效。',
        history: [record('102-1', 'failed', '接受邀请后项目未出现在列表中，手动刷新后才可见。', '09:28', '已关联 BUG-38，待修复后复测。')],
      },
      {
        id: 103, title: '完成待办后记录完成时间与操作人', folder: '待办管理 / 状态流转', priority: 'P0',
        preconditions: '项目中存在一条分配给当前用户的进行中待办。',
        steps: ['打开待办详情。', '点击完成并在确认弹窗中确认。', '检查状态、完成时间与操作记录。'],
        expected: '待办变为已完成，完成时间准确，操作记录展示实际完成人。',
        history: [
          record('103-1', 'failed', '状态已更新，但操作记录中的完成人为空。', '09:40', 'BUG-41：缺少完成人信息。'),
          record('103-2', 'passed', '复测通过，完成时间与完成人均正确，刷新后结果一致。', '11:06', '在 rc.2 版本复测，BUG-41 已修复。', '陈宇'),
        ],
      },
      {
        id: 104, title: '项目日报生成并保存为文档', folder: 'Veges AI / 项目日报', priority: 'P1',
        preconditions: '项目已配置共享 AI，当前用户有项目访问权限，今日存在工作日志。',
        steps: ['打开 Veges AI，选择当前项目。', '发送“生成今天的项目日报”。', '等待生成完成，打开保存的文档。'],
        expected: '日报包含今日授权项目数据，并以完整文档保存。',
        history: [record('104-1', 'blocked', '预发布环境 AI 服务暂不可用，无法完成生成验证。', '10:15', '等待环境恢复后继续执行。')],
      },
      {
        id: 105, title: '删除项目时展示二次确认', folder: '项目协作 / 项目设置', priority: 'P0',
        preconditions: '使用项目负责人账号登录，存在可删除的测试项目。',
        steps: ['进入项目设置，点击删除。', '在弹窗中取消，检查项目仍然存在。', '再次点击删除并确认，检查项目列表。'],
        expected: '取消不会删除项目；确认后项目从列表移除。', history: [],
      },
      {
        id: 106, title: '按负责人筛选待办列表', folder: '待办管理 / 筛选', priority: 'P1',
        preconditions: '项目内存在分配给不同成员的待办。',
        steps: ['打开项目待办列表。', '选择一名负责人。', '清除筛选。'],
        expected: '筛选后仅显示该成员的待办；清除后恢复完整列表。', history: [],
      },
      {
        id: 107, title: '导出项目交付清单', folder: '项目协作 / 交付', priority: 'P2',
        preconditions: '存在包含已完成交付项的测试项目。',
        steps: ['打开交付清单。', '检查已完成交付项的名称、版本与负责人。', '导出并检查清单内容。'],
        expected: '导出内容与项目交付清单一致。', legacyResult: 'passed', history: [],
      },
      {
        id: 108, title: '旧版移动端兼容性验证', folder: '账号与权限 / 兼容性', priority: 'P2',
        preconditions: '使用旧版移动端浏览器访问测试环境。',
        steps: ['打开登录页面。', '登录后浏览项目与待办。'],
        expected: '页面布局完整，核心操作可用。',
        history: [record('108-1', 'skipped', '本轮不验证已停止支持的浏览器版本。', '10:36', '兼容性范围按 v2.8 发布清单执行。')],
      },
    ],
  },
  {
    id: 23, name: 'v2.7.4 发布冒烟', status: '已完成', environment: '测试环境', version: 'v2.7.4',
    period: '2026-09-14 至 2026-09-15', description: '发布前核心登录链路验证。',
    cases: [{
      id: 101, title: '使用正确的账号密码登录', folder: '账号与权限 / 登录', priority: 'P0',
      preconditions: '已有激活的测试账号。', steps: ['打开登录页。', '输入正确的账号密码并登录。'],
      expected: '登录成功并进入工作台。',
      history: [{ id: '23-101-1', result: 'passed', actor: '陈宇', time: '2026-09-15T15:30:00+08:00', actual: '登录成功，冒烟验证通过。', note: '' }],
    }],
  },
]

export function latest(item: PlanCase) { return item.history.at(-1) }
export function finalResult(item: PlanCase): TestResult { return latest(item)?.result ?? item.legacyResult ?? 'untested' }
export function formatTime(time: string) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(time))
}
