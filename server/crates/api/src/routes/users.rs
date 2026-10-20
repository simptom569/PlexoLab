use axum::{Json, extract::State};
use db::users::User;
use domain::users::{self, MAX_NAME_LEN, MAX_ROLE_LEN};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use crate::{
    error::{ApiError, ApiResult, ErrorBody},
    extract::{ApiJson, AuthUser},
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

/// Что человек может поменять в своём профиле. Не заданное остаётся как было. E-mail, права и пароль так не меняются:
/// лишние поля отклоняются, а не молча игнорируются.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateProfile {
    /// Имя, от 1 до 60 символов
    #[schema(example = "Лена М.")]
    pub name: Option<String>,
    /// Подпись под именем, до 40 символов; пустая строка очищает её
    #[schema(example = "Frontend")]
    pub role: Option<String>,
    /// Цвет аватара: 0..4 → av-a … av-e
    pub tone: Option<i16>,
}

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(me, update_me)).routes(routes!(list_users))
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

/// Изменить свой профиль: имя, подпись под именем, цвет аватара
#[utoipa::path(
    patch,
    path = "/me",
    tag = "users",
    security(("bearer" = [])),
    request_body = UpdateProfile,
    responses(
        (status = 200, description = "Профиль после изменений", body = UserDto),
        (status = 400, description = "Некорректное значение или поле, которое менять нельзя (e-mail, права, пароль)", body = ErrorBody),
        (status = 401, description = "Нет действительного токена или пользователь удалён", body = ErrorBody),
    )
)]
async fn update_me(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiJson(req): ApiJson<UpdateProfile>,
) -> ApiResult<Json<UserDto>> {
    let name = req
        .name
        .as_deref()
        .map(|raw| users::clean_name(raw).ok_or_else(|| ApiError::BadRequest(format!("Имя: от 1 до {MAX_NAME_LEN} символов"))))
        .transpose()?;
    let role = req
        .role
        .as_deref()
        .map(|raw| users::clean_role(raw).ok_or_else(|| ApiError::BadRequest(format!("Подпись: не длиннее {MAX_ROLE_LEN} символов"))))
        .transpose()?;
    if req.tone.is_some_and(|tone| !users::is_avatar_tone(tone)) {
        return Err(ApiError::BadRequest("Цвет аватара: число от 0 до 4".into()));
    }

    let user = db::users::update_profile(&state.pool, auth.id, name.as_deref(), role.as_deref(), req.tone)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    Ok(Json(user.into()))
}

/// Участники команды
#[utoipa::path(
    get,
    path = "/users",
    tag = "users",
    security(("bearer" = [])),
    responses(
        (status = 200, description = "Все участники в порядке добавления в команду", body = [UserDto]),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
    )
)]
async fn list_users(_auth: AuthUser, State(state): State<AppState>) -> ApiResult<Json<Vec<UserDto>>> {
    let users = db::users::list(&state.pool).await?;
    Ok(Json(users.into_iter().map(UserDto::from).collect()))
}
