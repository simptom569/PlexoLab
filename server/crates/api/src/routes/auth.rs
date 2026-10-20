use axum::{Json, extract::State, http::StatusCode};
use db::{sqlx::PgConnection, users::User};
use domain::auth;
use serde::{Deserialize, Serialize};
use time::{Duration, OffsetDateTime};
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};

use super::users::UserDto;
use crate::{
    error::{ApiError, ApiResult, ErrorBody},
    extract::{ApiJson, AuthUser},
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(login))
        .routes(routes!(refresh))
        .routes(routes!(logout))
        .routes(routes!(change_password))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ChangePasswordRequest {
    /// Пароль, с которым человек входит сейчас
    pub current_password: String,
    /// Новый пароль: от 8 символов
    pub new_password: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct LoginRequest {
    #[schema(example = "lena@example.com")]
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TokenResponse {
    /// JWT для заголовка `Authorization: Bearer ...`, живёт 12 часов
    pub access_token: String,
    /// Одноразовый токен для получения новой пары, живёт 30 дней
    pub refresh_token: String,
    #[schema(example = "Bearer")]
    pub token_type: &'static str,
    /// Через сколько секунд истечёт токен доступа
    #[schema(example = 43200)]
    pub expires_in: u64,
    pub user: UserDto,
}

/// Argon2 считает десятки миллисекунд: выносим из потока, который обслуживает запросы
async fn blocking<T: Send + 'static>(job: impl FnOnce() -> T + Send + 'static) -> ApiResult<T> {
    tokio::task::spawn_blocking(job).await.map_err(|e| ApiError::Internal(e.into()))
}

/// Выдаёт пару токенов и сохраняет хэш refresh-токена. Вызывается внутри транзакции вызывающего.
async fn issue_tokens(state: &AppState, conn: &mut PgConnection, user: User) -> ApiResult<TokenResponse> {
    let access_token = auth::issue_access_token(&state.jwt_secret, user.id, auth::now_unix())?;
    let refresh_token = auth::generate_refresh_token()?;
    let expires_at = OffsetDateTime::now_utc() + Duration::days(auth::REFRESH_TTL_DAYS);
    db::tokens::insert(conn, user.id, &auth::hash_refresh_token(&refresh_token), expires_at).await?;
    Ok(TokenResponse {
        access_token,
        refresh_token,
        token_type: "Bearer",
        expires_in: auth::ACCESS_TTL_SECS,
        user: user.into(),
    })
}

/// Вход по e-mail и паролю
#[utoipa::path(
    post,
    path = "/auth/login",
    tag = "auth",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "Вход выполнен", body = TokenResponse),
        (status = 400, description = "Некорректный запрос", body = ErrorBody),
        (status = 401, description = "Неверный e-mail или пароль", body = ErrorBody),
    )
)]
async fn login(State(state): State<AppState>, ApiJson(req): ApiJson<LoginRequest>) -> ApiResult<Json<TokenResponse>> {
    let email = auth::normalize_email(&req.email);
    if email.is_empty() || req.password.is_empty() || req.password.len() > auth::MAX_PASSWORD_LEN {
        return Err(ApiError::BadRequest("Укажите e-mail и пароль".into()));
    }

    let user = db::users::find_by_email(&state.pool, &email).await?;
    let user = match user {
        Some(user) => {
            let (password, hash) = (req.password, user.password_hash.clone());
            if !blocking(move || auth::verify_password(&password, &hash)).await? {
                return Err(ApiError::InvalidCredentials);
            }
            user
        }
        None => {
            // тратим столько же времени, сколько на настоящую проверку: по скорости ответа
            // нельзя понять, есть ли такой e-mail
            let password = req.password;
            blocking(move || auth::verify_password_dummy(&password)).await?;
            return Err(ApiError::InvalidCredentials);
        }
    };

    let mut tx = state.pool.begin().await?;
    db::tokens::delete_expired_for_user(&mut tx, user.id).await?;
    let tokens = issue_tokens(&state, &mut tx, user).await?;
    tx.commit().await?;
    Ok(Json(tokens))
}

