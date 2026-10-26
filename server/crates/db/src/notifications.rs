//! Уведомления: человека назначили исполнителем или упомянули в комментарии (docs/OFFLINE-NOTIFY-SEARCH.md, раздел 2).
//!
//! Фонового процесса, который чистит старое, нет: при создании нового уведомления человека убираются его прочитанные
//! записи старше `READ_KEEP_DAYS` и всё, что сверх `KEEP_PER_USER` самых новых.

use sqlx::{PgConnection, PgExecutor};
use time::OffsetDateTime;
use uuid::Uuid;

/// Сколько дней прочитанное уведомление ещё лежит в списке
pub const READ_KEEP_DAYS: i32 = 30;
/// Сколько уведомлений хранится у одного человека, остальные (самые старые) убираются
pub const KEEP_PER_USER: i64 = 200;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Notification {
    pub id: Uuid,
    pub user_id: Uuid,
    /// assigned | mentioned
    pub kind: String,
    pub actor_id: Option<Uuid>,
    pub project_id: Uuid,
    pub task_id: Uuid,
    pub comment_id: Option<Uuid>,
    pub created_at: OffsetDateTime,
    pub read_at: Option<OffsetDateTime>,
}

/// Уведомление для списка: что за задача, какой проект, кто сделал и (для упоминания) что написал
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Entry {
    #[sqlx(flatten)]
    pub notification: Notification,
    pub task_number: i32,
    pub task_title: String,
    /// Ключ модуля, в чьём ряду нумеруется задача
    pub series_key: Option<String>,
    pub project_key: Option<String>,
    pub project_name: String,
    pub actor_name: Option<String>,
    pub comment_body: Option<String>,
}

const COLUMNS: &str = "n.id, n.user_id, n.kind::text as kind, n.actor_id, n.project_id, n.task_id, n.comment_id, \
                       n.created_at, n.read_at";

/// Назначили исполнителем. Прежнее непрочитанное «назначили» по этой задаче заменяется: если человека назначали,
/// снимали и назначали снова, в списке остаётся одно, свежее.
pub async fn insert_assigned(
    conn: &mut PgConnection,
    user_id: Uuid,
    actor_id: Uuid,
    project_id: Uuid,
    task_id: Uuid,
) -> Result<Notification, sqlx::Error> {
    sqlx::query(
        "delete from notifications where user_id = $1 and task_id = $2 and kind = 'assigned' and read_at is null",
    )
    .bind(user_id)
    .bind(task_id)
    .execute(&mut *conn)
    .await?;
    let created = sqlx::query_as(
        "insert into notifications (user_id, kind, actor_id, project_id, task_id) \
         values ($1, 'assigned', $2, $3, $4) \
         returning id, user_id, kind::text as kind, actor_id, project_id, task_id, comment_id, created_at, read_at",
    )
    .bind(user_id)
    .bind(actor_id)
    .bind(project_id)
    .bind(task_id)
    .fetch_one(&mut *conn)
    .await?;
    prune(conn, user_id).await?;
    Ok(created)
}

/// Упомянули в комментарии
pub async fn insert_mentioned(
    conn: &mut PgConnection,
    user_id: Uuid,
    actor_id: Uuid,
    project_id: Uuid,
    task_id: Uuid,
    comment_id: Uuid,
) -> Result<Notification, sqlx::Error> {
    let created = sqlx::query_as(
        "insert into notifications (user_id, kind, actor_id, project_id, task_id, comment_id) \
         values ($1, 'mentioned', $2, $3, $4, $5) \
         returning id, user_id, kind::text as kind, actor_id, project_id, task_id, comment_id, created_at, read_at",
    )
    .bind(user_id)
    .bind(actor_id)
    .bind(project_id)
    .bind(task_id)
    .bind(comment_id)
    .fetch_one(&mut *conn)
    .await?;
    prune(conn, user_id).await?;
    Ok(created)
}

/// Убирает у человека старое: прочитанное старше `READ_KEEP_DAYS` дней и всё сверх `KEEP_PER_USER` новейших
async fn prune(conn: &mut PgConnection, user_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "delete from notifications where user_id = $1 and read_at is not null \
         and read_at < now() - make_interval(days => $2)",
    )
    .bind(user_id)
    .bind(READ_KEEP_DAYS)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "delete from notifications where id in \
         (select id from notifications where user_id = $1 order by created_at desc, id desc offset $2)",
    )
    .bind(user_id)
    .bind(KEEP_PER_USER)
    .execute(conn)
    .await?;
    Ok(())
}

/// Уведомления человека, новые первыми. Видны только те, что относятся к проектам, где он всё ещё участник и которые
/// не в архиве: вышел из проекта, и его уведомления пропали (вернётся, и появятся снова).
pub async fn list<'e>(ex: impl PgExecutor<'e>, user_id: Uuid, limit: i64) -> Result<Vec<Entry>, sqlx::Error> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "select {COLUMNS}, t.number as task_number, t.title as task_title, \
                (select m.key from modules m where m.id = t.series_module_id) as series_key, \
                p.key as project_key, p.name as project_name, a.name as actor_name, c.body as comment_body \
         from notifications n \
         join project_members pm on pm.project_id = n.project_id and pm.user_id = n.user_id \
         join projects p on p.id = n.project_id and p.archived_at is null \
         join tasks t on t.id = n.task_id \
         left join users a on a.id = n.actor_id \
         left join comments c on c.id = n.comment_id \
         where n.user_id = $1 \
         order by n.created_at desc, n.id desc limit $2"
    )))
    .bind(user_id)
    .bind(limit)
    .fetch_all(ex)
    .await
}

/// Сколько уведомлений человека не прочитано (из видимых в списке)
pub async fn unread_count<'e>(ex: impl PgExecutor<'e>, user_id: Uuid) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "select count(*) from notifications n \
         join project_members pm on pm.project_id = n.project_id and pm.user_id = n.user_id \
         join projects p on p.id = n.project_id and p.archived_at is null \
         where n.user_id = $1 and n.read_at is null",
    )
    .bind(user_id)
    .fetch_one(ex)
    .await
}

/// Отмечает своё уведомление прочитанным. `false`, если такого нет у этого человека (чужое или несуществующее).
/// Повторная отметка ничего не меняет и тоже `true`.
pub async fn mark_read<'e>(ex: impl PgExecutor<'e>, user_id: Uuid, id: Uuid) -> Result<bool, sqlx::Error> {
    let found: Option<Uuid> = sqlx::query_scalar(
        "update notifications set read_at = coalesce(read_at, now()) where id = $1 and user_id = $2 returning id",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(ex)
    .await?;
    Ok(found.is_some())
}

/// Отмечает прочитанными все непрочитанные уведомления человека; возвращает, сколько их было
pub async fn mark_all_read<'e>(ex: impl PgExecutor<'e>, user_id: Uuid) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query("update notifications set read_at = now() where user_id = $1 and read_at is null")
        .bind(user_id)
        .execute(ex)
        .await?
        .rows_affected())
}
