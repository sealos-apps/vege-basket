import assert from 'node:assert/strict'
import test from 'node:test'
import { isLegacyWeeklyReport } from './weekly-report-legacy-cleanup.ts'
import { WEEKLY_REPORT_TEMPLATE } from '../shared/weekly-report-template.ts'
import { createWeeklyReportDocument, serializeWeeklyReportDocument } from '../shared/weekly-report-document.ts'

const legacy = { report_profile: null, content: WEEKLY_REPORT_TEMPLATE, draft_content: WEEKLY_REPORT_TEMPLATE }

test('cleanup selects recognizable legacy drafts and submissions only', () => {
  assert.equal(isLegacyWeeklyReport(legacy, []), true)
  assert.equal(isLegacyWeeklyReport(legacy, [{ report_profile: null, content: WEEKLY_REPORT_TEMPLATE }]), true)
  assert.equal(isLegacyWeeklyReport({ ...legacy, content: '' }, []), true)
  assert.equal(isLegacyWeeklyReport({ ...legacy, content: '', draft_content: '' }, []), false)
  assert.equal(isLegacyWeeklyReport({ ...legacy, draft_content: 'unknown content' }, []), false)
})

for (const profile of ['developer', 'tester'] as const) {
  test(`cleanup preserves ${profile} drafts and every submitted v3 revision`, () => {
    const v3 = serializeWeeklyReportDocument(createWeeklyReportDocument(profile))
    assert.equal(isLegacyWeeklyReport({ ...legacy, report_profile: profile }, []), false)
    assert.equal(isLegacyWeeklyReport({ ...legacy, draft_content: v3 }, []), false)
    assert.equal(isLegacyWeeklyReport({ ...legacy, content: v3 }, []), false)
    assert.equal(isLegacyWeeklyReport(legacy, [{ report_profile: null, content: v3 }]), false)
    assert.equal(isLegacyWeeklyReport(legacy, [{ report_profile: profile, content: '' }]), false)
    assert.equal(isLegacyWeeklyReport({ ...legacy, draft_content: `<!-- veges-weekly-report:v3 -->\n${WEEKLY_REPORT_TEMPLATE}` }, []), false)
  })
}

test('cleanup includes older Markdown revisions but preserves future formats', () => {
  assert.equal(isLegacyWeeklyReport(legacy, [{ report_profile: null, content: 'custom Markdown' }]), true)
  assert.equal(isLegacyWeeklyReport(legacy, [{ report_profile: null, content: `<!-- veges-weekly-report:v4 -->\n${WEEKLY_REPORT_TEMPLATE}` }]), false)
})
