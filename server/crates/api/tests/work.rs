//! Бэклог, модули, вехи, релизы и запись в ленту активности на настоящем Postgres.

mod common;

use axum::http::{Method, StatusCode};
use common::*;
use db::PgPool;
use serde_json::{Value, json};
use uuid::Uuid;

fn ev(kind: &str, target: &str, text: &str) -> (String, String, String) {
    (kind.to_owned(), target.to_owned(), text.to_owned())
}

fn uri(kind: &str, v: &Value) -> String {
    format!("/api/v1/{kind}/{}", id_of(v))
}

impl Fx {
    async fn module(&self, title: &str) -> Value {
        let r = self.c.post(&format!("/api/v1/projects/{}/modules", self.project), json!({ "title": title })).await;
        self.c.ok(r, StatusCode::CREATED).await
    }

    async fn milestone(&self, title: &str, date: &str) -> Value {
        let r = self
            .c
            .post(&format!("/api/v1/projects/{}/milestones", self.project), json!({ "title": title, "due_date": date }))
            .await;
        self.c.ok(r, StatusCode::CREATED).await
    }

    async fn release(&self, version: &str, date: &str) -> Value {
        let r = self
            .c
            .post(
                &format!("/api/v1/projects/{}/releases", self.project),
                json!({ "version": version, "release_date": date }),
            )
            .await;
        self.c.ok(r, StatusCode::CREATED).await
    }

    async fn releases(&self) -> Value {
        let r = self.c.get(&format!("/api/v1/projects/{}/releases", self.project)).await;
        self.c.ok(r, StatusCode::OK).await
    }

    /// Задача модуля или вехи: связь ставится так же, как из панели задачи
    async fn link(&self, task: &Value, field: &str, target: &Value) {
        let r = self.c.patch(&uri("tasks", task), json!({ field: id_of(target) })).await;
        self.c.ok(r, StatusCode::OK).await;
    }

    async fn move_task(&self, task: &Value, column: Option<Uuid>) {
        let r = self.c.patch(&uri("tasks", task), json!({ "column_id": column })).await;
        self.c.ok(r, StatusCode::OK).await;
    }

    async fn board_module(&self, module: &Value) -> Value {
        let board = self.board().await;
        board["modules"].as_array().unwrap().iter().find(|m| m["id"] == module["id"]).unwrap().clone()
    }

    async fn board_milestone(&self, milestone: &Value) -> Value {
        let board = self.board().await;
        board["milestones"].as_array().unwrap().iter().find(|m| m["id"] == milestone["id"]).unwrap().clone()
    }
}

fn step_titles(release: &Value) -> Vec<&str> {
    release["items"].as_array().unwrap().iter().map(|i| str_field(i, "title")).collect()
}

// ===== Бэклог =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn backlog_order_changes_and_to_board_puts_the_task_at_the_end_of_the_first_column(pool: PgPool) {
    let f = Fx::new(pool).await;
    let first = f.task(None, "Первая").await;
    f.task(None, "Вторая").await;
    let third = f.task(None, "Третья").await;
    f.task(Some(f.todo), "Уже в колонке").await;
    assert_eq!(f.titles(None).await, ["Первая", "Вторая", "Третья"]);

    // перетащили «Третью» наверх списка
    let r = f.c.patch(&uri("tasks", &third), json!({ "column_id": null, "before_id": id_of(&first) })).await;
    f.c.ok(r, StatusCode::OK).await;
    assert_eq!(f.titles(None).await, ["Третья", "Первая", "Вторая"]);

    // над пустым местом под списком: в конец
    let r = f.c.patch(&uri("tasks", &third), json!({ "column_id": null, "before_id": null })).await;
    f.c.ok(r, StatusCode::OK).await;
    assert_eq!(f.titles(None).await, ["Первая", "Вторая", "Третья"]);

    // «На доску»
    f.move_task(&first, Some(f.todo)).await;
    assert_eq!(f.titles(None).await, ["Вторая", "Третья"]);
    assert_eq!(f.titles(Some(f.todo)).await, ["Уже в колонке", "Первая"]);
    assert_eq!(f.activity().await.last(), Some(&ev("move", "WEB-1 Первая", "перемещена в «К выполнению»")));
}

