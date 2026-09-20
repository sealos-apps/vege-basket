import type { NotificationCenterData } from './types'
export function removePackageEventNotification(
  notifications: NotificationCenterData,
  eventId: number,
): NotificationCenterData {
  return {
    ...notifications,
    assignedPackageEvents: notifications.assignedPackageEvents.filter(
      (item) => item.id !== eventId,
    ),
  }
}

export function removeTodoNotifications(
  notifications: NotificationCenterData,
  todoId: number,
): NotificationCenterData {
  return {
    ...notifications,
    assignedTodos: notifications.assignedTodos.filter((item) => item.id !== todoId),
    dueTomorrowTodos: notifications.dueTomorrowTodos.filter((item) => item.id !== todoId),
    noteMentions: notifications.noteMentions.filter((item) => item.id !== todoId),
  }
}
