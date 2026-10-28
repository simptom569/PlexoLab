-- Обратная миграция к 0018_teams.sql. Запускается вручную (psql -f), sqlx её не применяет.
-- После неё удалить строку version = 18 из таблицы _sqlx_migrations.
--
-- Команды, участники команд и приглашения в команды пропадают, вики, папки и файлы снова общие. Если в разных командах
-- есть папки с одним названием, откат останавливается на возврате уникальности и ничего не меняет: данные не теряются.

begin;

drop function can_read_team(uuid, uuid);
drop function is_project_person(uuid, uuid);
drop function can_access_project(uuid, uuid);

drop index folders_team_name_idx;
alter table folders add constraint folders_name_key unique (name);

drop index activity_team_idx;
drop index files_team_idx;
drop index wiki_pages_team_idx;
drop index projects_team_idx;

alter table activity drop column team_id;
alter table files drop column team_id;
alter table folders drop column team_id;
alter table wiki_pages drop column team_id;
alter table projects drop column visibility;
alter table projects drop column team_id;

drop trigger users_personal_team on users;
drop function create_personal_team();

drop table team_invites;
drop table team_members;
drop table teams;
drop type project_visibility;
drop type team_role;

commit;
