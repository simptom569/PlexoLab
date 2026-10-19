use std::{path::PathBuf, sync::Arc};

use db::PgPool;
use domain::files::DEFAULT_MAX_UPLOAD_BYTES;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    /// Секрет подписи токенов доступа
    pub jwt_secret: Arc<[u8]>,
    /// Отдавать ли схему OpenAPI по адресу `/api/v1/openapi.json` (в боевом режиме выключено)
    pub expose_openapi: bool,
    /// Папка данных: файлы лежат в `<data_dir>/files/<ключ>`
    pub data_dir: PathBuf,
    /// Самый большой допустимый файл при загрузке, байты
    pub max_upload_bytes: u64,
}

impl AppState {
    pub fn new(pool: PgPool, jwt_secret: &str) -> Self {
        AppState {
            pool,
            jwt_secret: jwt_secret.as_bytes().into(),
            expose_openapi: false,
            data_dir: PathBuf::from("./data"),
            max_upload_bytes: DEFAULT_MAX_UPLOAD_BYTES,
        }
    }

    pub fn with_data_dir(mut self, dir: impl Into<PathBuf>) -> Self {
        self.data_dir = dir.into();
        self
    }

    pub fn with_max_upload_bytes(mut self, bytes: u64) -> Self {
        self.max_upload_bytes = bytes;
        self
    }

    pub fn with_openapi(mut self, expose: bool) -> Self {
        self.expose_openapi = expose;
        self
    }
}
