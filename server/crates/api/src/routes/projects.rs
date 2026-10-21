//! Проекты: список, создание, настройки, архив, участники (docs/PROJECTS.md, раздел 1) и доска.

use axum::{Json, extract::State, http::StatusCode};
use domain::{
    board,
    projects::{self, MAX_NAME_LEN, Role},
};
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::{
    dto::{BoardDto, ProjectDto, TaskCardDto},
    project_dto::{CreateProject, MemberDto, MembersDto, ProjectsQuery, UpdateMember, UpdateProject},
};
use crate::{
    access,
    error::{ApiError, ApiResult, ErrorBody},
    events,
    extract::{ApiJson, ApiPath, ApiQuery, AuthUser},
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_projects, create_project))
        .routes(routes!(update_project))
        .routes(routes!(board))
        .routes(routes!(archive_project))
        .routes(routes!(unarchive_project))
        .routes(routes!(list_members))
        .routes(routes!(update_member, remove_member))
}

fn bad(message: impl Into<String>) -> ApiError {
    ApiError::BadRequest(message.into())
}

fn clean_name(raw: &str) -> ApiResult<String> {
    board::clean_text(raw, MAX_NAME_LEN)
        .ok_or_else(|| bad(format!("Название проекта: от 1 до {MAX_NAME_LEN} символов")))
}

fn clean_color(raw: &str) -> ApiResult<()> {
    projects::is_color(raw)
        .then_some(())
        .ok_or_else(|| bad(format!("Цвет проекта: один из {}", projects::COLORS.join(", "))))
}

/// Ключ из запроса: пустая строка значит «без ключа»
pub(super) fn clean_key(raw: &str) -> ApiResult<Option<String>> {
    if raw.trim().is_empty() {
        return Ok(None);
    }
    projects::normalize_key(raw)
        .map(Some)
        .ok_or_else(|| bad("Ключ: от 2 до 6 символов, латиница и цифры, начинается с буквы"))
}

/// Мои проекты в порядке создания. Глобальному админу доступны все.
#[utoipa::path(
    get,
    path = "/projects",
    tag = "projects",
    security(("bearer" = [])),
    params(("archived" = Option<bool>, Query, description = "Архивные проекты, которыми человек управляет")),
    responses(
        (status = 200, description = "Проекты человека", body = [ProjectDto]),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
    )
)]
async fn list_projects(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiQuery(query): ApiQuery<ProjectsQuery>,
) -> ApiResult<Json<Vec<ProjectDto>>> {
    let list = db::projects::list_for_user(&state.pool, auth.id, query.archived).await?;
    Ok(Json(list.into_iter().map(ProjectDto::from).collect()))
}

/// Новый проект. Создатель становится его администратором, доска начинается с четырёх колонок макета.
#[utoipa::path(
    post,
    path = "/projects",
    tag = "projects",
    security(("bearer" = [])),
    request_body = CreateProject,
    responses(
        (status = 201, description = "Проект создан", body = ProjectDto),
        (status = 400, description = "Некорректный запрос", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
    )
)]
async fn create_project(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiJson(req): ApiJson<CreateProject>,
) -> ApiResult<(StatusCode, Json<ProjectDto>)> {
    let name = clean_name(&req.name)?;
    let color = req.color.as_deref().unwrap_or(projects::COLORS[0]);
    clean_color(color)?;
    let key = req.key.as_deref().map(clean_key).transpose()?.flatten();

    let mut tx = state.pool.begin().await?;
    let project = db::projects::insert(&mut tx, &name, color, key.as_deref(), auth.id).await?;
    for (title, color, is_done) in board::DEFAULT_COLUMNS {
        db::columns::insert(&mut tx, project.id, title, color, is_done).await?;
    }
    tx.commit().await?;
    events::note_project(project.id);
    Ok((StatusCode::CREATED, Json(ProjectDto::new(project, Role::Admin.as_str()))))
}

