use utoipa_axum::router::OpenApiRouter;

use crate::state::AppState;

pub mod auth;
pub mod columns;
pub mod dto;
pub mod projects;
pub mod tags;
pub mod tasks;
pub mod users;

/// Все ручки под `/api/v1`
pub fn v1() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .merge(auth::router())
        .merge(users::router())
        .merge(projects::router())
        .merge(columns::router())
        .merge(tasks::router())
        .merge(tags::router())
}
