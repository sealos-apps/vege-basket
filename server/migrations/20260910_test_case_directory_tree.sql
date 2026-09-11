-- Preserve existing directory and case IDs; all legacy directories remain roots.
alter table test_case_folders add column if not exists parent_id bigint;
alter table test_case_folders drop constraint if exists test_case_folders_test_subject_id_name_key;
drop index if exists idx_test_case_folders_subject_name_lookup;

do $$ begin
  alter table test_case_folders add constraint test_case_folders_parent_scope_fk
    foreign key (parent_id, test_space_id, test_subject_id)
    references test_case_folders(id, test_space_id, test_subject_id);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table test_case_folders add constraint test_case_folders_not_self_parent
    check (parent_id is null or parent_id <> id);
exception when duplicate_object then null; end $$;

create unique index if not exists idx_test_case_folders_root_name_lookup
  on test_case_folders(test_subject_id, name_lookup)
  where parent_id is null and name_lookup is not null;
create unique index if not exists idx_test_case_folders_child_name_lookup
  on test_case_folders(test_subject_id, parent_id, name_lookup)
  where parent_id is not null and name_lookup is not null;
create unique index if not exists idx_test_case_folders_root_name
  on test_case_folders(test_subject_id, name) where parent_id is null;
create unique index if not exists idx_test_case_folders_child_name
  on test_case_folders(test_subject_id, parent_id, name) where parent_id is not null;
create index if not exists idx_test_case_folders_parent
  on test_case_folders(test_space_id, test_subject_id, parent_id);

create index if not exists idx_test_cases_subject_folder
  on test_cases(test_subject_id, folder_id, updated_at desc);
