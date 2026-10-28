//! Модули и вехи проекта. Запись в ленту активности делается в той же транзакции, что и действие.

use axum::{Json, extract::State, http::StatusCode};
use db::tasks::Series;
use db::{
    modules::{Milestone, Module, ModulePatch},
    projects::Project,
    sqlx::PgConnection,
};
use domain::{
    board,
    work::{self, MAX_MILESTONE_TITLE_LEN, MAX_MODULE_NOTE_LEN, MAX_MODULE_TITLE_LEN},
};
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::{
    dto::{CreateMilestone, CreateModule, MilestoneDto, ModuleDto, UpdateMilestone, UpdateModule},
    projects::clean_key,
};
use crate::{
    access,
    error::{ApiError, ApiResult, ErrorBody},
    extract::{ApiJson, ApiPath, AuthUser},
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(create_module))
        .routes(routes!(update_module, delete_module))
        .routes(routes!(create_milestone))
        .routes(routes!(update_milestone, delete_milestone))
}

fn bad(message: impl Into<String>) -> ApiError {
    ApiError::BadRequest(message.into())
}

fn module_title(raw: &str) -> ApiResult<String> {
    board::clean_text(raw, MAX_MODULE_TITLE_LEN)
        .ok_or_else(|| bad(format!("Название модуля: от 1 до {MAX_MODULE_TITLE_LEN} символов")))
}

fn milestone_title(raw: &str) -> ApiResult<String> {
    board::clean_text(raw, MAX_MILESTONE_TITLE_LEN)
        .ok_or_else(|| bad(format!("Название вехи: от 1 до {MAX_MILESTONE_TITLE_LEN} символов")))
}

/// «Модуль «Платежи»» для ленты активности
fn module_target(title: &str) -> String {
    format!("Модуль «{title}»")
}

/// «Веха «Бета»» для ленты активности
fn milestone_target(title: &str) -> String {
    format!("Веха «{title}»")
}

/// Находит модуль и блокирует его проект до конца транзакции
async fn load_module_locked(conn: &mut PgConnection, auth: AuthUser, id: Uuid) -> ApiResult<(Module, Project)> {
    let module = db::modules::get_module(&mut *conn, id).await?.ok_or(ApiError::NotFound)?;
    let project = access::project_locked(&mut *conn, auth, module.project_id).await?.project;
    // пока ждали блокировку проекта, модуль могли удалить или изменить: читаем заново
    let module = db::modules::get_module(conn, id).await?.ok_or(ApiError::NotFound)?;
    Ok((module, project))
}

async fn load_milestone_locked(conn: &mut PgConnection, auth: AuthUser, id: Uuid) -> ApiResult<(Milestone, Project)> {
    let milestone = db::modules::get_milestone(&mut *conn, id).await?.ok_or(ApiError::NotFound)?;
    let project = access::project_locked(&mut *conn, auth, milestone.project_id).await?.project;
    let milestone = db::modules::get_milestone(conn, id).await?.ok_or(ApiError::NotFound)?;
    Ok((milestone, project))
}

/// Ключ модуля не должен совпасть с ключом другого модуля и с тем, чем подписаны задачи проекта: его ключом, а если
/// ключа нет, словом `TASK` (docs/PROJECTS.md, раздел 4.2)
async fn ensure_key_free(conn: &mut PgConnection, project: &Project, module: &Module, key: &str) -> ApiResult<()> {
    let project_prefix = project.key.as_deref().unwrap_or(board::DEFAULT_KEY);
    if key == project_prefix {
        return Err(ApiError::Conflict(match project.key {
            Some(_) => "Такой ключ уже у проекта".into(),
            None => format!("Ключ {key} занят: так подписаны задачи проекта, у которого нет ключа"),
        }));
    }
    if db::modules::key_taken(&mut *conn, project.id, key, module.id).await? {
        return Err(ApiError::Conflict("Такой ключ уже есть в этом проекте".into()));
    }
    Ok(())
}

