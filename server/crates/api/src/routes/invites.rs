//! Приглашения в проект (docs/PROJECTS.md, раздел 1.2): администратор зовёт человека с существующим аккаунтом,
//! тот принимает или отклоняет.

use axum::{Json, extract::State, http::StatusCode};
use domain::projects::Role;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::project_dto::{CreateInvite, CreatedInviteDto, InviteDto};
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

/// Пригласить человека по e-mail (администратор). Аккаунт должен уже существовать.
#[utoipa::path(
    post,
    path = "/projects/{id}/invites",
    tag = "invites",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Проект")),
    request_body = CreateInvite,
    responses(
        (status = 201, description = "Приглашение создано", body = CreatedInviteDto),
        (status = 400, description = "Аккаунта с таким адресом нет или некорректная роль", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 403, description = "Нужны права администратора проекта", body = ErrorBody),
        (status = 404, description = "Нет такого проекта", body = ErrorBody),
        (status = 409, description = "Человек уже в проекте или уже приглашён", body = ErrorBody),
    )
)]
async fn create_invite(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(project_id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<CreateInvite>,
) -> ApiResult<(StatusCode, Json<CreatedInviteDto>)> {
    let role = match req.role.as_deref() {
        None => Role::Member,
        Some(raw) => Role::parse(raw).ok_or_else(|| ApiError::BadRequest("Роль: admin или member".into()))?,
    };
    let email = domain::auth::normalize_email(&req.email);

    let mut tx = state.pool.begin().await?;
    access::admin_locked(&mut tx, auth, project_id).await?;
    let user = db::users::find_by_email(&state.pool, &email)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Аккаунта с таким адресом нет".into()))?;
    if db::members::role_of(&mut *tx, project_id, user.id).await?.is_some() {
        return Err(ApiError::Conflict("Уже в проекте".into()));
    }
    if db::invites::pending(&mut *tx, project_id, user.id).await?.is_some() {
        return Err(ApiError::Conflict("Уже приглашён".into()));
    }
    let invite = db::invites::insert(&mut tx, project_id, user.id, auth.id, role.as_str()).await?;
    tx.commit().await?;
    events::note_user(user.id);
    Ok((StatusCode::CREATED, Json(invite.into())))
}

/// Мои приглашения, на которые я ещё не ответил
#[utoipa::path(
    get,
    path = "/invites",
    tag = "invites",
    security(("bearer" = [])),
    responses(
        (status = 200, description = "Ожидающие ответа приглашения от старых к новым", body = [InviteDto]),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
    )
)]
async fn my_invites(auth: AuthUser, State(state): State<AppState>) -> ApiResult<Json<Vec<InviteDto>>> {
    let list = db::invites::list_for_user(&state.pool, auth.id).await?;
    Ok(Json(list.into_iter().map(InviteDto::from).collect()))
}

/// Отозвать приглашение (администратор проекта)
#[utoipa::path(
    delete,
    path = "/invites/{id}",
    tag = "invites",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Приглашение")),
    responses(
        (status = 204, description = "Приглашение отозвано"),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 403, description = "Нужны права администратора проекта", body = ErrorBody),
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
    let invite = db::invites::get(&mut *tx, id).await?.ok_or(ApiError::NotFound)?;
    access::admin_locked(&mut tx, auth, invite.project_id).await?;
    let invite = db::invites::get_for_update(&mut tx, id).await?.ok_or(ApiError::NotFound)?;
    if invite.status != "pending" {
        return Err(ApiError::Conflict("Приглашение уже закрыто".into()));
    }
    db::invites::close(&mut tx, id, "revoked").await?;
    tx.commit().await?;
    events::note_user(invite.user_id);
    Ok(StatusCode::NO_CONTENT)
}

/// Принять приглашение: человек становится участником проекта с указанной ролью
#[utoipa::path(
    post,
    path = "/invites/{id}/accept",
    tag = "invites",
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
    if db::members::role_of(&mut *tx, invite.project_id, auth.id).await?.is_none() {
        db::members::add(&mut tx, invite.project_id, auth.id, &invite.role).await?;
    }
    db::invites::close(&mut tx, id, "accepted").await?;
    tx.commit().await?;
    // проект появляется у принявшего: событие должно дойти до него, хотя раньше он в проекте не состоял
    events::note_project(invite.project_id);
    events::note_user(auth.id);
    Ok(StatusCode::NO_CONTENT)
}

/// Отклонить приглашение
#[utoipa::path(
    post,
    path = "/invites/{id}/decline",
    tag = "invites",
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
    db::invites::close(&mut tx, id, "declined").await?;
    tx.commit().await?;
    events::note_project(invite.project_id);
    events::note_user(auth.id);
    Ok(StatusCode::NO_CONTENT)
}

/// Моё ожидающее приглашение (блокируется до конца транзакции). Чужое, закрытое или в архивный проект: «нет такого».
async fn pending_of(conn: &mut db::sqlx::PgConnection, auth: AuthUser, id: Uuid) -> ApiResult<db::invites::Invite> {
    let invite =
        db::invites::get_for_update(conn, id).await?.filter(|i| i.user_id == auth.id).ok_or(ApiError::NotFound)?;
    if invite.status != "pending" {
        return Err(ApiError::Conflict("Приглашение уже закрыто".into()));
    }
    if db::invites::project_archived(&mut *conn, invite.project_id).await? {
        return Err(ApiError::NotFound);
    }
    Ok(invite)
}
