import type { PersonalWeeklyReport } from '../../organization-types'
import type { TestCase, TestPlan, TestPlanCase, TestWorkbenchData } from '../../test-workbench-types'
import { defaultWeeklyReportRules } from '../../../shared/weekly-report-availability'
import { createPrototypeData, newPrototypeBug, prototypeSettings, prototypeUserId, type PrototypeExecution } from './workbench-data'

const now = () => new Date().toISOString()
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const fail = (message: string): never => { throw new Error(message) }

/** This store is deliberately in-memory; it never imports the server or forwards API requests. */
export class PrototypeStore {
  private seed = createPrototypeData()
  data = this.seed.data
  histories = this.seed.histories
  settings = prototypeSettings(this.data)
  private nextId = 100000
  private reports = new Map<string, PersonalWeeklyReport>()
  private listeners = new Set<() => void>()
  private revision = 0
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getRevision = () => this.revision
  private changed() { this.revision++; this.listeners.forEach(listener => listener()) }

  appendExecution(caseId: number, record: PrototypeExecution) {
    const row = this.data.planCases.find(item => item.id === caseId) ?? fail('计划用例不存在。')
    if (!['untested', 'passed', 'failed', 'blocked', 'skipped'].includes(record.result)) fail('执行结果无效。')
    const history = this.histories[caseId] ?? []
    if (history.some(item => item.id === record.id)) return
    this.histories[caseId] = [...history, structuredClone(record)]
    Object.assign(row, { result: record.result, resultNote: record.note, executedAt: record.time, executedByUserId: prototypeUserId })
    const plan = this.data.plans.find(item => item.id === row.testPlanId)!
    if (plan.status === 'draft') plan.status = 'in_progress'
    plan.updatedAt = now()
    this.changed()
  }

  private snapshotCase(plan: TestPlan, item: TestCase): TestPlanCase {
    return {
      id: ++this.nextId, testPlanId: plan.id, testCaseId: item.id, testSubjectId: item.testSubjectId,
      result: 'untested', resultNote: '', snapshotCaseVersion: 1, snapshotTitle: item.title,
      snapshotPreconditions: item.preconditions, snapshotSteps: item.steps, snapshotExpectedResult: item.expectedResult,
    }
  }

  private removePlan(id: number) {
    this.data.planCases.filter(item => item.testPlanId === id).forEach(item => { delete this.histories[item.id] })
    this.data.planCases = this.data.planCases.filter(item => item.testPlanId !== id)
    this.data.plans = this.data.plans.filter(item => item.id !== id)
    this.data.bugs.filter(item => item.testPlanId === id).forEach(item => {
      item.testPlanId = undefined; item.testPlanCaseId = undefined; item.testPlanName = undefined
    })
  }

  private workbench(url?: URL): TestWorkbenchData {
    const copy = structuredClone(this.data)
    const spaceId = Number(url?.searchParams.get('spaceId'))
    if (spaceId) {
      copy.cases = copy.cases.filter(item => item.testSpaceId === spaceId)
      copy.folders = copy.folders.filter(item => item.testSpaceId === spaceId)
      copy.plans = copy.plans.filter(item => item.testSpaceId === spaceId)
      copy.bugs = copy.bugs.filter(item => item.testSpaceId === spaceId)
      copy.planCases = copy.planCases.filter(item => copy.plans.some(plan => plan.id === item.testPlanId))
    }
    return copy
  }

