//! Ключи задач у модулей и смена ряда нумерации (этап П4, docs/PROJECTS.md, раздел 4) на настоящем Postgres.
//! В конце каждого сценария проверяется правило по всей базе: `assert_series_rule`.

mod common;

use axum::http::StatusCode;
use common::*;
use db::{
    PgPool,
    seed::{SeedOptions, seed},
};
use futures_util::future::join_all;
use serde_json::{Value, json};
use time::{Date, Month, OffsetDateTime, Time};
use uuid::Uuid;

/// Проект «Сайт» с ключом PLX и одной колонкой, как в примере раздела 4.4
struct Site {
    c: Ctx,
    project: Uuid,
    todo: Uuid,
}

impl Site {
    async fn new(pool: PgPool) -> Site {
        let c = Ctx::new(pool.clone()).await;
        let project = make_project(&pool, "PLX", "Сайт", "accent").await;
        let r = c.post(&format!("/api/v1/projects/{project}/columns"), json!({ "title": "К выполнению" })).await;
        let todo = id_of(&c.ok(r, StatusCode::CREATED).await);
        Site { c, project, todo }
    }

    async fn task(&self, title: &str) -> Uuid {
        let r = self
            .c
            .post(
                &format!("/api/v1/projects/{}/tasks", self.project),
                json!({ "title": title, "column_id": self.todo }),
            )
            .await;
        id_of(&self.c.ok(r, StatusCode::CREATED).await)
    }

    async fn module(&self, title: &str) -> Uuid {
        let r = self.c.post(&format!("/api/v1/projects/{}/modules", self.project), json!({ "title": title })).await;
        id_of(&self.c.ok(r, StatusCode::CREATED).await)
    }

    /// Ключ модуля: `Some("SEO")` ставит, `None` снимает
    async fn set_key(&self, module: Uuid, key: Option<&str>) -> Value {
        let r = self.c.patch(&format!("/api/v1/modules/{module}"), json!({ "key": key })).await;
        self.c.ok(r, StatusCode::OK).await
    }

    async fn key_reply(&self, module: Uuid, key: &str) -> Reply {
        self.c.patch(&format!("/api/v1/modules/{module}"), json!({ "key": key })).await
    }

    /// Кладёт задачу в модуль (`None`: убирает из модуля) и возвращает её id для показа
    async fn put_in(&self, task: Uuid, module: Option<Uuid>) -> String {
        let r = self.c.patch(&format!("/api/v1/tasks/{task}"), json!({ "module_id": module })).await;
        str_field(&self.c.ok(r, StatusCode::OK).await, "key").to_owned()
    }

    async fn label(&self, task: Uuid) -> String {
        let r = self.c.get(&format!("/api/v1/tasks/{task}")).await;
        str_field(&self.c.ok(r, StatusCode::OK).await, "key").to_owned()
    }

    /// Прежние id задачи по порядку, как они менялись: (ключ, номер)
    async fn old_ids(&self, task: Uuid) -> Vec<(String, i32)> {
        db::sqlx::query_as("select key, number from task_old_ids where task_id = $1 order by created_at, number")
            .bind(task)
            .fetch_all(&self.c.pool)
            .await
            .unwrap()
    }
}

