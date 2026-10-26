use sqlx::{PgConnection, PgExecutor};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Comment {
    pub id: Uuid,
    pub task_id: Uuid,
    pub author_id: Uuid,
    pub body: String,
    /// Кого упомянули: участники проекта, проверенные при создании (в тексте метки `@[id]`)
    pub mentions: Vec<Uuid>,
    pub created_at: OffsetDateTime,
}

pub async fn list<'e>(ex: impl PgExecutor<'e>, task_id: Uuid) -> Result<Vec<Comment>, sqlx::Error> {
    sqlx::query_as(
        "select id, task_id, author_id, body, mentions, created_at from comments where task_id = $1 \
         order by created_at, id",
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
    mentions: &[Uuid],
) -> Result<Comment, sqlx::Error> {
    sqlx::query_as(
        "insert into comments (task_id, author_id, body, mentions) values ($1, $2, $3, $4) \
         returning id, task_id, author_id, body, mentions, created_at",
    )
    .bind(task_id)
    .bind(author_id)
    .bind(body)
    .bind(mentions)
    .fetch_one(conn)
    .await
}
