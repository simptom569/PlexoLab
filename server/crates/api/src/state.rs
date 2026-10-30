use std::{path::PathBuf, sync::Arc, time::Duration};

use db::PgPool;
use domain::{codes::DEFAULT_MAX_MAILS_PER_HOUR, files::DEFAULT_MAX_UPLOAD_BYTES, teams::DEFAULT_MAX_TEAMS_PER_USER};
use tokio::sync::{Semaphore, watch};

use crate::{
    events::{DEFAULT_CAPACITY, Events},
    mail::Mailer,
    presence::Presence,
};

/// Настройки живых обновлений (WebSocket). Значения по умолчанию рассчитаны на команду из нескольких человек; тестам
/// нужны короткие паузы.
#[derive(Debug, Clone)]
pub struct Realtime {
    /// Сколько ждать первое сообщение с токеном после подключения
    pub auth_timeout: Duration,
    /// Как часто сервер шлёт `ping`; клиент отвечает `pong`
    pub heartbeat: Duration,
    /// Сколько можно молчать (ни одного сообщения от клиента), прежде чем соединение считается мёртвым
    pub idle_timeout: Duration,
    /// Сколько соединений держать одновременно: больше не принимаются (503)
    pub max_connections: usize,
    /// Сколько метка «человек в этом блоке» живёт без подтверждения от клиента (клиент подтверждает её раз в 15 секунд)
    pub presence_ttl: Duration,
}

impl Default for Realtime {
    fn default() -> Self {
        Realtime {
            auth_timeout: Duration::from_secs(10),
            heartbeat: Duration::from_secs(25),
            idle_timeout: Duration::from_secs(70),
            max_connections: 100,
            presence_ttl: Duration::from_secs(45),
        }
    }
}

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
    /// Сколько обычных команд может создать один человек
    pub max_teams_per_user: u32,
    /// Отправка писем с кодами; пока почта не настроена, регистрации и сброса пароля по почте нет
    pub mailer: Mailer,
    /// Сколько писем с кодами сервер отправляет за час на все адреса вместе
    pub mail_per_hour: u32,
    /// События для живых обновлений: сюда пишет слой над ручками, отсюда читают WebSocket-соединения
    pub events: Events,
    pub realtime: Realtime,
    /// Кто в каком блоке страницы или документа сейчас (только в памяти)
    pub presence: Presence,
    /// Свободные места под соединения WebSocket
    pub connections: Arc<Semaphore>,
    /// `true`, когда сервер останавливается: соединения закрываются сами, иначе остановка ждала бы их вечно
    pub shutdown: Arc<watch::Sender<bool>>,
}

impl AppState {
    pub fn new(pool: PgPool, jwt_secret: &str) -> Self {
        let realtime = Realtime::default();
        AppState {
            pool,
            jwt_secret: jwt_secret.as_bytes().into(),
            expose_openapi: false,
            data_dir: PathBuf::from("./data"),
            max_upload_bytes: DEFAULT_MAX_UPLOAD_BYTES,
            max_teams_per_user: DEFAULT_MAX_TEAMS_PER_USER,
            mailer: Mailer::off(),
            mail_per_hour: DEFAULT_MAX_MAILS_PER_HOUR,
            events: Events::new(DEFAULT_CAPACITY),
            presence: Presence::default(),
            connections: Arc::new(Semaphore::new(realtime.max_connections)),
            realtime,
            shutdown: Arc::new(watch::channel(false).0),
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

    pub fn with_max_teams_per_user(mut self, max: u32) -> Self {
        self.max_teams_per_user = max;
        self
    }

    pub fn with_mailer(mut self, mailer: Mailer) -> Self {
        self.mailer = mailer;
        self
    }

    pub fn with_mail_limit(mut self, per_hour: u32) -> Self {
        self.mail_per_hour = per_hour;
        self
    }

    pub fn with_openapi(mut self, expose: bool) -> Self {
        self.expose_openapi = expose;
        self
    }

    /// Свои паузы и лимит соединений (для тестов)
    pub fn with_realtime(mut self, realtime: Realtime) -> Self {
        self.connections = Arc::new(Semaphore::new(realtime.max_connections));
        self.realtime = realtime;
        self
    }

    /// Канал событий другой ёмкости (для тестов отставшего получателя)
    pub fn with_event_capacity(mut self, capacity: usize) -> Self {
        self.events = Events::new(capacity);
        self
    }

    /// Сообщить соединениям, что сервер останавливается
    pub fn begin_shutdown(&self) {
        self.shutdown.send_replace(true);
    }
}
