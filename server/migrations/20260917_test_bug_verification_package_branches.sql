begin;

alter table test_bug_verification_packages
  add column if not exists ci_branch text;

update test_bug_verification_packages
set ci_branch = split_part(split_part(object_key, '/ci/', 2), '/', 1)
where channel = 'ci'
  and ci_branch is null
  and object_key ~ '/ci/[a-zA-Z0-9][a-zA-Z0-9._-]*/[^/]+/[^/]+$';

do $$ begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'test_bug_verification_packages_ci_branch_check'
      and conrelid = 'test_bug_verification_packages'::regclass
  ) then
    alter table test_bug_verification_packages
      add constraint test_bug_verification_packages_ci_branch_check
      check (
        (channel = 'release' and ci_branch is null)
        or (
          channel = 'ci'
          and (
            ci_branch is null
            or (
              ci_branch ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]*$'
              and ci_branch not in ('.', '..')
            )
          )
        )
      );
  end if;
end $$;

commit;
