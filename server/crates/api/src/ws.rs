//! WebSocket `/api/v1/ws`: клиент подключается после входа и получает события об изменениях (см. `events`).
//!
//! Разговор такой (всё текстовые сообщения JSON):
//!
//! 1. клиент подключается и первым сообщением присылает `{"type":"auth","token":"<токен доступа>"}`. Токен не в адресе:
//!    адреса попадают в журналы сервера и прокси, а сообщения нет. Не прислал за `auth_timeout`, прислал не то или
//!    чужой токен: сервер закрывает соединение (4408 или 4401);
//! 2. сервер отвечает `{"type":"ready"}`. Подписка на события оформлена до этого ответа, поэтому всё, что случилось
//!    после него, клиент получит, а всё, что до него, клиент увидит, перечитав данные;
//! 3. дальше сервер шлёт события `{"type":"task.updated","id":…,"project_id":…,"origin":…}`. Клиент, который успел
//!    отстать, получает `{"type":"resync"}`: часть событий пропущена, надо перечитать всё;
//! 4. сервер каждые `heartbeat` шлёт `{"type":"ping"}`, клиент отвечает `{"type":"pong"}`. Кто молчит дольше
//!    `idle_timeout`, считается отключившимся. Клиент так же следит за сервером: связь, оборванная без закрытия
//!    (сон ноутбука, смена сети), иначе осталась бы «живой» до таймаута TCP;
//! 5. когда токен истекает, сервер закрывает соединение с кодом 4401, и клиент входит заново с новым токеном;
//! 6. присутствие (`presence`): клиент сообщает, в каком блоке страницы или документа он сейчас, сообщением
//!    `{"type":"focus","kind":"wiki"|"doc","id":…,"rev":…,"start":…,"end":…}` (его же повторяет, пока человек в блоке) и
//!    `{"type":"blur"}`, когда ушёл. Остальные получают `{"type":"presence.set","mark":{…}}` и
//!    `{"type":"presence.gone","client":…}`, а сразу после `ready` (и после отставания) полный список
//!    `{"type":"presence","marks":[…]}`. Свои метки человек не получает, чужие документы из закрытых проектов тоже.
//!    Текста в этих сообщениях нет (см. `presence`).

