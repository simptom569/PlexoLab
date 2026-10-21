# Модель данных и API

Основа: объекты из `seed()` в `design/Main.dc.html`. Здесь они приведены к реляционной схеме PostgreSQL. Идентификаторы `uuid`, время `timestamptz`, даты `date`.

> **Проектный уровень (проекты, участники, приглашения, метки по проектам, ключи id задач) описан в `PROJECTS.md` и реализуется этапами П1–П5 из `PLAN.md`.** Схема ниже показывает состояние до этих этапов; после каждого этапа её раздел обновляется.

## Таблицы

```sql
create type priority   as enum ('high', 'med', 'low');
create type work_status as enum ('plan', 'progress', 'done');       -- модули и релизы
create type obj_type   as enum ('sticky', 'rect', 'ellipse', 'text');
create type doc_mode   as enum ('page', 'edge');
create type act_kind   as enum ('move', 'create', 'delete', 'comment', 'code', 'doc', 'release', 'file', 'module');   -- 'module' добавлена на этапе 4 (фильтр «Модули» в ленте)

create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text not null,                 -- «Лена М.»
  role text not null default '',      -- «Frontend», показывается в боковом меню
  tone smallint not null default 0,   -- 0..4 → .av-a … .av-e
  is_admin boolean not null default false,
  password_hash text not null,
  created_at timestamptz not null default now()
);
create table refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users on delete cascade,
  token_hash text not null, expires_at timestamptz not null
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,           -- WEB, API, INF
  name text not null,
  color text not null,                -- токен цвета: accent | warn | ok
  last_number int not null default 0  -- для номеров WEB-151
);
create table board_columns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  title text not null,
  color text not null,                -- muted | accent | warn | ok | b-fg | e-fg
  is_done boolean not null default false,
  position double precision not null
);
create table tags (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  tone smallint not null              -- индекс в TONES (0..7)
);

create table modules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  title text not null,
  lead_id uuid references users on delete set null,
  status work_status not null default 'plan',
  date_from date, date_to date,
  note text not null default '',
  seq bigint generated always as identity   -- порядок добавления (в макете модули идут так, а не по датам)
);
create table milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  title text not null, due_date date not null
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  number int not null,
  title text not null,
  column_id uuid references board_columns on delete set null,  -- null = бэклог
  position double precision not null,                           -- порядок в колонке или в бэклоге
  assignee_id uuid references users on delete set null,
  priority priority not null default 'med',
  start_date date, due_date date,
  module_id uuid references modules on delete set null,
  milestone_id uuid references milestones on delete set null,
  pr text not null default '',
  description text not null default '',
  created_by uuid references users,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, number)
);
create table task_tags (task_id uuid references tasks on delete cascade, tag_id uuid references tags on delete cascade, primary key (task_id, tag_id));
create table subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks on delete cascade,
  title text not null, done boolean not null default false, position double precision not null
);
create table comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks on delete cascade,
  author_id uuid not null references users,
  body text not null, created_at timestamptz not null default now()
);

create table releases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  version text not null, release_date date not null,
  status work_status not null default 'plan',
  notes text not null default ''
);
create table release_items (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references releases on delete cascade,
  title text not null, done boolean not null default false, position double precision not null
);

create table wiki_pages (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references wiki_pages on delete cascade,
  title text not null default '',
  md text not null default '',
  position double precision not null,
  rev int not null default 1,
  updated_by uuid references users, updated_at timestamptz not null default now()
);

create table docs (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  md text not null default '',
  mode doc_mode not null default 'page',
  note_x real not null default 24, note_y real not null default 28, note_w real not null default 440,
  position double precision not null,   -- порядок в списке (меньше — выше), общий для команды; новый документ встаёт первым
  rev int not null default 1,           -- версия названия и текста
  canvas_rev int not null default 0,    -- версия холста: растёт при каждом сохранении холста
  created_by uuid references users,
  updated_by uuid references users, updated_at timestamptz not null default now()
);
create table doc_stars (doc_id uuid references docs on delete cascade, user_id uuid references users on delete cascade, primary key (doc_id, user_id));
create table doc_objects (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references docs on delete cascade,
  type obj_type not null,
  x real not null, y real not null, w real not null, h real not null,
  text text not null default '', color smallint not null default 0,
  seq bigint generated always as identity   -- слой: объект с большим номером лежит поверх
);
create table doc_links (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references docs on delete cascade,
  a uuid not null references doc_objects on delete cascade,
  b uuid not null references doc_objects on delete cascade,
  unique (doc_id, a, b)
);

create table folders (id uuid primary key default gen_random_uuid(), name text unique not null, seq bigint generated always as identity);   -- seq: порядок создания
create table files (
  id uuid primary key default gen_random_uuid(),
  name text not null, size_bytes bigint not null,
  kind text not null,                  -- img | pdf | doc | sheet | zip | other (по расширению)
  storage_key text not null,           -- имя файла на диске
  uploader_id uuid references users,
  folder_id uuid references folders on delete set null,
  wiki_page_id uuid references wiki_pages on delete set null,   -- вложение страницы вики
  task_id uuid references tasks on delete cascade,              -- вложение задачи
  created_at timestamptz not null default now()
);

create table link_groups (id uuid primary key default gen_random_uuid(), title text not null, position double precision not null);
create table links (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references link_groups on delete cascade,
  title text not null, url text not null, description text not null default '', position double precision not null
);

create table activity (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references users,
  project_id uuid references projects on delete set null,
  kind act_kind not null,
  target text not null,                -- «WEB-141 Тёмная тема для страницы настроек»
  text text not null,                  -- «перемещена в «На ревью»»
  created_at timestamptz not null default now()
);
create index on activity (created_at desc);
create index on tasks (project_id, column_id, position);
```

