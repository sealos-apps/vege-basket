export function formatTestSpaceReference(name: string | null | undefined, versionLabel?: string | null) {
  const normalizedName = String(name ?? '').trim() || '未命名测试空间'
  const normalizedVersion = String(versionLabel ?? '').trim() || '未指定版本'
  return `${normalizedName} · ${normalizedVersion}`
}
