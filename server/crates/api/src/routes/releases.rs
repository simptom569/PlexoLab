//! Релизы и их чек-лист. Запись в ленту активности делается в той же транзакции, что и действие.

use std::collections::HashMap;

use axum::{Json, extract::State, http::StatusCode};
use db::{
    projects::Project,
    releases::{Release, ReleaseItem},
    sqlx::PgConnection,
};
use domain::{
    board,
    work::{self, DEFAULT_RELEASE_STEPS, MAX_RELEASE_NOTES_LEN, MAX_RELEASE_STEP_LEN, MAX_VERSION_LEN},
};
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::dto::{CreateRelease, CreateReleaseItem, ReleaseDto, ReleaseItemDto, UpdateRelease, UpdateReleaseItem};
use crate::{
    access,
    error::{ApiError, ApiResult, ErrorBody},
    extract::{ApiJson, ApiPath, AuthUser},
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_releases, create_release))
        .routes(routes!(update_release, delete_release))
        .routes(routes!(create_item))
        .routes(routes!(update_item, delete_item))
}

fn bad(message: impl Into<String>) -> ApiError {
    ApiError::BadRequest(message.into())
}

fn clean_version(raw: &str) -> ApiResult<String> {
    board::clean_text(raw, MAX_VERSION_LEN).ok_or_else(|| bad(format!("Версия: от 1 до {MAX_VERSION_LEN} символов")))
}

fn clean_step(raw: &str) -> ApiResult<String> {
    board::clean_text(raw, MAX_RELEASE_STEP_LEN)
        .ok_or_else(|| bad(format!("Шаг чек-листа: от 1 до {MAX_RELEASE_STEP_LEN} символов")))
}

/// «Релиз 2.9.0» для ленты активности
fn target(release: &Release) -> String {
    format!("Релиз {}", release.version)
}

/// Находит релиз и блокирует его проект до конца транзакции
async fn load_locked(conn: &mut PgConnection, auth: AuthUser, id: Uuid) -> ApiResult<(Release, Project)> {
    let release = db::releases::get(&mut *conn, id).await?.ok_or(ApiError::NotFound)?;
    let project = access::project_locked(&mut *conn, auth, release.project_id).await?.project;
    // пока ждали блокировку проекта, релиз могли удалить или изменить: читаем заново
    let release = db::releases::get(conn, id).await?.ok_or(ApiError::NotFound)?;
    Ok((release, project))
}

/// Находит шаг вместе с его релизом и блокирует проект
async fn load_item_locked(
    conn: &mut PgConnection,
    auth: AuthUser,
    id: Uuid,
) -> ApiResult<(ReleaseItem, Release, Project)> {
    let item = db::releases::get_item(&mut *conn, id).await?.ok_or(ApiError::NotFound)?;
    let (release, project) = load_locked(&mut *conn, auth, item.release_id).await?;
    let item = db::releases::get_item(conn, id).await?.ok_or(ApiError::NotFound)?;
    Ok((item, release, project))
}

async fn full(conn: &mut PgConnection, release: Release) -> ApiResult<ReleaseDto> {
    let items = db::releases::list_items(conn, release.id).await?;
    Ok(ReleaseDto::new(release, items))
}

// ===== Релизы =====

/// Релизы проекта от новых к старым, каждый с чек-листом
#[utoipa::path(
    get,
    path = "/projects/{id}/releases",
    tag = "releases",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Проект")),
    responses(
        (status = 200, description = "Релизы проекта", body = [ReleaseDto]),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого проекта", body = ErrorBody),
    )
)]
async fn list_releases(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(project_id): ApiPath<Uuid>,
) -> ApiResult<Json<Vec<ReleaseDto>>> {
    let mut conn = state.pool.acquire().await?;
    access::project(&mut *conn, auth, project_id).await?;
    let releases = db::releases::list(&mut *conn, project_id).await?;
    let mut items: HashMap<Uuid, Vec<ReleaseItem>> = HashMap::new();
    for item in db::releases::list_items_for_project(&mut *conn, project_id).await? {
        items.entry(item.release_id).or_default().push(item);
    }
    let list = releases
        .into_iter()
        .map(|r| {
            let own = items.remove(&r.id).unwrap_or_default();
            ReleaseDto::new(r, own)
        })
        .collect();
    Ok(Json(list))
}

/// Новый релиз «Запланирован» с четырьмя стандартными шагами чек-листа
#[utoipa::path(
    post,
    path = "/projects/{id}/releases",
    tag = "releases",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Проект")),
    request_body = CreateRelease,
    responses(
        (status = 201, description = "Релиз создан", body = ReleaseDto),
        (status = 400, description = "Некорректный запрос", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого проекта", body = ErrorBody),
    )
)]
async fn create_release(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(project_id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<CreateRelease>,
) -> ApiResult<(StatusCode, Json<ReleaseDto>)> {
    let version = clean_version(&req.version)?;

    let mut tx = state.pool.begin().await?;
    access::project_locked(&mut tx, auth, project_id).await?;
    let release = db::releases::insert(&mut tx, project_id, &version, req.release_date).await?;
    for step in DEFAULT_RELEASE_STEPS {
        db::releases::insert_item(&mut tx, release.id, step).await?;
    }
    db::activity::insert(&mut tx, auth.id, Some(project_id), "release", &target(&release), "создан").await?;
    let dto = full(&mut tx, release).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(dto)))
}