/// Название, цвет и ключ проекта (администратор). Смена ключа меняет только подпись id задач.
#[utoipa::path(
    patch,
    path = "/projects/{id}",
    tag = "projects",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Проект")),
    request_body = UpdateProject,
    responses(
        (status = 200, description = "Проект после изменений", body = ProjectDto),
        (status = 400, description = "Некорректный запрос", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 403, description = "Нужны права администратора проекта", body = ErrorBody),
        (status = 404, description = "Нет такого проекта", body = ErrorBody),
        (status = 409, description = "Ключ уже занят модулем проекта", body = ErrorBody),
    )
)]
async fn update_project(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<UpdateProject>,
) -> ApiResult<Json<ProjectDto>> {
    let mut patch = db::projects::ProjectPatch::default();
    if let Some(name) = &req.name {
        patch.name = Some(clean_name(name)?);
    }
    if let Some(color) = &req.color {
        clean_color(color)?;
        patch.color = Some(color.clone());
    }
    patch.key = req.key.as_ref().map(|k| k.as_deref().map(clean_key).transpose().map(Option::flatten)).transpose()?;

    let mut tx = state.pool.begin().await?;
    let access = access::admin_locked(&mut tx, auth, id).await?;
    // ключ проекта не должен совпасть с ключом модуля; без ключа задачи получают TASK, он тоже не должен быть занят
    if let Some(key) = &patch.key {
        let effective = key.as_deref().unwrap_or(board::DEFAULT_KEY);
        if db::projects::module_has_key(&mut *tx, id, effective).await? {
            return Err(ApiError::Conflict("Такой ключ уже есть в этом проекте".into()));
        }
    }
    let project = db::projects::update(&mut tx, id, &patch).await?;
    tx.commit().await?;
    Ok(Json(ProjectDto::new(project, access.role.as_str())))
}

/// Убрать проект из списков, данные остаются (администратор)
#[utoipa::path(
    post,
    path = "/projects/{id}/archive",
    tag = "projects",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Проект")),
    responses(
        (status = 200, description = "Проект в архиве", body = ProjectDto),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 403, description = "Нужны права администратора проекта", body = ErrorBody),
        (status = 404, description = "Нет такого проекта", body = ErrorBody),
    )
)]
async fn archive_project(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<Json<ProjectDto>> {
    set_archived(auth, &state, id, true).await
}

/// Вернуть проект из архива (администратор)
#[utoipa::path(
    post,
    path = "/projects/{id}/unarchive",
    tag = "projects",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Проект")),
    responses(
        (status = 200, description = "Проект возвращён", body = ProjectDto),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 403, description = "Нужны права администратора проекта", body = ErrorBody),
        (status = 404, description = "Нет такого проекта", body = ErrorBody),
    )
)]
async fn unarchive_project(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<Json<ProjectDto>> {
    set_archived(auth, &state, id, false).await
}

async fn set_archived(auth: AuthUser, state: &AppState, id: Uuid, archived: bool) -> ApiResult<Json<ProjectDto>> {
    let mut tx = state.pool.begin().await?;
    let access = access::admin_locked(&mut tx, auth, id).await?;
    let project = db::projects::set_archived(&mut tx, id, archived).await?;
    tx.commit().await?;
    Ok(Json(ProjectDto::new(project, access.role.as_str())))
}

/// Всё для первой загрузки доски одним ответом: колонки, задачи (и бэклог) с метками и счётчиками подзадач,
/// метки, модули и вехи проекта
#[utoipa::path(
    get,
    path = "/projects/{id}/board",
    tag = "projects",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Проект")),
    responses(
        (status = 200, description = "Доска проекта", body = BoardDto),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого проекта", body = ErrorBody),
    )
)]
async fn board(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(project_id): ApiPath<Uuid>,
) -> ApiResult<Json<BoardDto>> {
    let mut conn = state.pool.acquire().await?;
    let access = access::project(&mut *conn, auth, project_id).await?;
    let project = access.project;
    let columns = db::columns::list(&mut *conn, project_id).await?;
    let cards = db::tasks::list_cards(&mut *conn, project_id).await?;
    let tags = db::tags::list(&mut *conn, project_id).await?;
    let modules = db::modules::list_modules(&mut *conn, project_id).await?;
    let milestones = db::modules::list_milestones(&mut *conn, project_id).await?;

    Ok(Json(BoardDto {
        tasks: cards.into_iter().map(|c| TaskCardDto::new(c, project.key.as_deref())).collect(),
        project: ProjectDto::new(project, access.role.as_str()),
        columns: columns.into_iter().map(Into::into).collect(),
        tags: tags.into_iter().map(Into::into).collect(),
        modules: modules.into_iter().map(Into::into).collect(),
        milestones: milestones.into_iter().map(Into::into).collect(),
    }))
}

