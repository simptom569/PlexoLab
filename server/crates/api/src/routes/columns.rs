use axum::{Json, extract::State, http::StatusCode};
use domain::board::{self, MAX_COLUMN_TITLE_LEN};
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::dto::{ColumnDto, CreateColumn, DeleteColumnQuery, UpdateColumn};
use crate::{
    access,
    error::{ApiError, ApiResult, ErrorBody},
    extract::{ApiJson, ApiPath, ApiQuery, AuthUser},
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(create_column)).routes(routes!(update_column, delete_column))
}

fn clean_title(raw: &str) -> ApiResult<String> {
    board::clean_text(raw, MAX_COLUMN_TITLE_LEN)
        .ok_or_else(|| ApiError::BadRequest(format!("Название колонки: от 1 до {MAX_COLUMN_TITLE_LEN} символов")))
}

fn check_color(color: &str) -> ApiResult<()> {
    board::is_column_color(color)
        .then_some(())
        .ok_or_else(|| ApiError::BadRequest(format!("Цвет колонки: один из {}", board::COLUMN_COLORS.join(", "))))
}

/// Новая колонка в конце доски
#[utoipa::path(
    post,
    path = "/projects/{id}/columns",
    tag = "columns",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Проект")),
    request_body = CreateColumn,
    responses(
        (status = 201, description = "Колонка создана", body = ColumnDto),
        (status = 400, description = "Некорректный запрос", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого проекта", body = ErrorBody),
    )
)]
async fn create_column(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(project_id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<CreateColumn>,
) -> ApiResult<(StatusCode, Json<ColumnDto>)> {
    let title = clean_title(&req.title)?;
    if let Some(color) = &req.color {
        check_color(color)?;
    }

    let mut tx = state.pool.begin().await?;
    access::project_locked(&mut tx, auth, project_id).await?;
    let existing = db::columns::list(&mut *tx, project_id).await?.len();
    let color = req.color.as_deref().unwrap_or_else(|| board::default_column_color(existing));
    let column = db::columns::insert(&mut tx, project_id, &title, color, req.is_done.unwrap_or(false)).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(column.into())))
}

/// Переименовать, перекрасить, отметить «Готово» или переставить колонку (`before_id`)
#[utoipa::path(
    patch,
    path = "/columns/{id}",
    tag = "columns",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Колонка")),
    request_body = UpdateColumn,
    responses(
        (status = 200, description = "Колонка после изменений", body = ColumnDto),
        (status = 400, description = "Некорректный запрос", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такой колонки", body = ErrorBody),
    )
)]
async fn update_column(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<UpdateColumn>,
) -> ApiResult<Json<ColumnDto>> {
    let title = req.title.as_deref().map(clean_title).transpose()?;
    if let Some(color) = &req.color {
        check_color(color)?;
    }

    let mut tx = state.pool.begin().await?;
    let column = db::columns::get(&mut *tx, id).await?.ok_or(ApiError::NotFound)?;
    access::project_locked(&mut tx, auth, column.project_id).await?;
    // пока ждали блокировку, колонку могли удалить
    if db::columns::get(&mut *tx, id).await?.is_none() {
        return Err(ApiError::NotFound);
    }

    let mut column = db::columns::update(&mut tx, id, title.as_deref(), req.color.as_deref(), req.is_done).await?;
    if let Some(before) = req.before_id {
        column = db::columns::place(&mut tx, &column, before).await.map_err(|e| match e {
            db::columns::PlaceError::BeforeNotFound => {
                ApiError::BadRequest("Колонка before_id не найдена на этой доске".into())
            }
            db::columns::PlaceError::Db(e) => e.into(),
        })?;
    }
    tx.commit().await?;
    Ok(Json(column.into()))
}

/// Удалить колонку. Её задачи переезжают в конец другой колонки. Последнюю колонку удалить нельзя.
#[utoipa::path(
    delete,
    path = "/columns/{id}",
    tag = "columns",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Колонка"),
        ("move_to" = Option<Uuid>, Query, description = "Куда перенести задачи, по умолчанию первая из оставшихся колонок"),
    ),
    responses(
        (status = 204, description = "Колонка удалена, задачи перенесены"),
        (status = 400, description = "move_to не из этого проекта или совпадает с удаляемой колонкой", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такой колонки", body = ErrorBody),
        (status = 409, description = "Это последняя колонка проекта", body = ErrorBody),
    )
)]
async fn delete_column(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
    ApiQuery(query): ApiQuery<DeleteColumnQuery>,
) -> ApiResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    let column = db::columns::get(&mut *tx, id).await?.ok_or(ApiError::NotFound)?;
    access::project_locked(&mut tx, auth, column.project_id).await?;

    let all = db::columns::list(&mut *tx, column.project_id).await?;
    if !all.iter().any(|c| c.id == id) {
        return Err(ApiError::NotFound); // успели удалить, пока ждали блокировку
    }
    let others: Vec<_> = all.into_iter().filter(|c| c.id != id).collect();
    if others.is_empty() {
        return Err(ApiError::Conflict("Нельзя удалить единственную колонку".into()));
    }
    let target = match query.move_to {
        Some(to) => others
            .iter()
            .find(|c| c.id == to)
            .ok_or_else(|| ApiError::BadRequest("move_to должна быть другой колонкой этого проекта".into()))?,
        None => &others[0],
    };

    db::tasks::move_all(&mut tx, column.project_id, id, target.id).await?;
    db::columns::delete(&mut tx, id).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
