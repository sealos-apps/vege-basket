import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { validatePackageRulesYaml } from './package-rules-validator.ts'

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))

test('bundled package rules pass the platform validator', () => {
  const source = fs.readFileSync(path.join(serverDirectory, 'trial-combo-package-rules.yaml'), 'utf8')
  const result = validatePackageRulesYaml(source)
  assert.equal(result.valid, true, JSON.stringify(result.errors))
  assert.ok(result.ruleCount > 10)
})

test('package rules reject duplicates, aliases, traversal, unknown fields and cycles', () => {
  const duplicate = validatePackageRulesYaml('page_kinds: {}\nrules:\n  one: {}\n  one: {}\n')
  assert.equal(duplicate.valid, false)

  const invalid = validatePackageRulesYaml(`
page_kinds:
  apps: &kind
    key: app
rules:
  first:
    roots: [../private]
    parent: second
    unknown: true
  second:
    parent: first
`)
  assert.equal(invalid.valid, false)
  assert.ok(invalid.errors.some((entry) => entry.message.includes('锚点')))
  assert.ok(invalid.errors.some((entry) => entry.message.includes('相对对象路径')))
  assert.ok(invalid.errors.some((entry) => entry.message.includes('循环')))
  assert.ok(invalid.errors.some((entry) => entry.path.endsWith('.unknown')))

  const flowAlias = validatePackageRulesYaml(
    'page_kinds: {}\nrules: {a: {roots: [&x foo]}, b: {roots: [*x]}}\n',
  )
  assert.equal(flowAlias.valid, false)
  assert.ok(flowAlias.errors.some((entry) => entry.message.includes('锚点')))
})

test('package rules reject unsafe tags and unsupported placeholders', () => {
  const result = validatePackageRulesYaml(`
page_kinds:
  apps:
    key: app
rules:
  app:
    roots: [offline/apps]
    file_name_format: !<tag:example.com,2026:value> app-{secret}.tar
`)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((entry) => entry.message.includes('标签')))
})
