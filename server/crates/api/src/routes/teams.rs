//! Команды (docs/TEAMS.md). Этап К1: список моих команд; остальные ручки команд (создание, участники, приглашения,
//! архив) появятся на этапе К2. Вики и файлы команды лежат в `wiki` и `files`.

use axum::{Json, extract::State};
use serde::Serialize;
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use crate::{
    access::TeamAccess,
    error::{ApiResult, ErrorBody},
    extract::AuthUser,
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(list_teams))
}

/// Команда глазами текущего человека
#[derive(Debug, Serialize, ToSchema)]
pub struct TeamDto {
    pub id: Uuid,
    #[schema(example = "Dream Team")]
    pub name: String,
    /// Личная команда «Личное»: её нельзя архивировать и покинуть
    pub personal: bool,
    /// Моя роль в команде: admin | member. Пусто, если я здесь гость.
    #[schema(example = "member", nullable)]
    pub role: Option<String>,
    /// Я здесь гость: участник проекта этой команды без членства в ней
    pub guest: bool,
    /// Я могу читать вики и библиотеку файлов команды
    pub wiki: bool,
    /// Гости проектов команды могут читать её вики. Видят только члены команды.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guests_read_wiki: Option<bool>,
}

impl From<db::teams::TeamForUser> for TeamDto {
    fn from(found: db::teams::TeamForUser) -> Self {
        let access = TeamAccess::from(found);
        TeamDto {
            id: access.team.id,
            name: access.team.name.clone(),
            personal: access.team.personal_for.is_some(),
            role: access.role.map(|r| r.as_str().to_owned()),
            guest: access.guest,
            wiki: access.can_read_wiki(),
            guests_read_wiki: access.role.is_some().then_some(access.team.guests_read_wiki),
        }
    }
}

/// Мои команды: те, где я член («Личное» первой), и те, где я только гость. Архивные не показываются.
#[utoipa::path(
    get,
    path = "/teams",
    tag = "teams",
    security(("bearer" = [])),
    responses(
        (status = 200, description = "Команды человека", body = [TeamDto]),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
    )
)]
async fn list_teams(auth: AuthUser, State(state): State<AppState>) -> ApiResult<Json<Vec<TeamDto>>> {
    let teams = db::teams::list_for_user(&state.pool, auth.id).await?;
    Ok(Json(teams.into_iter().map(TeamDto::from).collect()))
}
