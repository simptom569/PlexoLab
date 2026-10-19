use axum::{Json, extract::State};
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::dto::{BoardDto, ProjectDto, TaskCardDto};
use crate::{
    error::{ApiError, ApiResult, ErrorBody},
    extract::{ApiPath, AuthUser},
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(list_projects)).routes(routes!(board))
}

/// Проекты в порядке создания
#[utoipa::path(
    get,
    path = "/projects",
    tag = "projects",
    security(("bearer" = [])),
    responses(
        (status = 200, description = "Все проекты", body = [ProjectDto]),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
    )
)]
async fn list_projects(_auth: AuthUser, State(state): State<AppState>) -> ApiResult<Json<Vec<ProjectDto>>> {
    Ok(Json(db::projects::list(&state.pool).await?.into_iter().map(ProjectDto::from).collect()))
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
    _auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(project_id): ApiPath<Uuid>,
) -> ApiResult<Json<BoardDto>> {
    let mut conn = state.pool.acquire().await?;
    let project = db::projects::get(&mut *conn, project_id).await?.ok_or(ApiError::NotFound)?;
    let columns = db::columns::list(&mut *conn, project_id).await?;
    let cards = db::tasks::list_cards(&mut *conn, project_id).await?;
    let tags = db::tags::list(&mut *conn).await?;
    let modules = db::modules::list_modules(&mut *conn, project_id).await?;
    let milestones = db::modules::list_milestones(&mut *conn, project_id).await?;

    Ok(Json(BoardDto {
        tasks: cards.into_iter().map(|c| TaskCardDto::new(c, &project.key)).collect(),
        project: project.into(),
        columns: columns.into_iter().map(Into::into).collect(),
        tags: tags.into_iter().map(Into::into).collect(),
        modules: modules.into_iter().map(Into::into).collect(),
        milestones: milestones.into_iter().map(Into::into).collect(),
    }))
}
