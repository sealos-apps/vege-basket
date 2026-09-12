create table if not exists project_subprojects (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  name text not null,
  name_lookup text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name_lookup)
);
alter table todos add column if not exists subproject_id bigint;
create unique index if not exists idx_subproject_project_identity on project_subprojects(project_id, id);
alter table todos drop constraint if exists todos_subproject_id_fkey;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'todos_project_subproject_fkey' and conrelid = 'todos'::regclass) then
    alter table todos add constraint todos_project_subproject_fkey
      foreign key (project_id, subproject_id) references project_subprojects(project_id, id)
      on delete no action deferrable initially immediate;
  end if;
end $$;
create index if not exists idx_project_subprojects_project on project_subprojects(project_id, created_at, id);
create index if not exists idx_todos_project_subproject on todos(project_id, subproject_id);
