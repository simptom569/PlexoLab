-- Задачи, подзадачи, комментарии

create type priority as enum ('high', 'med', 'low');

create table tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  number int not null,
  title text not null,
  column_id uuid references board_columns on delete set null,   -- null = бэклог
  position double precision not null,                           -- порядок в колонке или в бэклоге
  assignee_id uuid references users on delete set null,
  priority priority not null default 'med',
  start_date date,
  due_date date,
  module_id uuid references modules on delete set null,
  milestone_id uuid references milestones on delete set null,
  pr text not null default '',
  description text not null default '',
  created_by uuid references users,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, number)
);
create index tasks_board_idx on tasks (project_id, column_id, position);
create index tasks_module_idx on tasks (module_id);
create index tasks_milestone_idx on tasks (milestone_id);

create table task_tags (
  task_id uuid not null references tasks on delete cascade,
  tag_id uuid not null references tags on delete cascade,
  primary key (task_id, tag_id)
);
create index task_tags_tag_idx on task_tags (tag_id);

create table subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks on delete cascade,
  title text not null,
  done boolean not null default false,
  position double precision not null
);
create index subtasks_task_idx on subtasks (task_id, position);

create table comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks on delete cascade,
  author_id uuid not null references users,
  body text not null,
  created_at timestamptz not null default now()
);
create index comments_task_idx on comments (task_id, created_at);
