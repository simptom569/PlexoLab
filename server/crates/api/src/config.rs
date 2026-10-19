use std::net::SocketAddr;
use std::path::PathBuf;

use domain::auth::MIN_JWT_SECRET_LEN;

const DEFAULT_BIND_ADDR: &str = "127.0.0.1:8080";
const DEFAULT_DATA_DIR: &str = "./data";

/// Адреса, с которых клиенту разрешено ходить в API: окно Tauri на Windows и сервер Vite при разработке
pub const DEFAULT_CORS_ORIGINS: &[&str] = &[
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
    "http://localhost:1420",
    "http://127.0.0.1:1420",
];

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("не задана переменная окружения {0}")]
    Missing(&'static str),
    #[error("JWT_SECRET короче {MIN_JWT_SECRET_LEN} символов")]
    WeakSecret,
    #[error("BIND_ADDR «{0}» не похож на адрес вида 127.0.0.1:8080")]
    BadBindAddr(String),
}

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub bind_addr: SocketAddr,
    /// Папка для загруженных файлов (DATA_DIR/files/<uuid>), используется с этапа 5
    pub data_dir: PathBuf,
    pub cors_origins: Vec<String>,
}

impl Config {
    pub fn from_env() -> Result<Config, ConfigError> {
        Self::from_lookup(|k| std::env::var(k).ok())
    }

    /// Читает настройки через `lookup`: так их можно проверить без переменных окружения процесса
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Config, ConfigError> {
        let get = |key: &str| lookup(key).map(|v| v.trim().to_owned()).filter(|v| !v.is_empty());

        let database_url = get("DATABASE_URL").ok_or(ConfigError::Missing("DATABASE_URL"))?;
        let jwt_secret = get("JWT_SECRET").ok_or(ConfigError::Missing("JWT_SECRET"))?;
        if jwt_secret.len() < MIN_JWT_SECRET_LEN {
            return Err(ConfigError::WeakSecret);
        }
        let bind = get("BIND_ADDR").unwrap_or_else(|| DEFAULT_BIND_ADDR.to_owned());
        let bind_addr = bind.parse().map_err(|_| ConfigError::BadBindAddr(bind))?;
        let data_dir = PathBuf::from(get("DATA_DIR").unwrap_or_else(|| DEFAULT_DATA_DIR.to_owned()));
        let cors_origins = match get("CORS_ORIGINS") {
            Some(list) => list.split(',').map(|s| s.trim().to_owned()).filter(|s| !s.is_empty()).collect(),
            None => DEFAULT_CORS_ORIGINS.iter().map(|s| (*s).to_owned()).collect(),
        };
        Ok(Config { database_url, jwt_secret, bind_addr, data_dir, cors_origins })
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    const SECRET: &str = "0123456789abcdef0123456789abcdef";

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect();
        move |k| map.get(k).cloned()
    }

    #[test]
    fn defaults_are_applied() {
        let c = Config::from_lookup(env(&[("DATABASE_URL", "postgres://x"), ("JWT_SECRET", SECRET)])).unwrap();
        assert_eq!(c.bind_addr.to_string(), "127.0.0.1:8080");
        assert_eq!(c.data_dir, PathBuf::from("./data"));
        assert!(c.cors_origins.contains(&"http://tauri.localhost".to_owned()));
    }

    #[test]
    fn values_are_read_and_trimmed() {
        let c = Config::from_lookup(env(&[
            ("DATABASE_URL", " postgres://x "),
            ("JWT_SECRET", SECRET),
            ("BIND_ADDR", "0.0.0.0:9000"),
            ("DATA_DIR", "/var/lib/plexolab"),
            ("CORS_ORIGINS", "https://a.example, https://b.example ,"),
        ]))
        .unwrap();
        assert_eq!(c.database_url, "postgres://x");
        assert_eq!(c.bind_addr.port(), 9000);
        assert_eq!(c.data_dir, PathBuf::from("/var/lib/plexolab"));
        assert_eq!(c.cors_origins, ["https://a.example", "https://b.example"]);
    }

    #[test]
    fn required_values_are_checked() {
        assert_eq!(
            Config::from_lookup(env(&[("JWT_SECRET", SECRET)])).unwrap_err(),
            ConfigError::Missing("DATABASE_URL")
        );
        assert_eq!(
            Config::from_lookup(env(&[("DATABASE_URL", "postgres://x")])).unwrap_err(),
            ConfigError::Missing("JWT_SECRET")
        );
        assert_eq!(
            Config::from_lookup(env(&[("DATABASE_URL", "postgres://x"), ("JWT_SECRET", "   ")])).unwrap_err(),
            ConfigError::Missing("JWT_SECRET"),
            "пустое значение считается незаданным"
        );
    }

    #[test]
    fn weak_secret_and_bad_address_are_rejected() {
        assert_eq!(
            Config::from_lookup(env(&[("DATABASE_URL", "postgres://x"), ("JWT_SECRET", "short")])).unwrap_err(),
            ConfigError::WeakSecret
        );
        assert!(matches!(
            Config::from_lookup(env(&[
                ("DATABASE_URL", "postgres://x"),
                ("JWT_SECRET", SECRET),
                ("BIND_ADDR", "nope")
            ])),
            Err(ConfigError::BadBindAddr(_))
        ));
    }
}
