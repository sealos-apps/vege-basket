-- Additive migration. Do not infer the occupational profile of historical reports.
alter table organization_weekly_reports
  add column if not exists report_profile text check (report_profile in ('developer', 'tester'));
alter table organization_weekly_report_revisions
  add column if not exists report_profile text check (report_profile in ('developer', 'tester'));
create table if not exists organization_weekly_report_test_sources (
  id bigserial primary key,
  report_id bigint not null references organization_weekly_reports(id) on delete cascade,
  revision_id bigint,
  bug_id bigint references test_bugs(id) on delete cascade,
  test_plan_id bigint references test_plans(id) on delete cascade,
  created_at timestamptz not null default now(),
  foreign key (revision_id, report_id) references organization_weekly_report_revisions(id, report_id) on delete cascade,
  check (num_nonnulls(bug_id, test_plan_id) = 1)
);
create unique index if not exists idx_weekly_report_test_sources_bug
  on organization_weekly_report_test_sources(report_id, coalesce(revision_id, 0), bug_id) where bug_id is not null;
create unique index if not exists idx_weekly_report_test_sources_plan
  on organization_weekly_report_test_sources(report_id, coalesce(revision_id, 0), test_plan_id) where test_plan_id is not null;
