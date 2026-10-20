//! Лента активности. Записи создаёт сервер сам в той же транзакции, что и действие (см. остальные ручки),
//! клиент только читает. Страницы по 50 событий от новых к старым, дальше по курсору из `next`.

use axum::{Json, extract::State};
use db::activity::Event;
use domain::activity::{self, Cursor, PAGE_SIZE};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use crate::{
    error::{ApiError, ApiResult, ErrorBody},
    extract::{ApiQuery, AuthUser},
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(list_activity))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ActivityDto {
    pub id: Uuid,
    /// Кто сделал
    pub actor_id: Uuid,
    /// Проект события; у вики, документов и файлов библиотеки проекта нет
    pub project_id: Option<Uuid>,
    /// Категория для цветной метки: tasks | comment | code | doc | release | file | module
    #[schema(example = "tasks")]
    pub category: String,
    /// Объект действия: «WEB-141 Тёмная тема для страницы настроек»
    pub target: String,
    /// Что сделали: «перемещена в «На ревью»»
    pub text: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

impl From<Event> for ActivityDto {
    fn from(e: Event) -> Self {
        ActivityDto {
            id: e.id,
            actor_id: e.actor_id,
            project_id: e.project_id,
            category: activity::category_of(&e.kind).to_owned(),
            target: e.target,
            text: e.text,
            created_at: e.created_at,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ActivityPageDto {
    /// От новых к старым, не больше 50
    pub items: Vec<ActivityDto>,
    /// Курсор следующей страницы для `before`; `null`, если больше событий нет
    pub next: Option<String>,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct ListActivityQuery {
    /// Только события этого участника
    pub actor: Option<Uuid>,
    /// Только события этой категории: tasks | comment | code | doc | release | file | module
    pub kind: Option<String>,
    /// Курсор из `next` предыдущего ответа: вернуть события старше того места
    pub before: Option<String>,
}

fn cursor_of(e: &Event) -> Cursor {
    // `timestamptz` хранит микросекунды, поэтому время восстанавливается без потерь
    Cursor { micros: (e.created_at.unix_timestamp_nanos() / 1_000) as i64, id: e.id }
}

/// Лента событий команды
///
/// События всех проектов, новые первыми. Фильтры «Участник» и «Тип события» сочетаются. Страница — 50 событий;
/// пока есть более старые, в ответе приходит `next`, его передают как `before`.
#[utoipa::path(
    get,
    path = "/activity",
    tag = "activity",
    security(("bearer" = [])),
    params(ListActivityQuery),
    responses(
        (status = 200, description = "Страница ленты", body = ActivityPageDto),
        (status = 400, description = "Незнакомая категория или испорченный курсор", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
    )
)]
async fn list_activity(
    _auth: AuthUser,
    State(state): State<AppState>,
    ApiQuery(query): ApiQuery<ListActivityQuery>,
) -> ApiResult<Json<ActivityPageDto>> {
    let kinds = match query.kind.as_deref() {
        None => None,
        Some(category) => Some(activity::kinds_of(category).ok_or_else(|| {
            ApiError::BadRequest("Тип события: tasks, comment, code, doc, release, file или module".into())
        })?),
    };
    let after = match query.before.as_deref() {
        None => None,
        Some(raw) => {
            let cursor =
                Cursor::parse(raw).ok_or_else(|| ApiError::BadRequest("Некорректный курсор страницы".into()))?;
            let at = OffsetDateTime::from_unix_timestamp_nanos(i128::from(cursor.micros) * 1_000)
                .map_err(|_| ApiError::BadRequest("Некорректный курсор страницы".into()))?;
            Some((at, cursor.id))
        }
    };

    // на одно событие больше страницы: так видно, есть ли что-то дальше, без отдельного запроса
    let mut events = db::activity::list(&state.pool, query.actor, kinds, after, PAGE_SIZE + 1).await?;
    let more = events.len() as i64 > PAGE_SIZE;
    events.truncate(PAGE_SIZE as usize);
    let next = more.then(|| events.last().map(|e| cursor_of(e).encode())).flatten();
    Ok(Json(ActivityPageDto { items: events.into_iter().map(ActivityDto::from).collect(), next }))
}
