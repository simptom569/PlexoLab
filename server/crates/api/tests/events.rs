//! События для живых обновлений: какие ручки что рассылают. Слушаем канал событий напрямую; как они доходят до
//! клиентов по WebSocket, проверяет realtime.rs. Сверка таблицы со всеми ручками схемы лежит в `events.rs` самого
//! крейта (модульный тест).

mod common;

use axum::http::{Method, StatusCode};
use common::*;
use db::PgPool;
use serde_json::{Value, json};
use uuid::Uuid;

type Ev = (&'static str, Option<Uuid>, Option<Uuid>);

/// Событие записи: тип и её id
fn on(kind: &'static str, id: Uuid) -> Ev {
    (kind, Some(id), None)
}

/// Событие без id: «перечитайте всё такого рода»
fn all(kind: &'static str) -> Ev {
    (kind, None, None)
}

/// Событие проекта (создание записи по адресу `/projects/{id}/...`)
fn in_project(kind: &'static str, project: Uuid) -> Ev {
    (kind, None, Some(project))
}

/// Событие записи проекта: тип, id записи и проект, события которого получают только участники
fn pon(project: Uuid, kind: &'static str, id: Uuid) -> Ev {
    (kind, Some(id), Some(project))
}

/// Событие проекта без id записи: «перечитайте всё такого рода»
fn pall(project: Uuid, kind: &'static str) -> Ev {
    (kind, None, Some(project))
}

const ACTIVITY: &str = "activity.created";

fn url(path: &str) -> String {
    format!("/api/v1{path}")
}

// ===== Доска =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn board_changes_send_events(pool: PgPool) {
    let f = Fx::new(pool).await;
    let c = &f.c;
    let mut rx = c.events.subscribe();
    let p = f.project;

    // колонка
    let col = c
        .ok(c.post(&url(&format!("/projects/{p}/columns")), json!({ "title": "Ревью" })).await, StatusCode::CREATED)
        .await;
    assert_eq!(drain(&mut rx), [in_project("column.changed", p)]);
    c.ok(c.patch(&url(&format!("/columns/{}", id_of(&col))), json!({ "title": "На ревью" })).await, StatusCode::OK)
        .await;
    assert_eq!(drain(&mut rx), [pon(p, "column.changed", id_of(&col))]);

    // задача: создание — событие проекта, правка и удаление — события самой задачи
    let task = f.task(Some(f.todo), "Новая").await;
    assert_eq!(drain(&mut rx), [in_project("task.created", p), in_project(ACTIVITY, p)]);
    let t = id_of(&task);
    c.ok(c.patch(&url(&format!("/tasks/{t}")), json!({ "title": "Переименована" })).await, StatusCode::OK).await;
    assert_eq!(drain(&mut rx), [pon(p, "task.updated", t), pall(p, ACTIVITY)]);
    c.ok(
        c.patch(&url(&format!("/tasks/{t}")), json!({ "column_id": f.doing, "before_id": null })).await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(
        drain(&mut rx),
        [pon(p, "task.updated", t), pall(p, ACTIVITY)],
        "перенос идёт тем же PATCH и тем же событием"
    );

    // подзадачи и комментарии
    let sub =
        c.ok(c.post(&url(&format!("/tasks/{t}/subtasks")), json!({ "title": "шаг" })).await, StatusCode::CREATED).await;
    assert_eq!(drain(&mut rx), [pon(p, "task.updated", t)]);
    c.ok(c.patch(&url(&format!("/subtasks/{}", id_of(&sub))), json!({ "done": true })).await, StatusCode::OK).await;
    assert_eq!(drain(&mut rx), [pall(p, "task.updated")], "id задачи по подзадаче сервер не знает: перечитать все");
    assert_eq!(c.delete(&url(&format!("/subtasks/{}", id_of(&sub)))).await.status, StatusCode::NO_CONTENT);
    assert_eq!(drain(&mut rx), [pall(p, "task.updated")]);
    c.ok(c.post(&url(&format!("/tasks/{t}/comments")), json!({ "body": "привет" })).await, StatusCode::CREATED).await;
    assert_eq!(drain(&mut rx), [pon(p, "comment.created", t), pall(p, ACTIVITY)]);

    // метки
    let tag =
        c.ok(c.post(&url(&format!("/projects/{p}/tags")), json!({ "label": "Баг" })).await, StatusCode::CREATED).await;
    assert_eq!(drain(&mut rx), [pall(p, "tag.changed")]);
    assert_eq!(c.delete(&url(&format!("/tags/{}", id_of(&tag)))).await.status, StatusCode::NO_CONTENT);
    assert_eq!(drain(&mut rx), [pon(p, "tag.changed", id_of(&tag)), pall(p, "task.updated")], "метка снята с задач");

    // удаление задачи и колонки (задачи колонки переезжают)
    assert_eq!(c.delete(&url(&format!("/tasks/{t}"))).await.status, StatusCode::NO_CONTENT);
    assert_eq!(drain(&mut rx), [pon(p, "task.deleted", t), pall(p, ACTIVITY)]);
    let uri = url(&format!("/columns/{}?move_to={}", id_of(&col), f.todo));
    assert_eq!(c.delete(&uri).await.status, StatusCode::NO_CONTENT);
    assert_eq!(drain(&mut rx), [pon(p, "column.changed", id_of(&col)), pall(p, "task.moved")]);
}

// ===== Модули, вехи, релизы =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn work_changes_send_events(pool: PgPool) {
    let f = Fx::new(pool).await;
    let c = &f.c;
    let mut rx = c.events.subscribe();
    let p = f.project;

    let module = c
        .ok(c.post(&url(&format!("/projects/{p}/modules")), json!({ "title": "SSO" })).await, StatusCode::CREATED)
        .await;
    assert_eq!(drain(&mut rx), [in_project("module.changed", p), in_project(ACTIVITY, p)]);
    let m = id_of(&module);
    c.ok(c.patch(&url(&format!("/modules/{m}")), json!({ "status": "progress" })).await, StatusCode::OK).await;
    assert_eq!(drain(&mut rx), [pon(p, "module.changed", m), pall(p, "task.updated"), pall(p, ACTIVITY)]);
    assert_eq!(c.delete(&url(&format!("/modules/{m}"))).await.status, StatusCode::NO_CONTENT);
    assert_eq!(
        drain(&mut rx),
        [pon(p, "module.changed", m), pall(p, "task.updated"), pall(p, ACTIVITY)],
        "задачи остаются без модуля"
    );

    let ms = c
        .ok(
            c.post(&url(&format!("/projects/{p}/milestones")), json!({ "title": "Бета", "due_date": "2026-11-03" }))
                .await,
            StatusCode::CREATED,
        )
        .await;
    assert_eq!(drain(&mut rx), [in_project("milestone.changed", p), in_project(ACTIVITY, p)]);
    let w = id_of(&ms);
    c.ok(c.patch(&url(&format!("/milestones/{w}")), json!({ "title": "Бета 2" })).await, StatusCode::OK).await;
    assert_eq!(drain(&mut rx), [pon(p, "milestone.changed", w)]);
    assert_eq!(c.delete(&url(&format!("/milestones/{w}"))).await.status, StatusCode::NO_CONTENT);
    assert_eq!(drain(&mut rx), [pon(p, "milestone.changed", w), pall(p, "task.updated"), pall(p, ACTIVITY)]);

    let release = c
        .ok(
            c.post(
                &url(&format!("/projects/{p}/releases")),
                json!({ "version": "2.9.0", "release_date": "2026-11-20" }),
            )
            .await,
            StatusCode::CREATED,
        )
        .await;
    assert_eq!(drain(&mut rx), [in_project("release.changed", p), in_project(ACTIVITY, p)]);
    let r = id_of(&release);
    c.ok(c.patch(&url(&format!("/releases/{r}")), json!({ "status": "progress" })).await, StatusCode::OK).await;
    assert_eq!(drain(&mut rx), [pon(p, "release.changed", r), pall(p, ACTIVITY)]);
    let item =
        c.ok(c.post(&url(&format!("/releases/{r}/items")), json!({ "title": "Шаг" })).await, StatusCode::CREATED).await;
    assert_eq!(drain(&mut rx), [pon(p, "release.changed", r)]);
    c.ok(c.patch(&url(&format!("/release-items/{}", id_of(&item))), json!({ "done": true })).await, StatusCode::OK)
        .await;
    assert_eq!(drain(&mut rx), [pall(p, "release.changed"), pall(p, ACTIVITY)]);
    assert_eq!(c.delete(&url(&format!("/release-items/{}", id_of(&item)))).await.status, StatusCode::NO_CONTENT);
    assert_eq!(drain(&mut rx), [pall(p, "release.changed")]);
    assert_eq!(c.delete(&url(&format!("/releases/{r}"))).await.status, StatusCode::NO_CONTENT);
    assert_eq!(drain(&mut rx), [pon(p, "release.changed", r), pall(p, ACTIVITY)]);
}

