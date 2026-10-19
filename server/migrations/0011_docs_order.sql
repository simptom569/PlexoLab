-- Этап 6: порядок документов и слоёв холста.
--
-- Документы идут в списке в том порядке, который задают люди перетаскиванием карточек, новые первыми
-- (в макете createDoc кладёт документ в начало). Порядок общий для всей команды, как у страниц вики.
-- У уже созданных документов порядок берётся по времени правки: свежие первыми.
alter table docs add column position double precision;
update docs set position = o.n * 1024
  from (select id, row_number() over (order by updated_at desc, id) as n from docs) o
  where docs.id = o.id;
alter table docs alter column position set not null;
create index docs_position_idx on docs (position);

-- Слои на холсте: объект, добавленный позже, лежит поверх более ранних (в макете это порядок в массиве).
-- Номер выдаёт база, при замене холста у существующих объектов он не меняется.
alter table doc_objects add column seq bigint generated always as identity;