**Порядок элементов** (`position`) — дробные числа. При вставке между двумя соседями берётся среднее. Если разница стала меньше `1e-6`, сервер пересчитывает позиции всей колонки целыми числами с шагом 1024.

**Номер задачи.** `last_number` увеличивается в транзакции при создании задачи (`update projects set last_number = last_number + 1 ... returning`). Ключ для интерфейса: `projects.key || '-' || tasks.number`.

**Что НЕ хранится на сервере:** фильтры, вид, «Отображение», тема, последняя открытая страница. Это локальные настройки пользователя.

## REST (все под `/api/v1`, нужен токен, кроме входа)

| Метод и путь | Что делает |
|---|---|
| `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /me` | вход и профиль |
| `PATCH /me` | свой профиль: имя (1–60 символов), подпись под именем (до 40, пустая очищает), цвет аватара (0..4); e-mail, права и пароль так не меняются, лишние поля дают 400 |
| `POST /auth/password` | смена пароля: проверяет текущий (неверный это 400 `wrong_password`, а не 401), завершает все прежние сессии (refresh-токены удаляются, а выданные раньше токены доступа живут до конца срока, до 12 часов) и сразу выдаёт этому устройству новую пару токенов |
| `GET /users` | участники команды |
| `GET /projects` | проекты |
| `GET /projects/{id}/board` | колонки, задачи (с метками и счётчиками подзадач), метки, модули, вехи одним ответом для первой загрузки доски |
| `POST /projects/{id}/columns`, `PATCH /columns/{id}`, `DELETE /columns/{id}?move_to=` | колонки; порядок и цвет через `PATCH` |
| `POST /projects/{id}/tasks`, `GET /tasks/{id}`, `PATCH /tasks/{id}`, `DELETE /tasks/{id}` | задачи; `PATCH` принимает любые поля, в том числе `column_id` и `before_id` (перенос) |
| `POST /tasks/{id}/subtasks`, `PATCH /subtasks/{id}`, `DELETE /subtasks/{id}` | подзадачи |
| `POST /tasks/{id}/comments` | комментарий |
| `POST /tasks/{id}/files` (multipart), `DELETE /files/{id}` | вложения задачи |
| `POST /projects/{id}/modules`, `PATCH`/`DELETE /modules/{id}` | модули (список приходит в `GET /projects/{id}/board`; `tasks_total` и `tasks_done` считает сервер, «готово» — задача в колонке с отметкой «Готово») |
| `POST /projects/{id}/milestones`, `PATCH`/`DELETE /milestones/{id}` | вехи (в ответе тоже `tasks_total` и `tasks_done`) |
| `GET`/`POST /projects/{id}/releases`, `PATCH`/`DELETE /releases/{id}` | релизы вместе с чек-листом; новый релиз получает четыре стандартных шага |
| `POST /releases/{id}/items`, `PATCH`/`DELETE /release-items/{id}` | шаги чек-листа |

