//! Пользователи: смена пароля и завершение сессий на настоящем Postgres.

use db::{
    PgPool,
    users::{self, ChangePasswordError, NewUser},
};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

async fn user(pool: &PgPool, email: &str, hash: &str) -> users::User {
    users::create(
        pool,
        &NewUser {
            email: email.into(),
            name: "Имя".into(),
            role: "Роль".into(),
            tone: 3,
            is_admin: true,
            password_hash: hash.into(),
        },
    )
    .await
    .unwrap()
}

async fn add_session(pool: &PgPool, user_id: Uuid, token_hash: &str) {
    let mut conn = pool.acquire().await.unwrap();
    db::tokens::insert(&mut conn, user_id, token_hash, OffsetDateTime::now_utc() + Duration::days(30)).await.unwrap();
}

async fn sessions(pool: &PgPool, user_id: Uuid) -> i64 {
    db::sqlx::query_scalar("select count(*) from refresh_tokens where user_id = $1")
        .bind(user_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn change_password_replaces_the_hash_and_ends_only_that_users_sessions(pool: PgPool) {
    let alice = user(&pool, "alice@example.com", "old-hash").await;
    let bob = user(&pool, "bob@example.com", "bob-hash").await;
    add_session(&pool, alice.id, "a1").await;
    add_session(&pool, alice.id, "a2").await;
    add_session(&pool, bob.id, "b1").await;

    let changed = users::change_password(&pool, "alice@example.com", "new-hash").await.unwrap();

    assert_eq!(changed.id, alice.id);
    assert_eq!(changed.password_hash, "new-hash");
    let stored = users::find_by_id(&pool, alice.id).await.unwrap().unwrap();
    assert_eq!(stored.password_hash, "new-hash");
    assert_eq!(
        (stored.name.as_str(), stored.role.as_str(), stored.tone, stored.is_admin),
        ("Имя", "Роль", 3, true),
        "остальные поля не тронуты"
    );
    assert_eq!(sessions(&pool, alice.id).await, 0, "все сессии Alice завершены");
    assert_eq!(sessions(&pool, bob.id).await, 1, "сессии Bob остались");
    assert_eq!(users::find_by_id(&pool, bob.id).await.unwrap().unwrap().password_hash, "bob-hash");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn change_password_for_an_unknown_email_changes_nothing(pool: PgPool) {
    let alice = user(&pool, "alice@example.com", "old-hash").await;
    add_session(&pool, alice.id, "a1").await;

    let err = users::change_password(&pool, "nobody@example.com", "new-hash").await.unwrap_err();

    assert!(matches!(err, ChangePasswordError::NotFound));
    assert_eq!(users::find_by_id(&pool, alice.id).await.unwrap().unwrap().password_hash, "old-hash");
    assert_eq!(sessions(&pool, alice.id).await, 1);
}
