-- Стабильный порядок проектов и меток: в интерфейсе они идут в порядке создания (сайдбар, список меток в панели задачи).
-- seq выдаётся базой, одинаковых значений не бывает.

alter table projects add column seq bigint generated always as identity;
alter table tags add column seq bigint generated always as identity;