Бэклог отдельных ручек не имеет: это задачи с `column_id = null`. Порядок меняется тем же `PATCH /tasks/{id}` (`before_id`), «На доску» — `PATCH` с `column_id` первой колонки.
| `GET/POST/DELETE /tags` | метки |
| `GET /wiki`, `GET /wiki/{id}`, `POST /wiki`, `PATCH /wiki/{id}` (`md` и `title` с обязательным `rev`; перенос: `parent_id` и `before_id`, без `rev`, версию не меняет), `DELETE /wiki/{id}` | страницы вики. `GET /wiki` отдаёт дерево без текста, текст приходит с `GET /wiki/{id}` |
| `GET /files?folder=&kind=&q=&wiki_page_id=`, `POST /files` (multipart), `GET /files/{id}/download`, `DELETE /files/{id}` | библиотека файлов. `folder` — `root` или id папки; ответ `{ total, files }`, где `total` — всего файлов в библиотеке без вложений задач; новые первыми |
| `GET/POST/DELETE /folders` | папки в порядке создания с числом файлов; `DELETE` только для пустой |
| `GET /docs?q=&starred=`, `POST /docs`, `GET /docs/{id}`, `PATCH /docs/{id}`, `DELETE /docs/{id}`, `PUT /docs/{id}/star` | документы. Список без текста: фрагмент, счётчик объектов, объекты для миниатюры у документов-холстов, в порядке `position`. `PATCH`: `title` и `md` с обязательным `rev` (409 и `current` в теле), `mode` и `before_id` (перенос в списке, `null` — в конец) без `rev` и версию не меняют. `PUT star` с `{ "starred": bool }`: звёздочка у каждого своя |
| `PUT /docs/{id}/canvas` | сохранить сразу карточку с текстом, объекты и стрелки холста (тело — полный список, идентификаторы объектов выдаёт клиент); в одной транзакции, ответ с новой `canvas_rev` |
| `GET /activity?actor=&kind=&before=` | лента, постранично по 50. Ответ `{ items, next }`: события от новых к старым (у каждого `category`: `tasks` (перенос, создание, удаление), `comment`, `code`, `doc`, `release`, `file`, `module`), `next` — курсор для `before` или `null`. `kind` — та же категория; `actor` — участник |
| `GET/POST /link-groups`, `PATCH/DELETE /link-groups/{id}` | группы ссылок команды (список сразу со ссылками), переименование, удаление вместе со ссылками |
| `POST /link-groups/{id}/links`, `DELETE /links/{id}` | добавить ссылку в конец группы (`https://` добавляется, если нет схемы), удалить. Правки ссылки нет: в макете её нельзя править |
| `GET /healthz` | проверка живости (без токена) |

Запись в `activity` делает сервер сам в той же транзакции, что и действие. Клиент её не создаёт.

Конфликты: `PATCH /wiki/{id}` и `PATCH /docs/{id}` принимают `rev`. Если он не совпадает с текущим, ответ 409 и актуальная версия в теле. Что делать с 409, решает клиент: он сливает свою правку с `current` по строкам, как git (`app/src/lib/merge.ts`), и повторяет запрос с новой версией; сервер историю версий не хранит и ничего не сливает.

## WebSocket `/api/v1/ws`

Не REST-ручка и в схему OpenAPI не входит. Все сообщения текстовые (JSON), разговор такой:

