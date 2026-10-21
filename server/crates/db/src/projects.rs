use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Project {
    pub id: Uuid,
    /// Префикс id задач вне модулей с ключом; `None`: у таких задач `TASK`
    pub key: Option<String>,
    pub name: String,
    pub color: String,
}

/// Проекты в порядке создания
pub async fn list<'e>(ex: impl PgExecutor<'e>) -> Result<Vec<Project>, sqlx::Error> {
    sqlx::query_as("select id, key, name, color from projects order by seq").fetch_all(ex).await
}

pub async fn get<'e>(ex: impl PgExecutor<'e>, id: Uuid) -> Result<Option<Project>, sqlx::Error> {
    sqlx::query_as("select id, key, name, color from projects where id = $1").bind(id).fetch_optional(ex).await
}

/// Блокирует проект до конца транзакции: изменения доски одного проекта идут по очереди.
/// Так два одновременных переноса не посчитают позиции по устаревшему списку.
pub async fn lock(conn: &mut PgConnection, id: Uuid) -> Result<Option<Project>, sqlx::Error> {
    sqlx::query_as("select id, key, name, color from projects where id = $1 for update")
        .bind(id)
        .fetch_optional(conn)
        .await
}

/// Следующий свободный номер задач проекта (WEB-159). Вызывать внутри транзакции после `lock`.
pub async fn next_number(conn: &mut PgConnection, id: Uuid) -> Result<i32, sqlx::Error> {
    sqlx::query_scalar("update projects set last_number = last_number + 1 where id = $1 returning last_number")
        .bind(id)
        .fetch_one(conn)
        .await
}