// ===== Вики и документы =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn wiki_and_doc_changes_send_events(pool: PgPool) {
    let f = Fx::new(pool).await;
    let c = &f.c;
    let mut rx = c.events.subscribe();
    let p = f.project;

    let page = c.ok(c.post(&c.wiki_url(), json!({ "title": "Архитектура" })).await, StatusCode::CREATED).await;
    assert_eq!(drain(&mut rx), [all("wiki.updated"), all(ACTIVITY)]);
    let w = id_of(&page);
    c.ok(c.patch(&url(&format!("/wiki/{w}")), json!({ "rev": page["rev"], "md": "текст" })).await, StatusCode::OK)
        .await;
    assert_eq!(drain(&mut rx), [on("wiki.updated", w), all(ACTIVITY)]);
    assert_eq!(c.delete(&url(&format!("/wiki/{w}"))).await.status, StatusCode::NO_CONTENT);
    assert_eq!(
        drain(&mut rx),
        [on("wiki.updated", w), all("file.changed"), all(ACTIVITY)],
        "файлы страницы открепились"
    );

    let doc = c
        .ok(
            c.post(&url(&format!("/projects/{p}/docs")), json!({ "title": "Схема", "mode": "edge" })).await,
            StatusCode::CREATED,
        )
        .await;
    assert_eq!(
        drain(&mut rx),
        [in_project("doc.updated", p), in_project(ACTIVITY, p)],
        "документ принадлежит проекту: событие только его участникам"
    );
    let d = id_of(&doc);
    c.ok(c.patch(&url(&format!("/docs/{d}")), json!({ "rev": doc["rev"], "md": "текст" })).await, StatusCode::OK).await;
    assert_eq!(drain(&mut rx), [pon(p, "doc.updated", d), pall(p, ACTIVITY)]);
    c.ok(c.patch(&url(&format!("/docs/{d}")), json!({ "mode": "page" })).await, StatusCode::OK).await;
    assert_eq!(drain(&mut rx), [pon(p, "doc.updated", d), pall(p, ACTIVITY)]);
    let canvas = json!({ "note": { "x": 24.0, "y": 28.0, "w": 400.0 }, "objects": [], "links": [] });
    c.ok(c.put_json(&url(&format!("/docs/{d}/canvas")), canvas).await, StatusCode::OK).await;
    assert_eq!(drain(&mut rx), [pon(p, "doc.canvas", d)], "холст: отдельное событие, и в ленту он не пишет");
    assert_eq!(
        c.put_json(&url(&format!("/docs/{d}/star")), json!({ "starred": true })).await.status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(drain(&mut rx), [pon(p, "doc.updated", d)]);
    assert_eq!(c.delete(&url(&format!("/docs/{d}"))).await.status, StatusCode::NO_CONTENT);
    assert_eq!(drain(&mut rx), [pon(p, "doc.updated", d), pall(p, ACTIVITY)]);
}

