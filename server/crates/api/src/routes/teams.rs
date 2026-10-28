//! Команды (docs/TEAMS.md): список, создание, правка, архив, состав и роли, выход и исключение, список всех команд для
//! администратора сервера. Приглашения в команду лежат в `team_invites`, вики и файлы команды в `wiki` и `files`.

use axum::{Json, extract::State, http::StatusCode};
use domain::{
    projects::Role,
    teams::{self, MAX_NAME_LEN},
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::team_invites::PendingTeamInviteDto;
use crate::{
    access::{self, TeamAccess},
    error::{ApiError, ApiResult, ErrorBody},
    events,
    extract::{ApiJson, ApiPath, ApiQuery, AuthUser},
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_teams, create_team))
        .routes(routes!(get_team, update_team))
        .routes(routes!(archive_team))
        .routes(routes!(restore_team))
        .routes(routes!(list_members))
        .routes(routes!(update_member, remove_member))
        .routes(routes!(leave_team))
        .routes(routes!(admin_teams))
}

fn bad(message: impl Into<String>) -> ApiError {
    ApiError::BadRequest(message.into())
}

// ===== Формы =====

/// Команда глазами текущего человека
#[derive(Debug, Serialize, ToSchema)]
pub struct TeamDto {
    pub id: Uuid,
    #[schema(example = "Dream Team")]
    pub name: String,
    /// Личная команда «Личное»: её нельзя архивировать
    pub personal: bool,
    /// Это моя личная команда: владелец из неё не выходит и его нельзя убрать (в чужое «Личное» меня могли позвать)
    pub owner: bool,
    /// Моя роль в команде: admin | member. Пусто, если я здесь гость.
    #[schema(example = "member", nullable)]
    pub role: Option<String>,
    /// Я здесь гость: участник проекта этой команды без членства в ней
    pub guest: bool,
    /// Я могу читать вики и библиотеку файлов команды
    pub wiki: bool,
    /// Команда в архиве (такие приходят только в списке `?archived=true`)
    pub archived: bool,
    /// Гости проектов команды могут читать её вики. Видят только члены команды.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guests_read_wiki: Option<bool>,
}

impl From<db::teams::TeamForUser> for TeamDto {
    fn from(found: db::teams::TeamForUser) -> Self {
        TeamDto::from(TeamAccess::from(found))
    }
}

