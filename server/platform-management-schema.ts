export const platformManagementSchemaSql = String.raw`
alter table users
  add column if not exists is_builtin_admin boolean not null default false,
  add column if not exists registration_source text not null default 'legacy_unknown',
  add column if not exists feishu_identity_verified_at timestamptz;

alter table users drop constraint if exists users_registration_source_check;
alter table users add constraint users_registration_source_check
  check (registration_source in ('builtin', 'feishu', 'legacy_unknown'));

alter table users drop constraint if exists users_builtin_admin_check;
alter table users add constraint users_builtin_admin_check check (
  not is_builtin_admin or (
    lower(btrim(email)) = 'admin'
    and account_status = 'active'
    and password_hash <> ''
    and registration_source = 'builtin'
  )
);

create unique index if not exists idx_users_single_builtin_admin
  on users (is_builtin_admin) where is_builtin_admin;

create table if not exists platform_config_versions (
  revision bigserial primary key,
  schema_version integer not null check (schema_version > 0),
  payload_encrypted text not null,
  created_by_user_id bigint references users(id) on delete set null,
  source text not null check (source in ('bootstrap', 'env_import', 'platform', 'restore', 'maintenance')),
  created_at timestamptz not null default now()
);

create table if not exists platform_config_state (
  singleton boolean primary key default true check (singleton),
  active_revision bigint references platform_config_versions(revision) on delete restrict,
  updated_at timestamptz not null default now()
);

insert into platform_config_state (singleton) values (true)
on conflict (singleton) do nothing;

create table if not exists platform_security_secrets (
  purpose text not null,
  key_id text not null,
  secret_encrypted text not null,
  legacy_verify_only boolean not null default false,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  primary key (purpose, key_id)
);

create table if not exists platform_admin_grants (
  user_id bigint primary key references users(id) on delete restrict,
  grant_kind text not null check (grant_kind in ('builtin', 'managed')),
  source text not null check (source in ('bootstrap', 'env_import', 'platform', 'maintenance')),
  granted_by_user_id bigint references users(id) on delete set null,
  granted_at timestamptz not null default now()
);

create unique index if not exists idx_platform_admin_grants_single_builtin
  on platform_admin_grants (grant_kind) where grant_kind = 'builtin';

create table if not exists platform_user_permission_versions (
  user_id bigint primary key references users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists platform_config_mutation_receipts (
  actor_user_id bigint not null references users(id) on delete restrict,
  request_id uuid not null,
  action text not null,
  request_digest text not null,
  result_revision bigint references platform_config_versions(revision) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (actor_user_id, request_id)
);

create table if not exists platform_user_mutation_receipts (
  actor_user_id bigint not null references users(id) on delete restrict,
  request_id uuid not null,
  action text not null,
  target_user_id bigint not null references users(id) on delete restrict,
  request_digest text not null,
  result_revision bigint not null check (result_revision >= 0),
  result_encrypted text,
  created_at timestamptz not null default now(),
  primary key (actor_user_id, request_id)
);

alter table platform_user_mutation_receipts
  add column if not exists result_encrypted text;

create table if not exists platform_organization_mutation_receipts (
  actor_user_id bigint not null references users(id) on delete restrict,
  request_id uuid not null,
  action text not null check (action in ('create', 'delete')),
  organization_id bigint not null,
  request_digest text not null,
  result_encrypted text not null,
  created_at timestamptz not null default now(),
  primary key (actor_user_id, request_id)
);

create table if not exists platform_audit_events (
  id bigserial primary key,
  actor_user_id bigint references users(id) on delete set null,
  action text not null,
  section text not null default '',
  target_type text not null default '',
  target_id text not null default '',
  before_revision bigint references platform_config_versions(revision) on delete restrict,
  after_revision bigint references platform_config_versions(revision) on delete restrict,
  changed_fields text[] not null default '{}',
  detail_encrypted text not null default '',
  request_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_platform_audit_events_created
  on platform_audit_events(created_at desc, id desc);

create table if not exists platform_config_runtime_status (
  instance_id uuid primary key,
  process_kind text not null check (process_kind = 'api'),
  applied_revision bigint references platform_config_versions(revision) on delete restrict,
  heartbeat_at timestamptz not null default now(),
  error_code text not null default '',
  started_at timestamptz not null default now()
);

create index if not exists idx_platform_config_runtime_status_heartbeat
  on platform_config_runtime_status(heartbeat_at desc);

create table if not exists platform_bootstrap_receipts (
  step text primary key,
  source text not null,
  completed_at timestamptz not null default now()
);

create table if not exists platform_security_inspections (
  id bigserial primary key,
  status text not null check (status in ('passed', 'failed')),
  result_encrypted text not null,
  recorded_by_user_id bigint references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists platform_storage_usage (
  singleton boolean primary key default true check (singleton),
  first_used_revision bigint references platform_config_versions(revision) on delete restrict,
  first_used_at timestamptz not null default now()
);

alter table image_sync_workflow_runs
  add column if not exists config_revision bigint references platform_config_versions(revision) on delete restrict,
  add column if not exists github_repository text,
  add column if not exists github_workflow_file text,
  add column if not exists github_ref text;

alter table project_package_items
  add column if not exists source_config_revision bigint references platform_config_versions(revision) on delete restrict;

alter table test_bug_verification_packages
  add column if not exists source_config_revision bigint references platform_config_versions(revision) on delete restrict;

create or replace function protect_builtin_platform_user()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and old.is_builtin_admin then
    raise exception 'builtin admin cannot be deleted' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.is_builtin_admin and (
    not new.is_builtin_admin
    or lower(btrim(new.email)) <> 'admin'
    or new.account_status <> 'active'
    or new.password_hash = ''
    or new.registration_source <> 'builtin'
  ) then
    raise exception 'builtin admin is protected' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists protect_builtin_platform_user_trigger on users;
create trigger protect_builtin_platform_user_trigger
before update or delete on users
for each row execute function protect_builtin_platform_user();

create or replace function protect_builtin_platform_admin_grant()
returns trigger language plpgsql as $$
begin
  if old.grant_kind = 'builtin' then
    raise exception 'builtin platform administrator grant is protected' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists protect_builtin_platform_admin_grant_trigger on platform_admin_grants;
create trigger protect_builtin_platform_admin_grant_trigger
before update or delete on platform_admin_grants
for each row execute function protect_builtin_platform_admin_grant();

create or replace function assert_builtin_admin_from_user()
returns trigger language plpgsql as $$
declare builtin_grant boolean;
begin
  select exists(
    select 1 from platform_admin_grants
    where user_id = new.id and grant_kind = 'builtin'
  ) into builtin_grant;
  if new.is_builtin_admin <> builtin_grant then
    raise exception 'builtin admin user and grant must be changed together' using errcode = '23514';
  end if;
  return null;
end
$$;

drop trigger if exists assert_builtin_admin_user_consistency on users;
create constraint trigger assert_builtin_admin_user_consistency
after insert or update of is_builtin_admin on users
deferrable initially deferred
for each row execute function assert_builtin_admin_from_user();

create or replace function assert_builtin_admin_from_grant()
returns trigger language plpgsql as $$
declare target_user_id bigint;
declare builtin_user boolean;
declare builtin_grant boolean;
begin
  target_user_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  select is_builtin_admin into builtin_user from users where id = target_user_id;
  select exists(
    select 1 from platform_admin_grants
    where user_id = target_user_id and grant_kind = 'builtin'
  ) into builtin_grant;
  if coalesce(builtin_user, false) <> builtin_grant then
    raise exception 'builtin admin user and grant must be changed together' using errcode = '23514';
  end if;
  return null;
end
$$;

drop trigger if exists assert_builtin_admin_grant_consistency on platform_admin_grants;
create constraint trigger assert_builtin_admin_grant_consistency
after insert or update or delete on platform_admin_grants
deferrable initially deferred
for each row execute function assert_builtin_admin_from_grant();

create or replace function reject_platform_config_version_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'platform configuration versions are immutable' using errcode = '23514';
end
$$;

drop trigger if exists reject_platform_config_version_mutation_trigger on platform_config_versions;
create trigger reject_platform_config_version_mutation_trigger
before update or delete on platform_config_versions
for each row execute function reject_platform_config_version_mutation();

alter table organization_audit_events
  add column if not exists original_organization_id bigint,
  add column if not exists organization_name_snapshot text;

update organization_audit_events audit
set original_organization_id = coalesce(audit.original_organization_id, audit.organization_id),
    organization_name_snapshot = coalesce(audit.organization_name_snapshot, organization.name)
from organizations organization
where audit.organization_id = organization.id
  and (audit.original_organization_id is null or audit.organization_name_snapshot is null);

create or replace function populate_organization_audit_identity()
returns trigger language plpgsql as $$
begin
  new.original_organization_id := coalesce(new.original_organization_id, new.organization_id);
  if new.organization_name_snapshot is null and new.organization_id is not null then
    select name into new.organization_name_snapshot
      from organizations where id = new.organization_id;
  end if;
  if new.original_organization_id is null or new.organization_name_snapshot is null then
    raise exception 'organization audit identity is required' using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists populate_organization_audit_identity_trigger on organization_audit_events;
create trigger populate_organization_audit_identity_trigger
before insert on organization_audit_events
for each row execute function populate_organization_audit_identity();

alter table organization_audit_events
  alter column original_organization_id set not null,
  alter column organization_name_snapshot set not null,
  alter column organization_id drop not null;

alter table organization_audit_events
  drop constraint if exists organization_audit_events_organization_id_fkey;
alter table organization_audit_events
  add constraint organization_audit_events_organization_id_fkey
  foreign key (organization_id) references organizations(id) on delete set null;

-- Every current organization foreign key except the retained audit uses RESTRICT.
-- This turns an unclassified future reference into a failed delete instead of data loss.
do $$
declare constraint_row record;
declare definition text;
begin
  for constraint_row in
    select constraint_value.conrelid::regclass as table_name,
           constraint_value.conname,
           pg_get_constraintdef(constraint_value.oid) as definition
      from pg_constraint constraint_value
     where constraint_value.contype = 'f'
       and constraint_value.confrelid = 'organizations'::regclass
       and constraint_value.conrelid <> 'organization_audit_events'::regclass
       and constraint_value.confdeltype <> 'r'
  loop
    definition := regexp_replace(
      constraint_row.definition,
      ' ON DELETE (CASCADE|SET NULL|SET DEFAULT|NO ACTION|RESTRICT)',
      '',
      'i'
    );
    execute format('alter table %s drop constraint %I', constraint_row.table_name, constraint_row.conname);
    if position(' DEFERRABLE' in definition) > 0 then
      definition := regexp_replace(definition, ' DEFERRABLE', ' ON DELETE RESTRICT DEFERRABLE', 'i');
    elsif position(' NOT VALID' in definition) > 0 then
      definition := regexp_replace(definition, ' NOT VALID', ' ON DELETE RESTRICT NOT VALID', 'i');
    else
      definition := definition || ' ON DELETE RESTRICT';
    end if;
    execute format('alter table %s add constraint %I %s',
      constraint_row.table_name, constraint_row.conname, definition);
  end loop;
end
$$;

create or replace function protect_organization_with_business_data()
returns trigger language plpgsql as $$
declare reference_row record;
declare reference_exists boolean;
begin
  for reference_row in
    select constraint_value.conrelid::regclass as table_name,
           attribute_value.attname as column_name
      from pg_constraint constraint_value
      join pg_attribute attribute_value
        on attribute_value.attrelid = constraint_value.conrelid
       and attribute_value.attnum = constraint_value.conkey[1]
     where constraint_value.contype = 'f'
       and constraint_value.confrelid = 'organizations'::regclass
       and array_length(constraint_value.conkey, 1) = 1
       and constraint_value.conrelid <> 'organization_audit_events'::regclass
  loop
    execute format(
      'select exists(select 1 from %s where %I = $1)',
      reference_row.table_name,
      reference_row.column_name
    ) into reference_exists using old.id;
    if reference_exists then
      raise exception 'organization still has business data' using errcode = '23503';
    end if;
  end loop;
  return old;
end
$$;

drop trigger if exists protect_organization_with_business_data_trigger on organizations;
create trigger protect_organization_with_business_data_trigger
before delete on organizations
for each row execute function protect_organization_with_business_data();
`
