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

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn update_profile_changes_only_the_given_fields(pool: PgPool) {
    let alice = user(&pool, "alice@example.com", "alice-hash").await;
    let bob = user(&pool, "bob@example.com", "bob-hash").await;

    let renamed = users::update_profile(&pool, alice.id, Some("Алиса К."), None, None).await.unwrap().unwrap();
    assert_eq!((renamed.name.as_str(), renamed.role.as_str(), renamed.tone), ("Алиса К.", "Роль", 3));

    let recolored = users::update_profile(&pool, alice.id, None, Some("Backend"), Some(0)).await.unwrap().unwrap();
    assert_eq!((recolored.name.as_str(), recolored.role.as_str(), recolored.tone), ("Алиса К.", "Backend", 0));

    let cleared = users::update_profile(&pool, alice.id, None, Some(""), None).await.unwrap().unwrap();
    assert_eq!(cleared.role, "", "подпись можно очистить: пустая строка, а не «не менять»");

    let untouched = users::update_profile(&pool, alice.id, None, None, None).await.unwrap().unwrap();
    assert_eq!((untouched.name.as_str(), untouched.tone), ("Алиса К.", 0), "ничего не задано: ничего не меняется");

    let stored = users::find_by_id(&pool, alice.id).await.unwrap().unwrap();
    assert_eq!(
        (stored.email.as_str(), stored.is_admin, stored.password_hash.as_str()),
        ("alice@example.com", true, "alice-hash"),
        "e-mail, права и пароль не тронуты"
    );
    let bob_now = users::find_by_id(&pool, bob.id).await.unwrap().unwrap();
    assert_eq!((bob_now.name.as_str(), bob_now.role.as_str(), bob_now.tone), ("Имя", "Роль", 3), "другой пользователь не тронут");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn update_profile_of_an_unknown_user_finds_nobody(pool: PgPool) {
    assert!(users::update_profile(&pool, Uuid::new_v4(), Some("Имя"), None, None).await.unwrap().is_none());
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn set_password_replaces_only_the_hash(pool: PgPool) {
    let alice = user(&pool, "alice@example.com", "old-hash").await;
    let bob = user(&pool, "bob@example.com", "bob-hash").await;
    add_session(&pool, alice.id, "a1").await;

    let mut conn = pool.acquire().await.unwrap();
    users::set_password(&mut conn, alice.id, "new-hash").await.unwrap();

    assert_eq!(users::find_by_id(&pool, alice.id).await.unwrap().unwrap().password_hash, "new-hash");
    assert_eq!(users::find_by_id(&pool, bob.id).await.unwrap().unwrap().password_hash, "bob-hash");
    assert_eq!(sessions(&pool, alice.id).await, 1, "сессии сама set_password не трогает: это отдельный шаг");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn delete_all_sessions_ends_only_that_users_sessions(pool: PgPool) {
    let alice = user(&pool, "alice@example.com", "a").await;
    let bob = user(&pool, "bob@example.com", "b").await;
    add_session(&pool, alice.id, "a1").await;
    add_session(&pool, alice.id, "a2").await;
    add_session(&pool, bob.id, "b1").await;

    assert_eq!(db::tokens::delete_all_for_user(&pool, alice.id).await.unwrap(), 2);
    assert_eq!(sessions(&pool, alice.id).await, 0);
    assert_eq!(sessions(&pool, bob.id).await, 1);
    assert_eq!(db::tokens::delete_all_for_user(&pool, alice.id).await.unwrap(), 0, "повторно ничего не находит и не ошибается");
}
