export const directoryPanelMinWidth = 220
export const directoryPanelMaxWidth = 480
export const directoryContentMinWidth = 420
export const directorySplitterWidth = 20
export const directoryResizeThreshold = 2

export function getDefaultDirectoryPanelWidth(compact: boolean) {
  return compact ? directoryPanelMinWidth : 248
}

export function getDirectoryPanelMaxWidth(workspaceWidth: number) {
  if (!Number.isFinite(workspaceWidth) || workspaceWidth <= 0) {
    return directoryPanelMaxWidth
  }

  return Math.max(
    directoryPanelMinWidth,
    Math.min(
      directoryPanelMaxWidth,
      Math.floor(workspaceWidth - directoryContentMinWidth - directorySplitterWidth),
    ),
  )
}

export function clampDirectoryPanelWidth(width: number, workspaceWidth: number) {
  const finiteWidth = Number.isFinite(width) ? width : directoryPanelMinWidth
  return Math.round(Math.max(
    directoryPanelMinWidth,
    Math.min(getDirectoryPanelMaxWidth(workspaceWidth), finiteWidth),
  ))
}

export function hasDirectoryPanelResizeMoved(startX: number, currentX: number) {
  return Math.abs(currentX - startX) >= directoryResizeThreshold
}
