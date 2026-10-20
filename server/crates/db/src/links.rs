//! Ссылки команды: группы и ссылки в них

use domain::position;
use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Group {
    pub id: Uuid,
    pub title: String,
    pub position: f64,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Link {
    pub id: Uuid,
    pub group_id: Uuid,
    pub title: String,
    pub url: String,
    pub description: String,
    pub position: f64,
}

macro_rules! select_link {
    ($tail:literal) => {
        concat!("select id, group_id, title, url, description, position from links ", $tail)
    };
}

/// Группы в порядке создания
pub async fn list_groups<'e>(ex: impl PgExecutor<'e>) -> Result<Vec<Group>, sqlx::Error> {
    sqlx::query_as("select id, title, position from link_groups order by position, id").fetch_all(ex).await
}

/// Все ссылки: сначала по группам, внутри группы в порядке добавления
pub async fn list_links<'e>(ex: impl PgExecutor<'e>) -> Result<Vec<Link>, sqlx::Error> {
    sqlx::query_as(select_link!("order by group_id, position, id")).fetch_all(ex).await
}

/// Ссылки одной группы в порядке добавления
pub async fn list_links_of<'e>(ex: impl PgExecutor<'e>, group_id: Uuid) -> Result<Vec<Link>, sqlx::Error> {
    sqlx::query_as(select_link!("where group_id = $1 order by position, id")).bind(group_id).fetch_all(ex).await
}

pub async fn get_group<'e>(ex: impl PgExecutor<'e>, id: Uuid) -> Result<Option<Group>, sqlx::Error> {
    sqlx::query_as("select id, title, position from link_groups where id = $1").bind(id).fetch_optional(ex).await
}

/// Блокирует группу до конца транзакции: пока в неё добавляют ссылку, её не удалят
pub async fn lock_group(conn: &mut PgConnection, id: Uuid) -> Result<Option<Group>, sqlx::Error> {
    sqlx::query_as("select id, title, position from link_groups where id = $1 for update")
        .bind(id)
        .fetch_optional(conn)
        .await
}

/// Новая группа в конце списка
pub async fn insert_group(conn: &mut PgConnection, title: &str) -> Result<Group, sqlx::Error> {
    let last: Option<f64> = sqlx::query_scalar("select max(position) from link_groups").fetch_one(&mut *conn).await?;
    sqlx::query_as("insert into link_groups (title, position) values ($1, $2) returning id, title, position")
        .bind(title)
        .bind(position::after(last))
        .fetch_one(conn)
        .await
}

pub async fn rename_group(conn: &mut PgConnection, id: Uuid, title: &str) -> Result<Option<Group>, sqlx::Error> {
    sqlx::query_as("update link_groups set title = $2 where id = $1 returning id, title, position")
        .bind(id)
        .bind(title)
        .fetch_optional(conn)
        .await
}

/// Удаляет группу вместе со ссылками. `false`, если такой группы нет.
pub async fn delete_group(conn: &mut PgConnection, id: Uuid) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("delete from link_groups where id = $1").bind(id).execute(conn).await?.rows_affected() > 0)
}

/// Новая ссылка в конце группы
pub async fn insert_link(
    conn: &mut PgConnection,
    group_id: Uuid,
    title: &str,
    url: &str,
    description: &str,
) -> Result<Link, sqlx::Error> {
    let last: Option<f64> = sqlx::query_scalar("select max(position) from links where group_id = $1")
        .bind(group_id)
        .fetch_one(&mut *conn)
        .await?;
    sqlx::query_as(
        "insert into links (group_id, title, url, description, position) values ($1, $2, $3, $4, $5) \
         returning id, group_id, title, url, description, position",
    )
    .bind(group_id)
    .bind(title)
    .bind(url)
    .bind(description)
    .bind(position::after(last))
    .fetch_one(conn)
    .await
}

/// Удаляет ссылку. `false`, если такой ссылки нет.
pub async fn delete_link(conn: &mut PgConnection, id: Uuid) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("delete from links where id = $1").bind(id).execute(conn).await?.rows_affected() > 0)
}
