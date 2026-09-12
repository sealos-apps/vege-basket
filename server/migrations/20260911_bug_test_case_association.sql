-- Apply only in an explicitly authorized database environment.
begin;

alter table test_bugs add column if not exists test_case_id bigint;
create unique index if not exists test_cases_bug_scope_unique
  on test_cases (id, test_space_id, test_subject_id);
do $$
begin
  alter table test_bugs add constraint test_bugs_case_scope_fkey
    foreign key (test_case_id, test_space_id, test_subject_id)
    references test_cases (id, test_space_id, test_subject_id);
exception when duplicate_object then null;
end $$;
create index if not exists test_bugs_case_idx on test_bugs(test_case_id);

update test_bugs b set test_case_id = c.id
from test_plan_cases pc join test_cases c on c.id = pc.test_case_id
where b.test_case_id is null and b.test_plan_case_id = pc.id
  and b.test_space_id = c.test_space_id and b.test_subject_id = c.test_subject_id;

create or replace function enforce_test_bug_case() returns trigger as $$
begin
  if new.test_case_id is null then
    if tg_op = 'INSERT' then
      raise exception 'Bug test case is required' using errcode = '23514';
    elsif old.test_case_id is not null or new.test_space_id <> old.test_space_id then
      raise exception 'Bug test case is required' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;
drop trigger if exists test_bugs_require_case on test_bugs;
create trigger test_bugs_require_case before insert or update on test_bugs
for each row execute function enforce_test_bug_case();

create or replace function protect_bug_subject_deletion() returns trigger as $$
begin
  if exists (select 1 from test_spaces where id = old.test_space_id)
     and exists (select 1 from test_bugs where test_subject_id = old.id) then
    raise exception 'Remove linked Bugs before deleting this test subject' using errcode = '23503';
  end if;
  return old;
end;
$$ language plpgsql;
drop trigger if exists test_subjects_protect_bugs on test_subjects;
create trigger test_subjects_protect_bugs before delete on test_subjects
for each row execute function protect_bug_subject_deletion();

do $$
begin
  if not exists (select 1 from test_bugs where test_case_id is null) then
    alter table test_bugs alter column test_case_id set not null;
  end if;
end $$;

commit;
