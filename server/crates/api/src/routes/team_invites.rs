//! Приглашения в команду (docs/TEAMS.md, раздел 6): администратор команды зовёт человека с существующим аккаунтом, тот
//! принимает или отклоняет. Приглашения в команду и в её проект не связаны.

use axum::{Json, extract::State, http::StatusCode};
use db::team_invites::{PendingTeamInvite, TeamInvite, TeamInviteForUser};
use domain::projects::Role;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use crate::{
    access,
    error::{ApiError, ApiResult, ErrorBody},
    events,
    extract::{ApiJson, ApiPath, AuthUser},
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(create_invite))
        .routes(routes!(my_invites))
        .routes(routes!(revoke_invite))
        .routes(routes!(accept_invite))
        .routes(routes!(decline_invite))
}

// ===== Формы =====

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateTeamInvite {
    /// E-mail существующего аккаунта, регистр не важен
    #[schema(example = "artem@example.com")]
    pub email: String,
    /// admin | member; без него member
    #[schema(example = "member")]
    pub role: Option<String>,
}

/// Приглашение, только что созданное администратором
#[derive(Debug, Serialize, ToSchema)]
pub struct CreatedTeamInviteDto {
    pub id: Uuid,
    pub user_id: Uuid,
    pub role: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

impl From<TeamInvite> for CreatedTeamInviteDto {
    fn from(i: TeamInvite) -> Self {
        CreatedTeamInviteDto { id: i.id, user_id: i.user_id, role: i.role, created_at: i.created_at }
    }
}

/// Приглашение в команду, ожидающее ответа, глазами администратора команды
#[derive(Debug, Serialize, ToSchema)]
pub struct PendingTeamInviteDto {
    pub id: Uuid,
    pub user_id: Uuid,
    pub email: String,
    pub name: String,
    pub job: String,
    pub tone: i16,
    /// Роль, с которой человек войдёт: admin | member
    pub role: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

impl From<PendingTeamInvite> for PendingTeamInviteDto {
    fn from(p: PendingTeamInvite) -> Self {
        PendingTeamInviteDto {
            id: p.invite.id,
            user_id: p.invite.user_id,
            email: p.email,
            name: p.name,
            job: p.job,
            tone: p.tone,
            role: p.invite.role,
            created_at: p.invite.created_at,
        }
    }
}

/// Приглашение в команду глазами приглашённого
#[derive(Debug, Serialize, ToSchema)]
pub struct TeamInviteDto {
    pub id: Uuid,
    pub team_id: Uuid,
    pub team_name: String,
    /// Кто пригласил; пусто, если он удалён
    #[schema(nullable)]
    pub invited_by_name: Option<String>,
    /// Роль, с которой человек войдёт: admin | member
    pub role: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

impl From<TeamInviteForUser> for TeamInviteDto {
    fn from(i: TeamInviteForUser) -> Self {
        TeamInviteDto {
            id: i.invite.id,
            team_id: i.invite.team_id,
            team_name: i.team_name,
            invited_by_name: i.inviter_name,
            role: i.invite.role,
            created_at: i.invite.created_at,
        }
    }
}

// ===== Ручки =====

/// Пригласить человека в команду по e-mail (администратор команды). Аккаунт должен уже существовать.
#[utoipa::path(
    post,
    path = "/teams/{id}/invites",
    tag = "teams",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Команда")),
    request_body = CreateTeamInvite,
    responses(
        (status = 201, description = "Приглашение создано", body = CreatedTeamInviteDto),
        (status = 400, description = "Аккаунта с таким адресом нет или некорректная роль", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 403, description = "Нужны права администратора команды", body = ErrorBody),
        (status = 404, description = "Нет такой команды", body = ErrorBody),
        (status = 409, description = "Человек уже в команде или уже приглашён", body = ErrorBody),
    )
)]
async fn create_invite(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(team_id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<CreateTeamInvite>,
) -> ApiResult<(StatusCode, Json<CreatedTeamInviteDto>)> {
    let role = match req.role.as_deref() {
        None => Role::Member,
        Some(raw) => Role::parse(raw).ok_or_else(|| ApiError::BadRequest("Роль: admin или member".into()))?,
    };
    let email = domain::auth::normalize_email(&req.email);

    let mut tx = state.pool.begin().await?;
    access::team_admin(&mut *tx, auth, team_id).await?;
    db::teams::lock(&mut tx, team_id).await?;
    let user = db::users::find_by_email(&state.pool, &email)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Аккаунта с таким адресом нет".into()))?;
    if db::teams::member_role(&mut *tx, team_id, user.id).await?.is_some() {
        return Err(ApiError::Conflict("Уже в команде".into()));
    }
    if db::team_invites::pending(&mut *tx, team_id, user.id).await?.is_some() {
        return Err(ApiError::Conflict("Уже приглашён".into()));
    }
    let invite = db::team_invites::insert(&mut tx, team_id, user.id, auth.id, role.as_str()).await?;
    tx.commit().await?;
    events::note_user(user.id);
    Ok((StatusCode::CREATED, Json(invite.into())))
}

/// Мои приглашения в команды, на которые я ещё не ответил
#[utoipa::path(
    get,
    path = "/team-invites",
    tag = "teams",
    security(("bearer" = [])),
    responses(
        (status = 200, description = "Ожидающие ответа приглашения от старых к новым", body = [TeamInviteDto]),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
    )
)]
async fn my_invites(auth: AuthUser, State(state): State<AppState>) -> ApiResult<Json<Vec<TeamInviteDto>>> {
    let list = db::team_invites::list_for_user(&state.pool, auth.id).await?;
    Ok(Json(list.into_iter().map(TeamInviteDto::from).collect()))
}

