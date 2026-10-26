//! Участники проектов и их роли (docs/PROJECTS.md, раздел 1)

use sqlx::{PgConnection, PgExecutor};
use time::OffsetDateTime;
use uuid::Uuid;

/// Участник проекта вместе со сведениями об аккаунте
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Member {
    pub user_id: Uuid,
    pub email: String,
    pub name: String,
    /// Подпись под именем («Frontend»)
    pub job: String,
    pub tone: i16,
    pub is_admin: bool,
    /// admin | member
    pub role: String,
    pub joined_at: OffsetDateTime,
}

/// Участники проекта: сначала администраторы, потом по времени входа
pub async fn list<'e>(ex: impl PgExecutor<'e>, project_id: Uuid) -> Result<Vec<Member>, sqlx::Error> {
    sqlx::query_as(
        "select u.id as user_id, u.email, u.name, u.role as job, u.tone, u.is_admin, m.role::text as role, \
                m.created_at as joined_at \
         from project_members m join users u on u.id = m.user_id \
         where m.project_id = $1 \
         order by (m.role = 'admin') desc, m.created_at, u.id",
    )
    .bind(project_id)
    .fetch_all(ex)
    .await
}

/// Сколько из этих людей участники проекта (повторы в `user_ids` не считаются дважды)
pub async fn count_of<'e>(ex: impl PgExecutor<'e>, project_id: Uuid, user_ids: &[Uuid]) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("select count(*) from project_members where project_id = $1 and user_id = any($2)")
        .bind(project_id)
        .bind(user_ids)
        .fetch_one(ex)
        .await
}

/// Роль человека в проекте (`admin` | `member`), если он участник
pub async fn role_of<'e>(
    ex: impl PgExecutor<'e>,
    project_id: Uuid,
    user_id: Uuid,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("select role::text from project_members where project_id = $1 and user_id = $2")
        .bind(project_id)
        .bind(user_id)
        .fetch_optional(ex)
        .await
}

pub async fn add(conn: &mut PgConnection, project_id: Uuid, user_id: Uuid, role: &str) -> Result<(), sqlx::Error> {
    sqlx::query("insert into project_members (project_id, user_id, role) values ($1, $2, $3::project_role)")
        .bind(project_id)
        .bind(user_id)
        .bind(role)
        .execute(conn)
        .await?;
    Ok(())
}

/// Меняет роль; `false`, если человек не участник
pub async fn set_role(
    conn: &mut PgConnection,
    project_id: Uuid,
    user_id: Uuid,
    role: &str,
) -> Result<bool, sqlx::Error> {
    let done = sqlx::query("update project_members set role = $3::project_role where project_id = $1 and user_id = $2")
        .bind(project_id)
        .bind(user_id)
        .bind(role)
        .execute(conn)
        .await?;
    Ok(done.rows_affected() > 0)
}

/// Убирает участника; `false`, если его там не было. Задачи и комментарии остаются за ним по имени.
pub async fn remove(conn: &mut PgConnection, project_id: Uuid, user_id: Uuid) -> Result<bool, sqlx::Error> {
    let done = sqlx::query("delete from project_members where project_id = $1 and user_id = $2")
        .bind(project_id)
        .bind(user_id)
        .execute(conn)
        .await?;
    Ok(done.rows_affected() > 0)
}

/// Сколько администраторов в проекте (не считая глобальных админов, которые не обязаны быть участниками)
pub async fn admin_count<'e>(ex: impl PgExecutor<'e>, project_id: Uuid) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("select count(*) from project_members where project_id = $1 and role = 'admin'")
        .bind(project_id)
        .fetch_one(ex)
        .await
}

/// Проекты, участником которых человек является (для рассылки событий). Глобальные админы тоже получают все.
pub async fn project_ids<'e>(ex: impl PgExecutor<'e>, user_id: Uuid) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        "select p.id from projects p join users u on u.id = $1 \
         where u.is_admin or exists (select 1 from project_members m where m.project_id = p.id and m.user_id = u.id)",
    )
    .bind(user_id)
    .fetch_all(ex)
    .await
}

/// Участник ли человек проекта (или глобальный админ)
pub async fn can_see<'e>(ex: impl PgExecutor<'e>, project_id: Uuid, user_id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "select exists (select 1 from users u where u.id = $2 and (u.is_admin or exists \
           (select 1 from project_members m where m.project_id = $1 and m.user_id = u.id)))",
    )
    .bind(project_id)
    .bind(user_id)
    .fetch_one(ex)
    .await
}
