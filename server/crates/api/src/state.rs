use std::sync::Arc;

use db::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    /// Секрет подписи токенов доступа
    pub jwt_secret: Arc<[u8]>,
}

impl AppState {
    pub fn new(pool: PgPool, jwt_secret: &str) -> Self {
        AppState { pool, jwt_secret: jwt_secret.as_bytes().into() }
    }
}
