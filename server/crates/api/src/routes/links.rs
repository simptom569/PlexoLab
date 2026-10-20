//! Ссылки команды: группы со ссылками. В ленту активности ничего не пишется (в макете этих действий там нет).

use std::collections::HashMap;

use axum::{Json, extract::State, http::StatusCode};
use db::links::{Group, Link};
use domain::{
    board,
    links::{self, MAX_DESCRIPTION_LEN, MAX_GROUP_TITLE_LEN, MAX_LINK_TITLE_LEN, MAX_URL_LEN},
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use crate::{
    error::{ApiError, ApiResult, ErrorBody},
    extract::{ApiJson, ApiPath, AuthUser},
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_groups, create_group))
        .routes(routes!(update_group, delete_group))
        .routes(routes!(create_link))
        .routes(routes!(delete_link))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LinkDto {
    pub id: Uuid,
    pub group_id: Uuid,
    #[schema(example = "Репозиторий API")]
    pub title: String,
    /// Всегда с `http://` или `https://`
    #[schema(example = "https://example.com/git/api")]
    pub url: String,
    #[schema(example = "Сервер и мобильное API")]
    pub description: String,
}

impl From<Link> for LinkDto {
    fn from(l: Link) -> Self {
        LinkDto { id: l.id, group_id: l.group_id, title: l.title, url: l.url, description: l.description }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LinkGroupDto {
    pub id: Uuid,
    #[schema(example = "Код и сборка")]
    pub title: String,
    /// В порядке добавления
    pub links: Vec<LinkDto>,
}

impl LinkGroupDto {
    fn new(group: Group, links: Vec<Link>) -> Self {
        LinkGroupDto { id: group.id, title: group.title, links: links.into_iter().map(LinkDto::from).collect() }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateLinkGroup {
    pub title: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateLinkGroup {
    pub title: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateLink {
    pub title: String,
    /// Адрес; без `http://` и `https://` сервер добавит `https://`
    #[schema(example = "example.com/repo")]
    pub url: String,
    pub description: Option<String>,
}

fn bad(message: impl Into<String>) -> ApiError {
    ApiError::BadRequest(message.into())
}

fn clean_group_title(raw: &str) -> ApiResult<String> {
    board::clean_text(raw, MAX_GROUP_TITLE_LEN)
        .ok_or_else(|| bad(format!("Название группы: от 1 до {MAX_GROUP_TITLE_LEN} символов")))
}

/// Все группы со ссылками в порядке добавления
#[utoipa::path(
    get,
    path = "/link-groups",
    tag = "links",
    security(("bearer" = [])),
    responses(
        (status = 200, description = "Группы вместе со ссылками", body = [LinkGroupDto]),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
    )
)]
async fn list_groups(_auth: AuthUser, State(state): State<AppState>) -> ApiResult<Json<Vec<LinkGroupDto>>> {
    let mut conn = state.pool.acquire().await?;
    let groups = db::links::list_groups(&mut *conn).await?;
    let mut links: HashMap<Uuid, Vec<Link>> = HashMap::new();
    for link in db::links::list_links(&mut *conn).await? {
        links.entry(link.group_id).or_default().push(link);
    }
    let list = groups
        .into_iter()
        .map(|g| {
            let own = links.remove(&g.id).unwrap_or_default();
            LinkGroupDto::new(g, own)
        })
        .collect();
    Ok(Json(list))
}

/// Новая пустая группа в конце списка
#[utoipa::path(
    post,
    path = "/link-groups",
    tag = "links",
    security(("bearer" = [])),
    request_body = CreateLinkGroup,
    responses(
        (status = 201, description = "Группа создана", body = LinkGroupDto),
        (status = 400, description = "Некорректный запрос", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
    )
)]
async fn create_group(
    _auth: AuthUser,
    State(state): State<AppState>,
    ApiJson(req): ApiJson<CreateLinkGroup>,
) -> ApiResult<(StatusCode, Json<LinkGroupDto>)> {
    let title = clean_group_title(&req.title)?;
    let mut conn = state.pool.acquire().await?;
    let group = db::links::insert_group(&mut conn, &title).await?;
    Ok((StatusCode::CREATED, Json(LinkGroupDto::new(group, Vec::new()))))
}

/// Переименовать группу
#[utoipa::path(
    patch,
    path = "/link-groups/{id}",
    tag = "links",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Группа")),
    request_body = UpdateLinkGroup,
    responses(
        (status = 200, description = "Группа после изменений", body = LinkGroupDto),
        (status = 400, description = "Некорректный запрос", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такой группы", body = ErrorBody),
    )
)]
async fn update_group(
    _auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<UpdateLinkGroup>,
) -> ApiResult<Json<LinkGroupDto>> {
    let title = clean_group_title(&req.title)?;
    let mut tx = state.pool.begin().await?;
    let group = db::links::rename_group(&mut tx, id, &title).await?.ok_or(ApiError::NotFound)?;
    let links = db::links::list_links_of(&mut *tx, id).await?;
    tx.commit().await?;
    Ok(Json(LinkGroupDto::new(group, links)))
}

/// Удалить группу вместе со всеми её ссылками
#[utoipa::path(
    delete,
    path = "/link-groups/{id}",
    tag = "links",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Группа")),
    responses(
        (status = 204, description = "Группа удалена"),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такой группы", body = ErrorBody),
    )
)]
async fn delete_group(
    _auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    let mut conn = state.pool.acquire().await?;
    if db::links::delete_group(&mut conn, id).await? { Ok(StatusCode::NO_CONTENT) } else { Err(ApiError::NotFound) }
}

/// Новая ссылка в конце группы. Адрес без `http://` и `https://` получает `https://`.
#[utoipa::path(
    post,
    path = "/link-groups/{id}/links",
    tag = "links",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Группа")),
    request_body = CreateLink,
    responses(
        (status = 201, description = "Ссылка добавлена", body = LinkDto),
        (status = 400, description = "Некорректный запрос", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такой группы", body = ErrorBody),
    )
)]
async fn create_link(
    _auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(group_id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<CreateLink>,
) -> ApiResult<(StatusCode, Json<LinkDto>)> {
    let title = board::clean_text(&req.title, MAX_LINK_TITLE_LEN)
        .ok_or_else(|| bad(format!("Название ссылки: от 1 до {MAX_LINK_TITLE_LEN} символов")))?;
    let url = links::normalize_url(&req.url)
        .ok_or_else(|| bad(format!("Адрес: от 1 до {MAX_URL_LEN} символов, без переносов строк")))?;
    let description = req.description.as_deref().map_or("", str::trim);
    if description.chars().count() > MAX_DESCRIPTION_LEN {
        return Err(bad(format!("Описание длиннее {MAX_DESCRIPTION_LEN} символов")));
    }

    let mut tx = state.pool.begin().await?;
    db::links::lock_group(&mut tx, group_id).await?.ok_or(ApiError::NotFound)?;
    let link = db::links::insert_link(&mut tx, group_id, &title, &url, description).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(link.into())))
}

/// Удалить ссылку
#[utoipa::path(
    delete,
    path = "/links/{id}",
    tag = "links",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Ссылка")),
    responses(
        (status = 204, description = "Ссылка удалена"),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такой ссылки", body = ErrorBody),
    )
)]
async fn delete_link(
    _auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    let mut conn = state.pool.acquire().await?;
    if db::links::delete_link(&mut conn, id).await? { Ok(StatusCode::NO_CONTENT) } else { Err(ApiError::NotFound) }
}
