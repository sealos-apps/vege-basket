import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkspaceData } from '../src/api.ts'
import type { Project, ProjectMembership, Todo } from '../src/types.ts'
import {
  mergeWorkspaceMemberships,
  mergeWorkspaceProjects,
  mergeWorkspaceTodos,
} from '../src/workspace-cache.ts'

function project(id: number, journalId?: number) {
  return {
    id,
    journals: journalId == null ? [] : [{ id: journalId }],
    modules: [],
    risks: [],
    riskJournalEntryIds: [],
    subprojects: [],
  } as unknown as Project
}

function todo(id: number, projectId: number) {
  return { id, projectId } as Todo
}

function membership(id: number, projectId: number) {
  return { id, projectId } as ProjectMembership
}

function snapshot(data: Partial<WorkspaceData>): WorkspaceData {
  return {
    departedUserIds: [],
    inbox: [],
    memberships: [],
    projects: [],
    summaries: [],
    todos: [],
    ...data,
  }
}

test('catalog refresh preserves cached project details and prunes removed resources', () => {
  const catalog = snapshot({
    loadedSections: ['catalog'],
    projects: [project(1)],
  })

  assert.equal(mergeWorkspaceProjects([project(1, 11), project(2, 22)], catalog)[0].journals[0].id, 11)
  assert.deepEqual(mergeWorkspaceTodos([todo(1, 1), todo(2, 2)], catalog).map((item) => item.id), [1])
  assert.deepEqual(
    mergeWorkspaceMemberships([membership(1, 1), membership(2, 2)], catalog).map((item) => item.id),
    [1],
  )
})

test('project refresh replaces only the requested project details and todos', () => {
  const detail = snapshot({
    loadedSections: ['project', 'todos'],
    projectId: 1,
    projects: [project(1, 12)],
    todos: [todo(3, 1)],
  })
  const projects = mergeWorkspaceProjects([project(1, 11), project(2, 22)], detail)
  const todos = mergeWorkspaceTodos([todo(1, 1), todo(2, 2)], detail)

  assert.deepEqual(projects.map((item) => item.journals[0]?.id), [12, 22])
  assert.deepEqual(todos.map((item) => item.id).sort(), [2, 3])
})
