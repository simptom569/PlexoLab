-- Вики, документы, холст

create type obj_type as enum ('sticky', 'rect', 'ellipse', 'text');
create type doc_mode as enum ('page', 'edge');

create table wiki_pages (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references wiki_pages on delete cascade,
  title text not null default '',
  md text not null default '',
  position double precision not null,
  rev int not null default 1,
  updated_by uuid references users,
  updated_at timestamptz not null default now()
);
create index wiki_pages_parent_idx on wiki_pages (parent_id, position);

create table docs (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  md text not null default '',
  mode doc_mode not null default 'page',
  note_x real not null default 24,
  note_y real not null default 28,
  note_w real not null default 440,
  rev int not null default 1,
  created_by uuid references users,
  updated_by uuid references users,
  updated_at timestamptz not null default now()
);

create table doc_stars (
  doc_id uuid not null references docs on delete cascade,
  user_id uuid not null references users on delete cascade,
  primary key (doc_id, user_id)
);

create table doc_objects (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references docs on delete cascade,
  type obj_type not null,
  x real not null,
  y real not null,
  w real not null,
  h real not null,
  text text not null default '',
  color smallint not null default 0 check (color between 0 and 7)
);
create index doc_objects_doc_idx on doc_objects (doc_id);

create table doc_links (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references docs on delete cascade,
  a uuid not null references doc_objects on delete cascade,
  b uuid not null references doc_objects on delete cascade,
  unique (doc_id, a, b)
);
