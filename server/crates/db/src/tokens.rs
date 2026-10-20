//! Refresh-токены. В базе лежит только sha256 токена, использованный токен удаляется (ротация).

use sqlx::{PgConnection, PgExecutor, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

pub async fn insert(
    conn: &mut PgConnection,
    user_id: Uuid,
    token_hash: &str,
    expires_at: OffsetDateTime,
) -> Result<(), sqlx::Error> {
    sqlx::query("insert into refresh_tokens (user_id, token_hash, expires_at) values ($1, $2, $3)")
        .bind(user_id)
        .bind(token_hash)
        .bind(expires_at)
        .execute(conn)
        .await?;
    Ok(())
}

/// Забирает токен: удаляет его и возвращает владельца, если токен есть и не просрочен.
/// Одним запросом, поэтому один токен нельзя использовать дважды даже при гонке.
pub async fn take(conn: &mut PgConnection, token_hash: &str) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar("delete from refresh_tokens where token_hash = $1 and expires_at > now() returning user_id")
        .bind(token_hash)
        .fetch_optional(conn)
        .await
}

/// Удаляет токен (выход). Если токена нет, ничего не происходит.
pub async fn delete(pool: &PgPool, token_hash: &str) -> Result<(), sqlx::Error> {
    sqlx::query("delete from refresh_tokens where token_hash = $1").bind(token_hash).execute(pool).await?;
    Ok(())
}

/// Завершает все сессии пользователя: удаляет все его refresh-токены, возвращает сколько их было.
/// Работает и на пуле, и внутри транзакции.
pub async fn delete_all_for_user<'e>(ex: impl PgExecutor<'e>, user_id: Uuid) -> Result<u64, sqlx::Error> {
    let r = sqlx::query("delete from refresh_tokens where user_id = $1").bind(user_id).execute(ex).await?;
    Ok(r.rows_affected())
}

/// Чистит просроченные токены пользователя (вызывается при входе)
pub async fn delete_expired_for_user(conn: &mut PgConnection, user_id: Uuid) -> Result<u64, sqlx::Error> {
    let r = sqlx::query("delete from refresh_tokens where user_id = $1 and expires_at <= now()")
        .bind(user_id)
        .execute(conn)
        .await?;
    Ok(r.rows_affected())
}
