use std::sync::Arc;

use db::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    /// Секрет подписи токенов доступа
    pub jwt_secret: Arc<[u8]>,
    /// Отдавать ли схему OpenAPI по адресу `/api/v1/openapi.json` (в боевом режиме выключено)
    pub expose_openapi: bool,
}

impl AppState {
    pub fn new(pool: PgPool, jwt_secret: &str) -> Self {
        AppState { pool, jwt_secret: jwt_secret.as_bytes().into(), expose_openapi: false }
    }

    pub fn with_openapi(mut self, expose: bool) -> Self {
        self.expose_openapi = expose;
        self
    }
}
