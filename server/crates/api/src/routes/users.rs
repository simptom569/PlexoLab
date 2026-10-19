use axum::{Json, extract::State};
use db::users::User;
use serde::Serialize;
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use crate::{
    error::{ApiError, ApiResult, ErrorBody},
    extract::AuthUser,
    state::AppState,
};

/// Пользователь без секретов: хэша пароля в ответах API нет
#[derive(Debug, Serialize, ToSchema)]
pub struct UserDto {
    pub id: Uuid,
    #[schema(example = "lena@example.com")]
    pub email: String,
    #[schema(example = "Лена М.")]
    pub name: String,
    /// Подпись под именем в боковом меню
    #[schema(example = "Frontend")]
    pub role: String,
    /// Цвет аватара: 0..4 → av-a … av-e
    pub tone: i16,
    pub is_admin: bool,
}

impl From<User> for UserDto {
    fn from(u: User) -> Self {
        UserDto { id: u.id, email: u.email, name: u.name, role: u.role, tone: u.tone, is_admin: u.is_admin }
    }
}

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(me)).routes(routes!(list_users))
}

/// Текущий пользователь
#[utoipa::path(
    get,
    path = "/me",
    tag = "users",
    security(("bearer" = [])),
    responses(
        (status = 200, description = "Профиль", body = UserDto),
        (status = 401, description = "Нет действительного токена или пользователь удалён", body = ErrorBody),
    )
)]
async fn me(auth: AuthUser, State(state): State<AppState>) -> ApiResult<Json<UserDto>> {
    // токен ещё действителен, а пользователя уже могли удалить
    let user = db::users::find_by_id(&state.pool, auth.id).await?.ok_or(ApiError::Unauthorized)?;
    Ok(Json(user.into()))
}

/// Участники команды
#[utoipa::path(
    get,
    path = "/users",
    tag = "users",
    security(("bearer" = [])),
    responses(
        (status = 200, description = "Все участники, по имени", body = [UserDto]),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
    )
)]
async fn list_users(_auth: AuthUser, State(state): State<AppState>) -> ApiResult<Json<Vec<UserDto>>> {
    let users = db::users::list(&state.pool).await?;
    Ok(Json(users.into_iter().map(UserDto::from).collect()))
}
