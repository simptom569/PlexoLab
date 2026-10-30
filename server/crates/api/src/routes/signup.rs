//! Регистрация и сброс пароля по коду из письма (docs/REGISTRATION.md). Все адреса открыты: у человека ещё нет входа.
//! Оба сценария в два шага: сервер присылает на адрес код из шести цифр, человек возвращает его вместе с остальным.
//! Хэш пароля считается только после верного кода: перебор кодов не должен нагружать сервер.

use axum::{Json, extract::State, http::StatusCode};
use db::{
    email_codes::{self, Check, Issue},
    users::{CreateUserError, NewUser},
};
use domain::{
    auth,
    codes::{self, CODE_TTL_MINUTES, Purpose, RESEND_COOLDOWN_SECS},
    users,
};
use serde::{Deserialize, Serialize};
use time::Duration;
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};

use super::auth::{TokenResponse, blocking, issue_tokens};
use crate::{
    error::{ApiError, ApiResult, ErrorBody},
    extract::ApiJson,
    mail::{Template, render},
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(options))
        .routes(routes!(register_code))
        .routes(routes!(register))
        .routes(routes!(reset_code))
        .routes(routes!(reset_password))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AuthOptions {
    /// Можно ли зарегистрироваться самому (на сервере настроена почта)
    pub registration: bool,
    /// Работает ли «Забыли пароль?» (на сервере настроена почта)
    pub password_reset: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CodeRequest {
    #[schema(example = "lena@example.com")]
    pub email: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RegisterRequest {
    pub email: String,
    /// Шесть цифр из письма (пробелы и дефисы между ними допускаются)
    #[schema(example = "123456")]
    pub code: String,
    /// Как человека будут видеть в команде: от 1 до 60 символов
    #[schema(example = "Лена М.")]
    pub name: String,
    /// От 8 символов
    pub password: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ResetPasswordRequest {
    pub email: String,
    #[schema(example = "123456")]
    pub code: String,
    /// От 8 символов
    pub new_password: String,
}

fn require_mail(state: &AppState) -> ApiResult<()> {
    if state.mailer.is_enabled() { Ok(()) } else { Err(ApiError::MailDisabled) }
}

/// Адрес в нижнем регистре; без «@» и точки в домене отказ. Текст ошибки не говорит, есть ли такой аккаунт.
fn checked_email(raw: &str) -> ApiResult<String> {
    let email = auth::normalize_email(raw);
    if auth::is_plausible_email(&email) {
        Ok(email)
    } else {
        Err(ApiError::BadRequest("Некорректный e-mail".into()))
    }
}

fn checked_code(raw: &str) -> ApiResult<String> {
    codes::clean_code(raw).ok_or_else(|| ApiError::BadRequest("Код состоит из шести цифр".into()))
}

/// Что ответить человеку по итогам проверки кода, если она не `Match`
fn code_error(check: Check) -> ApiError {
    match check {
        Check::Wrong { left } => ApiError::WrongCode { left },
        _ => ApiError::CodeExpired,
    }
}

fn too_many(issue: Issue) -> ApiError {
    match issue {
        Issue::TooSoon => ApiError::TooManyRequests("Письмо уже отправлено. Новое можно запросить через минуту".into()),
        _ => ApiError::TooManyRequests("Сервер отправил слишком много писем за последний час. Попробуйте позже".into()),
    }
}

async fn issue_code(state: &AppState, purpose: Purpose, email: &str) -> ApiResult<(Issue, String)> {
    let code = codes::generate_code()?;
    let issue = email_codes::issue(
        &state.pool,
        purpose,
        email,
        &codes::hash_code(purpose, email, &code),
        Duration::minutes(CODE_TTL_MINUTES),
        Duration::seconds(RESEND_COOLDOWN_SECS),
        state.mail_per_hour,
    )
    .await?;
    Ok((issue, code))
}

/// Что умеет этот сервер до входа
#[utoipa::path(
    get,
    path = "/auth/options",
    tag = "auth",
    responses((status = 200, description = "Возможности сервера", body = AuthOptions))
)]
async fn options(State(state): State<AppState>) -> Json<AuthOptions> {
    let mail = state.mailer.is_enabled();
    Json(AuthOptions { registration: mail, password_reset: mail })
}

/// Регистрация, шаг 1: прислать код на e-mail. Если аккаунт с таким адресом уже есть, это 409: человеку надо войти
/// или сбросить пароль.
#[utoipa::path(
    post,
    path = "/auth/register/code",
    tag = "auth",
    request_body = CodeRequest,
    responses(
        (status = 204, description = "Письмо с кодом отправлено"),
        (status = 400, description = "Некорректный e-mail", body = ErrorBody),
        (status = 409, description = "Аккаунт с таким e-mail уже есть", body = ErrorBody),
        (status = 429, description = "Письмо на этот адрес уже уходило меньше минуты назад или сервер исчерпал часовой лимит писем", body = ErrorBody),
        (status = 502, description = "Сервис почты письмо не принял (code = mail_failed)", body = ErrorBody),
        (status = 503, description = "Почта на сервере не настроена (code = mail_disabled)", body = ErrorBody),
    )
)]
async fn register_code(State(state): State<AppState>, ApiJson(req): ApiJson<CodeRequest>) -> ApiResult<StatusCode> {
    require_mail(&state)?;
    let email = checked_email(&req.email)?;
    if db::users::find_by_email(&state.pool, &email).await?.is_some() {
        return Err(ApiError::Conflict("Аккаунт с таким e-mail уже есть. Войдите или сбросьте пароль".into()));
    }

    let (issue, code) = issue_code(&state, Purpose::Register, &email).await?;
    let Issue::Issued(id) = issue else { return Err(too_many(issue)) };
    // здесь отправку ждём: человек сразу узнает, что письмо не ушло (занятость адреса он и так видит выше)
    if let Err(e) = state.mailer.send(render(Template::Registration, &code, &email)).await {
        tracing::error!(error = %e, "письмо с кодом регистрации не отправлено");
        email_codes::remove(&state.pool, id).await?;
        return Err(ApiError::MailFailed);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Регистрация, шаг 2: код из письма, имя и пароль. Аккаунт создаётся здесь, человек сразу входит (как после `/auth/login`).
/// Неверный код: 400 `wrong_code` с числом оставшихся попыток; после пяти ошибок, через 15 минут и после использования
/// 400 `code_expired`.
#[utoipa::path(
    post,
    path = "/auth/register",
    tag = "auth",
    request_body = RegisterRequest,
    responses(
        (status = 201, description = "Аккаунт создан, человек вошёл", body = TokenResponse),
        (status = 400, description = "Некорректные поля, неверный (wrong_code) или устаревший (code_expired) код", body = ErrorBody),
        (status = 409, description = "Аккаунт с таким e-mail уже есть", body = ErrorBody),
        (status = 503, description = "Почта на сервере не настроена (code = mail_disabled)", body = ErrorBody),
    )
)]
async fn register(
    State(state): State<AppState>,
    ApiJson(req): ApiJson<RegisterRequest>,
) -> ApiResult<(StatusCode, Json<TokenResponse>)> {
    require_mail(&state)?;
    let email = checked_email(&req.email)?;
    let code = checked_code(&req.code)?;
    let name = users::clean_name(&req.name)
        .ok_or_else(|| ApiError::BadRequest(format!("Имя: от 1 до {} символов", users::MAX_NAME_LEN)))?;
    auth::check_new_password(&req.password).map_err(ApiError::BadRequest)?;

    let mut tx = state.pool.begin().await?;
    match email_codes::check(&mut tx, Purpose::Register, &email, &codes::hash_code(Purpose::Register, &email, &code))
        .await?
    {
        Check::Match => {}
        other => {
            tx.commit().await?; // ошибка засчитана в попытки: это надо сохранить
            return Err(code_error(other));
        }
    }

    let password = req.password;
    let password_hash = blocking(move || auth::hash_password(&password)).await??;
    let user = db::users::create_in(
        &mut tx,
        &NewUser {
            tone: users::tone_for(&email),
            email: email.clone(),
            name,
            role: String::new(),
            is_admin: false,
            password_hash,
        },
    )
    .await
    .map_err(|e| match e {
        CreateUserError::EmailTaken => {
            ApiError::Conflict("Аккаунт с таким e-mail уже есть. Войдите или сбросьте пароль".into())
        }
        CreateUserError::Db(e) => e.into(),
    })?;
    email_codes::consume(&mut tx, Purpose::Register, &email).await?;
    let tokens = issue_tokens(&state, &mut tx, user).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(tokens)))
}

