use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Tag {
    pub id: Uuid,
    pub label: String,
    /// Индекс цвета в TONES (0..7)
    pub tone: i16,
}

/// Метки в порядке создания
pub async fn list<'e>(ex: impl PgExecutor<'e>) -> Result<Vec<Tag>, sqlx::Error> {
    sqlx::query_as("select id, label, tone from tags order by seq").fetch_all(ex).await
}

/// Метка с таким названием, регистр не важен
pub async fn find_by_label<'e>(ex: impl PgExecutor<'e>, label: &str) -> Result<Option<Tag>, sqlx::Error> {
    sqlx::query_as("select id, label, tone from tags where lower(label) = lower($1)")
        .bind(label)
        .fetch_optional(ex)
        .await
}

/// Новая метка. Без `tone` цвет берётся по кругу от числа существующих меток.
/// Если такая метка успела появиться, вернётся ошибка уникальности.
pub async fn insert(conn: &mut PgConnection, label: &str, tone: Option<i16>) -> Result<Tag, sqlx::Error> {
    sqlx::query_as(
        "insert into tags (label, tone) \
         values ($1, coalesce($2, ((select count(*) from tags) % 8)::smallint)) returning id, label, tone",
    )
    .bind(label)
    .bind(tone)
    .fetch_one(conn)
    .await
}

/// Удаляет метку, с задач она снимается каскадом. Возвращает, была ли такая.
pub async fn delete(conn: &mut PgConnection, id: Uuid) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("delete from tags where id = $1").bind(id).execute(conn).await?.rows_affected() > 0)
}

/// Сколько из `ids` существует (чтобы проверить набор меток задачи)
pub async fn count_existing<'e>(ex: impl PgExecutor<'e>, ids: &[Uuid]) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("select count(*) from tags where id = any($1)").bind(ids).fetch_one(ex).await
}
