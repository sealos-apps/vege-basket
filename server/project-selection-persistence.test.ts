import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('project basket selection is restored after a browser refresh', () => {
  assert.match(appSource, /const selectedProjectStorageKey = 'veges\.selectedProject\.v1'/u)
  assert.match(appSource, /useState<number \| null>\(\(\)\s*=>\s*loadStoredSelectedProjectId\(\),?\s*\)/u)
  assert.match(appSource, /localStorage\.setItem\(selectedProjectStorageKey, String\(selectedProjectId\)\)/u)
  assert.match(appSource, /const preferredProjectId = current \?\? loadStoredSelectedProjectId\(\)/u)
})

test('project basket hides completed todos by default while preserving explicit status filters', () => {
  const todoListStart = appSource.indexOf('function TodoList(')
  const todoListSource = appSource.slice(todoListStart)

  assert.ok(todoListStart >= 0)
  assert.match(todoListSource, /const hasExplicitDoneFilter = todoFilterConditions\.some\(\(condition\) => condition\.field === 'done'\)/u)
  assert.match(todoListSource, /const useDefaultDoneFilter = !todoFilterPersistenceEnabled && !hasExplicitDoneFilter/u)
  assert.match(todoListSource, /\(!useDefaultDoneFilter \|\| !todo\.done\)/u)
})
