//! Лента активности. Запись делает сервер в той же транзакции, что и действие.

use sqlx::PgConnection;
use uuid::Uuid;

/// Тип события: move | create | delete | comment | code | doc | release | file | module
pub async fn insert(
    conn: &mut PgConnection,
    actor_id: Uuid,
    project_id: Option<Uuid>,
    kind: &str,
    target: &str,
    text: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into activity (actor_id, project_id, kind, target, text) values ($1, $2, $3::act_kind, $4, $5)",
    )
    .bind(actor_id)
    .bind(project_id)
    .bind(kind)
    .bind(target)
    .bind(text)
    .execute(conn)
    .await?;
    Ok(())
}