use std::{
    collections::HashSet,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    extract::{
        State,
        ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade},
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use tokio::{
    sync::broadcast::error::RecvError,
    time::{Instant, interval, sleep, timeout},
};

use uuid::Uuid;

use crate::{
    events::{Audience, Event},
    presence::{Attached, Focus, Kind, MAX_MESSAGE_BYTES, MAX_PER_SECOND, Mark, Place, Presence, Update},
    state::AppState,
};

/// Токен не принят или истёк: клиент должен получить новый и подключиться заново
pub const CLOSE_UNAUTHORIZED: u16 = 4401;
/// Не дождались сообщения с токеном или ответа на `ping`
pub const CLOSE_TIMEOUT: u16 = 4408;
/// Сервер останавливается (стандартный код «ухожу»)
pub const CLOSE_GOING_AWAY: u16 = 1001;

const READY: &str = r#"{"type":"ready"}"#;
const PING: &str = r#"{"type":"ping"}"#;
const RESYNC: &str = r#"{"type":"resync"}"#;
const UNAUTHORIZED: &str = r#"{"type":"error","code":"unauthorized"}"#;

/// То, что клиент присылает серверу
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum ClientMessage {
    Auth { token: String },
    Pong,
    Focus(Focus),
    Blur,
}

/// Подключение. Мест ограниченное число: когда они кончились, сервер отвечает 503, и клиент повторит позже.
pub async fn handler(State(state): State<AppState>, ws: WebSocketUpgrade) -> Response {
    let Ok(permit) = state.connections.clone().try_acquire_owned() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    ws.on_upgrade(move |socket| async move {
        session(socket, state).await;
        drop(permit);
    })
}

fn unix_now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

async fn send_text(socket: &mut WebSocket, text: &str) -> bool {
    socket.send(Message::Text(text.into())).await.is_ok()
}

async fn close(socket: &mut WebSocket, code: u16, reason: &'static str) {
    let _ = socket.send(Message::Close(Some(CloseFrame { code, reason: reason.into() }))).await;
}

/// Ждёт сообщение с токеном. `Some((срок действия токена, человек))`, если вошли; иначе уже отправлено закрытие.
async fn authenticate(socket: &mut WebSocket, state: &AppState) -> Option<(u64, Uuid)> {
    loop {
        let message = socket.recv().await?.ok()?;
        let text = match message {
            Message::Text(text) => text,
            Message::Close(_) => return None,
            // служебные кадры (ping/pong самого протокола) вход не заменяют, а всё остальное не по правилам
            Message::Ping(_) | Message::Pong(_) => continue,
            Message::Binary(_) => {
                send_text(socket, UNAUTHORIZED).await;
                close(socket, CLOSE_UNAUTHORIZED, "ожидалось сообщение auth").await;
                return None;
            }
        };
        let claims = match serde_json::from_str::<ClientMessage>(&text) {
            Ok(ClientMessage::Auth { token }) => domain::auth::verify_access_token(&state.jwt_secret, &token).ok(),
            _ => None,
        };
        return match claims {
            Some(claims) => Some((claims.exp, claims.sub)),
            None => {
                send_text(socket, UNAUTHORIZED).await;
                close(socket, CLOSE_UNAUTHORIZED, "токен не принят").await;
                None
            }
        };
    }
}

async fn session(mut socket: WebSocket, state: AppState) {
    let realtime = state.realtime.clone();
    let mut shutdown = state.shutdown.subscribe();

    // 1. вход
    let (expires_at, user_id) = match timeout(realtime.auth_timeout, authenticate(&mut socket, &state)).await {
        Ok(Some(who)) => who,
        Ok(None) => return,
        Err(_) => {
            close(&mut socket, CLOSE_TIMEOUT, "не дождались токена").await;
            return;
        }
    };

    // 2. подписка раньше, чем «ready»: ни одно событие после «ready» не потеряется
    let mut events = state.events.subscribe();
    let mut presence_updates = state.presence.subscribe();
    let me = state.presence.attach();
    // проекты и команды, события которых получает этот человек; обновляется, когда меняется состав участников
    let mut visible = Visible::default();
    refresh(&mut visible, &state, user_id).await;
    if !send_text(&mut socket, READY).await {
        return;
    }
    // кто где сейчас: клиент без этого узнал бы только о тех, кто сдвинется после его подключения
    // метки, о которых этот клиент уже знает: снимать ему нужно только их
    let mut shown: HashSet<String> = HashSet::new();
    if !send_presence_snapshot(&mut socket, &state.presence, user_id, &visible, &mut shown, false).await {
        return;
    }
    let mut limiter = Limiter::new();
    // страница или документ, с которым работает этот человек, и его место: чтобы не спрашивать базу на каждое сообщение
    let mut target: Option<(Uuid, Option<Place>)> = None;

    // 3. работа
    let mut last_seen = Instant::now();
    let mut beat = interval(realtime.heartbeat);
    beat.tick().await; // первый тик срабатывает сразу, а пинговать только что подключившегося незачем
    let expiry = sleep(Duration::from_secs(expires_at.saturating_sub(unix_now())));
    tokio::pin!(expiry);

    loop {
        tokio::select! {
            biased;
            _ = shutdown.changed() => {
                close(&mut socket, CLOSE_GOING_AWAY, "сервер останавливается").await;
                return;
            }
            _ = &mut expiry => {
                close(&mut socket, CLOSE_UNAUTHORIZED, "токен истёк").await;
                return;
            }
            received = events.recv() => {
                let sent = match received {
                    Ok(event) => !wanted(&event, user_id, &mut visible, &state).await || send_event(&mut socket, &event).await,
                    // отстали: часть событий потеряна, пусть клиент перечитает всё
                    Err(RecvError::Lagged(_)) => send_text(&mut socket, RESYNC).await,
                    Err(RecvError::Closed) => return,
                };
                if !sent {
                    return;
                }
            }
            update = presence_updates.recv() => {
                let sent = match update {
                    Ok(update) => send_presence_update(&mut socket, &update, user_id, &visible, &mut shown).await,
                    // отстали: часть обновлений потеряна, присылаем всё заново
                    Err(RecvError::Lagged(_)) => {
                        send_presence_snapshot(&mut socket, &state.presence, user_id, &visible, &mut shown, true).await
                    }
                    Err(RecvError::Closed) => return,
                };
                if !sent {
                    return;
                }
            }
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return,
                Some(Ok(Message::Text(text))) => {
                    last_seen = Instant::now();
                    on_client_message(&text, &me, user_id, &visible, &state, &mut limiter, &mut target).await;
                }
                // «pong» и любое другое сообщение значит, что клиент жив
                Some(Ok(_)) => last_seen = Instant::now(),
            },
            _ = beat.tick() => {
                me.expire(realtime.presence_ttl);
                if last_seen.elapsed() > realtime.idle_timeout {
                    close(&mut socket, CLOSE_TIMEOUT, "нет ответа").await;
                    return;
                }
                if !send_text(&mut socket, PING).await {
                    return;
                }
            }
        }
    }
}

