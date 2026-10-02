import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendWeeklyReportDeepLink,
  parseWeeklyReportDeepLink,
  removeWeeklyReportDeepLink,
} from '../shared/weekly-report-deep-link.ts'

test('weekly report deep links require one positive organization id and a valid date', () => {
  assert.deepEqual(parseWeeklyReportDeepLink(''), {
    organizationId: null,
    profile: null,
    status: 'absent',
    weekStart: null,
  })
  assert.deepEqual(parseWeeklyReportDeepLink('?weeklyReportOrg=12&weekStart=2026-07-27'), {
    organizationId: 12,
    profile: null,
    status: 'valid',
    weekStart: '2026-07-27',
  })
  assert.equal(parseWeeklyReportDeepLink('?weeklyReportOrg=0&weekStart=2026-07-27').status, 'invalid')
  assert.equal(parseWeeklyReportDeepLink('?weeklyReportOrg=12&weekStart=2026-02-30').status, 'invalid')
  assert.equal(parseWeeklyReportDeepLink('?weeklyReportOrg=12').status, 'invalid')
})

test('weekly report deep links preserve unrelated query parameters', () => {
  assert.equal(
    removeWeeklyReportDeepLink('?invite=abc&weeklyReportOrg=12&weekStart=2026-07-27&todo=4'),
    '?invite=abc&todo=4',
  )
})

test('weekly report URLs use the trusted application origin', () => {
  assert.equal(
    appendWeeklyReportDeepLink('https://veges.example/', 12, '2026-07-27'),
    'https://veges.example/?weeklyReportOrg=12&weekStart=2026-07-27',
  )
  assert.equal(
    appendWeeklyReportDeepLink('https://veges.example/', 12, '2026-07-27', 'tester'),
    'https://veges.example/?weeklyReportOrg=12&weekStart=2026-07-27&weeklyReportProfile=tester',
  )
  assert.equal(parseWeeklyReportDeepLink('?weeklyReportOrg=12&weekStart=2026-07-27&weeklyReportProfile=developer').profile, 'developer')
})