/// Версия, дата, статус и заметки релиза. Смена статуса попадает в ленту активности.
#[utoipa::path(
    patch,
    path = "/releases/{id}",
    tag = "releases",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Релиз")),
    request_body = UpdateRelease,
    responses(
        (status = 200, description = "Релиз после изменений", body = ReleaseDto),
        (status = 400, description = "Некорректный запрос", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого релиза", body = ErrorBody),
    )
)]
async fn update_release(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<UpdateRelease>,
) -> ApiResult<Json<ReleaseDto>> {
    let version = req.version.as_deref().map(clean_version).transpose()?;
    if let Some(status) = &req.status
        && !work::is_status(status)
    {
        return Err(bad("Статус: plan, progress или done"));
    }
    if let Some(notes) = &req.notes
        && notes.chars().count() > MAX_RELEASE_NOTES_LEN
    {
        return Err(bad(format!("Заметки длиннее {MAX_RELEASE_NOTES_LEN} символов")));
    }

    let mut tx = state.pool.begin().await?;
    let (before, project) = load_locked(&mut tx, auth, id).await?;
    let release = db::releases::update(
        &mut tx,
        id,
        version.as_deref(),
        req.release_date,
        req.status.as_deref(),
        req.notes.as_deref(),
    )
    .await?;
    if release.status != before.status {
        let text = format!("переведён в «{}»", work::release_status_label(&release.status));
        db::activity::insert(&mut tx, auth.id, Some(project.id), "release", &target(&release), &text).await?;
    }
    let dto = full(&mut tx, release).await?;
    tx.commit().await?;
    Ok(Json(dto))
}

/// Удалить релиз вместе с чек-листом
#[utoipa::path(
    delete,
    path = "/releases/{id}",
    tag = "releases",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Релиз")),
    responses(
        (status = 204, description = "Релиз удалён"),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого релиза", body = ErrorBody),
    )
)]
async fn delete_release(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    let (release, project) = load_locked(&mut tx, auth, id).await?;
    db::releases::delete(&mut tx, id).await?;
    db::activity::insert(&mut tx, auth.id, Some(project.id), "release", &target(&release), "удалён").await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ===== Шаги чек-листа =====

/// Новый шаг в конец чек-листа
#[utoipa::path(
    post,
    path = "/releases/{id}/items",
    tag = "releases",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Релиз")),
    request_body = CreateReleaseItem,
    responses(
        (status = 201, description = "Шаг добавлен", body = ReleaseItemDto),
        (status = 400, description = "Некорректный запрос", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого релиза", body = ErrorBody),
    )
)]
async fn create_item(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(release_id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<CreateReleaseItem>,
) -> ApiResult<(StatusCode, Json<ReleaseItemDto>)> {
    let title = clean_step(&req.title)?;

    let mut tx = state.pool.begin().await?;
    load_locked(&mut tx, auth, release_id).await?;
    let item = db::releases::insert_item(&mut tx, release_id, &title).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(item.into())))
}

/// Отметить или переименовать шаг. Когда шаг отмечают выполненным, в ленту активности пишется «отмечен шаг».
#[utoipa::path(
    patch,
    path = "/release-items/{id}",
    tag = "releases",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Шаг чек-листа")),
    request_body = UpdateReleaseItem,
    responses(
        (status = 200, description = "Шаг после изменений", body = ReleaseItemDto),
        (status = 400, description = "Некорректный запрос", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого шага", body = ErrorBody),
    )
)]
async fn update_item(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<UpdateReleaseItem>,
) -> ApiResult<Json<ReleaseItemDto>> {
    let title = req.title.as_deref().map(clean_step).transpose()?;

    let mut tx = state.pool.begin().await?;
    let (before, release, project) = load_item_locked(&mut tx, auth, id).await?;
    let item = db::releases::update_item(&mut tx, id, title.as_deref(), req.done).await?;
    if item.done && !before.done {
        let text = format!("отмечен шаг «{}»", item.title);
        db::activity::insert(&mut tx, auth.id, Some(project.id), "release", &target(&release), &text).await?;
    }
    tx.commit().await?;
    Ok(Json(item.into()))
}

/// Удалить шаг из чек-листа
#[utoipa::path(
    delete,
    path = "/release-items/{id}",
    tag = "releases",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Шаг чек-листа")),
    responses(
        (status = 204, description = "Шаг удалён"),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого шага", body = ErrorBody),
    )
)]
async fn delete_item(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    load_item_locked(&mut tx, auth, id).await?;
    db::releases::delete_item(&mut tx, id).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
