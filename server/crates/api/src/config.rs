use std::net::SocketAddr;
use std::path::PathBuf;

use domain::{
    auth::{MIN_JWT_SECRET_LEN, is_plausible_email},
    codes::{DEFAULT_MAX_MAILS_PER_HOUR, MAX_MAILS_PER_HOUR_LIMIT},
    files::DEFAULT_MAX_UPLOAD_BYTES,
    teams::DEFAULT_MAX_TEAMS_PER_USER,
};

const DEFAULT_BIND_ADDR: &str = "127.0.0.1:8080";
const DEFAULT_DATA_DIR: &str = "./data";
const MAX_UPLOAD_MB_LIMIT: u64 = 2048;
const MAX_TEAMS_LIMIT: u32 = 1000;

/// Секрет, который не должен попасть в журнал: `Debug` его не показывает
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Secret {
        Secret(value.into())
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret(…)")
    }
}

/// Как сервер отправляет письма с кодами (регистрация, сброс пароля)
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MailConfig {
    /// Не задано: регистрации и сброса пароля по почте нет
    Off,
    /// Через Resend: `RESEND_API_KEY` и `MAIL_FROM`
    Resend { api_key: Secret, from: String },
    /// Письма пишутся файлами в папку `MAIL_OUTBOX_DIR`: разработка и e2e-тесты, наружу ничего не уходит
    Outbox(PathBuf),
}

