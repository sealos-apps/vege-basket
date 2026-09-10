alter table project_transfer_requests
  add column if not exists previous_owner_user_id bigint references users(id) on delete cascade;

update project_transfer_requests
set previous_owner_user_id = requested_by_user_id
where previous_owner_user_id is null;
