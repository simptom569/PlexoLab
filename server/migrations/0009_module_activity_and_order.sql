-- Этап 4: категория «Модуль» в ленте активности и порядок модулей по времени создания

alter type act_kind add value 'module';

-- В макете модули идут в порядке добавления; uuid для этого не годится (случайный)
alter table modules add column seq bigint generated always as identity;
