//! Участники, приглашения, архив и метки по проектам на настоящем Postgres: миграция существующих данных,
//! обратная миграция и выборки доступа (docs/PROJECTS.md, разделы 1 и 2).

use std::borrow::Cow;

use db::{PgPool, projects};
use sqlx::migrate::Migrator;
use uuid::Uuid;

async fn exec(pool: &PgPool, sql: &str) {
    sqlx::query(sqlx::AssertSqlSafe(sql.to_owned())).execute(pool).await.unwrap();
}

async fn rows(pool: &PgPool, sql: &str) -> Vec<(String, String)> {
    sqlx::query_as(sqlx::AssertSqlSafe(sql.to_owned())).fetch_all(pool).await.unwrap()
}

async fn count(pool: &PgPool, sql: &str) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(sql.to_owned())).fetch_one(pool).await.unwrap()
}

/// База в состоянии до миграции 13: два проекта, три метки (две используются, одна нет), администратор и обычный человек
async fn before_the_migration(pool: &PgPool) -> Migrator {
    let all: Vec<_> = db::MIGRATOR.migrations.iter().cloned().collect();
    let before: Vec<_> = all.iter().filter(|m| m.version < 13).cloned().collect();
    Migrator { migrations: Cow::Owned(before), ..Migrator::DEFAULT }.run(pool).await.unwrap();

    exec(pool, "insert into users (email, name, password_hash, is_admin) values ('boss@example.com', 'Босс', 'h', true), ('dev@example.com', 'Разработчик', 'h', false)").await;
    exec(pool, "insert into projects (key, name, color) values ('WEB', 'Web', 'accent'), ('API', 'Api', 'warn')").await;
    exec(pool, "insert into tags (label, tone) values ('Баг', 0), ('Фича', 1), ('Старая', 2)").await;
    for (project, number) in [("WEB", 1), ("WEB", 2), ("API", 1)] {
        exec(
            pool,
            &format!(
                "insert into tasks (project_id, number, title, position) \
                 select id, {number}, '{project}-{number}', {number} from projects where key = '{project}'"
            ),
        )
        .await;
    }
    // «Баг» стоит на задачах обоих проектов, «Фича» только в WEB, «Старая» ни на чём
    exec(pool, "insert into task_tags select t.id, g.id from tasks t, tags g where g.label = 'Баг'").await;
    exec(
        pool,
        "insert into task_tags select t.id, g.id from tasks t, tags g where g.label = 'Фича' and t.title = 'WEB-2'",
    )
    .await;
    Migrator { migrations: Cow::Owned(all), ..Migrator::DEFAULT }
}

#[sqlx::test]
async fn existing_people_become_members_of_every_project_and_admins_become_project_admins(pool: PgPool) {
    let migrator = before_the_migration(&pool).await;
    migrator.run(&pool).await.unwrap();

    let members = rows(
        &pool,
        "select u.email || ' в ' || p.key, m.role::text from project_members m \
         join users u on u.id = m.user_id join projects p on p.id = m.project_id order by 1",
    )
    .await;
    assert_eq!(
        members,
        [
            ("boss@example.com в API".to_owned(), "admin".to_owned()),
            ("boss@example.com в WEB".to_owned(), "admin".to_owned()),
            ("dev@example.com в API".to_owned(), "member".to_owned()),
            ("dev@example.com в WEB".to_owned(), "member".to_owned()),
        ]
    );
    assert_eq!(count(&pool, "select count(*) from project_invites").await, 0);
    assert_eq!(count(&pool, "select count(*) from projects where archived_at is not null").await, 0);
}

