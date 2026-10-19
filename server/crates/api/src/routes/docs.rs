//! Документы и холст. Название и текст живут под одной версией (`rev`): если за время правки их изменил другой
//! участник, сохранение отвечает 409 и отдаёт актуальную версию. Холст (объекты и стрелки) сохраняется целиком
//! одним запросом, без версии: последнее сохранение побеждает. Запись в ленту активности делается в той же
//! транзакции, что и действие.

use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use db::{
    docs::{CanvasError, Patch, PlaceError},
    sqlx::PgConnection,
};
use domain::docs::{self, MAX_MD_LEN, MAX_TITLE_LEN, NEW_NOTE, Note, Object};
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::docs_dto::{
    CanvasDto, CreateDoc, DocConflictDto, DocDto, DocMode, DocSummaryDto, ListDocsQuery, SavedCanvasDto, SetStar,
    UpdateDoc,
};
use crate::{
    error::{ApiError, ApiResult, ErrorBody},
    extract::{ApiJson, ApiPath, ApiQuery, AuthUser},
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_docs, create_doc))
        .routes(routes!(get_doc, update_doc, delete_doc))
        .routes(routes!(set_star))
        .routes(routes!(put_canvas))
}

const CONFLICT_MESSAGE: &str = "Документ изменил другой участник";
const MAX_QUERY_LEN: usize = 200;

fn bad(message: impl Into<String>) -> ApiError {
    ApiError::BadRequest(message.into())
}

fn clean_title(raw: &str) -> ApiResult<String> {
    docs::clean_title(raw).ok_or_else(|| bad(format!("Название: не длиннее {MAX_TITLE_LEN} символов")))
}

/// Текст документа: переводы строк приводятся к `\n`, как в редакторе
fn clean_md(raw: &str) -> ApiResult<String> {
    if raw.chars().count() > MAX_MD_LEN {
        return Err(bad(format!("Текст документа длиннее {MAX_MD_LEN} символов")));
    }
    Ok(raw.replace("\r\n", "\n"))
}

/// Документ вместе с холстом
async fn load(conn: &mut PgConnection, doc: db::docs::Doc) -> ApiResult<DocDto> {
    let objects = db::docs::objects_of(&mut *conn, &[doc.id]).await?;
    let links = db::docs::links_of(&mut *conn, doc.id).await?;
    Ok(DocDto::build(doc, objects, links))
}

/// Документы в порядке списка, без текста
///
/// Порядок общий для команды (его меняют перетаскиванием карточек), новые документы встают первыми. У каждого
/// документа есть фрагмент текста и счётчик объектов холста; объекты для миниатюры приходят только у документов в
/// режиме «Холст».
#[utoipa::path(
    get,
    path = "/docs",
    tag = "docs",
    security(("bearer" = [])),
    params(ListDocsQuery),
    responses(
        (status = 200, description = "Документы", body = [DocSummaryDto]),
        (status = 400, description = "Некорректные условия отбора", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
    )
)]
async fn list_docs(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiQuery(req): ApiQuery<ListDocsQuery>,
) -> ApiResult<Json<Vec<DocSummaryDto>>> {
    let query = req.q.as_deref().map(str::trim).filter(|q| !q.is_empty());
    if query.is_some_and(|q| q.chars().count() > MAX_QUERY_LEN) {
        return Err(bad(format!("Поиск: не длиннее {MAX_QUERY_LEN} символов")));
    }
    let items =
        db::docs::list(&state.pool, auth.id, query, req.starred.unwrap_or(false), docs::SNIPPET_SOURCE_LEN as i32)
            .await?;
    let edge: Vec<Uuid> = items.iter().filter(|d| d.mode == "edge" && d.object_count > 0).map(|d| d.id).collect();
    let objects = if edge.is_empty() { Vec::new() } else { db::docs::objects_of(&state.pool, &edge).await? };
    Ok(Json(DocSummaryDto::build(items, objects)))
}

