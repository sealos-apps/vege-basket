alter table organization_weekly_reports
  add column if not exists draft_item_sources text;
alter table organization_weekly_report_revisions
  add column if not exists source_snapshots text;
