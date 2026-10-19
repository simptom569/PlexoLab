//! HTTP-слой PlexoLab: роуты, middleware, OpenAPI (WebSocket появится на этапе 8).

use std::sync::Arc;

use anyhow::Context;
use axum::{Json, Router, routing::get};
use tower_http::{
    LatencyUnit,
    trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer},
};
use tracing::Level;
use utoipa::OpenApi;
use utoipa_axum::router::OpenApiRouter;

pub mod config;
pub mod cors;
pub mod error;
pub mod extract;
mod openapi;
pub mod routes;
pub mod state;

pub use config::Config;
pub use error::{ApiError, ApiResult};
pub use state::AppState;

/// Собирает приложение: `/healthz`, `/api/v1/openapi.json` и ручки `/api/v1/...`.
/// CORS добавляет вызывающий (`cors::layer`), чтобы он оборачивал всё, включая ответы 404.
pub fn router(state: AppState) -> Router {
    let (v1, api) =
        OpenApiRouter::with_openapi(openapi::ApiDoc::openapi()).nest("/api/v1", routes::v1()).split_for_parts();
    let api_json = Arc::new(serde_json::to_value(&api).expect("схема OpenAPI сериализуется"));

    Router::new()
        .route("/healthz", get(healthz))
        .route("/api/v1/openapi.json", get(move || async move { Json(api_json) }))
        .merge(v1)
        .fallback(not_found)
        .with_state(state)
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
                .on_response(DefaultOnResponse::new().level(Level::INFO).latency_unit(LatencyUnit::Millis)),
        )
}

async fn healthz() -> &'static str {
    "ok"
}

async fn not_found() -> ApiError {
    ApiError::NotFound
}

/// Подключается к базе, применяет миграции и работает до Ctrl+C.
pub async fn run(config: Config) -> anyhow::Result<()> {
    let pool = db::connect(&config.database_url).await.context("не удалось подключиться к базе данных")?;
    db::migrate(&pool).await.context("не удалось применить миграции")?;

    let app = router(AppState::new(pool, &config.jwt_secret)).layer(cors::layer(&config.cors_origins));
    let listener = tokio::net::TcpListener::bind(config.bind_addr)
        .await
        .with_context(|| format!("не удалось занять адрес {}", config.bind_addr))?;
    tracing::info!(addr = %config.bind_addr, "сервер слушает");
    axum::serve(listener, app).with_graceful_shutdown(shutdown_signal()).await?;
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("остановка по Ctrl+C");
}
