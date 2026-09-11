export type TodoShareNote = {
  authorName: string
  authorUserId?: number
  content: string
  createdAt: string
  fromShare: boolean
  id: number
  kind: 'normal' | 'acceptance'
}

export type TodoShareView = {
  assigneeName: string | null
  assigneeUserId?: number
  confirmationStatus: string
  createdAt: string
  creatorName: string
  creatorUserId?: number
  departedUserIds: number[]
  detail: string
  done: boolean
  dueDate: string
  mentionableMembers: Array<{ id: number; name: string }>
  moduleName: string | null
  subprojectName: string | null
  notes: TodoShareNote[]
  priority: string
  projectName: string
  reviewerName: string | null
  reviewerUserId?: number
  title: string
  todoId: number
  updatedAt: string
  viewer: 'anonymous' | 'commenter' | 'member'
  watcherNames: string[]
}

export type TodoShareLink = {
  expiresInDays: number
  url: string
}
