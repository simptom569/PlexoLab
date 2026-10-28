//! HTTP-слой PlexoLab: роуты, middleware, OpenAPI, WebSocket с событиями для живых обновлений.

use std::sync::Arc;

use anyhow::Context;
use axum::{Json, Router, middleware::from_fn_with_state, routing::get};
use tower_http::{
    LatencyUnit,
    trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer},
};
use tracing::Level;
use utoipa::OpenApi;
use utoipa_axum::router::OpenApiRouter;

pub mod access;
pub mod config;
pub mod cors;
pub mod error;
pub mod events;
pub mod extract;
mod openapi;
pub mod presence;
pub mod routes;
pub mod serde_helpers;
pub mod state;
mod storage;
pub mod ws;

pub use config::Config;
pub use error::{ApiError, ApiResult};
pub use events::Event;
pub use state::{AppState, Realtime};

/// Схема OpenAPI в виде JSON. Для неё не нужны ни база, ни запущенный сервер: так клиент получает типы.
pub fn openapi_document() -> serde_json::Value {
    let (_, api) = OpenApiRouter::<AppState>::with_openapi(openapi::ApiDoc::openapi())
        .nest("/api/v1", routes::v1())
        .split_for_parts();
    serde_json::to_value(&api).expect("схема OpenAPI сериализуется")
}

/// Собирает приложение: `/healthz`, ручки `/api/v1/...`, WebSocket `/api/v1/ws` и, если включено, `/api/v1/openapi.json`.
/// CORS добавляет вызывающий (`cors::layer`), чтобы он оборачивал всё, включая ответы 404.
pub fn router(state: AppState) -> Router {
    let (v1, _) =
        OpenApiRouter::with_openapi(openapi::ApiDoc::openapi()).nest("/api/v1", routes::v1()).split_for_parts();

    // события рассылаются после успешного ответа ручки записи, то есть после commit (см. events.rs)
    let v1 = v1.route_layer(from_fn_with_state(state.clone(), events::publish_events));

    let mut app = Router::new().route("/healthz", get(healthz)).route("/api/v1/ws", get(ws::handler));
    if state.expose_openapi {
        let api_json = Arc::new(openapi_document());
        app = app.route("/api/v1/openapi.json", get(move || async move { Json(api_json) }));
    }
    app.merge(v1).fallback(not_found).with_state(state).layer(
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
    // поиск без учёта регистра идёт через lower(): в локали C русские буквы не различаются (README, «Локаль базы данных»)
    if !db::search::lowercase_works(&pool).await.unwrap_or(true) {
        tracing::warn!(
            "локаль базы не различает регистр русских букв: поиск «планирование» не найдёт «Планирование» (см. README, «Локаль базы данных»)"
        );
    }

    let state = AppState::new(pool, &config.jwt_secret)
        .with_openapi(config.expose_openapi)
        .with_data_dir(config.data_dir.clone())
        .with_max_upload_bytes(config.max_upload_bytes)
        .with_max_teams_per_user(config.max_teams_per_user);
    let app = router(state.clone()).layer(cors::layer(&config.cors_origins));
    let listener = tokio::net::TcpListener::bind(config.bind_addr)
        .await
        .with_context(|| format!("не удалось занять адрес {}", config.bind_addr))?;
    tracing::info!(addr = %config.bind_addr, "сервер слушает");
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            shutdown_signal().await;
            // открытые WebSocket закрываются сами: иначе остановка ждала бы их, пока клиенты не уйдут
            state.begin_shutdown();
        })
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("остановка по Ctrl+C");
}
