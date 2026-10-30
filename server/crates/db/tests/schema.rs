//! Схема после миграций на настоящем Postgres: таблицы, ограничения, каскады.
//! Нужен DATABASE_URL (см. .env.example), каждый тест получает свою временную базу.

use db::PgPool;

const TABLES: &[&str] = &[
    "activity",
    "board_columns",
    "comments",
    "doc_links",
    "doc_objects",
    "doc_stars",
    "docs",
    "email_codes",
    "files",
    "folders",
    "link_groups",
    "links",
    "milestones",
    "modules",
    "notifications",
    "project_invites",
    "project_members",
    "projects",
    "refresh_tokens",
    "release_items",
    "releases",
    "subtasks",
    "tags",
    "task_old_ids",
    "task_tags",
    "tasks",
    "team_invites",
    "team_members",
    "teams",
    "users",
    "wiki_pages",
];

async fn tables(pool: &PgPool) -> Vec<String> {
    sqlx::query_scalar(
        "select table_name::text from information_schema.tables \
         where table_schema = 'public' and table_name <> '_sqlx_migrations' order by 1",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn exec(pool: &PgPool, sql: &str) -> Result<(), sqlx::Error> {
    sqlx::query(sqlx::AssertSqlSafe(sql.to_owned())).execute(pool).await.map(|_| ())
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn all_tables_from_data_model_exist(pool: PgPool) {
    assert_eq!(tables(&pool).await, TABLES);
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn enums_have_values_from_data_model(pool: PgPool) {
    let values = |name: &'static str| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, String>(
                "select e.enumlabel::text from pg_enum e join pg_type t on t.oid = e.enumtypid \
                 where t.typname = $1 order by e.enumsortorder",
            )
            .bind(name)
            .fetch_all(&pool)
            .await
            .unwrap()
        }
    };
    assert_eq!(values("priority").await, ["high", "med", "low"]);
    assert_eq!(values("work_status").await, ["plan", "progress", "done"]);
    assert_eq!(values("obj_type").await, ["sticky", "rect", "ellipse", "text"]);
    assert_eq!(values("doc_mode").await, ["page", "edge"]);
    assert_eq!(
        values("act_kind").await,
        ["move", "create", "delete", "comment", "code", "doc", "release", "file", "module", "wiki"]
    );
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn migrations_can_be_applied_twice(pool: PgPool) {
    db::migrate(&pool).await.unwrap();
    assert_eq!(tables(&pool).await, TABLES);
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn user_email_must_be_lowercase_and_unique(pool: PgPool) {
    let insert = |email: &'static str| {
        let pool = pool.clone();
        async move {
            exec(&pool, &format!("insert into users (email, name, password_hash) values ('{email}', 'N', 'h')")).await
        }
    };
    insert("a@example.com").await.unwrap();
    assert!(insert("a@example.com").await.is_err(), "дубль e-mail");
    assert!(insert("B@example.com").await.is_err(), "e-mail не в нижнем регистре");
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn tag_labels_are_unique_within_a_project_ignoring_case(pool: PgPool) {
    exec(&pool, "insert into projects (team_id, key, name, color) values ((select id from teams where name = 'Тест'), 'WEB', 'Web', 'accent'), ((select id from teams where name = 'Тест'), 'API', 'Api', 'warn')")
        .await
        .unwrap();
    let add = |project: &'static str, label: &'static str, tone: i32| {
        let pool = pool.clone();
        async move {
            exec(
                &pool,
                &format!(
                    "insert into tags (project_id, label, tone) \
                     values ((select id from projects where key = '{project}'), '{label}', {tone})"
                ),
            )
            .await
        }
    };
    add("WEB", "Bug", 0).await.unwrap();
    assert!(add("WEB", "bug", 1).await.is_err(), "тот же регистр-независимый дубль в проекте");
    add("API", "bug", 1).await.expect("то же название в другом проекте можно");
    assert!(add("WEB", "Feat", 8).await.is_err(), "tone только 0..7");
    // метка без проекта невозможна
    assert!(exec(&pool, "insert into tags (label, tone) values ('Orphan', 0)").await.is_err());
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn task_numbers_are_unique_within_project(pool: PgPool) {
    exec(&pool, "insert into projects (team_id, key, name, color) values ((select id from teams where name = 'Тест'), 'WEB', 'Web', 'accent'), ((select id from teams where name = 'Тест'), 'API', 'Api', 'warn')")
        .await
        .unwrap();
    let add = |project: &'static str, n: i32| {
        let pool = pool.clone();
        async move {
            exec(
                &pool,
                &format!(
                    "insert into tasks (project_id, number, title, position) \
                     values ((select id from projects where key = '{project}'), {n}, 'T', 1024)"
                ),
            )
            .await
        }
    };
    add("WEB", 1).await.unwrap();
    add("API", 1).await.unwrap();
    assert!(add("WEB", 1).await.is_err(), "WEB-1 дважды");
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn deleting_a_project_removes_its_board_and_tasks(pool: PgPool) {
    exec(&pool, "insert into projects (team_id, key, name, color) values ((select id from teams where name = 'Тест'), 'WEB', 'Web', 'accent')").await.unwrap();
    exec(
        &pool,
        "insert into board_columns (project_id, title, color, position) \
         select id, 'К выполнению', 'muted', 1024 from projects",
    )
    .await
    .unwrap();
    exec(
        &pool,
        "insert into tasks (project_id, number, title, column_id, position) \
         select p.id, 1, 'T', c.id, 1024 from projects p join board_columns c on c.project_id = p.id",
    )
    .await
    .unwrap();
    exec(&pool, "delete from projects").await.unwrap();
    for table in ["board_columns", "tasks"] {
        let n: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!("select count(*) from {table}")))
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n, 0, "{table} должна очиститься каскадом");
    }
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn deleting_a_column_moves_tasks_to_backlog(pool: PgPool) {
    exec(&pool, "insert into projects (team_id, key, name, color) values ((select id from teams where name = 'Тест'), 'WEB', 'Web', 'accent')").await.unwrap();
    exec(
        &pool,
        "insert into board_columns (project_id, title, color, position) select id, 'Col', 'muted', 1 from projects",
    )
    .await
    .unwrap();
    exec(
        &pool,
        "insert into tasks (project_id, number, title, column_id, position) \
         select p.id, 1, 'T', c.id, 1024 from projects p join board_columns c on c.project_id = p.id",
    )
    .await
    .unwrap();
    exec(&pool, "delete from board_columns").await.unwrap();
    let col: Option<uuid::Uuid> = sqlx::query_scalar("select column_id from tasks").fetch_one(&pool).await.unwrap();
    assert_eq!(col, None, "column_id = null означает бэклог");
}
