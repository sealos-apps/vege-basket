begin;

-- Historical Bugs start at medium; new HTTP requests must select a level explicitly.
alter table test_bugs
  add column if not exists discovery_difficulty text not null default 'medium'
    constraint test_bugs_discovery_difficulty_check check (discovery_difficulty in ('high', 'medium', 'low')),
  add column if not exists discovery_difficulty_reason text not null default '';

commit;