impl From<TeamAccess> for TeamDto {
    fn from(access: TeamAccess) -> Self {
        TeamDto {
            id: access.team.id,
            name: access.team.name.clone(),
            personal: access.team.personal_for.is_some(),
            owner: access.owner,
            role: access.role.map(|r| r.as_str().to_owned()),
            guest: access.guest,
            wiki: access.can_read_wiki(),
            archived: access.team.archived,
            guests_read_wiki: access.is_member().then_some(access.team.guests_read_wiki),
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateTeam {
    /// От 1 до 60 символов; названия команд не уникальны
    #[schema(example = "Веб")]
    pub name: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateTeam {
    pub name: Option<String>,
    /// Гости проектов команды могут читать её вики и библиотеку (по умолчанию нет)
    pub guests_read_wiki: Option<bool>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateTeamMember {
    /// admin | member
    #[schema(example = "admin")]
    pub role: String,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct TeamsQuery {
    /// `true`: архивные команды, которыми человек управляет (вернуть из архива может только администратор)
    #[serde(default)]
    pub archived: bool,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct AdminTeamsQuery {
    /// Часть названия команды или имени, e-mail владельца «Личного»; без неё все команды
    pub q: Option<String>,
}

/// Член команды
#[derive(Debug, Serialize, ToSchema)]
pub struct TeamMemberDto {
    pub user_id: Uuid,
    /// Пусто, если вам его видеть не положено: e-mail членов команды видит только её администратор (и каждый свой)
    pub email: String,
    pub name: String,
    /// Подпись под именем («Frontend»)
    pub job: String,
    pub tone: i16,
    /// Роль в команде: admin | member
    #[schema(example = "member")]
    pub role: String,
    #[serde(with = "time::serde::rfc3339")]
    pub joined_at: OffsetDateTime,
}

/// Состав команды; ожидающие приглашения видит только администратор (у остальных список пуст)
#[derive(Debug, Serialize, ToSchema)]
pub struct TeamMembersDto {
    pub members: Vec<TeamMemberDto>,
    pub invites: Vec<PendingTeamInviteDto>,
}

/// Команда в списке «Все команды сервера»
#[derive(Debug, Serialize, ToSchema)]
pub struct AdminTeamDto {
    pub id: Uuid,
    pub name: String,
    /// Личная команда «Личное»
    pub personal: bool,
    /// Чьё «Личное» (имя владельца)
    #[schema(nullable)]
    pub owner_name: Option<String>,
    pub archived: bool,
    pub member_count: i64,
    pub project_count: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

// ===== Мои команды =====

/// Мои команды: те, где я член («Личное» первой), и те, где я только гость. Архивные не показываются; с
/// `?archived=true` приходят архивные команды, которыми я управляю.
#[utoipa::path(
    get,
    path = "/teams",
    tag = "teams",
    security(("bearer" = [])),
    params(TeamsQuery),
    responses(
        (status = 200, description = "Команды человека", body = [TeamDto]),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
    )
)]
async fn list_teams(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiQuery(query): ApiQuery<TeamsQuery>,
) -> ApiResult<Json<Vec<TeamDto>>> {
    let teams = if query.archived {
        db::teams::list_archived_for_admin(&state.pool, auth.id).await?
    } else {
        db::teams::list_for_user(&state.pool, auth.id).await?
    };
    Ok(Json(teams.into_iter().map(TeamDto::from).collect()))
}

/// Новая команда. Создатель становится её администратором. Один человек создаёт не больше пяти обычных команд («Личное»
/// не считается; число меняет настройка сервера), архивные тоже в счёте.
#[utoipa::path(
    post,
    path = "/teams",
    tag = "teams",
    security(("bearer" = [])),
    request_body = CreateTeam,
    responses(
        (status = 201, description = "Команда создана", body = TeamDto),
        (status = 400, description = "Некорректное название", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 409, description = "Достигнут предел числа команд", body = ErrorBody),
    )
)]
async fn create_team(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiJson(req): ApiJson<CreateTeam>,
) -> ApiResult<(StatusCode, Json<TeamDto>)> {
    let name = teams::clean_name(&req.name).ok_or_else(|| bad(format!("Название: от 1 до {MAX_NAME_LEN} символов")))?;
    let mut tx = state.pool.begin().await?;
    // два одновременных запроса не должны проскочить лимит вдвоём: считаем под блокировкой строки человека
    db::teams::lock_creator(&mut tx, auth.id).await?;
    let created = db::teams::count_created(&mut *tx, auth.id).await?;
    if created >= i64::from(state.max_teams_per_user) {
        return Err(ApiError::Conflict(format!(
            "Можно создать не больше {} команд. Лишнюю не получится удалить, но можно использовать готовую",
            state.max_teams_per_user
        )));
    }
    let team = db::teams::insert(&mut tx, &name, auth.id).await?;
    tx.commit().await?;
    events::note_team(team.id);
    let found = db::teams::for_user(&state.pool, team.id, auth.id).await?.ok_or(ApiError::NotFound)?;
    Ok((StatusCode::CREATED, Json(found.into())))
}

/// Команда с настройками. Только для членов: гость и посторонний команды «не видят».
#[utoipa::path(
    get,
    path = "/teams/{id}",
    tag = "teams",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Команда")),
    responses(
        (status = 200, description = "Команда", body = TeamDto),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такой команды или вы не её член", body = ErrorBody),
    )
)]
async fn get_team(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<Json<TeamDto>> {
    Ok(Json(access::team_member(&state.pool, auth, id).await?.into()))
}

/// Название команды и настройка «Гости проектов могут читать вики команды» (администратор команды)
#[utoipa::path(
    patch,
    path = "/teams/{id}",
    tag = "teams",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Команда")),
    request_body = UpdateTeam,
    responses(
        (status = 200, description = "Команда после изменений", body = TeamDto),
        (status = 400, description = "Некорректное название", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 403, description = "Нужны права администратора команды", body = ErrorBody),
        (status = 404, description = "Нет такой команды", body = ErrorBody),
    )
)]
async fn update_team(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<UpdateTeam>,
) -> ApiResult<Json<TeamDto>> {
    let name = req
        .name
        .as_deref()
        .map(|raw| teams::clean_name(raw).ok_or_else(|| bad(format!("Название: от 1 до {MAX_NAME_LEN} символов"))))
        .transpose()?;
    let mut tx = state.pool.begin().await?;
    let access = access::team_admin(&mut *tx, auth, id).await?;
    let team =
        db::teams::update(&mut tx, id, &db::teams::TeamPatch { name, guests_read_wiki: req.guests_read_wiki }).await?;
    // гость узнаёт, что вики ему открыли или закрыли, только по личному событию: сам он в аудиторию команды не входит
    if req.guests_read_wiki.is_some_and(|on| on != access.team.guests_read_wiki) {
        for guest in db::teams::guest_ids(&mut *tx, id).await? {
            events::note_user(guest);
        }
    }
    tx.commit().await?;
    Ok(Json(TeamAccess { team, ..access }.into()))
}

/// Убрать команду из списков, данные остаются (администратор команды). «Личное» архивировать нельзя.
#[utoipa::path(
    post,
    path = "/teams/{id}/archive",
    tag = "teams",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Команда")),
    responses(
        (status = 200, description = "Команда в архиве", body = TeamDto),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 403, description = "Нужны права администратора команды", body = ErrorBody),
        (status = 404, description = "Нет такой команды", body = ErrorBody),
        (status = 409, description = "Личную команду архивировать нельзя", body = ErrorBody),
    )
)]
async fn archive_team(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<Json<TeamDto>> {
    let mut tx = state.pool.begin().await?;
    let access = access::team_admin(&mut *tx, auth, id).await?;
    if access.team.personal_for.is_some() {
        return Err(ApiError::Conflict("«Личное» архивировать нельзя".into()));
    }
    db::teams::lock(&mut tx, id).await?;
    let team = db::teams::set_archived(&mut tx, id, true).await?;
    note_everyone_of(&mut tx, id).await?;
    tx.commit().await?;
    Ok(Json(TeamAccess { team, ..access }.into()))
}

/// Вернуть команду из архива (администратор команды)
#[utoipa::path(
    post,
    path = "/teams/{id}/restore",
    tag = "teams",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Команда")),
    responses(
        (status = 200, description = "Команда возвращена", body = TeamDto),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 403, description = "Нужны права администратора команды", body = ErrorBody),
        (status = 404, description = "Нет такой команды", body = ErrorBody),
    )
)]
async fn restore_team(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<Json<TeamDto>> {
    let mut tx = state.pool.begin().await?;
    let access = access::team_admin_incl_archived(&mut *tx, auth, id).await?;
    db::teams::lock(&mut tx, id).await?;
    let team = db::teams::set_archived(&mut tx, id, false).await?;
    note_everyone_of(&mut tx, id).await?;
    tx.commit().await?;
    Ok(Json(TeamAccess { team, ..access }.into()))
}

/// Все члены и гости команды получают личное событие: архив скрывает и возвращает команду целиком, а в её аудиторию
/// они после этого уже (или ещё) не входят
async fn note_everyone_of(conn: &mut db::sqlx::PgConnection, team_id: Uuid) -> ApiResult<()> {
    for user in db::teams::member_ids(&mut *conn, team_id).await? {
        events::note_user(user);
    }
    for user in db::teams::guest_ids(&mut *conn, team_id).await? {
        events::note_user(user);
    }
    Ok(())
}

// ===== Состав =====

/// Состав команды. Только для членов; приглашения, которые ещё ждут ответа, и e-mail членов видит администратор.
#[utoipa::path(
    get,
    path = "/teams/{id}/members",
    tag = "teams",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Команда")),
    responses(
        (status = 200, description = "Члены команды и ожидающие приглашения", body = TeamMembersDto),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такой команды или вы не её член", body = ErrorBody),
    )
)]
async fn list_members(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<Json<TeamMembersDto>> {
    let mut conn = state.pool.acquire().await?;
    let access = access::team_member(&mut *conn, auth, id).await?;
    let members = db::teams::members(&mut *conn, id).await?;
    let invites =
        if access.is_admin() { db::team_invites::list_pending_for_team(&mut *conn, id).await? } else { Vec::new() };
    let see_emails = access.is_admin();
    Ok(Json(TeamMembersDto {
        members: members
            .into_iter()
            .map(|m| TeamMemberDto {
                email: if see_emails || m.user_id == auth.id { m.email } else { String::new() },
                user_id: m.user_id,
                name: m.name,
                job: m.job,
                tone: m.tone,
                role: m.role,
                joined_at: m.joined_at,
            })
            .collect(),
        invites: invites.into_iter().map(Into::into).collect(),
    }))
}

const PERSONAL_OWNER: &str = "Владелец не уходит из «Личного», его нельзя убрать и понизить";

/// Сменить роль члена команды (администратор). Единственного администратора и владельца «Личного» понизить нельзя.
#[utoipa::path(
    patch,
    path = "/teams/{id}/members/{user_id}",
    tag = "teams",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Команда"), ("user_id" = Uuid, Path, description = "Член команды")),
    request_body = UpdateTeamMember,
    responses(
        (status = 204, description = "Роль изменена"),
        (status = 400, description = "Некорректная роль", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 403, description = "Нужны права администратора команды", body = ErrorBody),
        (status = 404, description = "Нет такой команды или члена", body = ErrorBody),
        (status = 409, description = "Это единственный администратор или владелец «Личного»", body = ErrorBody),
    )
)]
async fn update_member(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath((id, user_id)): ApiPath<(Uuid, Uuid)>,
    ApiJson(req): ApiJson<UpdateTeamMember>,
) -> ApiResult<StatusCode> {
    let role = Role::parse(&req.role).ok_or_else(|| bad("Роль: admin или member"))?;
    let mut tx = state.pool.begin().await?;
    let access = access::team_admin(&mut *tx, auth, id).await?;
    db::teams::lock(&mut tx, id).await?;
    let current = db::teams::member_role(&mut *tx, id, user_id).await?.ok_or(ApiError::NotFound)?;
    if current == Role::Admin.as_str() && role == Role::Member {
        if access.team.personal_for == Some(user_id) {
            return Err(ApiError::Conflict(PERSONAL_OWNER.into()));
        }
        if db::teams::admin_count(&mut *tx, id).await? <= 1 {
            return Err(ApiError::Conflict(
                "Единственного администратора нельзя понизить. Сначала назначьте другого".into(),
            ));
        }
    }
    db::teams::set_member_role(&mut tx, id, user_id, role.as_str()).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Убрать члена из команды (администратор). Он уходит и из явных участий в её проектах; гостей это не касается.
/// Единственного администратора и владельца «Личного» убрать нельзя.
#[utoipa::path(
    delete,
    path = "/teams/{id}/members/{user_id}",
    tag = "teams",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Команда"), ("user_id" = Uuid, Path, description = "Член команды")),
    responses(
        (status = 204, description = "Член убран, его имя остаётся на старых задачах"),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 403, description = "Нужны права администратора команды", body = ErrorBody),
        (status = 404, description = "Нет такой команды или члена", body = ErrorBody),
        (status = 409, description = "Это единственный администратор или владелец «Личного»", body = ErrorBody),
    )
)]
async fn remove_member(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath((id, user_id)): ApiPath<(Uuid, Uuid)>,
) -> ApiResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    let access = access::team_admin(&mut *tx, auth, id).await?;
    detach(&mut tx, &access, user_id, user_id == auth.id).await?;
    tx.commit().await?;
    // убранный человек уже не в аудитории команды, но должен узнать об этом
    events::note_user(user_id);
    Ok(StatusCode::NO_CONTENT)
}

