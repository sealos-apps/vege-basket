-- Configure weekly-report eligibility per organization member and persona.

begin;

alter table organization_memberships
  add column if not exists weekly_report_profiles text[] not null default '{}'::text[];

update organization_memberships membership
set weekly_report_profiles = coalesce((
  select array_agg(profile order by profile)
  from (
    select distinct case
      when role.role = 'organization_admin' then profile.value
      else role.role
    end as profile
    from user_roles role
    cross join lateral unnest(
      case when role.role = 'organization_admin'
        then array['developer', 'tester']::text[]
        else array[role.role]::text[]
      end
    ) profile(value)
    where role.user_id = membership.user_id
      and role.role in ('developer', 'tester', 'organization_admin')
  ) assigned_profiles
), '{}'::text[])
where membership.weekly_report_required = true
  and cardinality(membership.weekly_report_profiles) = 0;

alter table organization_memberships
  alter column weekly_report_required set default false;

update organization_memberships
set weekly_report_required = cardinality(weekly_report_profiles) > 0
where weekly_report_required is distinct from (cardinality(weekly_report_profiles) > 0);

alter table organization_memberships
  drop constraint if exists organization_memberships_weekly_report_profiles_check;

alter table organization_memberships
  add constraint organization_memberships_weekly_report_profiles_check check (
    weekly_report_profiles <@ array['developer', 'tester']::text[]
    and cardinality(weekly_report_profiles) <= 2
    and weekly_report_required = (cardinality(weekly_report_profiles) > 0)
  );

commit;
