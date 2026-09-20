export const platformMaintenanceSchemaSql = String.raw`
create table if not exists application_migrations (
  migration_id text primary key,
  migration_name text not null,
  migration_kind text not null check (migration_kind in ('schema', 'data')),
  checksum text not null,
  applied_at timestamptz not null default now(),
  duration_ms integer not null check (duration_ms >= 0)
);

create table if not exists platform_operational_state (
  singleton boolean primary key default true check (singleton),
  maintenance_enabled boolean not null default true,
  maintenance_message text not null default '',
  revision bigint not null default 1 check (revision > 0),
  enabled_by_user_id bigint references users(id) on delete set null,
  enabled_at timestamptz,
  updated_by_user_id bigint references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into platform_operational_state
  (singleton, maintenance_enabled, maintenance_message, enabled_at)
select true,
       not exists(
         select 1 from platform_config_state
          where singleton = true and active_revision is not null
       ),
       case when exists(
         select 1 from platform_config_state
          where singleton = true and active_revision is not null
       ) then '' else '平台尚未完成初始配置。' end,
       case when exists(
         select 1 from platform_config_state
          where singleton = true and active_revision is not null
       ) then null else now() end
on conflict (singleton) do nothing;

alter table platform_config_runtime_status
  add column if not exists operational_revision bigint not null default 0;

create table if not exists platform_operational_mutation_receipts (
  actor_user_id bigint not null references users(id) on delete restrict,
  request_id uuid not null,
  request_digest text not null,
  result_revision bigint not null check (result_revision > 0),
  result_enabled boolean not null,
  result_changed boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (actor_user_id, request_id)
);

alter table platform_operational_mutation_receipts
  add column if not exists result_changed boolean not null default true;
`
