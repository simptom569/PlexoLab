//! WebSocket `/api/v1/ws` на настоящем порту: вход первым сообщением, `ready`, события, `ping` и `pong`, отставший
//! клиент, истёкший токен, остановка сервера, лимит соединений. Какие ручки какие события дают, проверяет events.rs.

mod common;

use std::{net::SocketAddr, time::Duration};

use api::{AppState, Event, Realtime, router};
use axum::{body::Body, http::Request};
use common::{SECRET, id_of, login_ok, make_project, make_user, str_field};
use db::{PgPool, users::User};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::{net::TcpStream, task::JoinHandle, time::timeout};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async,
    tungstenite::{Error as WsError, Message},
};
use tower::ServiceExt;

type Client = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// Что пришло от сервера
#[derive(Debug)]
enum Incoming {
    Json(Value),
    /// Сервер закрыл соединение с этим кодом
    Closed(Option<u16>),
}

/// Сервер на свободном порту вместе с пользователем и его токеном
struct Rt {
    state: AppState,
    addr: SocketAddr,
    user: User,
    token: String,
    _server: JoinHandle<()>,
}

fn quick() -> Realtime {
    Realtime {
        // с запасом на нагруженную машину: пауза в десятки миллисекунд не должна ронять тест
        auth_timeout: Duration::from_millis(600),
        heartbeat: Duration::from_millis(100),
        idle_timeout: Duration::from_millis(800),
        max_connections: 100,
    }
}

