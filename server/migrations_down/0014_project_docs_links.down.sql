-- Обратная миграция к 0014_project_docs_links.sql. Запускается вручную (psql -f), sqlx её не применяет.
-- После неё удалить строку version = 14 из таблицы _sqlx_migrations.
--
-- Документы и группы ссылок снова общие для всех проектов: списки сливаются, у каждого сохраняется своё место
-- (порядок между проектами при этом может перемешаться). События документов снова без проекта.

begin;

drop index docs_project_idx;
drop index link_groups_project_idx;
alter table docs drop column project_id;
alter table link_groups drop column project_id;

update activity set project_id = null
where kind = 'doc' and (target like 'Документ «%' or target = 'Новый документ');

commit;
