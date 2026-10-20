//! Профиль и смена пароля на настоящем Postgres (временная база на каждый тест).

mod common;

use axum::http::{Method, StatusCode};
use common::*;
use db::PgPool;
use domain::auth;
use serde_json::{Value, json};

const ME: &str = "/api/v1/me";
const USERS: &str = "/api/v1/users";
const PASSWORD: &str = "/api/v1/auth/password";
const REFRESH: &str = "/api/v1/auth/refresh";
const EMAIL: &str = "tester@example.com";
const OLD: &str = "test-password";
const NEW: &str = "another-long-password";

async fn patch_me(c: &Ctx, body: Value) -> Reply {
    c.patch(ME, body).await
}

async fn stored(c: &Ctx) -> db::users::User {
    db::users::find_by_id(&c.pool, c.user.id).await.unwrap().unwrap()
}

/// Ещё один вход тем же человеком: «другое устройство»
async fn another_device(c: &Ctx) -> Value {
    login_ok(&c.app, EMAIL, OLD).await
}

async fn refresh_status(c: &Ctx, tokens: &Value) -> StatusCode {
    post(&c.app, REFRESH, json!({ "refresh_token": str_field(tokens, "refresh_token") })).await.status
}

async fn change_password(c: &Ctx, bearer: &str, current: &str, new: &str) -> Reply {
    send(
        &c.app,
        Method::POST,
        PASSWORD,
        Some(json!({ "current_password": current, "new_password": new })),
        Some(bearer),
    )
    .await
}

