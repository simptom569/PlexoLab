use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Subtask {
    pub id: Uuid,
    pub task_id: Uuid,
    pub title: String,
    pub done: bool,
    pub position: f64,
}

pub async fn list<'e>(ex: impl PgExecutor<'e>, task_id: Uuid) -> Result<Vec<Subtask>, sqlx::Error> {
    sqlx::query_as("select id, task_id, title, done, position from subtasks where task_id = $1 order by position, id")
        .bind(task_id)
        .fetch_all(ex)
        .await
}

pub async fn get<'e>(ex: impl PgExecutor<'e>, id: Uuid) -> Result<Option<Subtask>, sqlx::Error> {
    sqlx::query_as("select id, task_id, title, done, position from subtasks where id = $1")
        .bind(id)
        .fetch_optional(ex)
        .await
}

/// Новая подзадача в конец списка
pub async fn insert(conn: &mut PgConnection, task_id: Uuid, title: &str) -> Result<Subtask, sqlx::Error> {
    sqlx::query_as(
        "insert into subtasks (task_id, title, position) \
         values ($1, $2, coalesce((select max(position) from subtasks where task_id = $1), 0) + 1024) \
         returning id, task_id, title, done, position",
    )
    .bind(task_id)
    .bind(title)
    .fetch_one(conn)
    .await
}

pub async fn update(
    conn: &mut PgConnection,
    id: Uuid,
    title: Option<&str>,
    done: Option<bool>,
) -> Result<Subtask, sqlx::Error> {
    sqlx::query_as(
        "update subtasks set title = coalesce($2, title), done = coalesce($3, done) where id = $1 \
         returning id, task_id, title, done, position",
    )
    .bind(id)
    .bind(title)
    .bind(done)
    .fetch_one(conn)
    .await
}

pub async fn delete(conn: &mut PgConnection, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from subtasks where id = $1").bind(id).execute(conn).await?;
    Ok(())
}
