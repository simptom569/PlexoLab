//! Поиск по названиям (docs/OFFLINE-NOTIFY-SEARCH.md, раздел 3): задачи и их id, документы, страницы вики, файлы
//! библиотеки. Содержимое не ищется. Задачи и документы только из проектов, где человек участник (глобальный
//! администратор видит все), без архивных; вики и файлы библиотеки общие для всех вошедших.

use axum::{Json, extract::State};
use domain::{
    board::{id_prefix, task_key},
    search::{LIMIT_PER_KIND, MAX_QUERY_LEN, QueryError, clean_query},
};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use crate::{
    access,
    error::{ApiError, ApiResult, ErrorBody},
    extract::{ApiQuery, AuthUser},
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(search))
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct SearchQuery {
    /// Что искать: часть названия или id задачи (`WEB-141`), без учёта регистра. Пустой запрос ничего не находит.
    pub q: Option<String>,
}

/// Задача в результатах
#[derive(Debug, Serialize, ToSchema)]
pub struct TaskHitDto {
    pub id: Uuid,
    pub project_id: Uuid,
    pub project_name: String,
    /// Id задачи для показа: `WEB-141`
    #[schema(example = "WEB-141")]
    pub key: String,
    pub title: String,
}

/// Документ в результатах
#[derive(Debug, Serialize, ToSchema)]
pub struct DocHitDto {
    pub id: Uuid,
    pub project_id: Uuid,
    pub project_name: String,
    /// Пустое название значит «без названия»
    pub title: String,
    /// page | edge
    pub mode: String,
}

/// Страница вики в результатах
#[derive(Debug, Serialize, ToSchema)]
pub struct WikiHitDto {
    pub id: Uuid,
    pub title: String,
}

/// Файл библиотеки в результатах
#[derive(Debug, Serialize, ToSchema)]
pub struct FileHitDto {
    pub id: Uuid,
    pub name: String,
    /// img | pdf | doc | sheet | zip | other
    pub kind: String,
    pub size_bytes: i64,
}

/// Результаты поиска: по восемь лучших каждого вида
#[derive(Debug, Serialize, ToSchema)]
pub struct SearchDto {
    pub tasks: Vec<TaskHitDto>,
    pub docs: Vec<DocHitDto>,
    pub wiki: Vec<WikiHitDto>,
    pub files: Vec<FileHitDto>,
}

impl SearchDto {
    fn empty() -> Self {
        SearchDto { tasks: Vec::new(), docs: Vec::new(), wiki: Vec::new(), files: Vec::new() }
    }
}

/// Поиск по названиям. Сначала точное совпадение, потом начало названия или id, потом остальное; внутри группы недавно
/// менявшееся выше. Пустой запрос даёт пустые списки.
#[utoipa::path(
    get,
    path = "/search",
    tag = "search",
    security(("bearer" = [])),
    params(SearchQuery),
    responses(
        (status = 200, description = "Найденное, по восемь лучших каждого вида", body = SearchDto),
        (status = 400, description = "Запрос длиннее ста символов", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
    )
)]
async fn search(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiQuery(req): ApiQuery<SearchQuery>,
) -> ApiResult<Json<SearchDto>> {
    let q = match clean_query(req.q.as_deref()) {
        Ok(Some(q)) => q,
        Ok(None) => return Ok(Json(SearchDto::empty())),
        Err(QueryError::TooLong) => {
            return Err(ApiError::BadRequest(format!("Поиск: не длиннее {MAX_QUERY_LEN} символов")));
        }
    };
    // вики и файлы библиотеки общие: доступ проверяется там же, где у их ручек
    access::wiki(auth)?;

    let pool = &state.pool;
    let tasks = db::search::tasks(pool, auth.id, &q, LIMIT_PER_KIND).await?;
    let docs = db::search::docs(pool, auth.id, &q, LIMIT_PER_KIND).await?;
    let wiki = db::search::wiki(pool, &q, LIMIT_PER_KIND).await?;
    let files = db::search::files(pool, &q, LIMIT_PER_KIND).await?;

    Ok(Json(SearchDto {
        tasks: tasks
            .into_iter()
            .map(|t| TaskHitDto {
                key: task_key(id_prefix(t.prefix.as_deref(), None), t.number),
                id: t.id,
                project_id: t.project_id,
                project_name: t.project_name,
                title: t.title,
            })
            .collect(),
        docs: docs
            .into_iter()
            .map(|d| DocHitDto { id: d.id, project_id: d.project_id, project_name: d.project_name, title: d.title, mode: d.mode })
            .collect(),
        wiki: wiki.into_iter().map(|w| WikiHitDto { id: w.id, title: w.title }).collect(),
        files: files
            .into_iter()
            .map(|f| FileHitDto { id: f.id, name: f.name, kind: f.kind, size_bytes: f.size_bytes })
            .collect(),
    }))
}
