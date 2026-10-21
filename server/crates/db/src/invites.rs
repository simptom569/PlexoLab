//! Приглашения в проект (docs/PROJECTS.md, раздел 1.2)

use sqlx::{PgConnection, PgExecutor};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Invite {
    pub id: Uuid,
    pub project_id: Uuid,
    /// Кого пригласили
    pub user_id: Uuid,
    pub invited_by: Option<Uuid>,
    /// admin | member: роль, с которой человек войдёт
    pub role: String,
    /// pending | accepted | declined | revoked
    pub status: String,
    pub created_at: OffsetDateTime,
}

/// Приглашение для приглашённого: проект и кто позвал
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct InviteForUser {
    #[sqlx(flatten)]
    pub invite: Invite,
    pub project_name: String,
    pub project_color: String,
    pub project_key: Option<String>,
    pub inviter_name: Option<String>,
}

/// Ожидающее приглашение для администратора проекта: кого позвали
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PendingInvite {
    #[sqlx(flatten)]
    pub invite: Invite,
    pub email: String,
    pub name: String,
    pub job: String,
    pub tone: i16,
}

macro_rules! select_invite {
    ($tail:literal) => {
        concat!(
            "select i.id, i.project_id, i.user_id, i.invited_by, i.role::text as role, i.status::text as status, \
             i.created_at from project_invites i ",
            $tail
        )
    };
}

pub async fn get<'e>(ex: impl PgExecutor<'e>, id: Uuid) -> Result<Option<Invite>, sqlx::Error> {
    sqlx::query_as(select_invite!("where i.id = $1")).bind(id).fetch_optional(ex).await
}

/// Блокирует приглашение до конца транзакции: принять и отозвать одновременно не получится
pub async fn get_for_update(conn: &mut PgConnection, id: Uuid) -> Result<Option<Invite>, sqlx::Error> {
    sqlx::query_as(select_invite!("where i.id = $1 for update of i")).bind(id).fetch_optional(conn).await
}

/// Ожидающее приглашение этого человека в проект, если есть
pub async fn pending<'e>(
    ex: impl PgExecutor<'e>,
    project_id: Uuid,
    user_id: Uuid,
) -> Result<Option<Invite>, sqlx::Error> {
    sqlx::query_as(select_invite!("where i.project_id = $1 and i.user_id = $2 and i.status = 'pending'"))
        .bind(project_id)
        .bind(user_id)
        .fetch_optional(ex)
        .await
}

pub async fn insert(
    conn: &mut PgConnection,
    project_id: Uuid,
    user_id: Uuid,
    invited_by: Uuid,
    role: &str,
) -> Result<Invite, sqlx::Error> {
    sqlx::query_as(
        "insert into project_invites (project_id, user_id, invited_by, role) values ($1, $2, $3, $4::project_role) \
         returning id, project_id, user_id, invited_by, role::text as role, status::text as status, created_at",
    )
    .bind(project_id)
    .bind(user_id)
    .bind(invited_by)
    .bind(role)
    .fetch_one(conn)
    .await
}

/// Закрывает приглашение: accepted | declined | revoked
pub async fn close(conn: &mut PgConnection, id: Uuid, status: &str) -> Result<(), sqlx::Error> {
    sqlx::query("update project_invites set status = $2::invite_status, answered_at = now() where id = $1")
        .bind(id)
        .bind(status)
        .execute(conn)
        .await?;
    Ok(())
}

/// Приглашения человека, на которые он ещё не ответил, от старых к новым. Приглашения в архивные проекты скрыты.
pub async fn list_for_user<'e>(ex: impl PgExecutor<'e>, user_id: Uuid) -> Result<Vec<InviteForUser>, sqlx::Error> {
    sqlx::query_as(
        "select i.id, i.project_id, i.user_id, i.invited_by, i.role::text as role, i.status::text as status, i.created_at, \
                p.name as project_name, p.color as project_color, p.key as project_key, u.name as inviter_name \
         from project_invites i \
         join projects p on p.id = i.project_id \
         left join users u on u.id = i.invited_by \
         where i.user_id = $1 and i.status = 'pending' and p.archived_at is null \
         order by i.created_at, i.id",
    )
    .bind(user_id)
    .fetch_all(ex)
    .await
}

/// В архиве ли проект приглашения (в архивный проект принять приглашение нельзя)
pub async fn project_archived<'e>(ex: impl PgExecutor<'e>, project_id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select coalesce((select archived_at is not null from projects where id = $1), true)")
        .bind(project_id)
        .fetch_one(ex)
        .await
}

/// Сколько приглашений ждёт ответа человека (для счётчика)
pub async fn count_for_user<'e>(ex: impl PgExecutor<'e>, user_id: Uuid) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "select count(*) from project_invites i join projects p on p.id = i.project_id \
         where i.user_id = $1 and i.status = 'pending' and p.archived_at is null",
    )
    .bind(user_id)
    .fetch_one(ex)
    .await
}

/// Ожидающие приглашения проекта для его администратора
pub async fn list_pending_for_project<'e>(
    ex: impl PgExecutor<'e>,
    project_id: Uuid,
) -> Result<Vec<PendingInvite>, sqlx::Error> {
    sqlx::query_as(
        "select i.id, i.project_id, i.user_id, i.invited_by, i.role::text as role, i.status::text as status, i.created_at, \
                u.email, u.name, u.role as job, u.tone \
         from project_invites i join users u on u.id = i.user_id \
         where i.project_id = $1 and i.status = 'pending' \
         order by i.created_at, i.id",
    )
    .bind(project_id)
    .fetch_all(ex)
    .await
}
