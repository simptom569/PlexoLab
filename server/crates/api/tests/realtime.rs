//! WebSocket `/api/v1/ws` на настоящем порту: вход первым сообщением, `ready`, события, `ping` и `pong`, отставший
//! клиент, истёкший токен, остановка сервера, лимит соединений. Какие ручки какие события дают, проверяет events.rs.

mod common;

use std::{net::SocketAddr, time::Duration};

use api::{AppState, Event, Realtime, router};
use axum::{body::Body, http::Request};
use common::{
    SECRET, id_of, join, join_team, login_ok, make_project, make_project_with, make_user, personal_team, str_field,
};
use db::{PgPool, users::User};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::{net::TcpStream, task::JoinHandle, time::timeout};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async,
    tungstenite::{Error as WsError, Message},
};
use tower::ServiceExt;
use uuid::Uuid;

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
    pool: PgPool,
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
        presence_ttl: Duration::from_millis(400),
    }
}

async fn start(pool: PgPool, configure: impl FnOnce(AppState) -> AppState) -> Rt {
    let user = make_user(&pool, "tester@example.com", "Тестер Т.", "test-password").await;
    // страница вики в «Личном» первого человека: на неё в тестах присутствия «наводят» блоки (`PAGE`)
    db::sqlx::query("insert into wiki_pages (id, team_id, title, position) values ($1, $2, 'Страница', 1024)")
        .bind(PAGE)
        .bind(personal_team(&pool, user.id).await)
        .execute(&pool)
        .await
        .unwrap();
    let state = configure(AppState::new(pool.clone(), SECRET));
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
    Rt { pool, state, addr, user, token, _server: server }
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
    Event { kind, id: None, project_id: None, team_id: None, origin: None, audience: api::events::Audience::Everyone }
}

/// Запрос к API напрямую (минуя сокет), с меткой клиента
async fn rest(rt: &Rt, client: &str, method: &str, uri: &str, body: Value) -> Value {
    rest_with(rt, &rt.token, client, method, uri, body).await
}

