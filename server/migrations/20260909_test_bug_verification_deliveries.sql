begin;

create table if not exists test_bug_verification_container_images (
  id bigserial primary key,
  test_bug_verification_submission_id bigint not null
    references test_bug_verification_submissions(id) on delete cascade,
  position integer not null check (position >= 0),
  image_ref text not null,
  unique (test_bug_verification_submission_id, position)
);

alter table test_bug_comments
  add column if not exists verification_submission_id bigint
    references test_bug_verification_submissions(id) on delete cascade;

alter table test_bug_comments
  drop constraint if exists test_bug_comments_kind_check;

alter table test_bug_comments
  add constraint test_bug_comments_kind_check
  check (kind in ('acceptance', 'comment', 'transfer', 'reject'));

alter table test_bug_comments
  drop constraint if exists test_bug_comments_acceptance_submission_check;

alter table test_bug_comments
  add constraint test_bug_comments_acceptance_submission_check
  check (
    (kind = 'acceptance' and verification_submission_id is not null)
    or (kind <> 'acceptance' and verification_submission_id is null)
  );

create index if not exists idx_test_bug_verification_container_images_submission
  on test_bug_verification_container_images(test_bug_verification_submission_id, position);

create unique index if not exists idx_test_bug_comments_verification_submission
  on test_bug_comments(verification_submission_id)
  where verification_submission_id is not null;

commit;
