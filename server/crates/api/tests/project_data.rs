//! Документы и ссылки принадлежат проекту (этап П5, docs/PROJECTS.md, раздел 2): у каждого проекта свои списки и свой
//! порядок, участник другого проекта и бывший участник их не видят, события о документах попадают в ленту только своего
//! проекта. Обход всех адресов (все они помечены как данные проекта) лежит в `access.rs`.

mod common;

use axum::http::StatusCode;
use common::*;
use db::PgPool;
use serde_json::{Value, json};
use uuid::Uuid;

/// Два проекта, оба с одним администратором, и человек, который состоит только во втором
struct Two {
    c: Ctx,
    a: Uuid,
    b: Uuid,
    /// Участник только проекта B
    only_b: Ctx,
}

impl Two {
    async fn new(pool: PgPool) -> Two {
        let c = Ctx::new(pool.clone()).await;
        let a = make_project(&pool, "WEB", "Web-приложение", "accent").await;
        let b = make_project(&pool, "API", "Мобильный API", "warn").await;
        let only_b = c.another("only-b@example.com", "Только Б").await;
        join(&pool, b, only_b.user.id, "member").await;
        Two { c, a, b, only_b }
    }

    fn docs(project: Uuid) -> String {
        format!("/api/v1/projects/{project}/docs")
    }

    fn groups(project: Uuid) -> String {
        format!("/api/v1/projects/{project}/link-groups")
    }

    async fn doc(&self, project: Uuid, title: &str) -> Value {
        self.c.ok(self.c.post(&Two::docs(project), json!({ "title": title })).await, StatusCode::CREATED).await
    }

    async fn titles(&self, who: &Ctx, project: Uuid) -> Vec<String> {
        let list = who.ok(who.get(&Two::docs(project)).await, StatusCode::OK).await;
        list.as_array().unwrap().iter().map(|d| str_field(d, "title").to_owned()).collect()
    }
}

