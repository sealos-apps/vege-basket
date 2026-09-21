begin;

alter table test_plan_execution_images
  drop constraint if exists test_plan_execution_images_file_size_check;

alter table test_plan_execution_images
  add constraint test_plan_execution_images_file_size_check
  check (file_size > 0 and file_size <= 31457280);

commit;