1. Клиент подключается и **первым сообщением** присылает `{"type":"auth","token":"<токен доступа>"}`. Токен не в адресе (`?token=`): адреса попадают в журналы сервера и прокси, а сообщения нет. Не прислал за 10 секунд, прислал не то или чужой токен: сервер закрывает соединение кодом 4408 (не дождались) или 4401 (токен не принят). Мест под соединения 100, больше не принимаются (ответ 503).
2. Сервер отвечает `{"type":"ready"}`. Подписка на события оформлена раньше этого ответа: всё, что случилось после него, клиент получит, а всё, что до него, увидит, перечитав данные.
3. Дальше приходят события `{ "type": "task.updated", "id": "...", "project_id": "...", "origin": "..." }`. `id` (запись) и `project_id` (проект) заполнены, только если ручка их знает, иначе `null`: тогда клиент перечитывает всё такого рода. `origin` — метка клиента, чей запрос это вызвал (заголовок `X-Client-Id`, до 64 букв, цифр, `-` и `_`); свои события клиент пропускает.
4. Клиент, который отстал (в канале 256 событий), получает `{"type":"resync"}`: часть событий пропущена, надо перечитать всё.
5. Каждые 25 секунд сервер шлёт `{"type":"ping"}`, клиент отвечает `{"type":"pong"}`. Кто молчит дольше 70 секунд, отключается (4408). Клиент так же следит за сервером (60 секунд): связь, оборванная без закрытия (сон ноутбука, смена сети), иначе осталась бы «живой» до таймаута TCP.
6. Когда токен доступа истекает, сервер закрывает соединение кодом 4401; клиент берёт новый токен и входит заново. При остановке сервера соединения закрываются кодом 1001, иначе остановка ждала бы их вечно.

События (данных в них нет, только «что поменялось»; клиент перечитывает нужный запрос):

| Тип | Когда | Что перечитывает клиент |
|---|---|---|
| `task.created`, `task.updated`, `task.deleted` | задачи, подзадачи, перенос между колонками (идёт тем же `PATCH`, поэтому это `task.updated`), вложения задачи | доска проекта и открытая задача |
| `task.moved` | задачи переехали при удалении колонки | доски и открытые задачи |
| `column.changed`, `module.changed`, `milestone.changed`, `tag.changed` | колонки, модули, вехи, метки: всё это приходит в ответе доски | доска проекта |
| `comment.created` | комментарий | открытая задача |
| `release.changed` | релизы и шаги чек-листа | релизы проекта |
| `wiki.updated` | создание, правка, перенос, удаление страницы | дерево и открытая страница |
| `doc.updated`, `doc.canvas` | документ, звёздочка, холст | список и открытый документ |
| `file.changed` | файлы и папки | библиотека, папки, открытые задачи |
| `link.changed` | ссылки команды | группы ссылок |
| `user.changed` | человек поменял своё имя, подпись или цвет аватара (`PATCH /me`) | список участников; у того же человека на другом устройстве обновляется и боковое меню |
| `activity.created` | действие могло попасть в ленту (ручка записи, которая обычно пишет событие в активность) | лента активности |

Одно действие обычно даёт несколько событий (создание задачи: `task.created` и `activity.created`). Список событий каждой ручки лежит в таблице `TABLE` в `server/crates/api/src/events.rs`; тест сверяет её со схемой OpenAPI, поэтому новая ручка записи без строки в таблице не пройдёт тесты. События рассылает один слой над ручками после успешного ответа, то есть после `commit`; ответ с ошибкой событий не даёт. Клиент незнакомые типы событий пропускает, поэтому новый тип можно добавить на сервере раньше, чем клиент его поймёт.

Клиент пакетует события (150 мс), убирает повторы и не перечитывает данные, пока идут его собственные правки или перенос карточки (но не дольше 3 секунд).

## Сид-данные для разработки

`cargo run --bin seed` создаёт пятерых пользователей (Лена М., Артём К., Даниил С., Соня В., Игорь П. — пароль `dev` только для разработки), три проекта, колонки, метки, задачи, модули, вехи, релизы, вики, документы, файлы (запись в БД без реального файла), группы ссылок и ленту активности. Данные взять из `seed()` в `design/Main.dc.html`.
