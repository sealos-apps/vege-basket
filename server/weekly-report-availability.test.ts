import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultWeeklyReportRules,
  getWeeklyReportCreationAvailability,
  getWeeklyReportRulesExample,
  getWeeklyReportTargetWeekStart,
  normalizeWeeklyReportRules,
  submittedWeeklyReportCreationReason,
} from '../shared/weekly-report-availability.ts'
import { formatShanghaiCalendarDate } from '../shared/calendar-date.ts'

test('rule examples show the report period, actual window, and next opening', () => {
  assert.deepEqual(getWeeklyReportRulesExample({
    today: '2026-09-10', weekStartsOn: 1, rules: defaultWeeklyReportRules,
  }), {
    weekStart: '2026-09-07', weekEnd: '2026-09-13',
    opensAt: '2026-09-11T00:00:00', closesAt: '2026-09-14T23:59:59',
    nextOpensAt: '2026-09-18T00:00:00',
  })
})

test('rule examples count from the organization start day across months and years', () => {
  assert.deepEqual(getWeeklyReportRulesExample({
    today: '2026-12-31', weekStartsOn: 7,
    rules: { openDay: 5, openTime: '09:30', closeDay: 2, closeTime: '18:00' },
  }), {
    weekStart: '2026-12-27', weekEnd: '2027-01-02',
    opensAt: '2026-12-31T09:30:00', closesAt: '2027-01-04T18:00:59',
    nextOpensAt: '2027-01-07T09:30:00',
  })
})

test('invalid or overlapping rule drafts never show a default example', () => {
  for (const rules of [
    { ...defaultWeeklyReportRules, openTime: '' },
    { ...defaultWeeklyReportRules, closeDay: 7 },
    { openDay: 5, openTime: '09:00', closeDay: 5, closeTime: '09:00' },
  ]) {
    assert.equal(getWeeklyReportRulesExample({ today: '2026-09-10', weekStartsOn: 1, rules }), null)
  }
})

test('example boundaries agree with submission availability to the second', () => {
  const rules = { openDay: 5, openTime: '09:00', closeDay: 5, closeTime: '08:59' }
  const example = getWeeklyReportRulesExample({ today: '2026-09-10', weekStartsOn: 1, rules })!
  for (const [now, enabled] of [
    ['2026-09-11T08:59:59', false], [example.opensAt, true],
    [example.closesAt, true], [example.nextOpensAt, false],
  ] as const) {
    assert.equal(getWeeklyReportCreationAvailability({
      rules, now, today: now.slice(0, 10), weekStart: example.weekStart,
      loading: false, submitted: false,
    }).enabled, enabled)
  }
})

test('database date values preserve the Shanghai calendar day', () => {
  assert.equal(formatShanghaiCalendarDate(new Date('2026-07-26T16:00:00.000Z')), '2026-07-27')
  assert.equal(formatShanghaiCalendarDate('2026-07-27'), '2026-07-27')
})

test('weekly report rules reject a window that reaches the next opening', () => {
  assert.deepEqual(normalizeWeeklyReportRules(defaultWeeklyReportRules), defaultWeeklyReportRules)
  assert.equal(normalizeWeeklyReportRules({
    closeDay: 7,
    closeTime: '23:59',
    openDay: 5,
    openTime: '00:00',
  }), null)
  assert.equal(normalizeWeeklyReportRules({
    closeDay: 5,
    closeTime: '09:00',
    openDay: 5,
    openTime: '09:00',
  }), null)
})

test('weekly report target stays on the previous period through its configured deadline', () => {
  assert.equal(getWeeklyReportTargetWeekStart({
    now: '2026-08-03T23:59:59',
    weekStartsOn: 1,
  }), '2026-07-27')
  assert.equal(getWeeklyReportTargetWeekStart({
    now: '2026-08-04T00:00:00',
    weekStartsOn: 1,
  }), '2026-08-03')
})

test('weekly reports become creatable on the fifth day of the organization week', () => {
  assert.equal(getWeeklyReportCreationAvailability({
    loading: false,
    submitted: false,
    today: '2026-07-30',
    weekStart: '2026-07-26',
  }).enabled, true)
  assert.equal(getWeeklyReportCreationAvailability({
    loading: false,
    submitted: false,
    today: '2026-07-31',
    weekStart: '2026-07-27',
  }).enabled, true)
  assert.equal(getWeeklyReportCreationAvailability({
    loading: false,
    submitted: false,
    today: '2026-07-29',
    weekStart: '2026-07-26',
  }).enabled, false)
  assert.equal(getWeeklyReportCreationAvailability({
    loading: false,
    submitted: false,
    today: '2026-08-01',
    weekStart: '2026-07-26',
  }).enabled, true)
})

test('a submitted current-week report keeps creation disabled', () => {
  const availability = getWeeklyReportCreationAvailability({
    loading: false,
    submitted: true,
    today: '2026-08-01',
    weekStart: '2026-07-26',
  })
  assert.equal(availability.enabled, false)
  assert.equal(availability.reason, submittedWeeklyReportCreationReason)
})

test('weekly report creation stays open through the following Monday', () => {
  const deadlineDay = getWeeklyReportCreationAvailability({
    loading: false,
    submitted: false,
    today: '2026-08-03',
    weekStart: '2026-07-27',
  })
  assert.equal(deadlineDay.enabled, true)
  assert.equal(deadlineDay.deadlineDate, '2026-08-03')

  const afterDeadline = getWeeklyReportCreationAvailability({
    loading: false,
    submitted: false,
    today: '2026-08-04',
    weekStart: '2026-07-27',
  })
  assert.equal(afterDeadline.enabled, false)
  assert.match(afterDeadline.reason, /2026\/08\/03 23:59/u)
})
