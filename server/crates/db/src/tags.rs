//! Метки проекта: у каждого проекта свой список (docs/PROJECTS.md, раздел 2)

use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Tag {
    pub id: Uuid,
    pub project_id: Uuid,
    pub label: String,
    /// Индекс цвета в TONES (0..7)
    pub tone: i16,
}

/// Метки проекта в порядке создания
pub async fn list<'e>(ex: impl PgExecutor<'e>, project_id: Uuid) -> Result<Vec<Tag>, sqlx::Error> {
    sqlx::query_as("select id, project_id, label, tone from tags where project_id = $1 order by seq")
        .bind(project_id)
        .fetch_all(ex)
        .await
}

pub async fn get<'e>(ex: impl PgExecutor<'e>, id: Uuid) -> Result<Option<Tag>, sqlx::Error> {
    sqlx::query_as("select id, project_id, label, tone from tags where id = $1").bind(id).fetch_optional(ex).await
}

/// Метка проекта с таким названием, регистр не важен
pub async fn find_by_label<'e>(
    ex: impl PgExecutor<'e>,
    project_id: Uuid,
    label: &str,
) -> Result<Option<Tag>, sqlx::Error> {
    sqlx::query_as("select id, project_id, label, tone from tags where project_id = $1 and lower(label) = lower($2)")
        .bind(project_id)
        .bind(label)
        .fetch_optional(ex)
        .await
}

/// Новая метка проекта. Без `tone` цвет берётся по кругу от числа меток проекта.
/// Если такая метка успела появиться, вернётся ошибка уникальности.
pub async fn insert(
    conn: &mut PgConnection,
    project_id: Uuid,
    label: &str,
    tone: Option<i16>,
) -> Result<Tag, sqlx::Error> {
    sqlx::query_as(
        "insert into tags (project_id, label, tone) \
         values ($1, $2, coalesce($3, ((select count(*) from tags where project_id = $1) % 8)::smallint)) \
         returning id, project_id, label, tone",
    )
    .bind(project_id)
    .bind(label)
    .bind(tone)
    .fetch_one(conn)
    .await
}

/// Что меняется у метки; `None`: не трогать
#[derive(Debug, Clone, Default)]
pub struct TagPatch {
    pub label: Option<String>,
    pub tone: Option<i16>,
}

pub async fn update(conn: &mut PgConnection, id: Uuid, p: &TagPatch) -> Result<Tag, sqlx::Error> {
    sqlx::query_as(
        "update tags set label = coalesce($2, label), tone = coalesce($3, tone) where id = $1 \
         returning id, project_id, label, tone",
    )
    .bind(id)
    .bind(p.label.as_deref())
    .bind(p.tone)
    .fetch_one(conn)
    .await
}

/// Удаляет метку, с задач она снимается каскадом. Возвращает, была ли такая.
pub async fn delete(conn: &mut PgConnection, id: Uuid) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("delete from tags where id = $1").bind(id).execute(conn).await?.rows_affected() > 0)
}

/// На скольких задачах стоит метка
pub async fn usage<'e>(ex: impl PgExecutor<'e>, id: Uuid) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("select count(*) from task_tags where tag_id = $1").bind(id).fetch_one(ex).await
}

/// Сколько из `ids` существует среди меток этого проекта (чтобы проверить набор меток задачи)
pub async fn count_in_project<'e>(ex: impl PgExecutor<'e>, project_id: Uuid, ids: &[Uuid]) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("select count(*) from tags where project_id = $1 and id = any($2)")
        .bind(project_id)
        .bind(ids)
        .fetch_one(ex)
        .await
}