  async handle(url: URL, method: string, body = ''): Promise<Response> {
    try {
      const path = url.pathname.split('/').filter(Boolean)
      const payload = body ? JSON.parse(body) as Record<string, unknown> : {}
      if (path[1] === 'test-workbench') return response(this.workbench(url))
      if (path[1] === 'organizations') return response({ id: 1, name: 'Veges 团队', canWriteWeeklyReport: true, weekStartsOn: 1, weeklyReportRules: defaultWeeklyReportRules })
      if (path[1] === 'weekly-reports') {
        const week = path[3]
        if (!week) return response({ total: this.reports.size, limit: 10, offset: 0, items: [...this.reports.values()].map(item => ({ ...item, sourceCount: 0, updatedAt: now() })) })
        if (path[4] === 'sources') return response({ sources: [] })
        const current = this.reports.get(week) ?? { weekStart: week, content: '', publishedContent: '', publishedRevision: null, draftVersion: 0, sourceMode: 'manual', sources: [], state: 'empty', submittedAt: null } satisfies PersonalWeeklyReport
        if (method !== 'GET') {
          const content = path[4] === 'generate' ? '## 本周工作\n\n完成核心流程回归测试。\n\n## 下周计划\n\n继续验证待修复问题。' : String(payload.content ?? current.content)
          const next: PersonalWeeklyReport = { ...current, content, state: path[4] === 'submit' ? 'submitted' : 'draft', draftVersion: current.draftVersion + 1 }
          if (path[4] === 'submit') { next.publishedContent = content; next.publishedRevision = (current.publishedRevision ?? 0) + 1; next.submittedAt = now() }
          this.reports.set(week, next)
          return response(next)
        }
        return response(current)
      }
      if (path[1] !== 'test-spaces') return response({ error: '此操作尚未提供本地模拟数据。' }, 501)
      if (path[2] === 'settings') return response(this.settings)
      const spaceId = Number(path[2])
      if (path.length === 2 && method === 'POST') {
        const space = { ...this.data.spaces[0], id: ++this.nextId, name: String(payload.name), versionLabel: String(payload.versionLabel), createdAt: now() }
        this.data.spaces.push(space)
        this.settings.spaces.push({ ...space, organizationName: 'Veges 团队', members: structuredClone(this.settings.spaces[0]?.members ?? []) })
        this.changed()
        return response(this.workbench())
      }
      const space = this.data.spaces.find(item => item.id === spaceId) ?? fail('测试空间不存在。')
      if (path.length === 3) {
        if (method === 'PATCH') {
          Object.assign(space, payload)
          Object.assign(this.settings.spaces.find(item => item.id === spaceId)!, payload)
        } else if (method === 'DELETE') {
          if (payload.confirmationName !== space.name) fail('测试空间名称不匹配。')
          this.data.plans.filter(item => item.testSpaceId === spaceId).forEach(item => this.removePlan(item.id))
          this.data.cases = this.data.cases.filter(item => item.testSpaceId !== spaceId)
          this.data.bugs = this.data.bugs.filter(item => item.testSpaceId !== spaceId)
          this.data.folders = this.data.folders.filter(item => item.testSpaceId !== spaceId)
          this.data.subjects = this.data.subjects.filter(item => item.testSpaceId !== spaceId)
          this.data.spaces = this.data.spaces.filter(item => item.id !== spaceId)
          this.settings.spaces = this.settings.spaces.filter(item => item.id !== spaceId)
        }
        this.changed()
        return response(this.settings)
      }
      const id = Number(path[4])
      const resourcePath = path.slice(3).join('/')
      const supported = [
        ['POST', /^(plans|cases|subjects|folders|bugs|members|invitations)$/],
        ['POST', /^cases\/move$/],
        ['PATCH', /^(plans|cases|subjects|folders|bugs|members)\/\d+$/],
        ['PATCH', /^plans\/\d+\/details$/],
        ['PATCH', /^plan-cases\/\d+$/],
        ['DELETE', /^(plans|cases|subjects|folders|bugs|members|invitations)\/\d+$/],
        ['DELETE', /^plans\/\d+\/cases\/\d+$/],
        ['POST', /^bugs\/\d+\/comments$/],
        ['PATCH', /^bugs\/\d+\/comments\/\d+$/],
        ['DELETE', /^bugs\/\d+\/comments\/\d+$/],
      ] as const
      if (!supported.some(([verb, pattern]) => verb === method && pattern.test(resourcePath))) {
        return response({ error: '此操作尚未提供本地模拟数据。' }, 501)
      }
      if (path[3] === 'plans') {
        if (method === 'POST' || (method === 'PATCH' && path[5] === 'details')) {
          const old = this.data.plans.find(item => item.id === id && item.testSpaceId === spaceId)
          const environment = this.data.testEnvironments.find(item => item.id === payload.testEnvironmentId)
          if (old && old.status !== 'draft' && environment && environment.id !== old.testEnvironmentId) fail('测试计划开始执行后不能更换环境。')
          if (!String(payload.name ?? '').trim()) fail('请输入计划名称。')
          if (payload.startsOn && payload.endsOn && String(payload.startsOn) > String(payload.endsOn)) fail('结束日期不能早于开始日期。')
          const caseIds = payload.caseIds as number[] ?? []
          const sourceCases = caseIds.map(caseId => this.data.cases.find(item => item.id === caseId && item.testSpaceId === spaceId && item.status === 'active') ?? fail('所选用例不存在。'))
          const next: TestPlan = {
            id: old?.id ?? ++this.nextId, name: String(payload.name), status: old?.status ?? 'draft', canManage: true,
            testSpaceId: spaceId, testSubjectId: (payload.testSubjectIds as number[])[0], testSubjectIds: payload.testSubjectIds as number[],
            projectId: payload.projectId as number | undefined, ownerUserId: payload.ownerUserId as number | undefined,
            startsOn: payload.startsOn as string | undefined, endsOn: payload.endsOn as string | undefined,
            environment: environment?.name ?? old?.environment ?? '', environmentAccessUrl: '', testEnvironmentId: environment?.id ?? old?.testEnvironmentId,
            versionLabel: String(payload.versionLabel ?? ''), createdByUserId: prototypeUserId, createdAt: old?.createdAt ?? now(), updatedAt: now(),
          }
          if (old) Object.assign(old, next); else this.data.plans.unshift(next)
          for (const item of sourceCases) {
            if (!this.data.planCases.some(row => row.testPlanId === next.id && row.testCaseId === item.id)) this.data.planCases.push(this.snapshotCase(next, item))
          }
        } else {
          const plan = this.data.plans.find(item => item.id === id && item.testSpaceId === spaceId) ?? fail('测试计划不存在。')
          if (path[5] === 'cases' && method === 'DELETE') {
            const rowId = Number(path[6])
            const row = this.data.planCases.find(item => item.id === rowId && item.testPlanId === plan.id) ?? fail('计划用例不存在。')
            if (row.result !== 'untested') fail('只能移除未执行用例。')
            if (this.data.bugs.some(bug => bug.testPlanCaseId === rowId)) fail('用例已关联 Bug，不能移除。')
            this.data.planCases = this.data.planCases.filter(item => item.id !== rowId)
            delete this.histories[rowId]
          } else if (method === 'DELETE') this.removePlan(plan.id)
          else if (method === 'PATCH') plan.status = payload.status as TestPlan['status']
        }
      } else if (path[3] === 'plan-cases') {
        const row = this.data.planCases.find(item => item.id === id)
        if (!row || !this.data.plans.some(plan => plan.id === row.testPlanId && plan.testSpaceId === spaceId)) fail('计划用例不存在。')
        this.appendExecution(id, { id: crypto.randomUUID(), result: payload.result as TestPlanCase['result'], actual: '', note: String(payload.resultNote ?? ''), actor: '林晓', time: now() })
      } else if (path[3] === 'bugs') {
        if (method === 'POST' && !id) this.data.bugs.unshift(newPrototypeBug(this.data, payload, ++this.nextId, spaceId))
        else {
          const bug = this.data.bugs.find(item => item.id === id && item.testSpaceId === spaceId) ?? fail('Bug 不存在。')
          if (path[5] === 'comments') {
            if (method === 'POST') bug.comments.push({ id: ++this.nextId, content: String(payload.content), authorName: '林晓', authorUserId: prototypeUserId, kind: 'comment', canEdit: true, createdAt: now(), updatedAt: now() })
            else if (method === 'DELETE') bug.comments = bug.comments.filter(item => item.id !== Number(path[6]))
            else Object.assign(bug.comments.find(item => item.id === Number(path[6]))!, { content: payload.content, updatedAt: now() })
          } else if (path[5]) return response({ error: '此操作尚未提供本地模拟数据。' }, 501)
          else if (method === 'DELETE') this.data.bugs = this.data.bugs.filter(item => item.id !== id)
          else Object.assign(bug, payload, { updatedAt: now(), assigneeName: this.data.users.find(user => user.id === payload.assigneeUserId)?.displayName ?? bug.assigneeName })
        }
      } else if (path[3] === 'cases') {
        if (path[4] === 'move') {
          const ids = payload.caseIds as number[]
          this.data.cases.filter(item => item.testSpaceId === spaceId && ids.includes(item.id)).forEach(item => { item.folderId = payload.targetFolderId as number | undefined })
          this.changed()
          return response({ movedCount: ids.length, workbench: this.workbench() })
        }
        if (method === 'POST' && !id) this.data.cases.push({ title: '', preconditions: '', steps: '', expectedResult: '', remarks: '', priority: 'medium', caseType: 'functional', testSubjectId: Number(payload.testSubjectId), ...payload, id: ++this.nextId, testSpaceId: spaceId, status: 'active', canDelete: true, csvCaseId: '', customTags: [], createdAt: now(), updatedAt: now() })
        else {
          const item = this.data.cases.find(row => row.id === id && row.testSpaceId === spaceId) ?? fail('测试用例不存在。')
          if (method === 'DELETE') {
            if (this.data.bugs.some(bug => bug.testCaseId === id)) fail('用例已关联 Bug，不能删除。')
            this.data.cases = this.data.cases.filter(row => row.id !== id)
            this.data.planCases.filter(row => row.testCaseId === id).forEach(row => { row.testCaseId = undefined })
          } else Object.assign(item, payload, { updatedAt: now() })
        }
      } else if (path[3] === 'subjects' || path[3] === 'folders') {
        const key = path[3]
        const list = this.data[key]
        if (method === 'POST') {
          if (key === 'subjects') this.data.subjects.push({ id: ++this.nextId, testSpaceId: spaceId, name: String(payload.name), description: String(payload.description ?? ''), createdAt: now(), directoryRoot: false, canDelete: true, canEdit: true })
          else this.data.folders.push({ id: ++this.nextId, testSpaceId: spaceId, name: String(payload.name), testSubjectId: Number(payload.testSubjectId), parentId: payload.parentId as number | null ?? null, createdAt: now() })
        } else if (method === 'DELETE') {
          if (key === 'folders') {
            if (this.data.folders.some(item => item.parentId === id) || this.data.cases.some(item => item.folderId === id)) fail('目录不为空，不能删除。')
            this.data.folders = this.data.folders.filter(item => item.id !== id)
          } else {
            if (this.data.folders.some(item => item.testSubjectId === id) || this.data.cases.some(item => item.testSubjectId === id)) fail('目录不为空，不能删除。')
            this.data.subjects = this.data.subjects.filter(item => item.id !== id)
          }
        } else Object.assign(list.find(item => item.id === id && item.testSpaceId === spaceId) ?? fail('目录不存在。'), payload)
      } else if (path[3] === 'members' || path[3] === 'invitations') {
        const managed = this.settings.spaces.find(item => item.id === spaceId)!
        if (method === 'POST') {
          const user = this.data.users.find(item => item.username === payload.username) ?? fail('该账号未加入组织。')
          if (managed.members.some(item => item.userId === user.id)) fail('该成员已加入空间。')
          managed.members.push({ userId: user.id, username: user.username, displayName: user.displayName, accessLevel: payload.accessLevel as 'editor' | 'viewer', status: 'active', createdAt: now() })
        } else if (method === 'DELETE') managed.members = managed.members.filter(item => item.userId !== id)
        else Object.assign(managed.members.find(item => item.userId === id) ?? fail('成员不存在。'), { accessLevel: payload.accessLevel })
        this.changed()
        return response(this.settings)
      } else return response({ error: '此操作尚未提供本地模拟数据。' }, 501)
      this.changed()
      return response(this.workbench())
    } catch (error) {
      return response({ error: error instanceof Error ? error.message : '模拟操作失败。' }, 400)
    }
  }
}
