-- Участники и приглашения, архив проектов, метки по проектам (docs/PROJECTS.md, разделы 1 и 2)
-- Обратная миграция: server/migrations_down/0013_project_members.down.sql

create type project_role as enum ('admin', 'member');
create type invite_status as enum ('pending', 'accepted', 'declined', 'revoked');

-- Архив: проект скрыт из списков, данные целы
alter table projects add column archived_at timestamptz;
alter table projects add column created_by uuid references users on delete set null;

create table project_members (
  project_id uuid not null references projects on delete cascade,
  user_id uuid not null references users on delete cascade,
  role project_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on project_members (user_id);

-- Приглашение существующему аккаунту; решает приглашённый. Закрытое (принято, отклонено, отозвано) остаётся как история.
create table project_invites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  user_id uuid not null references users on delete cascade,
  invited_by uuid references users on delete set null,
  role project_role not null default 'member',
  status invite_status not null default 'pending',
  created_at timestamptz not null default now(),
  answered_at timestamptz
);
create unique index project_invites_pending_idx on project_invites (project_id, user_id) where status = 'pending';
create index project_invites_user_idx on project_invites (user_id) where status = 'pending';

-- Нынешние пользователи становятся участниками всех существующих проектов, глобальные админы администраторами
insert into project_members (project_id, user_id, role)
select p.id, u.id, case when u.is_admin then 'admin'::project_role else 'member'::project_role end
from projects p cross join users u;

-- Метки были общими, теперь у каждого проекта свои. Первый проект оставляет исходные метки (порядок сохраняется): те,
-- которыми пользуются его задачи, и те, которыми не пользуется никто. В остальных проектах появляются копии тех
-- меток, что стоят на их задачах (в порядке создания меток). Метка, нужная только другим проектам, из первого уходит.
alter table tags add column project_id uuid references projects on delete cascade;
drop index tags_label_lower_idx;

create temp table tag_usage on commit drop as
  select distinct g.id as old_id, t.project_id, g.seq
  from tags g
  join task_tags tt on tt.tag_id = g.id
  join tasks t on t.id = tt.task_id;

create temp table first_project on commit drop as
  select id from projects order by seq limit 1;

update tags
set project_id = (select id from first_project)
where project_id is null
  and (id not in (select old_id from tag_usage)
       or id in (select old_id from tag_usage where project_id = (select id from first_project)));

insert into tags (label, tone, project_id)
  select g.label, g.tone, u.project_id
  from tag_usage u
  join tags g on g.id = u.old_id
  where u.project_id is distinct from (select id from first_project)
  order by u.project_id, g.seq;

-- задачи других проектов переходят с исходной метки на копию своего проекта
update task_tags tt
set tag_id = c.id
from tasks t, tags old, tags c
where tt.task_id = t.id
  and old.id = tt.tag_id
  and old.project_id is distinct from t.project_id
  and c.project_id = t.project_id
  and lower(c.label) = lower(old.label);

delete from tags where project_id is null;

alter table tags alter column project_id set not null;
create unique index tags_project_label_idx on tags (project_id, lower(label));
create index tags_project_idx on tags (project_id, seq);