/// Выйти из команды (член). Единственный администратор и владелец «Личного» выйти не могут.
#[utoipa::path(
    post,
    path = "/teams/{id}/leave",
    tag = "teams",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Команда")),
    responses(
        (status = 204, description = "Вы вышли из команды и из явных участий в её проектах"),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такой команды или вы не её член", body = ErrorBody),
        (status = 409, description = "Вы единственный администратор или владелец «Личного»", body = ErrorBody),
    )
)]
async fn leave_team(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    let access = access::team_member(&mut *tx, auth, id).await?;
    detach(&mut tx, &access, auth.id, true).await?;
    tx.commit().await?;
    events::note_user(auth.id);
    Ok(StatusCode::NO_CONTENT)
}

/// Убирает члена команды вместе с его явными участиями в проектах команды, если это можно: единственный администратор и
/// владелец «Личного» остаются (docs/TEAMS.md, 4.4). `himself`: человек уходит сам (меняется только текст отказа).
async fn detach(conn: &mut db::sqlx::PgConnection, access: &TeamAccess, user_id: Uuid, himself: bool) -> ApiResult<()> {
    let id = access.team.id;
    db::teams::lock(conn, id).await?;
    let role = db::teams::member_role(&mut *conn, id, user_id).await?.ok_or(ApiError::NotFound)?;
    if access.team.personal_for == Some(user_id) {
        return Err(ApiError::Conflict(PERSONAL_OWNER.into()));
    }
    if role == Role::Admin.as_str() && db::teams::admin_count(&mut *conn, id).await? <= 1 {
        let message = if himself {
            "Вы единственный администратор. Назначьте другого или архивируйте команду"
        } else {
            "Единственного администратора нельзя убрать. Сначала назначьте другого"
        };
        return Err(ApiError::Conflict(message.into()));
    }
    db::teams::remove_member(conn, id, user_id).await?;
    Ok(())
}

