//! Присутствие: кто сейчас в каком блоке страницы вики или документа. Клиент сообщает по WebSocket, какой блок у него
//! открыт на правку (`focus`), и что ушёл из блока (`blur`); сервер хранит это только в памяти и рассылает остальным
//! (см. `ws`). Текста в сообщениях нет: только страница, версия, на которую опирается позиция автора, и строки блока.
//!
//! Запись принадлежит подключению: закрылось подключение, запись исчезла. Если клиент замолчал, но подключение ещё
//! живо, запись снимается через `presence_ttl` (клиент подтверждает её, пока блок открыт и окно в работе).

use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex, PoisonError,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tokio::{sync::broadcast, time::Instant};
use uuid::Uuid;

/// Сколько обновлений канал хранит для медленных получателей. Кто отстал, получает полный список заново.
pub const CAPACITY: usize = 256;
/// Больше сообщений о положении от одного подключения за секунду не принимается (остальные отбрасываются)
pub const MAX_PER_SECOND: u32 = 10;
/// Сообщение о положении длиннее не разбирается: настоящее занимает около ста байт
pub const MAX_MESSAGE_BYTES: usize = 512;
/// Номер строки, больше которого блок считается выдумкой
pub const MAX_LINE: u32 = 200_000;

/// Где человек: страница вики или документ
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Wiki,
    Doc,
}

/// Что клиент сообщает: открыт блок строк `[start, end)` текста версии `rev`
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Focus {
    pub kind: Kind,
    pub id: Uuid,
    pub rev: i64,
    pub start: u32,
    pub end: u32,
}

impl Focus {
    /// Правдоподобное ли сообщение: версия не отрицательная, блок не пустой и не уходит за разумные пределы
    pub fn plausible(&self) -> bool {
        self.rev >= 0 && self.start < self.end && self.end <= MAX_LINE
    }
}

/// Чьё это место: по нему решается, кому показывать метку
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Place {
    /// Документ проекта: метку видят те, кто видит проект
    Project(Uuid),
    /// Страница вики команды: метку видят те, кто читает вики команды
    Team(Uuid),
}

/// Блок, в котором сейчас человек. `client` — номер подключения: у одного человека их может быть несколько
/// (приложение запущено дважды, два компьютера).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Mark {
    pub client: String,
    pub user_id: Uuid,
    pub kind: Kind,
    pub id: Uuid,
    /// Проект документа или команда страницы вики: по ним решается, кому показывать
    #[serde(skip)]
    pub place: Place,
    pub rev: i64,
    pub start: u32,
    pub end: u32,
}

/// Что изменилось в присутствии
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Update {
    /// Человек в этом блоке (новый или другой)
    Set(Mark),
    /// Подключение больше не в блоке
    Gone { client: String, user_id: Uuid },
}

struct Entry {
    mark: Mark,
    /// Когда клиент последний раз подтвердил своё положение
    seen: Instant,
}

struct Inner {
    marks: Mutex<HashMap<u64, Entry>>,
    tx: broadcast::Sender<Arc<Update>>,
    next: AtomicU64,
}

/// Реестр присутствия. Один на сервер: он у нас один.
#[derive(Clone)]
pub struct Presence {
    inner: Arc<Inner>,
}

impl Default for Presence {
    fn default() -> Self {
        Presence::new(CAPACITY)
    }
}

impl Presence {
    pub fn new(capacity: usize) -> Self {
        Presence {
            inner: Arc::new(Inner {
                marks: Mutex::new(HashMap::new()),
                tx: broadcast::channel(capacity).0,
                next: AtomicU64::new(1),
            }),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Arc<Update>> {
        self.inner.tx.subscribe()
    }

    /// Все метки сейчас
    pub fn snapshot(&self) -> Vec<Mark> {
        let mut marks: Vec<Mark> = self.lock().values().map(|e| e.mark.clone()).collect();
        marks.sort_by(|a, b| a.client.len().cmp(&b.client.len()).then_with(|| a.client.cmp(&b.client)));
        marks
    }

    /// Новое подключение. Пока оно живо, его положение лежит в реестре; когда его бросают, запись снимается.
    pub fn attach(&self) -> Attached {
        let id = self.inner.next.fetch_add(1, Ordering::Relaxed);
        Attached { presence: self.clone(), id }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<u64, Entry>> {
        self.inner.marks.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn set(&self, conn: u64, mark: Mark) {
        let mut marks = self.lock();
        if let Some(entry) = marks.get_mut(&conn)
            && entry.mark == mark
        {
            // то же положение: клиент лишь подтверждает его, остальным сообщать нечего
            entry.seen = Instant::now();
            return;
        }
        marks.insert(conn, Entry { mark: mark.clone(), seen: Instant::now() });
        // под замком, чтобы порядок сообщений совпадал с порядком в реестре
        let _ = self.inner.tx.send(Arc::new(Update::Set(mark)));
    }

    fn remove(&self, conn: u64) {
        let mut marks = self.lock();
        if let Some(entry) = marks.remove(&conn) {
            let gone = Update::Gone { client: entry.mark.client, user_id: entry.mark.user_id };
            let _ = self.inner.tx.send(Arc::new(gone));
        }
    }

    fn expire(&self, conn: u64, ttl: Duration) {
        let stale = self.lock().get(&conn).is_some_and(|e| e.seen.elapsed() > ttl);
        if stale {
            self.remove(conn);
        }
    }
}

/// Подключение в реестре присутствия
pub struct Attached {
    presence: Presence,
    id: u64,
}

impl Attached {
    /// Метка этого подключения для других людей
    pub fn client(&self) -> String {
        self.id.to_string()
    }

    /// Человек в этом блоке (или подтверждает, что всё ещё в нём)
    pub fn set(&self, user_id: Uuid, place: Place, focus: &Focus) {
        let mark = Mark {
            client: self.client(),
            user_id,
            kind: focus.kind,
            id: focus.id,
            place,
            rev: focus.rev,
            start: focus.start,
            end: focus.end,
        };
        self.presence.set(self.id, mark);
    }

    /// Человек ушёл из блока
    pub fn clear(&self) {
        self.presence.remove(self.id);
    }

    /// Снимает запись, если её не подтверждали дольше `ttl`
    pub fn expire(&self, ttl: Duration) {
        self.presence.expire(self.id, ttl);
    }
}

impl Drop for Attached {
    fn drop(&mut self) {
        self.presence.remove(self.id);
    }
}