async fn start(pool: PgPool, configure: impl FnOnce(AppState) -> AppState) -> Rt {
    let user = make_user(&pool, "tester@example.com", "Тестер Т.", "test-password").await;
    let state = configure(AppState::new(pool, SECRET));
    let app = router(state.clone());
    let token = {
        let tokens = login_ok(&app, "tester@example.com", "test-password").await;
        str_field(&tokens, "access_token").to_owned()
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Rt { state, addr, user, token, _server: server }
}

impl Rt {
    async fn connect(&self) -> Client {
        connect_async(format!("ws://{}/api/v1/ws", self.addr)).await.expect("подключение к /api/v1/ws").0
    }

    /// Подключение с уже сделанным входом и ответом `ready`
    async fn ready(&self) -> Client {
        let mut ws = self.connect().await;
        send(&mut ws, json!({ "type": "auth", "token": self.token })).await;
        assert_eq!(next_json(&mut ws).await, json!({ "type": "ready" }));
        ws
    }
}

async fn send(ws: &mut Client, message: Value) {
    ws.send(Message::Text(message.to_string().into())).await.unwrap();
}

/// Следующее сообщение; `None`, если за `wait` ничего не пришло
async fn recv(ws: &mut Client, wait: Duration) -> Option<Incoming> {
    loop {
        match timeout(wait, ws.next()).await {
            Err(_) => return None,
            Ok(None) | Ok(Some(Err(_))) => return Some(Incoming::Closed(None)),
            Ok(Some(Ok(Message::Text(text)))) => {
                return Some(Incoming::Json(serde_json::from_str(&text).expect("сообщение — JSON")));
            }
            Ok(Some(Ok(Message::Close(frame)))) => return Some(Incoming::Closed(frame.map(|f| u16::from(f.code)))),
            Ok(Some(Ok(_))) => continue, // служебные кадры протокола
        }
    }
}

const WAIT: Duration = Duration::from_secs(3);

async fn next_json(ws: &mut Client) -> Value {
    match recv(ws, WAIT).await {
        Some(Incoming::Json(v)) => v,
        other => panic!("ожидалось сообщение, пришло {other:?}"),
    }
}

/// Ждёт закрытия и возвращает код
async fn closed_with(ws: &mut Client) -> Option<u16> {
    loop {
        match recv(ws, WAIT).await {
            Some(Incoming::Closed(code)) => return code,
            Some(Incoming::Json(_)) => continue, // служебные сообщения перед закрытием
            None => panic!("соединение не закрылось"),
        }
    }
}

async fn quiet(ws: &mut Client, wait: Duration) {
    if let Some(m) = recv(ws, wait).await {
        panic!("ничего не ждали, пришло {m:?}");
    }
}

fn event(kind: &'static str) -> Event {
    Event { kind, id: None, project_id: None, origin: None, audience: api::events::Audience::Everyone }
}

/// Запрос к API напрямую (минуя сокет), с меткой клиента
async fn rest(rt: &Rt, client: &str, method: &str, uri: &str, body: Value) -> Value {
    let app = router(rt.state.clone());
    let req = Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", format!("Bearer {}", rt.token))
        .header("content-type", "application/json")
        .header("x-client-id", client)
        .body(Body::from(body.to_string()))
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert!(res.status().is_success(), "{method} {uri}: {}", res.status());
    let bytes = http_body_util::BodyExt::collect(res.into_body()).await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}

// ===== Вход =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn valid_token_in_the_first_message_gives_ready(pool: PgPool) {
    let rt = start(pool, |s| s).await;
    let mut ws = rt.connect().await;
    quiet(&mut ws, Duration::from_millis(100)).await; // пока не вошли, сервер молчит
    send(&mut ws, json!({ "type": "auth", "token": rt.token })).await;
    assert_eq!(next_json(&mut ws).await, json!({ "type": "ready" }));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn bad_token_is_refused_with_4401(pool: PgPool) {
    let rt = start(pool, |s| s).await;
    for token in ["", "не-токен", "a.b.c", &format!("{}x", rt.token)] {
        let mut ws = rt.connect().await;
        send(&mut ws, json!({ "type": "auth", "token": token })).await;
        assert_eq!(next_json(&mut ws).await, json!({ "type": "error", "code": "unauthorized" }), "токен {token:?}");
        assert_eq!(closed_with(&mut ws).await, Some(4401), "токен {token:?}");
    }
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn something_else_instead_of_the_token_is_refused(pool: PgPool) {
    let rt = start(pool, |s| s).await;
    for message in [json!({ "type": "pong" }), json!({ "type": "auth" }), json!({ "hello": 1 }), json!([1, 2])] {
        let mut ws = rt.connect().await;
        send(&mut ws, message.clone()).await;
        assert_eq!(closed_with(&mut ws).await, Some(4401), "{message}");
    }
    let mut ws = rt.connect().await;
    ws.send(Message::Text("не json".into())).await.unwrap();
    assert_eq!(closed_with(&mut ws).await, Some(4401));
    let mut ws = rt.connect().await;
    ws.send(Message::Binary(vec![1, 2, 3].into())).await.unwrap();
    assert_eq!(closed_with(&mut ws).await, Some(4401));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn token_in_the_address_is_not_accepted(pool: PgPool) {
    // токен в адресе попал бы в журналы: вход только первым сообщением
    let rt = start(pool, |s| s.with_realtime(quick())).await;
    let mut ws = connect_async(format!("ws://{}/api/v1/ws?token={}", rt.addr, rt.token)).await.unwrap().0;
    assert_eq!(
        closed_with(&mut ws).await,
        Some(4408),
        "без сообщения auth вход не засчитан, и сервер дождался таймаута"
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn silence_after_connecting_is_closed_with_4408(pool: PgPool) {
    let rt = start(pool, |s| s.with_realtime(quick())).await;
    let mut ws = rt.connect().await;
    assert_eq!(closed_with(&mut ws).await, Some(4408));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn plain_http_request_to_the_ws_address_is_not_an_upgrade(pool: PgPool) {
    let rt = start(pool, |s| s).await;
    let res = rt_http_get(&rt, "/api/v1/ws").await;
    assert!(res.is_client_error(), "GET без Upgrade: {res}");
}

async fn rt_http_get(rt: &Rt, uri: &str) -> axum::http::StatusCode {
    let req = Request::builder().uri(uri).body(Body::empty()).unwrap();
    router(rt.state.clone()).oneshot(req).await.unwrap().status()
}

// ===== События =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn change_made_over_rest_reaches_the_socket_with_the_origin(pool: PgPool) {
    let rt = start(pool.clone(), |s| s).await;
    let project = make_project(&pool, "WEB", "Web-приложение", "accent").await;
    let mut ws = rt.ready().await;

    let task =
        rest(&rt, "client-A", "POST", &format!("/api/v1/projects/{project}/tasks"), json!({ "title": "Новая" })).await;
    assert_eq!(
        next_json(&mut ws).await,
        json!({ "type": "task.created", "id": null, "project_id": project.to_string(), "origin": "client-A" })
    );
    assert_eq!(next_json(&mut ws).await["type"], "activity.created");

    rest(&rt, "client-B", "PATCH", &format!("/api/v1/tasks/{}", id_of(&task)), json!({ "title": "Другая" })).await;
    assert_eq!(
        next_json(&mut ws).await,
        json!({ "type": "task.updated", "id": id_of(&task).to_string(), "project_id": project.to_string(), "origin": "client-B" })
    );
    assert_eq!(next_json(&mut ws).await["type"], "activity.created");
    quiet(&mut ws, Duration::from_millis(100)).await;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn every_connected_client_gets_every_event(pool: PgPool) {
    let rt = start(pool, |s| s).await;
    let mut a = rt.ready().await;
    let mut b = rt.ready().await;
    let mut c = rt.ready().await;
    rest(&rt, "x", "POST", "/api/v1/link-groups", json!({ "title": "Код" })).await;
    for ws in [&mut a, &mut b, &mut c] {
        assert_eq!(next_json(ws).await["type"], "link.changed");
    }
    // отключившийся не мешает остальным
    drop(b);
    rest(&rt, "x", "POST", "/api/v1/link-groups", json!({ "title": "Ещё" })).await;
    for ws in [&mut a, &mut c] {
        assert_eq!(next_json(ws).await["type"], "link.changed");
    }
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn event_right_after_ready_is_not_lost(pool: PgPool) {
    let rt = start(pool, |s| s).await;
    let mut ws = rt.connect().await;
    send(&mut ws, json!({ "type": "auth", "token": rt.token })).await;
    // событие может случиться сразу после «ready», пока клиент ещё не прочитал его: подписка уже оформлена
    assert_eq!(next_json(&mut ws).await["type"], "ready");
    rt.state.events.publish(event("doc.updated"));
    assert_eq!(next_json(&mut ws).await["type"], "doc.updated");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn events_before_login_are_not_delivered(pool: PgPool) {
    let rt = start(pool, |s| s).await;
    let mut ws = rt.connect().await;
    rt.state.events.publish(event("doc.updated"));
    send(&mut ws, json!({ "type": "auth", "token": rt.token })).await;
    assert_eq!(next_json(&mut ws).await["type"], "ready");
    quiet(&mut ws, Duration::from_millis(150)).await; // то, что было до подписки, клиент увидит, перечитав данные
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn lagging_client_is_told_to_resync(pool: PgPool) {
    let rt = start(pool, |s| s.with_event_capacity(2)).await;
    let mut ws = rt.ready().await;
    // событий больше, чем влезает в канал, а сервер не успевает их разобрать: до первого await он не работает
    for _ in 0..10 {
        rt.state.events.publish(event("doc.updated"));
    }
    let mut kinds = Vec::new();
    while let Some(Incoming::Json(m)) = recv(&mut ws, Duration::from_millis(300)).await {
        kinds.push(m["type"].as_str().unwrap().to_owned());
    }
    assert_eq!(kinds.first().map(String::as_str), Some("resync"), "сначала «перечитай всё»: {kinds:?}");
    assert!(kinds[1..].iter().all(|k| k == "doc.updated"), "потом то, что ещё осталось в канале: {kinds:?}");
}

// ===== ping и pong =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn server_pings_and_a_pong_keeps_the_connection_alive(pool: PgPool) {
    let rt = start(pool, |s| s.with_realtime(quick())).await;
    let mut ws = rt.ready().await;
    // дольше терпения сервера (800 мс): жива, только пока отвечает
    for _ in 0..12 {
        let ping = next_json(&mut ws).await;
        assert_eq!(ping, json!({ "type": "ping" }));
        send(&mut ws, json!({ "type": "pong" })).await;
    }
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn client_that_stops_answering_is_dropped(pool: PgPool) {
    let rt = start(pool, |s| s.with_realtime(quick())).await;
    let mut ws = rt.ready().await;
    assert_eq!(next_json(&mut ws).await, json!({ "type": "ping" }));
    assert_eq!(closed_with(&mut ws).await, Some(4408), "молчит дольше idle_timeout");
    // и место освободилось
    assert_eq!(rt.state.connections.available_permits(), 100);
}

// ===== Срок токена, остановка, лимит =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn connection_is_closed_with_4401_when_the_token_expires(pool: PgPool) {
    let rt = start(pool, |s| s).await;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
    // токен, которому осталась секунда жизни
    let token =
        domain::auth::issue_access_token(SECRET.as_bytes(), rt.user.id, now - domain::auth::ACCESS_TTL_SECS + 1)
            .unwrap();
    let mut ws = rt.connect().await;
    send(&mut ws, json!({ "type": "auth", "token": token })).await;
    assert_eq!(next_json(&mut ws).await, json!({ "type": "ready" }));
    assert_eq!(closed_with(&mut ws).await, Some(4401));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn connections_are_closed_when_the_server_stops(pool: PgPool) {
    let rt = start(pool, |s| s).await;
    let mut a = rt.ready().await;
    let mut b = rt.ready().await;
    rt.state.begin_shutdown();
    assert_eq!(closed_with(&mut a).await, Some(1001));
    assert_eq!(closed_with(&mut b).await, Some(1001));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn connections_over_the_limit_get_503_and_places_are_freed(pool: PgPool) {
    let rt = start(pool, |s| s.with_realtime(Realtime { max_connections: 2, ..Realtime::default() })).await;
    let a = rt.ready().await;
    let _b = rt.ready().await;

    match connect_async(format!("ws://{}/api/v1/ws", rt.addr)).await {
        Err(WsError::Http(response)) => assert_eq!(response.status(), 503),
        other => panic!("ожидался отказ 503, получено {:?}", other.map(|_| ())),
    }

    drop(a); // клиент ушёл: его место освобождается
    let mut again = None;
    for _ in 0..20 {
        if let Ok((ws, _)) = connect_async(format!("ws://{}/api/v1/ws", rt.addr)).await {
            again = Some(ws);
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(again.is_some(), "после ухода клиента место должно освободиться");
}
