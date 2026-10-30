//! Коды из писем на настоящем Postgres: срок, число попыток, «раз в минуту на адрес» и «N в час на сервер», самый новый
//! код вытесняет прежние, обратная миграция (docs/REGISTRATION.md).

use db::{
    PgPool,
    email_codes::{self, Check, Issue},
};
use domain::codes::{MAX_CODE_ATTEMPTS, Purpose};
use time::Duration;

const DOWN: &str = include_str!("../../../migrations_down/0020_email_codes.down.sql");
const EMAIL: &str = "lena@example.com";
const TTL: Duration = Duration::minutes(15);
const COOLDOWN: Duration = Duration::seconds(60);

async fn issue(pool: &PgPool, purpose: Purpose, email: &str, hash: &str, max_per_hour: u32) -> Issue {
    email_codes::issue(pool, purpose, email, hash, TTL, COOLDOWN, max_per_hour).await.unwrap()
}

async fn check(pool: &PgPool, purpose: Purpose, email: &str, hash: &str) -> Check {
    let mut tx = pool.begin().await.unwrap();
    let result = email_codes::check(&mut tx, purpose, email, hash).await.unwrap();
    tx.commit().await.unwrap(); // и после ошибки: иначе счётчик попыток не сохранится
    result
}

async fn count(pool: &PgPool) -> i64 {
    sqlx::query_scalar("select count(*) from email_codes").fetch_one(pool).await.unwrap()
}