// ===== Профиль =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn patch_me_changes_name_role_and_tone_and_returns_the_user(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let r = patch_me(&c, json!({ "name": "  Новое Имя ", "role": "Backend", "tone": 4 })).await;
    let body = c.ok(r, StatusCode::OK).await;

    assert_eq!(body["name"], "Новое Имя", "пробелы по краям убраны");
    assert_eq!(body["role"], "Backend");
    assert_eq!(body["tone"], 4);
    assert_eq!(body["email"], EMAIL);
    assert_eq!(body["is_admin"], false);
    assert!(body.get("password_hash").is_none(), "хэш пароля не отдаётся");

    let me = c.ok(c.get(ME).await, StatusCode::OK).await;
    assert_eq!(me["name"], "Новое Имя", "изменение видно в /me");
    let team = c.ok(c.get(USERS).await, StatusCode::OK).await;
    assert!(team.as_array().unwrap().iter().any(|u| u["name"] == "Новое Имя" && u["tone"] == 4), "и в списке участников");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn patch_me_changes_only_the_given_fields(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let body = c.ok(patch_me(&c, json!({ "tone": 0 })).await, StatusCode::OK).await;
    assert_eq!((body["name"].as_str(), body["role"].as_str(), body["tone"].as_i64()), (Some("Тестер Т."), Some("Frontend"), Some(0)));

    let body = c.ok(patch_me(&c, json!({ "role": "" })).await, StatusCode::OK).await;
    assert_eq!(body["role"], "", "подпись можно очистить");
    assert_eq!(body["name"], "Тестер Т.");

    let body = c.ok(patch_me(&c, json!({})).await, StatusCode::OK).await;
    assert_eq!((body["name"].as_str(), body["tone"].as_i64()), (Some("Тестер Т."), Some(0)), "пустое тело ничего не меняет");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn patch_me_rejects_bad_values_and_changes_nothing(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let too_long_name = "я".repeat(domain::users::MAX_NAME_LEN + 1);
    let too_long_role = "я".repeat(domain::users::MAX_ROLE_LEN + 1);
    for body in [
        json!({ "name": "" }),
        json!({ "name": "   " }),
        json!({ "name": too_long_name }),
        json!({ "role": too_long_role }),
        json!({ "tone": 5 }),
        json!({ "tone": -1 }),
        json!({ "tone": "red" }),
        json!({ "name": 5 }),
        json!({ "name": "Годное", "tone": 9 }),
    ] {
        let r = patch_me(&c, body.clone()).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{body}: {}", r.body);
        assert_eq!(r.body["code"], "bad_request", "{body}");
    }
    let user = stored(&c).await;
    assert_eq!((user.name.as_str(), user.role.as_str(), user.tone), ("Тестер Т.", "Frontend", 2), "после отказов профиль прежний");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn patch_me_cannot_change_email_rights_or_password(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let before = stored(&c).await;
    for body in [
        json!({ "email": "other@example.com" }),
        json!({ "is_admin": true }),
        json!({ "password_hash": "x" }),
        json!({ "id": uuid::Uuid::new_v4() }),
        json!({ "name": "Годное", "is_admin": true }),
    ] {
        let r = patch_me(&c, body.clone()).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{body} не должно приниматься: {}", r.body);
    }
    let after = stored(&c).await;
    assert_eq!((after.email.as_str(), after.is_admin), (before.email.as_str(), false));
    assert_eq!(after.password_hash, before.password_hash);
    assert_eq!(after.name, before.name, "даже годное поле рядом с чужим не применяется");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn patch_me_changes_only_the_caller(pool: PgPool) {
    let c = Ctx::new(pool.clone()).await;
    let bob = make_user(&pool, "bob@example.com", "Боб Б.", "bob-password").await;
    c.ok(patch_me(&c, json!({ "name": "Новое Имя", "tone": 1 })).await, StatusCode::OK).await;
    let bob_now = db::users::find_by_id(&pool, bob.id).await.unwrap().unwrap();
    assert_eq!((bob_now.name.as_str(), bob_now.tone), ("Боб Б.", 2));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn patch_me_needs_a_token(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let r = send(&c.app, Method::PATCH, ME, Some(json!({ "name": "Чужое" })), None).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    assert_eq!(stored(&c).await.name, "Тестер Т.");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn patch_me_sends_one_user_changed_event_and_only_on_success(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let mut rx = c.events.subscribe();

    patch_me(&c, json!({ "name": "Новое Имя" })).await;
    assert_eq!(drain(&mut rx), [("user.changed", None, None)], "клиенты перечитают список участников");

    patch_me(&c, json!({ "name": "" })).await;
    assert!(drain(&mut rx).is_empty(), "отказ событий не даёт");
}

// ===== Смена пароля =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn change_password_ends_other_sessions_and_hands_this_device_a_new_pair(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let this_device = another_device(&c).await;
    let other_device = another_device(&c).await;

    let r = change_password(&c, str_field(&this_device, "access_token"), OLD, NEW).await;
    let fresh = c.ok(r, StatusCode::OK).await;

    // новая пара работает, этому устройству входить заново не нужно
    assert_eq!(fresh["token_type"], "Bearer");
    assert_eq!(fresh["user"]["email"], EMAIL);
    assert!(fresh["user"].get("password_hash").is_none());
    assert_eq!(get(&c.app, ME, Some(str_field(&fresh, "access_token"))).await.status, StatusCode::OK);
    assert_eq!(refresh_status(&c, &fresh).await, StatusCode::OK, "новый refresh-токен действует");

    // старые сессии, и эта, и чужая, завершены
    assert_eq!(refresh_status(&c, &this_device).await, StatusCode::UNAUTHORIZED);
    assert_eq!(refresh_status(&c, &other_device).await, StatusCode::UNAUTHORIZED, "другое устройство вышло");

    // пароль заменён
    assert_eq!(login(&c.app, EMAIL, OLD).await.status, StatusCode::UNAUTHORIZED, "старый пароль больше не подходит");
    login_ok(&c.app, EMAIL, NEW).await;
    let hash = stored(&c).await.password_hash;
    assert!(hash.starts_with("$argon2id$"), "в базе argon2id, а не сам пароль: {hash}");
    assert!(auth::verify_password(NEW, &hash));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn change_password_with_a_wrong_current_password_is_a_400_not_a_401(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let device = another_device(&c).await;
    let other = another_device(&c).await;

    let r = change_password(&c, str_field(&device, "access_token"), "not-my-password", NEW).await;
    // 401 клиент принял бы за потерянную сессию и выкинул бы человека на экран входа
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "{}", r.body);
    assert_eq!(r.body["code"], "wrong_password");
    assert_eq!(r.body["message"], "Текущий пароль указан неверно");

    login_ok(&c.app, EMAIL, OLD).await; // пароль прежний
    assert_eq!(refresh_status(&c, &other).await, StatusCode::OK, "сессии целы");
    assert_eq!(refresh_status(&c, &device).await, StatusCode::OK);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn change_password_rejects_a_bad_new_password_and_changes_nothing(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let device = another_device(&c).await;
    let token = str_field(&device, "access_token").to_owned();

    let too_short = "short1";
    let too_long = "x".repeat(auth::MAX_PASSWORD_LEN + 1);
    for (current, new, why) in [
        (OLD, too_short, "короче 8 символов"),
        (OLD, "", "пустой"),
        (OLD, too_long.as_str(), "слишком длинный"),
        (OLD, OLD, "совпадает с текущим"),
        ("", NEW, "текущий не указан"),
    ] {
        let r = change_password(&c, &token, current, new).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{why}: {}", r.body);
        assert_eq!(r.body["code"], "bad_request", "{why}");
    }
    let r = change_password(&c, &token, &too_long, NEW).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "слишком длинный текущий пароль argon2 не кормим");

    login_ok(&c.app, EMAIL, OLD).await;
    assert_eq!(refresh_status(&c, &device).await, StatusCode::OK, "после отказов сессии целы");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn change_password_does_not_touch_other_people(pool: PgPool) {
    let c = Ctx::new(pool.clone()).await;
    make_user(&pool, "bob@example.com", "Боб Б.", "bob-password").await;
    let bob = login_ok(&c.app, "bob@example.com", "bob-password").await;
    let device = another_device(&c).await;

    c.ok(change_password(&c, str_field(&device, "access_token"), OLD, NEW).await, StatusCode::OK).await;

    assert_eq!(refresh_status(&c, &bob).await, StatusCode::OK, "сессия Боба цела");
    login_ok(&c.app, "bob@example.com", "bob-password").await;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn change_password_needs_a_token(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let body = Some(json!({ "current_password": OLD, "new_password": NEW }));
    assert_eq!(send(&c.app, Method::POST, PASSWORD, body.clone(), None).await.status, StatusCode::UNAUTHORIZED);
    assert_eq!(send(&c.app, Method::POST, PASSWORD, body, Some("garbage")).await.status, StatusCode::UNAUTHORIZED);
    login_ok(&c.app, EMAIL, OLD).await;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn change_password_rejects_malformed_requests(pool: PgPool) {
    let c = Ctx::new(pool).await;
    for body in [json!({}), json!({ "new_password": NEW }), json!({ "current_password": OLD }), json!({ "current_password": 1, "new_password": 2 })] {
        let r = send(&c.app, Method::POST, PASSWORD, Some(body.clone()), Some(&c.token)).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{body}");
    }
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn password_change_sends_no_events(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let device = another_device(&c).await;
    let mut rx = c.events.subscribe();
    c.ok(change_password(&c, str_field(&device, "access_token"), OLD, NEW).await, StatusCode::OK).await;
    assert!(drain(&mut rx).is_empty(), "пароль других людей не касается, рассылать нечего");
}