/// Документ вместе с текстом и холстом
#[utoipa::path(
    get,
    path = "/docs/{id}",
    tag = "docs",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Документ")),
    responses(
        (status = 200, description = "Документ", body = DocDto),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого документа", body = ErrorBody),
    )
)]
async fn get_doc(auth: AuthUser, State(state): State<AppState>, ApiPath(id): ApiPath<Uuid>) -> ApiResult<Json<DocDto>> {
    let mut conn = state.pool.acquire().await?;
    let doc = db::docs::get(&mut *conn, id, auth.id).await?.ok_or(ApiError::NotFound)?;
    Ok(Json(load(&mut conn, doc).await?))
}

/// Новый документ в начало списка. В ленту пишется «создан» или «создан как холст».
#[utoipa::path(
    post,
    path = "/docs",
    tag = "docs",
    security(("bearer" = [])),
    request_body = CreateDoc,
    responses(
        (status = 201, description = "Документ создан", body = DocDto),
        (status = 400, description = "Некорректный запрос", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
    )
)]
async fn create_doc(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiJson(req): ApiJson<CreateDoc>,
) -> ApiResult<(StatusCode, Json<DocDto>)> {
    let title = req.title.as_deref().map(clean_title).transpose()?.unwrap_or_default();
    let md = req.md.as_deref().map(clean_md).transpose()?.unwrap_or_default();
    let mode = req.mode.unwrap_or(DocMode::Page);

    let mut tx = state.pool.begin().await?;
    db::docs::lock(&mut tx).await?;
    let id = db::docs::insert(&mut tx, &title, &md, mode.as_str(), NEW_NOTE, auth.id).await?;
    db::activity::insert(&mut tx, auth.id, None, "doc", &docs::target(&title), docs::created_text(mode.as_str()))
        .await?;
    let doc = db::docs::get(&mut *tx, id, auth.id).await?.ok_or(ApiError::NotFound)?;
    let dto = load(&mut tx, doc).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(dto)))
}

/// Название, текст, режим и место в списке.
///
/// Для названия и текста нужен `rev`; если он не совпал с текущим, ответ 409 с актуальной версией, и ничего не
/// записывается. Правки текста в ленту не пишутся: их много, и они не событие для команды.
///
/// Режим («Страница» или «Холст») и перенос (`before_id`) версию не проверяют и не меняют: это вид и место в списке,
/// а не содержимое, поэтому переключение режима открытого и редактируемого документа не приводит к конфликту с его
/// собственным сохранением. `before_id` — перед каким документом встать (`null`: в конец списка).
#[utoipa::path(
    patch,
    path = "/docs/{id}",
    tag = "docs",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Документ")),
    request_body = UpdateDoc,
    responses(
        (status = 200, description = "Документ после изменений", body = DocDto),
        (status = 400, description = "Некорректный запрос", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого документа", body = ErrorBody),
        (status = 409, description = "Документ уже изменили, в current его актуальная версия", body = DocConflictDto),
    )
)]
async fn update_doc(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<UpdateDoc>,
) -> ApiResult<Response> {
    let title = req.title.as_deref().map(clean_title).transpose()?;
    let md = req.md.as_deref().map(clean_md).transpose()?;

    let content = title.is_some() || md.is_some();
    if content && req.rev.is_none() {
        return Err(bad("Чтобы изменить название или текст, нужна версия документа (rev)"));
    }
    let moving = req.before_id.is_some();

    let mut tx = state.pool.begin().await?;
    if moving {
        // перенос меняет позиции соседей: по очереди с созданием и другими переносами
        db::docs::lock(&mut tx).await?;
    }
    let doc = db::docs::get_for_update(&mut tx, id, auth.id).await?.ok_or(ApiError::NotFound)?;

    if content {
        if req.rev != Some(doc.rev) {
            let body = DocConflictDto {
                code: "conflict".to_owned(),
                message: CONFLICT_MESSAGE.to_owned(),
                current: load(&mut tx, doc).await?,
            };
            return Ok((StatusCode::CONFLICT, Json(body)).into_response());
        }
        let patch =
            Patch { title: title.as_deref().filter(|t| *t != doc.title), md: md.as_deref().filter(|m| *m != doc.md) };
        // ничего не изменилось: версию не поднимаем
        if patch.title.is_some() || patch.md.is_some() {
            db::docs::update_content(&mut tx, id, &patch, auth.id).await?;
        }
    }

    if let Some(mode) = req.mode
        && mode.as_str() != doc.mode
    {
        db::docs::set_mode(&mut tx, id, mode.as_str()).await?;
    }

    if let Some(before) = req.before_id {
        db::docs::place(&mut tx, id, before).await.map_err(|e| match e {
            PlaceError::BeforeNotFound => bad("Документ, перед которым нужно встать, не найден"),
            PlaceError::Db(e) => e.into(),
        })?;
    }

    let doc = db::docs::get(&mut *tx, id, auth.id).await?.ok_or(ApiError::NotFound)?;
    let dto = load(&mut tx, doc).await?;
    tx.commit().await?;
    Ok(Json(dto).into_response())
}