// ===== Документы =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn each_project_has_its_own_documents_and_its_own_order(pool: PgPool) {
    let t = Two::new(pool).await;
    let first = t.doc(t.a, "А-1").await;
    t.doc(t.a, "А-2").await;
    t.doc(t.a, "А-3").await;
    t.doc(t.b, "Б-1").await;
    t.doc(t.b, "Б-2").await;

    // новые документы встают первыми, у каждого проекта в своём списке
    assert_eq!(t.titles(&t.c, t.a).await, ["А-3", "А-2", "А-1"]);
    assert_eq!(t.titles(&t.c, t.b).await, ["Б-2", "Б-1"]);
    assert_eq!(first["project_id"], t.a.to_string());

    // перенос в проекте A не двигает B
    let a1 = id_of(&first);
    let r = t.c.patch(&format!("/api/v1/docs/{a1}"), json!({ "before_id": null })).await;
    t.c.ok(r, StatusCode::OK).await;
    assert_eq!(t.titles(&t.c, t.a).await, ["А-3", "А-2", "А-1"], "А-1 и так последний");
    let list = t.c.ok(t.c.get(&Two::docs(t.a)).await, StatusCode::OK).await;
    let a3 = id_of(&list[0]);
    let r = t.c.patch(&format!("/api/v1/docs/{a3}"), json!({ "before_id": null })).await;
    t.c.ok(r, StatusCode::OK).await;
    assert_eq!(t.titles(&t.c, t.a).await, ["А-2", "А-1", "А-3"]);
    assert_eq!(t.titles(&t.c, t.b).await, ["Б-2", "Б-1"], "другой проект не тронут");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_document_cannot_be_placed_before_a_document_of_another_project(pool: PgPool) {
    let t = Two::new(pool).await;
    let mine = t.doc(t.a, "Мой").await;
    let foreign = t.doc(t.b, "Чужой").await;
    let r = t.c.patch(&format!("/api/v1/docs/{}", id_of(&mine)), json!({ "before_id": id_of(&foreign) })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "{}", r.body);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn search_and_stars_work_inside_one_project_only(pool: PgPool) {
    let t = Two::new(pool).await;
    let a = t.doc(t.a, "Схема сервисов").await;
    t.doc(t.b, "Схема базы").await;
    let found = t.c.ok(t.c.get(&format!("{}?q=схема", Two::docs(t.a))).await, StatusCode::OK).await;
    assert_eq!(found.as_array().unwrap().len(), 1, "поиск ищет только в своём проекте");
    t.c.put_json(&format!("/api/v1/docs/{}/star", id_of(&a)), json!({ "starred": true })).await;
    let starred = t.c.ok(t.c.get(&format!("{}?starred=true", Two::docs(t.b))).await, StatusCode::OK).await;
    assert_eq!(starred, json!([]), "звёздочка документа проекта A не видна в B");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_member_of_another_project_sees_nothing_of_this_ones_documents(pool: PgPool) {
    let t = Two::new(pool).await;
    let doc = t.doc(t.a, "Секрет").await;
    let d = id_of(&doc);
    let who = &t.only_b;

    assert_eq!(who.get(&Two::docs(t.a)).await.status, StatusCode::NOT_FOUND, "список");
    assert_eq!(
        who.post(&Two::docs(t.a), json!({ "title": "Подкинул" })).await.status,
        StatusCode::NOT_FOUND,
        "создание"
    );
    assert_eq!(who.get(&format!("/api/v1/docs/{d}")).await.status, StatusCode::NOT_FOUND, "чтение");
    let r = who.patch(&format!("/api/v1/docs/{d}"), json!({ "title": "Взлом", "rev": 1 })).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND, "правка");
    assert_eq!(who.delete(&format!("/api/v1/docs/{d}")).await.status, StatusCode::NOT_FOUND, "удаление");
    let canvas = json!({ "note": { "x": 24.0, "y": 28.0, "w": 400.0 }, "objects": [], "links": [] });
    assert_eq!(who.put_json(&format!("/api/v1/docs/{d}/canvas"), canvas).await.status, StatusCode::NOT_FOUND, "холст");
    let r = who.put_json(&format!("/api/v1/docs/{d}/star"), json!({ "starred": true })).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND, "звёздочка");

    // ничего не изменилось
    let still = t.c.ok(t.c.get(&format!("/api/v1/docs/{d}")).await, StatusCode::OK).await;
    assert_eq!((still["title"].as_str(), still["rev"].as_i64()), (Some("Секрет"), Some(1)));
    assert_eq!(t.titles(&t.c, t.a).await, ["Секрет"]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_member_who_left_loses_the_documents_and_a_member_who_joined_gets_them(pool: PgPool) {
    let t = Two::new(pool.clone()).await;
    let doc = t.doc(t.a, "Общий").await;
    let d = id_of(&doc);
    let guest = t.c.another("guest@example.com", "Гость").await;
    assert_eq!(guest.get(&format!("/api/v1/docs/{d}")).await.status, StatusCode::NOT_FOUND);

    join(&pool, t.a, guest.user.id, "member").await;
    assert_eq!(guest.get(&format!("/api/v1/docs/{d}")).await.status, StatusCode::OK);
    assert_eq!(t.titles(&guest, t.a).await, ["Общий"]);

    let r = t.c.delete(&format!("/api/v1/projects/{}/members/{}", t.a, guest.user.id)).await;
    assert_eq!(r.status, StatusCode::NO_CONTENT);
    assert_eq!(guest.get(&format!("/api/v1/docs/{d}")).await.status, StatusCode::NOT_FOUND, "вышел: документов нет");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn document_events_go_to_the_feed_of_their_project_only(pool: PgPool) {
    let t = Two::new(pool.clone()).await;
    let doc = t.doc(t.a, "Схема").await;
    t.c.ok(t.c.post(&t.c.wiki_url(), json!({ "title": "Общая" })).await, StatusCode::CREATED).await;
    assert_eq!(t.c.delete(&format!("/api/v1/docs/{}", id_of(&doc))).await.status, StatusCode::NO_CONTENT);

    let feed = |project: Uuid| {
        let c = &t.c;
        async move {
            let page = c.ok(c.get(&format!("/api/v1/projects/{project}/activity")).await, StatusCode::OK).await;
            page["items"].as_array().unwrap().iter().map(|e| str_field(e, "target").to_owned()).collect::<Vec<_>>()
        }
    };
    let own = feed(t.a).await;
    assert_eq!(own.iter().filter(|x| x.as_str() == "Документ «Схема»").count(), 2, "создан и удалён: {own:?}");
    assert!(own.contains(&"Страница «Общая»".to_owned()), "общие события тоже: {own:?}");
    let foreign = feed(t.b).await;
    assert!(!foreign.iter().any(|x| x.contains("Схема")), "в ленте другого проекта документа нет: {foreign:?}");
    assert!(foreign.contains(&"Страница «Общая»".to_owned()), "а вики есть: {foreign:?}");

    let project_of_events: Vec<Option<Uuid>> =
        db::sqlx::query_scalar("select project_id from activity where kind = 'doc' and target like 'Документ%'")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(project_of_events, [Some(t.a), Some(t.a)]);
}

// ===== Ссылки =====

async fn group(t: &Two, project: Uuid, title: &str) -> Value {
    t.c.ok(t.c.post(&Two::groups(project), json!({ "title": title })).await, StatusCode::CREATED).await
}

async fn group_titles(who: &Ctx, project: Uuid) -> Vec<String> {
    let list = who.ok(who.get(&Two::groups(project)).await, StatusCode::OK).await;
    list.as_array().unwrap().iter().map(|g| str_field(g, "title").to_owned()).collect()
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn each_project_has_its_own_link_groups_and_links(pool: PgPool) {
    let t = Two::new(pool).await;
    let code = group(&t, t.a, "Код").await;
    group(&t, t.a, "Мониторинг").await;
    group(&t, t.b, "Дизайн").await;
    let r = t
        .c
        .post(&format!("/api/v1/link-groups/{}/links", id_of(&code)), json!({ "title": "Репо", "url": "example.com" }))
        .await;
    t.c.ok(r, StatusCode::CREATED).await;

    assert_eq!(group_titles(&t.c, t.a).await, ["Код", "Мониторинг"]);
    assert_eq!(group_titles(&t.c, t.b).await, ["Дизайн"]);
    let list = t.c.ok(t.c.get(&Two::groups(t.a)).await, StatusCode::OK).await;
    assert_eq!(list[0]["links"].as_array().unwrap().len(), 1);
    let other = t.c.ok(t.c.get(&Two::groups(t.b)).await, StatusCode::OK).await;
    assert_eq!(other[0]["links"], json!([]), "ссылки проекта A в B не попадают");

    // порядок новых групп считается внутри проекта: первая группа B стоит первой, а не после групп A
    let positions: Vec<f64> = db::sqlx::query_scalar("select position from link_groups where project_id = $1")
        .bind(t.b)
        .fetch_all(&t.c.pool)
        .await
        .unwrap();
    assert_eq!(positions, [1024.0]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_member_of_another_project_cannot_read_or_change_links(pool: PgPool) {
    let t = Two::new(pool).await;
    let g = group(&t, t.a, "Код").await;
    let link =
        t.c.ok(
            t.c.post(
                &format!("/api/v1/link-groups/{}/links", id_of(&g)),
                json!({ "title": "Репо", "url": "example.com" }),
            )
            .await,
            StatusCode::CREATED,
        )
        .await;
    let who = &t.only_b;

    assert_eq!(who.get(&Two::groups(t.a)).await.status, StatusCode::NOT_FOUND, "список");
    assert_eq!(who.post(&Two::groups(t.a), json!({ "title": "Подкинул" })).await.status, StatusCode::NOT_FOUND);
    let r = who.patch(&format!("/api/v1/link-groups/{}", id_of(&g)), json!({ "title": "Взлом" })).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND, "переименование");
    let r = who.post(&format!("/api/v1/link-groups/{}/links", id_of(&g)), json!({ "title": "Х", "url": "x.io" })).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND, "новая ссылка");
    assert_eq!(who.delete(&format!("/api/v1/links/{}", id_of(&link))).await.status, StatusCode::NOT_FOUND, "ссылка");
    assert_eq!(who.delete(&format!("/api/v1/link-groups/{}", id_of(&g))).await.status, StatusCode::NOT_FOUND, "группа");

    let list = t.c.ok(t.c.get(&Two::groups(t.a)).await, StatusCode::OK).await;
    assert_eq!(
        (list[0]["title"].as_str(), list[0]["links"].as_array().unwrap().len()),
        (Some("Код"), 1),
        "всё на месте"
    );
}

// ===== Файлы =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn task_attachments_stay_out_of_the_library_and_out_of_reach_of_other_projects(pool: PgPool) {
    let t = Two::new(pool).await;
    let col = id_of(
        &t.c.ok(
            t.c.post(&format!("/api/v1/projects/{}/columns", t.a), json!({ "title": "Колонка" })).await,
            StatusCode::CREATED,
        )
        .await,
    );
    let task =
        t.c.ok(
            t.c.post(&format!("/api/v1/projects/{}/tasks", t.a), json!({ "title": "Задача", "column_id": col })).await,
            StatusCode::CREATED,
        )
        .await;
    let attached =
        t.c.ok(
            t.c.upload(&format!("/api/v1/tasks/{}/files", id_of(&task)), &[file_part("секрет.txt", b"abc")]).await,
            StatusCode::CREATED,
        )
        .await;

    // в библиотеке файлов вложения задач нет ни у автора, ни у участника другого проекта
    for who in [&t.c, &t.only_b] {
        let library = who.ok(who.get(&who.files_url()).await, StatusCode::OK).await;
        assert_eq!(library["total"], 0);
        assert_eq!(library["files"], json!([]));
    }
    // и скачать его может только участник проекта задачи
    let uri = format!("/api/v1/files/{}/download", id_of(&attached[0]));
    assert_eq!(t.c.download(&uri).await.status, StatusCode::OK);
    assert_eq!(t.only_b.download(&uri).await.status, StatusCode::NOT_FOUND);
}
