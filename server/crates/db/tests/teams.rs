//! Команды на настоящем Postgres: миграция существующих данных, личные команды «Личное», правила доступа в базе и
//! обратная миграция (docs/TEAMS.md, разделы 3 и 12).

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

fn pair(a: &str, b: &str) -> (String, String) {
    (a.to_owned(), b.to_owned())
}

/// База до миграции 18 с данными: два аккаунта (первый администратор), два проекта, вики из двух страниц, папка, три
/// файла (в папке, на странице, на задаче) и события с проектом и без
async fn before_the_migration(pool: &PgPool, admin_first: bool) -> Migrator {
    let all: Vec<_> = db::MIGRATOR.migrations.iter().cloned().collect();
    let before: Vec<_> = all.iter().filter(|m| m.version < 18).cloned().collect();
    Migrator { migrations: Cow::Owned(before), ..Migrator::DEFAULT }.run(pool).await.unwrap();

    exec(
        pool,
        &format!(
            "insert into users (email, name, password_hash, is_admin) values \
             ('boss@example.com', 'Босс', 'h', {admin_first}), ('dev@example.com', 'Разработчик', 'h', false)"
        ),
    )
    .await;
    exec(pool, "insert into projects (key, name, color) values ('WEB', 'Web', 'accent'), ('API', 'Api', 'warn')").await;
    exec(pool, "insert into wiki_pages (title, position) values ('Корень', 1024)").await;
    exec(
        pool,
        "insert into wiki_pages (parent_id, title, position) select id, 'Вложенная', 1024 from wiki_pages where title = 'Корень'",
    )
    .await;
    exec(pool, "insert into folders (name) values ('Дизайн')").await;
    exec(
        pool,
        "insert into files (name, size_bytes, kind, storage_key, folder_id) \
         select 'схема.png', 1, 'img', 'k1', id from folders where name = 'Дизайн'",
    )
    .await;
    exec(
        pool,
        "insert into files (name, size_bytes, kind, storage_key, wiki_page_id) \
         select 'вложение.pdf', 1, 'pdf', 'k2', id from wiki_pages where title = 'Корень'",
    )
    .await;
    exec(pool, "insert into tasks (project_id, number, title, position) select id, 1, 'Задача', 1 from projects where key = 'API'")
        .await;
    exec(
        pool,
        "insert into files (name, size_bytes, kind, storage_key, task_id) select 'на-задаче.txt', 1, 'other', 'k3', id from tasks",
    )
    .await;
    exec(
        pool,
        "insert into activity (actor_id, project_id, kind, target, text) \
         select u.id, p.id, 'create', 'WEB-1 Задача', 'создана' from users u, projects p where p.key = 'WEB' and u.email = 'dev@example.com'",
    )
    .await;
    exec(
        pool,
        "insert into activity (actor_id, kind, target, text) select id, 'file', 'схема.png', 'загружено в вики' from users \
         where email = 'dev@example.com'",
    )
    .await;
    Migrator { migrations: Cow::Owned(all), ..Migrator::DEFAULT }
}

#[sqlx::test]
async fn existing_data_moves_to_dream_team_and_every_account_gets_a_personal_team(pool: PgPool) {
    let migrator = before_the_migration(&pool, true).await;
    migrator.run(&pool).await.unwrap();

    // общая команда: все аккаунты, администратор сервера её администратор
    let members = rows(
        &pool,
        "select u.email, m.role::text from team_members m join users u on u.id = m.user_id join teams t on t.id = m.team_id \
         where t.name = 'Dream Team' order by u.seq",
    )
    .await;
    assert_eq!(members, [pair("boss@example.com", "admin"), pair("dev@example.com", "member")]);

    // у каждого аккаунта ровно одна личная команда «Личное», он в ней администратор и один
    let personal = rows(
        &pool,
        "select u.email, t.name || ':' || m.role::text from teams t join users u on u.id = t.personal_for \
         join team_members m on m.team_id = t.id and m.user_id = u.id order by u.seq",
    )
    .await;
    assert_eq!(personal, [pair("boss@example.com", "Личное:admin"), pair("dev@example.com", "Личное:admin")]);
    assert_eq!(
        count(
            &pool,
            "select count(*) from team_members m join teams t on t.id = m.team_id where t.personal_for is not null"
        )
        .await,
        2
    );

    // данные в общей команде, видимость «Только участники»
    for table in ["projects", "wiki_pages", "folders", "files"] {
        let outside = count(
            &pool,
            &format!("select count(*) from {table} x join teams t on t.id = x.team_id where t.name <> 'Dream Team'"),
        )
        .await;
        assert_eq!(outside, 0, "{table}");
    }
    assert_eq!(count(&pool, "select count(*) from projects where visibility <> 'members'").await, 0);
    assert_eq!(count(&pool, "select count(*) from files").await, 3, "ни один файл не потерялся");

    // вложение задачи принадлежит команде своего проекта
    let attached =
        rows(&pool, "select f.name, t.name from files f join teams t on t.id = f.team_id where f.task_id is not null")
            .await;
    assert_eq!(attached, [pair("на-задаче.txt", "Dream Team")]);

    // события без проекта (вики, файлы) получили команду, события проекта остались без неё
    let events = rows(
        &pool,
        "select a.target, coalesce(t.name, '') from activity a left join teams t on t.id = a.team_id order by a.target",
    )
    .await;
    assert_eq!(events, [pair("WEB-1 Задача", ""), pair("схема.png", "Dream Team")]);
}

