//! Колонки доски

use domain::position::{self, Placement};
use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Column {
    pub id: Uuid,
    pub project_id: Uuid,
    pub title: String,
    pub color: String,
    pub is_done: bool,
    pub position: f64,
}

macro_rules! select_column {
    ($tail:literal) => {
        concat!("select id, project_id, title, color, is_done, position from board_columns ", $tail)
    };
}

pub async fn list<'e>(ex: impl PgExecutor<'e>, project_id: Uuid) -> Result<Vec<Column>, sqlx::Error> {
    sqlx::query_as(select_column!("where project_id = $1 order by position, id")).bind(project_id).fetch_all(ex).await
}

pub async fn get<'e>(ex: impl PgExecutor<'e>, id: Uuid) -> Result<Option<Column>, sqlx::Error> {
    sqlx::query_as(select_column!("where id = $1")).bind(id).fetch_optional(ex).await
}

/// Новая колонка в конец доски
pub async fn insert(
    conn: &mut PgConnection,
    project_id: Uuid,
    title: &str,
    color: &str,
    is_done: bool,
) -> Result<Column, sqlx::Error> {
    sqlx::query_as(
        "insert into board_columns (project_id, title, color, is_done, position) \
         values ($1, $2, $3, $4, coalesce((select max(position) from board_columns where project_id = $1), 0) + 1024) \
         returning id, project_id, title, color, is_done, position",
    )
    .bind(project_id)
    .bind(title)
    .bind(color)
    .bind(is_done)
    .fetch_one(conn)
    .await
}

/// Меняет только переданные поля
pub async fn update(
    conn: &mut PgConnection,
    id: Uuid,
    title: Option<&str>,
    color: Option<&str>,
    is_done: Option<bool>,
) -> Result<Column, sqlx::Error> {
    sqlx::query_as(
        "update board_columns set title = coalesce($2, title), color = coalesce($3, color), \
         is_done = coalesce($4, is_done) where id = $1 \
         returning id, project_id, title, color, is_done, position",
    )
    .bind(id)
    .bind(title)
    .bind(color)
    .bind(is_done)
    .fetch_one(conn)
    .await
}

#[derive(Debug, thiserror::Error)]
pub enum PlaceError {
    #[error("колонка, перед которой нужно встать, не найдена на этой доске")]
    BeforeNotFound,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

/// Переставляет колонку перед `before` (None: в конец). Возвращает колонку с новой позицией.
pub async fn place(conn: &mut PgConnection, column: &Column, before: Option<Uuid>) -> Result<Column, PlaceError> {
    let siblings: Vec<(Uuid, f64)> = sqlx::query_as(
        "select id, position from board_columns where project_id = $1 and id <> $2 order by position, id",
    )
    .bind(column.project_id)
    .bind(column.id)
    .fetch_all(&mut *conn)
    .await?;

    let position = match position::place(&siblings, column.id, before).map_err(|_| PlaceError::BeforeNotFound)? {
        Placement::One(p) => p,
        Placement::All(all) => {
            let (ids, positions): (Vec<Uuid>, Vec<f64>) = all.iter().copied().unzip();
            sqlx::query(
                "update board_columns set position = v.pos from unnest($1::uuid[], $2::float8[]) as v(id, pos) \
                 where board_columns.id = v.id",
            )
            .bind(ids)
            .bind(positions)
            .execute(&mut *conn)
            .await?;
            all.iter().find(|(k, _)| *k == column.id).map_or(position::STEP, |(_, p)| *p)
        }
    };
    let moved = sqlx::query_as(
        "update board_columns set position = $2 where id = $1 returning id, project_id, title, color, is_done, position",
    )
    .bind(column.id)
    .bind(position)
    .fetch_one(conn)
    .await?;
    Ok(moved)
}

pub async fn delete(conn: &mut PgConnection, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from board_columns where id = $1").bind(id).execute(conn).await?;
    Ok(())
}
