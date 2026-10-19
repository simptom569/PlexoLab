//! Задачи, перенос, подзадачи, комментарии и запись в ленту активности на настоящем Postgres.

mod common;

use axum::http::{Method, StatusCode};
use common::*;
use db::{
    PgPool,
    seed::{SeedOptions, seed},
};
use serde_json::{Value, json};
use time::{Date, Month, OffsetDateTime, Time, format_description::well_known::Rfc3339};
use uuid::Uuid;

fn task_uri(task: &Value) -> String {
    format!("/api/v1/tasks/{}", id_of(task))
}

async fn count(pool: &PgPool, sql: &'static str, bind: Uuid) -> i64 {
    db::sqlx::query_scalar(sql).bind(bind).fetch_one(pool).await.unwrap()
}

fn timestamp(v: &Value, key: &str) -> OffsetDateTime {
    OffsetDateTime::parse(str_field(v, key), &Rfc3339).unwrap()
}

fn ev(kind: &str, target: &str, text: &str) -> (String, String, String) {
    (kind.to_owned(), target.to_owned(), text.to_owned())
}

// ===== Создание =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn create_task_gets_the_next_number_and_goes_to_the_end(pool: PgPool) {
    let f = Fx::new(pool).await;
    let a = f.task(Some(f.todo), "Первая").await;
    let b = f.task(Some(f.todo), "  Вторая  ").await;
    let backlog = f.task(None, "В бэклог").await;

    assert_eq!((a["key"].as_str(), a["number"].as_i64()), (Some("WEB-1"), Some(1)));
    assert_eq!(b["key"], "WEB-2");
    assert_eq!(b["title"], "Вторая", "пробелы по краям убираются");
    assert_eq!(backlog["key"], "WEB-3", "номер общий для доски и бэклога");
    assert!(backlog["column_id"].is_null());
    assert_eq!(a["column_id"], f.todo.to_string());
    assert!(a["position"].as_f64() < b["position"].as_f64());

    // значения по умолчанию, как у новой задачи в макете
    assert_eq!(
        (a["priority"].as_str(), a["pr"].as_str(), a["description"].as_str()),
        (Some("med"), Some(""), Some(""))
    );
    assert!(a["assignee_id"].is_null() && a["due_date"].is_null() && a["start_date"].is_null());
    assert_eq!(a["created_by"], f.c.user.id.to_string());
    for list in ["tag_ids", "subtasks", "comments", "files"] {
        assert_eq!(a[list], json!([]), "{list}");
    }

    assert_eq!(f.titles(Some(f.todo)).await, ["Первая", "Вторая"]);
    assert_eq!(f.titles(None).await, ["В бэклог"]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn creating_a_task_writes_to_the_activity_feed(pool: PgPool) {
    let f = Fx::new(pool).await;
    f.task(Some(f.todo), "Экспорт отчёта").await;
    assert_eq!(f.activity().await, [ev("create", "WEB-1 Экспорт отчёта", "создана")]);
    let (actor, project): (Uuid, Option<Uuid>) =
        db::sqlx::query_as("select actor_id, project_id from activity").fetch_one(&f.c.pool).await.unwrap();
    assert_eq!((actor, project), (f.c.user.id, Some(f.project)));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn numbers_are_unique_when_many_users_create_tasks_at_once(pool: PgPool) {
    let f = Fx::new(pool).await;
    let uri = format!("/api/v1/projects/{}/tasks", f.project);
    let mut set = tokio::task::JoinSet::new();
    for i in 0..10 {
        let (app, token, uri, column) = (f.c.app.clone(), f.c.token.clone(), uri.clone(), f.todo);
        set.spawn(async move {
            send(&app, Method::POST, &uri, Some(json!({ "title": format!("T{i}"), "column_id": column })), Some(&token))
                .await
        });
    }
    let mut numbers = Vec::new();
    while let Some(reply) = set.join_next().await {
        let reply = reply.unwrap();
        assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.body);
        numbers.push(reply.body["number"].as_i64().unwrap());
    }
    numbers.sort();
    assert_eq!(numbers, (1..=10).collect::<Vec<_>>());
    let mut positions: Vec<f64> =
        f.board().await["tasks"].as_array().unwrap().iter().map(|t| t["position"].as_f64().unwrap()).collect();
    positions.sort_by(f64::total_cmp);
    positions.dedup();
    assert_eq!(positions.len(), 10, "позиции тоже не повторяются");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn create_task_validates_input(pool: PgPool) {
    let f = Fx::new(pool.clone()).await;
    let uri = format!("/api/v1/projects/{}/tasks", f.project);
    let other = make_project(&pool, "API", "Api", "warn").await;
    let foreign = id_of(
        &f.c.ok(
            f.c.post(&format!("/api/v1/projects/{other}/columns"), json!({ "title": "Чужая" })).await,
            StatusCode::CREATED,
        )
        .await,
    );

    for body in [
        json!({ "title": "" }),
        json!({ "title": "   " }),
        json!({ "title": "x".repeat(501) }),
        json!({ "title": "Ок", "unknown": 1 }),
        json!({ "title": "Ок", "column_id": "не-uuid" }),
        json!({ "title": "Ок", "column_id": foreign }),
        json!({ "title": "Ок", "column_id": Uuid::new_v4() }),
        json!({}),
    ] {
        let r = f.c.post(&uri, body.clone()).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{body}: {}", r.body);
        assert_eq!(r.body["code"], "bad_request");
    }
    assert_eq!(
        f.c.post(&format!("/api/v1/projects/{}/tasks", Uuid::new_v4()), json!({ "title": "X" })).await.status,
        StatusCode::NOT_FOUND
    );

    // ошибки не сжигают номера и не оставляют следов
    let t = f.task(Some(f.todo), "Первая").await;
    assert_eq!(t["key"], "WEB-1");
    assert_eq!(f.activity().await.len(), 1);
}

// ===== Чтение =====

async fn seeded(pool: PgPool) -> Ctx {
    let today = Date::from_calendar_date(2026, Month::October, 18).unwrap();
    let options = SeedOptions {
        today,
        now: OffsetDateTime::new_utc(today, Time::from_hms(15, 0, 0).unwrap()),
        password: "dev".into(),
    };
    seed(&pool, &options).await.unwrap();
    let app = app(pool.clone());
    let tokens = login_ok(&app, "lena@example.com", "dev").await;
    let user = db::users::find_by_email(&pool, "lena@example.com").await.unwrap().unwrap();
    Ctx { app, pool, token: str_field(&tokens, "access_token").to_owned(), user, dir: common::TestDir::new() }
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn get_task_returns_everything_for_the_drawer(pool: PgPool) {
    let c = seeded(pool.clone()).await;
    let projects = c.ok(c.get("/api/v1/projects").await, StatusCode::OK).await;
    let board =
        c.ok(c.get(&format!("/api/v1/projects/{}/board", str_field(&projects[0], "id"))).await, StatusCode::OK).await;
    let card = board["tasks"].as_array().unwrap().iter().find(|t| t["key"] == "WEB-144").unwrap();

    let t = c.ok(c.get(&format!("/api/v1/tasks/{}", str_field(card, "id"))).await, StatusCode::OK).await;
    assert_eq!(t["key"], "WEB-144");
    assert_eq!(
        t["description"],
        "Подключить вход через OpenID Connect. Пользователям с корпоративным доменом создавать аккаунт автоматически."
    );
    assert_eq!(t["pr"], "#321");

    let subs: Vec<(&str, bool)> = t["subtasks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| (str_field(s, "title"), s["done"].as_bool().unwrap()))
        .collect();
    assert_eq!(
        subs,
        [
            ("Настроить провайдера", true),
            ("Обработка callback", true),
            ("Привязка к существующим аккаунтам", true),
            ("Страница настроек SSO", false),
            ("Тесты", false)
        ]
    );

    let comments = t["comments"].as_array().unwrap();
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0]["body"], "Callback проверил на стейдже, работает.");
    let author = db::users::find_by_email(&pool, "daniil@example.com").await.unwrap().unwrap();
    assert_eq!(comments[0]["author_id"], author.id.to_string());

    let files = t["files"].as_array().unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(
        (files[0]["name"].as_str(), files[0]["kind"].as_str(), files[0]["size_bytes"].as_i64()),
        (Some("sso-flow.png"), Some("img"), Some(188_416))
    );

    let module = board["modules"].as_array().unwrap().iter().find(|m| m["id"] == t["module_id"]).unwrap();
    let milestone = board["milestones"].as_array().unwrap().iter().find(|m| m["id"] == t["milestone_id"]).unwrap();
    assert_eq!((module["title"].as_str(), milestone["title"].as_str()), (Some("SSO"), Some("Релиз 2.8.0")));
    assert_eq!(t["tag_ids"].as_array().unwrap().len(), 2);
    assert_eq!(
        t["assignee_id"],
        db::users::find_by_email(&pool, "artem@example.com").await.unwrap().unwrap().id.to_string()
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn get_task_errors(pool: PgPool) {
    let c = Ctx::new(pool).await;
    assert_eq!(c.get(&format!("/api/v1/tasks/{}", Uuid::new_v4())).await.status, StatusCode::NOT_FOUND);
    assert_eq!(c.get("/api/v1/tasks/123").await.status, StatusCode::BAD_REQUEST);
}

// ===== Изменение полей =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn update_changes_only_the_given_fields(pool: PgPool) {
    let f = Fx::new(pool).await;
    let t = f.task(Some(f.todo), "Старое").await;
    let uri = task_uri(&t);

    let body = json!({
        "title": "  Новое название ", "description": "Подробности\nв две строки", "priority": "high", "pr": " #321 ",
        "start_date": "2026-10-12", "due_date": "2026-10-23", "assignee_id": f.c.user.id,
    });
    let r = f.c.ok(f.c.patch(&uri, body).await, StatusCode::OK).await;
    assert_eq!(r["title"], "Новое название");
    assert_eq!(r["description"], "Подробности\nв две строки");
    assert_eq!((r["priority"].as_str(), r["pr"].as_str()), (Some("high"), Some("#321")));
    assert_eq!((r["start_date"].as_str(), r["due_date"].as_str()), (Some("2026-10-12"), Some("2026-10-23")));
    assert_eq!(r["assignee_id"], f.c.user.id.to_string());
    assert_eq!(r["key"], "WEB-1", "ключ не меняется");
    assert_eq!(r["column_id"], f.todo.to_string(), "колонка не тронута");

    let r = f.c.ok(f.c.patch(&uri, json!({ "title": "Ещё новее" })).await, StatusCode::OK).await;
    assert_eq!(r["title"], "Ещё новее");
    assert_eq!(
        (r["priority"].as_str(), r["pr"].as_str(), r["due_date"].as_str()),
        (Some("high"), Some("#321"), Some("2026-10-23")),
        "остальное осталось"
    );

    // и то же самое видно при чтении
    let got = f.c.ok(f.c.get(&uri).await, StatusCode::OK).await;
    assert_eq!(got["title"], "Ещё новее");
    assert!(timestamp(&got, "updated_at") > timestamp(&t, "updated_at"));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn null_clears_optional_fields_and_missing_fields_stay(pool: PgPool) {
    let f = Fx::new(pool.clone()).await;
    let module: Uuid =
        db::sqlx::query_scalar("insert into modules (project_id, title) values ($1, 'SSO') returning id")
            .bind(f.project)
            .fetch_one(&pool)
            .await
            .unwrap();
    let milestone: Uuid = db::sqlx::query_scalar(
        "insert into milestones (project_id, title, due_date) values ($1, 'Релиз', '2026-10-23') returning id",
    )
    .bind(f.project)
    .fetch_one(&pool)
    .await
    .unwrap();
    let t = f.task(Some(f.todo), "T").await;
    let uri = task_uri(&t);

    let full = json!({ "assignee_id": f.c.user.id, "start_date": "2026-10-12", "due_date": "2026-10-23", "module_id": module, "milestone_id": milestone });
    let r = f.c.ok(f.c.patch(&uri, full).await, StatusCode::OK).await;
    assert_eq!(
        (r["module_id"].as_str(), r["milestone_id"].as_str()),
        (Some(module.to_string().as_str()), Some(milestone.to_string().as_str()))
    );

    let r = f.c.ok(f.c.patch(&uri, json!({ "assignee_id": null, "due_date": null })).await, StatusCode::OK).await;
    assert!(r["assignee_id"].is_null() && r["due_date"].is_null(), "очищены");
    assert_eq!(r["start_date"], "2026-10-12", "не упомянуты, остались");
    assert_eq!(r["module_id"], module.to_string());

    let r =
        f.c.ok(
            f.c.patch(&uri, json!({ "module_id": null, "milestone_id": null, "start_date": null })).await,
            StatusCode::OK,
        )
        .await;
    assert!(r["module_id"].is_null() && r["milestone_id"].is_null() && r["start_date"].is_null());
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn an_empty_patch_changes_nothing(pool: PgPool) {
    let f = Fx::new(pool).await;
    let t = f.task(Some(f.todo), "T").await;
    let r = f.c.ok(f.c.patch(&task_uri(&t), json!({})).await, StatusCode::OK).await;
    assert_eq!(r, f.c.ok(f.c.get(&task_uri(&t)).await, StatusCode::OK).await);
    assert_eq!(r["updated_at"], t["updated_at"], "без изменений метка времени не двигается");
    assert_eq!(f.activity().await.len(), 1, "только создание");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn update_validates_values(pool: PgPool) {
    let f = Fx::new(pool).await;
    let t = f.task(Some(f.todo), "T").await;
    let uri = task_uri(&t);
    for body in [
        json!({ "title": "" }),
        json!({ "title": "  " }),
        json!({ "title": "x".repeat(501) }),
        json!({ "description": "x".repeat(20_001) }),
        json!({ "pr": "x".repeat(101) }),
        json!({ "priority": "urgent" }),
        json!({ "priority": "" }),
        json!({ "due_date": "22.10.2026" }),
        json!({ "start_date": "2026-02-30" }),
        json!({ "due_date": 20261022 }),
        json!({ "assignee_id": "не-uuid" }),
        json!({ "unknown_field": 1 }),
        json!({ "column_id": 5 }),
    ] {
        let r = f.c.patch(&uri, body.clone()).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{body}: {}", r.body);
        assert_eq!(r.body["code"], "bad_request");
    }
    assert_eq!(
        f.c.patch(&format!("/api/v1/tasks/{}", Uuid::new_v4()), json!({ "title": "X" })).await.status,
        StatusCode::NOT_FOUND
    );
    let got = f.c.ok(f.c.get(&uri).await, StatusCode::OK).await;
    assert_eq!(got["title"], "T", "ничего не изменилось");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn assignee_module_and_milestone_must_exist_in_the_right_place(pool: PgPool) {
    let f = Fx::new(pool.clone()).await;
    let other = make_project(&pool, "API", "Api", "warn").await;
    let foreign_module: Uuid =
        db::sqlx::query_scalar("insert into modules (project_id, title) values ($1, 'Чужой') returning id")
            .bind(other)
            .fetch_one(&pool)
            .await
            .unwrap();
    let foreign_milestone: Uuid = db::sqlx::query_scalar(
        "insert into milestones (project_id, title, due_date) values ($1, 'Чужая', '2026-11-01') returning id",
    )
    .bind(other)
    .fetch_one(&pool)
    .await
    .unwrap();
    let t = f.task(Some(f.todo), "T").await;
    let uri = task_uri(&t);

    for body in [
        json!({ "module_id": foreign_module }),
        json!({ "module_id": Uuid::new_v4() }),
        json!({ "milestone_id": foreign_milestone }),
        json!({ "milestone_id": Uuid::new_v4() }),
        json!({ "assignee_id": Uuid::new_v4() }),
    ] {
        let r = f.c.patch(&uri, body.clone()).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{body}: {}", r.body);
    }
    // после ошибок соединение и задача в порядке
    f.c.ok(f.c.patch(&uri, json!({ "title": "ещё работает" })).await, StatusCode::OK).await;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn tags_are_set_as_a_whole_in_creation_order(pool: PgPool) {
    let f = Fx::new(pool).await;
    let mut tags = Vec::new();
    for label in ["A", "B", "C"] {
        tags.push(id_of(&f.c.ok(f.c.post("/api/v1/tags", json!({ "label": label })).await, StatusCode::CREATED).await));
    }
    let t = f.task(Some(f.todo), "T").await;
    let uri = task_uri(&t);

    let r = f.c.ok(f.c.patch(&uri, json!({ "tag_ids": [tags[2], tags[0], tags[0]] })).await, StatusCode::OK).await;
    assert_eq!(r["tag_ids"], json!([tags[0], tags[2]]), "порядок создания меток, дубли убраны");
    let card = f.board().await["tasks"][0].clone();
    assert_eq!(card["tag_ids"], r["tag_ids"], "на карточке доски то же");

    let r = f.c.ok(f.c.patch(&uri, json!({ "tag_ids": [tags[1]] })).await, StatusCode::OK).await;
    assert_eq!(r["tag_ids"], json!([tags[1]]), "набор заменяется целиком");

    let bad = f.c.patch(&uri, json!({ "tag_ids": [tags[0], Uuid::new_v4()] })).await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        f.c.ok(f.c.get(&uri).await, StatusCode::OK).await["tag_ids"],
        json!([tags[1]]),
        "после ошибки набор прежний"
    );

    let r = f.c.ok(f.c.patch(&uri, json!({ "tag_ids": [] })).await, StatusCode::OK).await;
    assert_eq!(r["tag_ids"], json!([]));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn removing_a_tag_removes_it_from_tasks(pool: PgPool) {
    let f = Fx::new(pool).await;
    let tag = id_of(&f.c.ok(f.c.post("/api/v1/tags", json!({ "label": "Баг" })).await, StatusCode::CREATED).await);
    let t = f.task(Some(f.todo), "T").await;
    f.c.ok(f.c.patch(&task_uri(&t), json!({ "tag_ids": [tag] })).await, StatusCode::OK).await;
    assert_eq!(f.c.delete(&format!("/api/v1/tags/{tag}")).await.status, StatusCode::NO_CONTENT);
    assert_eq!(f.c.ok(f.c.get(&task_uri(&t)).await, StatusCode::OK).await["tag_ids"], json!([]));
}

// ===== Перенос =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn moving_to_another_column_appends_to_the_end_and_is_logged(pool: PgPool) {
    let f = Fx::new(pool).await;
    let a1 = f.task(Some(f.todo), "a1").await;
    f.task(Some(f.todo), "a2").await;
    f.task(Some(f.doing), "d1").await;

    let r = f.c.ok(f.c.patch(&task_uri(&a1), json!({ "column_id": f.doing })).await, StatusCode::OK).await;
    assert_eq!(r["column_id"], f.doing.to_string());
    assert_eq!(f.titles(Some(f.doing)).await, ["d1", "a1"]);
    assert_eq!(f.titles(Some(f.todo)).await, ["a2"]);
    assert_eq!(
        f.activity().await.last(),
        Some(&ev("move", "WEB-1 a1", "перемещена в «В работе»")),
        "перенос между колонками попадает в ленту"
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn before_id_places_the_task_exactly(pool: PgPool) {
    let f = Fx::new(pool).await;
    let a = f.task(Some(f.todo), "a").await;
    f.task(Some(f.todo), "b").await;
    let c = f.task(Some(f.todo), "c").await;
    let d = f.task(Some(f.doing), "d").await;
    f.task(Some(f.doing), "e").await;

    f.c.ok(f.c.patch(&task_uri(&c), json!({ "before_id": id_of(&a) })).await, StatusCode::OK).await;
    assert_eq!(f.titles(Some(f.todo)).await, ["c", "a", "b"], "перед первой, колонка не указана: остаётся своя");

    f.c.ok(f.c.patch(&task_uri(&a), json!({ "column_id": f.doing, "before_id": id_of(&d) })).await, StatusCode::OK)
        .await;
    assert_eq!(f.titles(Some(f.doing)).await, ["a", "d", "e"], "в другую колонку, перед первой");
    assert_eq!(f.titles(Some(f.todo)).await, ["c", "b"]);

    let b = f.board().await["tasks"].as_array().unwrap().iter().find(|t| t["title"] == "b").unwrap().clone();
    f.c.ok(f.c.patch(&task_uri(&b), json!({ "column_id": f.doing, "before_id": id_of(&d) })).await, StatusCode::OK)
        .await;
    assert_eq!(f.titles(Some(f.doing)).await, ["a", "b", "d", "e"], "в середину");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn before_id_null_moves_to_the_end_of_the_same_column(pool: PgPool) {
    let f = Fx::new(pool).await;
    let a = f.task(Some(f.todo), "a").await;
    f.task(Some(f.todo), "b").await;
    f.task(Some(f.todo), "c").await;
    f.c.ok(f.c.patch(&task_uri(&a), json!({ "column_id": f.todo, "before_id": null })).await, StatusCode::OK).await;
    assert_eq!(f.titles(Some(f.todo)).await, ["b", "c", "a"]);
    let b = f.board().await["tasks"][0].clone();
    f.c.ok(f.c.patch(&task_uri(&b), json!({ "before_id": null })).await, StatusCode::OK).await;
    assert_eq!(f.titles(Some(f.todo)).await, ["c", "a", "b"], "и без column_id");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn the_same_column_without_before_id_is_not_a_move(pool: PgPool) {
    let f = Fx::new(pool).await;
    let a = f.task(Some(f.todo), "a").await;
    f.task(Some(f.todo), "b").await;
    let r = f.c.ok(f.c.patch(&task_uri(&a), json!({ "column_id": f.todo })).await, StatusCode::OK).await;
    assert_eq!(r["position"], a["position"]);
    assert_eq!(f.titles(Some(f.todo)).await, ["a", "b"]);
    assert_eq!(f.activity().await.len(), 2, "ни переноса, ни записи в ленте");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn moving_inside_a_column_is_not_logged_but_moving_between_columns_is(pool: PgPool) {
    let f = Fx::new(pool).await;
    let a = f.task(Some(f.todo), "a").await;
    let b = f.task(Some(f.todo), "b").await;
    f.c.ok(f.c.patch(&task_uri(&b), json!({ "before_id": id_of(&a) })).await, StatusCode::OK).await;
    assert_eq!(f.titles(Some(f.todo)).await, ["b", "a"]);
    let kinds: Vec<String> = f.activity().await.into_iter().map(|e| e.0).collect();
    assert_eq!(kinds, ["create", "create"], "порядок внутри колонки в ленту не попадает");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_task_can_go_to_the_backlog_and_back(pool: PgPool) {
    let f = Fx::new(pool).await;
    let a = f.task(Some(f.todo), "a").await;
    f.task(None, "z").await;

    let r = f.c.ok(f.c.patch(&task_uri(&a), json!({ "column_id": null })).await, StatusCode::OK).await;
    assert!(r["column_id"].is_null());
    assert_eq!(f.titles(None).await, ["z", "a"]);
    assert!(f.titles(Some(f.todo)).await.is_empty());
    assert_eq!(f.activity().await.last(), Some(&ev("move", "WEB-1 a", "перемещена в «Бэклог»")));

    f.c.ok(f.c.patch(&task_uri(&a), json!({ "column_id": f.todo })).await, StatusCode::OK).await;
    assert_eq!(f.titles(Some(f.todo)).await, ["a"]);
    assert_eq!(f.activity().await.last(), Some(&ev("move", "WEB-1 a", "перемещена в «К выполнению»")));

    // порядок внутри бэклога
    let z = f.board().await["tasks"].as_array().unwrap().iter().find(|t| t["title"] == "z").unwrap().clone();
    f.task(None, "y").await;
    f.c.ok(f.c.patch(&task_uri(&z), json!({ "before_id": null })).await, StatusCode::OK).await;
    assert_eq!(f.titles(None).await, ["y", "z"]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn bad_moves_are_rejected_and_change_nothing(pool: PgPool) {
    let f = Fx::new(pool.clone()).await;
    let a = f.task(Some(f.todo), "a").await;
    let d = f.task(Some(f.doing), "d").await;
    let other = make_project(&pool, "API", "Api", "warn").await;
    let foreign = id_of(
        &f.c.ok(
            f.c.post(&format!("/api/v1/projects/{other}/columns"), json!({ "title": "Чужая" })).await,
            StatusCode::CREATED,
        )
        .await,
    );
    let before = f.activity().await.len();

    for body in [
        json!({ "before_id": id_of(&d) }),                         // d лежит в другой колонке
        json!({ "before_id": Uuid::new_v4() }),                    // такой задачи нет
        json!({ "before_id": id_of(&a) }),                         // сама на себя
        json!({ "column_id": foreign }),                           // колонка чужого проекта
        json!({ "column_id": Uuid::new_v4() }),                    // колонки нет
        json!({ "column_id": f.doing, "before_id": id_of(&a) }),   // перед задачей из старой колонки
        json!({ "column_id": null, "before_id": id_of(&d) }),      // в бэклог перед задачей с доски
        json!({ "title": "переименована", "column_id": foreign }), // часть полей верная, перенос нет
    ] {
        let r = f.c.patch(&task_uri(&a), body.clone()).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{body}: {}", r.body);
    }
    assert_eq!(f.titles(Some(f.todo)).await, ["a"]);
    assert_eq!(f.titles(Some(f.doing)).await, ["d"]);
    assert_eq!(f.activity().await.len(), before, "в ленту ничего не попало");
    assert_eq!(
        f.c.ok(f.c.get(&task_uri(&a)).await, StatusCode::OK).await["title"],
        "a",
        "и переименование откатилось вместе с ошибкой"
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn editing_and_moving_in_one_request_applies_both(pool: PgPool) {
    let f = Fx::new(pool).await;
    let a = f.task(Some(f.todo), "Старое").await;
    let r =
        f.c.ok(
            f.c.patch(&task_uri(&a), json!({ "title": "Новое", "priority": "low", "column_id": f.done })).await,
            StatusCode::OK,
        )
        .await;
    assert_eq!(
        (r["title"].as_str(), r["priority"].as_str(), r["column_id"].as_str()),
        (Some("Новое"), Some("low"), Some(f.done.to_string().as_str()))
    );
    assert_eq!(
        f.activity().await.last(),
        Some(&ev("move", "WEB-1 Новое", "перемещена в «Готово»")),
        "в ленте новое название"
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn positions_are_recalculated_when_the_gap_is_used_up(pool: PgPool) {
    let f = Fx::new(pool.clone()).await;
    let first = f.task(Some(f.todo), "first").await;
    let second = f.task(Some(f.todo), "second").await;
    let third = f.task(Some(f.todo), "third").await;
    let moved = f.task(Some(f.todo), "moved").await;
    for (t, p) in [(&first, 1.0), (&second, 1.0000015), (&third, 5.0)] {
        db::sqlx::query("update tasks set position = $2 where id = $1")
            .bind(id_of(t))
            .bind(p)
            .execute(&pool)
            .await
            .unwrap();
    }

    f.c.ok(f.c.patch(&task_uri(&moved), json!({ "before_id": id_of(&second) })).await, StatusCode::OK).await;

    assert_eq!(f.titles(Some(f.todo)).await, ["first", "moved", "second", "third"]);
    let positions: Vec<f64> =
        f.board().await["tasks"].as_array().unwrap().iter().map(|t| t["position"].as_f64().unwrap()).collect();
    assert_eq!(positions, [1024.0, 2048.0, 3072.0, 4096.0], "пересчитано целыми числами с шагом 1024");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn many_drops_into_the_same_gap_never_break_the_order(pool: PgPool) {
    let f = Fx::new(pool).await;
    f.task(Some(f.todo), "head").await;
    let tail = f.task(Some(f.todo), "tail").await;
    let mut expected = vec!["head".to_owned()];
    for i in 0..45 {
        let title = format!("n{i:02}");
        let t = f.task(Some(f.todo), &title).await;
        f.c.ok(f.c.patch(&task_uri(&t), json!({ "before_id": id_of(&tail) })).await, StatusCode::OK).await;
        expected.push(title);
    }
    expected.push("tail".to_owned());
    assert_eq!(f.titles(Some(f.todo)).await, expected);
    let positions: Vec<f64> =
        f.board().await["tasks"].as_array().unwrap().iter().map(|t| t["position"].as_f64().unwrap()).collect();
    assert!(positions.windows(2).all(|w| w[0] < w[1]));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn two_users_moving_cards_at_once_do_not_lose_or_duplicate_anything(pool: PgPool) {
    let f = Fx::new(pool).await;
    let mut tasks = Vec::new();
    for i in 0..8 {
        tasks.push(f.task(Some(f.todo), &format!("t{i}")).await);
    }
    let mut set = tokio::task::JoinSet::new();
    for (i, t) in tasks.iter().enumerate() {
        let (app, token, uri) = (f.c.app.clone(), f.c.token.clone(), task_uri(t));
        let column = if i % 2 == 0 { f.doing } else { f.done };
        set.spawn(
            async move { send(&app, Method::PATCH, &uri, Some(json!({ "column_id": column })), Some(&token)).await },
        );
    }
    while let Some(r) = set.join_next().await {
        let r = r.unwrap();
        assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    }
    let (doing, done) = (f.titles(Some(f.doing)).await, f.titles(Some(f.done)).await);
    assert_eq!((doing.len(), done.len()), (4, 4));
    assert!(f.titles(Some(f.todo)).await.is_empty());
    let mut positions: Vec<f64> = f.board().await["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|t| t["column_id"] == f.doing.to_string())
        .map(|t| t["position"].as_f64().unwrap())
        .collect();
    positions.sort_by(f64::total_cmp);
    positions.dedup();
    assert_eq!(positions.len(), 4, "позиции в колонке не повторяются");
}

// ===== Лента активности =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn setting_a_pr_logs_a_code_event_only_when_it_changes(pool: PgPool) {
    let f = Fx::new(pool).await;
    let t = f.task(Some(f.todo), "SSO").await;
    let uri = task_uri(&t);

    f.c.ok(f.c.patch(&uri, json!({ "pr": "#321" })).await, StatusCode::OK).await;
    assert_eq!(f.activity().await.last(), Some(&ev("code", "WEB-1 SSO", "добавлен PR #321")));
    f.c.ok(f.c.patch(&uri, json!({ "pr": "#321" })).await, StatusCode::OK).await;
    f.c.ok(f.c.patch(&uri, json!({ "pr": " #321 " })).await, StatusCode::OK).await;
    assert_eq!(f.activity().await.len(), 2, "тот же PR повторно не пишется");
    f.c.ok(f.c.patch(&uri, json!({ "pr": "#322" })).await, StatusCode::OK).await;
    assert_eq!(f.activity().await.last(), Some(&ev("code", "WEB-1 SSO", "добавлен PR #322")));
    f.c.ok(f.c.patch(&uri, json!({ "pr": "" })).await, StatusCode::OK).await;
    assert_eq!(f.activity().await.len(), 3, "очистка PR в ленту не попадает");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn ordinary_edits_are_not_logged(pool: PgPool) {
    let f = Fx::new(pool).await;
    let t = f.task(Some(f.todo), "T").await;
    f.c.ok(
        f.c.patch(
            &task_uri(&t),
            json!({ "title": "Другое", "description": "d", "priority": "high", "due_date": "2026-10-22" }),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(f.activity().await, [ev("create", "WEB-1 T", "создана")]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn deleting_a_task_logs_it_and_removes_everything_attached(pool: PgPool) {
    let f = Fx::new(pool.clone()).await;
    let tag = id_of(&f.c.ok(f.c.post("/api/v1/tags", json!({ "label": "Баг" })).await, StatusCode::CREATED).await);
    let t = f.task(Some(f.todo), "Лишняя").await;
    let id = id_of(&t);
    f.c.ok(f.c.patch(&task_uri(&t), json!({ "tag_ids": [tag] })).await, StatusCode::OK).await;
    f.c.ok(f.c.post(&format!("{}/subtasks", task_uri(&t)), json!({ "title": "s" })).await, StatusCode::CREATED).await;
    f.c.ok(f.c.post(&format!("{}/comments", task_uri(&t)), json!({ "body": "c" })).await, StatusCode::CREATED).await;

    assert_eq!(f.c.delete(&task_uri(&t)).await.status, StatusCode::NO_CONTENT);
    assert_eq!(f.c.get(&task_uri(&t)).await.status, StatusCode::NOT_FOUND);
    assert!(f.titles(Some(f.todo)).await.is_empty());
    for sql in [
        "select count(*) from subtasks where task_id = $1",
        "select count(*) from comments where task_id = $1",
        "select count(*) from task_tags where task_id = $1",
    ] {
        assert_eq!(count(&pool, sql, id).await, 0, "{sql}");
    }
    assert_eq!(f.activity().await.last(), Some(&ev("delete", "WEB-1 Лишняя", "удалена")));
    assert_eq!(f.task(Some(f.todo), "Следующая").await["key"], "WEB-2", "номер удалённой задачи не выдаётся снова");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn delete_task_errors(pool: PgPool) {
    let c = Ctx::new(pool).await;
    assert_eq!(c.delete(&format!("/api/v1/tasks/{}", Uuid::new_v4())).await.status, StatusCode::NOT_FOUND);
    assert_eq!(c.delete("/api/v1/tasks/x").await.status, StatusCode::BAD_REQUEST);
}

// ===== Подзадачи =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn subtasks_are_added_toggled_renamed_and_removed(pool: PgPool) {
    let f = Fx::new(pool).await;
    let t = f.task(Some(f.todo), "T").await;
    let uri = format!("{}/subtasks", task_uri(&t));

    let one = f.c.ok(f.c.post(&uri, json!({ "title": "  один " })).await, StatusCode::CREATED).await;
    let two = f.c.ok(f.c.post(&uri, json!({ "title": "два" })).await, StatusCode::CREATED).await;
    assert_eq!((one["title"].as_str(), one["done"].as_bool()), (Some("один"), Some(false)));
    assert!(one["position"].as_f64() < two["position"].as_f64());

    let r =
        f.c.ok(f.c.patch(&format!("/api/v1/subtasks/{}", id_of(&one)), json!({ "done": true })).await, StatusCode::OK)
            .await;
    assert_eq!((r["title"].as_str(), r["done"].as_bool()), (Some("один"), Some(true)), "название не тронуто");
    let r =
        f.c.ok(
            f.c.patch(&format!("/api/v1/subtasks/{}", id_of(&one)), json!({ "title": " Первый " })).await,
            StatusCode::OK,
        )
        .await;
    assert_eq!((r["title"].as_str(), r["done"].as_bool()), (Some("Первый"), Some(true)), "отметка осталась");

    let card = f.board().await["tasks"][0].clone();
    assert_eq!(
        (card["subtasks_done"].as_i64(), card["subtasks_total"].as_i64()),
        (Some(1), Some(2)),
        "счётчики на карточке доски"
    );
    let detail = f.c.ok(f.c.get(&task_uri(&t)).await, StatusCode::OK).await;
    let titles: Vec<&str> = detail["subtasks"].as_array().unwrap().iter().map(|s| str_field(s, "title")).collect();
    assert_eq!(titles, ["Первый", "два"]);
    assert!(timestamp(&detail, "updated_at") > timestamp(&t, "updated_at"), "изменение подзадач двигает updated_at");

    assert_eq!(f.c.delete(&format!("/api/v1/subtasks/{}", id_of(&one))).await.status, StatusCode::NO_CONTENT);
    let card = f.board().await["tasks"][0].clone();
    assert_eq!((card["subtasks_done"].as_i64(), card["subtasks_total"].as_i64()), (Some(0), Some(1)));
    assert_eq!(f.activity().await.len(), 1, "подзадачи в ленту не пишутся");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn subtask_errors(pool: PgPool) {
    let f = Fx::new(pool).await;
    let t = f.task(Some(f.todo), "T").await;
    let uri = format!("{}/subtasks", task_uri(&t));
    for body in [
        json!({ "title": "" }),
        json!({ "title": "  " }),
        json!({ "title": "x".repeat(501) }),
        json!({}),
        json!({ "title": "a", "done": true }),
    ] {
        assert_eq!(f.c.post(&uri, body.clone()).await.status, StatusCode::BAD_REQUEST, "{body}");
    }
    assert_eq!(
        f.c.post(&format!("/api/v1/tasks/{}/subtasks", Uuid::new_v4()), json!({ "title": "x" })).await.status,
        StatusCode::NOT_FOUND
    );

    let s = f.c.ok(f.c.post(&uri, json!({ "title": "ok" })).await, StatusCode::CREATED).await;
    let sub_uri = format!("/api/v1/subtasks/{}", id_of(&s));
    for body in [json!({ "title": "" }), json!({ "done": "yes" }), json!({ "bogus": 1 })] {
        assert_eq!(f.c.patch(&sub_uri, body.clone()).await.status, StatusCode::BAD_REQUEST, "{body}");
    }
    let missing = format!("/api/v1/subtasks/{}", Uuid::new_v4());
    assert_eq!(f.c.patch(&missing, json!({ "done": true })).await.status, StatusCode::NOT_FOUND);
    assert_eq!(f.c.delete(&missing).await.status, StatusCode::NOT_FOUND);
}

// ===== Комментарии =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn comments_are_added_by_the_current_user_and_logged(pool: PgPool) {
    let f = Fx::new(pool).await;
    let t = f.task(Some(f.todo), "Тёмная тема").await;
    let uri = format!("{}/comments", task_uri(&t));

    let first =
        f.c.ok(f.c.post(&uri, json!({ "body": "  Первый комментарий\nс переносом  " })).await, StatusCode::CREATED)
            .await;
    assert_eq!(first["body"], "Первый комментарий\nс переносом");
    assert_eq!(first["author_id"], f.c.user.id.to_string());
    assert!(OffsetDateTime::parse(str_field(&first, "created_at"), &Rfc3339).is_ok());
    f.c.ok(f.c.post(&uri, json!({ "body": "Второй" })).await, StatusCode::CREATED).await;

    let detail = f.c.ok(f.c.get(&task_uri(&t)).await, StatusCode::OK).await;
    let bodies: Vec<&str> = detail["comments"].as_array().unwrap().iter().map(|c| str_field(c, "body")).collect();
    assert_eq!(bodies, ["Первый комментарий\nс переносом", "Второй"], "по порядку добавления");

    let events = f.activity().await;
    assert_eq!(
        events[1..],
        [
            ev("comment", "WEB-1 Тёмная тема", "новый комментарий"),
            ev("comment", "WEB-1 Тёмная тема", "новый комментарий")
        ]
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn comment_errors(pool: PgPool) {
    let f = Fx::new(pool).await;
    let t = f.task(Some(f.todo), "T").await;
    let uri = format!("{}/comments", task_uri(&t));
    for body in [
        json!({ "body": "" }),
        json!({ "body": "   \n " }),
        json!({ "body": "x".repeat(5001) }),
        json!({}),
        json!({ "body": "a", "author_id": Uuid::new_v4() }),
    ] {
        assert_eq!(f.c.post(&uri, body.clone()).await.status, StatusCode::BAD_REQUEST, "{body}");
    }
    assert_eq!(
        f.c.post(&format!("/api/v1/tasks/{}/comments", Uuid::new_v4()), json!({ "body": "x" })).await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(f.activity().await.len(), 1, "ошибки в ленту не попадают");
}
