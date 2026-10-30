-- Коды из писем: регистрация и сброс пароля (docs/REGISTRATION.md)
--
-- Человек вводит e-mail, сервер отправляет код из шести цифр. В базе лежит только хэш кода. Для одного адреса и одного
-- назначения действует самый новый код; строки старше двух часов стираются при выдаче следующего кода. По строкам же
-- считаются лимиты: письмо на один адрес не чаще раза в минуту, на весь сервер не больше N в час.
-- У строки нет ссылки на users: при регистрации аккаунта ещё нет.
-- Обратная миграция: server/migrations_down/0020_email_codes.down.sql

create table email_codes (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('register', 'reset')),
  email text not null check (email = lower(email)),
  code_hash text not null,                          -- sha256(назначение, адрес, код) в hex, сам код не хранится
  attempts smallint not null default 0,             -- сколько раз ошиблись; на пятой ошибке строка удаляется
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index email_codes_address_idx on email_codes (purpose, email, created_at desc);
create index email_codes_created_idx on email_codes (created_at);