// ===== Участники =====

/// Участники проекта; ожидающие приглашения видит только администратор
#[utoipa::path(
    get,
    path = "/projects/{id}/members",
    tag = "projects",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Проект")),
    responses(
        (status = 200, description = "Участники и ожидающие приглашения", body = MembersDto),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого проекта", body = ErrorBody),
    )
)]
async fn list_members(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<Json<MembersDto>> {
    let mut conn = state.pool.acquire().await?;
    let access = access::project(&mut *conn, auth, id).await?;
    let members = db::members::list(&mut *conn, id).await?;
    let invites =
        if access.is_admin() { db::invites::list_pending_for_project(&mut *conn, id).await? } else { Vec::new() };
    Ok(Json(MembersDto {
        members: members.into_iter().map(MemberDto::from).collect(),
        invites: invites.into_iter().map(Into::into).collect(),
    }))
}

/// Сменить роль участника (администратор). Единственного администратора понизить нельзя.
#[utoipa::path(
    patch,
    path = "/projects/{id}/members/{user_id}",
    tag = "projects",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Проект"), ("user_id" = Uuid, Path, description = "Участник")),
    request_body = UpdateMember,
    responses(
        (status = 204, description = "Роль изменена"),
        (status = 400, description = "Некорректная роль", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 403, description = "Нужны права администратора проекта", body = ErrorBody),
        (status = 404, description = "Нет такого проекта или участника", body = ErrorBody),
        (status = 409, description = "Это единственный администратор проекта", body = ErrorBody),
    )
)]
async fn update_member(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath((id, user_id)): ApiPath<(Uuid, Uuid)>,
    ApiJson(req): ApiJson<UpdateMember>,
) -> ApiResult<StatusCode> {
    let role = Role::parse(&req.role).ok_or_else(|| bad("Роль: admin или member"))?;
    let mut tx = state.pool.begin().await?;
    access::admin_locked(&mut tx, auth, id).await?;
    let current = db::members::role_of(&mut *tx, id, user_id).await?.ok_or(ApiError::NotFound)?;
    if current == Role::Admin.as_str() && role == Role::Member && db::members::admin_count(&mut *tx, id).await? <= 1 {
        return Err(ApiError::Conflict(LAST_ADMIN.into()));
    }
    db::members::set_role(&mut tx, id, user_id, role.as_str()).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

const LAST_ADMIN: &str = "Единственный администратор проекта. Сначала назначьте другого или архивируйте проект";

/// Убрать участника (администратор) или выйти самому (любой участник). Единственный администратор не может выйти.
#[utoipa::path(
    delete,
    path = "/projects/{id}/members/{user_id}",
    tag = "projects",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Проект"), ("user_id" = Uuid, Path, description = "Участник")),
    responses(
        (status = 204, description = "Участник убран, его имя остаётся на старых задачах"),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 403, description = "Убрать другого может только администратор проекта", body = ErrorBody),
        (status = 404, description = "Нет такого проекта или участника", body = ErrorBody),
        (status = 409, description = "Это единственный администратор проекта", body = ErrorBody),
    )
)]
async fn remove_member(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath((id, user_id)): ApiPath<(Uuid, Uuid)>,
) -> ApiResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    if user_id == auth.id {
        access::project_locked(&mut tx, auth, id).await?;
    } else {
        access::admin_locked(&mut tx, auth, id).await?;
    }
    let current = db::members::role_of(&mut *tx, id, user_id).await?.ok_or(ApiError::NotFound)?;
    if current == Role::Admin.as_str() && db::members::admin_count(&mut *tx, id).await? <= 1 {
        return Err(ApiError::Conflict(LAST_ADMIN.into()));
    }
    db::members::remove(&mut tx, id, user_id).await?;
    tx.commit().await?;
    // убранный человек уже не участник, но должен узнать об этом
    events::note_user(user_id);
    Ok(StatusCode::NO_CONTENT)
}
