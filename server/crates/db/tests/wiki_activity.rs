//! Категория «Вики» в ленте на настоящем Postgres: прежние события страниц вики переходят из `doc` в `wiki`,
//! события документов проекта остаются `doc`.

use std::borrow::Cow;

use db::PgPool;
use sqlx::migrate::Migrator;

async fn exec(pool: &PgPool, sql: &str) {
    sqlx::query(sqlx::AssertSqlSafe(sql.to_owned())).execute(pool).await.unwrap();
}

async fn rows(pool: &PgPool, sql: &str) -> Vec<(String, String)> {
    sqlx::query_as(sqlx::AssertSqlSafe(sql.to_owned())).fetch_all(pool).await.unwrap()
}

/// База до миграций 15 и 16: события вики записаны как `doc` и без проекта
async fn before_the_migration(pool: &PgPool) -> Migrator {
    let all: Vec<_> = db::MIGRATOR.migrations.iter().cloned().collect();
    let before: Vec<_> = all.iter().filter(|m| m.version < 15).cloned().collect();
    Migrator { migrations: Cow::Owned(before), ..Migrator::DEFAULT }.run(pool).await.unwrap();

    exec(pool, "insert into users (email, name, password_hash) values ('dev@example.com', 'Разработчик', 'h')").await;
    exec(pool, "insert into projects (key, name, color) values ('WEB', 'Web', 'accent')").await;
    exec(
        pool,
        "insert into activity (actor_id, project_id, kind, target, text) \
         select u.id, p.id, 'doc', 'Документ «Схема»', 'создан' from users u, projects p",
    )
    .await;
    for (kind, target, text) in [
        ("doc", "Страница «Архитектура»", "обновлена"),
        ("doc", "Новая страница вики", "создана"),
        ("doc", "Новый документ", "создан"),
        ("file", "ui-kit.zip", "загружено в вики"),
        ("create", "WEB-1 Задача", "создана"),
    ] {
        exec(
            pool,
            &format!(
                "insert into activity (actor_id, kind, target, text) select id, '{kind}', '{target}', '{text}' from users"
            ),
        )
        .await;
    }
    Migrator { migrations: Cow::Owned(all), ..Migrator::DEFAULT }
}

#[sqlx::test]
async fn wiki_events_become_wiki_and_documents_stay_documents(pool: PgPool) {
    let migrator = before_the_migration(&pool).await;
    migrator.run(&pool).await.unwrap();

    let mut events = rows(&pool, "select kind::text, target from activity").await;
    events.sort(); // порядок зависит от правил сортировки базы, а не от миграции
    let mut expected: Vec<(String, String)> = [
        ("create", "WEB-1 Задача"),
        ("doc", "Документ «Схема»"),
        ("doc", "Новый документ"),
        ("file", "ui-kit.zip"),
        ("wiki", "Новая страница вики"),
        ("wiki", "Страница «Архитектура»"),
    ]
    .map(|(k, t)| (k.to_owned(), t.to_owned()))
    .to_vec();
    expected.sort();
    assert_eq!(events, expected);
}