/// Делает все строки «старыми»: как будто прошло указанное время с момента письма
async fn age(pool: &PgPool, interval: &str) {
    sqlx::query(sqlx::AssertSqlSafe(format!("update email_codes set created_at = created_at - interval '{interval}'")))
        .execute(pool)
        .await
        .unwrap();
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn right_code_matches_and_stays_until_consumed(pool: PgPool) {
    assert!(matches!(issue(&pool, Purpose::Register, EMAIL, "h1", 30).await, Issue::Issued(_)));
    assert_eq!(check(&pool, Purpose::Register, EMAIL, "h1").await, Check::Match);
    assert_eq!(check(&pool, Purpose::Register, EMAIL, "h1").await, Check::Match, "проверка код не тратит");

    let mut tx = pool.begin().await.unwrap();
    email_codes::consume(&mut tx, Purpose::Register, EMAIL).await.unwrap();
    tx.commit().await.unwrap();
    assert_eq!(
        check(&pool, Purpose::Register, EMAIL, "h1").await,
        Check::Gone,
        "использованный код больше не подходит"
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn there_is_no_code_for_an_address_that_never_asked(pool: PgPool) {
    assert_eq!(check(&pool, Purpose::Register, EMAIL, "h1").await, Check::Gone);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn code_for_one_purpose_or_address_does_not_fit_another(pool: PgPool) {
    issue(&pool, Purpose::Register, EMAIL, "h1", 30).await;
    assert_eq!(check(&pool, Purpose::Reset, EMAIL, "h1").await, Check::Gone, "код регистрации не сбрасывает пароль");
    assert_eq!(check(&pool, Purpose::Register, "other@example.com", "h1").await, Check::Gone);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn five_wrong_guesses_burn_the_code_even_for_the_right_one(pool: PgPool) {
    issue(&pool, Purpose::Reset, EMAIL, "right", 30).await;
    for left in (0..MAX_CODE_ATTEMPTS).rev() {
        assert_eq!(check(&pool, Purpose::Reset, EMAIL, "wrong").await, Check::Wrong { left }, "осталось {left}");
    }
    assert_eq!(
        check(&pool, Purpose::Reset, EMAIL, "right").await,
        Check::Gone,
        "после пяти ошибок верный код не принимается"
    );
    assert_eq!(count(&pool).await, 0, "сгоревший код удалён");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn right_code_still_works_after_a_few_mistakes(pool: PgPool) {
    issue(&pool, Purpose::Register, EMAIL, "right", 30).await;
    for _ in 0..MAX_CODE_ATTEMPTS - 1 {
        assert!(matches!(check(&pool, Purpose::Register, EMAIL, "wrong").await, Check::Wrong { .. }));
    }
    assert_eq!(check(&pool, Purpose::Register, EMAIL, "right").await, Check::Match, "четыре ошибки ещё не конец");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn expired_code_is_gone(pool: PgPool) {
    issue(&pool, Purpose::Register, EMAIL, "h1", 30).await;
    sqlx::query("update email_codes set expires_at = now() - interval '1 second'").execute(&pool).await.unwrap();
    assert_eq!(check(&pool, Purpose::Register, EMAIL, "h1").await, Check::Gone);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn code_lives_fifteen_minutes(pool: PgPool) {
    issue(&pool, Purpose::Register, EMAIL, "h1", 30).await;
    let minutes: f64 =
        sqlx::query_scalar("select (extract(epoch from (expires_at - created_at)) / 60)::float8 from email_codes")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!((minutes - 15.0).abs() < 0.1, "{minutes}");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn second_letter_to_the_same_address_waits_a_minute(pool: PgPool) {
    assert!(matches!(issue(&pool, Purpose::Register, EMAIL, "h1", 30).await, Issue::Issued(_)));
    assert_eq!(issue(&pool, Purpose::Register, EMAIL, "h2", 30).await, Issue::TooSoon);
    assert_eq!(count(&pool).await, 1, "отказ ничего не записал");
    assert!(
        matches!(issue(&pool, Purpose::Register, "other@example.com", "h3", 30).await, Issue::Issued(_)),
        "другой адрес можно"
    );
    assert!(matches!(issue(&pool, Purpose::Reset, EMAIL, "h4", 30).await, Issue::Issued(_)), "другое назначение можно");

    age(&pool, "61 seconds").await;
    assert!(matches!(issue(&pool, Purpose::Register, EMAIL, "h5", 30).await, Issue::Issued(_)), "через минуту можно");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn newest_code_replaces_the_older_one(pool: PgPool) {
    issue(&pool, Purpose::Register, EMAIL, "old", 30).await;
    age(&pool, "2 minutes").await;
    issue(&pool, Purpose::Register, EMAIL, "new", 30).await;

    assert_eq!(
        check(&pool, Purpose::Register, EMAIL, "old").await,
        Check::Wrong { left: MAX_CODE_ATTEMPTS - 1 },
        "прежний код не подходит"
    );
    assert_eq!(check(&pool, Purpose::Register, EMAIL, "new").await, Check::Match);

    // после использования прежний код не оживает
    let mut tx = pool.begin().await.unwrap();
    email_codes::consume(&mut tx, Purpose::Register, EMAIL).await.unwrap();
    tx.commit().await.unwrap();
    assert_eq!(check(&pool, Purpose::Register, EMAIL, "old").await, Check::Gone);
    assert_eq!(count(&pool).await, 0);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn server_wide_limit_per_hour(pool: PgPool) {
    for i in 0..3 {
        let r = issue(&pool, Purpose::Register, &format!("user{i}@example.com"), "h", 3).await;
        assert!(matches!(r, Issue::Issued(_)), "письмо {i}");
    }
    assert_eq!(issue(&pool, Purpose::Register, "user3@example.com", "h", 3).await, Issue::TooMany);
    assert_eq!(
        issue(&pool, Purpose::Reset, "someone@example.com", "h", 3).await,
        Issue::TooMany,
        "лимит общий для обоих назначений"
    );

    age(&pool, "61 minutes").await;
    assert!(
        matches!(issue(&pool, Purpose::Register, "user3@example.com", "h", 3).await, Issue::Issued(_)),
        "через час можно"
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn old_rows_are_swept_when_the_next_code_is_issued(pool: PgPool) {
    issue(&pool, Purpose::Register, "a@example.com", "h", 30).await;
    issue(&pool, Purpose::Register, "b@example.com", "h", 30).await;
    age(&pool, "3 hours").await;
    issue(&pool, Purpose::Register, "c@example.com", "h", 30).await;
    assert_eq!(count(&pool).await, 1, "осталась только свежая строка");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn removing_an_issued_code_frees_the_address_at_once(pool: PgPool) {
    let Issue::Issued(id) = issue(&pool, Purpose::Register, EMAIL, "h1", 30).await else { panic!("не выдан") };
    email_codes::remove(&pool, id).await.unwrap();
    assert_eq!(check(&pool, Purpose::Register, EMAIL, "h1").await, Check::Gone);
    assert!(
        matches!(issue(&pool, Purpose::Register, EMAIL, "h2", 30).await, Issue::Issued(_)),
        "письмо не ушло — ждать минуту не нужно"
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn two_simultaneous_requests_send_only_one_letter(pool: PgPool) {
    let (a, b) = tokio::join!(
        issue(&pool, Purpose::Register, EMAIL, "h1", 30),
        issue(&pool, Purpose::Register, EMAIL, "h2", 30)
    );
    let issued = [a, b].iter().filter(|r| matches!(r, Issue::Issued(_))).count();
    assert_eq!(issued, 1, "{a:?} {b:?}");
    assert_eq!(count(&pool).await, 1);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn table_checks_purpose_and_lowercase_email(pool: PgPool) {
    let bad_purpose = sqlx::query(
        "insert into email_codes (purpose, email, code_hash, expires_at) values ('login', 'a@b.c', 'h', now())",
    )
    .execute(&pool)
    .await;
    assert!(bad_purpose.is_err(), "назначение только register и reset");
    let bad_email = sqlx::query(
        "insert into email_codes (purpose, email, code_hash, expires_at) values ('reset', 'A@B.C', 'h', now())",
    )
    .execute(&pool)
    .await;
    assert!(bad_email.is_err(), "адрес только в нижнем регистре");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn down_migration_drops_the_table(pool: PgPool) {
    issue(&pool, Purpose::Register, EMAIL, "h1", 30).await;
    sqlx::raw_sql(sqlx::AssertSqlSafe(DOWN.to_owned())).execute(&pool).await.expect("обратная миграция выполняется");
    let tables: i64 =
        sqlx::query_scalar("select count(*) from information_schema.tables where table_name = 'email_codes'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(tables, 0);
}