/// Подходит ли `MAIL_FROM`: адрес («noreply@example.com») или «Имя <адрес>»
fn is_valid_sender(from: &str) -> bool {
    let address = match (from.rfind('<'), from.strip_suffix('>')) {
        (Some(start), Some(inner)) => &inner[start + 1..],
        _ => from,
    };
    let address = address.trim();
    is_plausible_email(address)
}

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
    #[error("MAX_UPLOAD_MB «{0}» должно быть целым числом мегабайт от 1 до {MAX_UPLOAD_MB_LIMIT}")]
    BadMaxUpload(String),
    #[error("MAX_TEAMS_PER_USER «{0}» должно быть целым числом от 1 до {MAX_TEAMS_LIMIT}")]
    BadMaxTeams(String),
    #[error(
        "задан RESEND_API_KEY, но не задан MAIL_FROM: письмо надо отправлять с какого-то адреса. Если строка MAIL_FROM в .env есть, возьмите значение в кавычки: MAIL_FROM=\"PlexoLab <noreply@example.com>\""
    )]
    MailFromMissing,
    #[error("MAIL_FROM «{0}» не похож на адрес вида noreply@example.com или PlexoLab <noreply@example.com>")]
    BadMailFrom(String),
    #[error("RESEND_API_KEY и MAIL_OUTBOX_DIR заданы оба: выберите одно (письма наружу или в папку)")]
    MailConflict,
    #[error("MAIL_MAX_PER_HOUR «{0}» должно быть целым числом от 1 до {MAX_MAILS_PER_HOUR_LIMIT}")]
    BadMailLimit(String),
}

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub bind_addr: SocketAddr,
    /// Папка данных: загруженные файлы лежат в DATA_DIR/files/<uuid>
    pub data_dir: PathBuf,
    /// Лимит одного загружаемого файла, байты (MAX_UPLOAD_MB, по умолчанию 25 МБ)
    pub max_upload_bytes: u64,
    /// Сколько обычных команд может создать один человек (MAX_TEAMS_PER_USER, по умолчанию 5; «Личное» не считается)
    pub max_teams_per_user: u32,
    /// Как отправлять письма с кодами (RESEND_API_KEY + MAIL_FROM, либо MAIL_OUTBOX_DIR для разработки, либо никак)
    pub mail: MailConfig,
    /// Сколько писем с кодами сервер отправляет за час на все адреса вместе (MAIL_MAX_PER_HOUR, по умолчанию 30)
    pub mail_max_per_hour: u32,
    pub cors_origins: Vec<String>,
    /// Отдавать схему OpenAPI по `/api/v1/openapi.json` (EXPOSE_OPENAPI). В боевом режиме выключено.
    pub expose_openapi: bool,
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
        let max_upload_bytes = match get("MAX_UPLOAD_MB") {
            Some(v) => match v.parse::<u64>() {
                Ok(mb) if (1..=MAX_UPLOAD_MB_LIMIT).contains(&mb) => mb * 1024 * 1024,
                _ => return Err(ConfigError::BadMaxUpload(v)),
            },
            None => DEFAULT_MAX_UPLOAD_BYTES,
        };
        let max_teams_per_user = match get("MAX_TEAMS_PER_USER") {
            Some(v) => match v.parse::<u32>() {
                Ok(n) if (1..=MAX_TEAMS_LIMIT).contains(&n) => n,
                _ => return Err(ConfigError::BadMaxTeams(v)),
            },
            None => DEFAULT_MAX_TEAMS_PER_USER,
        };
        let mail = match (get("RESEND_API_KEY"), get("MAIL_OUTBOX_DIR")) {
            (Some(_), Some(_)) => return Err(ConfigError::MailConflict),
            (Some(key), None) => {
                let from = get("MAIL_FROM").ok_or(ConfigError::MailFromMissing)?;
                if !is_valid_sender(&from) {
                    return Err(ConfigError::BadMailFrom(from));
                }
                MailConfig::Resend { api_key: Secret::new(key), from }
            }
            (None, Some(dir)) => MailConfig::Outbox(PathBuf::from(dir)),
            (None, None) => MailConfig::Off,
        };
        let mail_max_per_hour = match get("MAIL_MAX_PER_HOUR") {
            Some(v) => match v.parse::<u32>() {
                Ok(n) if (1..=MAX_MAILS_PER_HOUR_LIMIT).contains(&n) => n,
                _ => return Err(ConfigError::BadMailLimit(v)),
            },
            None => DEFAULT_MAX_MAILS_PER_HOUR,
        };
        let cors_origins = match get("CORS_ORIGINS") {
            Some(list) => list.split(',').map(|s| s.trim().to_owned()).filter(|s| !s.is_empty()).collect(),
            None => DEFAULT_CORS_ORIGINS.iter().map(|s| (*s).to_owned()).collect(),
        };
        let expose_openapi =
            get("EXPOSE_OPENAPI").is_some_and(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes" | "on"));
        Ok(Config {
            database_url,
            jwt_secret,
            bind_addr,
            data_dir,
            max_upload_bytes,
            max_teams_per_user,
            mail,
            mail_max_per_hour,
            cors_origins,
            expose_openapi,
        })
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
        assert_eq!(c.max_upload_bytes, 25 * 1024 * 1024);
        assert_eq!(c.max_teams_per_user, 5);
        assert_eq!(c.mail, MailConfig::Off, "почта по умолчанию выключена");
        assert_eq!(c.mail_max_per_hour, 30);
        assert!(c.cors_origins.contains(&"http://tauri.localhost".to_owned()));
    }

    #[test]
    fn resend_needs_a_key_and_a_sender() {
        let base = [("DATABASE_URL", "postgres://x"), ("JWT_SECRET", SECRET)];
        let with = |extra: &[(&str, &str)]| Config::from_lookup(env(&[&base[..], extra].concat()));

        let c = with(&[("RESEND_API_KEY", " re_123 "), ("MAIL_FROM", "PlexoLab <noreply@example.com>")]).unwrap();
        assert_eq!(
            c.mail,
            MailConfig::Resend { api_key: Secret::new("re_123"), from: "PlexoLab <noreply@example.com>".into() }
        );
        let plain = with(&[("RESEND_API_KEY", "re_123"), ("MAIL_FROM", "noreply@example.com")]).unwrap();
        assert!(matches!(plain.mail, MailConfig::Resend { .. }), "адрес без имени тоже подходит");

        assert_eq!(with(&[("RESEND_API_KEY", "re_123")]).unwrap_err(), ConfigError::MailFromMissing);
        assert_eq!(
            with(&[("MAIL_FROM", "noreply@example.com")]).unwrap().mail,
            MailConfig::Off,
            "адрес без ключа ничего не включает"
        );
    }

    #[test]
    fn sender_address_is_checked() {
        for good in ["a@example.com", "PlexoLab <a@example.com>", "Имя Фамилия <a@mail.example.co>", "<a@example.com>"]
        {
            assert!(is_valid_sender(good), "{good}");
        }
        for bad in
            ["", "noreply", "PlexoLab <noreply>", "PlexoLab noreply@example.com>", "a b@example.com", "a@example"]
        {
            assert!(!is_valid_sender(bad), "{bad}");
        }
        let base = [("DATABASE_URL", "postgres://x"), ("JWT_SECRET", SECRET), ("RESEND_API_KEY", "k")];
        let r = Config::from_lookup(env(&[base[0], base[1], base[2], ("MAIL_FROM", "nope")]));
        assert_eq!(r.unwrap_err(), ConfigError::BadMailFrom("nope".into()));
    }

    #[test]
    fn outbox_is_for_development_and_excludes_resend() {
        let base = [("DATABASE_URL", "postgres://x"), ("JWT_SECRET", SECRET)];
        let c = Config::from_lookup(env(&[base[0], base[1], ("MAIL_OUTBOX_DIR", "./data/outbox")])).unwrap();
        assert_eq!(c.mail, MailConfig::Outbox(PathBuf::from("./data/outbox")));
        let both = Config::from_lookup(env(&[
            base[0],
            base[1],
            ("MAIL_OUTBOX_DIR", "./o"),
            ("RESEND_API_KEY", "k"),
            ("MAIL_FROM", "a@example.com"),
        ]));
        assert_eq!(both.unwrap_err(), ConfigError::MailConflict);
    }

    #[test]
    fn mail_limit_is_read_as_a_number() {
        let base = [("DATABASE_URL", "postgres://x"), ("JWT_SECRET", SECRET)];
        assert_eq!(
            Config::from_lookup(env(&[base[0], base[1], ("MAIL_MAX_PER_HOUR", "5")])).unwrap().mail_max_per_hour,
            5
        );
        for bad in ["0", "-1", "много", "1001", "2.5"] {
            let r = Config::from_lookup(env(&[base[0], base[1], ("MAIL_MAX_PER_HOUR", bad)]));
            assert_eq!(r.unwrap_err(), ConfigError::BadMailLimit(bad.to_owned()), "{bad}");
        }
    }

    #[test]
    fn secrets_stay_out_of_debug_output() {
        let secret = Secret::new("re_super_secret");
        assert!(!format!("{secret:?}").contains("super"));
        let config = MailConfig::Resend { api_key: secret, from: "a@example.com".into() };
        assert!(!format!("{config:?}").contains("super"));
    }

    #[test]
    fn openapi_is_off_unless_asked() {
        let base = [("DATABASE_URL", "postgres://x"), ("JWT_SECRET", SECRET)];
        assert!(!Config::from_lookup(env(&base)).unwrap().expose_openapi, "по умолчанию выключено");
        for on in ["1", "true", "TRUE", "yes", "on"] {
            let c = Config::from_lookup(env(&[base[0], base[1], ("EXPOSE_OPENAPI", on)])).unwrap();
            assert!(c.expose_openapi, "{on}");
        }
        for off in ["0", "false", "no", "", "maybe"] {
            let c = Config::from_lookup(env(&[base[0], base[1], ("EXPOSE_OPENAPI", off)])).unwrap();
            assert!(!c.expose_openapi, "«{off}»");
        }
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
    fn team_limit_is_read_as_a_number() {
        let base = [("DATABASE_URL", "postgres://x"), ("JWT_SECRET", SECRET)];
        let c = Config::from_lookup(env(&[base[0], base[1], ("MAX_TEAMS_PER_USER", "12")])).unwrap();
        assert_eq!(c.max_teams_per_user, 12);
        for bad in ["0", "-1", "много", "1001", "2.5"] {
            let r = Config::from_lookup(env(&[base[0], base[1], ("MAX_TEAMS_PER_USER", bad)]));
            assert_eq!(r.unwrap_err(), ConfigError::BadMaxTeams(bad.to_owned()), "{bad}");
        }
    }

    #[test]
    fn upload_limit_is_read_in_megabytes() {
        let base = [("DATABASE_URL", "postgres://x"), ("JWT_SECRET", SECRET)];
        let c = Config::from_lookup(env(&[base[0], base[1], ("MAX_UPLOAD_MB", "100")])).unwrap();
        assert_eq!(c.max_upload_bytes, 100 * 1024 * 1024);
        for bad in ["0", "-5", "много", "2049", "1.5"] {
            let r = Config::from_lookup(env(&[base[0], base[1], ("MAX_UPLOAD_MB", bad)]));
            assert_eq!(r.unwrap_err(), ConfigError::BadMaxUpload(bad.to_owned()), "{bad}");
        }
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
