-- Уведомления: человека назначили исполнителем или упомянули в комментарии (docs/OFFLINE-NOTIFY-SEARCH.md, раздел 2)
-- Обратная миграция: server/migrations_down/0017_notifications.down.sql

create type notification_kind as enum ('assigned', 'mentioned');

-- Кого упомянули в комментарии: список id участников проекта, проверенный при создании комментария. В тексте метка `@[id]`.
alter table comments add column mentions uuid[] not null default '{}';

create table notifications (
  id uuid primary key default gen_random_uuid(),
  -- кому адресовано
  user_id uuid not null references users on delete cascade,
  kind notification_kind not null,
  -- кто назначил или упомянул (учётную запись могли удалить)
  actor_id uuid references users on delete set null,
  project_id uuid not null references projects on delete cascade,
  task_id uuid not null references tasks on delete cascade,
  -- комментарий с упоминанием; у «назначили» его нет
  comment_id uuid references comments on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check ((kind = 'mentioned') = (comment_id is not null))
);
-- список человека: новые первыми
create index notifications_user_idx on notifications (user_id, created_at desc, id desc);
-- счётчик непрочитанных
create index notifications_unread_idx on notifications (user_id) where read_at is null;
