//! Страницы вики. Дерево хранится плоско (`parent_id`), собирает его клиент.

use domain::position::{self, Placement};
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

/// Что менять в содержимом. `None` — оставить как есть.
#[derive(Debug, Default)]
pub struct Patch<'a> {
    pub title: Option<&'a str>,
    pub md: Option<&'a str>,
}

/// Записывает название и текст и увеличивает `rev`. Проверку старого `rev` делает вызывающий.
pub async fn update(
    conn: &mut PgConnection,
    id: Uuid,
    patch: &Patch<'_>,
    user_id: Uuid,
) -> Result<WikiPage, sqlx::Error> {
    sqlx::query_as(concat!(
        "update wiki_pages set title = coalesce($2, title), md = coalesce($3, md), ",
        "rev = rev + 1, updated_by = $4, updated_at = now() where id = $1 ",
        "returning id, parent_id, title, md, position, rev, updated_by, updated_at"
    ))
    .bind(id)
    .bind(patch.title)
    .bind(patch.md)
    .bind(user_id)
    .fetch_one(conn)
    .await
}

#[derive(Debug, thiserror::Error)]
pub enum PlaceError {
    #[error("страница, перед которой нужно встать, не найдена среди вложенных в этого родителя")]
    BeforeNotFound,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

/// Ставит страницу под `parent` перед страницей `before` (None: в конец). Меняет только место в дереве:
/// версия, текст и время правки не трогаются. Если страница уже стоит там, ничего не пишется.
/// Вызывающий держит `lock` и сам проверяет, что `parent` существует и не лежит внутри самой страницы.
pub async fn place(
    conn: &mut PgConnection,
    page: &WikiPage,
    parent: Option<Uuid>,
    before: Option<Uuid>,
) -> Result<WikiPage, PlaceError> {
    // все вложенные в `parent`, включая саму страницу, если она там уже есть
    let all: Vec<(Uuid, f64)> = sqlx::query_as(
        "select id, position from wiki_pages where parent_id is not distinct from $1 order by position, id",
    )
    .bind(parent)
    .fetch_all(&mut *conn)
    .await?;
    if page.parent_id == parent
        && let Some(i) = all.iter().position(|(id, _)| *id == page.id)
        && all.get(i + 1).map(|(id, _)| *id) == before
    {
        return Ok(page.clone());
    }

    let siblings: Vec<(Uuid, f64)> = all.into_iter().filter(|(id, _)| *id != page.id).collect();
    let position = match position::place(&siblings, page.id, before).map_err(|_| PlaceError::BeforeNotFound)? {
        Placement::One(p) => p,
        Placement::All(all) => {
            let (ids, positions): (Vec<Uuid>, Vec<f64>) = all.iter().copied().unzip();
            sqlx::query(
                "update wiki_pages set position = v.pos from unnest($1::uuid[], $2::float8[]) as v(id, pos) \
                 where wiki_pages.id = v.id",
            )
            .bind(ids)
            .bind(positions)
            .execute(&mut *conn)
            .await?;
            all.iter().find(|(k, _)| *k == page.id).map_or(position::STEP, |(_, p)| *p)
        }
    };
    let moved = sqlx::query_as(concat!(
        "update wiki_pages set parent_id = $2, position = $3 where id = $1 ",
        "returning id, parent_id, title, md, position, rev, updated_by, updated_at"
    ))
    .bind(page.id)
    .bind(parent)
    .bind(position)
    .fetch_one(conn)
    .await?;
    Ok(moved)
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
