import type { ProjectPackageTimeline } from './types'

export function preserveLoadedPackageEventDetails(
  current: ProjectPackageTimeline,
  incoming: ProjectPackageTimeline,
) {
  const currentEventsById = new Map(current.events.map((event) => [event.id, event]))
  return {
    ...incoming,
    events: incoming.events.map((event) => {
      const loadedEvent = currentEventsById.get(event.id)
      if (loadedEvent?.detailsLoaded !== true || loadedEvent.detailRevision !== event.detailRevision) return event
      return {
        ...event,
        comments: loadedEvent.comments,
        containerImages: loadedEvent.containerImages,
        deliveryFailureReason: loadedEvent.deliveryFailureReason,
        deliveryScripts: loadedEvent.deliveryScripts,
        deliverySteps: loadedEvent.deliverySteps,
        groups: loadedEvent.groups,
        latestRejectedAt: loadedEvent.latestRejectedAt,
        latestRejectedByName: loadedEvent.latestRejectedByName,
        latestRejectionReason: loadedEvent.latestRejectionReason,
        offlinePackages: loadedEvent.offlinePackages,
        operations: loadedEvent.operations,
        other: loadedEvent.other,
        rejections: loadedEvent.rejections,
        detailsLoaded: true,
      }
    }),
  }
}
