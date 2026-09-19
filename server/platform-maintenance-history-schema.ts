export const platformMaintenanceHistorySchemaSql = String.raw`
create table if not exists platform_maintenance_periods (
  id bigserial primary key,
  message text not null default '',
  started_by_user_id bigint references users(id) on delete set null,
  started_at timestamptz not null,
  ended_by_user_id bigint references users(id) on delete set null,
  ended_at timestamptz,
  duration_seconds bigint,
  start_revision bigint not null check (start_revision > 0),
  end_revision bigint,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at),
  check (duration_seconds is null or duration_seconds >= 0),
  check (
    (ended_at is null and duration_seconds is null and end_revision is null)
    or
    (ended_at is not null and duration_seconds is not null and end_revision is not null)
  )
);

create unique index if not exists idx_platform_maintenance_periods_active
  on platform_maintenance_periods ((true)) where ended_at is null;

create index if not exists idx_platform_maintenance_periods_started
  on platform_maintenance_periods (started_at desc, id desc);

insert into platform_maintenance_periods
  (message, started_by_user_id, started_at, start_revision)
select state.maintenance_message, state.enabled_by_user_id, state.enabled_at, state.revision
  from platform_operational_state state
 where state.singleton = true
   and state.maintenance_enabled
   and state.enabled_at is not null
   and state.enabled_by_user_id is not null
   and not exists (
     select 1 from platform_maintenance_periods period where period.ended_at is null
   );
`