// ===== Администратор сервера =====

/// Все команды сервера (только администратор сервера): окно «Все команды сервера». Открыть любую можно обычными адресами:
/// администратор сервера видит и правит всё.
#[utoipa::path(
    get,
    path = "/admin/teams",
    tag = "teams",
    security(("bearer" = [])),
    params(AdminTeamsQuery),
    responses(
        (status = 200, description = "Не больше двухсот команд, обычные первыми", body = [AdminTeamDto]),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 403, description = "Только для администратора сервера", body = ErrorBody),
    )
)]
async fn admin_teams(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiQuery(query): ApiQuery<AdminTeamsQuery>,
) -> ApiResult<Json<Vec<AdminTeamDto>>> {
    access::server_admin(&state.pool, auth).await?;
    let q = query.q.as_deref().map(str::trim).filter(|q| !q.is_empty());
    let found = db::teams::list_all(&state.pool, q, 200).await?;
    Ok(Json(
        found
            .into_iter()
            .map(|t| AdminTeamDto {
                id: t.id,
                name: t.name,
                personal: t.personal_for.is_some(),
                owner_name: t.owner_name,
                archived: t.archived,
                member_count: t.member_count,
                project_count: t.project_count,
                created_at: t.created_at,
            })
            .collect(),
    ))
}
