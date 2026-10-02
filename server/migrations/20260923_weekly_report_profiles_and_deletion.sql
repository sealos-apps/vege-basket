begin;

alter table organization_weekly_reports
  add column if not exists report_profile text check (report_profile in ('developer', 'tester')),
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user_id bigint references users(id) on delete set null;

alter table organization_weekly_report_revisions
  add column if not exists report_profile text check (report_profile in ('developer', 'tester'));

alter table organization_weekly_report_reminders
  add column if not exists report_profile text check (report_profile in ('developer', 'tester'));

alter table organization_weekly_summaries
  add column if not exists stale boolean not null default false,
  add column if not exists stale_at timestamptz;

alter table organization_weekly_reports
  drop constraint if exists organization_weekly_reports_organization_id_user_id_week_start_key;

update organization_weekly_report_revisions revision
set report_profile = report.report_profile
from organization_weekly_reports report
where report.id = revision.report_id and revision.report_profile is null
  and report.report_profile is not null;

create unique index if not exists idx_organization_weekly_reports_active_profile
  on organization_weekly_reports(organization_id, user_id, week_start, report_profile)
  where deleted_at is null and report_profile is not null;

create unique index if not exists idx_organization_weekly_reports_active_legacy
  on organization_weekly_reports(organization_id, user_id, week_start)
  where deleted_at is null and report_profile is null;

create index if not exists idx_organization_weekly_reports_user_week
  on organization_weekly_reports(organization_id, user_id, week_start desc)
  where deleted_at is null;

alter table organization_weekly_report_reminders
  drop constraint if exists organization_weekly_report_reminders_organization_id_target_user_id_week_start_reminder_day_key;
drop index if exists idx_organization_weekly_report_reminders_organization_id_target_user_id_week_start_reminder_day_key;
create unique index if not exists idx_weekly_report_reminders_profile
  on organization_weekly_report_reminders(organization_id, target_user_id, week_start, reminder_day, report_profile);

commit;
