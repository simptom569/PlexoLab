-- Файлы, ссылки команды, лента активности

create table folders (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table files (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  size_bytes bigint not null,
  kind text not null check (kind in ('img', 'pdf', 'doc', 'sheet', 'zip', 'other')),   -- по расширению
  storage_key text not null,                                    -- имя файла на диске
  uploader_id uuid references users,
  folder_id uuid references folders on delete set null,
  wiki_page_id uuid references wiki_pages on delete set null,   -- вложение страницы вики
  task_id uuid references tasks on delete cascade,              -- вложение задачи
  created_at timestamptz not null default now()
);
create index files_folder_idx on files (folder_id);
create index files_wiki_page_idx on files (wiki_page_id);
create index files_task_idx on files (task_id);

create table link_groups (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  position double precision not null
);

create table links (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references link_groups on delete cascade,
  title text not null,
  url text not null,
  description text not null default '',
  position double precision not null
);
create index links_group_idx on links (group_id, position);

create type act_kind as enum ('move', 'create', 'delete', 'comment', 'code', 'doc', 'release', 'file');

create table activity (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references users,
  project_id uuid references projects on delete set null,
  kind act_kind not null,
  target text not null,                -- «WEB-141 Тёмная тема для страницы настроек»
  text text not null,                  -- «перемещена в «На ревью»»
  created_at timestamptz not null default now()
);
create index activity_created_idx on activity (created_at desc);
