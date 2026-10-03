import type { DeliveryRuntimeConfig } from '../shared/delivery-artifact.ts'

type VerificationPackageDownload = {
  downloadUrl: string
  objectKey: string
  runtimeConfig?: DeliveryRuntimeConfig
}

type OfflinePackageDownload = {
  downloadUrl: string
  fileName: string
  runtimeConfig?: DeliveryRuntimeConfig
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function runtimeEnvironmentArguments(config: DeliveryRuntimeConfig | undefined) {
  return (config?.environmentVariables ?? []).flatMap((variable) => ['--env', shellQuote(`${variable.name}=${variable.value}`)])
}

function createRuntimeCommand(command: string, config?: DeliveryRuntimeConfig, deliveryDirVariable = '$delivery_dir') {
  const environmentArguments = runtimeEnvironmentArguments(config)
  const run = [command, ...environmentArguments].join(' ')
  if (!config?.valuesPath || !config.valuesPatch) return run
  const token = Buffer.from(config.valuesPath).toString('hex').slice(0, 24)
  const valuesPatchBase64 = Buffer.from(config.valuesPatch).toString('base64')
  return [
    '(',
    '  set -e',
    '',
    '  # 检查 Values 修改所需的命令依赖。',
    '  if ! command -v yq >/dev/null 2>&1 || ! yq --version 2>&1 | grep -Eq "(^|[[:space:]])v?4\\."; then',
    '    echo "缺少 yq v4，无法应用 Values 修改" >&2',
    '    exit 1',
    '  fi',
    '  if ! command -v flock >/dev/null 2>&1; then',
    '    echo "缺少 flock，无法安全修改 Values 文件" >&2',
    '    exit 1',
    '  fi',
    '',
    '  # 只允许修改 Sealos Values 目录中的文件。',
    `  values_path="$(realpath -- ${shellQuote(config.valuesPath)})"`,
    '  case "$values_path" in',
    '    /root/.sealos/cloud/values/*) ;;',
    `    *) echo ${shellQuote('Values 文件必须位于 /root/.sealos/cloud/values/ 下')} >&2; exit 1 ;;`,
    '  esac',
    `  if [[ ! -f "$values_path" ]]; then
    echo ${shellQuote(`Values 文件不存在：${config.valuesPath}`)} >&2
    exit 1
  fi`,
    '',
    '  # 备份原文件，脚本结束时无论成功或失败都恢复。',
    `  values_backup="${deliveryDirVariable}/values-backup-${token}"`,
    `  values_overlay="${deliveryDirVariable}/values-overlay-${token}.yaml"`,
    `  values_merged="${deliveryDirVariable}/values-merged-${token}.yaml"`,
    '  exec 9>"$values_path.veges.lock"',
    '  flock -x 9',
    '  cp -- "$values_path" "$values_backup"',
    '  restore_values() {',
    '    restore_status=$?',
    '    if ! cp -- "$values_backup" "$values_path"; then',
    '      echo "无法恢复 Values 文件：$values_path" >&2',
    '      restore_status=1',
    '    fi',
    '    return "$restore_status"',
    '  }',
    '  trap restore_values EXIT',
    '',
    '  # 写入临时 overlay，合并后执行交付命令。',
    `  printf '%s' ${shellQuote(valuesPatchBase64)} | base64 -d > "$values_overlay"`,
    `  yq ea 'select(fileIndex == 0) * select(fileIndex == 1)' "$values_path" "$values_overlay" > "$values_merged"`,
    '  cp -- "$values_merged" "$values_path"',
    `  ${run}`,
    ')',
  ].join('\n')
}

function wrapStandaloneCommands(commands: string[], needsDeliveryDirectory: boolean) {
  if (commands.length === 0) return ''
  if (!needsDeliveryDirectory) return commands.join(' && \\\n')
  return [
    'delivery_dir="$(mktemp -d)"',
    `trap 'rm -rf "$delivery_dir"' EXIT`,
    ...commands,
  ].join(' && \\\n')
}

function archiveFileName(objectKey: string, index: number, usedNames: Set<string>) {
  const candidate = objectKey.split('/').at(-1)?.replace(/[^A-Za-z0-9._-]/gu, '-') || `package-${index + 1}.tar`
  const stem = candidate.replace(/(\.[A-Za-z0-9]+)?$/u, '') || `package-${index + 1}`
  const extension = candidate.slice(stem.length)
  let fileName = candidate
  let duplicate = 2
  while (usedNames.has(fileName)) {
    fileName = `${stem}-${duplicate}${extension}`
    duplicate += 1
  }
  usedNames.add(fileName)
  return fileName
}

export function createPackageVerificationScript(packages: readonly VerificationPackageDownload[]) {
  const usedNames = new Set<string>()
  const commands = packages.map((item, index) => {
    const fileName = archiveFileName(item.objectKey, index, usedNames)
    return `wget ${shellQuote(item.downloadUrl)} -O ${shellQuote(fileName)} && ${createRuntimeCommand(`sealos run -f ${shellQuote(fileName)}`, item.runtimeConfig)}`
  })
  return wrapStandaloneCommands(commands, packages.some((item) => item.runtimeConfig?.valuesPatch))
}

export function createClusterImageVerificationScript(images: ReadonlyArray<string | { image: string; runtimeConfig?: DeliveryRuntimeConfig }>) {
  const normalizedImages = images.map((entry) => {
    const item = typeof entry === 'string' ? { image: entry } : entry
    return { command: createRuntimeCommand(`sealos run -f ${shellQuote(item.image)}`, item.runtimeConfig), runtimeConfig: item.runtimeConfig }
  })
  return wrapStandaloneCommands(
    normalizedImages.map((item) => item.command),
    normalizedImages.some((item) => item.runtimeConfig?.valuesPatch),
  )
}

export function createDeliveryExecutionScript(input: {
  images: ReadonlyArray<string | { image: string; runtimeConfig?: DeliveryRuntimeConfig }>
  offlinePackages: readonly OfflinePackageDownload[]
  packages: readonly VerificationPackageDownload[]
}) {
  const usedNames = new Set<string>()
  const archiveCommands = [
    ...input.packages.map((item, index) => {
      const fileName = archiveFileName(item.objectKey, index, usedNames)
      const target = `"$delivery_dir/${fileName}"`
      return [
        `wget ${shellQuote(item.downloadUrl)} -O ${target} && ${createRuntimeCommand(`sealos run -f ${target}`, item.runtimeConfig)}`,
      ].join(' && \\\n')
    }),
    ...input.offlinePackages.map((item, index) => {
      const fileName = archiveFileName(item.fileName, input.packages.length + index, usedNames)
      const target = `"$delivery_dir/${fileName}"`
      return [
        `wget ${shellQuote(item.downloadUrl)} -O ${target} && ${createRuntimeCommand(`sealos run -f ${target}`, item.runtimeConfig)}`,
      ].join(' && \\\n')
    }),
  ]
  const images = input.images.map((entry) => typeof entry === 'string' ? { image: entry } : entry)
  const needsDeliveryDirectory = archiveCommands.length > 0 || images.some((item) => item.runtimeConfig?.valuesPatch)
  const commands = [
    ...(needsDeliveryDirectory
      ? ['delivery_dir="$(mktemp -d)"', `trap 'rm -rf "$delivery_dir"' EXIT`, ...archiveCommands]
      : []),
    ...images.map((item) => createRuntimeCommand(`sealos run -f ${shellQuote(item.image)}`, item.runtimeConfig)),
  ]
  return commands.join(' && \\\n')
}

export function createOfflineDeliveryExecutionScript(input: {
  fileName: string
  runtimeConfig?: DeliveryRuntimeConfig
}) {
  const command = createRuntimeCommand(`sealos run -f ${shellQuote(input.fileName)}`, input.runtimeConfig)
  return wrapStandaloneCommands([command], Boolean(input.runtimeConfig?.valuesPatch))
}