/// То же от имени человека с этим токеном
async fn rest_with(rt: &Rt, token: &str, client: &str, method: &str, uri: &str, body: Value) -> Value {
    let app = router(rt.state.clone());
    let req = Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", format!("Bearer {token}"))
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
    let rt = start(pool.clone(), |s| s).await;
    let project = make_project(&pool, "WEB", "Web-приложение", "accent").await;
    let groups = format!("/api/v1/projects/{project}/link-groups");
    let mut a = rt.ready().await;
    let mut b = rt.ready().await;
    let mut c = rt.ready().await;
    rest(&rt, "x", "POST", &groups, json!({ "title": "Код" })).await;
    for ws in [&mut a, &mut b, &mut c] {
        assert_eq!(next_json(ws).await["type"], "link.changed");
    }
    // отключившийся не мешает остальным
    drop(b);
    rest(&rt, "x", "POST", &groups, json!({ "title": "Ещё" })).await;
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

// ===== Присутствие: кто в каком блоке =====

impl Rt {
    /// Второй человек: пользователь и его токен. Он член команды первого человека и потому видит его вики.
    async fn person(&self, email: &str, name: &str) -> (User, String) {
        let user = make_user(&self.pool, email, name, "test-password").await;
        join_team(&self.pool, personal_team(&self.pool, self.user.id).await, user.id, "member").await;
        let tokens = login_ok(&router(self.state.clone()), email, "test-password").await;
        (user, str_field(&tokens, "access_token").to_owned())
    }

    /// Подключение под этим токеном, вход сделан, пришёл `ready`
    async fn ready_as(&self, token: &str) -> Client {
        let mut ws = self.connect().await;
        send(&mut ws, json!({ "type": "auth", "token": token })).await;
        assert_eq!(next_json(&mut ws).await, json!({ "type": "ready" }));
        ws
    }
}

const PAGE: Uuid = Uuid::from_u128(0x1111);

fn focus(kind: &str, id: Uuid, rev: i64, start: u32, end: u32) -> Value {
    json!({ "type": "focus", "kind": kind, "id": id.to_string(), "rev": rev, "start": start, "end": end })
}

/// Читает всё, что приходит за `wait`, и отвечает на `ping`, чтобы соединение не сочли мёртвым. Вернёт остальное.
async fn pump(ws: &mut Client, wait: Duration) -> Vec<Value> {
    let end = tokio::time::Instant::now() + wait;
    let mut out = Vec::new();
    loop {
        let left = end.saturating_duration_since(tokio::time::Instant::now());
        match recv(ws, left).await {
            None => return out,
            Some(Incoming::Json(m)) if m["type"] == "ping" => send(ws, json!({ "type": "pong" })).await,
            Some(Incoming::Json(m)) => out.push(m),
            Some(Incoming::Closed(code)) => panic!("соединение закрыто: {code:?}"),
        }
    }
}

fn kinds(messages: &[Value]) -> Vec<&str> {
    messages.iter().map(|m| m["type"].as_str().unwrap()).collect()
}

async fn send_text(ws: &mut Client, text: &str) {
    ws.send(Message::Text(text.to_owned().into())).await.unwrap();
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_block_opened_by_one_person_is_seen_by_another_and_blur_removes_it(pool: PgPool) {
    let rt = start(pool, |s| s).await;
    let (_, token_b) = rt.person("b@example.com", "Борис Б.").await;
    let mut a = rt.ready().await;
    let mut b = rt.ready_as(&token_b).await;

    send(&mut a, focus("wiki", PAGE, 3, 2, 4)).await;
    let set = next_json(&mut b).await;
    assert_eq!(set["type"], "presence.set");
    let mark = &set["mark"];
    assert_eq!(mark["user_id"], rt.user.id.to_string());
    assert_eq!(
        (&mark["kind"], &mark["id"], &mark["rev"], &mark["start"], &mark["end"]),
        (&json!("wiki"), &json!(PAGE.to_string()), &json!(3), &json!(2), &json!(4))
    );
    assert!(mark.get("project_id").is_none(), "проект наружу не уходит");
    let client = mark["client"].as_str().unwrap().to_owned();
    quiet(&mut a, Duration::from_millis(100)).await; // свою метку человек не получает

    send(&mut a, json!({ "type": "blur" })).await;
    assert_eq!(next_json(&mut b).await, json!({ "type": "presence.gone", "client": client }));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn confirming_the_same_position_is_silent_and_a_move_is_announced(pool: PgPool) {
    let rt = start(pool, |s| s).await;
    let (_, token_b) = rt.person("b@example.com", "Борис Б.").await;
    let mut a = rt.ready().await;
    let mut b = rt.ready_as(&token_b).await;

    send(&mut a, focus("wiki", PAGE, 3, 2, 4)).await;
    let first = next_json(&mut b).await;
    send(&mut a, focus("wiki", PAGE, 3, 2, 4)).await;
    quiet(&mut b, Duration::from_millis(150)).await; // то же место: остальным сообщать нечего

    send(&mut a, focus("wiki", PAGE, 3, 6, 7)).await;
    let moved = next_json(&mut b).await;
    assert_eq!(moved["type"], "presence.set");
    assert_eq!((&moved["mark"]["start"], &moved["mark"]["end"]), (&json!(6), &json!(7)));
    assert_eq!(moved["mark"]["client"], first["mark"]["client"], "это то же подключение: у получателя метка переедет");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_newcomer_gets_the_list_right_after_ready(pool: PgPool) {
    let rt = start(pool, |s| s).await;
    let (_, token_b) = rt.person("b@example.com", "Борис Б.").await;
    let mut a = rt.ready().await;
    send(&mut a, focus("wiki", PAGE, 1, 0, 1)).await;
    // подождём, пока сервер примет сообщение: у подключения Бориса его ещё нет, он пока не слушает
    tokio::time::sleep(Duration::from_millis(100)).await;

    let mut b = rt.ready_as(&token_b).await;
    let list = next_json(&mut b).await;
    assert_eq!(list["type"], "presence");
    let marks = list["marks"].as_array().unwrap();
    assert_eq!(marks.len(), 1);
    assert_eq!(
        (&marks[0]["user_id"], &marks[0]["kind"], &marks[0]["id"]),
        (&json!(rt.user.id.to_string()), &json!("wiki"), &json!(PAGE.to_string()))
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_person_does_not_see_their_own_marks_from_another_connection(pool: PgPool) {
    let rt = start(pool, |s| s).await;
    let mut first = rt.ready().await;
    send(&mut first, focus("wiki", PAGE, 1, 0, 1)).await;
    tokio::time::sleep(Duration::from_millis(100)).await;

    let mut second = rt.ready().await; // тот же человек: списка нет
    quiet(&mut second, Duration::from_millis(150)).await;
    send(&mut second, focus("wiki", PAGE, 1, 5, 6)).await;
    quiet(&mut first, Duration::from_millis(150)).await;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn closing_the_connection_removes_the_mark(pool: PgPool) {
    let rt = start(pool, |s| s).await;
    let (_, token_b) = rt.person("b@example.com", "Борис Б.").await;
    let mut a = rt.ready().await;
    let mut b = rt.ready_as(&token_b).await;
    send(&mut a, focus("wiki", PAGE, 1, 0, 1)).await;
    let client = next_json(&mut b).await["mark"]["client"].as_str().unwrap().to_owned();

    drop(a);
    assert_eq!(next_json(&mut b).await, json!({ "type": "presence.gone", "client": client }));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_silent_client_loses_the_mark_after_the_ttl_and_confirming_keeps_it(pool: PgPool) {
    let rt = start(pool, |s| s.with_realtime(quick())).await; // срок метки 400 мс, пульс 100 мс
    let (_, token_b) = rt.person("b@example.com", "Борис Б.").await;
    let mut a = rt.ready().await;
    let mut b = rt.ready_as(&token_b).await;
    send(&mut a, focus("wiki", PAGE, 1, 0, 1)).await;
    let client = next_json(&mut b).await["mark"]["client"].as_str().unwrap().to_owned();

    // подтверждает: метка живёт втрое дольше срока
    for _ in 0..12 {
        send(&mut a, focus("wiki", PAGE, 1, 0, 1)).await;
        let seen = pump(&mut b, Duration::from_millis(100)).await;
        assert!(seen.is_empty(), "пока подтверждают, ничего не меняется: {seen:?}");
    }

    // перестал подтверждать, но соединение держит (отвечает на ping): метка снимается по сроку
    let mut gone = false;
    for _ in 0..30 {
        pump(&mut a, Duration::from_millis(20)).await;
        let seen = pump(&mut b, Duration::from_millis(80)).await;
        if seen.contains(&json!({ "type": "presence.gone", "client": client })) {
            gone = true;
            break;
        }
    }
    assert!(gone, "метку без подтверждения должны снять");

    // и соединение при этом живо: новое сообщение снова ставит метку
    send(&mut a, focus("wiki", PAGE, 1, 3, 4)).await;
    assert_eq!(kinds(&pump(&mut b, Duration::from_millis(300)).await), ["presence.set"]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn nonsense_position_messages_are_ignored(pool: PgPool) {
    let rt = start(pool, |s| s).await;
    let (_, token_b) = rt.person("b@example.com", "Борис Б.").await;
    let mut a = rt.ready().await;
    let mut b = rt.ready_as(&token_b).await;

    let long = json!({ "type": "focus", "kind": "wiki", "id": PAGE.to_string(), "rev": 1, "start": 0, "end": 1, "pad": "x".repeat(600) });
    for message in [
        focus("wiki", PAGE, 1, 4, 4),                   // пустой блок
        focus("wiki", PAGE, 1, 5, 2),                   // конец раньше начала
        focus("wiki", PAGE, -1, 0, 1),                  // версия не бывает отрицательной
        focus("wiki", PAGE, 1, 0, 9_000_000),           // номер строки с потолка
        focus("canvas", PAGE, 1, 0, 1),                 // такого места нет
        focus("doc", Uuid::from_u128(0x2222), 1, 0, 1), // документа нет
        json!({ "type": "focus", "kind": "wiki", "id": "не-uuid", "rev": 1, "start": 0, "end": 1 }),
        json!({ "type": "focus", "kind": "wiki" }),
        json!({ "type": "focus", "kind": "wiki", "id": PAGE.to_string(), "rev": 1, "start": -1, "end": 1 }),
        long,
    ] {
        send(&mut a, message.clone()).await;
        assert!(pump(&mut b, Duration::from_millis(40)).await.is_empty(), "не должно было пройти: {message}");
    }
    send_text(&mut a, "это не json").await;

    // соединение при этом живо, и настоящее сообщение проходит
    send(&mut a, focus("wiki", PAGE, 1, 0, 1)).await;
    assert_eq!(kinds(&pump(&mut b, Duration::from_millis(300)).await), ["presence.set"]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_flood_of_positions_is_limited(pool: PgPool) {
    let rt = start(pool, |s| s).await;
    let (_, token_b) = rt.person("b@example.com", "Борис Б.").await;
    let mut a = rt.ready().await;
    let mut b = rt.ready_as(&token_b).await;

    for i in 0..40 {
        send(&mut a, focus("wiki", PAGE, 1, i, i + 1)).await;
    }
    let seen = pump(&mut b, Duration::from_millis(400)).await;
    let sets = seen.iter().filter(|m| m["type"] == "presence.set").count();
    // в одну секунду проходит не больше десяти; если пачка пересекла границу секунды, то не больше двадцати
    assert!((1..=20).contains(&sets), "прошло {sets} из 40");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn document_marks_reach_only_members_of_its_project(pool: PgPool) {
    let rt = start(pool.clone(), |s| s).await;
    let project = make_project_with(&pool, "WEB", "Web-приложение", "accent").await;
    join(&pool, project, rt.user.id, "admin").await;
    let (_, outsider_token) = rt.person("out@example.com", "Посторонний П.").await;
    let (member, member_token) = rt.person("in@example.com", "Участник У.").await;
    join(&pool, project, member.id, "member").await;
    let doc =
        rest(&rt, "c", "POST", &format!("/api/v1/projects/{project}/docs"), json!({ "title": "Док", "mode": "page" }))
            .await;
    let doc = id_of(&doc);

    let mut a = rt.ready().await;
    let mut outside = rt.ready_as(&outsider_token).await;
    let mut inside = rt.ready_as(&member_token).await;

    send(&mut a, focus("doc", doc, 1, 0, 1)).await;
    let set = next_json(&mut inside).await;
    assert_eq!(
        (&set["type"], &set["mark"]["kind"], &set["mark"]["id"]),
        (&json!("presence.set"), &json!("doc"), &json!(doc.to_string()))
    );
    quiet(&mut outside, Duration::from_millis(150)).await; // документ чужого проекта посторонний не видит

    // и сам посторонний своим положением ничего не покажет: ему этот документ не открыт
    send(&mut outside, focus("doc", doc, 1, 0, 1)).await;
    quiet(&mut a, Duration::from_millis(150)).await;
    quiet(&mut inside, Duration::from_millis(50)).await;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_mark_that_moves_to_a_hidden_document_is_withdrawn(pool: PgPool) {
    let rt = start(pool.clone(), |s| s).await;
    let open = make_project_with(&pool, "WEB", "Web-приложение", "accent").await;
    let closed = make_project_with(&pool, "OPS", "Операции", "accent").await;
    join(&pool, open, rt.user.id, "admin").await;
    join(&pool, closed, rt.user.id, "admin").await;
    let (watcher, token) = rt.person("w@example.com", "Наблюдатель Н.").await;
    join(&pool, open, watcher.id, "member").await; // про закрытый проект он не знает
    let doc_in = |project: Uuid, title: &'static str| {
        let rt = &rt;
        async move {
            id_of(
                &rest(
                    rt,
                    "c",
                    "POST",
                    &format!("/api/v1/projects/{project}/docs"),
                    json!({ "title": title, "mode": "page" }),
                )
                .await,
            )
        }
    };
    let in_open = doc_in(open, "Открытый").await;
    let in_closed = doc_in(closed, "Закрытый").await;

    let mut a = rt.ready().await;
    let mut w = rt.ready_as(&token).await;
    send(&mut a, focus("doc", in_open, 1, 0, 1)).await;
    let client = next_json(&mut w).await["mark"]["client"].as_str().unwrap().to_owned();

    send(&mut a, focus("doc", in_closed, 1, 0, 1)).await;
    assert_eq!(
        next_json(&mut w).await,
        json!({ "type": "presence.gone", "client": client }),
        "прежняя метка у наблюдателя не должна зависнуть"
    );
}

// ===== Команды: вики и присутствие только тем, кто читает вики команды =====

impl Rt {
    /// Человек, который не член команды первого человека и не гость в ней
    async fn outsider(&self, email: &str) -> String {
        make_user(&self.pool, email, "Посторонний", "test-password").await;
        let tokens = login_ok(&router(self.state.clone()), email, "test-password").await;
        str_field(&tokens, "access_token").to_owned()
    }
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn wiki_events_reach_only_those_who_read_the_teams_wiki(pool: PgPool) {
    let rt = start(pool.clone(), |s| s).await;
    let team = personal_team(&pool, rt.user.id).await;
    let (_, mate_token) = rt.person("mate@example.com", "Член команды").await;
    let out_token = rt.outsider("out@example.com").await;
    let mut owner = rt.ready().await;
    let mut mate = rt.ready_as(&mate_token).await;
    let mut out = rt.ready_as(&out_token).await;

    rest(&rt, "client-A", "POST", &format!("/api/v1/teams/{team}/wiki"), json!({ "title": "П" })).await;
    for ws in [&mut owner, &mut mate] {
        assert_eq!(
            next_json(ws).await,
            json!({ "type": "wiki.updated", "id": null, "project_id": null, "team_id": team.to_string(), "origin": "client-A" })
        );
        assert_eq!(next_json(ws).await["type"], "activity.created");
    }
    quiet(&mut out, Duration::from_millis(200)).await;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_guest_gets_wiki_events_only_when_connected_after_the_team_allowed_it(pool: PgPool) {
    let rt = start(pool.clone(), |s| s).await;
    let team = personal_team(&pool, rt.user.id).await;
    let project = make_project_with(&pool, "WEB", "Web", "accent").await;
    let guest_token = rt.outsider("guest@example.com").await;
    let guest: Uuid = db::sqlx::query_scalar("select id from users where email = 'guest@example.com'").fetch_one(&pool).await.unwrap();
    join(&pool, project, guest, "member").await;

    let mut before = rt.ready_as(&guest_token).await;
    db::sqlx::query("update teams set guests_read_wiki = true where id = $1").bind(team).execute(&pool).await.unwrap();
    let mut after = rt.ready_as(&guest_token).await;

    rest(&rt, "c", "POST", &format!("/api/v1/teams/{team}/wiki"), json!({ "title": "П" })).await;
    assert_eq!(next_json(&mut after).await["type"], "wiki.updated");
    quiet(&mut before, Duration::from_millis(200)).await;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_block_on_a_wiki_page_is_seen_only_by_those_who_read_the_wiki(pool: PgPool) {
    let rt = start(pool, |s| s).await;
    let (_, mate_token) = rt.person("mate@example.com", "Член команды").await;
    let out_token = rt.outsider("out@example.com").await;
    let mut owner = rt.ready().await;
    let mut mate = rt.ready_as(&mate_token).await;
    let mut out = rt.ready_as(&out_token).await;

    send(&mut owner, focus("wiki", PAGE, 1, 0, 2)).await;
    assert_eq!(next_json(&mut mate).await["type"], "presence.set");
    quiet(&mut out, Duration::from_millis(200)).await;

    // чужой человек не может отметиться на странице, которой не читает
    send(&mut out, focus("wiki", PAGE, 1, 3, 4)).await;
    quiet(&mut owner, Duration::from_millis(200)).await;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn an_invited_person_starts_getting_team_events_after_accepting_and_stops_after_being_removed(pool: PgPool) {
    let rt = start(pool.clone(), |s| s).await;
    let guest_token = rt.outsider("guest@example.com").await;
    let guest: Uuid = db::sqlx::query_scalar("select id from users where email = 'guest@example.com'").fetch_one(&pool).await.unwrap();
    let team = id_of(&rest(&rt, "a", "POST", "/api/v1/teams", json!({ "name": "Веб" })).await);
    let mut owner = rt.ready().await;
    let mut ws = rt.ready_as(&guest_token).await;

    // приглашение: приглашённый узнаёт о нём лично; команды он ещё не видит, вики до него не доходит
    let invite = rest(&rt, "a", "POST", &format!("/api/v1/teams/{team}/invites"), json!({ "email": "guest@example.com" })).await;
    assert_eq!(next_json(&mut ws).await["type"], "team.changed");
    assert_eq!(next_json(&mut ws).await["type"], "team-invite.changed");
    rest(&rt, "a", "POST", &format!("/api/v1/teams/{team}/wiki"), json!({ "title": "П" })).await;
    quiet(&mut ws, Duration::from_millis(200)).await;
    while let Some(Incoming::Json(_)) = recv(&mut owner, Duration::from_millis(100)).await {}

    // принял: вики команды доходит и до него
    rest_with(&rt, &guest_token, "b", "POST", &format!("/api/v1/team-invites/{}/accept", id_of(&invite)), json!({})).await;
    let mut kinds = Vec::new();
    while let Some(Incoming::Json(m)) = recv(&mut ws, Duration::from_millis(200)).await {
        kinds.push(m["type"].as_str().unwrap().to_owned());
    }
    assert!(kinds.contains(&"team.changed".to_owned()), "{kinds:?}");
    rest(&rt, "a", "POST", &format!("/api/v1/teams/{team}/wiki"), json!({ "title": "Вторая" })).await;
    assert_eq!(next_json(&mut ws).await["type"], "wiki.updated");
    assert_eq!(next_json(&mut ws).await["type"], "activity.created");

    // исключили: о самом исключении он узнаёт, а вики больше не получает
    rest(&rt, "a", "DELETE", &format!("/api/v1/teams/{team}/members/{guest}"), json!({})).await;
    let mut removed = Vec::new();
    while let Some(Incoming::Json(m)) = recv(&mut ws, Duration::from_millis(200)).await {
        removed.push(m["type"].as_str().unwrap().to_owned());
    }
    assert!(removed.contains(&"team.changed".to_owned()), "{removed:?}");
    rest(&rt, "a", "POST", &format!("/api/v1/teams/{team}/wiki"), json!({ "title": "Третья" })).await;
    quiet(&mut ws, Duration::from_millis(300)).await;
}
