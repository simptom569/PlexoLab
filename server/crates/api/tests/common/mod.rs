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
use uuid::Uuid;

pub const SECRET: &str = "integration-test-secret-integration-test";

pub fn app(pool: PgPool) -> Router {
    router(AppState::new(pool, SECRET))
}

/// Приложение без базы: подходит для проверок, которые до базы не доходят (401, 404, CORS)
pub fn app_without_db() -> Router {
    app(PgPool::connect_lazy("postgres://nobody@127.0.0.1:1/none").unwrap())
}

/// То же, но с включённой схемой OpenAPI
pub fn app_with_openapi() -> Router {
    router(
        AppState::new(PgPool::connect_lazy("postgres://nobody@127.0.0.1:1/none").unwrap(), SECRET).with_openapi(true),
    )
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

/// Пользователь, уже вошедший в систему
pub struct Ctx {
    pub app: Router,
    pub pool: PgPool,
    pub token: String,
    pub user: User,
}

impl Ctx {
    pub async fn new(pool: PgPool) -> Ctx {
        let user = make_user(&pool, "tester@example.com", "Тестер Т.", "test-password").await;
        let app = app(pool.clone());
        let tokens = login_ok(&app, "tester@example.com", "test-password").await;
        let token = str_field(&tokens, "access_token").to_owned();
        Ctx { app, pool, token, user }
    }

    pub async fn get(&self, uri: &str) -> Reply {
        send(&self.app, Method::GET, uri, None, Some(&self.token)).await
    }
    pub async fn post(&self, uri: &str, body: Value) -> Reply {
        send(&self.app, Method::POST, uri, Some(body), Some(&self.token)).await
    }
    pub async fn patch(&self, uri: &str, body: Value) -> Reply {
        send(&self.app, Method::PATCH, uri, Some(body), Some(&self.token)).await
    }
    pub async fn delete(&self, uri: &str) -> Reply {
        send(&self.app, Method::DELETE, uri, None, Some(&self.token)).await
    }

    /// Ответ с ожидаемым статусом: при расхождении тест падает вместе с телом ответа
    pub async fn ok(&self, r: Reply, status: StatusCode) -> Value {
        assert_eq!(r.status, status, "тело ответа: {}", r.body);
        r.body
    }
}

pub fn id_of(v: &Value) -> Uuid {
    v["id"].as_str().unwrap_or_else(|| panic!("нет id в {v}")).parse().unwrap()
}

pub fn uuid_of(v: &Value, key: &str) -> Uuid {
    str_field(v, key).parse().unwrap()
}

/// Проект напрямую в базе (создания проектов через API нет)
pub async fn make_project(pool: &PgPool, key: &str, name: &str, color: &str) -> Uuid {
    db::sqlx::query_scalar("insert into projects (key, name, color) values ($1, $2, $3) returning id")
        .bind(key)
        .bind(name)
        .bind(color)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Доска из проекта WEB и трёх колонок, созданных через API
pub struct Fx {
    pub c: Ctx,
    pub project: Uuid,
    pub todo: Uuid,
    pub doing: Uuid,
    pub done: Uuid,
}

impl Fx {
    pub async fn new(pool: PgPool) -> Fx {
        let c = Ctx::new(pool.clone()).await;
        let project = make_project(&pool, "WEB", "Web-приложение", "accent").await;
        let mut ids = Vec::new();
        for (title, is_done) in [("К выполнению", false), ("В работе", false), ("Готово", true)]
        {
            let r = c
                .post(&format!("/api/v1/projects/{project}/columns"), json!({ "title": title, "is_done": is_done }))
                .await;
            ids.push(id_of(&c.ok(r, StatusCode::CREATED).await));
        }
        Fx { c, project, todo: ids[0], doing: ids[1], done: ids[2] }
    }

    /// Создаёт задачу через API и возвращает её тело
    pub async fn task(&self, column: Option<Uuid>, title: &str) -> Value {
        let body = match column {
            Some(c) => json!({ "title": title, "column_id": c }),
            None => json!({ "title": title }),
        };
        let r = self.c.post(&format!("/api/v1/projects/{}/tasks", self.project), body).await;
        self.c.ok(r, StatusCode::CREATED).await
    }

    pub async fn board(&self) -> Value {
        let r = self.c.get(&format!("/api/v1/projects/{}/board", self.project)).await;
        self.c.ok(r, StatusCode::OK).await
    }

    /// Названия задач колонки (None: бэклог) в порядке доски
    pub async fn titles(&self, column: Option<Uuid>) -> Vec<String> {
        let want = column.map(|c| c.to_string());
        self.board().await["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|t| t["column_id"].as_str().map(str::to_owned) == want)
            .map(|t| str_field(t, "title").to_owned())
            .collect()
    }

    /// Лента активности из базы: (тип, цель, текст), старые первыми
    pub async fn activity(&self) -> Vec<(String, String, String)> {
        db::sqlx::query_as("select kind::text, target, text from activity order by created_at, text")
            .fetch_all(&self.c.pool)
            .await
            .unwrap()
    }
}

pub fn str_field<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or_else(|| panic!("нет строки «{key}» в {v}"))
}
