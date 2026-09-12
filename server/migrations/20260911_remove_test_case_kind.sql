-- 用例不再区分功能/基线分类，归档入口已移除。
alter table test_cases drop constraint if exists test_cases_case_kind_check;
alter table test_cases drop column if exists case_kind;
