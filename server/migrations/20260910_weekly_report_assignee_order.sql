-- Preserve existing name ordering until an organization saves an explicit order.
begin;

alter table organization_memberships
  add column if not exists weekly_report_sort_order integer
    check (weekly_report_sort_order >= 0);

commit;
