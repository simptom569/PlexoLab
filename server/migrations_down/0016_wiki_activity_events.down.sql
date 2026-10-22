-- Обратная миграция к 0016_wiki_activity_events.sql (и 0015_wiki_activity_kind.sql). Запускается вручную (psql -f), sqlx её не применяет.
-- После неё удалить строки version = 16 и 15 из таблицы _sqlx_migrations.
--
-- События вики снова идут с типом `doc`. Значение `wiki` в enum act_kind остаётся: Postgres не умеет удалять значения enum,
-- а неиспользуемое значение ничему не мешает.

begin;

update activity set kind = 'doc' where kind = 'wiki';

commit;
