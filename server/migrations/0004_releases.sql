-- Релизы и чек-лист выкатки

create table releases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  version text not null,
  release_date date not null,
  status work_status not null default 'plan',
  notes text not null default ''
);
create index releases_project_idx on releases (project_id, release_date desc);

create table release_items (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references releases on delete cascade,
  title text not null,
  done boolean not null default false,
  position double precision not null
);
create index release_items_release_idx on release_items (release_id, position);
