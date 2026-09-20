create table if not exists test_plan_executions (
  id bigserial primary key,
  test_plan_case_id bigint not null references test_plan_cases(id) on delete cascade,
  client_id uuid not null,
  result text not null check (result in ('untested', 'passed', 'failed', 'blocked', 'skipped')),
  actual_result text not null default '',
  note text not null default '',
  executed_by_user_id bigint references users(id) on delete set null,
  executed_at timestamptz not null default now(),
  unique (test_plan_case_id, client_id)
);

create table if not exists test_plan_execution_images (
  id bigserial primary key,
  execution_id bigint not null references test_plan_executions(id) on delete cascade,
  object_key text not null,
  file_name text not null default '',
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  unique (execution_id, object_key)
);

create index if not exists idx_test_plan_executions_case_id
  on test_plan_executions(test_plan_case_id, id);

create index if not exists idx_test_plan_execution_images_execution_id
  on test_plan_execution_images(execution_id, id);
