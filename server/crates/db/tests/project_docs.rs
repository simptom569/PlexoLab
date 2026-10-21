//! Документы и ссылки по проектам на настоящем Postgres: миграция существующих данных, обратная миграция и каскад
//! (docs/PROJECTS.md, раздел 2).

use std::borrow::Cow;

use db::PgPool;
use sqlx::migrate::Migrator;

async fn exec(pool: &PgPool, sql: &str) {
    sqlx::query(sqlx::AssertSqlSafe(sql.to_owned())).execute(pool).await.unwrap();
}

async fn rows(pool: &PgPool, sql: &str) -> Vec<(String, String)> {
    sqlx::query_as(sqlx::AssertSqlSafe(sql.to_owned())).fetch_all(pool).await.unwrap()
}

async fn count(pool: &PgPool, sql: &str) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(sql.to_owned())).fetch_one(pool).await.unwrap()
}

/// База до миграции 14: два проекта, два документа, две группы со ссылками, события документов, вики и задач
async fn before_the_migration(pool: &PgPool) -> Migrator {
    let all: Vec<_> = db::MIGRATOR.migrations.iter().cloned().collect();
    let before: Vec<_> = all.iter().filter(|m| m.version < 14).cloned().collect();
    Migrator { migrations: Cow::Owned(before), ..Migrator::DEFAULT }.run(pool).await.unwrap();

    exec(pool, "insert into users (email, name, password_hash) values ('dev@example.com', 'Разработчик', 'h')").await;
    exec(pool, "insert into projects (key, name, color) values ('WEB', 'Web', 'accent'), ('API', 'Api', 'warn')").await;
    exec(pool, "insert into docs (title, position) values ('Схема', 1024), ('', 2048)").await;
    exec(pool, "insert into link_groups (title, position) values ('Код', 1024), ('Мониторинг', 2048)").await;
    exec(
        pool,
        "insert into links (group_id, title, url, position) select id, 'Репо', 'https://example.com', 1024 from link_groups where title = 'Код'",
    )
    .await;
    exec(
        pool,
        "insert into activity (actor_id, project_id, kind, target, text) \
         select u.id, p.id, 'create', 'WEB-1 Задача', 'создана' from users u, projects p where p.key = 'WEB'",
    )
    .await;
    for (kind, target, text) in [
        ("doc", "Документ «Схема»", "создан"),
        ("doc", "Новый документ", "создан"),
        ("doc", "Документ «Схема»", "удалён"),
        ("doc", "Страница «Архитектура»", "обновлена"),
        ("file", "ui-kit.zip", "загружено в вики"),
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
async fn existing_docs_and_link_groups_go_to_the_first_project_and_so_do_their_events(pool: PgPool) {
    let migrator = before_the_migration(&pool).await;
    migrator.run(&pool).await.unwrap();

    let docs =
        rows(&pool, "select d.title, p.key from docs d join projects p on p.id = d.project_id order by d.position")
            .await;
    assert_eq!(docs, [("Схема".to_owned(), "WEB".to_owned()), (String::new(), "WEB".to_owned())]);
    let groups = rows(
        &pool,
        "select g.title, p.key from link_groups g join projects p on p.id = g.project_id order by g.position",
    )
    .await;
    assert_eq!(groups, [("Код".to_owned(), "WEB".to_owned()), ("Мониторинг".to_owned(), "WEB".to_owned())]);
    assert_eq!(count(&pool, "select count(*) from links").await, 1, "ссылки остались в своих группах");

    // события документов ушли в проект, события вики и файлов остались общими, события задач не тронуты
    let mut events =
        rows(&pool, "select a.target, coalesce(p.key, '') from activity a left join projects p on p.id = a.project_id")
            .await;
    events.sort(); // порядок зависит от правил сортировки базы, а не от миграции
    let mut expected: Vec<(String, String)> = [
        ("WEB-1 Задача", "WEB"),
        ("Документ «Схема»", "WEB"),
        ("Документ «Схема»", "WEB"),
        ("Новый документ", "WEB"),
        ("Страница «Архитектура»", ""),
        ("ui-kit.zip", ""),
    ]
    .map(|(t, k)| (t.to_owned(), k.to_owned()))
    .to_vec();
    expected.sort();
    assert_eq!(events, expected);
}

#[sqlx::test]
async fn a_doc_or_a_group_cannot_exist_without_a_project_and_they_go_with_it(pool: PgPool) {
    let migrator = before_the_migration(&pool).await;
    migrator.run(&pool).await.unwrap();

    assert!(sqlx::query("insert into docs (title, position) values ('Без проекта', 1)").execute(&pool).await.is_err());
    assert!(
        sqlx::query("insert into link_groups (title, position) values ('Без проекта', 1)")
            .execute(&pool)
            .await
            .is_err()
    );

    exec(&pool, "delete from projects where key = 'WEB'").await;
    assert_eq!(count(&pool, "select count(*) from docs").await, 0, "документы уходят вместе с проектом");
    assert_eq!(count(&pool, "select count(*) from link_groups").await, 0);
    assert_eq!(count(&pool, "select count(*) from links").await, 0);
}

#[sqlx::test]
async fn an_empty_database_migrates(pool: PgPool) {
    let all: Vec<_> = db::MIGRATOR.migrations.iter().cloned().collect();
    let before: Vec<_> = all.iter().filter(|m| m.version < 14).cloned().collect();
    Migrator { migrations: Cow::Owned(before), ..Migrator::DEFAULT }.run(&pool).await.unwrap();
    Migrator { migrations: Cow::Owned(all), ..Migrator::DEFAULT }.run(&pool).await.unwrap();
    assert_eq!(count(&pool, "select count(*) from docs").await, 0);
}

#[sqlx::test]
async fn docs_without_any_project_stop_the_migration_instead_of_being_lost(pool: PgPool) {
    let all: Vec<_> = db::MIGRATOR.migrations.iter().cloned().collect();
    let before: Vec<_> = all.iter().filter(|m| m.version < 14).cloned().collect();
    Migrator { migrations: Cow::Owned(before), ..Migrator::DEFAULT }.run(&pool).await.unwrap();
    exec(&pool, "insert into docs (title, position) values ('Сирота', 1)").await;
    let r = Migrator { migrations: Cow::Owned(all), ..Migrator::DEFAULT }.run(&pool).await;
    assert!(r.is_err(), "документ без проекта не должен молча пропасть");
    assert_eq!(count(&pool, "select count(*) from docs").await, 1);
}

const DOWN: &str = include_str!("../../../migrations_down/0014_project_docs_links.down.sql");

#[sqlx::test]
async fn down_migration_makes_docs_and_links_shared_again_and_unbinds_their_events(pool: PgPool) {
    let migrator = before_the_migration(&pool).await;
    migrator.run(&pool).await.unwrap();
    // уже после миграции документы появились и в другом проекте
    exec(
        &pool,
        "insert into docs (project_id, title, position) select id, 'Метрики', 512 from projects where key = 'API'",
    )
    .await;

    sqlx::raw_sql(sqlx::AssertSqlSafe(DOWN.to_owned())).execute(&pool).await.expect("обратная миграция выполняется");

    let titles = rows(&pool, "select title, '' from docs order by position").await;
    let titles: Vec<String> = titles.into_iter().map(|r| r.0).collect();
    assert_eq!(titles, ["Метрики", "Схема", ""].map(String::from), "ни один документ не потерялся");
    assert_eq!(count(&pool, "select count(*) from link_groups").await, 2);
    assert_eq!(count(&pool, "select count(*) from links").await, 1);
    for sql in ["select project_id from docs", "select project_id from link_groups"] {
        assert!(sqlx::query(sqlx::AssertSqlSafe(sql.to_owned())).execute(&pool).await.is_err(), "{sql}");
    }
    // события документов снова без проекта, событие задачи при своём проекте
    assert_eq!(count(&pool, "select count(*) from activity where project_id is not null").await, 1);
}