// ===== Модули =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn new_module_has_defaults_and_goes_to_the_feed(pool: PgPool) {
    let f = Fx::new(pool).await;
    let m = f.module("  Платежи  ").await;

    assert_eq!(m["title"], "Платежи", "пробелы по краям убираются");
    assert_eq!(m["status"], "plan");
    assert_eq!(m["lead_id"], f.c.user.id.to_string(), "ответственный — автор, как ME в макете");
    assert!(m["date_from"].is_null() && m["date_to"].is_null());
    assert_eq!(m["note"], "");
    assert_eq!((m["tasks_total"].as_i64(), m["tasks_done"].as_i64()), (Some(0), Some(0)));

    assert_eq!(f.activity().await, [ev("module", "Модуль «Платежи»", "создан")]);
    let (actor, project): (Uuid, Option<Uuid>) =
        db::sqlx::query_as("select actor_id, project_id from activity").fetch_one(&f.c.pool).await.unwrap();
    assert_eq!((actor, project), (f.c.user.id, Some(f.project)));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn modules_come_with_the_board_in_creation_order(pool: PgPool) {
    let f = Fx::new(pool).await;
    for title in ["Яблоко", "Арбуз", "Мёд"] {
        f.module(title).await;
    }
    let board = f.board().await;
    let titles: Vec<&str> = board["modules"].as_array().unwrap().iter().map(|m| str_field(m, "title")).collect();
    assert_eq!(titles, ["Яблоко", "Арбуз", "Мёд"], "порядок добавления, а не по алфавиту");

    // модули другого проекта не видны
    let other = make_project(&f.c.pool, "API", "Api", "warn").await;
    let r = f.c.get(&format!("/api/v1/projects/{other}/board")).await;
    assert_eq!(f.c.ok(r, StatusCode::OK).await["modules"], json!([]));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn creating_a_module_checks_input(pool: PgPool) {
    let f = Fx::new(pool).await;
    let url = format!("/api/v1/projects/{}/modules", f.project);

    for title in ["", "   "] {
        assert_eq!(f.c.post(&url, json!({ "title": title })).await.status, StatusCode::BAD_REQUEST, "{title:?}");
    }
    let long = "я".repeat(201);
    assert_eq!(f.c.post(&url, json!({ "title": long })).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(f.c.post(&url, json!({})).await.status, StatusCode::BAD_REQUEST, "нет названия");
    assert_eq!(f.c.post(&url, json!({ "title": "A", "lead_id": null })).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        f.c.post(&format!("/api/v1/projects/{}/modules", Uuid::new_v4()), json!({ "title": "A" })).await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(post(&f.c.app, &url, json!({ "title": "A" })).await.status, StatusCode::UNAUTHORIZED);
    assert!(f.activity().await.is_empty(), "ошибки в ленту не попадают");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn update_module_changes_fields_and_null_clears_them(pool: PgPool) {
    let f = Fx::new(pool).await;
    let m = f.module("SSO").await;
    let colleague = make_user(&f.c.pool, "kolya@example.com", "Коля К.", "pass-pass").await;

    let r =
        f.c.patch(
            &uri("modules", &m),
            json!({
                "title": " Вход через SSO ", "note": "Только для сотрудников", "lead_id": colleague.id,
                "date_from": "2026-10-05", "date_to": "2026-11-20"
            }),
        )
        .await;
    let m = f.c.ok(r, StatusCode::OK).await;
    assert_eq!(m["title"], "Вход через SSO");
    assert_eq!(m["note"], "Только для сотрудников");
    assert_eq!(m["lead_id"], colleague.id.to_string());
    assert_eq!((m["date_from"].as_str(), m["date_to"].as_str()), (Some("2026-10-05"), Some("2026-11-20")));

    // то, что не передано, не меняется
    let r = f.c.patch(&uri("modules", &m), json!({ "note": "" })).await;
    let m = f.c.ok(r, StatusCode::OK).await;
    assert_eq!((m["title"].as_str(), m["date_from"].as_str()), (Some("Вход через SSO"), Some("2026-10-05")));

    // null очищает
    let r = f.c.patch(&uri("modules", &m), json!({ "lead_id": null, "date_from": null, "date_to": null })).await;
    let m = f.c.ok(r, StatusCode::OK).await;
    assert!(m["lead_id"].is_null() && m["date_from"].is_null() && m["date_to"].is_null());

    // пустое тело ничего не ломает
    let r = f.c.patch(&uri("modules", &m), json!({})).await;
    assert_eq!(f.c.ok(r, StatusCode::OK).await["title"], "Вход через SSO");
    assert_eq!(f.activity().await.len(), 1, "правки полей в ленту не пишутся, только создание");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn module_status_change_goes_to_the_feed_once(pool: PgPool) {
    let f = Fx::new(pool).await;
    let m = f.module("SSO").await;

    for (status, text) in [("progress", "переведён в «В работе»"), ("done", "переведён в «Завершён»")]
    {
        let r = f.c.patch(&uri("modules", &m), json!({ "status": status })).await;
        assert_eq!(f.c.ok(r, StatusCode::OK).await["status"], status);
        assert_eq!(f.activity().await.last(), Some(&ev("module", "Модуль «SSO»", text)));
    }
    let before = f.activity().await.len();
    let r = f.c.patch(&uri("modules", &m), json!({ "status": "done" })).await;
    f.c.ok(r, StatusCode::OK).await;
    assert_eq!(f.activity().await.len(), before, "тот же статус повторно не пишется");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn update_module_rejects_bad_values(pool: PgPool) {
    let f = Fx::new(pool).await;
    let m = f.module("SSO").await;
    let url = uri("modules", &m);

    for body in [
        json!({ "title": "  " }),
        json!({ "status": "released" }),
        json!({ "lead_id": Uuid::new_v4() }),
        json!({ "note": "я".repeat(5001) }),
        json!({ "date_from": "завтра" }),
        json!({ "project_id": Uuid::new_v4() }),
    ] {
        assert_eq!(f.c.patch(&url, body.clone()).await.status, StatusCode::BAD_REQUEST, "{body}");
    }
    let missing = format!("/api/v1/modules/{}", Uuid::new_v4());
    assert_eq!(f.c.patch(&missing, json!({ "title": "A" })).await.status, StatusCode::NOT_FOUND);
    assert_eq!(f.c.delete(&missing).await.status, StatusCode::NOT_FOUND);
    assert_eq!(f.c.patch("/api/v1/modules/not-a-uuid", json!({})).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(f.board_module(&m).await["title"], "SSO", "после отказов модуль не изменился");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn module_progress_counts_tasks_in_done_columns(pool: PgPool) {
    let f = Fx::new(pool).await;
    let m = f.module("SSO").await;
    let a = f.task(Some(f.todo), "A").await;
    let b = f.task(Some(f.doing), "B").await;
    let c = f.task(None, "C из бэклога").await;
    f.task(Some(f.done), "Без модуля").await; // в «Готово», но к модулю не относится
    for t in [&a, &b, &c] {
        f.link(t, "module_id", &m).await;
    }
    let counts = |v: &Value| (v["tasks_total"].as_i64().unwrap(), v["tasks_done"].as_i64().unwrap());
    assert_eq!(counts(&f.board_module(&m).await), (3, 0));

    // перенос в «Готово» пересчитывает прогресс
    f.move_task(&a, Some(f.done)).await;
    assert_eq!(counts(&f.board_module(&m).await), (3, 1));
    f.move_task(&b, Some(f.done)).await;
    assert_eq!(counts(&f.board_module(&m).await), (3, 2));

    // задача из бэклога входит в «всего», но не в «готово»; на доске в «Готово» она считается, вернулась в бэклог — нет
    f.move_task(&c, Some(f.done)).await;
    assert_eq!(counts(&f.board_module(&m).await), (3, 3));
    f.move_task(&c, None).await;
    assert_eq!(counts(&f.board_module(&m).await), (3, 2));

    // из «Готово» обратно
    f.move_task(&a, Some(f.todo)).await;
    assert_eq!(counts(&f.board_module(&m).await), (3, 1));

    // ответ PATCH несёт те же числа
    let r = f.c.patch(&uri("modules", &m), json!({ "note": "x" })).await;
    assert_eq!(counts(&f.c.ok(r, StatusCode::OK).await), (3, 1));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn deleting_a_module_keeps_its_tasks_and_goes_to_the_feed(pool: PgPool) {
    let f = Fx::new(pool).await;
    let m = f.module("Старый").await;
    let t = f.task(Some(f.todo), "Задача").await;
    f.link(&t, "module_id", &m).await;

    let r = f.c.delete(&uri("modules", &m)).await;
    assert_eq!(r.status, StatusCode::NO_CONTENT);
    let board = f.board().await;
    assert_eq!(board["modules"], json!([]));
    assert_eq!(board["tasks"].as_array().unwrap().len(), 1, "задача осталась");
    assert!(board["tasks"][0]["module_id"].is_null());
    assert_eq!(f.activity().await.last(), Some(&ev("module", "Модуль «Старый»", "удалён")));
    assert_eq!(f.c.delete(&uri("modules", &m)).await.status, StatusCode::NOT_FOUND, "повторное удаление");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_task_cannot_get_a_module_that_was_just_deleted(pool: PgPool) {
    let f = Fx::new(pool).await;
    let m = f.module("Исчезнет").await;
    let t = f.task(Some(f.todo), "T").await;
    f.c.delete(&uri("modules", &m)).await;
    let r = f.c.patch(&uri("tasks", &t), json!({ "module_id": id_of(&m) })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
}

// ===== Вехи =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn new_milestone_needs_a_date_and_goes_to_the_feed(pool: PgPool) {
    let f = Fx::new(pool).await;
    let ms = f.milestone("  Бета  ", "2026-11-03").await;
    assert_eq!((ms["title"].as_str(), ms["due_date"].as_str()), (Some("Бета"), Some("2026-11-03")));
    assert_eq!((ms["tasks_total"].as_i64(), ms["tasks_done"].as_i64()), (Some(0), Some(0)));
    assert_eq!(f.activity().await, [ev("release", "Веха «Бета»", "создана")]);

    let url = format!("/api/v1/projects/{}/milestones", f.project);
    for body in [
        json!({ "title": "Без даты" }),
        json!({ "title": "Плохая дата", "due_date": "03.11.2026" }),
        json!({ "title": "Не дата", "due_date": "2026-13-40" }),
        json!({ "title": "  ", "due_date": "2026-11-03" }),
        json!({ "title": "я".repeat(201), "due_date": "2026-11-03" }),
    ] {
        assert_eq!(f.c.post(&url, body.clone()).await.status, StatusCode::BAD_REQUEST, "{body}");
    }
    let wrong = format!("/api/v1/projects/{}/milestones", Uuid::new_v4());
    assert_eq!(f.c.post(&wrong, json!({ "title": "A", "due_date": "2026-11-03" })).await.status, StatusCode::NOT_FOUND);
    assert_eq!(f.activity().await.len(), 1);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn milestones_are_sorted_by_date_and_can_be_edited(pool: PgPool) {
    let f = Fx::new(pool).await;
    let late = f.milestone("Релиз 2.9.0", "2026-12-01").await;
    f.milestone("Бета", "2026-11-03").await;
    let titles = |board: &Value| -> Vec<String> {
        board["milestones"].as_array().unwrap().iter().map(|m| str_field(m, "title").to_owned()).collect()
    };
    assert_eq!(titles(&f.board().await), ["Бета", "Релиз 2.9.0"]);

    let r = f.c.patch(&uri("milestones", &late), json!({ "due_date": "2026-10-01", "title": " Релиз 2.8.1 " })).await;
    let late = f.c.ok(r, StatusCode::OK).await;
    assert_eq!((late["title"].as_str(), late["due_date"].as_str()), (Some("Релиз 2.8.1"), Some("2026-10-01")));
    assert_eq!(titles(&f.board().await), ["Релиз 2.8.1", "Бета"]);

    let r = f.c.patch(&uri("milestones", &late), json!({ "title": "Только название" })).await;
    assert_eq!(f.c.ok(r, StatusCode::OK).await["due_date"], "2026-10-01", "дата не тронута");

    for body in [json!({ "title": " " }), json!({ "due_date": "скоро" }), json!({ "unknown": 1 })] {
        assert_eq!(f.c.patch(&uri("milestones", &late), body.clone()).await.status, StatusCode::BAD_REQUEST, "{body}");
    }
    let missing = format!("/api/v1/milestones/{}", Uuid::new_v4());
    assert_eq!(f.c.patch(&missing, json!({ "title": "A" })).await.status, StatusCode::NOT_FOUND);
    assert_eq!(f.activity().await.len(), 2, "правки даты и названия в ленту не пишутся");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn milestone_progress_follows_the_task_column(pool: PgPool) {
    let f = Fx::new(pool).await;
    let ms = f.milestone("Бета", "2026-11-03").await;
    let a = f.task(Some(f.todo), "A").await;
    let b = f.task(Some(f.doing), "B").await;
    f.link(&a, "milestone_id", &ms).await;
    f.link(&b, "milestone_id", &ms).await;
    let counts = |v: &Value| (v["tasks_total"].as_i64().unwrap(), v["tasks_done"].as_i64().unwrap());
    assert_eq!(counts(&f.board_milestone(&ms).await), (2, 0));

    f.move_task(&b, Some(f.done)).await;
    assert_eq!(counts(&f.board_milestone(&ms).await), (2, 1));
    f.move_task(&a, Some(f.done)).await;
    assert_eq!(counts(&f.board_milestone(&ms).await), (2, 2));
    f.move_task(&a, Some(f.doing)).await;
    assert_eq!(counts(&f.board_milestone(&ms).await), (2, 1));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn deleting_a_milestone_keeps_its_tasks_and_goes_to_the_feed(pool: PgPool) {
    let f = Fx::new(pool).await;
    let ms = f.milestone("Бета", "2026-11-03").await;
    let t = f.task(Some(f.todo), "Задача").await;
    f.link(&t, "milestone_id", &ms).await;

    assert_eq!(f.c.delete(&uri("milestones", &ms)).await.status, StatusCode::NO_CONTENT);
    let board = f.board().await;
    assert_eq!(board["milestones"], json!([]));
    assert!(board["tasks"][0]["milestone_id"].is_null());
    assert_eq!(f.activity().await.last(), Some(&ev("release", "Веха «Бета»", "удалена")));
    assert_eq!(f.c.delete(&uri("milestones", &ms)).await.status, StatusCode::NOT_FOUND);
}

// ===== Релизы =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn new_release_gets_the_default_checklist_and_goes_to_the_feed(pool: PgPool) {
    let f = Fx::new(pool).await;
    let r = f.release("  2.10.0  ", "2026-11-08").await;

    assert_eq!(r["version"], "2.10.0");
    assert_eq!(
        (r["release_date"].as_str(), r["status"].as_str(), r["notes"].as_str()),
        (Some("2026-11-08"), Some("plan"), Some(""))
    );
    assert_eq!(step_titles(&r), ["Заморозка кода", "Регрессионные тесты", "Обновить changelog", "Выкатка на прод"]);
    assert!(r["items"].as_array().unwrap().iter().all(|i| i["done"] == false));
    let positions: Vec<f64> = r["items"].as_array().unwrap().iter().map(|i| i["position"].as_f64().unwrap()).collect();
    assert!(positions.windows(2).all(|w| w[0] < w[1]), "шаги по порядку");
    assert_eq!(f.activity().await, [ev("release", "Релиз 2.10.0", "создан")]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn releases_are_listed_newest_first_with_their_steps(pool: PgPool) {
    let f = Fx::new(pool).await;
    let old = f.release("2.8.0", "2026-08-01").await;
    f.release("2.9.0", "2026-10-25").await;
    let mid = f.release("2.8.5", "2026-09-10").await;
    let r = f.c.post(&format!("{}/items", uri("releases", &mid)), json!({ "title": "Сообщить клиентам" })).await;
    f.c.ok(r, StatusCode::CREATED).await;

    let list = f.releases().await;
    let versions: Vec<&str> = list.as_array().unwrap().iter().map(|r| str_field(r, "version")).collect();
    assert_eq!(versions, ["2.9.0", "2.8.5", "2.8.0"], "от новых к старым");
    assert_eq!(list[0]["items"].as_array().unwrap().len(), 4);
    assert_eq!(list[1]["items"].as_array().unwrap().len(), 5, "шаги лежат у своего релиза");
    assert_eq!(str_field(&list[1]["items"][4], "title"), "Сообщить клиентам");
    assert_eq!(list[2]["id"], old["id"]);

    // релизы другого проекта не видны
    let other = make_project(&f.c.pool, "API", "Api", "warn").await;
    let r = f.c.get(&format!("/api/v1/projects/{other}/releases")).await;
    assert_eq!(f.c.ok(r, StatusCode::OK).await, json!([]));
    let r = f.c.get(&format!("/api/v1/projects/{}/releases", Uuid::new_v4())).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(
        get(&f.c.app, &format!("/api/v1/projects/{}/releases", f.project), None).await.status,
        StatusCode::UNAUTHORIZED
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn update_release_changes_fields_and_status_goes_to_the_feed(pool: PgPool) {
    let f = Fx::new(pool).await;
    let r = f.release("2.9.0", "2026-10-25").await;
    let url = uri("releases", &r);

    let reply =
        f.c.patch(&url, json!({ "version": " 2.9.1 ", "release_date": "2026-10-30", "notes": "• Тёмная тема\n• SSO" }))
            .await;
    let r = f.c.ok(reply, StatusCode::OK).await;
    assert_eq!((r["version"].as_str(), r["release_date"].as_str()), (Some("2.9.1"), Some("2026-10-30")));
    assert_eq!(r["notes"], "• Тёмная тема\n• SSO");
    assert_eq!(r["items"].as_array().unwrap().len(), 4, "в ответе и чек-лист");
    assert_eq!(f.activity().await.len(), 1, "версия, дата и заметки в ленту не пишутся");

    for (status, text) in [("progress", "переведён в «Готовится»"), ("done", "переведён в «Выпущен»")]
    {
        let reply = f.c.patch(&url, json!({ "status": status })).await;
        assert_eq!(f.c.ok(reply, StatusCode::OK).await["status"], status);
        assert_eq!(f.activity().await.last(), Some(&ev("release", "Релиз 2.9.1", text)));
    }
    let before = f.activity().await.len();
    f.c.ok(f.c.patch(&url, json!({ "status": "done" })).await, StatusCode::OK).await;
    assert_eq!(f.activity().await.len(), before);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn release_input_is_checked(pool: PgPool) {
    let f = Fx::new(pool).await;
    let url = format!("/api/v1/projects/{}/releases", f.project);
    for body in [
        json!({ "release_date": "2026-11-08" }),
        json!({ "version": "  ", "release_date": "2026-11-08" }),
        json!({ "version": "v".repeat(51), "release_date": "2026-11-08" }),
        json!({ "version": "2.10.0" }),
        json!({ "version": "2.10.0", "release_date": "в ноябре" }),
        json!({ "version": "2.10.0", "release_date": "2026-11-08", "status": "done" }),
    ] {
        assert_eq!(f.c.post(&url, body.clone()).await.status, StatusCode::BAD_REQUEST, "{body}");
    }
    assert!(f.releases().await.as_array().unwrap().is_empty());
    assert!(f.activity().await.is_empty());

    let r = f.release("2.9.0", "2026-10-25").await;
    for body in [
        json!({ "version": "" }),
        json!({ "status": "released" }),
        json!({ "release_date": "32.10.2026" }),
        json!({ "notes": "я".repeat(20_001) }),
        json!({ "project_id": Uuid::new_v4() }),
    ] {
        assert_eq!(f.c.patch(&uri("releases", &r), body.clone()).await.status, StatusCode::BAD_REQUEST, "{body}");
    }
    let missing = format!("/api/v1/releases/{}", Uuid::new_v4());
    assert_eq!(f.c.patch(&missing, json!({ "notes": "x" })).await.status, StatusCode::NOT_FOUND);
    assert_eq!(f.c.delete(&missing).await.status, StatusCode::NOT_FOUND);
    let wrong = format!("/api/v1/projects/{}/releases", Uuid::new_v4());
    assert_eq!(
        f.c.post(&wrong, json!({ "version": "1", "release_date": "2026-11-08" })).await.status,
        StatusCode::NOT_FOUND
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn checklist_steps_can_be_added_renamed_checked_and_removed(pool: PgPool) {
    let f = Fx::new(pool).await;
    let release = f.release("2.9.0", "2026-10-25").await;
    let items_url = format!("{}/items", uri("releases", &release));

    let r = f.c.post(&items_url, json!({ "title": "  Сообщить клиентам  " })).await;
    let added = f.c.ok(r, StatusCode::CREATED).await;
    assert_eq!((added["title"].as_str(), added["done"].as_bool()), (Some("Сообщить клиентам"), Some(false)));
    let last = f.releases().await[0]["items"].as_array().unwrap().last().unwrap().clone();
    assert_eq!(last["id"], added["id"], "новый шаг встаёт в конец");

    let step = format!("/api/v1/release-items/{}", id_of(&added));
    let r = f.c.patch(&step, json!({ "title": "Написать клиентам" })).await;
    let renamed = f.c.ok(r, StatusCode::OK).await;
    assert_eq!((renamed["title"].as_str(), renamed["done"].as_bool()), (Some("Написать клиентам"), Some(false)));
    let r = f.c.patch(&step, json!({ "done": true })).await;
    let checked = f.c.ok(r, StatusCode::OK).await;
    assert_eq!((checked["title"].as_str(), checked["done"].as_bool()), (Some("Написать клиентам"), Some(true)));

    assert_eq!(f.c.delete(&step).await.status, StatusCode::NO_CONTENT);
    assert_eq!(f.releases().await[0]["items"].as_array().unwrap().len(), 4);
    assert_eq!(f.c.delete(&step).await.status, StatusCode::NOT_FOUND);
    assert_eq!(f.c.patch(&step, json!({ "done": true })).await.status, StatusCode::NOT_FOUND);

    for body in [json!({ "title": "" }), json!({ "title": "я".repeat(501) }), json!({})] {
        assert_eq!(f.c.post(&items_url, body.clone()).await.status, StatusCode::BAD_REQUEST, "{body}");
    }
    let missing = format!("/api/v1/releases/{}/items", Uuid::new_v4());
    assert_eq!(f.c.post(&missing, json!({ "title": "A" })).await.status, StatusCode::NOT_FOUND);
    let any = format!("/api/v1/release-items/{}", id_of(&release["items"][0]));
    assert_eq!(f.c.patch(&any, json!({ "title": " " })).await.status, StatusCode::BAD_REQUEST);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn checking_a_step_goes_to_the_feed_only_when_it_becomes_done(pool: PgPool) {
    let f = Fx::new(pool).await;
    let release = f.release("2.9.0", "2026-10-25").await;
    let step = format!("/api/v1/release-items/{}", id_of(&release["items"][1]));

    f.c.ok(f.c.patch(&step, json!({ "done": true })).await, StatusCode::OK).await;
    assert_eq!(f.activity().await.last(), Some(&ev("release", "Релиз 2.9.0", "отмечен шаг «Регрессионные тесты»")));
    let after_check = f.activity().await.len();

    // снять отметку, переименовать и отметить повторно
    f.c.ok(f.c.patch(&step, json!({ "done": false })).await, StatusCode::OK).await;
    assert_eq!(f.activity().await.len(), after_check, "снятие отметки не пишется");
    f.c.ok(f.c.patch(&step, json!({ "title": "Регресс" })).await, StatusCode::OK).await;
    assert_eq!(f.activity().await.len(), after_check, "переименование не пишется");
    f.c.ok(f.c.patch(&step, json!({ "done": true })).await, StatusCode::OK).await;
    assert_eq!(f.activity().await.last(), Some(&ev("release", "Релиз 2.9.0", "отмечен шаг «Регресс»")));
    // шаг уже отмечен: повтор того же значения ничего не пишет
    let before = f.activity().await.len();
    f.c.ok(f.c.patch(&step, json!({ "done": true })).await, StatusCode::OK).await;
    assert_eq!(f.activity().await.len(), before);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn deleting_a_release_removes_its_steps_and_goes_to_the_feed(pool: PgPool) {
    let f = Fx::new(pool).await;
    let release = f.release("2.9.0", "2026-10-25").await;
    let keep = f.release("2.8.0", "2026-08-01").await;

    assert_eq!(f.c.delete(&uri("releases", &release)).await.status, StatusCode::NO_CONTENT);
    assert_eq!(f.releases().await.as_array().unwrap().len(), 1);
    let steps: i64 = db::sqlx::query_scalar("select count(*) from release_items").fetch_one(&f.c.pool).await.unwrap();
    assert_eq!(steps, 4, "остались только шаги другого релиза");
    assert_eq!(f.activity().await.last(), Some(&ev("release", "Релиз 2.9.0", "удалён")));
    assert_eq!(f.c.delete(&uri("releases", &release)).await.status, StatusCode::NOT_FOUND);
    assert_eq!(f.releases().await[0]["id"], keep["id"]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn all_new_routes_require_a_token(pool: PgPool) {
    let f = Fx::new(pool).await;
    let id = Uuid::new_v4();
    for (method, path) in [
        (Method::POST, format!("/api/v1/projects/{}/modules", f.project)),
        (Method::PATCH, format!("/api/v1/modules/{id}")),
        (Method::DELETE, format!("/api/v1/modules/{id}")),
        (Method::POST, format!("/api/v1/projects/{}/milestones", f.project)),
        (Method::PATCH, format!("/api/v1/milestones/{id}")),
        (Method::DELETE, format!("/api/v1/milestones/{id}")),
        (Method::GET, format!("/api/v1/projects/{}/releases", f.project)),
        (Method::POST, format!("/api/v1/projects/{}/releases", f.project)),
        (Method::PATCH, format!("/api/v1/releases/{id}")),
        (Method::DELETE, format!("/api/v1/releases/{id}")),
        (Method::POST, format!("/api/v1/releases/{id}/items")),
        (Method::PATCH, format!("/api/v1/release-items/{id}")),
        (Method::DELETE, format!("/api/v1/release-items/{id}")),
    ] {
        let reply = send(&f.c.app, method.clone(), &path, Some(json!({})), None).await;
        assert_eq!(reply.status, StatusCode::UNAUTHORIZED, "{method} {path}");
    }
}
