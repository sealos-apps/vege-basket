begin;

alter table project_package_events
  add column if not exists delivery_steps text,
  add column if not exists delivery_scripts text,
  add column if not exists delivery_step_results text,
  add column if not exists completed_by_user_id bigint references users(id) on delete set null,
  add column if not exists completed_at timestamptz,
  add column if not exists delivery_result text,
  add column if not exists delivery_failure_reason text;

alter table project_package_events drop constraint if exists project_package_events_lifecycle_check;

update project_package_events
set status = case
  when published_at is null then 'draft'
  when delivery_result = 'failed' or status = 'failed' then 'failed'
  when delivery_result = 'partial' or status = 'partially_delivered' then 'partially_delivered'
  when delivery_result = 'rejected' or status = 'rejected' then 'rejected'
  when status in ('delivered', 'success') then 'delivered'
  else 'delivering'
end
where status not in ('draft', 'delivering', 'delivered')
   or delivery_result in ('failed', 'partial', 'rejected')
   or (published_at is null and status <> 'draft')
   or (published_at is not null and status = 'draft');

alter table project_package_events
  add constraint project_package_events_lifecycle_check
  check (
    (published_at is null and status = 'draft')
    or (published_at is not null and status in ('delivering', 'rejected', 'partially_delivered', 'delivered', 'failed'))
  );

alter table project_package_events drop constraint if exists project_package_events_delivery_result_check;
alter table project_package_events
  add constraint project_package_events_delivery_result_check
  check (
    delivery_result is null
    or delivery_result in ('success', 'partial', 'rejected')
    or (delivery_result = 'failed' and length(btrim(coalesce(delivery_failure_reason, ''))) > 0)
  );

create table if not exists project_package_event_rejections (
  id bigserial primary key,
  project_package_event_id bigint not null references project_package_events(id) on delete cascade,
  rejected_by_user_id bigint references users(id) on delete set null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_package_event_rejections_event
  on project_package_event_rejections(project_package_event_id, created_at desc, id desc);

update project_package_events
set delivery_result = 'success'
where status = 'delivered' and delivery_result is null;
update project_package_events
set completed_at = coalesce(completed_at, updated_at, published_at, created_at)
where status in ('partially_delivered', 'delivered', 'failed') and completed_at is null;

alter table project_package_events drop constraint if exists project_package_events_terminal_result_check;
alter table project_package_events
  add constraint project_package_events_terminal_result_check
  check (
    (status in ('draft', 'delivering') and delivery_result is null and completed_at is null)
    or (status = 'rejected' and delivery_result = 'rejected' and completed_at is null)
    or (status = 'partially_delivered' and delivery_result = 'partial' and completed_at is not null)
    or (status = 'delivered' and delivery_result = 'success' and completed_at is not null)
    or (status = 'failed' and delivery_result = 'failed' and completed_at is not null)
  );

commit;