/// Удалить документ вместе с холстом и звёздочками. В ленту пишется «удалён».
#[utoipa::path(
    delete,
    path = "/docs/{id}",
    tag = "docs",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Документ")),
    responses(
        (status = 204, description = "Документ удалён"),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого документа", body = ErrorBody),
    )
)]
async fn delete_doc(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    let doc = db::docs::get_for_update(&mut tx, id, auth.id).await?.ok_or(ApiError::NotFound)?;
    db::docs::delete(&mut tx, id).await?;
    db::activity::insert(&mut tx, auth.id, None, "doc", &docs::target(&doc.title), "удалён").await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Поставить или снять свою звёздочку. Звёздочка у каждого участника своя; повторный запрос ничего не меняет.
#[utoipa::path(
    put,
    path = "/docs/{id}/star",
    tag = "docs",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Документ")),
    request_body = SetStar,
    responses(
        (status = 204, description = "Звёздочка стоит или снята"),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого документа", body = ErrorBody),
    )
)]
async fn set_star(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<SetStar>,
) -> ApiResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    db::docs::get_for_update(&mut tx, id, auth.id).await?.ok_or(ApiError::NotFound)?;
    db::docs::set_star(&mut tx, id, auth.id, req.starred).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Сохранить холст целиком: карточку с текстом, объекты и стрелки.
///
/// Тело — полный список: объекты, которых в нём нет, удаляются вместе со своими стрелками, остальные обновляются,
/// новые добавляются. Идентификаторы объектов выдаёт клиент. Всё происходит в одной транзакции: если что-то не
/// прошло проверку, холст остаётся прежним. Версия текста не меняется, время правки документа обновляется.
#[utoipa::path(
    put,
    path = "/docs/{id}/canvas",
    tag = "docs",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Документ")),
    request_body = CanvasDto,
    responses(
        (status = 200, description = "Холст после сохранения", body = SavedCanvasDto),
        (status = 400, description = "Холст не прошёл проверку", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого документа", body = ErrorBody),
    )
)]
async fn put_canvas(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<CanvasDto>,
) -> ApiResult<Json<SavedCanvasDto>> {
    let note: Note = req.note.into();
    let objects: Vec<Object> = req.objects.into_iter().map(Into::into).collect();
    let links: Vec<docs::Link> = req.links.into_iter().map(Into::into).collect();
    docs::check_canvas(&note, &objects, &links).map_err(bad)?;

    let mut tx = state.pool.begin().await?;
    db::docs::get_for_update(&mut tx, id, auth.id).await?.ok_or(ApiError::NotFound)?;
    db::docs::replace_canvas(&mut tx, id, note, &objects, &links, auth.id).await.map_err(|e| match e {
        CanvasError::ObjectTaken => bad("Идентификатор объекта уже занят объектом другого документа"),
        CanvasError::Db(e) => e.into(),
    })?;
    let saved = db::docs::objects_of(&mut *tx, &[id]).await?;
    let saved_links = db::docs::links_of(&mut *tx, id).await?;
    let canvas_rev = db::docs::get(&mut *tx, id, auth.id).await?.ok_or(ApiError::NotFound)?.canvas_rev;
    tx.commit().await?;
    Ok(Json(SavedCanvasDto {
        canvas_rev,
        note: note.into(),
        objects: saved.into_iter().map(Into::into).collect(),
        links: saved_links.into_iter().map(|(a, b)| super::docs_dto::CanvasLinkDto { a, b }).collect(),
    }))
}
