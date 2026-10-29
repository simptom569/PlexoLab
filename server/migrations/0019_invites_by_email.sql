-- Приглашения на e-mail без аккаунта (docs/TEAMS.md, раздел 6)
--
-- Администратор может позвать человека, у которого ещё нет аккаунта: приглашение хранится с адресом и ждёт регистрации.
-- Как только аккаунт с таким адресом создан (командой `server user add`, сидом или регистрацией), триггер превращает
-- ожидающие приглашения в обычные: они появляются у него в «Приглашениях», решает он сам. У приглашения либо `user_id`,
-- либо `email`, обоих сразу не бывает.
-- Обратная миграция: server/migrations_down/0019_invites_by_email.down.sql

alter table project_invites alter column user_id drop not null;
alter table project_invites add column email text check (email = lower(email));
alter table project_invites add constraint project_invites_invitee check (num_nonnulls(user_id, email) = 1);
create unique index project_invites_pending_email_idx on project_invites (project_id, email)
  where status = 'pending' and email is not null;
create index project_invites_email_idx on project_invites (email) where status = 'pending' and email is not null;

alter table team_invites alter column user_id drop not null;
alter table team_invites add column email text check (email = lower(email));
alter table team_invites add constraint team_invites_invitee check (num_nonnulls(user_id, email) = 1);
create unique index team_invites_pending_email_idx on team_invites (team_id, email)
  where status = 'pending' and email is not null;
create index team_invites_email_idx on team_invites (email) where status = 'pending' and email is not null;

-- Новый аккаунт забирает приглашения, которые ждали его адрес
create function claim_invites_for_new_user() returns trigger language plpgsql as $$
begin
  update project_invites set user_id = new.id, email = null
   where email = new.email and user_id is null and status = 'pending';
  update team_invites set user_id = new.id, email = null
   where email = new.email and user_id is null and status = 'pending';
  return new;
end
$$;
create trigger users_claim_invites after insert on users for each row execute function claim_invites_for_new_user();
