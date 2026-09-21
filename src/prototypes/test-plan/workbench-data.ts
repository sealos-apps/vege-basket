import type { TestBug, TestCase, TestPlanCase, TestSpaceSettings, TestWorkbenchData } from '../../test-workbench-types'
import { initialPlans, finalResult, latest, type Execution } from './data'

export const prototypeUserId = 900001
const createdAt = '2026-09-17T01:00:00.000Z'
export type PrototypeExecution = Omit<Execution, 'result'> & { result: TestPlanCase['result'] }

export function createPrototypeData() {
  const histories: Record<number, PrototypeExecution[]> = {}
  const subjects = ['账号与权限', '项目协作', '待办管理', 'Veges AI'].map((name, index) => ({
    id: index + 1, testSpaceId: 1, name, description: '', createdAt, directoryRoot: false, canDelete: true, canEdit: true,
  }))
  const cases: TestCase[] = initialPlans[0].cases.map((item, index) => ({
    id: item.id, title: item.title, testSpaceId: 1, testSubjectId: subjects.find(s => item.folder.startsWith(s.name))!.id,
    folderId: index + 1, moduleId: index === 7 ? undefined : index % 2 + 1, moduleName: index % 2 ? '协作' : '核心',
    status: 'active', priority: item.priority === 'P0' ? 'high' : item.priority === 'P1' ? 'medium' : 'low',
    caseType: index === 7 ? 'regression' : 'functional', csvCaseId: '', customTags: [], canDelete: true,
    createdAt, updatedAt: createdAt, preconditions: item.preconditions,
    steps: item.steps.map((step, i) => `${i + 1}. ${step}`).join('\n'), expectedResult: item.expected, remarks: '',
  }))
  const planCases: TestPlanCase[] = initialPlans.flatMap(plan => plan.cases.map(item => {
    const id = plan.id * 1000 + item.id
    histories[id] = structuredClone(item.history)
    return {
      id, testPlanId: plan.id, testCaseId: item.id, testSubjectId: cases.find(c => c.id === item.id)!.testSubjectId,
      result: finalResult(item), resultNote: latest(item)?.note ?? '', snapshotTitle: item.title,
      snapshotPreconditions: item.preconditions, snapshotSteps: item.steps.map((step, i) => `${i + 1}. ${step}`).join('\n'),
      snapshotExpectedResult: item.expected, snapshotCaseVersion: 1,
      executedAt: latest(item)?.time, executedByUserId: latest(item) ? prototypeUserId : undefined,
    }
  }))
  const data: TestWorkbenchData = {
    testPlanImageMaxBytes: 10 * 1024 * 1024,
    spaces: [
      { id: 1, name: 'Veges 产品测试', versionLabel: 'v2.8', organizationId: 1, ownerUserId: prototypeUserId, accessLevel: 'owner', createdAt, bugCount: 0, caseCount: cases.length, planCount: initialPlans.length, canManageSettings: true, canManageMembers: true, canDelete: true, canChangeOrganization: true, canTransferOwnership: true },
      { id: 2, name: 'Veges 兼容性测试', versionLabel: 'v2.7', organizationId: 1, ownerUserId: prototypeUserId, accessLevel: 'owner', createdAt, bugCount: 0, caseCount: 0, planCount: 0, canManageSettings: true, canManageMembers: true, canDelete: true },
    ],
    subjects, cases, planCases,
    folders: cases.map((item, index) => ({ id: index + 1, name: initialPlans[0].cases[index].folder.split(' / ')[1], testSpaceId: 1, testSubjectId: item.testSubjectId, parentId: null, createdAt })),
    plans: initialPlans.map(plan => ({
      id: plan.id, name: plan.name, status: plan.status === '已完成' ? 'completed' : 'in_progress',
      testSpaceId: 1, testSubjectId: 1, testSubjectIds: subjects.map(s => s.id), projectId: 1,
      canManage: true, createdByUserId: prototypeUserId, ownerUserId: prototypeUserId, createdAt, updatedAt: createdAt,
      environment: plan.environment, environmentAccessUrl: '', testEnvironmentId: plan.id === 24 ? 1 : 2,
      versionLabel: plan.version, startsOn: plan.id === 24 ? '2026-09-16' : '2026-09-14', endsOn: plan.id === 24 ? '2026-09-18' : '2026-09-15',
    })),
    bugs: [], departedUserIds: [], notifications: [],
    modules: [{ id: 1, name: '核心', enabled: true, organizationId: 1 }, { id: 2, name: '协作', enabled: true, organizationId: 1 }],
    testEnvironments: [{ id: 1, name: '预发布环境', accessUrl: '', testSpaceIds: [1, 2] }, { id: 2, name: '测试环境', accessUrl: '', testSpaceIds: [1, 2] }],
    users: [{ id: prototypeUserId, username: 'linxiao', displayName: '林晓', roles: ['tester'] }, { id: 900002, username: 'chenyu', displayName: '陈宇', roles: ['tester', 'developer'] }],
    loadedSections: ['core', 'cases', 'plans', 'bugs', 'notifications'],
  }
  return { data, histories }
}

export function prototypeSettings(data: TestWorkbenchData): TestSpaceSettings {
  return {
    organizations: [{ id: 1, name: 'Veges 团队' }], invitations: [],
    spaces: data.spaces.map(space => ({ ...space, organizationName: 'Veges 团队', members: data.users.map(user => ({
      userId: user.id, username: user.username, displayName: user.displayName, accessLevel: user.id === prototypeUserId ? 'owner' : 'editor', status: 'active', createdAt,
    })) })),
  }
}

export function newPrototypeBug(data: TestWorkbenchData, payload: Partial<TestBug>, id: number, spaceId: number): TestBug {
  const source = data.cases.find(item => item.id === payload.testCaseId && item.testSpaceId === spaceId)
  return {
    id, testSpaceId: spaceId, title: '', actualResult: '', expectedResult: '', reproductionSteps: '', environment: '',
    severity: 'major', priority: 'medium', status: 'new', comments: [], events: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), canManage: true, canDelete: true, canEdit: true, canComment: true,
    reporterUserId: prototypeUserId, reporterName: '林晓', detailsLoaded: true, ...payload,
    testCaseTitle: source?.title, testSubjectId: source?.testSubjectId, moduleId: source?.moduleId,
    testSpaceName: data.spaces.find(space => space.id === spaceId)?.name,
    testPlanName: data.plans.find(plan => plan.id === payload.testPlanId)?.name,
    assigneeName: data.users.find(user => user.id === payload.assigneeUserId)?.displayName,
  }
}
