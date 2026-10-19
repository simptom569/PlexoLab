use axum::{Json, extract::State, http::StatusCode};
use domain::board::{self, MAX_TAG_LEN, TONE_COUNT};
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::dto::{CreateTag, TagDto};
use crate::{
    error::{ApiError, ApiResult, ErrorBody},
    extract::{ApiJson, ApiPath, AuthUser},
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(list_tags, create_tag)).routes(routes!(delete_tag))
}

/// Метки в порядке создания (общие для всех проектов)
#[utoipa::path(
    get,
    path = "/tags",
    tag = "tags",
    security(("bearer" = [])),
    responses(
        (status = 200, description = "Все метки", body = [TagDto]),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
    )
)]
async fn list_tags(_auth: AuthUser, State(state): State<AppState>) -> ApiResult<Json<Vec<TagDto>>> {
    Ok(Json(db::tags::list(&state.pool).await?.into_iter().map(TagDto::from).collect()))
}

/// Создать метку. Регистр не важен: если такая уже есть, вернётся она (200), а не дубль.
#[utoipa::path(
    post,
    path = "/tags",
    tag = "tags",
    security(("bearer" = [])),
    request_body = CreateTag,
    responses(
        (status = 201, description = "Метка создана", body = TagDto),
        (status = 200, description = "Такая метка уже есть", body = TagDto),
        (status = 400, description = "Некорректный запрос", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
    )
)]
async fn create_tag(
    _auth: AuthUser,
    State(state): State<AppState>,
    ApiJson(req): ApiJson<CreateTag>,
) -> ApiResult<(StatusCode, Json<TagDto>)> {
    let label = board::clean_text(&req.label, MAX_TAG_LEN)
        .ok_or_else(|| ApiError::BadRequest(format!("Название метки: от 1 до {MAX_TAG_LEN} символов")))?;
    if let Some(tone) = req.tone
        && !(0..TONE_COUNT).contains(&tone)
    {
        return Err(ApiError::BadRequest(format!("Цвет метки: число от 0 до {}", TONE_COUNT - 1)));
    }

    if let Some(existing) = db::tags::find_by_label(&state.pool, &label).await? {
        return Ok((StatusCode::OK, Json(existing.into())));
    }
    let mut conn = state.pool.acquire().await?;
    match db::tags::insert(&mut conn, &label, req.tone).await {
        Ok(tag) => Ok((StatusCode::CREATED, Json(tag.into()))),
        // два пользователя одновременно создали одну и ту же метку: побеждает первый
        Err(db::sqlx::Error::Database(e)) if e.is_unique_violation() => {
            let existing = db::tags::find_by_label(&mut *conn, &label).await?.ok_or(ApiError::NotFound)?;
            Ok((StatusCode::OK, Json(existing.into())))
        }
        Err(e) => Err(e.into()),
    }
}

/// Удалить метку, с задач она снимается
#[utoipa::path(
    delete,
    path = "/tags/{id}",
    tag = "tags",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Метка")),
    responses(
        (status = 204, description = "Метка удалена"),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такой метки", body = ErrorBody),
    )
)]
async fn delete_tag(
    _auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    let mut conn = state.pool.acquire().await?;
    if db::tags::delete(&mut conn, id).await? { Ok(StatusCode::NO_CONTENT) } else { Err(ApiError::NotFound) }
}
