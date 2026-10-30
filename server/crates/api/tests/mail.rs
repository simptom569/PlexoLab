//! Отправка писем без базы: как выглядит запрос к Resend (подставлен свой «Resend» на локальном порту), что бывает при
//! отказе и обрыве, запись в папку для разработки.

mod common;

use std::sync::{Arc, Mutex};

use api::mail::{Mail, MailError, Mailer, Template, render};
use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::post,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use common::TestDir;
use serde_json::{Value, json};

struct Seen {
    path: String,
    headers: HeaderMap,
    body: Value,
}

/// «Resend» на свободном локальном порту: запоминает запросы и отвечает заданным статусом
async fn fake_resend(status: StatusCode) -> (String, Arc<Mutex<Vec<Seen>>>) {
    type Shared = (StatusCode, Arc<Mutex<Vec<Seen>>>);
    async fn handle(
        State((status, seen)): State<Shared>,
        headers: HeaderMap,
        Json(body): Json<Value>,
    ) -> (StatusCode, Json<Value>) {
        seen.lock().unwrap().push(Seen { path: "/emails".into(), headers, body });
        match status.is_success() {
            true => (status, Json(json!({ "id": "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" }))),
            false => (
                status,
                Json(
                    json!({ "name": "validation_error", "message": "You can only send testing emails to your own email address" }),
                ),
            ),
        }
    }
    let seen = Arc::new(Mutex::new(Vec::new()));
    let app = Router::new().route("/emails", post(handle)).with_state((status, seen.clone()));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{addr}/emails"), seen)
}

fn lena_mail() -> Mail {
    render(Template::Registration, "123456", "lena@example.com")
}

#[tokio::test]
async fn the_request_to_resend_has_everything_resend_wants() {
    let (endpoint, seen) = fake_resend(StatusCode::OK).await;
    let mailer = Mailer::resend_at(&endpoint, "re_secret_key", "PlexoLab <noreply@example.com>").unwrap();
    assert!(mailer.is_enabled());

    mailer.send(lena_mail()).await.unwrap();

    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    let (path, headers, body) = (&seen[0].path, &seen[0].headers, &seen[0].body);
    assert_eq!(path, "/emails");
    assert_eq!(headers["authorization"], "Bearer re_secret_key");
    assert_eq!(headers["content-type"], "application/json");
    assert!(
        headers["user-agent"].to_str().unwrap().starts_with("plexolab-server/"),
        "Resend отвечает 403 без User-Agent"
    );

    assert_eq!(body["from"], "PlexoLab <noreply@example.com>");
    assert_eq!(body["to"], json!(["lena@example.com"]));
    assert_eq!(body["subject"], "PlexoLab: код подтверждения");
    assert!(body["html"].as_str().unwrap().contains("123456"));
    assert!(body["text"].as_str().unwrap().contains("Код подтверждения: 123456"));

    // иконка приложена и ссылка на неё в HTML совпадает с content_id
    let logo = &body["attachments"][0];
    assert_eq!(
        (logo["filename"].clone(), logo["content_type"].clone(), logo["content_id"].clone()),
        (json!("logo.png"), json!("image/png"), json!("logo"))
    );
    let png = STANDARD.decode(logo["content"].as_str().unwrap()).unwrap();
    assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    assert!(body["html"].as_str().unwrap().contains(r#"src="cid:logo""#));
    assert_eq!(body["attachments"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn a_refusal_from_resend_is_an_error_with_its_status() {
    for status in [
        StatusCode::FORBIDDEN,
        StatusCode::UNPROCESSABLE_ENTITY,
        StatusCode::TOO_MANY_REQUESTS,
        StatusCode::INTERNAL_SERVER_ERROR,
    ] {
        let (endpoint, seen) = fake_resend(status).await;
        let mailer = Mailer::resend_at(&endpoint, "re_secret_key", "noreply@example.com").unwrap();
        let err = mailer.send(lena_mail()).await.unwrap_err();
        assert!(matches!(err, MailError::Rejected(code) if code == status.as_u16()), "{status}: {err}");
        assert_eq!(seen.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn an_unreachable_resend_is_an_error_that_does_not_leak_the_key() {
    let mailer = Mailer::resend_at("http://127.0.0.1:1/emails", "re_secret_key", "noreply@example.com").unwrap();
    let err = mailer.send(lena_mail()).await.unwrap_err();
    assert!(matches!(err, MailError::Network(_)), "{err}");
    assert!(!err.to_string().contains("re_secret_key"), "{err}");
}

#[tokio::test]
async fn the_outbox_gets_one_json_file_per_letter_in_order() {
    let dir = TestDir::new();
    let mailer = Mailer::outbox(&dir.0.join("outbox"));
    assert!(mailer.is_enabled());

    mailer.send(render(Template::Registration, "111111", "a@example.com")).await.unwrap();
    mailer.send(render(Template::PasswordReset, "222222", "b@example.com")).await.unwrap();

    let mut names: Vec<_> = std::fs::read_dir(dir.0.join("outbox"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    assert_eq!(names.len(), 2);
    let first: Value = serde_json::from_slice(&std::fs::read(dir.0.join("outbox").join(&names[0])).unwrap()).unwrap();
    let last: Value = serde_json::from_slice(&std::fs::read(dir.0.join("outbox").join(&names[1])).unwrap()).unwrap();
    assert_eq!(
        (first["to"].clone(), last["to"].clone()),
        (json!("a@example.com"), json!("b@example.com")),
        "последнее письмо — последний файл"
    );
    assert!(first["text"].as_str().unwrap().contains("111111"));
    assert!(last["html"].as_str().unwrap().contains("222222"));
    assert_eq!(last["subject"], "PlexoLab: код для сброса пароля");
}

#[tokio::test]
async fn a_disabled_mailer_says_so() {
    let mailer = Mailer::off();
    assert!(!mailer.is_enabled());
}