/// Проекты и команды, события которых положено получать человеку
#[derive(Default)]
struct Visible {
    projects: HashSet<Uuid>,
    /// Команды, вики которых он читает
    teams: HashSet<Uuid>,
}

/// Перечитывает, события каких проектов и команд положено получать человеку. Не вышло прочитать: остаётся прежний список.
async fn refresh(visible: &mut Visible, state: &AppState, user_id: Uuid) {
    if let Ok(ids) = db::members::project_ids(&state.pool, user_id).await {
        visible.projects = ids.into_iter().collect();
    }
    if let Ok(ids) = db::teams::wiki_ids(&state.pool, user_id).await {
        visible.teams = ids.into_iter().collect();
    }
}

/// Нужно ли слать событие этому человеку (docs/TEAMS.md, раздел 13): события проекта получают те, кто его видит, события
/// вики и файлов команды те, кто их читает
async fn wanted(event: &Event, user_id: Uuid, visible: &mut Visible, state: &AppState) -> bool {
    match &event.audience {
        Audience::Everyone => true,
        Audience::Users(users) => {
            let mine = users.contains(&user_id);
            // человека добавили в проект или убрали из него: список его проектов изменился
            if mine {
                refresh(visible, state, user_id).await;
            }
            mine
        }
        Audience::Project(project_id) => {
            // состав участников мог поменяться и без личного события для этого человека (глобальный админ видит все проекты)
            if event.kind == "project.changed" {
                refresh(visible, state, user_id).await;
            }
            visible.projects.contains(project_id)
        }
        Audience::Team(team_id) => {
            if event.kind == "team.changed" {
                refresh(visible, state, user_id).await;
            }
            visible.teams.contains(team_id)
        }
    }
}

async fn send_event(socket: &mut WebSocket, event: &Event) -> bool {
    match serde_json::to_string(event) {
        Ok(json) => send_text(socket, &json).await,
        Err(_) => true, // событие не собрать: пропускаем его, а соединение не рвём
    }
}

// ===== Присутствие =====

