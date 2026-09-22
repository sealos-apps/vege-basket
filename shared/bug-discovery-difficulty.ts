export const bugDiscoveryDifficulties = ['high', 'medium', 'low'] as const
export type BugDiscoveryDifficulty = (typeof bugDiscoveryDifficulties)[number]

export const bugDiscoveryDifficultyLabels: Record<BugDiscoveryDifficulty, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

export const bugDiscoveryDifficultyDescriptions: Record<BugDiscoveryDifficulty, string> = {
  high: '需要复杂组合、并发时序、长期运行、资源压力或深入观测才能发现。',
  medium: '需要边界、异常、权限、状态流转或兼容性等专项用例才能发现。',
  low: '标准环境、常规数据和正常流程下，通过基础检查即可发现。',
}

export const bugDiscoveryDifficultyReasonMaxLength = 1000

export type BugDiscoveryAssessment = {
  discoveryDifficulty: BugDiscoveryDifficulty
  discoveryDifficultyReason: string
}

export function isBugDiscoveryDifficulty(value: unknown): value is BugDiscoveryDifficulty {
  return typeof value === 'string' && bugDiscoveryDifficulties.includes(value as BugDiscoveryDifficulty)
}

/** For PATCH, current must be the canonical assessment read under the Bug row lock. */
export function parseBugDiscoveryAssessment(
  input: { discoveryDifficulty?: unknown; discoveryDifficultyReason?: unknown },
  current?: BugDiscoveryAssessment,
): { valid: true; value: BugDiscoveryAssessment } | { valid: false; error: string } {
  const difficulty = input.discoveryDifficulty === undefined
    ? current?.discoveryDifficulty
    : input.discoveryDifficulty
  if (!isBugDiscoveryDifficulty(difficulty)) {
    return { valid: false, error: '请选择发现难度：高、中或低。' }
  }
  const rawReason = input.discoveryDifficultyReason === undefined
    ? current?.discoveryDifficultyReason ?? ''
    : input.discoveryDifficultyReason
  if (typeof rawReason !== 'string') {
    return { valid: false, error: '发现难度评定依据必须是文本。' }
  }
  const reason = rawReason.trim()
  if (reason.length > bugDiscoveryDifficultyReasonMaxLength) {
    return { valid: false, error: '发现难度评定依据不能超过 1000 字。' }
  }
  if (difficulty === 'high' && !reason) {
    return { valid: false, error: '高发现难度必须填写评定依据，请说明必要触发条件或观察手段。' }
  }
  return {
    valid: true,
    value: { discoveryDifficulty: difficulty, discoveryDifficultyReason: reason },
  }
}