// ===== Файлы =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn file_changes_send_events(pool: PgPool) {
    let f = Fx::new(pool).await;
    let c = &f.c;
    let p = f.project;
    let task = f.task(Some(f.todo), "С файлом").await;
    let mut rx = c.events.subscribe();

    // загрузка отвечает списком загруженных файлов
    let uploaded = c.ok(c.upload(&c.files_url(), &[file_part("план.txt", b"1")]).await, StatusCode::CREATED).await;
    let file = uploaded[0].clone();
    assert_eq!(drain(&mut rx), [all("file.changed"), all(ACTIVITY)]);
    assert_eq!(c.delete(&url(&format!("/files/{}", id_of(&file)))).await.status, StatusCode::NO_CONTENT);
    assert_eq!(drain(&mut rx), [on("file.changed", id_of(&file)), all(ACTIVITY)]);

    let t = id_of(&task);
    c.ok(c.upload(&url(&format!("/tasks/{t}/files")), &[file_part("a.txt", b"1")]).await, StatusCode::CREATED).await;
    assert_eq!(drain(&mut rx), [pon(p, "task.updated", t), pall(p, "file.changed"), pall(p, ACTIVITY)]);

    let folder = c.ok(c.post(&c.folders_url(), json!({ "name": "Договоры" })).await, StatusCode::CREATED).await;
    assert_eq!(drain(&mut rx), [all("file.changed")]);
    assert_eq!(c.delete(&url(&format!("/folders/{}", id_of(&folder)))).await.status, StatusCode::NO_CONTENT);
    assert_eq!(drain(&mut rx), [all("file.changed")]);
}

