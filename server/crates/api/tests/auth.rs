//! Вход, обновление и завершение сессии на настоящем Postgres (временная база на каждый тест).

mod common;

use axum::http::{StatusCode, header::WWW_AUTHENTICATE};
use common::*;
use db::PgPool;
use domain::auth;
use serde_json::json;
use time::{Duration, OffsetDateTime};

const EMAIL: &str = "lena@example.com";
const PASSWORD: &str = "correct horse battery";

async fn setup(pool: PgPool) -> (axum::Router, db::users::User) {
    let user = make_user(&pool, EMAIL, "Лена М.", PASSWORD).await;
    (app(pool), user)
}

async fn count_tokens(pool: &PgPool, hash: &str) -> i64 {
    sqlx_count(pool, "select count(*) from refresh_tokens where token_hash = $1", hash).await
}

async fn sqlx_count(pool: &PgPool, sql: &'static str, bind: &str) -> i64 {
    db::sqlx::query_scalar(sql).bind(bind).fetch_one(pool).await.unwrap()
}

// ===== Вход =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn login_returns_tokens_and_user(pool: PgPool) {
    let (app, user) = setup(pool.clone()).await;
    let body = login_ok(&app, EMAIL, PASSWORD).await;

    assert_eq!(body["token_type"], "Bearer");
    assert_eq!(body["expires_in"], 12 * 60 * 60);

    let claims = auth::verify_access_token(SECRET.as_bytes(), str_field(&body, "access_token")).unwrap();
    assert_eq!(claims.sub, user.id);
    assert_eq!(claims.exp - claims.iat, 12 * 60 * 60, "токен доступа живёт 12 часов");

    assert_eq!(str_field(&body, "refresh_token").len(), 64);
    assert_eq!(body["user"]["email"], EMAIL);
    assert_eq!(body["user"]["name"], "Лена М.");
    assert_eq!(body["user"]["role"], "Frontend");
    assert_eq!(body["user"]["tone"], 2);
    assert_eq!(body["user"]["is_admin"], false);
    assert!(body["user"].get("password_hash").is_none(), "хэш пароля не отдаётся");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn refresh_token_is_stored_only_as_hash_and_lives_30_days(pool: PgPool) {
    let (app, user) = setup(pool.clone()).await;
    let body = login_ok(&app, EMAIL, PASSWORD).await;
    let refresh = str_field(&body, "refresh_token");

    assert_eq!(count_tokens(&pool, refresh).await, 0, "сам токен в базе не лежит");
    assert_eq!(count_tokens(&pool, &auth::hash_refresh_token(refresh)).await, 1);

    let expires: OffsetDateTime = db::sqlx::query_scalar("select expires_at from refresh_tokens where user_id = $1")
        .bind(user.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let left = expires - OffsetDateTime::now_utc();
    assert!(left > Duration::days(29) && left <= Duration::days(30), "осталось {left}");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn login_ignores_email_case_and_spaces(pool: PgPool) {
    let (app, _) = setup(pool).await;
    login_ok(&app, "  LENA@Example.COM ", PASSWORD).await;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn wrong_password_and_unknown_email_look_the_same(pool: PgPool) {
    let (app, _) = setup(pool).await;
    let wrong = login(&app, EMAIL, "not the password").await;
    let unknown = login(&app, "nobody@example.com", PASSWORD).await;

    for r in [&wrong, &unknown] {
        assert_eq!(r.status, StatusCode::UNAUTHORIZED);
        assert_eq!(r.body["code"], "invalid_credentials");
        assert_eq!(r.headers[WWW_AUTHENTICATE], "Bearer");
    }
    assert_eq!(wrong.body, unknown.body, "по ответу нельзя понять, есть ли такой e-mail");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn login_rejects_malformed_requests_with_unified_error(pool: PgPool) {
    let (app, _) = setup(pool).await;
    let long = "x".repeat(auth::MAX_PASSWORD_LEN + 1);
    for body in [
        json!({ "email": "", "password": PASSWORD }),
        json!({ "email": EMAIL, "password": "" }),
        json!({ "email": EMAIL, "password": long }),
        json!({ "email": EMAIL }),
        json!({ "nope": 1 }),
        json!("строка вместо объекта"),
    ] {
        let r = post(&app, "/api/v1/auth/login", body.clone()).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(r.body["code"], "bad_request", "{body}");
        assert!(!str_field(&r.body, "message").is_empty());
    }
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn login_removes_expired_tokens_of_the_user(pool: PgPool) {
    let (app, user) = setup(pool.clone()).await;
    let mut conn = pool.acquire().await.unwrap();
    db::tokens::insert(&mut conn, user.id, "stale-hash", OffsetDateTime::now_utc() - Duration::days(1)).await.unwrap();
    drop(conn);

    login_ok(&app, EMAIL, PASSWORD).await;
    assert_eq!(count_tokens(&pool, "stale-hash").await, 0);
}

// ===== Защита ручек =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn protected_routes_answer_401_without_valid_token(pool: PgPool) {
    let (app, user) = setup(pool).await;
    let expired =
        auth::issue_access_token(SECRET.as_bytes(), user.id, auth::now_unix() - auth::ACCESS_TTL_SECS - 3600).unwrap();
    let foreign = auth::issue_access_token(b"another-secret-another-secret-123456", user.id, auth::now_unix()).unwrap();

    for uri in ["/api/v1/me", "/api/v1/users"] {
        for token in [None, Some("garbage"), Some(expired.as_str()), Some(foreign.as_str())] {
            let r = get(&app, uri, token).await;
            assert_eq!(r.status, StatusCode::UNAUTHORIZED, "{uri} с токеном {token:?}");
            assert_eq!(r.body["code"], "unauthorized");
            assert_eq!(r.headers[WWW_AUTHENTICATE], "Bearer");
        }
    }
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn me_returns_the_current_user(pool: PgPool) {
    let (app, user) = setup(pool).await;
    let tokens = login_ok(&app, EMAIL, PASSWORD).await;
    let r = get(&app, "/api/v1/me", Some(str_field(&tokens, "access_token"))).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body["id"], user.id.to_string());
    assert_eq!(r.body["name"], "Лена М.");
    assert!(r.body.get("password_hash").is_none());
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn me_for_a_deleted_user_is_401(pool: PgPool) {
    let (app, user) = setup(pool.clone()).await;
    let tokens = login_ok(&app, EMAIL, PASSWORD).await;
    db::sqlx::query("delete from users where id = $1").bind(user.id).execute(&pool).await.unwrap();
    let r = get(&app, "/api/v1/me", Some(str_field(&tokens, "access_token"))).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn users_lists_the_team_in_the_order_they_were_added_without_secrets(pool: PgPool) {
    let (app, lena) = setup(pool.clone()).await; // Лена добавлена первой
    let artem = make_user(&pool, "artem@example.com", "Артём К.", "pass-pass-pass").await;
    let daniil = make_user(&pool, "daniil@example.com", "Даниил С.", "pass-pass-pass").await;
    // видны только люди из общих команд: все трое в одной
    let team = make_team(&pool, "Команда", &[(lena.id, "admin"), (artem.id, "member"), (daniil.id, "member")]).await;
    let _ = team;
    let tokens = login_ok(&app, EMAIL, PASSWORD).await;

    let r = get(&app, "/api/v1/users", Some(str_field(&tokens, "access_token"))).await;
    assert_eq!(r.status, StatusCode::OK);
    let names: Vec<&str> = r.body.as_array().unwrap().iter().map(|u| str_field(u, "name")).collect();
    assert_eq!(names, ["Лена М.", "Артём К.", "Даниил С."], "порядок добавления, не алфавит");
    let mut keys: Vec<&String> = r.body[0].as_object().unwrap().keys().collect();
    keys.sort();
    assert_eq!(keys, ["email", "id", "is_admin", "name", "role", "tone"]);
}

// ===== Обновление токена =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn refresh_rotates_the_pair_and_old_token_stops_working(pool: PgPool) {
    let (app, user) = setup(pool).await;
    let first = login_ok(&app, EMAIL, PASSWORD).await;
    let old_refresh = str_field(&first, "refresh_token").to_owned();

    let r = post(&app, "/api/v1/auth/refresh", json!({ "refresh_token": old_refresh })).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    let second = r.body;
    assert_ne!(second["refresh_token"], first["refresh_token"], "токен заменяется");
    assert_eq!(second["user"]["id"], user.id.to_string());
    let claims = auth::verify_access_token(SECRET.as_bytes(), str_field(&second, "access_token")).unwrap();
    assert_eq!(claims.sub, user.id);

    let reuse = post(&app, "/api/v1/auth/refresh", json!({ "refresh_token": old_refresh })).await;
    assert_eq!(reuse.status, StatusCode::UNAUTHORIZED, "использованный токен повторно не принимается");
    assert_eq!(reuse.body["code"], "invalid_refresh_token");

    let r = post(&app, "/api/v1/auth/refresh", json!({ "refresh_token": str_field(&second, "refresh_token") })).await;
    assert_eq!(r.status, StatusCode::OK, "новый токен работает");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn refresh_with_unknown_or_empty_token_is_401(pool: PgPool) {
    let (app, _) = setup(pool).await;
    for token in ["", "unknown", &"0".repeat(64)] {
        let r = post(&app, "/api/v1/auth/refresh", json!({ "refresh_token": token })).await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED, "токен «{token}»");
        assert_eq!(r.body["code"], "invalid_refresh_token");
    }
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn refresh_with_expired_token_is_401(pool: PgPool) {
    let (app, user) = setup(pool.clone()).await;
    let token = auth::generate_refresh_token().unwrap();
    let mut conn = pool.acquire().await.unwrap();
    db::tokens::insert(
        &mut conn,
        user.id,
        &auth::hash_refresh_token(&token),
        OffsetDateTime::now_utc() - Duration::minutes(1),
    )
    .await
    .unwrap();
    drop(conn);

    let r = post(&app, "/api/v1/auth/refresh", json!({ "refresh_token": token })).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    assert_eq!(r.body["code"], "invalid_refresh_token");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn one_refresh_token_cannot_be_used_twice_at_the_same_time(pool: PgPool) {
    let (app, _) = setup(pool).await;
    let tokens = login_ok(&app, EMAIL, PASSWORD).await;
    let body = json!({ "refresh_token": str_field(&tokens, "refresh_token") });

    let (a, b) = tokio::join!(
        post(&app, "/api/v1/auth/refresh", body.clone()),
        post(&app, "/api/v1/auth/refresh", body.clone())
    );
    let mut statuses = [a.status.as_u16(), b.status.as_u16()];
    statuses.sort();
    assert_eq!(statuses, [200, 401], "из двух одновременных обменов проходит ровно один");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn refresh_for_a_deleted_user_is_401(pool: PgPool) {
    let (app, user) = setup(pool.clone()).await;
    let tokens = login_ok(&app, EMAIL, PASSWORD).await;
    db::sqlx::query("delete from users where id = $1").bind(user.id).execute(&pool).await.unwrap();
    let r = post(&app, "/api/v1/auth/refresh", json!({ "refresh_token": str_field(&tokens, "refresh_token") })).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn logout_of_one_session_keeps_another_one_alive(pool: PgPool) {
    let (app, _) = setup(pool).await;
    let a = login_ok(&app, EMAIL, PASSWORD).await;
    let b = login_ok(&app, EMAIL, PASSWORD).await;
    // выход из одной сессии не трогает другую
    let r = post(&app, "/api/v1/auth/logout", json!({ "refresh_token": str_field(&a, "refresh_token") })).await;
    assert_eq!(r.status, StatusCode::NO_CONTENT);
    let r = post(&app, "/api/v1/auth/refresh", json!({ "refresh_token": str_field(&b, "refresh_token") })).await;
    assert_eq!(r.status, StatusCode::OK);
}

// ===== Смена пароля =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn password_change_closes_old_sessions_and_the_old_password(pool: PgPool) {
    let (app, _) = setup(pool.clone()).await;
    let tokens = login_ok(&app, EMAIL, PASSWORD).await;

    let new_hash = auth::hash_password("another-long-password").unwrap();
    db::users::change_password(&pool, EMAIL, &new_hash).await.unwrap();

    let old = login(&app, EMAIL, PASSWORD).await;
    assert_eq!(old.status, StatusCode::UNAUTHORIZED, "старый пароль больше не подходит");
    login_ok(&app, EMAIL, "another-long-password").await;

    let r = post(&app, "/api/v1/auth/refresh", json!({ "refresh_token": str_field(&tokens, "refresh_token") })).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED, "сессия, открытая со старым паролем, завершена");

    // токен доступа, выданный раньше, действует до конца своего срока (12 часов): так устроен JWT
    let me = get(&app, "/api/v1/me", Some(str_field(&tokens, "access_token"))).await;
    assert_eq!(me.status, StatusCode::OK);
}

// ===== Выход =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn logout_invalidates_the_refresh_token_and_is_idempotent(pool: PgPool) {
    let (app, _) = setup(pool).await;
    let tokens = login_ok(&app, EMAIL, PASSWORD).await;
    let body = json!({ "refresh_token": str_field(&tokens, "refresh_token") });

    let r = post(&app, "/api/v1/auth/logout", body.clone()).await;
    assert_eq!(r.status, StatusCode::NO_CONTENT);
    assert!(r.body.is_null());

    let r = post(&app, "/api/v1/auth/refresh", body.clone()).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED, "после выхода обновиться нельзя");

    let r = post(&app, "/api/v1/auth/logout", body).await;
    assert_eq!(r.status, StatusCode::NO_CONTENT, "повторный выход не ошибка");
    let r = post(&app, "/api/v1/auth/logout", json!({ "refresh_token": "unknown" })).await;
    assert_eq!(r.status, StatusCode::NO_CONTENT, "неизвестный токен тоже");
}