/// Задачи модуля переходят из ряда в ряд, когда ключ появляется или пропадает (docs/PROJECTS.md, раздел 4.3).
/// Переименование ключа ничего не пересчитывает: меняется только подпись. Вызывать до смены ключа в базе.
async fn move_series_for_key(
    conn: &mut PgConnection,
    project: &Project,
    module: &Module,
    new_key: Option<&str>,
) -> ApiResult<()> {
    match (module.key.is_some(), new_key.is_some()) {
        (false, true) => {
            let ids = db::tasks::ids_in_project_series_of_module(&mut *conn, module.id).await?;
            db::tasks::move_all_to_series(conn, &ids, project.key.as_deref(), Series::Module(module.id)).await?;
        }
        (true, false) => {
            let ids = db::tasks::ids_in_module_series(&mut *conn, module.id).await?;
            db::tasks::move_all_to_series(conn, &ids, project.key.as_deref(), Series::Project(project.id)).await?;
        }
        _ => {}
    }
    Ok(())
}

// ===== Модули =====

/// Новый модуль: «Запланирован», ответственный — автор, без дат и заметки
#[utoipa::path(
    post,
    path = "/projects/{id}/modules",
    tag = "modules",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Проект")),
    request_body = CreateModule,
    responses(
        (status = 201, description = "Модуль создан", body = ModuleDto),
        (status = 400, description = "Некорректный запрос", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого проекта", body = ErrorBody),
    )
)]
async fn create_module(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(project_id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<CreateModule>,
) -> ApiResult<(StatusCode, Json<ModuleDto>)> {
    let title = module_title(&req.title)?;

    let mut tx = state.pool.begin().await?;
    access::project_locked(&mut tx, auth, project_id).await?;
    let module = db::modules::insert_module(&mut tx, project_id, &title, auth.id).await?;
    db::activity::insert(&mut tx, auth.id, Some(project_id), "module", &module_target(&module.title), "создан").await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(module.into())))
}

/// Название, ключ задач, статус, ответственный, даты и заметка модуля. Смена статуса попадает в ленту активности.
///
/// Ключ задач: первый ключ, как и снятие ключа, переносит задачи модуля в другой ряд, и они получают новые номера в
/// порядке старых (прежние id пишутся в историю); переименование меняет только подпись, номера те же.
#[utoipa::path(
    patch,
    path = "/modules/{id}",
    tag = "modules",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Модуль")),
    request_body = UpdateModule,
    responses(
        (status = 200, description = "Модуль после изменений", body = ModuleDto),
        (status = 400, description = "Некорректный запрос", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого модуля", body = ErrorBody),
        (status = 409, description = "Ключ уже занят в проекте", body = ErrorBody),
    )
)]
async fn update_module(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<UpdateModule>,
) -> ApiResult<Json<ModuleDto>> {
    let mut patch =
        ModulePatch { lead: req.lead_id, date_from: req.date_from, date_to: req.date_to, ..ModulePatch::default() };
    if let Some(title) = &req.title {
        patch.title = Some(module_title(title)?);
    }
    if let Some(key) = &req.key {
        patch.key = Some(key.as_deref().map(clean_key).transpose()?.flatten());
    }
    if let Some(status) = req.status {
        if !work::is_status(&status) {
            return Err(bad("Статус: plan, progress или done"));
        }
        patch.status = Some(status);
    }
    if let Some(note) = req.note {
        if note.chars().count() > MAX_MODULE_NOTE_LEN {
            return Err(bad(format!("Заметка длиннее {MAX_MODULE_NOTE_LEN} символов")));
        }
        patch.note = Some(note);
    }

    let mut tx = state.pool.begin().await?;
    let (before, project) = load_module_locked(&mut tx, auth, id).await?;
    // ответственным назначают участника проекта; тот, кто уже назначен и вышел из проекта, остаётся
    if let Some(Some(lead)) = patch.lead
        && before.lead_id != Some(lead)
        && !db::members::is_person(&mut *tx, project.id, lead).await?
    {
        return Err(bad("Ответственный должен быть участником проекта"));
    }

    if let Some(key) = &patch.key
        && *key != before.key
    {
        if let Some(key) = key {
            ensure_key_free(&mut tx, &project, &before, key).await?;
        }
        move_series_for_key(&mut tx, &project, &before, key.as_deref()).await?;
    }

    let module = db::modules::update_module(&mut tx, id, &patch).await?;
    if module.status != before.status {
        let text = format!("переведён в «{}»", work::module_status_label(&module.status));
        db::activity::insert(&mut tx, auth.id, Some(project.id), "module", &module_target(&module.title), &text)
            .await?;
    }
    tx.commit().await?;
    Ok(Json(module.into()))
}

