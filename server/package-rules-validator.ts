import * as yaml from 'js-yaml'

export type PackageRulesValidationIssue = {
  column?: number
  line?: number
  message: string
  path: string
}

export type PackageRulesValidationResult = {
  errors: PackageRulesValidationIssue[]
  ruleCount: number
  valid: boolean
  warnings: PackageRulesValidationIssue[]
}

const maxBytes = 256 * 1024
const maxRules = 500
const maxListItems = 100
const maxDepth = 64
const rootFields = new Set(['page_kinds', 'middleware', 'rules'])
const pageKindFields = new Set(['key', 'label_zh', 'labelZh', 'discovery'])
const discoveryFields = new Set(['roots'])
const ruleFields = new Set([
  'name',
  'category',
  'roots',
  'file_name_format',
  'file_name_formats',
  'ci_file_name_formats',
  'dependency_roots',
  'dependency_file_patterns',
  'parent',
])
const supportedTemplateKeys = new Set(['arch', 'branch', 'deployType', 'fileName', 'hash', 'version'])

function issue(path: string, message: string): PackageRulesValidationIssue {
  return { message, path }
}

function recordObjectDepth(
  value: unknown,
  path: string,
  depth: number,
  errors: PackageRulesValidationIssue[],
) {
  if (depth > maxDepth) {
    errors.push(issue(path, `嵌套深度不能超过 ${maxDepth} 层。`))
    return
  }
  if (Array.isArray(value)) {
    if (value.length > maxListItems) errors.push(issue(path, `列表不能超过 ${maxListItems} 项。`))
    value.forEach((entry, index) => recordObjectDepth(entry, `${path}[${index}]`, depth + 1, errors))
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      recordObjectDepth(entry, `${path}.${key}`, depth + 1, errors)
    }
  }
}

function asRecord(value: unknown, path: string, errors: PackageRulesValidationIssue[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(issue(path, '必须是对象。'))
    return {} as Record<string, unknown>
  }
  return value as Record<string, unknown>
}

function checkUnknownFields(
  value: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  errors: PackageRulesValidationIssue[],
) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(issue(`${path}.${key}`, '不是支持的字段。'))
  }
}

function stringList(value: unknown, path: string, errors: PackageRulesValidationIssue[]) {
  if (!Array.isArray(value)) {
    errors.push(issue(path, '必须是字符串列表。'))
    return []
  }
  if (value.length > maxListItems) errors.push(issue(path, `列表不能超过 ${maxListItems} 项。`))
  return value.flatMap((entry, index) => {
    if (typeof entry !== 'string' || !entry.trim()) {
      errors.push(issue(`${path}[${index}]`, '必须是非空字符串。'))
      return []
    }
    return [entry.trim()]
  })
}

function validateRelativePath(value: string, path: string, errors: PackageRulesValidationIssue[]) {
  if (
    value.startsWith('/') || value.startsWith('\\') || value.includes('..') ||
    value.includes('://') || [...value].some((character) => character.charCodeAt(0) < 32)
  ) errors.push(issue(path, '必须是安全的相对对象路径。'))
}

function validateTemplate(value: string, path: string, errors: PackageRulesValidationIssue[]) {
  for (const match of value.matchAll(/\{([^{}]+)\}/gu)) {
    if (!supportedTemplateKeys.has(match[1])) {
      errors.push(issue(path, `不支持占位符 {${match[1]}}。`))
    }
  }
  const withoutSupported = value.replace(/%s/gu, '').replace(/\{[^{}]+\}/gu, '')
  if (withoutSupported.includes('%')) errors.push(issue(path, '只支持 %s 或已声明的花括号占位符。'))
}

function yamlSyntaxError(error: unknown) {
  const mark = error && typeof error === 'object' && 'mark' in error
    ? (error as { mark?: { column?: number; line?: number } }).mark
    : undefined
  const message = error instanceof Error ? error.message.split('\n')[0] : 'YAML 解析失败。'
  return {
    column: mark?.column === undefined ? undefined : mark.column + 1,
    line: mark?.line === undefined ? undefined : mark.line + 1,
    message,
    path: 'yaml',
  }
}

