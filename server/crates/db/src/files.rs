use sqlx::PgExecutor;
use time::OffsetDateTime;
use uuid::Uuid;

/// Вложение задачи (загрузка файлов появится на этапе 5)
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct TaskFile {
    pub id: Uuid,
    pub name: String,
    pub size_bytes: i64,
    /// img | pdf | doc | sheet | zip | other
    pub kind: String,
    pub uploader_id: Option<Uuid>,
    pub created_at: OffsetDateTime,
}

pub async fn list_for_task<'e>(ex: impl PgExecutor<'e>, task_id: Uuid) -> Result<Vec<TaskFile>, sqlx::Error> {
    sqlx::query_as(
        "select id, name, size_bytes, kind, uploader_id, created_at from files where task_id = $1 order by created_at, id",
    )
    .bind(task_id)
    .fetch_all(ex)
    .await
}
