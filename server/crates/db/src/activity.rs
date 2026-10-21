//! Лента активности. Запись делает сервер в той же транзакции, что и действие.

use sqlx::{PgConnection, PgExecutor};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Event {
    pub id: Uuid,
    pub actor_id: Uuid,
    pub project_id: Option<Uuid>,
    /// move | create | delete | comment | code | doc | release | file | module
    pub kind: String,
    pub target: String,
    pub text: String,
    pub created_at: OffsetDateTime,
}

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

/// События проекта от новых к старым: его собственные и события без проекта (вики и файлы библиотеки). Доступ к
/// проекту проверяет вызывающий. `actor` и `kinds` сужают выбор; `after` — место, после которого (то есть старше) продолжать: время события и его
/// идентификатор. Идентификатор разводит события с одинаковым временем.
pub async fn list<'e>(
    ex: impl PgExecutor<'e>,
    project_id: Uuid,
    actor: Option<Uuid>,
    kinds: Option<&[&str]>,
    after: Option<(OffsetDateTime, Uuid)>,
    limit: i64,
) -> Result<Vec<Event>, sqlx::Error> {
    let kinds: Option<Vec<String>> = kinds.map(|k| k.iter().map(|s| (*s).to_owned()).collect());
    sqlx::query_as(
        "select id, actor_id, project_id, kind::text as kind, target, text, created_at from activity \
         where ($1::uuid is null or actor_id = $1) \
           and ($2::text[] is null or kind::text = any($2)) \
           and ($3::timestamptz is null or (created_at, id) < ($3, $4::uuid)) \
           and (project_id is null or project_id = $6) \
         order by created_at desc, id desc limit $5",
    )
    .bind(actor)
    .bind(kinds)
    .bind(after.map(|a| a.0))
    .bind(after.map(|a| a.1))
    .bind(limit)
    .bind(project_id)
    .fetch_all(ex)
    .await
}