/// Сброс пароля, шаг 1: прислать код. Ответ один и тот же, есть такой аккаунт или нет: по нему нельзя узнать, кто
/// зарегистрирован. Для адреса, который просили меньше минуты назад, письмо тоже не уходит, но человек ответа 204 не
/// отличит; клиент сам не даёт нажать «Отправить ещё раз» раньше времени.
#[utoipa::path(
    post,
    path = "/auth/password-reset/code",
    tag = "auth",
    request_body = CodeRequest,
    responses(
        (status = 204, description = "Если аккаунт с таким e-mail есть, ему отправлено письмо с кодом"),
        (status = 400, description = "Некорректный e-mail", body = ErrorBody),
        (status = 429, description = "Сервер исчерпал часовой лимит писем", body = ErrorBody),
        (status = 503, description = "Почта на сервере не настроена (code = mail_disabled)", body = ErrorBody),
    )
)]
async fn reset_code(State(state): State<AppState>, ApiJson(req): ApiJson<CodeRequest>) -> ApiResult<StatusCode> {
    require_mail(&state)?;
    let email = checked_email(&req.email)?;
    // лимит общий и от адреса не зависит, поэтому его можно показывать всем одинаково
    if email_codes::sent_last_hour(&state.pool).await? >= i64::from(state.mail_per_hour) {
        return Err(too_many(Issue::TooMany));
    }
    if db::users::find_by_email(&state.pool, &email).await?.is_none() {
        return Ok(StatusCode::NO_CONTENT);
    }

    let (issue, code) = issue_code(&state, Purpose::Reset, &email).await?;
    match issue {
        Issue::Issued(id) => {
            // отправка идёт позади ответа: так по времени ответа нельзя отличить настоящий адрес от выдуманного
            let state = state.clone();
            tokio::spawn(async move {
                if let Err(e) = state.mailer.send(render(Template::PasswordReset, &code, &email)).await {
                    tracing::error!(error = %e, "письмо с кодом сброса пароля не отправлено");
                    let _ = email_codes::remove(&state.pool, id).await;
                }
            });
        }
        // слишком рано (или тот же запрос пришёл дважды): письмо уже в пути
        Issue::TooSoon => {}
        Issue::TooMany => return Err(too_many(issue)),
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Сброс пароля, шаг 2: код из письма и новый пароль. Все прежние сессии завершаются, этому устройству сразу выдаётся
/// новая пара токенов: заново входить не нужно. Ошибки кода те же, что при регистрации.
#[utoipa::path(
    post,
    path = "/auth/password-reset",
    tag = "auth",
    request_body = ResetPasswordRequest,
    responses(
        (status = 200, description = "Пароль заменён, человек вошёл", body = TokenResponse),
        (status = 400, description = "Некорректные поля, неверный (wrong_code) или устаревший (code_expired) код", body = ErrorBody),
        (status = 503, description = "Почта на сервере не настроена (code = mail_disabled)", body = ErrorBody),
    )
)]
async fn reset_password(
    State(state): State<AppState>,
    ApiJson(req): ApiJson<ResetPasswordRequest>,
) -> ApiResult<Json<TokenResponse>> {
    require_mail(&state)?;
    let email = checked_email(&req.email)?;
    let code = checked_code(&req.code)?;
    auth::check_new_password(&req.new_password).map_err(ApiError::BadRequest)?;

    let mut tx = state.pool.begin().await?;
    match email_codes::check(&mut tx, Purpose::Reset, &email, &codes::hash_code(Purpose::Reset, &email, &code)).await? {
        Check::Match => {}
        other => {
            tx.commit().await?;
            return Err(code_error(other));
        }
    }
    // код был, а аккаунта уже нет (его удалили после письма): для человека это такой же «устаревший» код
    let Some(user) = db::users::find_by_email(&state.pool, &email).await? else {
        email_codes::consume(&mut tx, Purpose::Reset, &email).await?;
        tx.commit().await?;
        return Err(ApiError::CodeExpired);
    };

    let new_password = req.new_password;
    let password_hash = blocking(move || auth::hash_password(&new_password)).await??;
    db::users::set_password(&mut tx, user.id, &password_hash).await?;
    db::tokens::delete_all_for_user(&mut *tx, user.id).await?;
    email_codes::consume(&mut tx, Purpose::Reset, &email).await?;
    let tokens = issue_tokens(&state, &mut tx, user).await?;
    tx.commit().await?;
    Ok(Json(tokens))
}
