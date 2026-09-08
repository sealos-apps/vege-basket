begin;

create table if not exists test_bug_verification_submissions (
  id bigserial primary key,
  test_bug_id bigint not null references test_bugs(id) on delete cascade,
  submitted_by_user_id bigint references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists test_bug_verification_packages (
  id bigserial primary key,
  test_bug_verification_submission_id bigint not null
    references test_bug_verification_submissions(id) on delete cascade,
  position integer not null check (position >= 0),
  source_package_id text not null,
  source_package_name text not null,
  package_name text not null,
  channel text not null check (channel in ('release', 'ci')),
  channel_label text not null,
  arch text not null,
  version text not null,
  object_key text not null,
  object_last_modified timestamptz,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  unique (test_bug_verification_submission_id, position),
  unique (test_bug_verification_submission_id, object_key)
);

create index if not exists idx_test_bug_verification_submissions_bug
  on test_bug_verification_submissions(test_bug_id, created_at desc, id desc);

commit;
