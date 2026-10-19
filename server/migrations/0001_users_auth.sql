-- Пользователи и сессии

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  name text not null,                 -- «Лена М.»
  role text not null default '',      -- «Frontend», показывается в боковом меню
  tone smallint not null default 0 check (tone between 0 and 4),   -- 0..4 → .av-a … .av-e
  is_admin boolean not null default false,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users on delete cascade,
  token_hash text not null unique,    -- sha256 токена в hex, сам токен в базе не хранится
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index refresh_tokens_user_idx on refresh_tokens (user_id);
