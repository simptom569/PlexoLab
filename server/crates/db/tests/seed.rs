//! Сид: заполнение пустой базы данными макета. Нужен DATABASE_URL, у каждого теста своя временная база.

use db::{
    PgPool,
    seed::{SeedError, SeedOptions, SeedReport, reset, seed},
};
use time::{Date, Month, OffsetDateTime, Time};

/// «Сегодня» макета: даты не сдвигаются
fn mock_options() -> SeedOptions {
    let today = Date::from_calendar_date(2026, Month::October, 18).unwrap();
    SeedOptions {
        today,
        now: OffsetDateTime::new_utc(today, Time::from_hms(15, 0, 0).unwrap()),
        password: "dev".into(),
    }
}

async fn count(pool: &PgPool, sql: &'static str) -> i64 {
    db::sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn seed_fills_an_empty_database_with_the_mockup_data(pool: PgPool) {
    let report = seed(&pool, &mock_options()).await.unwrap();

    assert_eq!(
        report,
        SeedReport {
            users: 5,
            projects: 3,
            columns: 12,
            tags: 21,
            modules: 6,
            milestones: 5,
            tasks: 24,
            subtasks: 11,
            comments: 1,
            releases: 4,
            release_items: 17,
            wiki_pages: 7,
            docs: 4,
            doc_objects: 10,
            doc_links: 5,
            folders: 4,
            files: 10, // 9 в библиотеке и 1 вложение задачи WEB-144
            link_groups: 4,
            links: 10,
            activity: 8,
        }
    );

    // то, что в базе, совпадает с отчётом
    assert_eq!(count(&pool, "select count(*) from tasks").await, 24);
    assert_eq!(count(&pool, "select count(*) from files").await, 10);
    // меток на задачах макета: WEB-доска 26, WEB-бэклог 8, API 6, INF 4
    assert_eq!(count(&pool, "select count(*) from task_tags").await, 44);
    assert_eq!(count(&pool, "select count(*) from doc_stars").await, 1);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn board_numbers_match_the_mockup(pool: PgPool) {
    seed(&pool, &mock_options()).await.unwrap();

    // заголовок доски в макете: «12 задач на доске · 5 в бэклоге», «Готово 4 из 12»
    let on_board = count(
        &pool,
        "select count(*) from tasks t join projects p on p.id = t.project_id where p.key = 'WEB' and t.column_id is not null",
    )
    .await;
    let backlog = count(
        &pool,
        "select count(*) from tasks t join projects p on p.id = t.project_id where p.key = 'WEB' and t.column_id is null",
    )
    .await;
    let done = count(
        &pool,
        "select count(*) from tasks t join board_columns c on c.id = t.column_id join projects p on p.id = t.project_id \
         where p.key = 'WEB' and c.is_done",
    )
    .await;
    assert_eq!((on_board, backlog, done), (12, 5, 4));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn project_counters_cover_existing_task_numbers(pool: PgPool) {
    seed(&pool, &mock_options()).await.unwrap();
    let rows: Vec<(String, i32, i32)> = db::sqlx::query_as(
        "select p.key, p.last_number, max(t.number) from projects p join tasks t on t.project_id = p.id group by p.key, p.last_number order by 1",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows, [("API".to_owned(), 44, 44), ("INF".to_owned(), 14, 14), ("WEB".to_owned(), 158, 158)]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn task_positions_are_ordered_inside_each_column(pool: PgPool) {
    seed(&pool, &mock_options()).await.unwrap();
    let titles: Vec<String> = db::sqlx::query_scalar(
        "select t.title from tasks t join board_columns c on c.id = t.column_id join projects p on p.id = t.project_id \
         where p.key = 'WEB' and c.title = 'К выполнению' order by t.position",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        titles,
        ["Экспорт отчёта в CSV", "Обновить зависимости до React 19", "Медленная пагинация в списке пользователей"]
    );

    let backlog: Vec<String> = db::sqlx::query_scalar(
        "select t.title from tasks t join projects p on p.id = t.project_id where p.key = 'WEB' and t.column_id is null order by t.position",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(backlog.first().map(String::as_str), Some("Фильтр по дате в журнале действий"));
    assert_eq!(backlog.last().map(String::as_str), Some("Двухфакторная аутентификация"));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn dates_follow_the_real_today(pool: PgPool) {
    let mut opts = mock_options();
    opts.today = Date::from_calendar_date(2026, Month::October, 25).unwrap(); // на неделю позже макета
    seed(&pool, &opts).await.unwrap();

    let due: Date = db::sqlx::query_scalar(
        "select due_date from tasks t join projects p on p.id = t.project_id where p.key = 'WEB' and t.number = 151",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(due, Date::from_calendar_date(2026, Month::October, 29).unwrap(), "22 окт + 7 дней");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn demo_users_can_log_in_with_the_chosen_password(pool: PgPool) {
    seed(&pool, &mock_options()).await.unwrap();
    let lena = db::users::find_by_email(&pool, "lena@example.com").await.unwrap().unwrap();
    assert_eq!((lena.name.as_str(), lena.role.as_str(), lena.is_admin), ("Лена М.", "Frontend", true));
    assert!(domain::auth::verify_password("dev", &lena.password_hash));
    assert!(!domain::auth::verify_password("other", &lena.password_hash));
    let team: Vec<String> = db::users::list(&pool).await.unwrap().into_iter().map(|u| u.name).collect();
    assert_eq!(team, ["Лена М.", "Артём К.", "Даниил С.", "Соня В.", "Игорь П."], "как в макете, не по алфавиту");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn wiki_tree_and_files_are_linked(pool: PgPool) {
    seed(&pool, &mock_options()).await.unwrap();
    let parent: Option<String> = db::sqlx::query_scalar(
        "select p.title from wiki_pages c join wiki_pages p on p.id = c.parent_id where c.title = 'Соглашения по коду'",
    )
    .fetch_optional(&pool)
    .await
    .unwrap();
    assert_eq!(parent.as_deref(), Some("Разработка"));

    let md: String = db::sqlx::query_scalar("select md from wiki_pages where title = 'Работа с задачами'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(
        md.starts_with("Каждая задача проходит колонки доски слева направо.\n\n1. Новая идея"),
        "строки склеены через \\n"
    );

    let on_page = count(
        &pool,
        "select count(*) from files f join wiki_pages w on w.id = f.wiki_page_id where w.title = 'Разработка'",
    )
    .await;
    assert_eq!(on_page, 2);
    let attached =
        count(&pool, "select count(*) from files f join tasks t on t.id = f.task_id where t.number = 144").await;
    assert_eq!(attached, 1);
    let size: i64 = db::sqlx::query_scalar("select size_bytes from files where name = 'architecture-v2.pdf'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(size, 1_258_291, "1,2 МБ");

    let folders: Vec<String> = db::folders::list(&pool).await.unwrap().into_iter().map(|f| f.name).collect();
    assert_eq!(folders, ["Дизайн", "Договорённости", "Скриншоты", "Вложения"], "папки в порядке макета");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn canvas_arrows_connect_objects_of_the_same_document(pool: PgPool) {
    seed(&pool, &mock_options()).await.unwrap();
    let foreign = count(
        &pool,
        "select count(*) from doc_links l join doc_objects a on a.id = l.a join doc_objects b on b.id = l.b \
         where a.doc_id <> l.doc_id or b.doc_id <> l.doc_id",
    )
    .await;
    assert_eq!(foreign, 0);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn activity_is_ordered_like_the_feed(pool: PgPool) {
    seed(&pool, &mock_options()).await.unwrap();
    let (target, text): (String, String) =
        db::sqlx::query_as("select target, text from activity order by created_at desc limit 1")
            .fetch_one(&pool)
            .await
            .unwrap();
    // в макете «PR #312 влит в main»; приложение «влит» не отмечает, поэтому в сиде событие такое, каким его пишет сервер
    assert_eq!(
        (target.as_str(), text.as_str()),
        ("WEB-137 Неверные часовые пояса в календаре", "добавлен PR #315"),
        "самое свежее событие: «12 минут назад»"
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn seed_on_a_given_day_puts_the_feed_relative_to_noon_of_that_day(pool: PgPool) {
    let day = Date::from_calendar_date(2026, Month::October, 18).unwrap();
    seed(&pool, &SeedOptions::on(day, "dev")).await.unwrap();
    let times: Vec<String> = db::sqlx::query_scalar(
        "select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') from activity order by created_at desc",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        times,
        [
            "2026-10-18 11:48", // 12 минут назад
            "2026-10-18 11:00", // 1 час назад
            "2026-10-18 09:00", // 3 часа назад
            "2026-10-17 18:20", // вчера, 18:20
            "2026-10-17 15:02",
            "2026-10-17 12:10",
            "2026-10-15 11:40", // 15 окт, 11:40
            "2026-10-15 10:05",
        ]
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn seed_refuses_a_non_empty_database_and_changes_nothing(pool: PgPool) {
    seed(&pool, &mock_options()).await.unwrap();
    let err = seed(&pool, &mock_options()).await.unwrap_err();
    assert!(matches!(err, SeedError::NotEmpty), "{err}");
    assert_eq!(count(&pool, "select count(*) from users").await, 5);
    assert_eq!(count(&pool, "select count(*) from tasks").await, 24);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn reset_clears_everything_and_allows_seeding_again(pool: PgPool) {
    seed(&pool, &mock_options()).await.unwrap();
    reset(&pool).await.unwrap();
    for table in ["users", "projects", "tasks", "files", "wiki_pages", "docs", "activity", "links", "release_items"] {
        let sql: &'static str = match table {
            "users" => "select count(*) from users",
            "projects" => "select count(*) from projects",
            "tasks" => "select count(*) from tasks",
            "files" => "select count(*) from files",
            "wiki_pages" => "select count(*) from wiki_pages",
            "docs" => "select count(*) from docs",
            "activity" => "select count(*) from activity",
            "links" => "select count(*) from links",
            _ => "select count(*) from release_items",
        };
        assert_eq!(count(&pool, sql).await, 0, "{table}");
    }
    seed(&pool, &mock_options()).await.unwrap();
    assert_eq!(count(&pool, "select count(*) from tasks").await, 24);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn documents_and_canvas_layers_keep_the_mockup_order(pool: PgPool) {
    seed(&pool, &mock_options()).await.unwrap();
    let titles: Vec<String> =
        db::sqlx::query_scalar("select title from docs order by position").fetch_all(&pool).await.unwrap();
    assert_eq!(titles, ["Схема сервисов", "Планирование Q4", "Идеи по онбордингу", "Заметки со встречи 15 окт"]);

    // слои холста: объекты лежат в том порядке, в каком идут в макете
    let layers: Vec<String> = db::sqlx::query_scalar(
        "select o.text from doc_objects o join docs d on d.id = o.doc_id where d.title = 'Схема сервисов' order by o.seq",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        layers,
        [
            "Схема запросов",
            "Клиент",
            "API-шлюз",
            "Сервис пользователей",
            "Очередь заданий",
            "База данных",
            "Добавить кэш для справочников"
        ]
    );
}
