begin;
create table if not exists test_space_transfer_requests (
  id bigserial primary key,
  test_space_id bigint not null references test_spaces(id) on delete cascade,
  organization_id bigint references organizations(id) on delete cascade,
  requested_by_user_id bigint not null references users(id) on delete cascade,
  previous_owner_user_id bigint not null references users(id) on delete cascade,
  target_user_id bigint not null references users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '72 hours'),
  responded_at timestamptz,
  check (previous_owner_user_id <> target_user_id)
);
create unique index if not exists idx_test_space_transfer_pending on test_space_transfer_requests(test_space_id) where status='pending';
create index if not exists idx_test_space_transfer_target on test_space_transfer_requests(target_user_id,expires_at) where status='pending';

-- Assignments are derived from organization membership, never chosen per space.
select id from organizations order by id for update;
delete from test_environment_spaces assignment
using test_environments environment, test_spaces space
where assignment.test_environment_id=environment.id and assignment.test_space_id=space.id
  and space.organization_id is distinct from environment.organization_id;
insert into test_environment_spaces (test_environment_id,test_space_id)
select environment.id,space.id from test_environments environment
join test_spaces space on space.organization_id=environment.organization_id
on conflict (test_environment_id,test_space_id) do nothing;
commit;
