-- Проекты, колонки доски, метки, модули, вехи

create type work_status as enum ('plan', 'progress', 'done');       -- модули и релизы

create table projects (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,           -- WEB, API, INF
  name text not null,
  color text not null,                -- токен цвета: accent | warn | ok
  last_number int not null default 0  -- для номеров WEB-151
);

create table board_columns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  title text not null,
  color text not null,                -- muted | accent | warn | ok | b-fg | e-fg
  is_done boolean not null default false,
  position double precision not null
);
create index board_columns_project_idx on board_columns (project_id, position);

create table tags (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  tone smallint not null check (tone between 0 and 7)   -- индекс в TONES
);
-- метки не различаются по регистру: «Баг» и «баг» одна и та же метка
create unique index tags_label_lower_idx on tags (lower(label));

create table modules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  title text not null,
  lead_id uuid references users on delete set null,
  status work_status not null default 'plan',
  date_from date,
  date_to date,
  note text not null default ''
);
create index modules_project_idx on modules (project_id);

create table milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  title text not null,
  due_date date not null
);
create index milestones_project_idx on milestones (project_id);