#[sqlx::test]
async fn shared_tags_become_project_tags_where_they_are_used_and_the_unused_goes_to_the_first_project(pool: PgPool) {
    let migrator = before_the_migration(&pool).await;
    migrator.run(&pool).await.unwrap();

    let tags = rows(
        &pool,
        "select p.key || ': ' || g.label, '' from tags g join projects p on p.id = g.project_id order by g.seq",
    )
    .await;
    let tags: Vec<String> = tags.into_iter().map(|t| t.0).collect();
    // у каждого проекта свои метки; «Старая», которой никто не пользовался, ушла в первый проект
    assert_eq!(
        tags.iter().filter(|t| t.starts_with("WEB")).cloned().collect::<Vec<_>>(),
        ["WEB: Баг", "WEB: Фича", "WEB: Старая"].map(String::from)
    );
    assert_eq!(
        tags.iter().filter(|t| t.starts_with("API")).cloned().collect::<Vec<_>>(),
        ["API: Баг"].map(String::from)
    );
    assert_eq!(tags.len(), 4, "общих меток без проекта не осталось");

    // метки на задачах переехали на копии своего проекта
    let wrong = count(
        &pool,
        "select count(*) from task_tags tt join tasks t on t.id = tt.task_id join tags g on g.id = tt.tag_id \
         where g.project_id <> t.project_id",
    )
    .await;
    assert_eq!(wrong, 0, "метка чужого проекта на задаче");
    assert_eq!(count(&pool, "select count(*) from task_tags").await, 4, "три «Баг» и одна «Фича»: ничего не потеряно");
    let web2 = rows(
        &pool,
        "select t.title, g.label from task_tags tt join tasks t on t.id = tt.task_id join tags g on g.id = tt.tag_id \
         where t.title = 'WEB-2' order by g.seq",
    )
    .await;
    assert_eq!(web2, [("WEB-2".to_owned(), "Баг".to_owned()), ("WEB-2".to_owned(), "Фича".to_owned())]);
}

#[sqlx::test]
async fn tags_cannot_exist_without_a_project_after_the_migration(pool: PgPool) {
    let migrator = before_the_migration(&pool).await;
    migrator.run(&pool).await.unwrap();
    let r = sqlx::query("insert into tags (label, tone) values ('Новая', 0)").execute(&pool).await;
    assert!(r.is_err(), "у метки обязательно есть проект");
}

#[sqlx::test]
async fn an_empty_database_migrates_and_unused_tags_without_any_project_are_dropped(pool: PgPool) {
    // метки есть, проектов нет: класть метки некуда, они пропадают, а миграция не падает
    let all: Vec<_> = db::MIGRATOR.migrations.iter().cloned().collect();
    let before: Vec<_> = all.iter().filter(|m| m.version < 13).cloned().collect();
    Migrator { migrations: Cow::Owned(before), ..Migrator::DEFAULT }.run(&pool).await.unwrap();
    exec(&pool, "insert into tags (label, tone) values ('Баг', 0)").await;
    Migrator { migrations: Cow::Owned(all), ..Migrator::DEFAULT }.run(&pool).await.unwrap();
    assert_eq!(count(&pool, "select count(*) from tags").await, 0);
}

const DOWN: &str = include_str!("../../../migrations_down/0013_project_members.down.sql");
/// Откат идёт с конца: сначала команды (в них общий с приглашениями в проекты тип `invite_status`)
const DOWN_TEAMS: &str = include_str!("../../../migrations_down/0018_teams.down.sql");

#[sqlx::test]
async fn down_migration_makes_tags_shared_again_and_drops_membership(pool: PgPool) {
    let migrator = before_the_migration(&pool).await;
    migrator.run(&pool).await.unwrap();
    // уже после миграции в проектах завелись одноимённые метки
    exec(&pool, "insert into tags (project_id, label, tone) select id, 'Срочно', 5 from projects").await;
    exec(&pool, "insert into task_tags select t.id, g.id from tasks t join tags g on g.project_id = t.project_id where g.label = 'Срочно' and t.title = 'API-1'").await;

    sqlx::raw_sql(sqlx::AssertSqlSafe(DOWN_TEAMS.to_owned())).execute(&pool).await.expect("откат команд выполняется");
    sqlx::raw_sql(sqlx::AssertSqlSafe(DOWN.to_owned())).execute(&pool).await.expect("обратная миграция выполняется");

    // метки общие: по одной на название, задачи ничего не потеряли
    let labels: Vec<(String, String)> = rows(&pool, "select label, '' from tags order by seq").await;
    let labels: Vec<String> = labels.into_iter().map(|l| l.0).collect();
    assert_eq!(labels, ["Баг", "Фича", "Старая", "Срочно"].map(String::from));
    assert_eq!(count(&pool, "select count(*) from task_tags").await, 5);
    let api1 = rows(&pool, "select t.title, g.label from task_tags tt join tasks t on t.id = tt.task_id join tags g on g.id = tt.tag_id where t.title = 'API-1' order by g.label").await;
    assert_eq!(api1, [("API-1".to_owned(), "Баг".to_owned()), ("API-1".to_owned(), "Срочно".to_owned())]);
    assert!(
        sqlx::query("insert into tags (label, tone) values ('баг', 1)").execute(&pool).await.is_err(),
        "название снова уникально"
    );

    // участников, приглашений и архива больше нет
    for sql in [
        "select 1 from project_members",
        "select 1 from project_invites",
        "select archived_at from projects",
        "select created_by from projects",
    ] {
        assert!(sqlx::query(sqlx::AssertSqlSafe(sql.to_owned())).execute(&pool).await.is_err(), "{sql}");
    }
}

