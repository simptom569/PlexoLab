//! Релизы и чек-лист выкатки

use sqlx::{PgConnection, PgExecutor};
use time::Date;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Release {
    pub id: Uuid,
    pub project_id: Uuid,
    pub version: String,
    pub release_date: Date,
    /// plan | progress | done
    pub status: String,
    pub notes: String,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ReleaseItem {
    pub id: Uuid,
    pub release_id: Uuid,
    pub title: String,
    pub done: bool,
    pub position: f64,
}

macro_rules! select_release {
    ($tail:literal) => {
        concat!("select id, project_id, version, release_date, status::text as status, notes from releases ", $tail)
    };
}

macro_rules! select_item {
    ($tail:literal) => {
        concat!("select id, release_id, title, done, position from release_items ", $tail)
    };
}

/// Релизы проекта от новых к старым
pub async fn list<'e>(ex: impl PgExecutor<'e>, project_id: Uuid) -> Result<Vec<Release>, sqlx::Error> {
    sqlx::query_as(select_release!("where project_id = $1 order by release_date desc, id"))
        .bind(project_id)
        .fetch_all(ex)
        .await
}

/// Шаги всех релизов проекта по порядку, для сборки списка одним запросом
pub async fn list_items_for_project<'e>(
    ex: impl PgExecutor<'e>,
    project_id: Uuid,
) -> Result<Vec<ReleaseItem>, sqlx::Error> {
    sqlx::query_as(
        "select i.id, i.release_id, i.title, i.done, i.position from release_items i \
         join releases r on r.id = i.release_id where r.project_id = $1 order by i.position, i.id",
    )
    .bind(project_id)
    .fetch_all(ex)
    .await
}

pub async fn list_items<'e>(ex: impl PgExecutor<'e>, release_id: Uuid) -> Result<Vec<ReleaseItem>, sqlx::Error> {
    sqlx::query_as(select_item!("where release_id = $1 order by position, id")).bind(release_id).fetch_all(ex).await
}

pub async fn get<'e>(ex: impl PgExecutor<'e>, id: Uuid) -> Result<Option<Release>, sqlx::Error> {
    sqlx::query_as(select_release!("where id = $1")).bind(id).fetch_optional(ex).await
}

/// Новый релиз со статусом «Запланирован» и без шагов
pub async fn insert(
    conn: &mut PgConnection,
    project_id: Uuid,
    version: &str,
    release_date: Date,
) -> Result<Release, sqlx::Error> {
    sqlx::query_as(
        "insert into releases (project_id, version, release_date) values ($1, $2, $3) \
         returning id, project_id, version, release_date, status::text as status, notes",
    )
    .bind(project_id)
    .bind(version)
    .bind(release_date)
    .fetch_one(conn)
    .await
}

pub async fn update(
    conn: &mut PgConnection,
    id: Uuid,
    version: Option<&str>,
    release_date: Option<Date>,
    status: Option<&str>,
    notes: Option<&str>,
) -> Result<Release, sqlx::Error> {
    sqlx::query_as(
        "update releases set version = coalesce($2, version), release_date = coalesce($3, release_date), \
         status = coalesce($4::work_status, status), notes = coalesce($5, notes) where id = $1 \
         returning id, project_id, version, release_date, status::text as status, notes",
    )
    .bind(id)
    .bind(version)
    .bind(release_date)
    .bind(status)
    .bind(notes)
    .fetch_one(conn)
    .await
}

/// Вместе с шагами (`on delete cascade`)
pub async fn delete(conn: &mut PgConnection, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from releases where id = $1").bind(id).execute(conn).await?;
    Ok(())
}

pub async fn get_item<'e>(ex: impl PgExecutor<'e>, id: Uuid) -> Result<Option<ReleaseItem>, sqlx::Error> {
    sqlx::query_as(select_item!("where id = $1")).bind(id).fetch_optional(ex).await
}

/// Шаг в конец чек-листа
pub async fn insert_item(conn: &mut PgConnection, release_id: Uuid, title: &str) -> Result<ReleaseItem, sqlx::Error> {
    sqlx::query_as(
        "insert into release_items (release_id, title, position) \
         values ($1, $2, coalesce((select max(position) from release_items where release_id = $1), 0) + 1024) \
         returning id, release_id, title, done, position",
    )
    .bind(release_id)
    .bind(title)
    .fetch_one(conn)
    .await
}

pub async fn update_item(
    conn: &mut PgConnection,
    id: Uuid,
    title: Option<&str>,
    done: Option<bool>,
) -> Result<ReleaseItem, sqlx::Error> {
    sqlx::query_as(
        "update release_items set title = coalesce($2, title), done = coalesce($3, done) where id = $1 \
         returning id, release_id, title, done, position",
    )
    .bind(id)
    .bind(title)
    .bind(done)
    .fetch_one(conn)
    .await
}

pub async fn delete_item(conn: &mut PgConnection, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from release_items where id = $1").bind(id).execute(conn).await?;
    Ok(())
}
