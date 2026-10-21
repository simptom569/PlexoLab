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
//! 5. когда токен истекает, сервер закрывает соединение с кодом 4401, и клиент входит заново с новым токеном.

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
use serde::Deserialize;
use tokio::{
    sync::broadcast::error::RecvError,
    time::{Instant, interval, sleep, timeout},
};

use uuid::Uuid;

use crate::{
    events::{Audience, Event},
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
    // проекты, события которых получает этот человек; обновляется, когда меняется состав участников
    let mut visible = HashSet::new();
    refresh(&mut visible, &state, user_id).await;
    if !send_text(&mut socket, READY).await {
        return;
    }

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
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return,
                // «pong» и любое другое сообщение значит, что клиент жив
                Some(Ok(_)) => last_seen = Instant::now(),
            },
            _ = beat.tick() => {
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

/// Перечитывает, события каких проектов положено получать человеку. Не вышло прочитать: остаётся прежний список.
async fn refresh(visible: &mut HashSet<Uuid>, state: &AppState, user_id: Uuid) {
    if let Ok(ids) = db::members::project_ids(&state.pool, user_id).await {
        *visible = ids.into_iter().collect();
    }
}

/// Нужно ли слать событие этому человеку (docs/PROJECTS.md, раздел 5): события проекта получают только его участники
async fn wanted(event: &Event, user_id: Uuid, visible: &mut HashSet<Uuid>, state: &AppState) -> bool {
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
            visible.contains(project_id)
        }
    }
}

async fn send_event(socket: &mut WebSocket, event: &Event) -> bool {
    match serde_json::to_string(event) {
        Ok(json) => send_text(socket, &json).await,
        Err(_) => true, // событие не собрать: пропускаем его, а соединение не рвём
    }
}
