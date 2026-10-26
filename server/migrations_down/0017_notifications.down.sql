-- Обратная миграция к 0017_notifications.sql. Запускается вручную (psql -f), sqlx её не применяет.
-- После неё удалить строку version = 17 из таблицы _sqlx_migrations.
--
-- Уведомления и списки упомянутых в комментариях пропадают. Тексты комментариев остаются как были: метки `@[id]` в них
-- станут обычным текстом.

begin;

drop table notifications;
alter table comments drop column mentions;
drop type notification_kind;

commit;
