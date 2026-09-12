-- Apply structure first. Application startup / db:encrypt-existing completes the
-- encrypted name backfill and one-time organization catalog import in one transaction.
-- Keep the application stopped during the first upgrade; retain the complete key ring.
create table if not exists project_module_settings (
  id smallint primary key check (id = 1),
  lookup_key_id text not null,
  initialized_at timestamptz
);

create table if not exists organization_project_modules (
  id bigserial primary key,
  organization_id bigint not null references organizations(id) on delete cascade,
  name text not null,
  name_lookup text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name_lookup)
);

alter table project_modules
  add column if not exists organization_module_id bigint references organization_project_modules(id) on delete set null,
  add column if not exists name_lookup text;

create unique index if not exists idx_project_modules_name_lookup
  on project_modules(project_id, name_lookup);
create unique index if not exists idx_project_modules_organization_module
  on project_modules(project_id, organization_module_id);
create index if not exists idx_project_modules_catalog_id
  on project_modules(organization_module_id) where organization_module_id is not null;

-- After a successful encrypted backfill, projectModulesFinalizeSql makes
-- project_modules.name_lookup NOT NULL and removes the legacy plaintext-name key.
