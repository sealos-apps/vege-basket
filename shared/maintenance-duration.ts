export function maintenanceDurationLabel(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  if (seconds < 60) return '少于 1 分钟'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) return remainingMinutes > 0
    ? `${hours} 小时 ${remainingMinutes} 分钟`
    : `${hours} 小时`
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours > 0 ? `${days} 天 ${remainingHours} 小时` : `${days} 天`
}
