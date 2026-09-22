create table if not exists project_delivery_members (
  project_id bigint not null references projects(id) on delete cascade,
  organization_id bigint not null references organizations(id) on delete cascade,
  user_id bigint not null references users(id) on delete cascade,
  can_plan boolean not null default false,
  can_execute boolean not null default false,
  configured_by_user_id bigint references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id),
  check (can_plan or can_execute),
  foreign key (organization_id, user_id) references organization_memberships(organization_id, user_id) on delete cascade
);
create index if not exists idx_project_delivery_member_user on project_delivery_members(user_id, organization_id);
alter table project_package_events add column if not exists completed_by_user_id bigint references users(id) on delete set null;
alter table project_package_events add column if not exists completed_at timestamptz;

create or replace function revoke_project_delivery_membership() returns trigger language plpgsql as $$
begin
  if TG_TABLE_NAME = 'project_memberships' then
    if TG_OP = 'DELETE' or NEW.status <> 'active' then
      delete from project_delivery_members d where d.project_id = OLD.project_id and d.user_id = OLD.invited_user_id
        and not exists(select 1 from projects p where p.id = OLD.project_id and p.user_id = OLD.invited_user_id);
    end if;
  elsif TG_TABLE_NAME = 'organization_memberships' then
    if TG_OP = 'DELETE' or NEW.status <> 'active' then
      delete from project_delivery_members where organization_id = OLD.organization_id and user_id = OLD.user_id;
    end if;
  elsif TG_TABLE_NAME = 'users' then
    if NEW.account_status <> 'active' then delete from project_delivery_members where user_id = OLD.id; end if;
  elsif TG_TABLE_NAME = 'projects' then
    if NEW.organization_id is distinct from OLD.organization_id then delete from project_delivery_members where project_id = OLD.id; end if;
  end if;
  return null;
end;
$$;
drop trigger if exists project_delivery_membership_revoked on project_memberships;
create trigger project_delivery_membership_revoked after delete or update of status on project_memberships for each row execute function revoke_project_delivery_membership();
drop trigger if exists organization_delivery_membership_revoked on organization_memberships;
create trigger organization_delivery_membership_revoked after delete or update of status on organization_memberships for each row execute function revoke_project_delivery_membership();
drop trigger if exists user_delivery_membership_revoked on users;
create trigger user_delivery_membership_revoked after update of account_status on users for each row execute function revoke_project_delivery_membership();
drop trigger if exists project_delivery_organization_changed on projects;
create trigger project_delivery_organization_changed after update of organization_id on projects for each row execute function revoke_project_delivery_membership();
