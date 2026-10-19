//! Страницы вики. Одна версия (`rev`) на всю страницу: если за время правки её изменил другой участник,
//! сохранение отвечает 409 и отдаёт актуальную версию. Запись в ленту активности делается в той же транзакции.

use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use db::{sqlx::PgConnection, wiki::Patch};
use domain::wiki::{self, MAX_MD_LEN, MAX_TITLE_LEN};
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::library_dto::{CreateWikiPage, UpdateWikiPage, WikiConflictDto, WikiNodeDto, WikiPageDto};
use crate::{
    error::{ApiError, ApiResult, ErrorBody},
    extract::{ApiJson, ApiPath, AuthUser},
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(list_pages, create_page)).routes(routes!(get_page, update_page, delete_page))
}

const CONFLICT_MESSAGE: &str = "Страницу изменил другой участник";

fn bad(message: impl Into<String>) -> ApiError {
    ApiError::BadRequest(message.into())
}

fn clean_title(raw: &str) -> ApiResult<String> {
    wiki::clean_title(raw).ok_or_else(|| bad(format!("Название: не длиннее {MAX_TITLE_LEN} символов")))
}

/// Текст страницы: переводы строк приводятся к `\n`, как в редакторе
fn clean_md(raw: &str) -> ApiResult<String> {
    if raw.chars().count() > MAX_MD_LEN {
        return Err(bad(format!("Текст страницы длиннее {MAX_MD_LEN} символов")));
    }
    Ok(raw.replace("\r\n", "\n"))
}

/// Родитель должен существовать
async fn check_parent(conn: &mut PgConnection, parent_id: Uuid) -> ApiResult<()> {
    db::wiki::get(&mut *conn, parent_id).await?.ok_or_else(|| bad("Родительская страница не найдена"))?;
    Ok(())
}

/// Дерево страниц без текста, соседи в порядке `position`
#[utoipa::path(
    get,
    path = "/wiki",
    tag = "wiki",
    security(("bearer" = [])),
    responses(
        (status = 200, description = "Все страницы вики", body = [WikiNodeDto]),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
    )
)]
async fn list_pages(_auth: AuthUser, State(state): State<AppState>) -> ApiResult<Json<Vec<WikiNodeDto>>> {
    let pages = db::wiki::list(&state.pool).await?;
    Ok(Json(pages.into_iter().map(Into::into).collect()))
}

/// Страница вместе с текстом
#[utoipa::path(
    get,
    path = "/wiki/{id}",
    tag = "wiki",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Страница")),
    responses(
        (status = 200, description = "Страница", body = WikiPageDto),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такой страницы", body = ErrorBody),
    )
)]
async fn get_page(
    _auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<Json<WikiPageDto>> {
    let page = db::wiki::get(&state.pool, id).await?.ok_or(ApiError::NotFound)?;
    Ok(Json(page.into()))
}

/// Новая страница в конец списка вложенных в `parent_id` (или в корень). В ленту пишется «создана».
#[utoipa::path(
    post,
    path = "/wiki",
    tag = "wiki",
    security(("bearer" = [])),
    request_body = CreateWikiPage,
    responses(
        (status = 201, description = "Страница создана", body = WikiPageDto),
        (status = 400, description = "Некорректный запрос или нет такого родителя", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
    )
)]
async fn create_page(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiJson(req): ApiJson<CreateWikiPage>,
) -> ApiResult<(StatusCode, Json<WikiPageDto>)> {
    let title = req.title.as_deref().map(clean_title).transpose()?.unwrap_or_default();
    let md = req.md.as_deref().map(clean_md).transpose()?.unwrap_or_default();

    let mut tx = state.pool.begin().await?;
    db::wiki::lock(&mut tx).await?;
    if let Some(parent) = req.parent_id {
        check_parent(&mut tx, parent).await?;
    }
    let page = db::wiki::insert(&mut tx, req.parent_id, &title, &md, auth.id).await?;
    db::activity::insert(&mut tx, auth.id, None, "doc", &wiki::target(&page.title), "создана").await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(page.into())))
}

/// Название, текст или родитель страницы. Если `rev` не совпал с текущим, ответ 409 с актуальной версией.
/// Правки текста в ленту не пишутся: их много, и они не событие для команды.
#[utoipa::path(
    patch,
    path = "/wiki/{id}",
    tag = "wiki",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Страница")),
    request_body = UpdateWikiPage,
    responses(
        (status = 200, description = "Страница после изменений", body = WikiPageDto),
        (status = 400, description = "Некорректный запрос или перенос страницы внутрь себя", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такой страницы", body = ErrorBody),
        (status = 409, description = "Страницу уже изменили, в current её актуальная версия", body = WikiConflictDto),
    )
)]
async fn update_page(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<UpdateWikiPage>,
) -> ApiResult<Response> {
    let title = req.title.as_deref().map(clean_title).transpose()?;
    let md = req.md.as_deref().map(clean_md).transpose()?;

    let mut tx = state.pool.begin().await?;
    if req.parent_id.is_some() {
        // перенос меняет и позиции соседей, и проверку на цикл: всё это по очереди с созданием страниц
        db::wiki::lock(&mut tx).await?;
    }
    let current = db::wiki::get_for_update(&mut tx, id).await?.ok_or(ApiError::NotFound)?;
    if current.rev != req.rev {
        let body = WikiConflictDto {
            code: "conflict".to_owned(),
            message: CONFLICT_MESSAGE.to_owned(),
            current: current.into(),
        };
        return Ok((StatusCode::CONFLICT, Json(body)).into_response());
    }

    let parent_id = match req.parent_id {
        Some(Some(parent)) => {
            check_parent(&mut tx, parent).await?;
            if db::wiki::in_subtree(&mut tx, id, parent).await? {
                return Err(bad("Страницу нельзя перенести внутрь неё самой или её вложенных страниц"));
            }
            Some(Some(parent))
        }
        other => other,
    };
    let patch = Patch {
        title: title.as_deref().filter(|t| *t != current.title),
        md: md.as_deref().filter(|m| *m != current.md),
        parent_id: parent_id.filter(|p| *p != current.parent_id),
    };
    if patch.title.is_none() && patch.md.is_none() && patch.parent_id.is_none() {
        // ничего не изменилось: версию не поднимаем
        return Ok(Json(WikiPageDto::from(current)).into_response());
    }
    let page = db::wiki::update(&mut tx, id, &patch, auth.id).await?;
    tx.commit().await?;
    Ok(Json(WikiPageDto::from(page)).into_response())
}

/// Удалить страницу вместе с вложенными. Прикреплённые файлы остаются в библиотеке без страницы.
#[utoipa::path(
    delete,
    path = "/wiki/{id}",
    tag = "wiki",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Страница")),
    responses(
        (status = 204, description = "Страница удалена"),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такой страницы", body = ErrorBody),
    )
)]
async fn delete_page(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    db::wiki::lock(&mut tx).await?;
    let page = db::wiki::get_for_update(&mut tx, id).await?.ok_or(ApiError::NotFound)?;
    let nested = db::wiki::subtree_size(&mut tx, id).await? - 1;
    db::wiki::delete(&mut tx, id).await?;
    let text = if nested > 0 {
        format!("удалена вместе с вложенными ({nested})")
    } else {
        "удалена".to_owned()
    };
    db::activity::insert(&mut tx, auth.id, None, "doc", &wiki::target(&page.title), &text).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