#[sqlx::test]
async fn without_a_server_admin_the_first_account_administers_dream_team(pool: PgPool) {
    let migrator = before_the_migration(&pool, false).await;
    migrator.run(&pool).await.unwrap();
    let roles = rows(
        &pool,
        "select u.email, m.role::text from team_members m join users u on u.id = m.user_id join teams t on t.id = m.team_id \
         where t.name = 'Dream Team' order by u.seq",
    )
    .await;
    assert_eq!(
        roles,
        [pair("boss@example.com", "admin"), pair("dev@example.com", "member")],
        "у команды всегда есть админ"
    );
}

#[sqlx::test]
async fn an_empty_database_gets_no_dream_team(pool: PgPool) {
    db::MIGRATOR.run(&pool).await.unwrap();
    assert_eq!(count(&pool, "select count(*) from teams").await, 0);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_new_account_gets_its_personal_team_in_the_same_operation(pool: PgPool) {
    exec(&pool, "insert into users (email, name, password_hash) values ('lena@example.com', 'Лена', 'h')").await;
    let mine = rows(
        &pool,
        "select t.name, m.role::text from teams t join team_members m on m.team_id = t.id and m.user_id = t.personal_for \
         where t.personal_for = (select id from users)",
    )
    .await;
    assert_eq!(mine, [pair("Личное", "admin")]);
    // вторая личная команда у того же человека невозможна
    let again = sqlx::query("insert into teams (name, personal_for) select 'Ещё', id from users").execute(&pool).await;
    assert!(again.is_err(), "личная команда одна");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn folder_names_are_unique_inside_a_team_not_across_the_server(pool: PgPool) {
    exec(&pool, "insert into users (email, name, password_hash) values ('a@example.com', 'A', 'h'), ('b@example.com', 'B', 'h')").await;
    let teams: Vec<String> =
        sqlx::query_scalar("select id::text from teams order by seq").fetch_all(&pool).await.unwrap();
    for team in &teams {
        exec(&pool, &format!("insert into folders (team_id, name) values ('{team}', 'Дизайн')")).await;
    }
    let again = sqlx::query(sqlx::AssertSqlSafe(format!(
        "insert into folders (team_id, name) values ('{}', 'Дизайн')",
        teams[0]
    )))
    .execute(&pool)
    .await;
    assert!(again.is_err(), "в одной команде две папки с одним названием невозможны");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn the_access_rule_in_the_database_follows_the_spec(pool: PgPool) {
    exec(
        &pool,
        "insert into users (email, name, password_hash, is_admin) values \
         ('root@example.com', 'Root', 'h', true), ('lead@example.com', 'Lead', 'h', false), ('dev@example.com', 'Dev', 'h', false), \
         ('guest@example.com', 'Guest', 'h', false), ('out@example.com', 'Out', 'h', false)",
    )
    .await;
    exec(&pool, "insert into teams (name) values ('Веб')").await;
    exec(
        &pool,
        "insert into team_members (team_id, user_id, role) select t.id, u.id, case when u.email = 'lead@example.com' then 'admin'::team_role else 'member'::team_role end \
         from teams t, users u where t.name = 'Веб' and u.email in ('lead@example.com', 'dev@example.com')",
    )
    .await;
    exec(
        &pool,
        "insert into projects (team_id, visibility, key, name, color) select t.id, v.visibility::project_visibility, v.key, v.key, 'accent' \
         from teams t, (values ('members', 'PRIV'), ('team', 'OPEN')) v(visibility, key) where t.name = 'Веб'",
    )
    .await;
    exec(
        &pool,
        "insert into project_members (project_id, user_id, role) select p.id, u.id, 'member' from projects p, users u \
         where p.key = 'PRIV' and u.email = 'guest@example.com'",
    )
    .await;

    // кто какие проекты видит
    let sees = |email: &'static str| {
        let pool = pool.clone();
        async move {
            rows(
                &pool,
                &format!(
                    "select p.key, '' from projects p join users u on u.email = '{email}' \
                     where can_access_project(p.id, u.id) order by p.key"
                ),
            )
            .await
            .into_iter()
            .map(|r| r.0)
            .collect::<Vec<_>>()
        }
    };
    assert_eq!(sees("root@example.com").await, ["OPEN", "PRIV"], "администратор сервера видит всё");
    assert_eq!(sees("lead@example.com").await, ["OPEN", "PRIV"], "администратор команды видит все её проекты");
    assert_eq!(sees("dev@example.com").await, ["OPEN"], "член команды видит только «Вся команда»");
    assert_eq!(sees("guest@example.com").await, ["PRIV"], "гость видит только свой проект");
    assert!(sees("out@example.com").await.is_empty(), "посторонний не видит ничего");

    // «люди проекта»: явные участники и, при «Вся команда», члены команды
    let people = |project: &'static str| {
        let pool = pool.clone();
        async move {
            rows(
                &pool,
                &format!(
                    "select u.email, '' from users u join projects p on p.key = '{project}' \
                     where is_project_person(p.id, u.id) order by u.seq"
                ),
            )
            .await
            .into_iter()
            .map(|r| r.0)
            .collect::<Vec<_>>()
        }
    };
    assert_eq!(people("PRIV").await, ["guest@example.com"]);
    assert_eq!(people("OPEN").await, ["lead@example.com", "dev@example.com"]);

    // вики команды: члены и (при настройке) гости читают, посторонний нет
    let reads = |email: &'static str| {
        let pool = pool.clone();
        async move {
            count(
                &pool,
                &format!(
                    "select count(*) from teams t join users u on u.email = '{email}' where t.name = 'Веб' and can_read_team(t.id, u.id)"
                ),
            )
            .await
                == 1
        }
    };
    assert!(reads("root@example.com").await);
    assert!(reads("dev@example.com").await);
    assert!(!reads("guest@example.com").await, "гость читает только при включённой настройке");
    assert!(!reads("out@example.com").await);
    exec(&pool, "update teams set guests_read_wiki = true where name = 'Веб'").await;
    assert!(reads("guest@example.com").await);
    assert!(!reads("out@example.com").await);

    // архивная команда скрыта от всех, кроме администратора сервера, и проекты вместе с ней
    exec(&pool, "update teams set archived_at = now() where name = 'Веб'").await;
    assert_eq!(sees("root@example.com").await, ["OPEN", "PRIV"]);
    for email in ["lead@example.com", "dev@example.com", "guest@example.com"] {
        assert!(sees(email).await.is_empty(), "{email}");
    }
    assert!(!reads("guest@example.com").await && !reads("dev@example.com").await);
}

