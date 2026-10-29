-- Обратная миграция к 0019_invites_by_email.sql. Запускается вручную (psql -f), sqlx её не применяет.
-- После неё удалить строку version = 19 из таблицы _sqlx_migrations.
--
-- Приглашения, которые ждали регистрации (без аккаунта), пропадают: хранить их без адреса негде.

begin;

drop trigger users_claim_invites on users;
drop function claim_invites_for_new_user();

delete from team_invites where user_id is null;
drop index team_invites_email_idx;
drop index team_invites_pending_email_idx;
alter table team_invites drop constraint team_invites_invitee;
alter table team_invites drop column email;
alter table team_invites alter column user_id set not null;

delete from project_invites where user_id is null;
drop index project_invites_email_idx;
drop index project_invites_pending_email_idx;
alter table project_invites drop constraint project_invites_invitee;
alter table project_invites drop column email;
alter table project_invites alter column user_id set not null;

commit;
