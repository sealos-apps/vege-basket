export type BugShareComment = {
  authorName: string
  authorUserId?: number
  content: string
  createdAt: string
  id: number
}

export type BugShareMentionableMember = {
  id: number
  name: string
}

export type BugShareView = {
  assigneeName: string | null
  assigneeUserId?: number
  bugId: number
  comments: BugShareComment[]
  createdAt: string
  departedUserIds: number[]
  environment: string
  expectedResult: string
  actualResult: string
  mentionableMembers: BugShareMentionableMember[]
  priority: string
  projectName: string | null
  organizationId?: number | null
  reproductionSteps: string
  severity: string
  status: string
  testPlanName: string | null
  testSpaceName: string
  testSubjectName: string
  testCaseId?: number
  testCaseTitle?: string
  testCaseFolderName?: string
  title: string
  updatedAt: string
  viewer: 'anonymous' | 'commenter' | 'assignee'
}

export type BugShareLink = {
  expiresInDays: number
  url: string
}
