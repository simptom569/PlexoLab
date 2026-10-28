//! Проекты, данные доски, колонки и метки на настоящем Postgres.

mod common;

use axum::http::StatusCode;
use common::*;
use db::{
    PgPool,
    seed::{SeedOptions, seed},
};
use serde_json::{Value, json};
use time::{Date, Month, OffsetDateTime, Time};
use uuid::Uuid;

fn titles(v: &Value, key: &str) -> Vec<String> {
    v[key].as_array().unwrap().iter().map(|x| str_field(x, "title").to_owned()).collect()
}

async fn seeded(pool: PgPool) -> Ctx {
    let today = Date::from_calendar_date(2026, Month::October, 18).unwrap();
    let options = SeedOptions {
        today,
        now: OffsetDateTime::new_utc(today, Time::from_hms(15, 0, 0).unwrap()),
        password: "dev".into(),
    };
    seed(&pool, &options).await.unwrap();
    let (app, events) = app_and_events(pool.clone());
    let tokens = login_ok(&app, "lena@example.com", "dev").await;
    let user = db::users::find_by_email(&pool, "lena@example.com").await.unwrap().unwrap();
    let team: uuid::Uuid = db::sqlx::query_scalar("select id from teams where name = 'Рабочее пространство'").fetch_one(&pool).await.unwrap();
    Ctx { app, events, pool, token: str_field(&tokens, "access_token").to_owned(), user, team, dir: common::TestDir::new() }
}

