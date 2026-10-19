use sqlx::{PgConnection, PgExecutor};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Comment {
    pub id: Uuid,
    pub task_id: Uuid,
    pub author_id: Uuid,
    pub body: String,
    pub created_at: OffsetDateTime,
}

pub async fn list<'e>(ex: impl PgExecutor<'e>, task_id: Uuid) -> Result<Vec<Comment>, sqlx::Error> {
    sqlx::query_as(
        "select id, task_id, author_id, body, created_at from comments where task_id = $1 order by created_at, id",
    )
    .bind(task_id)
    .fetch_all(ex)
    .await
}

pub async fn insert(
    conn: &mut PgConnection,
    task_id: Uuid,
    author_id: Uuid,
    body: &str,
) -> Result<Comment, sqlx::Error> {
    sqlx::query_as(
        "insert into comments (task_id, author_id, body) values ($1, $2, $3) \
         returning id, task_id, author_id, body, created_at",
    )
    .bind(task_id)
    .bind(author_id)
    .bind(body)
    .fetch_one(conn)
    .await
}