// ===== Ссылки =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn link_changes_send_events(pool: PgPool) {
    let f = Fx::new(pool).await;
    let c = &f.c;
    let mut rx = c.events.subscribe();
    let p = f.project;

    let group = c
        .ok(c.post(&url(&format!("/projects/{p}/link-groups")), json!({ "title": "Код" })).await, StatusCode::CREATED)
        .await;
    assert_eq!(drain(&mut rx), [in_project("link.changed", p)]);
    let g = id_of(&group);
    c.ok(c.patch(&url(&format!("/link-groups/{g}")), json!({ "title": "Код и сборка" })).await, StatusCode::OK).await;
    assert_eq!(drain(&mut rx), [pon(p, "link.changed", g)]);
    let link = c
        .ok(
            c.post(&url(&format!("/link-groups/{g}/links")), json!({ "title": "Репо", "url": "example.com" })).await,
            StatusCode::CREATED,
        )
        .await;
    assert_eq!(drain(&mut rx), [pon(p, "link.changed", g)]);
    assert_eq!(c.delete(&url(&format!("/links/{}", id_of(&link)))).await.status, StatusCode::NO_CONTENT);
    assert_eq!(drain(&mut rx), [pall(p, "link.changed")]);
    assert_eq!(c.delete(&url(&format!("/link-groups/{g}"))).await.status, StatusCode::NO_CONTENT);
    assert_eq!(drain(&mut rx), [pon(p, "link.changed", g)]);
}

// ===== Когда событий быть не должно =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn reads_and_failed_requests_send_nothing(pool: PgPool) {
    let f = Fx::new(pool).await;
    let c = &f.c;
    let task = f.task(Some(f.todo), "Задача").await;
    let t = id_of(&task);
    let mut rx = c.events.subscribe();

    // чтение
    for path in [
        format!("/projects/{}/board", f.project),
        format!("/tasks/{t}"),
        format!("/projects/{}/activity", f.project),
        format!("/projects/{}/link-groups", f.project),
        format!("/projects/{}/docs", f.project),
        format!("/teams/{}/wiki", c.team),
    ] {
        c.ok(c.get(&url(&path)).await, StatusCode::OK).await;
    }
    assert_eq!(drain(&mut rx), []);

    // отказы: плохое тело, нет такой записи, чужая версия, без токена
    assert_eq!(
        c.post(&url(&format!("/projects/{}/tasks", f.project)), json!({ "title": "  " })).await.status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        c.patch(&url(&format!("/tasks/{}", Uuid::new_v4())), json!({ "title": "x" })).await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(c.delete(&url(&format!("/links/{}", Uuid::new_v4()))).await.status, StatusCode::NOT_FOUND);
    let page = c.ok(c.post(&c.wiki_url(), json!({ "title": "П" })).await, StatusCode::CREATED).await;
    drain(&mut rx);
    let stale = c.patch(&url(&format!("/wiki/{}", id_of(&page))), json!({ "rev": 99, "md": "x" })).await;
    assert_eq!(stale.status, StatusCode::CONFLICT);
    let anonymous =
        send(&c.app, Method::PATCH, &url(&format!("/tasks/{t}")), Some(json!({ "title": "x" })), None).await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);
    assert_eq!(drain(&mut rx), [], "ошибка не рассылает событий: ничего не изменилось");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn login_sends_nothing(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let mut rx = c.events.subscribe();
    login_ok(&c.app, "tester@example.com", "test-password").await;
    assert_eq!(drain(&mut rx), []);
}

// ===== Метка клиента =====

fn origin_of(event: &Value) -> Option<&str> {
    event["origin"].as_str()
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn event_carries_the_client_id_from_the_request(pool: PgPool) {
    let f = Fx::new(pool).await;
    let c = &f.c;
    let mut rx = c.events.subscribe();
    let groups = url(&format!("/projects/{}/link-groups", f.project));

    let cases: [(Option<&str>, Option<&str>); 4] = [
        (Some("client-1_A"), Some("client-1_A")),
        (Some("с пробелом и кириллицей"), None), // ненадёжная метка игнорируется, событие всё равно идёт
        (Some(&"x".repeat(65)), None),
        (None, None),
    ];
    for (header, expected) in cases {
        let r = match header {
            Some(h) => c.send_as(h, Method::POST, &groups, Some(json!({ "title": "Группа" }))).await,
            None => c.post(&groups, json!({ "title": "Группа" })).await,
        };
        c.ok(r, StatusCode::CREATED).await;
        let event = rx.try_recv().expect("событие пришло");
        let json = serde_json::to_value(&*event).unwrap();
        assert_eq!(origin_of(&json), expected, "заголовок {header:?}");
        assert_eq!(json["type"], "link.changed");
    }
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn event_serializes_with_all_keys(pool: PgPool) {
    let f = Fx::new(pool).await;
    let mut rx = f.c.events.subscribe();
    let r =
        f.c.send_as("c1", Method::POST, &url(&format!("/projects/{}/tasks", f.project)), Some(json!({ "title": "T" })))
            .await;
    f.c.ok(r, StatusCode::CREATED).await;
    let event = serde_json::to_value(&*rx.try_recv().unwrap()).unwrap();
    assert_eq!(
        event,
        json!({ "type": "task.created", "id": null, "project_id": f.project.to_string(), "origin": "c1" })
    );
}
