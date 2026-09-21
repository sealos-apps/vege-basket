import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workbench = readFileSync(new URL('../src/components/weekly-report-workbench.tsx', import.meta.url), 'utf8')

test('weekly report entry cannot fall back to the free-form Markdown editor', () => {
  // The regression only affected legacy data; new-format fixtures missed this dependency.
  assert.doesNotMatch(workbench, /MarkdownWysiwygEditor|markdown-wysiwyg-editor/)
  assert.match(workbench, /<WeeklyReportForm\b/)
  assert.match(workbench, /<WeeklyReportReading\b/)
})

test('developer and tester entry points share the guarded weekly report workbench', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const tester = readFileSync(new URL('../src/components/test-workbench.tsx', import.meta.url), 'utf8')
  assert.match(app, /<WeeklyReportWorkbench\b/)
  assert.match(tester, /<WeeklyReportWorkbench\b[^>]*activeProfile="tester"/)
})
