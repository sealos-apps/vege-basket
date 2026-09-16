-- Apply only in an explicitly authorized database environment.
begin;

alter table test_subjects
  add column if not exists is_directory_root boolean not null default false;

create unique index if not exists idx_test_subjects_one_directory_root
  on test_subjects(test_space_id) where is_directory_root;

do $$
begin
  if exists (
    select 1
    from test_cases
    group by test_space_id, csv_case_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate CSV case IDs exist within a test space; resolve them before migration';
  end if;
end $$;

drop index if exists idx_test_cases_subject_csv_case_id;
create unique index if not exists idx_test_cases_space_csv_case_id
  on test_cases(test_space_id, csv_case_id);

create or replace function assign_test_case_csv_id() returns trigger as $$
declare
  candidate text;
begin
  if new.csv_case_id is null or btrim(new.csv_case_id) = '' then
    candidate := 'CASE-' || new.id::text;
    while exists (
      select 1 from test_cases existing
      where existing.test_space_id = new.test_space_id
        and existing.csv_case_id = candidate
    ) loop
      candidate := 'CASE-9' || substring(candidate from 6);
    end loop;
    new.csv_case_id := candidate;
  end if;
  return new;
end;
$$ language plpgsql;

alter table test_bugs drop constraint if exists test_bugs_case_scope_fkey;
alter table test_bugs add constraint test_bugs_case_scope_fkey
  foreign key (test_case_id, test_space_id, test_subject_id)
  references test_cases (id, test_space_id, test_subject_id)
  deferrable initially immediate;

commit;
