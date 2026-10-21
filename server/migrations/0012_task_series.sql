-- Ряды нумерации задач и необязательные ключи (docs/PROJECTS.md, раздел 4)
--
-- Ряд задачи: проект (по умолчанию) или модуль с ключом (`series_module_id`). Номер уникален внутри ряда.
-- Подпись id (WEB-141) не хранится: она собирается при показе из ключа ряда (ключ модуля, иначе ключ проекта, иначе TASK).
-- Обратная миграция: server/migrations_down/0012_task_series.down.sql

-- Ключ проекта необязателен и может совпадать у разных проектов
alter table projects drop constraint projects_key_key;
alter table projects alter column key drop not null;
alter table projects add constraint projects_key_format check (key is null or key ~ '^[A-Z][A-Z0-9]{1,5}$');

-- Ключ модуля необязателен и не повторяется внутри проекта; у модуля свой счётчик номеров (только растёт)
alter table modules add column key text;
alter table modules add column last_number int not null default 0;
alter table modules add constraint modules_key_format check (key is null or key ~ '^[A-Z][A-Z0-9]{1,5}$');
create unique index modules_project_key_idx on modules (project_id, key) where key is not null;

-- Ряд задачи: пусто = ряд проекта. Модуль нельзя удалить, пока в его ряду есть задачи (сначала задачи переносятся в ряд проекта).
alter table tasks add column series_module_id uuid references modules on delete restrict;
alter table tasks add constraint tasks_series_is_assigned_module check (series_module_id is null or series_module_id = module_id);
alter table tasks drop constraint tasks_project_id_number_key;
create unique index tasks_series_number_idx on tasks ((coalesce(series_module_id, project_id)), number);
create index tasks_series_module_idx on tasks (series_module_id) where series_module_id is not null;

-- История прежних id: при смене ряда прежний id записывается. Ряд хранится без ссылки: модуль могли удалить.
create table task_old_ids (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks on delete cascade,
  project_id uuid not null references projects on delete cascade,
  series_module_id uuid,
  key text not null,
  number int not null,
  created_at timestamptz not null default now()
);
create index task_old_ids_task_idx on task_old_ids (task_id);
create index task_old_ids_label_idx on task_old_ids (project_id, key, number);
