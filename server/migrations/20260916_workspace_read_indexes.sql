-- Apply only in an explicitly authorized database environment.
begin;

create index if not exists idx_journal_entries_project_time
  on journal_entries(project_id, created_at desc, id desc);
create index if not exists idx_todos_project_time
  on todos(project_id, created_at desc, id desc);
create index if not exists idx_todo_notes_todo_time
  on todo_notes(todo_id, created_at, id);
create index if not exists idx_draft_items_user_state_time
  on draft_items(user_id, processed, created_at desc, id desc);
create index if not exists idx_summaries_user_time
  on summaries(user_id, created_at desc, id desc);

commit;