// ===== Пример из документа =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn the_example_from_the_spec_works_step_by_step(pool: PgPool) {
    let s = Site::new(pool.clone()).await;
    let seo = s.module("SEO").await;
    s.set_key(seo, Some("SEO")).await;
    let design = s.module("Дизайн").await;

    // 1. две задачи без модуля
    let t1 = s.task("Первая").await;
    let t2 = s.task("Вторая").await;
    assert_eq!((s.label(t1).await, s.label(t2).await), ("PLX-1".to_owned(), "PLX-2".to_owned()));

    // 2. PLX-2 в модуль SEO: SEO-1, PLX-2 больше нет
    assert_eq!(s.put_in(t2, Some(seo)).await, "SEO-1");

    // 3. новая задача без модуля продолжает ряд проекта
    let t3 = s.task("Третья").await;
    assert_eq!(s.label(t3).await, "PLX-3");

    // 4. из SEO в «Дизайн» (ключа нет): ряд проекта, новый номер
    assert_eq!(s.put_in(t2, Some(design)).await, "PLX-4");

    // 5. из «Дизайна» в «без модуля»: ряд тот же, id не меняется
    assert_eq!(s.put_in(t2, None).await, "PLX-4");

    // 6. переименование ключа меняет только подпись, номера те же
    assert_eq!(s.put_in(t1, Some(seo)).await, "SEO-2", "счётчик модуля не отдаёт номер 1, его занимала другая задача");
    let renamed = s.set_key(seo, Some("MKT")).await;
    assert_eq!(renamed["key"], "MKT");
    assert_eq!(s.label(t1).await, "MKT-2");

    // 7. первый ключ у модуля с задачами: номера новые, в порядке старых
    assert_eq!(s.put_in(t3, Some(design)).await, "PLX-3");
    assert_eq!(s.put_in(t2, Some(design)).await, "PLX-4", "ключа у «Дизайна» ещё нет, id прежние");
    let t4 = s.task("Четвёртая").await;
    assert_eq!(s.put_in(t4, Some(design)).await, "PLX-5");
    s.set_key(design, Some("DSN")).await;
    assert_eq!(
        (s.label(t3).await, s.label(t2).await, s.label(t4).await),
        ("DSN-1".to_owned(), "DSN-2".to_owned(), "DSN-3".to_owned()),
        "порядок старых номеров 3, 4, 5"
    );
    assert_eq!(s.label(t1).await, "MKT-2", "чужие ряды не тронуты");

    // прежние id остались в истории, каждый смене ряда по записи
    assert_eq!(s.old_ids(t2).await, [("PLX".to_owned(), 2), ("SEO".to_owned(), 1), ("PLX".to_owned(), 4)]);
    assert_eq!(s.old_ids(t3).await, [("PLX".to_owned(), 3)]);
    assert_eq!(s.old_ids(t4).await, [("PLX".to_owned(), 5)]);
    assert_eq!(s.old_ids(t1).await, [("PLX".to_owned(), 1)]);
    assert_series_rule(&pool).await;
}