/// Удалить модуль. Его задачи остаются на доске и в бэклоге, но без модуля; если у модуля был ключ, они переходят в ряд
/// проекта и получают новые номера.
#[utoipa::path(
    delete,
    path = "/modules/{id}",
    tag = "modules",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Модуль")),
    responses(
        (status = 204, description = "Модуль удалён"),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого модуля", body = ErrorBody),
    )
)]
async fn delete_module(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    let (module, project) = load_module_locked(&mut tx, auth, id).await?;
    // ряд модуля без модуля существовать не может (база не даст удалить): сначала задачи уходят в ряд проекта
    move_series_for_key(&mut tx, &project, &module, None).await?;
    db::modules::delete_module(&mut tx, id).await?;
    db::activity::insert(&mut tx, auth.id, Some(project.id), "module", &module_target(&module.title), "удалён").await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ===== Вехи =====

/// Новая веха с датой
#[utoipa::path(
    post,
    path = "/projects/{id}/milestones",
    tag = "milestones",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Проект")),
    request_body = CreateMilestone,
    responses(
        (status = 201, description = "Веха создана", body = MilestoneDto),
        (status = 400, description = "Некорректный запрос", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого проекта", body = ErrorBody),
    )
)]
async fn create_milestone(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(project_id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<CreateMilestone>,
) -> ApiResult<(StatusCode, Json<MilestoneDto>)> {
    let title = milestone_title(&req.title)?;

    let mut tx = state.pool.begin().await?;
    access::project_locked(&mut tx, auth, project_id).await?;
    let milestone = db::modules::insert_milestone(&mut tx, project_id, &title, req.due_date).await?;
    db::activity::insert(&mut tx, auth.id, Some(project_id), "release", &milestone_target(&milestone.title), "создана")
        .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(milestone.into())))
}

/// Название и дата вехи
#[utoipa::path(
    patch,
    path = "/milestones/{id}",
    tag = "milestones",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Веха")),
    request_body = UpdateMilestone,
    responses(
        (status = 200, description = "Веха после изменений", body = MilestoneDto),
        (status = 400, description = "Некорректный запрос", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такой вехи", body = ErrorBody),
    )
)]
async fn update_milestone(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<UpdateMilestone>,
) -> ApiResult<Json<MilestoneDto>> {
    let title = req.title.as_deref().map(milestone_title).transpose()?;

    let mut tx = state.pool.begin().await?;
    load_milestone_locked(&mut tx, auth, id).await?;
    let milestone = db::modules::update_milestone(&mut tx, id, title.as_deref(), req.due_date).await?;
    tx.commit().await?;
    Ok(Json(milestone.into()))
}

/// Удалить веху. Её задачи остаются, но без вехи.
#[utoipa::path(
    delete,
    path = "/milestones/{id}",
    tag = "milestones",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Веха")),
    responses(
        (status = 204, description = "Веха удалена"),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такой вехи", body = ErrorBody),
    )
)]
async fn delete_milestone(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    let (milestone, project) = load_milestone_locked(&mut tx, auth, id).await?;
    db::modules::delete_milestone(&mut tx, id).await?;
    db::activity::insert(&mut tx, auth.id, Some(project.id), "release", &milestone_target(&milestone.title), "удалена")
        .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
