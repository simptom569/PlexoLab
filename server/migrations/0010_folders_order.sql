-- Этап 5: папки идут в порядке создания (в макете «Дизайн», «Договорённости», «Скриншоты», «Вложения»), uuid для порядка не годится

alter table folders add column seq bigint generated always as identity;
