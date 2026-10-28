//! Страницы вики команды (docs/TEAMS.md, раздел 7). Одна версия (`rev`) на всю страницу: если за время правки её изменил другой участник,
//! сохранение отвечает 409 и отдаёт актуальную версию. Запись в ленту активности делается в той же транзакции.

use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use db::{
    sqlx::PgConnection,
    wiki::{Patch, PlaceError},
};
use domain::wiki::{self, MAX_MD_LEN, MAX_TITLE_LEN};
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::library_dto::{CreateWikiPage, UpdateWikiPage, WikiConflictDto, WikiNodeDto, WikiPageDto};
use crate::{
    access,
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

/// Родитель должен существовать и лежать в той же команде
async fn check_parent(conn: &mut PgConnection, team_id: Uuid, parent_id: Uuid) -> ApiResult<()> {
    let parent = db::wiki::get(&mut *conn, parent_id).await?;
    parent.filter(|p| p.team_id == team_id).ok_or_else(|| bad("Родительская страница не найдена"))?;
    Ok(())
}

/// Дерево страниц команды без текста, соседи в порядке `position`
#[utoipa::path(
    get,
    path = "/teams/{id}/wiki",
    tag = "wiki",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Команда")),
    responses(
        (status = 200, description = "Все страницы вики команды", body = [WikiNodeDto]),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такой команды или вики её не читать", body = ErrorBody),
    )
)]
async fn list_pages(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(team_id): ApiPath<Uuid>,
) -> ApiResult<Json<Vec<WikiNodeDto>>> {
    access::wiki_read(&state.pool, auth, team_id).await?;
    let pages = db::wiki::list(&state.pool, team_id).await?;
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
        (status = 404, description = "Нет такой страницы или вики её команды не читать", body = ErrorBody),
    )
)]
async fn get_page(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<Json<WikiPageDto>> {
    let page = db::wiki::get(&state.pool, id).await?.ok_or(ApiError::NotFound)?;
    access::wiki_read(&state.pool, auth, page.team_id).await?;
    Ok(Json(page.into()))
}

/// Новая страница в конец списка вложенных в `parent_id` (или в корень). В ленту пишется «создана».
#[utoipa::path(
    post,
    path = "/teams/{id}/wiki",
    tag = "wiki",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Команда")),
    request_body = CreateWikiPage,
    responses(
        (status = 201, description = "Страница создана", body = WikiPageDto),
        (status = 400, description = "Некорректный запрос или нет такого родителя", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 403, description = "Вики команды можно только читать (гость)", body = ErrorBody),
        (status = 404, description = "Нет такой команды или вики её не читать", body = ErrorBody),
    )
)]
async fn create_page(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(team_id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<CreateWikiPage>,
) -> ApiResult<(StatusCode, Json<WikiPageDto>)> {
    let title = req.title.as_deref().map(clean_title).transpose()?.unwrap_or_default();
    let md = req.md.as_deref().map(clean_md).transpose()?.unwrap_or_default();

    let mut tx = state.pool.begin().await?;
    access::wiki_write(&mut *tx, auth, team_id).await?;
    db::wiki::lock(&mut tx, team_id).await?;
    if let Some(parent) = req.parent_id {
        check_parent(&mut tx, team_id, parent).await?;
    }
    let page = db::wiki::insert(&mut tx, team_id, req.parent_id, &title, &md, auth.id).await?;
    db::activity::insert_team(&mut tx, auth.id, team_id, "wiki", &wiki::target(&page.title), "создана").await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(page.into())))
}

/// Название и текст страницы, а также её место в дереве.
///
/// Для названия и текста нужен `rev`; если он не совпал с текущим, ответ 409 с актуальной версией, и ничего не
/// записывается. Правки текста в ленту не пишутся: их много, и они не событие для команды.
///
/// Перенос (`parent_id` и `before_id`) версию не проверяет и не меняет: это место в дереве, а не содержимое, поэтому
/// перенос открытой и редактируемой страницы не приводит к конфликту с её собственным сохранением.
/// `parent_id` — новый родитель (`null`: корень), `before_id` — перед какой страницей встать среди страниц этого
/// родителя (`null`: в конец). Если передан только `before_id`, страница остаётся у своего родителя.
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
        (status = 403, description = "Вики команды можно только читать (гость)", body = ErrorBody),
        (status = 404, description = "Нет такой страницы или вики её команды не читать", body = ErrorBody),
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

    let content = title.is_some() || md.is_some();
    if content && req.rev.is_none() {
        return Err(bad("Чтобы изменить название или текст, нужна версия страницы (rev)"));
    }
    let moving = req.parent_id.is_some() || req.before_id.is_some();

    let mut tx = state.pool.begin().await?;
    let team_id = db::wiki::team_of(&mut *tx, id).await?.ok_or(ApiError::NotFound)?;
    access::wiki_write(&mut *tx, auth, team_id).await?;
    if moving {
        // перенос меняет позиции соседей и опирается на проверку цикла: по очереди с созданием и удалением страниц
        db::wiki::lock(&mut tx, team_id).await?;
    }
    let mut page = db::wiki::get_for_update(&mut tx, id).await?.ok_or(ApiError::NotFound)?;

    if content {
        if req.rev != Some(page.rev) {
            let body = WikiConflictDto {
                code: "conflict".to_owned(),
                message: CONFLICT_MESSAGE.to_owned(),
                current: page.into(),
            };
            return Ok((StatusCode::CONFLICT, Json(body)).into_response());
        }
        let patch =
            Patch { title: title.as_deref().filter(|t| *t != page.title), md: md.as_deref().filter(|m| *m != page.md) };
        // ничего не изменилось: версию не поднимаем
        if patch.title.is_some() || patch.md.is_some() {
            page = db::wiki::update(&mut tx, id, &patch, auth.id).await?;
        }
    }

    if moving {
        let parent = req.parent_id.unwrap_or(page.parent_id);
        if let Some(parent) = parent
            && req.parent_id.is_some()
        {
            check_parent(&mut tx, team_id, parent).await?;
            if db::wiki::in_subtree(&mut tx, id, parent).await? {
                return Err(bad("Страницу нельзя перенести внутрь неё самой или её вложенных страниц"));
            }
        }
        // новый родитель без `before_id` — в конец его списка
        let before = req.before_id.flatten();
        page = db::wiki::place(&mut tx, &page, parent, before).await.map_err(|e| match e {
            PlaceError::BeforeNotFound => {
                bad("Страница, перед которой нужно встать, не найдена среди страниц этого родителя")
            }
            PlaceError::Db(e) => e.into(),
        })?;
    }

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
        (status = 403, description = "Вики команды можно только читать (гость)", body = ErrorBody),
        (status = 404, description = "Нет такой страницы или вики её команды не читать", body = ErrorBody),
    )
)]
async fn delete_page(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    let team_id = db::wiki::team_of(&mut *tx, id).await?.ok_or(ApiError::NotFound)?;
    access::wiki_write(&mut *tx, auth, team_id).await?;
    db::wiki::lock(&mut tx, team_id).await?;
    let page = db::wiki::get_for_update(&mut tx, id).await?.ok_or(ApiError::NotFound)?;
    let nested = db::wiki::subtree_size(&mut tx, id).await? - 1;
    db::wiki::delete(&mut tx, id).await?;
    let text = if nested > 0 {
        format!("удалена вместе с вложенными ({nested})")
    } else {
        "удалена".to_owned()
    };
    db::activity::insert_team(&mut tx, auth.id, team_id, "wiki", &wiki::target(&page.title), &text).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
