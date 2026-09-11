-- Keep historical environment text when its configuration is deleted.
alter table test_plans
  add column if not exists test_environment_id bigint references test_environments(id) on delete set null,
  add column if not exists environment_access_url text not null default '';
