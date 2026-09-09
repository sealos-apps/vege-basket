alter table test_bug_comments
  drop constraint if exists test_bug_comments_kind_check;

alter table test_bug_comments
  add constraint test_bug_comments_kind_check
  check (kind in ('comment', 'transfer', 'reject', 'acceptance'));
