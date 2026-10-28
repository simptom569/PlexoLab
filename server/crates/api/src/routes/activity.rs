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
    access,
    error::{ApiError, ApiResult, ErrorBody},
    extract::{ApiPath, ApiQuery, AuthUser},
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(list_activity)).routes(routes!(activity_actors))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ActivityDto {
    pub id: Uuid,
    /// Кто сделал
    pub actor_id: Uuid,
    /// Проект события; у вики и файлов библиотеки проекта нет, их видят в ленте проектов команды те, кто читает вики
    pub project_id: Option<Uuid>,
    /// Категория для цветной метки: tasks | comment | code | doc | wiki | release | file | module
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
    /// Только события этой категории: tasks | comment | code | doc | wiki | release | file | module
    pub kind: Option<String>,
    /// Курсор из `next` предыдущего ответа: вернуть события старше того места
    pub before: Option<String>,
}

fn cursor_of(e: &Event) -> Cursor {
    // `timestamptz` хранит микросекунды, поэтому время восстанавливается без потерь
    Cursor { micros: (e.created_at.unix_timestamp_nanos() / 1_000) as i64, id: e.id }
}

/// Лента проекта
///
/// События проекта и события вики и файлов библиотеки его команды (если человек их читает), новые первыми. Фильтры
/// «Участник» и «Тип события» сочетаются. Страница — 50 событий;
/// пока есть более старые, в ответе приходит `next`, его передают как `before`.
#[utoipa::path(
    get,
    path = "/projects/{id}/activity",
    tag = "activity",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Проект"), ListActivityQuery),
    responses(
        (status = 200, description = "Страница ленты", body = ActivityPageDto),
        (status = 400, description = "Незнакомая категория или испорченный курсор", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого проекта", body = ErrorBody),
    )
)]
async fn list_activity(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(project_id): ApiPath<Uuid>,
    ApiQuery(query): ApiQuery<ListActivityQuery>,
) -> ApiResult<Json<ActivityPageDto>> {
    let access = access::project(&state.pool, auth, project_id).await?;
    // события вики команды подмешиваются тем, кто читает её вики: члены команды и гости при включённой настройке
    let team = access::team(&state.pool, auth, access.project.team_id).await?;
    let wiki_team = team.can_read_wiki().then_some(team.team.id);
    let kinds = match query.kind.as_deref() {
        None => None,
        Some(category) => Some(activity::kinds_of(category).ok_or_else(|| {
            ApiError::BadRequest("Тип события: tasks, comment, code, doc, wiki, release, file или module".into())
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
    let mut events = db::activity::list(&state.pool, project_id, wiki_team, query.actor, kinds, after, PAGE_SIZE + 1).await?;
    let more = events.len() as i64 > PAGE_SIZE;
    events.truncate(PAGE_SIZE as usize);
    let next = more.then(|| events.last().map(|e| cursor_of(e).encode())).flatten();
    Ok(Json(ActivityPageDto { items: events.into_iter().map(ActivityDto::from).collect(), next }))
}

/// Кто есть в ленте проекта
///
/// Все, у кого есть собственные события проекта, независимо от фильтров. Клиент собирает из них и из участников проекта
/// список «Участник»: вышедший из проекта остаётся, пока в ленте есть его события. Авторы общих событий (вики, файлы
/// библиотеки) сюда не входят: человек, которого нет в проекте, в списке не нужен.
#[utoipa::path(
    get,
    path = "/projects/{id}/activity/actors",
    tag = "activity",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Проект")),
    responses(
        (status = 200, description = "Идентификаторы людей, у которых есть собственные события проекта", body = [Uuid]),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого проекта", body = ErrorBody),
    )
)]
async fn activity_actors(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(project_id): ApiPath<Uuid>,
) -> ApiResult<Json<Vec<Uuid>>> {
    access::project(&state.pool, auth, project_id).await?;
    Ok(Json(db::activity::actors(&state.pool, project_id).await?))
}
