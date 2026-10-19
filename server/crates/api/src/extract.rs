use axum::{
    extract::{FromRequest, FromRequestParts, Request},
    http::{header::AUTHORIZATION, request::Parts},
};
use serde::de::DeserializeOwned;
use uuid::Uuid;

use crate::{error::ApiError, state::AppState};

/// JSON из тела запроса. Ошибки разбора приходят в общем формате `{ code, message }`.
pub struct ApiJson<T>(pub T);

impl<S, T> FromRequest<S> for ApiJson<T>
where
    S: Send + Sync,
    T: DeserializeOwned,
{
    type Rejection = ApiError;

    async fn from_request(req: Request, state: &S) -> Result<Self, ApiError> {
        match axum::Json::<T>::from_request(req, state).await {
            Ok(axum::Json(value)) => Ok(ApiJson(value)),
            Err(rejection) => Err(ApiError::BadRequest(rejection.body_text())),
        }
    }
}

/// Параметр пути (`/tasks/{id}`). Некорректный идентификатор даёт 400 в общем формате ошибок.
pub struct ApiPath<T>(pub T);

impl<S, T> FromRequestParts<S> for ApiPath<T>
where
    S: Send + Sync,
    T: DeserializeOwned + Send,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, ApiError> {
        match axum::extract::Path::<T>::from_request_parts(parts, state).await {
            Ok(axum::extract::Path(value)) => Ok(ApiPath(value)),
            Err(_) => Err(ApiError::BadRequest("Некорректный идентификатор в адресе".into())),
        }
    }
}

/// Параметры запроса (`?move_to=...`). Ошибки разбора дают 400 в общем формате.
pub struct ApiQuery<T>(pub T);

impl<S, T> FromRequestParts<S> for ApiQuery<T>
where
    S: Send + Sync,
    T: DeserializeOwned,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, ApiError> {
        match axum::extract::Query::<T>::from_request_parts(parts, state).await {
            Ok(axum::extract::Query(value)) => Ok(ApiQuery(value)),
            Err(rejection) => Err(ApiError::BadRequest(rejection.body_text())),
        }
    }
}

/// Пользователь из токена доступа (`Authorization: Bearer ...`). Без действительного токена ручка отвечает 401.
#[derive(Debug, Clone, Copy)]
pub struct AuthUser {
    pub id: Uuid,
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let token = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(bearer_token)
            .ok_or(ApiError::Unauthorized)?;
        let claims = domain::auth::verify_access_token(&state.jwt_secret, token).map_err(|_| ApiError::Unauthorized)?;
        Ok(AuthUser { id: claims.sub })
    }
}

/// Схема в заголовке регистронезависимая: `Bearer`, `bearer`
fn bearer_token(header: &str) -> Option<&str> {
    let (scheme, token) = header.split_once(' ')?;
    let token = token.trim();
    (scheme.eq_ignore_ascii_case("bearer") && !token.is_empty()).then_some(token)
}

#[cfg(test)]
mod tests {
    use super::bearer_token;

    #[test]
    fn bearer_scheme_is_case_insensitive() {
        assert_eq!(bearer_token("Bearer abc"), Some("abc"));
        assert_eq!(bearer_token("bearer abc"), Some("abc"));
        assert_eq!(bearer_token("BEARER   abc "), Some("abc"));
    }

    #[test]
    fn other_schemes_and_empty_tokens_are_rejected() {
        assert_eq!(bearer_token("Basic abc"), None);
        assert_eq!(bearer_token("Bearer"), None);
        assert_eq!(bearer_token("Bearer "), None);
        assert_eq!(bearer_token("abc"), None);
        assert_eq!(bearer_token(""), None);
    }
}