export function validatePackageRulesYaml(source: string): PackageRulesValidationResult {
  const errors: PackageRulesValidationIssue[] = []
  const warnings: PackageRulesValidationIssue[] = []
  if (Buffer.byteLength(source, 'utf8') > maxBytes) {
    errors.push(issue('yaml', '规则内容不能超过 256 KiB。'))
    return { errors, ruleCount: 0, valid: false, warnings }
  }
  let parsed: unknown
  try {
    const events = yaml.parseEvents(source, { maxDepth })
    if (events.some((event) => event.type === yaml.EVENT_ALIAS ||
      ('anchorStart' in event && event.anchorStart !== -1))) {
      errors.push(issue('yaml', '不允许使用 YAML 锚点或别名。'))
    }
    if (events.some((event) => 'tagStart' in event && event.tagStart !== -1)) {
      errors.push(issue('yaml', '不允许使用自定义 YAML 标签。'))
    }
    parsed = yaml.load(source, {
      json: false,
      maxAliases: 0,
      maxDepth,
      schema: yaml.JSON_SCHEMA,
    })
  } catch (error) {
    errors.push(yamlSyntaxError(error))
    return { errors, ruleCount: 0, valid: false, warnings }
  }
  recordObjectDepth(parsed, 'config', 0, errors)
  const root = asRecord(parsed, 'config', errors)
  checkUnknownFields(root, rootFields, 'config', errors)

  const pageKinds = asRecord(root.page_kinds, 'page_kinds', errors)
  const pageKindKeys = new Set<string>()
  for (const [code, rawPageKind] of Object.entries(pageKinds)) {
    const path = `page_kinds.${code}`
    const pageKind = asRecord(rawPageKind, path, errors)
    checkUnknownFields(pageKind, pageKindFields, path, errors)
    const key = typeof pageKind.key === 'string' ? pageKind.key.trim() : ''
    if (!key) errors.push(issue(`${path}.key`, '必须是非空字符串。'))
    if (pageKindKeys.has(key)) errors.push(issue(`${path}.key`, '页面类型 key 不能重复。'))
    pageKindKeys.add(key)
    if (pageKind.discovery !== undefined) {
      const discovery = asRecord(pageKind.discovery, `${path}.discovery`, errors)
      checkUnknownFields(discovery, discoveryFields, `${path}.discovery`, errors)
      stringList(discovery.roots, `${path}.discovery.roots`, errors)
        .forEach((entry, index) => validateRelativePath(entry, `${path}.discovery.roots[${index}]`, errors))
    }
  }
  if (root.middleware !== undefined) {
    const middleware = asRecord(root.middleware, 'middleware', errors)
    checkUnknownFields(middleware, discoveryFields, 'middleware', errors)
    stringList(middleware.roots, 'middleware.roots', errors)
      .forEach((entry, index) => validateRelativePath(entry, `middleware.roots[${index}]`, errors))
  }

  const rules = asRecord(root.rules, 'rules', errors)
  const ruleEntries = Object.entries(rules)
  if (ruleEntries.length > maxRules) errors.push(issue('rules', `规则不能超过 ${maxRules} 条。`))
  const normalizedIds = new Map<string, string>()
  const parents = new Map<string, string>()
  for (const [rawId, rawRule] of ruleEntries) {
    const id = rawId.trim().toLowerCase()
    const path = `rules.${rawId}`
    if (!id || !/^[a-z0-9][a-z0-9._:-]*$/u.test(id)) errors.push(issue(path, '规则 ID 格式无效。'))
    if (normalizedIds.has(id)) errors.push(issue(path, `规则 ID 与 ${normalizedIds.get(id)} 重复。`))
    normalizedIds.set(id, rawId)
    const rule = asRecord(rawRule, path, errors)
    checkUnknownFields(rule, ruleFields, path, errors)
    if (rule.name !== undefined && (typeof rule.name !== 'string' || !rule.name.trim())) {
      errors.push(issue(`${path}.name`, '必须是非空字符串。'))
    }
    if (rule.category !== undefined &&
      (typeof rule.category !== 'string' || !pageKinds[rule.category])) {
      errors.push(issue(`${path}.category`, '必须引用已声明的 page_kinds。'))
    }
    for (const field of ['roots', 'dependency_roots'] as const) {
      if (rule[field] === undefined) continue
      stringList(rule[field], `${path}.${field}`, errors)
        .forEach((entry, index) => validateRelativePath(entry, `${path}.${field}[${index}]`, errors))
    }
    for (const field of ['file_name_formats', 'ci_file_name_formats', 'dependency_file_patterns'] as const) {
      if (rule[field] === undefined) continue
      stringList(rule[field], `${path}.${field}`, errors)
        .forEach((entry, index) => validateTemplate(entry, `${path}.${field}[${index}]`, errors))
    }
    if (rule.file_name_format !== undefined) {
      if (typeof rule.file_name_format !== 'string' || !rule.file_name_format.trim()) {
        errors.push(issue(`${path}.file_name_format`, '必须是非空字符串。'))
      } else validateTemplate(rule.file_name_format, `${path}.file_name_format`, errors)
    }
    if (rule.parent !== undefined) {
      if (typeof rule.parent !== 'string' || !rule.parent.trim()) {
        errors.push(issue(`${path}.parent`, '必须是非空规则 ID。'))
      } else parents.set(id, rule.parent.trim().toLowerCase())
    }
  }

  for (const [id, parent] of parents) {
    if (!normalizedIds.has(parent)) errors.push(issue(`rules.${id}.parent`, `父规则 ${parent} 不存在。`))
    const visited = new Set<string>([id])
    let cursor = parent
    while (parents.has(cursor)) {
      if (visited.has(cursor)) {
        errors.push(issue(`rules.${id}.parent`, '父规则存在循环引用。'))
        break
      }
      visited.add(cursor)
      cursor = parents.get(cursor) ?? ''
    }
  }
  if (ruleEntries.length === 0) warnings.push(issue('rules', '当前规则列表为空。'))
  return { errors, ruleCount: ruleEntries.length, valid: errors.length === 0, warnings }
}
