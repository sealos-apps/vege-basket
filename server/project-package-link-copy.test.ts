import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workbenchSource = readFileSync(
  new URL('../src/components/project-package-workbench.tsx', import.meta.url),
  'utf8',
)

test('delivery content exposes authorized online and offline commands', () => {
  assert.match(workbenchSource, /process\.onlineCommand \?\? ''/u)
  assert.match(workbenchSource, /process\.offlineCommand \?\? ''/u)
  assert.match(workbenchSource, /在线命令/u)
  assert.match(workbenchSource, /离线命令/u)
  assert.doesNotMatch(workbenchSource, /onLoadPackageItemDownloadUrl/u)
})
