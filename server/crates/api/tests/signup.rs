//! Регистрация и сброс пароля по коду из письма на настоящем Postgres (docs/REGISTRATION.md): весь путь, лимиты, неверные и
//! просроченные коды, коды не подходят друг к другу, сброс не выдаёт, есть ли такой аккаунт.

mod common;

use std::time::Duration;

use api::{
    AppState,
    mail::{Mail, Mailer},
    router,
};
use axum::{Router, http::StatusCode};
use common::*;
use db::PgPool;
use serde_json::{Value, json};

const EMAIL: &str = "newbie@example.com";
const PASSWORD: &str = "new-password-123";

/// Приложение с почтой в памяти: письма видно через `Mailer::sent`
fn mail_app(pool: PgPool) -> (Router, Mailer) {
    let mailer = Mailer::memory();
    (router(AppState::new(pool, SECRET).with_mailer(mailer.clone())), mailer)
}

fn mail_app_with_limit(pool: PgPool, per_hour: u32) -> (Router, Mailer) {
    let mailer = Mailer::memory();
    (router(AppState::new(pool, SECRET).with_mailer(mailer.clone()).with_mail_limit(per_hour)), mailer)
}

/// Код из письма: первая группа из шести цифр в тексте (код стоит в тексте раньше адреса)
fn code_in(mail: &Mail) -> String {
    let digits: Vec<char> = mail.text.chars().collect();
    let mut run = String::new();
    for c in digits {
        if c.is_ascii_digit() {
            run.push(c);
        } else {
            if run.len() == 6 {
                return run;
            }
            run.clear();
        }
    }
    panic!("в письме нет кода: {}", mail.text)
}