/// Обмен refresh-токена на новую пару. Старый refresh-токен перестаёт действовать.
#[utoipa::path(
    post,
    path = "/auth/refresh",
    tag = "auth",
    request_body = RefreshRequest,
    responses(
        (status = 200, description = "Новая пара токенов", body = TokenResponse),
        (status = 400, description = "Некорректный запрос", body = ErrorBody),
        (status = 401, description = "Токен неизвестен, уже использован или просрочен", body = ErrorBody),
    )
)]
async fn refresh(
    State(state): State<AppState>,
    ApiJson(req): ApiJson<RefreshRequest>,
) -> ApiResult<Json<TokenResponse>> {
    let hash = auth::hash_refresh_token(req.refresh_token.trim());
    let mut tx = state.pool.begin().await?;
    // удаление и проверка одним запросом: один токен нельзя использовать дважды
    let user_id = db::tokens::take(&mut tx, &hash).await?.ok_or(ApiError::InvalidRefreshToken)?;
    let user = db::users::find_by_id(&state.pool, user_id).await?.ok_or(ApiError::InvalidRefreshToken)?;
    let tokens = issue_tokens(&state, &mut tx, user).await?;
    tx.commit().await?;
    Ok(Json(tokens))
}

/// Выход: refresh-токен удаляется. Повторный выход и неизвестный токен тоже дают 204.
#[utoipa::path(
    post,
    path = "/auth/logout",
    tag = "auth",
    request_body = RefreshRequest,
    responses(
        (status = 204, description = "Сессия завершена"),
        (status = 400, description = "Некорректный запрос", body = ErrorBody),
    )
)]
async fn logout(State(state): State<AppState>, ApiJson(req): ApiJson<RefreshRequest>) -> ApiResult<StatusCode> {
    db::tokens::delete(&state.pool, &auth::hash_refresh_token(req.refresh_token.trim())).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Смена пароля. Все прежние сессии, и этого устройства тоже, завершаются, а в ответе приходит новая пара токенов:
/// человеку, который сменил пароль, заново входить не нужно. Токены доступа, выданные раньше, действуют до конца своего
/// срока (до 12 часов). Неверный текущий пароль это 400 `wrong_password`, а не 401: клиент принял бы 401 за потерянную
/// сессию.
#[utoipa::path(
    post,
    path = "/auth/password",
    tag = "auth",
    security(("bearer" = [])),
    request_body = ChangePasswordRequest,
    responses(
        (status = 200, description = "Пароль изменён, новая пара токенов для этого устройства", body = TokenResponse),
        (status = 400, description = "Новый пароль не подходит (короче 8 символов, слишком длинный, совпадает с текущим) или текущий указан неверно (code = wrong_password)", body = ErrorBody),
        (status = 401, description = "Нет действительного токена или пользователь удалён", body = ErrorBody),
    )
)]
async fn change_password(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiJson(req): ApiJson<ChangePasswordRequest>,
) -> ApiResult<Json<TokenResponse>> {
    if req.current_password.is_empty() || req.current_password.len() > auth::MAX_PASSWORD_LEN {
        return Err(ApiError::BadRequest("Укажите текущий пароль".into()));
    }
    auth::check_new_password(&req.new_password).map_err(ApiError::BadRequest)?;
    if req.new_password == req.current_password {
        return Err(ApiError::BadRequest("Новый пароль совпадает с текущим".into()));
    }

    let user = db::users::find_by_id(&state.pool, auth.id).await?.ok_or(ApiError::Unauthorized)?;
    let (current, hash) = (req.current_password, user.password_hash.clone());
    if !blocking(move || auth::verify_password(&current, &hash)).await? {
        return Err(ApiError::WrongPassword);
    }
    let new_password = req.new_password;
    let new_hash = blocking(move || auth::hash_password(&new_password)).await??;

    // замена пароля, завершение всех сессий и новая пара для этого устройства: всё или ничего
    let mut tx = state.pool.begin().await?;
    db::users::set_password(&mut tx, user.id, &new_hash).await?;
    db::tokens::delete_all_for_user(&mut *tx, user.id).await?;
    let tokens = issue_tokens(&state, &mut tx, user).await?;
    tx.commit().await?;
    Ok(Json(tokens))
}
