-- Veges incremental migration: organization-level weekly report assignees.
-- Existing and future memberships require reports by default; the reserved
-- admin account remains excluded from weekly report collection.

begin;

alter table organization_memberships
  add column if not exists weekly_report_required boolean not null default true;

update organization_memberships membership
set weekly_report_required = false
from users
where users.id = membership.user_id
  and lower(users.email) = 'admin'
  and membership.weekly_report_required = true;

commit;
