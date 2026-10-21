-- Обратная миграция к 0013_project_members.sql. Запускается вручную (psql -f), sqlx её не применяет.
-- После неё удалить строку version = 13 из таблицы _sqlx_migrations.
--
-- Метки снова общие: из копий с одним названием (без учёта регистра) остаётся самая старая, задачи переходят на неё.
-- Участники, приглашения и архив проектов пропадают без возможности восстановить.

begin;

-- 1. Метки: одна на название
create temp table tag_keep on commit drop as
  select distinct on (lower(label)) id, lower(label) as lowered
  from tags
  order by lower(label), seq;

update task_tags tt
set tag_id = k.id
from tags g, tag_keep k
where g.id = tt.tag_id
  and lower(g.label) = k.lowered
  and g.id <> k.id;

delete from tags where id not in (select id from tag_keep);

drop index tags_project_idx;
drop index tags_project_label_idx;
alter table tags drop column project_id;
create unique index tags_label_lower_idx on tags (lower(label));

-- 2. Участники, приглашения, архив
drop table project_invites;
drop table project_members;
alter table projects drop column created_by;
alter table projects drop column archived_at;
drop type invite_status;
drop type project_role;

commit;
