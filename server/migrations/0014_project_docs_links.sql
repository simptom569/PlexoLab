-- Документы и ссылки принадлежат проекту (docs/PROJECTS.md, раздел 2), этап П5
--
-- Существующие документы, группы ссылок и события о документах уходят в первый проект (по порядку создания).
-- Вики и файлы библиотеки остаются общими: их события пишутся без проекта и видны в ленте любого проекта.
-- Если документы или ссылки есть, а проектов нет, миграция упадёт на `set not null`: терять данные она не должна.
-- Обратная миграция: server/migrations_down/0014_project_docs_links.down.sql

alter table docs add column project_id uuid references projects on delete cascade;
alter table link_groups add column project_id uuid references projects on delete cascade;

update docs set project_id = (select id from projects order by seq limit 1);
update link_groups set project_id = (select id from projects order by seq limit 1);

alter table docs alter column project_id set not null;
alter table link_groups alter column project_id set not null;

create index docs_project_idx on docs (project_id, position);
create index link_groups_project_idx on link_groups (project_id, position);

-- События документов до этого шли без проекта, как события вики; их отличает подпись цели
update activity
set project_id = (select id from projects order by seq limit 1)
where project_id is null and kind = 'doc' and (target like 'Документ «%' or target = 'Новый документ');
