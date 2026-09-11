create table if not exists project_subprojects (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  name text not null,
  name_lookup text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name_lookup)
);
alter table todos add column if not exists subproject_id bigint references project_subprojects(id) on delete restrict;
create index if not exists idx_project_subprojects_project on project_subprojects(project_id, created_at, id);
create index if not exists idx_todos_project_subproject on todos(project_id, subproject_id);
