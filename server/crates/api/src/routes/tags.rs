use axum::{Json, extract::State, http::StatusCode};
use domain::board::{self, MAX_TAG_LEN, TONE_COUNT};
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::{
    dto::{CreateTag, TagDto},
    project_dto::UpdateTag,
};
use crate::{
    access,
    error::{ApiError, ApiResult, ErrorBody},
    extract::{ApiJson, ApiPath, AuthUser},
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(list_tags, create_tag)).routes(routes!(update_tag, delete_tag))
}

fn clean_label(raw: &str) -> ApiResult<String> {
    board::clean_text(raw, MAX_TAG_LEN)
        .ok_or_else(|| ApiError::BadRequest(format!("Название метки: от 1 до {MAX_TAG_LEN} символов")))
}

fn check_tone(tone: i16) -> ApiResult<()> {
    (0..TONE_COUNT)
        .contains(&tone)
        .then_some(())
        .ok_or_else(|| ApiError::BadRequest(format!("Цвет метки: число от 0 до {}", TONE_COUNT - 1)))
}

/// Метки проекта в порядке создания
#[utoipa::path(
    get,
    path = "/projects/{id}/tags",
    tag = "tags",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Проект")),
    responses(
        (status = 200, description = "Метки проекта", body = [TagDto]),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого проекта", body = ErrorBody),
    )
)]
async fn list_tags(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(project_id): ApiPath<Uuid>,
) -> ApiResult<Json<Vec<TagDto>>> {
    let mut conn = state.pool.acquire().await?;
    access::project(&mut *conn, auth, project_id).await?;
    Ok(Json(db::tags::list(&mut *conn, project_id).await?.into_iter().map(TagDto::from).collect()))
}

/// Создать метку в проекте (любой участник). Регистр не важен: если такая уже есть, вернётся она (200), а не дубль.
#[utoipa::path(
    post,
    path = "/projects/{id}/tags",
    tag = "tags",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Проект")),
    request_body = CreateTag,
    responses(
        (status = 201, description = "Метка создана", body = TagDto),
        (status = 200, description = "Такая метка уже есть", body = TagDto),
        (status = 400, description = "Некорректный запрос", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого проекта", body = ErrorBody),
    )
)]
async fn create_tag(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(project_id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<CreateTag>,
) -> ApiResult<(StatusCode, Json<TagDto>)> {
    let label = clean_label(&req.label)?;
    if let Some(tone) = req.tone {
        check_tone(tone)?;
    }

    let mut conn = state.pool.acquire().await?;
    access::project(&mut *conn, auth, project_id).await?;
    if let Some(existing) = db::tags::find_by_label(&mut *conn, project_id, &label).await? {
        return Ok((StatusCode::OK, Json(existing.into())));
    }
    match db::tags::insert(&mut conn, project_id, &label, req.tone).await {
        Ok(tag) => Ok((StatusCode::CREATED, Json(tag.into()))),
        // два участника одновременно создали одну и ту же метку: побеждает первый
        Err(db::sqlx::Error::Database(e)) if e.is_unique_violation() => {
            let existing = db::tags::find_by_label(&mut *conn, project_id, &label).await?.ok_or(ApiError::NotFound)?;
            Ok((StatusCode::OK, Json(existing.into())))
        }
        Err(e) => Err(e.into()),
    }
}

/// Переименовать метку или сменить цвет (администратор проекта)
#[utoipa::path(
    patch,
    path = "/tags/{id}",
    tag = "tags",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Метка")),
    request_body = UpdateTag,
    responses(
        (status = 200, description = "Метка после изменений", body = TagDto),
        (status = 400, description = "Некорректный запрос", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 403, description = "Нужны права администратора проекта", body = ErrorBody),
        (status = 404, description = "Нет такой метки", body = ErrorBody),
        (status = 409, description = "В проекте уже есть метка с таким названием", body = ErrorBody),
    )
)]
async fn update_tag(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<UpdateTag>,
) -> ApiResult<Json<TagDto>> {
    let label = req.label.as_deref().map(clean_label).transpose()?;
    if let Some(tone) = req.tone {
        check_tone(tone)?;
    }

    let mut tx = state.pool.begin().await?;
    let tag = db::tags::get(&mut *tx, id).await?.ok_or(ApiError::NotFound)?;
    access::admin_locked(&mut tx, auth, tag.project_id).await?;
    if let Some(label) = &label
        && let Some(other) = db::tags::find_by_label(&mut *tx, tag.project_id, label).await?
        && other.id != id
    {
        return Err(ApiError::Conflict("В проекте уже есть метка с таким названием".into()));
    }
    let tag = db::tags::update(&mut tx, id, &db::tags::TagPatch { label, tone: req.tone }).await?;
    tx.commit().await?;
    Ok(Json(tag.into()))
}

/// Удалить метку, с задач она снимается (администратор проекта)
#[utoipa::path(
    delete,
    path = "/tags/{id}",
    tag = "tags",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Метка")),
    responses(
        (status = 204, description = "Метка удалена"),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 403, description = "Нужны права администратора проекта", body = ErrorBody),
        (status = 404, description = "Нет такой метки", body = ErrorBody),
    )
)]
async fn delete_tag(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    let tag = db::tags::get(&mut *tx, id).await?.ok_or(ApiError::NotFound)?;
    access::admin_locked(&mut tx, auth, tag.project_id).await?;
    db::tags::delete(&mut tx, id).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
