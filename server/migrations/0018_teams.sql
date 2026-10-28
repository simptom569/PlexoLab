-- Команды над проектами (docs/TEAMS.md), этап К1
--
-- Команда: вики, библиотека файлов, люди, место для проектов. У каждого аккаунта есть личная команда «Личное»
-- (создаётся триггером вместе с аккаунтом, так что забыть её создать нельзя). Нынешние данные уходят в общую
-- команду «Dream Team»: в неё входят все нынешние аккаунты, `is_admin` администраторами; если администраторов нет,
-- первый по порядку. Членство в проектах не меняется, видимость проектов «Только участники».
-- Если данные есть, а аккаунтов нет, команда создаётся без участников: терять данные миграция не должна.
-- Обратная миграция: server/migrations_down/0018_teams.down.sql

create type team_role as enum ('admin', 'member');
-- members: проект видят явные участники и администраторы команды; team: ещё и все члены команды
create type project_visibility as enum ('members', 'team');

create table teams (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  name text not null,
  created_by uuid references users on delete set null,
  -- личная команда «Личное»: чья она; у обычной пусто
  personal_for uuid unique references users on delete cascade,
  -- гости проектов команды (не члены) могут читать её вики и библиотеку
  guests_read_wiki boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table team_members (
  team_id uuid not null references teams on delete cascade,
  user_id uuid not null references users on delete cascade,
  role team_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index team_members_user_idx on team_members (user_id);

-- Приглашение в команду существующему аккаунту; решает приглашённый. Закрытое остаётся как история.
create table team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams on delete cascade,
  user_id uuid not null references users on delete cascade,
  invited_by uuid references users on delete set null,
  role team_role not null default 'member',
  status invite_status not null default 'pending',
  created_at timestamptz not null default now(),
  answered_at timestamptz
);
create unique index team_invites_pending_idx on team_invites (team_id, user_id) where status = 'pending';
create index team_invites_user_idx on team_invites (user_id) where status = 'pending';

-- Новый аккаунт получает личную команду в той же операции, в которой создан
create function create_personal_team() returns trigger language plpgsql as $$
declare
  team uuid;
begin
  insert into teams (name, created_by, personal_for) values ('Личное', new.id, new.id) returning id into team;
  insert into team_members (team_id, user_id, role) values (team, new.id, 'admin');
  return new;
end
$$;
create trigger users_personal_team after insert on users for each row execute function create_personal_team();

-- Колонки команды: пока пустые, ниже заполняются
alter table projects add column team_id uuid references teams on delete restrict;
alter table projects add column visibility project_visibility not null default 'members';
alter table wiki_pages add column team_id uuid references teams on delete restrict;
alter table folders add column team_id uuid references teams on delete restrict;
alter table files add column team_id uuid references teams on delete restrict;
alter table activity add column team_id uuid references teams on delete set null;

do $$
declare
  dream uuid;
  first_user uuid;
begin
  -- личная команда каждому нынешнему аккаунту
  insert into teams (name, created_by, personal_for) select 'Личное', id, id from users order by seq;
  insert into team_members (team_id, user_id, role) select id, personal_for, 'admin' from teams where personal_for is not null;

  if exists (select 1 from users) or exists (select 1 from projects) or exists (select 1 from wiki_pages)
     or exists (select 1 from folders) or exists (select 1 from files) then
    select id into first_user from users order by is_admin desc, seq limit 1;
    insert into teams (name, created_by) values ('Dream Team', first_user) returning id into dream;
    insert into team_members (team_id, user_id, role)
      select dream, u.id,
             case when u.is_admin or (not exists (select 1 from users where is_admin) and u.id = first_user)
                  then 'admin'::team_role else 'member'::team_role end
      from users u;

    update projects set team_id = dream;
    update wiki_pages set team_id = dream;
    update folders set team_id = dream;
    -- вложения задач принадлежат команде своего проекта, остальные файлы (библиотека и вложения страниц) общей команде
    update files f set team_id = p.team_id from tasks t join projects p on p.id = t.project_id where f.task_id = t.id;
    update files set team_id = dream where team_id is null;
    -- события без проекта это вики и файлы библиотеки
    update activity set team_id = dream where project_id is null;
  end if;
end
$$;

alter table projects alter column team_id set not null;
alter table wiki_pages alter column team_id set not null;
alter table folders alter column team_id set not null;
alter table files alter column team_id set not null;

create index projects_team_idx on projects (team_id);
create index wiki_pages_team_idx on wiki_pages (team_id, position);
create index files_team_idx on files (team_id) where task_id is null;
create index activity_team_idx on activity (team_id, created_at desc) where team_id is not null;

-- Названия папок уникальны внутри команды, а не на весь сервер
alter table folders drop constraint folders_name_key;
create unique index folders_team_name_idx on folders (team_id, name);

-- Правила доступа в одном месте (docs/TEAMS.md, разделы 3.3 и 3.4): все запросы, которым нужно «видит ли человек
-- проект» или «читает ли вики команды», зовут эти функции, а не повторяют условие.

-- Проект видит: явный участник, администратор его команды, член команды при видимости «Вся команда». Команда не в
-- архиве. Администратор сервера видит всё.
create function can_access_project(project uuid, person uuid) returns boolean language sql stable as $$
  select exists (
    select 1
    from projects p
    join users u on u.id = person
    join teams t on t.id = p.team_id
    left join project_members m on m.project_id = p.id and m.user_id = u.id
    left join team_members tm on tm.team_id = p.team_id and tm.user_id = u.id
    where p.id = project
      and (u.is_admin or (t.archived_at is null
           and (m.user_id is not null or tm.role = 'admin' or (p.visibility = 'team' and tm.user_id is not null))))
  )
$$;

-- «Люди проекта» (исполнитель, ответственный, @упоминание): явные участники и, при видимости «Вся команда», члены команды
create function is_project_person(project uuid, person uuid) returns boolean language sql stable as $$
  select exists (select 1 from project_members m where m.project_id = project and m.user_id = person)
      or exists (select 1 from projects p join team_members tm on tm.team_id = p.team_id and tm.user_id = person
                 where p.id = project and p.visibility = 'team')
$$;

-- Вики и библиотеку команды читает: член команды; гость проекта команды, если админ включил настройку; администратор сервера
create function can_read_team(team uuid, person uuid) returns boolean language sql stable as $$
  select exists (
    select 1
    from teams t
    join users u on u.id = person
    left join team_members tm on tm.team_id = t.id and tm.user_id = u.id
    where t.id = team
      and (u.is_admin or (t.archived_at is null
           and (tm.user_id is not null
                or (t.guests_read_wiki and exists (
                      select 1 from project_members m join projects p on p.id = m.project_id
                      where m.user_id = u.id and p.team_id = t.id and p.archived_at is null)))))
  )
$$;
