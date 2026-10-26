use sqlx::{PgConnection, PgExecutor, PgPool, Row};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub role: String,
    pub tone: i16,
    pub is_admin: bool,
    pub password_hash: String,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct NewUser {
    /// Уже приведён к нижнему регистру (domain::auth::normalize_email)
    pub email: String,
    pub name: String,
    pub role: String,
    pub tone: i16,
    pub is_admin: bool,
    pub password_hash: String,
}

#[derive(Debug, thiserror::Error)]
pub enum CreateUserError {
    #[error("пользователь с таким e-mail уже есть")]
    EmailTaken,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

// sqlx 0.9 принимает только статические строки SQL, поэтому список колонок собирается макросом
macro_rules! select_user {
    ($tail:literal) => {
        concat!("select id, email, name, role, tone, is_admin, password_hash, created_at from users ", $tail)
    };
}

pub async fn create(pool: &PgPool, u: &NewUser) -> Result<User, CreateUserError> {
    sqlx::query_as::<_, User>(
        "insert into users (email, name, role, tone, is_admin, password_hash) \
         values ($1, $2, $3, $4, $5, $6) \
         returning id, email, name, role, tone, is_admin, password_hash, created_at",
    )
    .bind(&u.email)
    .bind(&u.name)
    .bind(&u.role)
    .bind(u.tone)
    .bind(u.is_admin)
    .bind(&u.password_hash)
    .fetch_one(pool)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(d) if d.is_unique_violation() => CreateUserError::EmailTaken,
        _ => CreateUserError::Db(e),
    })
}

#[derive(Debug, thiserror::Error)]
pub enum ChangePasswordError {
    #[error("пользователь с таким e-mail не найден")]
    NotFound,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

/// Меняет пароль пользователя и завершает все его сессии: refresh-токены удаляются, и войти по старым
/// нельзя. Уже выданные токены доступа действуют до конца своего срока (до 12 часов).
/// `email` должен быть в нижнем регистре.
pub async fn change_password(pool: &PgPool, email: &str, password_hash: &str) -> Result<User, ChangePasswordError> {
    let mut tx = pool.begin().await?;
    let user: User = sqlx::query_as(
        "update users set password_hash = $2 where email = $1 \
         returning id, email, name, role, tone, is_admin, password_hash, created_at",
    )
    .bind(email)
    .bind(password_hash)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ChangePasswordError::NotFound)?;
    crate::tokens::delete_all_for_user(&mut *tx, user.id).await?;
    tx.commit().await?;
    Ok(user)
}

/// Заменяет только хэш пароля. Сессии не трогает: чьи сессии и когда завершать, решает вызывающий
/// (при смене пароля из приложения текущую сессию заменяют новой, остальные завершают).
pub async fn set_password(conn: &mut PgConnection, id: Uuid, password_hash: &str) -> Result<(), sqlx::Error> {
    sqlx::query("update users set password_hash = $2 where id = $1").bind(id).bind(password_hash).execute(conn).await?;
    Ok(())
}

/// Правка профиля самим человеком. Не заданное (`None`) остаётся как было; пустая строка в `role` очищает подпись.
/// `None` в ответе — такого пользователя нет.
pub async fn update_profile(
    pool: &PgPool,
    id: Uuid,
    name: Option<&str>,
    role: Option<&str>,
    tone: Option<i16>,
) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(
        "update users set name = coalesce($2, name), role = coalesce($3, role), tone = coalesce($4, tone) \
         where id = $1 \
         returning id, email, name, role, tone, is_admin, password_hash, created_at",
    )
    .bind(id)
    .bind(name)
    .bind(role)
    .bind(tone)
    .fetch_optional(pool)
    .await
}

pub async fn find_by_email(pool: &PgPool, email: &str) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(select_user!("where email = $1")).bind(email).fetch_optional(pool).await
}

pub async fn find_by_id(pool: &PgPool, id: Uuid) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(select_user!("where id = $1")).bind(id).fetch_optional(pool).await
}

/// Есть ли такой пользователь. Работает и внутри транзакции.
pub async fn exists<'e>(ex: impl PgExecutor<'e>, id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select exists (select 1 from users where id = $1)").bind(id).fetch_one(ex).await
}

/// Имена людей по id (для текста уведомлений); кого нет, тех в ответе нет
pub async fn names<'e>(ex: impl PgExecutor<'e>, ids: &[Uuid]) -> Result<Vec<(Uuid, String)>, sqlx::Error> {
    sqlx::query_as("select id, name from users where id = any($1)").bind(ids).fetch_all(ex).await
}

/// Участники команды в порядке добавления
pub async fn list(pool: &PgPool) -> Result<Vec<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(select_user!("order by seq")).fetch_all(pool).await
}

pub async fn count(pool: &PgPool) -> Result<i64, sqlx::Error> {
    sqlx::query("select count(*) from users").fetch_one(pool).await?.try_get(0)
}
