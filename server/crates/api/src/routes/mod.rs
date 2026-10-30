use utoipa_axum::router::OpenApiRouter;

use crate::state::AppState;

pub mod activity;
pub mod auth;
pub mod columns;
pub mod docs;
pub mod docs_dto;
pub mod dto;
pub mod files;
pub mod invites;
pub mod library_dto;
pub mod links;
pub mod modules;
pub mod notifications;
pub mod project_dto;
pub mod projects;
pub mod releases;
pub mod search;
pub mod signup;
pub mod tags;
pub mod tasks;
pub mod team_invites;
pub mod teams;
pub mod users;
pub mod wiki;

/// Все ручки под `/api/v1`
pub fn v1() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .merge(auth::router())
        .merge(signup::router())
        .merge(users::router())
        .merge(projects::router())
        .merge(invites::router())
        .merge(notifications::router())
        .merge(columns::router())
        .merge(tasks::router())
        .merge(tags::router())
        .merge(teams::router())
        .merge(team_invites::router())
        .merge(modules::router())
        .merge(releases::router())
        .merge(wiki::router())
        .merge(docs::router())
        .merge(files::router())
        .merge(activity::router())
        .merge(search::router())
        .merge(links::router())
}
