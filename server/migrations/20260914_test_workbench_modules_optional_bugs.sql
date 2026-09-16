begin;

-- Test workbench modules and optional Bug case associations.
alter table test_cases
  add column if not exists organization_module_id bigint
    references organization_project_modules(id) on delete set null;

alter table test_bugs
  add column if not exists organization_module_id bigint
    references organization_project_modules(id) on delete set null;

alter table test_bugs
  alter column test_case_id drop not null,
  alter column test_subject_id drop not null;

drop trigger if exists test_bugs_require_case on test_bugs;

create index if not exists idx_test_cases_organization_module
  on test_cases(organization_module_id);
create index if not exists idx_test_bugs_organization_module
  on test_bugs(organization_module_id);

commit;
