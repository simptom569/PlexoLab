//! Ряды нумерации задач и ключи (docs/PROJECTS.md, раздел 4): ограничения схемы на настоящем Postgres,
//! счётчики рядов и обратная миграция. Нужен DATABASE_URL, каждый тест получает свою временную базу.

use db::{
    PgPool,
    tasks::{self, Series},
};
use uuid::Uuid;

async fn exec(pool: &PgPool, sql: &str) -> Result<(), sqlx::Error> {
    sqlx::query(sqlx::AssertSqlSafe(sql.to_owned())).execute(pool).await.map(|_| ())
}

async fn one<T>(pool: &PgPool, sql: &str) -> T
where
    T: for<'r> sqlx::Decode<'r, sqlx::Postgres> + sqlx::Type<sqlx::Postgres> + Send + Unpin,
{
    sqlx::query_scalar(sqlx::AssertSqlSafe(sql.to_owned())).fetch_one(pool).await.unwrap()
}

/// Проект WEB с модулем SEO (ключ SEO) и модулем «Дизайн» (без ключа)
async fn project_with_modules(pool: &PgPool) {
    exec(pool, "insert into projects (team_id, key, name, color) values ((select id from teams where name = 'Тест'), 'WEB', 'Web', 'accent')").await.unwrap();
    exec(pool, "insert into modules (project_id, title, key) select id, 'SEO', 'SEO' from projects").await.unwrap();
    exec(pool, "insert into modules (project_id, title) select id, 'Дизайн' from projects").await.unwrap();
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn project_keys_are_optional_repeatable_and_checked(pool: PgPool) {
    // без ключа и с одинаковым ключом у разных проектов можно
    exec(&pool, "insert into projects (team_id, key, name, color) values ((select id from teams where name = 'Тест'), null, 'A', 'accent'), ((select id from teams where name = 'Тест'), null, 'B', 'warn')")
        .await
        .unwrap();
    exec(&pool, "insert into projects (team_id, key, name, color) values ((select id from teams where name = 'Тест'), 'PLX', 'C', 'ok'), ((select id from teams where name = 'Тест'), 'PLX', 'D', 'ok')").await.unwrap();
    // формат: 2–6 символов, латиница в верхнем регистре и цифры, начинается с буквы
    for bad in ["P", "plx", "1AB", "ABCDEFG", "AB-C", "ПЛЕКС"] {
        let sql = format!("insert into projects (team_id, key, name, color) values ((select id from teams where name = 'Тест'), '{bad}', 'X', 'ok')");
        assert!(exec(&pool, &sql).await.is_err(), "ключ «{bad}» должен быть отвергнут");
    }
    exec(&pool, "insert into projects (team_id, key, name, color) values ((select id from teams where name = 'Тест'), 'A1', 'E', 'ok'), ((select id from teams where name = 'Тест'), 'ABCDE1', 'F', 'ok')")
        .await
        .unwrap();
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn module_keys_are_unique_within_project_only(pool: PgPool) {
    exec(&pool, "insert into projects (team_id, key, name, color) values ((select id from teams where name = 'Тест'), 'WEB', 'Web', 'accent'), ((select id from teams where name = 'Тест'), 'API', 'Api', 'warn')")
        .await
        .unwrap();
    let add = |project: &'static str, key: &'static str| {
        let pool = pool.clone();
        async move {
            let key = if key.is_empty() { "null".to_owned() } else { format!("'{key}'") };
            exec(
                &pool,
                &format!(
                    "insert into modules (project_id, title, key) \
                     values ((select id from projects where key = '{project}'), 'M', {key})"
                ),
            )
            .await
        }
    };
    add("WEB", "SEO").await.unwrap();
    add("API", "SEO").await.expect("тот же ключ в другом проекте можно");
    assert!(add("WEB", "SEO").await.is_err(), "ключ SEO дважды в одном проекте");
    add("WEB", "").await.unwrap();
    add("WEB", "").await.expect("модулей без ключа может быть сколько угодно");
    assert!(add("WEB", "s").await.is_err(), "формат ключа модуля проверяется");
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn task_numbers_are_unique_within_series(pool: PgPool) {
    project_with_modules(&pool).await;
    let add = |module: Option<&'static str>, n: i32| {
        let pool = pool.clone();
        async move {
            let (module_id, series) = match module {
                Some(title) => {
                    let id = format!("(select id from modules where title = '{title}')");
                    (id.clone(), id)
                }
                None => ("null".to_owned(), "null".to_owned()),
            };
            exec(
                &pool,
                &format!(
                    "insert into tasks (project_id, number, title, position, module_id, series_module_id) \
                     select id, {n}, 'T', 1024, {module_id}, {series} from projects"
                ),
            )
            .await
        }
    };
    add(None, 1).await.unwrap();
    add(Some("SEO"), 1).await.expect("номер 1 в ряду модуля не конфликтует с номером 1 в ряду проекта");
    assert!(add(None, 1).await.is_err(), "WEB-1 дважды в ряду проекта");
    assert!(add(Some("SEO"), 1).await.is_err(), "SEO-1 дважды в ряду модуля");
    add(Some("SEO"), 2).await.unwrap();
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn task_series_must_be_the_assigned_module(pool: PgPool) {
    project_with_modules(&pool).await;
    let insert = |module: &'static str, series: &'static str| {
        let pool = pool.clone();
        async move {
            exec(
                &pool,
                &format!(
                    "insert into tasks (project_id, number, title, position, module_id, series_module_id) \
                     select p.id, 1, 'T', 1024, (select id from modules where title = '{module}'), \
                            (select id from modules where title = '{series}') from projects p"
                ),
            )
            .await
        }
    };
    assert!(insert("Дизайн", "SEO").await.is_err(), "ряд SEO, а задача в модуле «Дизайн»");
    insert("SEO", "SEO").await.unwrap();
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn module_with_a_series_cannot_be_deleted_but_a_plain_one_can(pool: PgPool) {
    project_with_modules(&pool).await;
    exec(
        &pool,
        "insert into tasks (project_id, number, title, position, module_id, series_module_id) \
         select p.id, 1, 'В ряду SEO', 1024, m.id, m.id from projects p, modules m where m.title = 'SEO'",
    )
    .await
    .unwrap();
    exec(
        &pool,
        "insert into tasks (project_id, number, title, position, module_id) \
         select p.id, 2, 'В модуле без ключа', 2048, m.id from projects p, modules m where m.title = 'Дизайн'",
    )
    .await
    .unwrap();

    assert!(
        exec(&pool, "delete from modules where title = 'SEO'").await.is_err(),
        "пока в ряду модуля есть задачи, удалить его нельзя"
    );
    exec(&pool, "delete from modules where title = 'Дизайн'").await.expect("модуль без ряда удаляется, как раньше");
    let module: Option<Uuid> = one(&pool, "select module_id from tasks where title = 'В модуле без ключа'").await;
    assert_eq!(module, None, "у задачи пропал модуль (on delete set null)");
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn old_ids_go_with_their_task(pool: PgPool) {
    exec(&pool, "insert into projects (team_id, key, name, color) values ((select id from teams where name = 'Тест'), 'WEB', 'Web', 'accent')").await.unwrap();
    exec(&pool, "insert into tasks (project_id, number, title, position) select id, 1, 'T', 1024 from projects")
        .await
        .unwrap();
    exec(
        &pool,
        "insert into task_old_ids (task_id, project_id, key, number) select t.id, t.project_id, 'WEB', 7 from tasks t",
    )
    .await
    .unwrap();
    exec(&pool, "delete from tasks").await.unwrap();
    assert_eq!(one::<i64>(&pool, "select count(*) from task_old_ids").await, 0);
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn series_counters_are_independent_and_only_grow(pool: PgPool) {
    project_with_modules(&pool).await;
    let project: Uuid = one(&pool, "select id from projects").await;
    let seo: Uuid = one(&pool, "select id from modules where title = 'SEO'").await;
    let design: Uuid = one(&pool, "select id from modules where title = 'Дизайн'").await;

    let mut conn = pool.acquire().await.unwrap();
    assert_eq!(tasks::next_number(&mut conn, Series::Project(project)).await.unwrap(), 1);
    assert_eq!(tasks::next_number(&mut conn, Series::Project(project)).await.unwrap(), 2);
    assert_eq!(tasks::next_number(&mut conn, Series::Module(seo)).await.unwrap(), 1, "у модуля свой счётчик");
    assert_eq!(tasks::next_number(&mut conn, Series::Module(design)).await.unwrap(), 1);
    assert_eq!(tasks::next_number(&mut conn, Series::Module(seo)).await.unwrap(), 2);
    assert_eq!(tasks::next_number(&mut conn, Series::Project(project)).await.unwrap(), 3, "ряд проекта не тронут");
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn a_task_knows_its_series_and_the_series_key(pool: PgPool) {
    project_with_modules(&pool).await;
    exec(
        &pool,
        "insert into tasks (project_id, number, title, position) select id, 1, 'Без модуля', 1024 from projects",
    )
    .await
    .unwrap();
    exec(
        &pool,
        "insert into tasks (project_id, number, title, position, module_id, series_module_id) \
         select p.id, 1, 'В SEO', 2048, m.id, m.id from projects p, modules m where m.title = 'SEO'",
    )
    .await
    .unwrap();

    let project: Uuid = one(&pool, "select id from projects").await;
    let seo: Uuid = one(&pool, "select id from modules where title = 'SEO'").await;
    let plain: Uuid = one(&pool, "select id from tasks where title = 'Без модуля'").await;
    let in_seo: Uuid = one(&pool, "select id from tasks where title = 'В SEO'").await;

    let plain = tasks::get(&pool, plain).await.unwrap().unwrap();
    assert_eq!((plain.series(), plain.series_key.as_deref()), (Series::Project(project), None));
    let in_seo = tasks::get(&pool, in_seo).await.unwrap().unwrap();
    assert_eq!((in_seo.series(), in_seo.series_key.as_deref()), (Series::Module(seo), Some("SEO")));

    let cards = tasks::list_cards(&pool, project).await.unwrap();
    let key_of = |title: &str| cards.iter().find(|c| c.task.title == title).unwrap().task.series_key.clone();
    assert_eq!(key_of("В SEO").as_deref(), Some("SEO"), "ключ ряда приходит и в карточке доски");
    assert_eq!(key_of("Без модуля"), None);
}

const DOWN: &str = include_str!("../../../migrations_down/0012_task_series.down.sql");

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn down_migration_restores_the_old_schema_and_keeps_every_task(pool: PgPool) {
    project_with_modules(&pool).await;
    exec(&pool, "update projects set key = null").await.unwrap();
    exec(&pool, "update projects set last_number = 2").await.unwrap();
    // две задачи в ряду проекта (номера 1, 2) и три в ряду модуля SEO (номера тоже 1, 2, 3)
    for n in 1..=2 {
        exec(
            &pool,
            &format!(
                "insert into tasks (project_id, number, title, position) select id, {n}, 'P{n}', {n} from projects"
            ),
        )
        .await
        .unwrap();
    }
    for n in 1..=3 {
        exec(
            &pool,
            &format!(
                "insert into tasks (project_id, number, title, position, module_id, series_module_id) \
                 select p.id, {n}, 'S{n}', {n}, m.id, m.id from projects p, modules m where m.title = 'SEO'"
            ),
        )
        .await
        .unwrap();
    }
    assert_eq!(one::<i64>(&pool, "select count(*) from tasks").await, 5);

    sqlx::raw_sql(sqlx::AssertSqlSafe(DOWN.to_owned())).execute(&pool).await.expect("обратная миграция выполняется");

    // ни одна задача не потеряна, номера в проекте снова уникальны и продолжают счётчик проекта
    assert_eq!(one::<i64>(&pool, "select count(*) from tasks").await, 5);
    let numbers: Vec<i32> =
        sqlx::query_scalar("select number from tasks order by number").fetch_all(&pool).await.unwrap();
    assert_eq!(numbers, [1, 2, 3, 4, 5]);
    assert_eq!(
        one::<i32>(&pool, "select number from tasks where title = 'S1'").await,
        3,
        "порядок старых номеров сохранён"
    );
    assert_eq!(one::<i32>(&pool, "select last_number from projects").await, 5, "счётчик проекта догнал номера");

    // схема как до миграции
    assert!(exec(&pool, "select series_module_id from tasks").await.is_err());
    assert!(exec(&pool, "select key from modules").await.is_err());
    assert!(exec(&pool, "select 1 from task_old_ids").await.is_err());
    let key: String = one(&pool, "select key from projects").await;
    assert_eq!(key.len(), 4, "проекту без ключа временный ключ из его id: ключ снова обязателен");
    assert!(exec(&pool, "insert into projects (team_id, key, name, color) values ((select id from teams where name = 'Тест'), null, 'N', 'ok')").await.is_err());
    assert!(
        exec(&pool, &format!("insert into projects (team_id, key, name, color) values ((select id from teams where name = 'Тест'), '{key}', 'Дубль', 'ok')")).await.is_err(),
        "ключ проекта снова уникален"
    );
    assert!(
        exec(&pool, "insert into tasks (project_id, number, title, position) select id, 1, 'Дубль', 9 from projects")
            .await
            .is_err(),
        "номер задачи снова уникален в пределах проекта"
    );
}

#[sqlx::test]
async fn existing_data_keeps_its_ids_through_the_migration(pool: PgPool) {
    use std::borrow::Cow;

    use sqlx::migrate::Migrator;

    // база в состоянии до миграции 12: проект WEB с пятью задачами и модулем
    let all: Vec<_> = db::MIGRATOR.migrations.iter().cloned().collect();
    let (before, _): (Vec<_>, Vec<_>) = all.iter().cloned().partition(|m| m.version < 12);
    Migrator { migrations: Cow::Owned(before), ..Migrator::DEFAULT }.run(&pool).await.unwrap();
    exec(&pool, "insert into projects (key, name, color, last_number) values ('WEB', 'Web', 'accent', 5)")
        .await
        .unwrap();
    exec(&pool, "insert into modules (project_id, title) select id, 'Тёмная тема' from projects").await.unwrap();
    for n in 1..=5 {
        exec(
            &pool,
            &format!(
                "insert into tasks (project_id, number, title, position, module_id) \
                 select p.id, {n}, 'Задача {n}', {n}, case when {n} <= 2 then (select id from modules) end from projects p"
            ),
        )
        .await
        .unwrap();
    }

    // миграция 12 поверх существующих данных
    Migrator { migrations: Cow::Owned(all), ..Migrator::DEFAULT }.run(&pool).await.unwrap();

    let numbers: Vec<i32> =
        sqlx::query_scalar("select number from tasks order by number").fetch_all(&pool).await.unwrap();
    assert_eq!(numbers, [1, 2, 3, 4, 5], "номера не тронуты");
    assert_eq!(
        one::<i64>(&pool, "select count(*) from tasks where series_module_id is not null").await,
        0,
        "все задачи в ряду проекта"
    );
    assert_eq!(one::<String>(&pool, "select key from projects").await, "WEB", "ключ проекта прежний");
    assert_eq!(one::<i32>(&pool, "select last_number from projects").await, 5, "счётчик проекта прежний");
    assert_eq!(one::<i32>(&pool, "select last_number from modules").await, 0);

    let project: Uuid = one(&pool, "select id from projects").await;
    let mut conn = pool.acquire().await.unwrap();
    assert_eq!(tasks::next_number(&mut conn, Series::Project(project)).await.unwrap(), 6, "нумерация продолжается с 6");
}
