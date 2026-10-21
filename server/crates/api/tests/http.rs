//! Общие свойства HTTP-слоя: живость, OpenAPI, формат ошибок, CORS. База не нужна.

mod common;

use api::cors;
use axum::{
    body::Body,
    http::{Method, Request, StatusCode, header},
};
use common::*;
use serde_json::{Value, json};
use tower::ServiceExt;

fn with_cors(app: axum::Router) -> axum::Router {
    app.layer(cors::layer(&["http://tauri.localhost".to_owned(), "http://localhost:1420".to_owned()]))
}

#[tokio::test]
async fn healthz_answers_ok_without_token() {
    let r = get(&app_without_db(), "/healthz", None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body, Value::String("ok".into()));
}

#[tokio::test]
async fn openapi_json_is_hidden_unless_enabled() {
    let r = get(&app_without_db(), "/api/v1/openapi.json", None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND, "в боевом режиме схема не отдаётся");
    assert_eq!(r.body["code"], "not_found");
}

#[tokio::test]
async fn the_served_schema_equals_the_offline_document() {
    let served = get(&app_with_openapi(), "/api/v1/openapi.json", None).await;
    assert_eq!(served.status, StatusCode::OK);
    assert_eq!(served.body, api::openapi_document(), "команда `server openapi` выдаёт ту же схему");
}

#[tokio::test]
async fn openapi_json_describes_the_api() {
    let r = get(&app_with_openapi(), "/api/v1/openapi.json", None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert!(str_field(&r.body, "openapi").starts_with("3."));
    assert_eq!(r.body["info"]["title"], "PlexoLab API");
    for path in [
        "/api/v1/auth/login",
        "/api/v1/auth/refresh",
        "/api/v1/auth/logout",
        "/api/v1/me",
        "/api/v1/users",
        "/api/v1/projects",
        "/api/v1/projects/{id}/board",
        "/api/v1/projects/{id}/columns",
        "/api/v1/columns/{id}",
        "/api/v1/projects/{id}/tasks",
        "/api/v1/tasks/{id}",
        "/api/v1/tasks/{id}/subtasks",
        "/api/v1/subtasks/{id}",
        "/api/v1/tasks/{id}/comments",
        "/api/v1/projects/{id}/tags",
        "/api/v1/tags/{id}",
        "/api/v1/projects/{id}/members",
        "/api/v1/projects/{id}/invites",
        "/api/v1/invites",
        "/api/v1/invites/{id}/accept",
    ] {
        assert!(r.body["paths"].get(path).is_some(), "в схеме нет {path}");
    }
    let task = &r.body["paths"]["/api/v1/tasks/{id}"];
    for method in ["get", "patch", "delete"] {
        assert!(task.get(method).is_some(), "у /tasks/{{id}} нет {method}");
    }
    for schema in ["BoardDto", "TaskCardDto", "TaskDetailDto", "UpdateTask", "ColumnDto", "TagDto"] {
        assert!(r.body["components"]["schemas"].get(schema).is_some(), "в схеме нет {schema}");
    }
    let update = &r.body["components"]["schemas"]["UpdateTask"]["properties"];
    for field in ["column_id", "before_id", "tag_ids", "due_date"] {
        assert!(update.get(field).is_some(), "в UpdateTask нет {field}");
    }
    assert_eq!(r.body["components"]["securitySchemes"]["bearer"]["scheme"], "bearer");
    assert!(r.body["components"]["schemas"].get("ErrorBody").is_some());
    assert!(r.body["components"]["schemas"].get("TokenResponse").is_some());
    assert!(r.body["paths"]["/api/v1/me"]["get"]["security"].is_array(), "у /me указана защита");
    assert!(r.body["paths"]["/api/v1/auth/login"]["post"].get("security").is_none(), "вход открыт");
}

#[tokio::test]
async fn unknown_route_is_json_404() {
    let r = get(&app_without_db(), "/api/v1/nope", None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.body["code"], "not_found");
    assert!(!str_field(&r.body, "message").is_empty());
}

#[tokio::test]
async fn broken_json_uses_the_unified_error_format() {
    let req = Request::post("/api/v1/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{ not json"))
        .unwrap();
    let r = reply(app_without_db().oneshot(req).await.unwrap()).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(r.body["code"], "bad_request");

    let req = Request::post("/api/v1/auth/login").body(Body::from("{}")).unwrap();
    let r = reply(app_without_db().oneshot(req).await.unwrap()).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "без Content-Type: application/json");
    assert_eq!(r.body["code"], "bad_request");
}

#[tokio::test]
async fn protected_route_without_token_is_401_even_without_db() {
    let r = get(&app_without_db(), "/api/v1/me", None).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    assert_eq!(r.body, json!({ "code": "unauthorized", "message": "Требуется вход" }));
}

#[tokio::test]
async fn cors_preflight_from_the_tauri_window_is_allowed() {
    let req = Request::builder()
        .method(Method::OPTIONS)
        .uri("/api/v1/auth/login")
        .header(header::ORIGIN, "http://tauri.localhost")
        .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
        .header(header::ACCESS_CONTROL_REQUEST_HEADERS, "content-type,authorization,x-client-id")
        .body(Body::empty())
        .unwrap();
    let r = reply(with_cors(app_without_db()).oneshot(req).await.unwrap()).await;
    assert!(r.status.is_success(), "{}", r.status);
    assert_eq!(r.headers[header::ACCESS_CONTROL_ALLOW_ORIGIN], "http://tauri.localhost");
    let allowed = r.headers[header::ACCESS_CONTROL_ALLOW_HEADERS].to_str().unwrap().to_lowercase();
    for h in ["authorization", "content-type", "x-client-id"] {
        assert!(allowed.contains(h), "{h} не разрешён: {allowed}");
    }
    let methods = r.headers[header::ACCESS_CONTROL_ALLOW_METHODS].to_str().unwrap();
    for m in ["POST", "PATCH", "DELETE", "PUT"] {
        assert!(methods.contains(m), "{m} не разрешён: {methods}");
    }
}

#[tokio::test]
async fn cors_headers_are_present_on_real_and_error_responses() {
    let req = Request::get("/api/v1/me").header(header::ORIGIN, "http://localhost:1420").body(Body::empty()).unwrap();
    let r = reply(with_cors(app_without_db()).oneshot(req).await.unwrap()).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        r.headers[header::ACCESS_CONTROL_ALLOW_ORIGIN],
        "http://localhost:1420",
        "иначе клиент не прочитает и 401"
    );
}

#[tokio::test]
async fn cors_is_denied_for_foreign_origins() {
    let req = Request::get("/healthz").header(header::ORIGIN, "https://evil.example").body(Body::empty()).unwrap();
    let r = reply(with_cors(app_without_db()).oneshot(req).await.unwrap()).await;
    assert!(r.headers.get(header::ACCESS_CONTROL_ALLOW_ORIGIN).is_none());
}