/// Что сервер шлёт о присутствии
#[derive(Serialize)]
#[serde(tag = "type")]
enum PresenceMessage<'a> {
    /// Полный список: клиент заменяет им всё, что знал
    #[serde(rename = "presence")]
    All { marks: &'a [Mark] },
    #[serde(rename = "presence.set")]
    Set { mark: &'a Mark },
    #[serde(rename = "presence.gone")]
    Gone { client: &'a str },
}

async fn send_presence(socket: &mut WebSocket, message: &PresenceMessage<'_>) -> bool {
    match serde_json::to_string(message) {
        Ok(json) => send_text(socket, &json).await,
        Err(_) => true,
    }
}

/// Видна ли метка этому человеку: не его собственная, а в проекте, который ему открыт, или на вики команды, которую он читает
fn shown_to(mark: &Mark, user_id: Uuid, visible: &Visible) -> bool {
    mark.user_id != user_id
        && match mark.place {
            Place::Project(project) => visible.projects.contains(&project),
            Place::Team(team) => visible.teams.contains(&team),
        }
}

/// Все метки сейчас. Пустой список без просьбы не шлётся: клиент и так начинает с пустого.
async fn send_presence_snapshot(
    socket: &mut WebSocket,
    presence: &Presence,
    user_id: Uuid,
    visible: &Visible,
    shown: &mut HashSet<String>,
    always: bool,
) -> bool {
    let marks: Vec<Mark> = presence.snapshot().into_iter().filter(|m| shown_to(m, user_id, visible)).collect();
    // список заменяет всё, что клиент знал
    *shown = marks.iter().map(|m| m.client.clone()).collect();
    if marks.is_empty() && !always {
        return true;
    }
    send_presence(socket, &PresenceMessage::All { marks: &marks }).await
}

async fn send_presence_update(
    socket: &mut WebSocket,
    update: &Update,
    user_id: Uuid,
    visible: &Visible,
    shown: &mut HashSet<String>,
) -> bool {
    match update {
        Update::Set(mark) if mark.user_id == user_id => true,
        Update::Set(mark) if shown_to(mark, user_id, visible) => {
            shown.insert(mark.client.clone());
            send_presence(socket, &PresenceMessage::Set { mark }).await
        }
        // метка перешла туда, куда этому человеку нельзя: если он видел прежнюю, она ему больше не нужна
        Update::Set(mark) if shown.remove(&mark.client) => {
            send_presence(socket, &PresenceMessage::Gone { client: &mark.client }).await
        }
        Update::Gone { client, .. } if shown.remove(client) => {
            send_presence(socket, &PresenceMessage::Gone { client }).await
        }
        // чужие дела: человеку не сообщали, значит и снимать нечего
        Update::Set(_) | Update::Gone { .. } => true,
    }
}

/// Не больше `MAX_PER_SECOND` сообщений о положении в секунду от одного подключения: поддельный клиент не должен
/// заваливать остальных
struct Limiter {
    since: Instant,
    count: u32,
}

impl Limiter {
    fn new() -> Self {
        Limiter { since: Instant::now(), count: 0 }
    }

    fn allow(&mut self) -> bool {
        if self.since.elapsed() >= Duration::from_secs(1) {
            self.since = Instant::now();
            self.count = 0;
        }
        self.count += 1;
        self.count <= MAX_PER_SECOND
    }
}

/// Сообщение клиента после входа. Главное, что оно значит «клиент жив» (это уже учтено); сверх того разбираются
/// `focus` и `blur`, всё остальное (в том числе мусор) игнорируется.
async fn on_client_message(
    text: &str,
    me: &Attached,
    user_id: Uuid,
    visible: &Visible,
    state: &AppState,
    limiter: &mut Limiter,
    target: &mut Option<(Uuid, Option<Place>)>,
) {
    if text.len() > MAX_MESSAGE_BYTES {
        return;
    }
    match serde_json::from_str::<ClientMessage>(text) {
        Ok(ClientMessage::Focus(focus)) => {
            if !limiter.allow() || !focus.plausible() {
                return;
            }
            let place = match *target {
                Some((id, place)) if id == focus.id => place,
                _ => {
                    let found = match focus.kind {
                        Kind::Wiki => db::wiki::team_of(&state.pool, focus.id).await.map(|t| t.map(Place::Team)),
                        Kind::Doc => db::docs::project_of(&state.pool, focus.id).await.map(|p| p.map(Place::Project)),
                    };
                    let Ok(place) = found else { return };
                    *target = Some((focus.id, place));
                    place
                }
            };
            // страницы или документа нет, либо он в проекте или команде, которые этому человеку не открыты: метки у него
            // быть не может
            let allowed = match place {
                Some(Place::Project(project)) => visible.projects.contains(&project),
                Some(Place::Team(team)) => visible.teams.contains(&team),
                None => false,
            };
            let Some(place) = place.filter(|_| allowed) else {
                me.clear();
                return;
            };
            me.set(user_id, place, &focus);
        }
        Ok(ClientMessage::Blur) => me.clear(),
        _ => {}
    }
}