// ===== Правила ключей =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_key_is_checked_normalized_and_unique_within_the_project(pool: PgPool) {
    let s = Site::new(pool.clone()).await;
    let a = s.module("Первый").await;
    let b = s.module("Второй").await;

    for bad in ["a", "1ab", "toolongkey", "ab cd", "ключ", "a-b"] {
        let r = s.key_reply(a, bad).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "«{bad}»: {}", r.body);
        assert_eq!(r.body["code"], "bad_request");
    }
    assert!(s.c.get(&format!("/api/v1/projects/{}/board", s.project)).await.body["modules"][0]["key"].is_null());

    let ok = s.set_key(a, Some("seo")).await;
    assert_eq!(ok["key"], "SEO", "хранится в верхнем регистре");

    // чужой ключ в этом проекте, любым регистром
    for same in ["SEO", "seo", " Seo "] {
        let r = s.key_reply(b, same).await;
        assert_eq!(r.status, StatusCode::CONFLICT, "«{same}»");
        assert_eq!(r.body["message"], "Такой ключ уже есть в этом проекте");
    }
    // ключ проекта тоже занят
    let r = s.key_reply(b, "plx").await;
    assert_eq!((r.status, r.body["message"].as_str()), (StatusCode::CONFLICT, Some("Такой ключ уже у проекта")));
    // а TASK свободен, пока у проекта есть ключ
    assert_eq!(s.set_key(b, Some("TASK")).await["key"], "TASK");

    // тот же ключ можно повторить в другом проекте
    let other = make_project(&pool, "WEB", "Другой", "ok").await;
    let r = s.c.post(&format!("/api/v1/projects/{other}/modules"), json!({ "title": "SEO" })).await;
    let m = id_of(&s.c.ok(r, StatusCode::CREATED).await);
    assert_eq!(s.set_key(m, Some("SEO")).await["key"], "SEO");

    // пустая строка и null снимают ключ
    assert!(s.set_key(a, None).await["key"].is_null());
    s.set_key(a, Some("SEO")).await;
    let r = s.c.ok(s.key_reply(a, "").await, StatusCode::OK).await;
    assert!(r["key"].is_null());
    assert_series_rule(&pool).await;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn task_is_taken_while_the_project_has_no_key(pool: PgPool) {
    let s = Site::new(pool.clone()).await;
    db::sqlx::query("update projects set key = null where id = $1").bind(s.project).execute(&pool).await.unwrap();
    let m = s.module("Модуль").await;

    let r = s.key_reply(m, "task").await;
    assert_eq!(r.status, StatusCode::CONFLICT);
    let message = r.body["message"].as_str().unwrap();
    assert!(message.contains("TASK") && message.contains("нет ключа"), "{message}");

    // ключ проекта освободил TASK
    s.c.ok(s.c.patch(&format!("/api/v1/projects/{}", s.project), json!({ "key": "PLX" })).await, StatusCode::OK).await;
    assert_eq!(s.set_key(m, Some("TASK")).await["key"], "TASK");
    // и обратно: пока TASK занят модулем, проекту нельзя снять ключ
    let r = s.c.patch(&format!("/api/v1/projects/{}", s.project), json!({ "key": null })).await;
    assert_eq!(r.status, StatusCode::CONFLICT);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_member_can_change_a_key_and_a_stranger_cannot(pool: PgPool) {
    let s = Site::new(pool.clone()).await;
    let m = s.module("SEO").await;
    let member = s.c.another("member@example.com", "Участник").await;
    let stranger_reply = member.patch(&format!("/api/v1/modules/{m}"), json!({ "key": "SEO" })).await;
    assert_eq!(stranger_reply.status, StatusCode::NOT_FOUND, "посторонний не видит и модуль");

    join(&pool, s.project, member.user.id, "member").await;
    let r = member.patch(&format!("/api/v1/modules/{m}"), json!({ "key": "SEO" })).await;
    assert_eq!(member.ok(r, StatusCode::OK).await["key"], "SEO", "участнику правка модулей разрешена");
}

// ===== Снятие ключа, удаление модуля, номера не возвращаются =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn removing_a_key_and_deleting_the_module_move_tasks_to_the_project_series(pool: PgPool) {
    let s = Site::new(pool.clone()).await;
    let m = s.module("SEO").await;
    s.set_key(m, Some("SEO")).await;
    let (a, b, c) = (s.task("A").await, s.task("B").await, s.task("C").await);
    assert_eq!(s.put_in(a, Some(m)).await, "SEO-1");
    assert_eq!(s.put_in(b, Some(m)).await, "SEO-2");
    assert_eq!(s.label(c).await, "PLX-3");

    // ключ убрали: задачи в ряд проекта, номера новые, в порядке старых
    assert!(s.set_key(m, None).await["key"].is_null());
    assert_eq!(
        (s.label(a).await, s.label(b).await, s.label(c).await),
        ("PLX-4".into(), "PLX-5".into(), "PLX-3".into())
    );
    assert_eq!(
        s.old_ids(a).await,
        [("PLX".to_owned(), 1), ("SEO".to_owned(), 1)],
        "в историю попала подпись, какой она была"
    );

    // ключ вернули: нумерация модуля продолжается, а не дублирует номера 1 и 2
    s.set_key(m, Some("SEO")).await;
    assert_eq!((s.label(a).await, s.label(b).await), ("SEO-3".to_owned(), "SEO-4".to_owned()));

    // модуль удалили: задачи остаются, без модуля, в ряду проекта
    assert_eq!(s.c.delete(&format!("/api/v1/modules/{m}")).await.status, StatusCode::NO_CONTENT);
    assert_eq!((s.label(a).await, s.label(b).await), ("PLX-6".to_owned(), "PLX-7".to_owned()));
    let task = s.c.ok(s.c.get(&format!("/api/v1/tasks/{a}")).await, StatusCode::OK).await;
    assert!(task["module_id"].is_null());
    assert_eq!(
        s.old_ids(a).await,
        [("PLX".to_owned(), 1), ("SEO".to_owned(), 1), ("PLX".to_owned(), 4), ("SEO".to_owned(), 3)]
    );
    assert_series_rule(&pool).await;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_module_without_a_key_deletes_without_touching_ids(pool: PgPool) {
    let s = Site::new(pool.clone()).await;
    let m = s.module("Без ключа").await;
    let t = s.task("T").await;
    assert_eq!(s.put_in(t, Some(m)).await, "PLX-1");
    assert_eq!(s.c.delete(&format!("/api/v1/modules/{m}")).await.status, StatusCode::NO_CONTENT);
    assert_eq!(s.label(t).await, "PLX-1");
    assert!(s.old_ids(t).await.is_empty(), "ряд не менялся, истории нет");
    assert_series_rule(&pool).await;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn deleted_numbers_are_never_handed_out_again(pool: PgPool) {
    let s = Site::new(pool.clone()).await;
    let (a, b) = (s.task("A").await, s.task("B").await);
    assert_eq!(s.c.delete(&format!("/api/v1/tasks/{b}")).await.status, StatusCode::NO_CONTENT);
    let c = s.task("C").await;
    assert_eq!((s.label(a).await, s.label(c).await), ("PLX-1".to_owned(), "PLX-3".to_owned()), "PLX-2 не возвращается");

    // и в ряду модуля так же
    let m = s.module("SEO").await;
    s.set_key(m, Some("SEO")).await;
    s.put_in(a, Some(m)).await;
    let d = s.task("D").await;
    s.put_in(d, Some(m)).await;
    assert_eq!(s.c.delete(&format!("/api/v1/tasks/{d}")).await.status, StatusCode::NO_CONTENT);
    assert_eq!(s.put_in(c, Some(m)).await, "SEO-3", "SEO-2 была у удалённой задачи");
    assert_series_rule(&pool).await;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn moving_between_two_keyed_modules_renumbers_and_the_same_module_does_not(pool: PgPool) {
    let s = Site::new(pool.clone()).await;
    let (x, y) = (s.module("X").await, s.module("Y").await);
    s.set_key(x, Some("AAA")).await;
    s.set_key(y, Some("BBB")).await;
    let t = s.task("T").await;
    assert_eq!(s.put_in(t, Some(x)).await, "AAA-1");
    assert_eq!(s.put_in(t, Some(x)).await, "AAA-1", "тот же модуль: ничего не меняется");
    assert_eq!(s.put_in(t, Some(y)).await, "BBB-1", "другой ряд: новый номер");
    assert_eq!(s.put_in(t, None).await, "PLX-2", "из ряда модуля в ряд проекта: новый номер");
    assert_eq!(s.old_ids(t).await, [("PLX".to_owned(), 1), ("AAA".to_owned(), 1), ("BBB".to_owned(), 1)]);
    assert_series_rule(&pool).await;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn other_fields_in_the_same_patch_go_through_with_the_module(pool: PgPool) {
    let s = Site::new(pool.clone()).await;
    let m = s.module("SEO").await;
    s.set_key(m, Some("SEO")).await;
    let t = s.task("Старое").await;
    let r =
        s.c.patch(&format!("/api/v1/tasks/{t}"), json!({ "module_id": m, "title": "Новое", "priority": "high" })).await;
    let task = s.c.ok(r, StatusCode::OK).await;
    assert_eq!(
        (task["key"].as_str(), task["title"].as_str(), task["priority"].as_str()),
        (Some("SEO-1"), Some("Новое"), Some("high"))
    );
    // карточка на доске показывает тот же id
    let board = s.c.ok(s.c.get(&format!("/api/v1/projects/{}/board", s.project)).await, StatusCode::OK).await;
    assert_eq!(board["tasks"][0]["key"], "SEO-1");
    assert_eq!(board["modules"][0]["key"], "SEO");
}

// ===== Гонки =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn parallel_moves_and_creations_never_repeat_a_number(pool: PgPool) {
    let s = Site::new(pool.clone()).await;
    let m = s.module("SEO").await;
    s.set_key(m, Some("SEO")).await;
    let mut tasks = Vec::new();
    for i in 0..8 {
        tasks.push(s.task(&format!("Задача {i}")).await);
    }

    let site = &s;
    let moves =
        join_all(tasks.iter().map(|&t| async move {
            site.c.patch(&format!("/api/v1/tasks/{t}"), json!({ "module_id": m })).await.status
        }));
    let creates = join_all((0..4).map(|i| async move {
        site.c
            .post(&format!("/api/v1/projects/{}/tasks", site.project), json!({ "title": format!("Новая {i}") }))
            .await
            .status
    }));
    let (moved, created) = tokio::join!(moves, creates);
    assert!(moved.iter().all(|c| *c == StatusCode::OK), "{moved:?}");
    assert!(created.iter().all(|c| *c == StatusCode::CREATED), "{created:?}");

    let mut numbers: Vec<i32> = db::sqlx::query_scalar("select number from tasks where series_module_id = $1")
        .bind(m)
        .fetch_all(&pool)
        .await
        .unwrap();
    numbers.sort();
    assert_eq!(numbers, (1..=8).collect::<Vec<_>>(), "в ряду модуля ровно 1..8, без дыр и повторов");
    assert_series_rule(&pool).await;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn two_modules_racing_for_one_key_give_one_winner(pool: PgPool) {
    let s = Site::new(pool.clone()).await;
    let (a, b) = (s.module("A").await, s.module("B").await);
    for _ in 0..2 {
        let t = s.task("T").await;
        s.put_in(t, Some(a)).await;
    }
    let (ra, rb) = tokio::join!(s.key_reply(a, "DUP"), s.key_reply(b, "DUP"));
    let mut statuses = [ra.status, rb.status];
    statuses.sort();
    assert_eq!(statuses, [StatusCode::OK, StatusCode::CONFLICT]);
    assert_series_rule(&pool).await;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn racing_key_changes_leave_the_series_consistent(pool: PgPool) {
    let s = Site::new(pool.clone()).await;
    let m = s.module("SEO").await;
    let mut tasks = Vec::new();
    for _ in 0..4 {
        let t = s.task("T").await;
        s.put_in(t, Some(m)).await;
        tasks.push(t);
    }
    // ключ то появляется, то пропадает, пока задачи туда-сюда переносятся
    let site = &s;
    let keys = join_all(["AAA", "", "BBB", "", "CCC"].map(|k| async move { site.key_reply(m, k).await.status }));
    let moves = join_all(tasks.iter().enumerate().map(|(i, &t)| async move {
        let module = if i % 2 == 0 { Value::Null } else { json!(m) };
        site.c.patch(&format!("/api/v1/tasks/{t}"), json!({ "module_id": module })).await.status
    }));
    let (keys, moves) = tokio::join!(keys, moves);
    assert!(keys.iter().chain(moves.iter()).all(|c| *c == StatusCode::OK), "{keys:?} {moves:?}");
    assert_series_rule(&pool).await;
}

// ===== Вся база =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn the_seeded_database_follows_the_rule_and_keeps_its_ids(pool: PgPool) {
    let today = Date::from_calendar_date(2026, Month::October, 18).unwrap();
    let options = SeedOptions {
        today,
        now: OffsetDateTime::new_utc(today, Time::from_hms(15, 0, 0).unwrap()),
        password: "dev".into(),
    };
    seed(&pool, &options).await.unwrap();
    assert_series_rule(&pool).await;
    let labels: Vec<String> = db::sqlx::query_scalar(
        "select p.key || '-' || t.number from tasks t join projects p on p.id = t.project_id \
         where p.key = 'WEB' and t.number in (139, 141, 144) order by t.number",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(labels, ["WEB-139", "WEB-141", "WEB-144"], "демо-данные и эталонные снимки прежние");
}
