import assert from 'node:assert/strict'
import test from 'node:test'
import { buildWeeklyReportGenerationSource } from './weekly-report-generation.ts'

test('developer weekly report source includes identity, Chinese period, journals, and per-project counts', () => {
  const source = buildWeeklyReportGenerationSource({
    organizationName: '测试组织',
    userName: '张三',
    weekStart: '2026-07-27',
    role: 'developer',
    journals: [{ date: '2026-07-28', projectName: '项目 A', content: '完成接口联调，发现一个风险。' }],
    workStats: {
      projects: [{
        projectName: '项目 A',
        todoTotal: 8,
        todoCompleted: 3,
        todoUnfinished: 4,
        todoPendingReview: 1,
        deliveryTotal: 2,
        deliveryDelivered: 1,
        deliveryUnfinished: 1,
      }, {
        projectName: '项目 B',
        todoTotal: 0,
        todoCompleted: 0,
        todoUnfinished: 0,
        todoPendingReview: 0,
        deliveryTotal: 1,
        deliveryDelivered: 0,
        deliveryUnfinished: 1,
      }],
    },
    testerPlans: [],
  })
  assert.match(source, /周报对象：测试组织 \/ 张三/)
  assert.match(source, /周期：2026年7月27日 至 2026年8月2日/)
  assert.doesNotMatch(source, /角色：|总结主体/)
  assert.match(source, /完成接口联调/)
  assert.match(source, /项目 A：待办共 8 条，完成 3 条，未完成 4 条，待验收 1 条；交付事件共 2 条，已交付 1 条，未完成 1 条/)
  assert.match(source, /项目 B：待办共 0 条，完成 0 条，未完成 0 条，待验收 0 条；交付事件共 1 条，已交付 0 条，未完成 1 条/)
  assert.doesNotMatch(source, /待办标题|交付标题/)
  assert.match(source, /<!-- veges-weekly-report:v3 -->[\s\S]+#### 任务 1[\s\S]+##### 任务进度\n待填写/u)
})

test('tester weekly report source names identity, period, plans, and targets without journals', () => {
  const source = buildWeeklyReportGenerationSource({
    organizationName: '测试组织',
    userName: '李四',
    weekStart: '2026-07-27',
    role: 'tester',
    journals: [],
    workStats: {
      projects: [],
    },
    testerPlans: [{
      planName: '回归测试计划',
      testTarget: '支付服务',
      executed: 12,
      passed: 10,
      failed: 1,
      blocked: 1,
      skipped: 0,
    }],
  })
  assert.match(source, /周报对象：测试组织 \/ 李四/)
  assert.match(source, /周期：2026年7月27日 至 2026年8月2日/)
  assert.doesNotMatch(source, /角色：/)
  assert.match(source, /回归测试计划/)
  assert.match(source, /测试对象：支付服务/)
  assert.match(source, /本周期本人保留的最新执行记录：12 条/)
  assert.doesNotMatch(source, /项目日记（总结主体）/)
  assert.match(source, /<!-- veges-weekly-report:v3 -->[\s\S]+#### 任务 1[\s\S]+##### 任务进度\n待填写/u)
})
