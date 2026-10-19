//! Страницы вики. Дерево хранится плоско (`parent_id`), собирает его клиент.

use sqlx::{PgConnection, PgExecutor};
use time::OffsetDateTime;
use uuid::Uuid;

/// Страница без текста: для дерева. Текст каждой страницы читается отдельно.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct WikiNode {
    pub id: Uuid,
    pub parent_id: Option<Uuid>,
    pub title: String,
    pub position: f64,
    pub rev: i32,
    pub updated_by: Option<Uuid>,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct WikiPage {
    pub id: Uuid,
    pub parent_id: Option<Uuid>,
    pub title: String,
    pub md: String,
    pub position: f64,
    pub rev: i32,
    pub updated_by: Option<Uuid>,
    pub updated_at: OffsetDateTime,
}

macro_rules! select_page {
    ($tail:literal) => {
        concat!("select id, parent_id, title, md, position, rev, updated_by, updated_at from wiki_pages ", $tail)
    };
}

/// Все страницы без текста. Порядок: по позиции, так что соседи одного родителя идут как в дереве.
pub async fn list<'e>(ex: impl PgExecutor<'e>) -> Result<Vec<WikiNode>, sqlx::Error> {
    sqlx::query_as(
        "select id, parent_id, title, position, rev, updated_by, updated_at from wiki_pages order by position, id",
    )
    .fetch_all(ex)
    .await
}

pub async fn get<'e>(ex: impl PgExecutor<'e>, id: Uuid) -> Result<Option<WikiPage>, sqlx::Error> {
    sqlx::query_as(select_page!("where id = $1")).bind(id).fetch_optional(ex).await
}

/// Страница с блокировкой строки до конца транзакции: так проверка `rev` и запись не разойдутся
pub async fn get_for_update(conn: &mut PgConnection, id: Uuid) -> Result<Option<WikiPage>, sqlx::Error> {
    sqlx::query_as(select_page!("where id = $1 for update")).bind(id).fetch_optional(conn).await
}

/// Одновременное создание и перенос страниц идут по очереди: позиции соседей считаются «в конец»
pub async fn lock(conn: &mut PgConnection) -> Result<(), sqlx::Error> {
    sqlx::query("select pg_advisory_xact_lock(hashtext('wiki_tree'))").execute(conn).await?;
    Ok(())
}

/// Новая страница в конец списка вложенных в `parent_id` (или корневых)
pub async fn insert(
    conn: &mut PgConnection,
    parent_id: Option<Uuid>,
    title: &str,
    md: &str,
    user_id: Uuid,
) -> Result<WikiPage, sqlx::Error> {
    sqlx::query_as(concat!(
        "insert into wiki_pages (parent_id, title, md, position, updated_by) values ($1, $2, $3, ",
        "coalesce((select max(position) from wiki_pages where parent_id is not distinct from $1), 0) + 1024, $4) ",
        "returning id, parent_id, title, md, position, rev, updated_by, updated_at"
    ))
    .bind(parent_id)
    .bind(title)
    .bind(md)
    .bind(user_id)
    .fetch_one(conn)
    .await
}

/// Что менять. `None` — оставить как есть. Перенос к другому родителю ставит страницу в конец его списка.
#[derive(Debug, Default)]
pub struct Patch<'a> {
    pub title: Option<&'a str>,
    pub md: Option<&'a str>,
    pub parent_id: Option<Option<Uuid>>,
}

/// Записывает изменения и увеличивает `rev`. Проверку старого `rev` делает вызывающий.
pub async fn update(
    conn: &mut PgConnection,
    id: Uuid,
    patch: &Patch<'_>,
    user_id: Uuid,
) -> Result<WikiPage, sqlx::Error> {
    sqlx::query_as(concat!(
        "update wiki_pages set title = coalesce($2, title), md = coalesce($3, md), ",
        "parent_id = case when $4 then $5::uuid else parent_id end, ",
        "position = case when $4 then coalesce((select max(position) from wiki_pages ",
        "where parent_id is not distinct from $5::uuid and id <> $1), 0) + 1024 else position end, ",
        "rev = rev + 1, updated_by = $6, updated_at = now() where id = $1 ",
        "returning id, parent_id, title, md, position, rev, updated_by, updated_at"
    ))
    .bind(id)
    .bind(patch.title)
    .bind(patch.md)
    .bind(patch.parent_id.is_some())
    .bind(patch.parent_id.flatten())
    .bind(user_id)
    .fetch_one(conn)
    .await
}

/// Входит ли `candidate` в поддерево `root` (сама `root` тоже): страницу нельзя переносить внутрь себя
pub async fn in_subtree(conn: &mut PgConnection, root: Uuid, candidate: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "with recursive sub as (select id from wiki_pages where id = $1 \
         union all select w.id from wiki_pages w join sub on w.parent_id = sub.id) \
         select exists(select 1 from sub where id = $2)",
    )
    .bind(root)
    .bind(candidate)
    .fetch_one(conn)
    .await
}

/// Удаляет страницу вместе с вложенными (внешний ключ). Файлы страниц открепляются, сами остаются.
pub async fn delete(conn: &mut PgConnection, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from wiki_pages where id = $1").bind(id).execute(conn).await?;
    Ok(())
}

/// Сколько страниц удалится вместе с этой (она сама и все вложенные)
pub async fn subtree_size(conn: &mut PgConnection, id: Uuid) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "with recursive sub as (select id from wiki_pages where id = $1 \
         union all select w.id from wiki_pages w join sub on w.parent_id = sub.id) \
         select count(*) from sub",
    )
    .bind(id)
    .fetch_one(conn)
    .await
}
