use std::time::Duration;

use axum::http::{
    HeaderName, HeaderValue, Method,
    header::{AUTHORIZATION, CONTENT_TYPE},
};
use tower_http::cors::{AllowOrigin, CorsLayer};

/// Окно Tauri ходит в API с другого origin, поэтому браузерному движку нужны CORS-заголовки.
/// Разрешены только перечисленные адреса.
pub fn layer(origins: &[String]) -> CorsLayer {
    let origins: Vec<HeaderValue> = origins.iter().filter_map(|o| HeaderValue::from_str(o).ok()).collect();
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::PATCH, Method::DELETE, Method::OPTIONS])
        .allow_headers([AUTHORIZATION, CONTENT_TYPE, HeaderName::from_static("x-client-id")])
        .max_age(Duration::from_secs(3600))
}