/// Отозвать приглашение (администратор команды)
#[utoipa::path(
    delete,
    path = "/team-invites/{id}",
    tag = "teams",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Приглашение")),
    responses(
        (status = 204, description = "Приглашение отозвано"),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 403, description = "Нужны права администратора команды", body = ErrorBody),
        (status = 404, description = "Нет такого приглашения", body = ErrorBody),
        (status = 409, description = "Приглашение уже закрыто", body = ErrorBody),
    )
)]
async fn revoke_invite(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    let invite = db::team_invites::get(&mut *tx, id).await?.ok_or(ApiError::NotFound)?;
    access::team_admin(&mut *tx, auth, invite.team_id).await?;
    let invite = db::team_invites::get_for_update(&mut tx, id).await?.ok_or(ApiError::NotFound)?;
    if invite.status != "pending" {
        return Err(ApiError::Conflict("Приглашение уже закрыто".into()));
    }
    db::team_invites::close(&mut tx, id, "revoked").await?;
    tx.commit().await?;
    events::note_user(invite.user_id);
    Ok(StatusCode::NO_CONTENT)
}

/// Принять приглашение: человек становится членом команды с указанной ролью. Если он был гостем её проекта, гостем
/// он быть перестаёт, роль в проекте остаётся.
#[utoipa::path(
    post,
    path = "/team-invites/{id}/accept",
    tag = "teams",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Приглашение")),
    responses(
        (status = 204, description = "Приглашение принято"),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого приглашения среди моих", body = ErrorBody),
        (status = 409, description = "Приглашение уже закрыто", body = ErrorBody),
    )
)]
async fn accept_invite(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    let invite = pending_of(&mut tx, auth, id).await?;
    db::teams::lock(&mut tx, invite.team_id).await?;
    if db::teams::member_role(&mut *tx, invite.team_id, auth.id).await?.is_none() {
        db::teams::add_member(&mut tx, invite.team_id, auth.id, &invite.role).await?;
    }
    db::team_invites::close(&mut tx, id, "accepted").await?;
    tx.commit().await?;
    // команда появляется у принявшего: событие должно дойти до него, хотя раньше он в ней не состоял
    events::note_team(invite.team_id);
    events::note_user(auth.id);
    Ok(StatusCode::NO_CONTENT)
}

/// Отклонить приглашение
#[utoipa::path(
    post,
    path = "/team-invites/{id}/decline",
    tag = "teams",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Приглашение")),
    responses(
        (status = 204, description = "Приглашение отклонено"),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого приглашения среди моих", body = ErrorBody),
        (status = 409, description = "Приглашение уже закрыто", body = ErrorBody),
    )
)]
async fn decline_invite(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    let invite = pending_of(&mut tx, auth, id).await?;
    db::team_invites::close(&mut tx, id, "declined").await?;
    tx.commit().await?;
    events::note_team(invite.team_id);
    events::note_user(auth.id);
    Ok(StatusCode::NO_CONTENT)
}

/// Моё ожидающее приглашение (блокируется до конца транзакции). Чужое, закрытое или в архивную команду: «нет такого».
async fn pending_of(conn: &mut db::sqlx::PgConnection, auth: AuthUser, id: Uuid) -> ApiResult<TeamInvite> {
    let invite =
        db::team_invites::get_for_update(conn, id).await?.filter(|i| i.user_id == auth.id).ok_or(ApiError::NotFound)?;
    if invite.status != "pending" {
        return Err(ApiError::Conflict("Приглашение уже закрыто".into()));
    }
    if db::team_invites::team_archived(&mut *conn, invite.team_id).await? {
        return Err(ApiError::NotFound);
    }
    Ok(invite)
}