// ===== Проекты и доска =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn projects_come_in_creation_order(pool: PgPool) {
    let c = Ctx::new(pool.clone()).await;
    for (key, name, color) in
        [("WEB", "Web-приложение", "accent"), ("API", "Мобильный API", "warn"), ("INF", "Инфраструктура", "ok")]
    {
        make_project(&pool, key, name, color).await;
    }
    let body = c.ok(c.get("/api/v1/projects").await, StatusCode::OK).await;
    let keys: Vec<&str> = body.as_array().unwrap().iter().map(|p| str_field(p, "key")).collect();
    assert_eq!(keys, ["WEB", "API", "INF"], "порядок как в боковом меню, а не по алфавиту");
    assert_eq!(body[0]["color"], "accent");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn board_matches_the_mockup_data(pool: PgPool) {
    let c = seeded(pool).await;
    let projects = c.ok(c.get("/api/v1/projects").await, StatusCode::OK).await;
    let web = str_field(&projects[0], "id").to_owned();
    assert_eq!(projects[0]["key"], "WEB");

    let board = c.ok(c.get(&format!("/api/v1/projects/{web}/board")).await, StatusCode::OK).await;
    assert_eq!(board["project"]["name"], "Web-приложение");
    assert_eq!(titles(&board, "columns"), ["К выполнению", "В работе", "На ревью", "Готово"]);
    assert_eq!(board["columns"][3]["is_done"], true);
    assert_eq!(
        titles_of_labels(&board["tags"]),
        ["Баг", "Фича", "Техдолг", "Фронт", "Бэк", "Срочно", "Нужен дизайн"],
        "в порядке создания"
    );
    assert_eq!(titles(&board, "modules"), ["SSO", "Уведомления", "Тёмная тема", "Надёжность"]);
    assert_eq!(titles(&board, "milestones"), ["Релиз 2.8.0", "Бета для сотрудников", "Релиз 2.9.0"]);

    let tasks = board["tasks"].as_array().unwrap();
    let on_board = tasks.iter().filter(|t| !t["column_id"].is_null()).count();
    assert_eq!((on_board, tasks.len() - on_board), (12, 5), "«12 задач на доске · 5 в бэклоге»");

    let task = |key: &str| tasks.iter().find(|t| t["key"] == key).unwrap_or_else(|| panic!("нет {key}"));
    let sso = task("WEB-144");
    assert_eq!(sso["title"], "Вход через SSO для корпоративных аккаунтов");
    assert_eq!((sso["subtasks_done"].as_i64(), sso["subtasks_total"].as_i64()), (Some(3), Some(5)));
    assert_eq!((sso["priority"].as_str(), sso["pr"].as_str()), (Some("high"), Some("#321")));
    assert_eq!((sso["start_date"].as_str(), sso["due_date"].as_str()), (Some("2026-10-12"), Some("2026-10-23")));
    assert_eq!(sso["number"], 144);
    assert!(sso.get("description").is_none(), "описание в карточки доски не входит");

    // метки в порядке создания меток: Фича, Фронт, Нужен дизайн
    let tag_labels: Vec<String> = task("WEB-141")["tag_ids"]
        .as_array()
        .unwrap()
        .iter()
        .map(|id| {
            board["tags"]
                .as_array()
                .unwrap()
                .iter()
                .find(|t| t["id"] == *id)
                .map(|t| str_field(t, "label").to_owned())
                .unwrap()
        })
        .collect();
    assert_eq!(tag_labels, ["Фича", "Фронт", "Нужен дизайн"]);

    assert!(task("WEB-154")["column_id"].is_null(), "бэклог: column_id = null");
    assert!(task("WEB-149")["start_date"].is_null());

    // порядок внутри колонки как на доске макета
    let todo = str_field(&board["columns"][0], "id");
    let in_todo: Vec<&str> = tasks.iter().filter(|t| t["column_id"] == todo).map(|t| str_field(t, "key")).collect();
    assert_eq!(in_todo, ["WEB-151", "WEB-149", "WEB-153"]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn other_projects_have_their_own_boards(pool: PgPool) {
    let c = seeded(pool).await;
    let projects = c.ok(c.get("/api/v1/projects").await, StatusCode::OK).await;
    let api = str_field(&projects[1], "id");
    let board = c.ok(c.get(&format!("/api/v1/projects/{api}/board")).await, StatusCode::OK).await;
    assert_eq!(board["project"]["key"], "API");
    let keys: Vec<&str> = board["tasks"].as_array().unwrap().iter().map(|t| str_field(t, "key")).collect();
    assert_eq!(keys.len(), 4);
    assert!(keys.iter().all(|k| k.starts_with("API-")));
    assert_eq!(titles(&board, "modules"), ["API v2"]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn board_errors(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let r = c.get(&format!("/api/v1/projects/{}/board", Uuid::new_v4())).await;
    assert_eq!((r.status, r.body["code"].as_str()), (StatusCode::NOT_FOUND, Some("not_found")));
    let r = c.get("/api/v1/projects/not-a-uuid/board").await;
    assert_eq!((r.status, r.body["code"].as_str()), (StatusCode::BAD_REQUEST, Some("bad_request")));
    let r = get(&c.app, &format!("/api/v1/projects/{}/board", Uuid::new_v4()), None).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
}

// ===== Колонки =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn create_column_appends_to_the_end_with_cycling_color(pool: PgPool) {
    let c = Ctx::new(pool.clone()).await;
    let project = make_project(&pool, "WEB", "Web", "accent").await;
    let uri = format!("/api/v1/projects/{project}/columns");

    let first = c.ok(c.post(&uri, json!({ "title": "  К выполнению  " })).await, StatusCode::CREATED).await;
    assert_eq!(first["title"], "К выполнению", "пробелы по краям убираются");
    assert_eq!((first["color"].as_str(), first["is_done"].as_bool()), (Some("muted"), Some(false)));
    assert_eq!(first["project_id"], project.to_string());
    let second = c.ok(c.post(&uri, json!({ "title": "В работе" })).await, StatusCode::CREATED).await;
    assert_eq!(second["color"], "accent", "цвет по кругу");
    let third = c
        .ok(c.post(&uri, json!({ "title": "Готово", "color": "ok", "is_done": true })).await, StatusCode::CREATED)
        .await;
    assert_eq!((third["color"].as_str(), third["is_done"].as_bool()), (Some("ok"), Some(true)));
    assert!(
        first["position"].as_f64() < second["position"].as_f64()
            && second["position"].as_f64() < third["position"].as_f64()
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn create_column_validates_input(pool: PgPool) {
    let c = Ctx::new(pool.clone()).await;
    let project = make_project(&pool, "WEB", "Web", "accent").await;
    let uri = format!("/api/v1/projects/{project}/columns");
    for body in [
        json!({ "title": "" }),
        json!({ "title": "   " }),
        json!({ "title": "x".repeat(101) }),
        json!({ "title": "Ок", "color": "red" }),
        json!({ "title": "Ок", "unknown": 1 }),
        json!({}),
    ] {
        let r = c.post(&uri, body.clone()).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(r.body["code"], "bad_request");
    }
    let r = c.post(&format!("/api/v1/projects/{}/columns", Uuid::new_v4()), json!({ "title": "X" })).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn update_column_renames_recolors_and_marks_done(pool: PgPool) {
    let f = Fx::new(pool).await;
    let uri = format!("/api/v1/columns/{}", f.doing);
    let r = f.c.ok(f.c.patch(&uri, json!({ "title": " Новое имя " })).await, StatusCode::OK).await;
    // вторая колонка при создании получила цвет по кругу, он не меняется
    assert_eq!(
        (r["title"].as_str(), r["color"].as_str(), r["is_done"].as_bool()),
        (Some("Новое имя"), Some("accent"), Some(false))
    );
    let r = f.c.ok(f.c.patch(&uri, json!({ "color": "warn", "is_done": true })).await, StatusCode::OK).await;
    assert_eq!(
        (r["title"].as_str(), r["color"].as_str(), r["is_done"].as_bool()),
        (Some("Новое имя"), Some("warn"), Some(true))
    );

    for body in [json!({ "title": "" }), json!({ "color": "pink" }), json!({ "oops": true })] {
        assert_eq!(f.c.patch(&uri, body).await.status, StatusCode::BAD_REQUEST);
    }
    assert_eq!(
        f.c.patch(&format!("/api/v1/columns/{}", Uuid::new_v4()), json!({ "title": "X" })).await.status,
        StatusCode::NOT_FOUND
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn update_column_reorders_with_before_id(pool: PgPool) {
    let f = Fx::new(pool).await;
    async fn order(f: &Fx) -> Vec<String> {
        titles(&f.board().await, "columns")
    }
    assert_eq!(order(&f).await, ["К выполнению", "В работе", "Готово"]);

    f.c.ok(f.c.patch(&format!("/api/v1/columns/{}", f.done), json!({ "before_id": f.todo })).await, StatusCode::OK)
        .await;
    assert_eq!(order(&f).await, ["Готово", "К выполнению", "В работе"], "перед первой");
    f.c.ok(f.c.patch(&format!("/api/v1/columns/{}", f.done), json!({ "before_id": null })).await, StatusCode::OK).await;
    assert_eq!(order(&f).await, ["К выполнению", "В работе", "Готово"], "null: в конец");
    f.c.ok(f.c.patch(&format!("/api/v1/columns/{}", f.done), json!({ "before_id": f.doing })).await, StatusCode::OK)
        .await;
    assert_eq!(order(&f).await, ["К выполнению", "Готово", "В работе"], "между соседями");

    let r = f.c.patch(&format!("/api/v1/columns/{}", f.done), json!({ "before_id": Uuid::new_v4() })).await;
    assert_eq!((r.status, r.body["code"].as_str()), (StatusCode::BAD_REQUEST, Some("bad_request")));
    assert_eq!(order(&f).await, ["К выполнению", "Готово", "В работе"], "после ошибки порядок прежний");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn column_before_id_from_another_project_is_rejected(pool: PgPool) {
    let f = Fx::new(pool.clone()).await;
    let other = make_project(&pool, "API", "Api", "warn").await;
    let foreign = id_of(
        &f.c.ok(
            f.c.post(&format!("/api/v1/projects/{other}/columns"), json!({ "title": "Чужая" })).await,
            StatusCode::CREATED,
        )
        .await,
    );
    let r = f.c.patch(&format!("/api/v1/columns/{}", f.todo), json!({ "before_id": foreign })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn delete_column_moves_tasks_to_the_first_other_column_by_default(pool: PgPool) {
    let f = Fx::new(pool).await;
    for t in ["a", "b"] {
        f.task(Some(f.doing), t).await;
    }
    f.task(Some(f.todo), "t1").await;

    let r = f.c.delete(&format!("/api/v1/columns/{}", f.doing)).await;
    assert_eq!(r.status, StatusCode::NO_CONTENT);
    assert_eq!(titles(&f.board().await, "columns"), ["К выполнению", "Готово"]);
    assert_eq!(
        f.titles(Some(f.todo)).await,
        ["t1", "a", "b"],
        "задачи в конце первой из оставшихся колонок, порядок сохранён"
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn delete_column_moves_tasks_to_move_to(pool: PgPool) {
    let f = Fx::new(pool).await;
    f.task(Some(f.todo), "a").await;
    f.task(Some(f.todo), "b").await;
    f.task(Some(f.done), "d1").await;

    let r = f.c.delete(&format!("/api/v1/columns/{}?move_to={}", f.todo, f.done)).await;
    assert_eq!(r.status, StatusCode::NO_CONTENT);
    assert_eq!(f.titles(Some(f.done)).await, ["d1", "a", "b"]);
    assert!(f.titles(Some(f.doing)).await.is_empty());
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn delete_column_rejects_bad_targets_and_the_last_column(pool: PgPool) {
    let f = Fx::new(pool.clone()).await;
    let other = make_project(&pool, "API", "Api", "warn").await;
    let foreign = id_of(
        &f.c.ok(
            f.c.post(&format!("/api/v1/projects/{other}/columns"), json!({ "title": "Чужая" })).await,
            StatusCode::CREATED,
        )
        .await,
    );
    f.task(Some(f.todo), "keep").await;

    for query in [
        format!("move_to={}", f.todo),
        format!("move_to={foreign}"),
        format!("move_to={}", Uuid::new_v4()),
        "move_to=oops".to_owned(),
    ] {
        let r = f.c.delete(&format!("/api/v1/columns/{}?{query}", f.todo)).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{query}: {}", r.body);
    }
    assert_eq!(f.titles(Some(f.todo)).await, ["keep"], "ничего не удалилось");

    assert_eq!(f.c.delete(&format!("/api/v1/columns/{}", Uuid::new_v4())).await.status, StatusCode::NOT_FOUND);

    // в чужом проекте колонка единственная: её удалить нельзя
    let r = f.c.delete(&format!("/api/v1/columns/{foreign}")).await;
    assert_eq!((r.status, r.body["code"].as_str()), (StatusCode::CONFLICT, Some("conflict")));
    assert_eq!(r.body["message"], "Нельзя удалить единственную колонку");

    // и на своей доске после удаления двух из трёх
    for col in [f.todo, f.doing] {
        assert_eq!(f.c.delete(&format!("/api/v1/columns/{col}")).await.status, StatusCode::NO_CONTENT);
    }
    assert_eq!(f.c.delete(&format!("/api/v1/columns/{}", f.done)).await.status, StatusCode::CONFLICT);
    assert_eq!(f.titles(Some(f.done)).await, ["keep"], "задача доехала до последней колонки");
}

// ===== Метки =====

fn tags_uri(f: &Fx) -> String {
    format!("/api/v1/projects/{}/tags", f.project)
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn tags_are_created_listed_and_deleted(pool: PgPool) {
    let f = Fx::new(pool).await;
    let c = &f.c;
    let uri = tags_uri(&f);
    let bug = c.ok(c.post(&uri, json!({ "label": "  Баг " })).await, StatusCode::CREATED).await;
    assert_eq!((bug["label"].as_str(), bug["tone"].as_i64()), (Some("Баг"), Some(0)));
    assert_eq!(bug["project_id"], f.project.to_string());
    let feat = c.ok(c.post(&uri, json!({ "label": "Фича" })).await, StatusCode::CREATED).await;
    assert_eq!(feat["tone"], 1, "тон по кругу");
    let urgent = c.ok(c.post(&uri, json!({ "label": "Срочно", "tone": 4 })).await, StatusCode::CREATED).await;
    assert_eq!(urgent["tone"], 4);

    let list = c.ok(c.get(&uri).await, StatusCode::OK).await;
    assert_eq!(titles_of_labels(&list), ["Баг", "Фича", "Срочно"], "в порядке создания");
    assert_eq!(titles_of_labels(&f.board().await["tags"]), ["Баг", "Фича", "Срочно"], "и в ответе доски");

    assert_eq!(c.delete(&format!("/api/v1/tags/{}", id_of(&feat))).await.status, StatusCode::NO_CONTENT);
    assert_eq!(c.delete(&format!("/api/v1/tags/{}", id_of(&feat))).await.status, StatusCode::NOT_FOUND);
    let list = c.ok(c.get(&uri).await, StatusCode::OK).await;
    assert_eq!(titles_of_labels(&list), ["Баг", "Срочно"]);
}

fn titles_of_labels(list: &Value) -> Vec<String> {
    list.as_array().unwrap().iter().map(|t| str_field(t, "label").to_owned()).collect()
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn tags_belong_to_their_project(pool: PgPool) {
    let f = Fx::new(pool.clone()).await;
    let other = make_project(&pool, "API", "Api", "warn").await;
    let c = &f.c;
    let mine = c.ok(c.post(&tags_uri(&f), json!({ "label": "Баг" })).await, StatusCode::CREATED).await;
    // то же название в другом проекте: отдельная метка
    let theirs = c
        .ok(c.post(&format!("/api/v1/projects/{other}/tags"), json!({ "label": "Баг" })).await, StatusCode::CREATED)
        .await;
    assert_ne!(id_of(&mine), id_of(&theirs));
    assert_eq!(theirs["project_id"], other.to_string());
    let board = c.ok(c.get(&format!("/api/v1/projects/{other}/board")).await, StatusCode::OK).await;
    assert_eq!(titles_of_labels(&board["tags"]), ["Баг"], "в доске другого проекта только его метки");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn creating_an_existing_tag_returns_it_instead_of_a_duplicate(pool: PgPool) {
    let f = Fx::new(pool).await;
    let c = &f.c;
    let uri = tags_uri(&f);
    let first = c.ok(c.post(&uri, json!({ "label": "Bug" })).await, StatusCode::CREATED).await;
    let again = c.ok(c.post(&uri, json!({ "label": "bUG" })).await, StatusCode::OK).await;
    assert_eq!(id_of(&first), id_of(&again));
    assert_eq!(again["label"], "Bug", "остаётся первое написание");
    assert_eq!(c.ok(c.get(&uri).await, StatusCode::OK).await.as_array().unwrap().len(), 1);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn simultaneous_creation_of_the_same_tag_gives_one_tag(pool: PgPool) {
    let f = Fx::new(pool).await;
    let c = &f.c;
    let uri = tags_uri(&f);
    let (a, b, d) = tokio::join!(
        c.post(&uri, json!({ "label": "Race" })),
        c.post(&uri, json!({ "label": "race" })),
        c.post(&uri, json!({ "label": "RACE" }))
    );
    let ids: Vec<Uuid> = [&a, &b, &d].iter().map(|r| id_of(&r.body)).collect();
    assert!(ids.iter().all(|i| *i == ids[0]), "{ids:?}");
    let statuses: Vec<u16> = [&a, &b, &d].iter().map(|r| r.status.as_u16()).collect();
    assert_eq!(statuses.iter().filter(|s| **s == 201).count(), 1, "создана ровно одна: {statuses:?}");
    assert_eq!(c.ok(c.get(&uri).await, StatusCode::OK).await.as_array().unwrap().len(), 1);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn tag_input_is_validated(pool: PgPool) {
    let f = Fx::new(pool).await;
    let c = &f.c;
    for body in [
        json!({ "label": "" }),
        json!({ "label": "   " }),
        json!({ "label": "x".repeat(51) }),
        json!({ "label": "ok", "tone": 8 }),
        json!({ "label": "ok", "tone": -1 }),
        json!({}),
    ] {
        let r = c.post(&tags_uri(&f), body.clone()).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{body}");
    }
    assert_eq!(c.delete("/api/v1/tags/not-a-uuid").await.status, StatusCode::BAD_REQUEST);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn an_admin_renames_and_recolors_a_tag_and_names_stay_unique(pool: PgPool) {
    let f = Fx::new(pool).await;
    let c = &f.c;
    let uri = tags_uri(&f);
    let bug = c.ok(c.post(&uri, json!({ "label": "Баг" })).await, StatusCode::CREATED).await;
    let feat = c.ok(c.post(&uri, json!({ "label": "Фича" })).await, StatusCode::CREATED).await;

    let renamed = c
        .ok(
            c.patch(&format!("/api/v1/tags/{}", id_of(&bug)), json!({ "label": "  Дефект ", "tone": 5 })).await,
            StatusCode::OK,
        )
        .await;
    assert_eq!((renamed["label"].as_str(), renamed["tone"].as_i64()), (Some("Дефект"), Some(5)));
    // регистр своей же метки менять можно, чужое название занимать нельзя
    let own = c.patch(&format!("/api/v1/tags/{}", id_of(&bug)), json!({ "label": "ДЕФЕКТ" })).await;
    assert_eq!(own.status, StatusCode::OK);
    let clash = c.patch(&format!("/api/v1/tags/{}", id_of(&bug)), json!({ "label": "фича" })).await;
    assert_eq!(clash.status, StatusCode::CONFLICT);
    assert_eq!(
        c.patch(&format!("/api/v1/tags/{}", id_of(&feat)), json!({ "tone": 9 })).await.status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        c.patch(&format!("/api/v1/tags/{}", Uuid::new_v4()), json!({ "tone": 1 })).await.status,
        StatusCode::NOT_FOUND
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn every_board_route_requires_a_token(pool: PgPool) {
    let c = Ctx::new(pool.clone()).await;
    let project = make_project(&pool, "WEB", "Web", "accent").await;
    let id = Uuid::new_v4();
    let routes = [
        ("GET", "/api/v1/projects".to_owned()),
        ("GET", format!("/api/v1/projects/{project}/board")),
        ("POST", format!("/api/v1/projects/{project}/columns")),
        ("PATCH", format!("/api/v1/columns/{id}")),
        ("DELETE", format!("/api/v1/columns/{id}")),
        ("POST", format!("/api/v1/projects/{project}/tasks")),
        ("GET", format!("/api/v1/tasks/{id}")),
        ("PATCH", format!("/api/v1/tasks/{id}")),
        ("DELETE", format!("/api/v1/tasks/{id}")),
        ("POST", format!("/api/v1/tasks/{id}/subtasks")),
        ("PATCH", format!("/api/v1/subtasks/{id}")),
        ("DELETE", format!("/api/v1/subtasks/{id}")),
        ("POST", format!("/api/v1/tasks/{id}/comments")),
        ("GET", format!("/api/v1/projects/{project}/tags")),
        ("POST", format!("/api/v1/projects/{project}/tags")),
        ("PATCH", format!("/api/v1/tags/{id}")),
        ("DELETE", format!("/api/v1/tags/{id}")),
    ];
    for (method, uri) in routes {
        let m: axum::http::Method = method.parse().unwrap();
        let body = (method != "GET" && method != "DELETE").then(|| json!({}));
        let r = send(&c.app, m, &uri, body, None).await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED, "{method} {uri}");
        assert_eq!(r.body["code"], "unauthorized");
    }
}
