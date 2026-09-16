import type { WorkspaceData, WorkspaceSection } from './api'
import type { Project, ProjectMembership, Todo } from './types'

const allWorkspaceSections: WorkspaceSection[] = [
  'catalog',
  'inbox',
  'memberships',
  'project',
  'summaries',
  'todos',
]

function sectionsFor(data: WorkspaceData) {
  return new Set(data.loadedSections ?? allWorkspaceSections)
}

function replaceProjectItems<T extends { projectId: number }>(
  current: T[],
  next: T[],
  projectId?: number,
) {
  if (projectId == null) return next
  return [...current.filter((item) => item.projectId !== projectId), ...next]
}

function mergeCatalogProjects(current: Project[], next: Project[]) {
  const currentById = new Map(current.map((project) => [project.id, project]))
  return next.map((project) => {
    const cached = currentById.get(project.id)
    if (!cached) return project
    return {
      ...project,
      journals: cached.journals,
      modules: cached.modules,
      risks: cached.risks,
      riskJournalEntryIds: cached.riskJournalEntryIds,
      subprojects: cached.subprojects,
    }
  })
}

function mergeProjectDetails(current: Project[], next: Project[]) {
  const nextById = new Map(next.map((project) => [project.id, project]))
  return current.map((project) => nextById.get(project.id) ?? project)
}

export function mergeWorkspaceProjects(current: Project[], next: WorkspaceData) {
  const sections = sectionsFor(next)
  if (!next.loadedSections) return next.projects
  if (sections.has('catalog')) return mergeCatalogProjects(current, next.projects)
  if (sections.has('project')) return mergeProjectDetails(current, next.projects)
  return current
}

export function mergeWorkspaceTodos(current: Todo[], next: WorkspaceData) {
  const sections = sectionsFor(next)
  if (!sections.has('todos')) {
    if (!sections.has('catalog')) return current
    const visibleProjectIds = new Set(next.projects.map((project) => project.id))
    return current.filter((todo) => visibleProjectIds.has(todo.projectId))
  }
  return replaceProjectItems(current, next.todos, next.projectId)
}

export function mergeWorkspaceMemberships(current: ProjectMembership[], next: WorkspaceData) {
  const sections = sectionsFor(next)
  if (!sections.has('memberships')) {
    if (!sections.has('catalog')) return current
    const visibleProjectIds = new Set(next.projects.map((project) => project.id))
    return current.filter((membership) => visibleProjectIds.has(membership.projectId))
  }
  return replaceProjectItems(current, next.memberships, next.projectId)
}

export function workspaceIncludesSection(data: WorkspaceData, section: WorkspaceSection) {
  return sectionsFor(data).has(section)
}