const DOWN: &str = include_str!("../../../migrations_down/0018_teams.down.sql");

#[sqlx::test]
async fn down_migration_makes_wiki_and_files_shared_again_and_drops_teams(pool: PgPool) {
    let migrator = before_the_migration(&pool, true).await;
    migrator.run(&pool).await.unwrap();

    sqlx::raw_sql(sqlx::AssertSqlSafe(DOWN.to_owned())).execute(&pool).await.expect("обратная миграция выполняется");

    for table in ["teams", "team_members", "team_invites"] {
        let found = sqlx::query(sqlx::AssertSqlSafe(format!("select 1 from {table}"))).execute(&pool).await;
        assert!(found.is_err(), "{table} должна исчезнуть");
    }
    assert_eq!(count(&pool, "select count(*) from wiki_pages").await, 2, "страницы остались");
    assert_eq!(count(&pool, "select count(*) from files").await, 3, "файлы остались");
    assert_eq!(count(&pool, "select count(*) from folders").await, 1);
    assert_eq!(count(&pool, "select count(*) from projects").await, 2);
    for sql in ["select team_id from projects", "select team_id from wiki_pages", "select visibility from projects"] {
        assert!(sqlx::query(sqlx::AssertSqlSafe(sql.to_owned())).execute(&pool).await.is_err(), "{sql}");
    }
    // имя папки снова уникально на весь сервер
    assert!(sqlx::query("insert into folders (name) values ('Дизайн')").execute(&pool).await.is_err());
}

#[sqlx::test]
async fn down_migration_stops_instead_of_losing_data_when_folder_names_repeat(pool: PgPool) {
    let migrator = before_the_migration(&pool, true).await;
    migrator.run(&pool).await.unwrap();
    // после миграции в другой команде появилась папка с тем же названием
    exec(
        &pool,
        "insert into folders (team_id, name) select id, 'Дизайн' from teams where personal_for is not null limit 1",
    )
    .await;

    // на отдельном соединении: после ошибки внутри `begin` оно остаётся в оборванной транзакции, её надо закрыть
    let mut conn = pool.acquire().await.unwrap();
    let r = sqlx::raw_sql(sqlx::AssertSqlSafe(DOWN.to_owned())).execute(&mut *conn).await;
    assert!(r.is_err(), "откат не должен молча склеить папки");
    sqlx::query("rollback").execute(&mut *conn).await.unwrap();
    drop(conn);
    // ничего не потеряно: команды на месте
    assert!(count(&pool, "select count(*) from teams").await > 0);
}
