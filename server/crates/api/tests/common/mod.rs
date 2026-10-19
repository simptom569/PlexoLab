#![allow(dead_code)] // каждый тестовый файл использует свою часть помощников

use api::{AppState, router};
use axum::{
    Router,
    body::Body,
    http::{
        HeaderMap, Method, Request, StatusCode,
        header::{AUTHORIZATION, CONTENT_TYPE},
    },
};
use db::{
    PgPool,
    users::{NewUser, User},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

pub const SECRET: &str = "integration-test-secret-integration-test";

pub fn app(pool: PgPool) -> Router {
    router(AppState::new(pool, SECRET))
}

/// Приложение без базы: подходит для проверок, которые до базы не доходят (401, 404, CORS, OpenAPI)
pub fn app_without_db() -> Router {
    app(PgPool::connect_lazy("postgres://nobody@127.0.0.1:1/none").unwrap())
}

pub struct Reply {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: Value,
}

pub async fn send(app: &Router, method: Method, uri: &str, body: Option<Value>, bearer: Option<&str>) -> Reply {
    let mut req = Request::builder().method(method).uri(uri);
    if let Some(token) = bearer {
        req = req.header(AUTHORIZATION, format!("Bearer {token}"));
    }
    let req = match body {
        Some(b) => req.header(CONTENT_TYPE, "application/json").body(Body::from(b.to_string())),
        None => req.body(Body::empty()),
    }
    .unwrap();
    reply(app.clone().oneshot(req).await.unwrap()).await
}

pub async fn reply(res: axum::response::Response) -> Reply {
    let (parts, body) = res.into_parts();
    let bytes = body.collect().await.unwrap().to_bytes();
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()))
    };
    Reply { status: parts.status, headers: parts.headers, body }
}

pub async fn get(app: &Router, uri: &str, bearer: Option<&str>) -> Reply {
    send(app, Method::GET, uri, None, bearer).await
}

pub async fn post(app: &Router, uri: &str, body: Value) -> Reply {
    send(app, Method::POST, uri, Some(body), None).await
}

pub async fn make_user(pool: &PgPool, email: &str, name: &str, password: &str) -> User {
    db::users::create(
        pool,
        &NewUser {
            email: email.to_owned(),
            name: name.to_owned(),
            role: "Frontend".to_owned(),
            tone: 2,
            is_admin: false,
            password_hash: domain::auth::hash_password(password).unwrap(),
        },
    )
    .await
    .unwrap()
}

pub async fn login(app: &Router, email: &str, password: &str) -> Reply {
    post(app, "/api/v1/auth/login", json!({ "email": email, "password": password })).await
}

/// Вход с проверкой успеха: возвращает тело ответа
pub async fn login_ok(app: &Router, email: &str, password: &str) -> Value {
    let r = login(app, email, password).await;
    assert_eq!(r.status, StatusCode::OK, "вход не удался: {}", r.body);
    r.body
}

pub fn str_field<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or_else(|| panic!("нет строки «{key}» в {v}"))
}