// ===== Выборки доступа =====

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn access_queries_know_members_admins_global_admins_and_strangers(pool: PgPool) {
    exec(&pool, "insert into users (email, name, password_hash, is_admin) values ('root@example.com', 'Root', 'h', true), ('lead@example.com', 'Lead', 'h', false), ('dev@example.com', 'Dev', 'h', false), ('out@example.com', 'Out', 'h', false)").await;
    exec(&pool, "insert into projects (team_id, key, name, color) values ((select id from teams where name = 'Тест'), 'WEB', 'Web', 'accent'), ((select id from teams where name = 'Тест'), 'API', 'Api', 'warn')")
        .await;
    exec(&pool, "update projects set archived_at = now() where key = 'API'").await;
    exec(&pool, "insert into project_members (project_id, user_id, role) select p.id, u.id, case when u.email = 'lead@example.com' then 'admin'::project_role else 'member'::project_role end from projects p, users u where u.email in ('lead@example.com', 'dev@example.com')").await;

    let id = |sql: &'static str| {
        let pool = pool.clone();
        async move { sqlx::query_scalar::<_, Uuid>(sql).fetch_one(&pool).await.unwrap() }
    };
    let web = id("select id from projects where key = 'WEB'").await;
    let root = id("select id from users where email = 'root@example.com'").await;
    let lead = id("select id from users where email = 'lead@example.com'").await;
    let dev = id("select id from users where email = 'dev@example.com'").await;
    let out = id("select id from users where email = 'out@example.com'").await;

    let role = |user: Uuid| {
        let pool = pool.clone();
        async move { projects::for_user(&pool, web, user).await.unwrap().map(|m| m.role) }
    };
    assert_eq!(role(lead).await.as_deref(), Some("admin"));
    assert_eq!(role(dev).await.as_deref(), Some("member"));
    assert_eq!(role(root).await.as_deref(), Some("admin"), "глобальный админ не участник, но управляет");
    assert_eq!(role(out).await, None, "постороннему проекта нет");
    assert!(projects::for_user(&pool, Uuid::new_v4(), lead).await.unwrap().is_none());

    let names = |user: Uuid, archived: bool| {
        let pool = pool.clone();
        async move {
            projects::list_for_user(&pool, user, archived)
                .await
                .unwrap()
                .into_iter()
                .map(|m| m.project.name)
                .collect::<Vec<_>>()
        }
    };
    assert_eq!(names(lead, false).await, ["Web"]);
    assert_eq!(names(out, false).await, Vec::<String>::new());
    assert_eq!(names(root, false).await, ["Web"], "архивные в основном списке не показываются никому");
    assert_eq!(names(lead, true).await, ["Api"], "архив видит тот, кто им управляет");
    assert_eq!(names(dev, true).await, Vec::<String>::new(), "участнику архив не показывается");
    assert_eq!(names(root, true).await, ["Api"]);

    // кому доставлять события
    assert_eq!(db::members::project_ids(&pool, dev).await.unwrap().len(), 2);
    assert!(db::members::project_ids(&pool, out).await.unwrap().is_empty());
    assert_eq!(db::members::project_ids(&pool, root).await.unwrap().len(), 2);
    assert!(db::members::can_see(&pool, web, root).await.unwrap());
    assert!(!db::members::can_see(&pool, web, out).await.unwrap());
}
