//! Уведомления: человека назначили исполнителем или упомянули в комментарии (docs/OFFLINE-NOTIFY-SEARCH.md, раздел 2).
//! Уведомление создают ручки задач (`tasks.rs`), здесь список своих и отметки о прочтении. Чужих уведомлений ручки не
//! видят: всё ищется по `user_id` вошедшего.

use std::collections::HashMap;

use axum::{Json, extract::State, http::StatusCode};
use db::notifications::Entry;
use domain::{
    board::{id_prefix, task_key},
    mentions,
};
use serde::Serialize;
use time::OffsetDateTime;
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use crate::{
    error::{ApiError, ApiResult, ErrorBody},
    events,
    extract::{ApiPath, AuthUser},
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(list_notifications)).routes(routes!(read_all)).routes(routes!(read_one))
}

/// Сколько уведомлений отдаёт список: старше просто не нужны, а хранится их у человека не больше `KEEP_PER_USER`
const LIST_LIMIT: i64 = 100;
/// Сколько знаков комментария попадает в уведомление
const PREVIEW_LEN: usize = 140;

/// Одно уведомление в списке
#[derive(Debug, Serialize, ToSchema)]
pub struct NotificationDto {
    pub id: Uuid,
    /// `assigned` — назначили исполнителем, `mentioned` — упомянули в комментарии
    #[schema(example = "mentioned")]
    pub kind: String,
    /// Кто назначил или упомянул (учётную запись могли удалить)
    pub actor_id: Option<Uuid>,
    pub project_id: Uuid,
    pub task_id: Uuid,
    /// Id задачи для показа: `WEB-141`
    #[schema(example = "WEB-141")]
    pub task_key: String,
    pub task_title: String,
    /// Начало комментария с упоминанием (метки заменены на `@Имя`); у «назначили» нет
    pub comment: Option<String>,
    pub read: bool,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

/// Список уведомлений и сколько из них не прочитано
#[derive(Debug, Serialize, ToSchema)]
pub struct NotificationListDto {
    /// Новые первыми, не больше ста
    pub items: Vec<NotificationDto>,
    /// Сколько непрочитанных всего (может быть больше, чем в списке)
    pub unread: i64,
}

/// Начало комментария для показа в уведомлении: метки `@[id]` стали `@Имя`, переносы строк пробелами, не длиннее `PREVIEW_LEN`
fn preview(body: &str, names: &HashMap<Uuid, String>) -> String {
    let text = mentions::render(body, |id| names.get(&id).cloned());
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= PREVIEW_LEN {
        return flat;
    }
    let cut: String = flat.chars().take(PREVIEW_LEN).collect();
    format!("{}…", cut.trim_end())
}

fn to_dto(entry: Entry, names: &HashMap<Uuid, String>) -> NotificationDto {
    let n = entry.notification;
    NotificationDto {
        id: n.id,
        kind: n.kind,
        actor_id: n.actor_id,
        project_id: n.project_id,
        task_id: n.task_id,
        task_key: task_key(id_prefix(entry.series_key.as_deref(), entry.project_key.as_deref()), entry.task_number),
        task_title: entry.task_title,
        comment: entry.comment_body.as_deref().map(|body| preview(body, names)),
        read: n.read_at.is_some(),
        created_at: n.created_at,
    }
}

/// Мои уведомления: новые первыми, и сколько из них не прочитано. Видны только уведомления проектов, где я участник.
#[utoipa::path(
    get,
    path = "/notifications",
    tag = "notifications",
    security(("bearer" = [])),
    responses(
        (status = 200, description = "Мои уведомления", body = NotificationListDto),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
    )
)]
async fn list_notifications(auth: AuthUser, State(state): State<AppState>) -> ApiResult<Json<NotificationListDto>> {
    let entries = db::notifications::list(&state.pool, auth.id, LIST_LIMIT).await?;
    let unread = db::notifications::unread_count(&state.pool, auth.id).await?;
    // имена людей из меток упоминаний в комментариях: одним запросом
    let mut ids: Vec<Uuid> = Vec::new();
    for body in entries.iter().filter_map(|e| e.comment_body.as_deref()) {
        for id in mentions::extract(body) {
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
    }
    let names: HashMap<Uuid, String> = db::users::names(&state.pool, &ids).await?.into_iter().collect();
    Ok(Json(NotificationListDto { items: entries.into_iter().map(|e| to_dto(e, &names)).collect(), unread }))
}

/// Отметить прочитанными все мои уведомления
#[utoipa::path(
    post,
    path = "/notifications/read-all",
    tag = "notifications",
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Все мои уведомления прочитаны"),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
    )
)]
async fn read_all(auth: AuthUser, State(state): State<AppState>) -> ApiResult<StatusCode> {
    db::notifications::mark_all_read(&state.pool, auth.id).await?;
    // другие окна этого же человека обновят счётчик
    events::note_user(auth.id);
    Ok(StatusCode::NO_CONTENT)
}

/// Отметить прочитанным одно моё уведомление. Повторная отметка ничего не меняет.
#[utoipa::path(
    post,
    path = "/notifications/{id}/read",
    tag = "notifications",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Уведомление")),
    responses(
        (status = 204, description = "Уведомление прочитано"),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого уведомления среди моих", body = ErrorBody),
    )
)]
async fn read_one(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    if !db::notifications::mark_read(&state.pool, auth.id, id).await? {
        return Err(ApiError::NotFound);
    }
    events::note_user(auth.id);
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "11111111-1111-4111-8111-111111111111";

    fn names() -> HashMap<Uuid, String> {
        HashMap::from([(Uuid::parse_str(A).unwrap(), "Лена М.".to_owned())])
    }

    #[test]
    fn preview_puts_names_in_place_of_marks_and_flattens_lines() {
        let body = format!("@[{A}]  посмотри\n\nпожалуйста");
        assert_eq!(preview(&body, &names()), "@Лена М. посмотри пожалуйста");
    }

    #[test]
    fn preview_is_cut_with_an_ellipsis() {
        let long = "я".repeat(300);
        let text = preview(&long, &names());
        assert_eq!(text.chars().count(), PREVIEW_LEN + 1);
        assert!(text.ends_with('…'));
        assert_eq!(preview(&"я".repeat(PREVIEW_LEN), &names()).chars().count(), PREVIEW_LEN);
    }

    #[test]
    fn an_unknown_person_in_a_mark_is_somebody() {
        assert_eq!(preview(&format!("@[{A}] привет"), &HashMap::new()), "@кто-то привет");
    }
}
