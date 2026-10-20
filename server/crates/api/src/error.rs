//! Единый формат ошибок: `{ "code": "...", "message": "..." }`.

use axum::{
    Json,
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Serialize;
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorBody {
    /// Машинный код ошибки: bad_request, unauthorized, invalid_credentials, wrong_password, ...
    #[schema(example = "invalid_credentials")]
    pub code: String,
    /// Текст для пользователя
    #[schema(example = "Неверный e-mail или пароль")]
    pub message: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("{0}")]
    BadRequest(String),
    #[error("Требуется вход")]
    Unauthorized,
    #[error("Неверный e-mail или пароль")]
    InvalidCredentials,
    #[error("Сессия недействительна или просрочена, войдите заново")]
    InvalidRefreshToken,
    /// Неверный текущий пароль при смене пароля. Это 400, а не 401: клиент принял бы 401 за потерянную сессию.
    #[error("Текущий пароль указан неверно")]
    WrongPassword,
    #[error("Недостаточно прав")]
    Forbidden,
    #[error("Не найдено")]
    NotFound,
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    TooLarge(String),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

pub type ApiResult<T> = Result<T, ApiError>;

impl ApiError {
    fn status(&self) -> StatusCode {
        match self {
            ApiError::BadRequest(_) | ApiError::WrongPassword => StatusCode::BAD_REQUEST,
            ApiError::Unauthorized | ApiError::InvalidCredentials | ApiError::InvalidRefreshToken => {
                StatusCode::UNAUTHORIZED
            }
            ApiError::Forbidden => StatusCode::FORBIDDEN,
            ApiError::NotFound => StatusCode::NOT_FOUND,
            ApiError::Conflict(_) => StatusCode::CONFLICT,
            ApiError::TooLarge(_) => StatusCode::PAYLOAD_TOO_LARGE,
            ApiError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn code(&self) -> &'static str {
        match self {
            ApiError::BadRequest(_) => "bad_request",
            ApiError::Unauthorized => "unauthorized",
            ApiError::InvalidCredentials => "invalid_credentials",
            ApiError::InvalidRefreshToken => "invalid_refresh_token",
            ApiError::WrongPassword => "wrong_password",
            ApiError::Forbidden => "forbidden",
            ApiError::NotFound => "not_found",
            ApiError::Conflict(_) => "conflict",
            ApiError::TooLarge(_) => "payload_too_large",
            ApiError::Internal(_) => "internal",
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = self.status();
        // Подробности внутренних ошибок только в лог, клиенту общий текст
        let message = match &self {
            ApiError::Internal(e) => {
                tracing::error!(error = ?e, "внутренняя ошибка сервера");
                "Внутренняя ошибка сервера".to_owned()
            }
            other => other.to_string(),
        };
        let body = ErrorBody { code: self.code().to_owned(), message };
        let mut response = (status, Json(body)).into_response();
        if status == StatusCode::UNAUTHORIZED {
            response.headers_mut().insert(header::WWW_AUTHENTICATE, HeaderValue::from_static("Bearer"));
        }
        response
    }
}

impl From<db::sqlx::Error> for ApiError {
    fn from(e: db::sqlx::Error) -> Self {
        match &e {
            // клиент сослался на несуществующую запись (исполнитель, метка и т. п.)
            db::sqlx::Error::Database(d) if d.is_foreign_key_violation() => {
                ApiError::BadRequest("Указана несуществующая связанная запись".into())
            }
            db::sqlx::Error::Database(d) if d.is_unique_violation() => {
                ApiError::Conflict("Такая запись уже есть".into())
            }
            _ => ApiError::Internal(e.into()),
        }
    }
}

impl From<domain::auth::AuthError> for ApiError {
    fn from(e: domain::auth::AuthError) -> Self {
        ApiError::Internal(e.into())
    }
}
