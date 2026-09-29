-- Destructive legacy cleanup. Never execute this from application startup.
-- Apply only after verifying that platform_config_state points to a readable
-- encrypted configuration and after taking an approved database snapshot.
begin;

drop table if exists ai_settings;

commit;
