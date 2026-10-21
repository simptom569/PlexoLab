-- Обратная миграция к 0012_task_series.sql. Запускается вручную (psql -f), sqlx её не применяет.
-- После неё удалить строку version = 12 из таблицы _sqlx_migrations.
--
-- Задачи из рядов модулей возвращаются в ряд проекта с новыми номерами (по порядку старых), иначе номера
-- разных рядов столкнулись бы в уникальности (project_id, number). Если у двух проектов был одинаковый ключ,
-- вернуть уникальность ключа нельзя: скрипт остановится с ошибкой, ключи нужно развести вручную.

begin;

-- 1. Задачи из рядов модулей переходят в ряд проекта: ряд и номер меняются одним запросом, чтобы номер не
--    столкнулся с номерами внутри ряда модуля
create temp table moved_tasks on commit drop as
  select id, project_id, row_number() over (partition by project_id order by number, id) as rn
  from tasks
  where series_module_id is not null;

update tasks t
set number = p.last_number + m.rn,
    series_module_id = null
from moved_tasks m
join projects p on p.id = m.project_id
where t.id = m.id;

update projects p
set last_number = p.last_number + c.n
from (select project_id, count(*) as n from moved_tasks group by project_id) c
where p.id = c.project_id;

-- 2. Ряды задач
drop index tasks_series_module_idx;
drop index tasks_series_number_idx;
alter table tasks drop constraint tasks_series_is_assigned_module;
alter table tasks drop column series_module_id;
alter table tasks add constraint tasks_project_id_number_key unique (project_id, number);

-- 3. История прежних id
drop table task_old_ids;

-- 4. Ключи модулей и счётчик
drop index modules_project_key_idx;
alter table modules drop constraint modules_key_format;
alter table modules drop column last_number;
alter table modules drop column key;

-- 5. Ключ проекта: снова обязателен и уникален (проекту без ключа временный берётся из его id)
alter table projects drop constraint projects_key_format;
update projects set key = upper(substr(replace(id::text, '-', ''), 1, 4)) where key is null;
alter table projects alter column key set not null;
alter table projects add constraint projects_key_key unique (key);

commit;