/// Дожидается письма: сброс пароля отправляет его позади ответа
async fn wait_for_mails(mailer: &Mailer, count: usize) -> Vec<Mail> {
    for _ in 0..300 {
        let sent = mailer.sent();
        if sent.len() >= count {
            return sent;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("за три секунды пришло писем {}, а ждали {count}", mailer.sent().len());
}

/// Убеждается, что новых писем нет: письмо в пути успело бы дойти за это время
async fn no_more_mails_than(mailer: &Mailer, count: usize) {
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert_eq!(mailer.sent().len(), count, "лишнее письмо");
}

async fn register_code(app: &Router, email: &str) -> Reply {
    post(app, "/api/v1/auth/register/code", json!({ "email": email })).await
}

async fn register(app: &Router, email: &str, code: &str) -> Reply {
    post(
        app,
        "/api/v1/auth/register",
        json!({ "email": email, "code": code, "name": "Новичок Н.", "password": PASSWORD }),
    )
    .await
}

async fn reset_code(app: &Router, email: &str) -> Reply {
    post(app, "/api/v1/auth/password-reset/code", json!({ "email": email })).await
}

async fn reset(app: &Router, email: &str, code: &str, password: &str) -> Reply {
    post(app, "/api/v1/auth/password-reset", json!({ "email": email, "code": code, "new_password": password })).await
}

/// Пропускает минуту ожидания между письмами: как будто она прошла
async fn skip_cooldown(pool: &PgPool) {
    db::sqlx::query("update email_codes set created_at = created_at - interval '2 minutes'")
        .execute(pool)
        .await
        .unwrap();
}

async fn code_rows(pool: &PgPool) -> i64 {
    db::sqlx::query_scalar("select count(*) from email_codes").fetch_one(pool).await.unwrap()
}

fn message(r: &Reply) -> String {
    str_field(&r.body, "message").to_owned()
}

// ===== Возможности сервера =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn options_say_whether_mail_is_set_up(pool: PgPool) {
    let off = get(&app(pool.clone()), "/api/v1/auth/options", None).await;
    assert_eq!((off.status, off.body), (StatusCode::OK, json!({ "registration": false, "password_reset": false })));
    let (on_app, _) = mail_app(pool);
    let on = get(&on_app, "/api/v1/auth/options", None).await;
    assert_eq!((on.status, on.body), (StatusCode::OK, json!({ "registration": true, "password_reset": true })));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn without_mail_registration_and_reset_are_closed(pool: PgPool) {
    let app = app(pool.clone());
    for (path, body) in [
        ("/api/v1/auth/register/code", json!({ "email": EMAIL })),
        ("/api/v1/auth/register", json!({ "email": EMAIL, "code": "123456", "name": "Н", "password": PASSWORD })),
        ("/api/v1/auth/password-reset/code", json!({ "email": EMAIL })),
        ("/api/v1/auth/password-reset", json!({ "email": EMAIL, "code": "123456", "new_password": PASSWORD })),
    ] {
        let r = post(&app, path, body).await;
        assert_eq!(r.status, StatusCode::SERVICE_UNAVAILABLE, "{path}: {}", r.body);
        assert_eq!(r.body["code"], "mail_disabled", "{path}");
    }
    assert_eq!(code_rows(&pool).await, 0);
    assert_eq!(db::users::count(&pool).await.unwrap(), 0, "аккаунт не создан");
}

// ===== Регистрация =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn registration_from_the_first_letter_to_the_first_sign_in(pool: PgPool) {
    let (app, mailer) = mail_app(pool.clone());

    // шаг 1: письмо с кодом, адрес приведён к нижнему регистру
    let r = register_code(&app, " Newbie@Example.COM ").await;
    assert_eq!(r.status, StatusCode::NO_CONTENT, "{}", r.body);
    let mails = wait_for_mails(&mailer, 1).await;
    assert_eq!(mails.len(), 1);
    assert_eq!((mails[0].to.as_str(), mails[0].subject.as_str()), (EMAIL, "PlexoLab: код подтверждения"));
    let code = code_in(&mails[0]);
    assert!(mails[0].html.contains(&code), "код и в HTML-версии");
    assert_eq!(db::users::count(&pool).await.unwrap(), 0, "до кода аккаунта нет");

    // шаг 2: аккаунт создан и человек уже вошёл
    let r = register(&app, "NEWBIE@example.com", &format!(" {} {} ", &code[..3], &code[3..])).await;
    assert_eq!(r.status, StatusCode::CREATED, "{}", r.body);
    assert_eq!(r.body["token_type"], "Bearer");
    assert_eq!(r.body["expires_in"], 12 * 60 * 60);
    assert_eq!(str_field(&r.body, "refresh_token").len(), 64);
    let user = &r.body["user"];
    assert_eq!(
        (user["email"].clone(), user["name"].clone(), user["role"].clone()),
        (json!(EMAIL), json!("Новичок Н."), json!(""))
    );
    assert_eq!(user["is_admin"], false, "самостоятельная регистрация администратором не делает");
    assert!((0..5).contains(&user["tone"].as_i64().unwrap()));
    assert!(user.get("password_hash").is_none());
    let claims = domain::auth::verify_access_token(SECRET.as_bytes(), str_field(&r.body, "access_token")).unwrap();
    assert_eq!(claims.sub, id_of(user), "токен выдан этому аккаунту");

    // обычный вход работает с выбранным паролем, сессия из регистрации обновляется
    let tokens = login_ok(&app, EMAIL, PASSWORD).await;
    assert_eq!(tokens["user"]["name"], "Новичок Н.");
    let refreshed =
        post(&app, "/api/v1/auth/refresh", json!({ "refresh_token": str_field(&r.body, "refresh_token") })).await;
    assert_eq!(refreshed.status, StatusCode::OK, "{}", refreshed.body);

    // у аккаунта с рождения есть «Личное», как у созданных командой `server user add`
    let team: i64 = db::sqlx::query_scalar("select count(*) from teams where personal_for = $1")
        .bind(id_of(user))
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(team, 1);
    assert_eq!(code_rows(&pool).await, 0, "использованный код стёрт");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_used_code_cannot_register_again(pool: PgPool) {
    let (app, mailer) = mail_app(pool);
    register_code(&app, EMAIL).await;
    let code = code_in(&wait_for_mails(&mailer, 1).await[0]);
    assert_eq!(register(&app, EMAIL, &code).await.status, StatusCode::CREATED);
    let again = register(&app, EMAIL, &code).await;
    assert_eq!((again.status, again.body["code"].clone()), (StatusCode::BAD_REQUEST, json!("code_expired")));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn an_address_that_already_has_an_account_is_told_so_and_gets_no_mail(pool: PgPool) {
    make_user(&pool, EMAIL, "Занято", "some-password").await;
    let (app, mailer) = mail_app(pool.clone());
    let r = register_code(&app, "NEWBIE@example.com").await;
    assert_eq!(r.status, StatusCode::CONFLICT, "{}", r.body);
    assert_eq!(message(&r), "Аккаунт с таким e-mail уже есть. Войдите или сбросьте пароль");
    no_more_mails_than(&mailer, 0).await;
    assert_eq!(code_rows(&pool).await, 0);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn an_account_created_after_the_letter_still_wins(pool: PgPool) {
    let (app, mailer) = mail_app(pool.clone());
    register_code(&app, EMAIL).await;
    let code = code_in(&wait_for_mails(&mailer, 1).await[0]);
    make_user(&pool, EMAIL, "Опередил", "some-password").await;

    let r = register(&app, EMAIL, &code).await;
    assert_eq!(r.status, StatusCode::CONFLICT, "{}", r.body);
    assert_eq!(db::users::count(&pool).await.unwrap(), 1);
    let owner = login_ok(&app, EMAIL, "some-password").await;
    assert_eq!(owner["user"]["name"], "Опередил", "чужой аккаунт не тронут");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn bad_addresses_are_refused_without_a_letter(pool: PgPool) {
    let (app, mailer) = mail_app(pool.clone());
    for bad in ["", "   ", "nobody", "a@b", "@example.com", "a b@example.com"] {
        let r = register_code(&app, bad).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "«{bad}»");
        assert_eq!(message(&r), "Некорректный e-mail");
    }
    no_more_mails_than(&mailer, 0).await;
    assert_eq!(code_rows(&pool).await, 0);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn one_letter_per_minute_per_address(pool: PgPool) {
    let (app, mailer) = mail_app(pool.clone());
    assert_eq!(register_code(&app, EMAIL).await.status, StatusCode::NO_CONTENT);
    let again = register_code(&app, "NEWBIE@example.com").await;
    assert_eq!((again.status, again.body["code"].clone()), (StatusCode::TOO_MANY_REQUESTS, json!("too_many_requests")));
    assert_eq!(message(&again), "Письмо уже отправлено. Новое можно запросить через минуту");
    assert_eq!(mailer.sent().len(), 1);

    assert_eq!(register_code(&app, "other@example.com").await.status, StatusCode::NO_CONTENT, "другому адресу можно");
    skip_cooldown(&pool).await;
    assert_eq!(register_code(&app, EMAIL).await.status, StatusCode::NO_CONTENT, "через минуту можно");
    assert_eq!(mailer.sent().len(), 3);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn the_server_sends_only_so_many_letters_an_hour(pool: PgPool) {
    let (app, mailer) = mail_app_with_limit(pool.clone(), 2);
    assert_eq!(register_code(&app, "a@example.com").await.status, StatusCode::NO_CONTENT);
    assert_eq!(register_code(&app, "b@example.com").await.status, StatusCode::NO_CONTENT);
    let third = register_code(&app, "c@example.com").await;
    assert_eq!(third.status, StatusCode::TOO_MANY_REQUESTS, "{}", third.body);
    assert_eq!(message(&third), "Сервер отправил слишком много писем за последний час. Попробуйте позже");
    assert_eq!(mailer.sent().len(), 2);
    assert_eq!(code_rows(&pool).await, 2, "отказ ничего не записал");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn if_the_letter_cannot_be_sent_the_person_is_told_and_may_try_again_at_once(pool: PgPool) {
    // «Resend» по адресу, где никто не слушает
    let dead = Mailer::resend_at("http://127.0.0.1:1/emails", "re_test", "PlexoLab <noreply@example.com>").unwrap();
    let broken = router(AppState::new(pool.clone(), SECRET).with_mailer(dead));
    let r = register_code(&broken, EMAIL).await;
    assert_eq!(r.status, StatusCode::BAD_GATEWAY, "{}", r.body);
    assert_eq!(r.body["code"], "mail_failed");
    assert_eq!(message(&r), "Не удалось отправить письмо. Попробуйте позже");
    assert_eq!(code_rows(&pool).await, 0, "код, которого человек не получил, не хранится");

    // ждать минуту после неудачи не нужно
    let (working, mailer) = mail_app(pool);
    assert_eq!(register_code(&working, EMAIL).await.status, StatusCode::NO_CONTENT);
    assert_eq!(mailer.sent().len(), 1);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn wrong_codes_count_down_and_five_burn_the_code(pool: PgPool) {
    let (app, mailer) = mail_app(pool.clone());
    register_code(&app, EMAIL).await;
    let code = code_in(&wait_for_mails(&mailer, 1).await[0]);
    let wrong = if code == "000000" { "000001" } else { "000000" };

    for left in (0..5).rev() {
        let r = register(&app, EMAIL, wrong).await;
        assert_eq!((r.status, r.body["code"].clone()), (StatusCode::BAD_REQUEST, json!("wrong_code")), "{}", r.body);
        let expected = if left > 0 {
            format!("Неверный код. Осталось попыток: {left}")
        } else {
            "Неверный код. Попытки закончились, запросите новый".to_owned()
        };
        assert_eq!(message(&r), expected);
    }
    // пятая ошибка сожгла код: верный уже не подходит
    let r = register(&app, EMAIL, &code).await;
    assert_eq!((r.status, r.body["code"].clone()), (StatusCode::BAD_REQUEST, json!("code_expired")));
    assert_eq!(message(&r), "Код не подходит или устарел. Запросите новый");
    assert_eq!(db::users::count(&pool).await.unwrap(), 0, "аккаунта нет");

    // новый код можно попросить через минуту
    skip_cooldown(&pool).await;
    assert_eq!(register_code(&app, EMAIL).await.status, StatusCode::NO_CONTENT);
    let fresh = code_in(&wait_for_mails(&mailer, 2).await[1]);
    assert_eq!(register(&app, EMAIL, &fresh).await.status, StatusCode::CREATED);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_mistyped_code_or_field_does_not_spend_an_attempt(pool: PgPool) {
    let (app, mailer) = mail_app(pool.clone());
    register_code(&app, EMAIL).await;
    let code = code_in(&wait_for_mails(&mailer, 1).await[0]);

    // и «не шесть цифр», и слабый пароль, и пустое имя отсекаются до проверки кода
    for body in [
        json!({ "email": EMAIL, "code": "12", "name": "Н", "password": PASSWORD }),
        json!({ "email": EMAIL, "code": "abcdef", "name": "Н", "password": PASSWORD }),
        json!({ "email": EMAIL, "code": code, "name": "Н", "password": "short" }),
        json!({ "email": EMAIL, "code": code, "name": "   ", "password": PASSWORD }),
        json!({ "email": EMAIL, "code": code, "name": "я".repeat(61), "password": PASSWORD }),
        json!({ "email": "nobody", "code": code, "name": "Н", "password": PASSWORD }),
    ] {
        let r = post(&app, "/api/v1/auth/register", body.clone()).await;
        assert_eq!(
            (r.status, r.body["code"].clone()),
            (StatusCode::BAD_REQUEST, json!("bad_request")),
            "{body}: {}",
            r.body
        );
    }
    let attempts: i16 = db::sqlx::query_scalar("select attempts from email_codes").fetch_one(&pool).await.unwrap();
    assert_eq!(attempts, 0);
    assert_eq!(register(&app, EMAIL, &code).await.status, StatusCode::CREATED, "код после всех отказов цел");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn an_expired_code_is_refused(pool: PgPool) {
    let (app, mailer) = mail_app(pool.clone());
    register_code(&app, EMAIL).await;
    let code = code_in(&wait_for_mails(&mailer, 1).await[0]);
    db::sqlx::query("update email_codes set expires_at = now() - interval '1 second'").execute(&pool).await.unwrap();
    let r = register(&app, EMAIL, &code).await;
    assert_eq!((r.status, r.body["code"].clone()), (StatusCode::BAD_REQUEST, json!("code_expired")));
    assert_eq!(db::users::count(&pool).await.unwrap(), 0);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn the_newest_code_replaces_the_older_one(pool: PgPool) {
    let (app, mailer) = mail_app(pool.clone());
    register_code(&app, EMAIL).await;
    skip_cooldown(&pool).await;
    register_code(&app, EMAIL).await;
    let mails = wait_for_mails(&mailer, 2).await;
    let (old, new) = (code_in(&mails[0]), code_in(&mails[1]));
    if old != new {
        let r = register(&app, EMAIL, &old).await;
        assert_eq!(
            (r.status, r.body["code"].clone()),
            (StatusCode::BAD_REQUEST, json!("wrong_code")),
            "прежний код не подходит"
        );
    }
    assert_eq!(register(&app, EMAIL, &new).await.status, StatusCode::CREATED);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_code_for_one_address_does_not_open_another(pool: PgPool) {
    let (app, mailer) = mail_app(pool.clone());
    register_code(&app, EMAIL).await;
    let code = code_in(&wait_for_mails(&mailer, 1).await[0]);
    let r = register(&app, "stranger@example.com", &code).await;
    assert_eq!(
        (r.status, r.body["code"].clone()),
        (StatusCode::BAD_REQUEST, json!("code_expired")),
        "у чужого адреса кода нет"
    );
    assert_eq!(db::users::count(&pool).await.unwrap(), 0);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn two_simultaneous_registrations_with_one_code_make_one_account(pool: PgPool) {
    let (app, mailer) = mail_app(pool.clone());
    register_code(&app, EMAIL).await;
    let code = code_in(&wait_for_mails(&mailer, 1).await[0]);

    let (a, b) = tokio::join!(register(&app, EMAIL, &code), register(&app, EMAIL, &code));
    let created = [&a, &b].iter().filter(|r| r.status == StatusCode::CREATED).count();
    assert_eq!(created, 1, "{} / {}", a.body, b.body);
    assert_eq!(db::users::count(&pool).await.unwrap(), 1);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn invitations_that_waited_for_the_address_are_waiting_in_the_new_account(pool: PgPool) {
    // руководитель зовёт человека, у которого ещё нет аккаунта
    let lead = Ctx::new(pool.clone()).await;
    let team = lead.ok(lead.post("/api/v1/teams", json!({ "name": "Веб" })).await, StatusCode::CREATED).await;
    let invite = lead.post(&format!("/api/v1/teams/{}/invites", id_of(&team)), json!({ "email": EMAIL })).await;
    assert_eq!(invite.status, StatusCode::CREATED, "{}", invite.body);

    // человек регистрируется сам и находит приглашение у себя
    let (app, mailer) = mail_app(pool);
    register_code(&app, EMAIL).await;
    let code = code_in(&wait_for_mails(&mailer, 1).await[0]);
    let registered = register(&app, EMAIL, &code).await;
    assert_eq!(registered.status, StatusCode::CREATED, "{}", registered.body);

    let mine = get(&app, "/api/v1/team-invites", Some(str_field(&registered.body, "access_token"))).await;
    assert_eq!(mine.status, StatusCode::OK, "{}", mine.body);
    assert_eq!(mine.body.as_array().unwrap().len(), 1, "{}", mine.body);
    assert_eq!(mine.body[0]["team_name"], "Веб");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_new_account_sees_nothing_that_belongs_to_others(pool: PgPool) {
    // самое важное при открытой регистрации: чужие команды и проекты не видны
    let lead = Ctx::new(pool.clone()).await;
    let project = make_project(&pool, "WEB", "Веб", "accent").await;
    let page = lead.post(&lead.wiki_url(), json!({ "title": "Секретная страница" })).await;
    assert_eq!(page.status, StatusCode::CREATED, "{}", page.body);

    let (app, mailer) = mail_app(pool);
    register_code(&app, EMAIL).await;
    let code = code_in(&wait_for_mails(&mailer, 1).await[0]);
    let token = str_field(&register(&app, EMAIL, &code).await.body, "access_token").to_owned();

    assert_eq!(
        get(&app, &format!("/api/v1/projects/{project}/board"), Some(&token)).await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(get(&app, &lead.wiki_url(), Some(&token)).await.status, StatusCode::NOT_FOUND, "вики чужой команды");
    let users = get(&app, "/api/v1/users", Some(&token)).await;
    assert_eq!(users.body.as_array().unwrap().len(), 1, "новичок видит только себя: {}", users.body);
    let projects = get(&app, "/api/v1/projects", Some(&token)).await;
    assert_eq!(projects.body, json!([]));
}

// ===== Сброс пароля =====

async fn account(pool: &PgPool) {
    make_user(pool, EMAIL, "Лена М.", "old-password-1").await;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn password_reset_from_the_first_letter_to_the_new_sign_in(pool: PgPool) {
    account(&pool).await;
    let (app, mailer) = mail_app(pool.clone());
    let old_session = login_ok(&app, EMAIL, "old-password-1").await;

    let r = reset_code(&app, " NEWBIE@example.com ").await;
    assert_eq!((r.status, r.body), (StatusCode::NO_CONTENT, Value::Null));
    let mails = wait_for_mails(&mailer, 1).await;
    assert_eq!((mails[0].to.as_str(), mails[0].subject.as_str()), (EMAIL, "PlexoLab: код для сброса пароля"));
    let code = code_in(&mails[0]);

    let r = reset(&app, EMAIL, &code, "brand-new-password").await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    assert_eq!(r.body["user"]["email"], EMAIL);
    assert_eq!(r.body["user"]["name"], "Лена М.", "это тот же аккаунт");

    // старый пароль и старые сессии больше не действуют, новый пароль и выданная пара работают
    assert_eq!(login(&app, EMAIL, "old-password-1").await.status, StatusCode::UNAUTHORIZED);
    login_ok(&app, EMAIL, "brand-new-password").await;
    let old_refresh =
        post(&app, "/api/v1/auth/refresh", json!({ "refresh_token": str_field(&old_session, "refresh_token") })).await;
    assert_eq!(old_refresh.status, StatusCode::UNAUTHORIZED, "прежние сессии завершены");
    let new_refresh =
        post(&app, "/api/v1/auth/refresh", json!({ "refresh_token": str_field(&r.body, "refresh_token") })).await;
    assert_eq!(new_refresh.status, StatusCode::OK, "{}", new_refresh.body);
    assert_eq!(code_rows(&pool).await, 0, "использованный код стёрт");

    // тот же код второй раз ничего не меняет
    let again = reset(&app, EMAIL, &code, "yet-another-password").await;
    assert_eq!((again.status, again.body["code"].clone()), (StatusCode::BAD_REQUEST, json!("code_expired")));
    login_ok(&app, EMAIL, "brand-new-password").await;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn reset_does_not_reveal_whether_an_account_exists(pool: PgPool) {
    account(&pool).await;
    let (app, mailer) = mail_app(pool.clone());

    let known = reset_code(&app, EMAIL).await;
    let unknown = reset_code(&app, "nobody@example.com").await;
    assert_eq!((known.status, known.body.clone()), (unknown.status, unknown.body.clone()), "ответы одинаковые");
    assert_eq!(known.status, StatusCode::NO_CONTENT);

    wait_for_mails(&mailer, 1).await;
    no_more_mails_than(&mailer, 1).await;
    assert_eq!(mailer.sent()[0].to, EMAIL, "письмо ушло только настоящему адресу");
    assert_eq!(code_rows(&pool).await, 1);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_second_reset_request_within_a_minute_looks_the_same_but_sends_nothing(pool: PgPool) {
    account(&pool).await;
    let (app, mailer) = mail_app(pool);
    let first = reset_code(&app, EMAIL).await;
    let second = reset_code(&app, EMAIL).await;
    assert_eq!((first.status, second.status), (StatusCode::NO_CONTENT, StatusCode::NO_CONTENT));
    wait_for_mails(&mailer, 1).await;
    no_more_mails_than(&mailer, 1).await;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn when_the_hourly_limit_is_spent_everyone_is_refused_alike(pool: PgPool) {
    account(&pool).await;
    let (app, mailer) = mail_app_with_limit(pool, 1);
    assert_eq!(register_code(&app, "first@example.com").await.status, StatusCode::NO_CONTENT);

    for email in [EMAIL, "nobody@example.com"] {
        let r = reset_code(&app, email).await;
        assert_eq!(
            (r.status, r.body["code"].clone()),
            (StatusCode::TOO_MANY_REQUESTS, json!("too_many_requests")),
            "{email}"
        );
    }
    assert_eq!(mailer.sent().len(), 1);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn reset_code_cannot_be_guessed_and_a_weak_password_does_not_burn_it(pool: PgPool) {
    account(&pool).await;
    let (app, mailer) = mail_app(pool.clone());
    reset_code(&app, EMAIL).await;
    let code = code_in(&wait_for_mails(&mailer, 1).await[0]);
    let wrong = if code == "000000" { "000001" } else { "000000" };

    let r = reset(&app, EMAIL, wrong, "brand-new-password").await;
    assert_eq!((r.status, r.body["code"].clone()), (StatusCode::BAD_REQUEST, json!("wrong_code")));
    assert_eq!(message(&r), "Неверный код. Осталось попыток: 4");

    let weak = reset(&app, EMAIL, &code, "short").await;
    assert_eq!((weak.status, weak.body["code"].clone()), (StatusCode::BAD_REQUEST, json!("bad_request")));
    assert_eq!(message(&weak), "Пароль короче 8 символов");
    login_ok(&app, EMAIL, "old-password-1").await; // пароль ещё прежний

    for _ in 0..4 {
        reset(&app, EMAIL, wrong, "brand-new-password").await;
    }
    let burnt = reset(&app, EMAIL, &code, "brand-new-password").await;
    assert_eq!(
        (burnt.status, burnt.body["code"].clone()),
        (StatusCode::BAD_REQUEST, json!("code_expired")),
        "пять ошибок сожгли код"
    );
    login_ok(&app, EMAIL, "old-password-1").await;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_registration_code_cannot_reset_a_password_and_the_other_way_round(pool: PgPool) {
    let (app, mailer) = mail_app(pool.clone());
    // код регистрации адреса, у которого аккаунта ещё нет, не сбрасывает ничей пароль
    register_code(&app, EMAIL).await;
    let code = code_in(&wait_for_mails(&mailer, 1).await[0]);
    let r = reset(&app, EMAIL, &code, "brand-new-password").await;
    assert_eq!((r.status, r.body["code"].clone()), (StatusCode::BAD_REQUEST, json!("code_expired")));

    // и код сброса не регистрирует: у существующего аккаунта это тоже «код не подходит», а не «аккаунт есть»
    make_user(&pool, "lena@example.com", "Лена М.", "old-password-1").await;
    reset_code(&app, "lena@example.com").await;
    let reset_mail = wait_for_mails(&mailer, 2).await.remove(1);
    let r = register(&app, "lena@example.com", &code_in(&reset_mail)).await;
    assert_eq!((r.status, r.body["code"].clone()), (StatusCode::BAD_REQUEST, json!("code_expired")));
    login_ok(&app, "lena@example.com", "old-password-1").await;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_code_for_a_deleted_account_is_just_expired(pool: PgPool) {
    account(&pool).await;
    let (app, mailer) = mail_app(pool.clone());
    reset_code(&app, EMAIL).await;
    let code = code_in(&wait_for_mails(&mailer, 1).await[0]);
    db::sqlx::query("delete from users where email = $1").bind(EMAIL).execute(&pool).await.unwrap();

    let r = reset(&app, EMAIL, &code, "brand-new-password").await;
    assert_eq!((r.status, r.body["code"].clone()), (StatusCode::BAD_REQUEST, json!("code_expired")));
    assert_eq!(code_rows(&pool).await, 0);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_reset_letter_that_fails_to_send_frees_the_address_without_telling_the_client(pool: PgPool) {
    account(&pool).await;
    let dead = Mailer::resend_at("http://127.0.0.1:1/emails", "re_test", "noreply@example.com").unwrap();
    let broken = router(AppState::new(pool.clone(), SECRET).with_mailer(dead));

    let r = reset_code(&broken, EMAIL).await;
    assert_eq!(r.status, StatusCode::NO_CONTENT, "ответ не зависит от того, дошло ли письмо");
    for _ in 0..300 {
        if code_rows(&pool).await == 0 {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("код неотправленного письма остался в базе");
}
