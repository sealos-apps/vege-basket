import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampDirectoryPanelWidth,
  directoryPanelMaxWidth,
  directoryPanelMinWidth,
  getDefaultDirectoryPanelWidth,
  getDirectoryPanelMaxWidth,
  hasDirectoryPanelResizeMoved,
} from '../src/test-directory-panel-width.ts'

test('case directory panel preserves the existing responsive defaults', () => {
  assert.equal(getDefaultDirectoryPanelWidth(false), 248)
  assert.equal(getDefaultDirectoryPanelWidth(true), 220)
})

test('case directory panel keeps the case content usable while resizing', () => {
  assert.equal(getDirectoryPanelMaxWidth(1200), directoryPanelMaxWidth)
  assert.equal(getDirectoryPanelMaxWidth(760), 320)
  assert.equal(getDirectoryPanelMaxWidth(600), directoryPanelMinWidth)
  assert.equal(getDirectoryPanelMaxWidth(0), directoryPanelMaxWidth)

  assert.equal(clampDirectoryPanelWidth(160, 1200), directoryPanelMinWidth)
  assert.equal(clampDirectoryPanelWidth(900, 1200), directoryPanelMaxWidth)
  assert.equal(clampDirectoryPanelWidth(400, 760), 320)
  assert.equal(clampDirectoryPanelWidth(Number.NaN, 1200), directoryPanelMinWidth)
})

test('case directory panel ignores clicks and pointer jitter', () => {
  assert.equal(hasDirectoryPanelResizeMoved(300, 300), false)
  assert.equal(hasDirectoryPanelResizeMoved(300, 301), false)
  assert.equal(hasDirectoryPanelResizeMoved(300, 302), true)
  assert.equal(hasDirectoryPanelResizeMoved(300, 280), true)
})
