//! Приглашения в команду (docs/TEAMS.md, раздел 6). Устроены как приглашения в проект: администратор зовёт человека с
//! существующим аккаунтом, тот принимает или отклоняет.

use sqlx::{PgConnection, PgExecutor};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct TeamInvite {
    pub id: Uuid,
    pub team_id: Uuid,
    /// Кого пригласили; пусто, пока человек не зарегистрирован (тогда есть `email`)
    pub user_id: Option<Uuid>,
    /// Адрес, на который приглашение ждёт регистрации; у приглашения существующему аккаунту пусто
    pub email: Option<String>,
    pub invited_by: Option<Uuid>,
    /// admin | member: роль, с которой человек войдёт
    pub role: String,
    /// pending | accepted | declined | revoked
    pub status: String,
    pub created_at: OffsetDateTime,
}

/// Приглашение для приглашённого: команда и кто позвал
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct TeamInviteForUser {
    #[sqlx(flatten)]
    pub invite: TeamInvite,
    pub team_name: String,
    pub inviter_name: Option<String>,
}

/// Ожидающее приглашение для администратора команды: кого позвали
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PendingTeamInvite {
    #[sqlx(flatten)]
    pub invite: TeamInvite,
    /// Адрес приглашённого (у зарегистрированного его адрес из аккаунта)
    pub person_email: String,
    /// Имя; пока аккаунта нет, вместо него адрес
    pub name: String,
    pub job: String,
    pub tone: i16,
    /// Есть ли уже аккаунт с этим адресом
    pub registered: bool,
}

macro_rules! select_invite {
    ($tail:literal) => {
        concat!(
            "select i.id, i.team_id, i.user_id, i.email, i.invited_by, i.role::text as role, i.status::text as status, \
             i.created_at from team_invites i ",
            $tail
        )
    };
}

pub async fn get<'e>(ex: impl PgExecutor<'e>, id: Uuid) -> Result<Option<TeamInvite>, sqlx::Error> {
    sqlx::query_as(select_invite!("where i.id = $1")).bind(id).fetch_optional(ex).await
}

/// Блокирует приглашение до конца транзакции: принять и отозвать одновременно не получится
pub async fn get_for_update(conn: &mut PgConnection, id: Uuid) -> Result<Option<TeamInvite>, sqlx::Error> {
    sqlx::query_as(select_invite!("where i.id = $1 for update of i")).bind(id).fetch_optional(conn).await
}

/// Ожидающее приглашение этого человека в команду, если есть
pub async fn pending<'e>(
    ex: impl PgExecutor<'e>,
    team_id: Uuid,
    user_id: Uuid,
) -> Result<Option<TeamInvite>, sqlx::Error> {
    sqlx::query_as(select_invite!("where i.team_id = $1 and i.user_id = $2 and i.status = 'pending'"))
        .bind(team_id)
        .bind(user_id)
        .fetch_optional(ex)
        .await
}

/// Ожидающее приглашение на этот адрес (аккаунта с ним ещё нет), если есть
pub async fn pending_by_email<'e>(
    ex: impl PgExecutor<'e>,
    team_id: Uuid,
    email: &str,
) -> Result<Option<TeamInvite>, sqlx::Error> {
    sqlx::query_as(select_invite!("where i.team_id = $1 and i.email = $2 and i.status = 'pending'"))
        .bind(team_id)
        .bind(email)
        .fetch_optional(ex)
        .await
}

pub async fn insert(
    conn: &mut PgConnection,
    team_id: Uuid,
    user_id: Uuid,
    invited_by: Uuid,
    role: &str,
) -> Result<TeamInvite, sqlx::Error> {
    sqlx::query_as(
        "insert into team_invites (team_id, user_id, invited_by, role) values ($1, $2, $3, $4::team_role) \
         returning id, team_id, user_id, email, invited_by, role::text as role, status::text as status, created_at",
    )
    .bind(team_id)
    .bind(user_id)
    .bind(invited_by)
    .bind(role)
    .fetch_one(conn)
    .await
}

/// Приглашение на адрес, у которого ещё нет аккаунта: ждёт регистрации (миграция 0019)
pub async fn insert_for_email(
    conn: &mut PgConnection,
    team_id: Uuid,
    email: &str,
    invited_by: Uuid,
    role: &str,
) -> Result<TeamInvite, sqlx::Error> {
    sqlx::query_as(
        "insert into team_invites (team_id, email, invited_by, role) values ($1, $2, $3, $4::team_role) \
         returning id, team_id, user_id, email, invited_by, role::text as role, status::text as status, created_at",
    )
    .bind(team_id)
    .bind(email)
    .bind(invited_by)
    .bind(role)
    .fetch_one(conn)
    .await
}

/// Закрывает приглашение: accepted | declined | revoked
pub async fn close(conn: &mut PgConnection, id: Uuid, status: &str) -> Result<(), sqlx::Error> {
    sqlx::query("update team_invites set status = $2::invite_status, answered_at = now() where id = $1")
        .bind(id)
        .bind(status)
        .execute(conn)
        .await?;
    Ok(())
}

/// Приглашения человека, на которые он ещё не ответил, от старых к новым. Приглашения в архивные команды скрыты.
pub async fn list_for_user<'e>(ex: impl PgExecutor<'e>, user_id: Uuid) -> Result<Vec<TeamInviteForUser>, sqlx::Error> {
    sqlx::query_as(
        "select i.id, i.team_id, i.user_id, i.email, i.invited_by, i.role::text as role, i.status::text as status, \
                i.created_at, t.name as team_name, u.name as inviter_name \
         from team_invites i \
         join teams t on t.id = i.team_id \
         left join users u on u.id = i.invited_by \
         where i.user_id = $1 and i.status = 'pending' and t.archived_at is null \
         order by i.created_at, i.id",
    )
    .bind(user_id)
    .fetch_all(ex)
    .await
}

/// В архиве ли команда приглашения (в архивную команду принять приглашение нельзя)
pub async fn team_archived<'e>(ex: impl PgExecutor<'e>, team_id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select coalesce((select archived_at is not null from teams where id = $1), true)")
        .bind(team_id)
        .fetch_one(ex)
        .await
}

/// Ожидающие приглашения команды для её администратора
pub async fn list_pending_for_team<'e>(
    ex: impl PgExecutor<'e>,
    team_id: Uuid,
) -> Result<Vec<PendingTeamInvite>, sqlx::Error> {
    sqlx::query_as(
        "select i.id, i.team_id, i.user_id, i.email, i.invited_by, i.role::text as role, i.status::text as status, \
                i.created_at, coalesce(u.email, i.email) as person_email, coalesce(u.name, i.email) as name, \
                coalesce(u.role, '') as job, coalesce(u.tone, 0::smallint) as tone, (i.user_id is not null) as registered \
         from team_invites i left join users u on u.id = i.user_id \
         where i.team_id = $1 and i.status = 'pending' \
         order by i.created_at, i.id",
    )
    .bind(team_id)
    .fetch_all(ex)
    .await
}
