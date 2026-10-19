//! Страницы вики: дерево, версии (`rev`) и конфликт 409, перенос, удаление, запись в ленту. На настоящем Postgres.

mod common;

use axum::http::StatusCode;
use common::*;
use db::PgPool;
use serde_json::{Value, json};
use uuid::Uuid;

fn ev(kind: &str, target: &str, text: &str) -> (String, String, String) {
    (kind.to_owned(), target.to_owned(), text.to_owned())
}

impl Ctx {
    async fn page(&self, parent: Option<Uuid>, title: &str) -> Value {
        let r = self.post("/api/v1/wiki", json!({ "parent_id": parent, "title": title })).await;
        self.ok(r, StatusCode::CREATED).await
    }

    async fn save(&self, page: &Value, body: Value) -> Reply {
        let mut body = body;
        body["rev"] = page["rev"].clone();
        self.patch(&format!("/api/v1/wiki/{}", id_of(page)), body).await
    }

    async fn tree(&self) -> Value {
        let r = self.get("/api/v1/wiki").await;
        self.ok(r, StatusCode::OK).await
    }

    async fn titles(&self) -> Vec<String> {
        self.tree().await.as_array().unwrap().iter().map(|p| str_field(p, "title").to_owned()).collect()
    }

    async fn feed(&self) -> Vec<(String, String, String)> {
        db::sqlx::query_as("select kind::text, target, text from activity order by created_at, text")
            .fetch_all(&self.pool)
            .await
            .unwrap()
    }
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn wiki_needs_a_token(pool: PgPool) {
    let app = app(pool);
    let id = Uuid::new_v4();
    for (method, uri) in [
        (axum::http::Method::GET, "/api/v1/wiki".to_owned()),
        (axum::http::Method::POST, "/api/v1/wiki".to_owned()),
        (axum::http::Method::GET, format!("/api/v1/wiki/{id}")),
        (axum::http::Method::PATCH, format!("/api/v1/wiki/{id}")),
        (axum::http::Method::DELETE, format!("/api/v1/wiki/{id}")),
    ] {
        let r = send(&app, method.clone(), &uri, Some(json!({})), None).await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED, "{method} {uri}");
    }
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn new_page_is_empty_at_revision_one_and_goes_to_the_feed(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let r = c.post("/api/v1/wiki", json!({})).await;
    let page = c.ok(r, StatusCode::CREATED).await;

    assert_eq!(page["title"], "");
    assert_eq!(page["md"], "");
    assert_eq!(page["rev"], 1);
    assert_eq!(page["parent_id"], Value::Null);
    assert_eq!(page["updated_by"], c.user.id.to_string());

    let named = c.page(None, "  Архитектура  ").await;
    assert_eq!(named["title"], "Архитектура", "пробелы по краям убираются");
    assert_eq!(
        c.feed().await,
        [ev("doc", "Новая страница вики", "создана"), ev("doc", "Страница «Архитектура»", "создана")]
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn tree_keeps_siblings_in_creation_order(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let a = c.page(None, "А").await;
    let b = c.page(None, "Б").await;
    let a1 = c.page(Some(id_of(&a)), "А1").await;
    let a2 = c.page(Some(id_of(&a)), "А2").await;

    let tree = c.tree().await;
    let rows: Vec<(String, Option<String>)> = tree
        .as_array()
        .unwrap()
        .iter()
        .map(|p| (str_field(p, "title").to_owned(), p["parent_id"].as_str().map(str::to_owned)))
        .collect();
    let (a_id, b_id) = (id_of(&a).to_string(), id_of(&b).to_string());
    assert_eq!(rows.iter().filter(|(_, p)| p.is_none()).map(|(t, _)| t.as_str()).collect::<Vec<_>>(), ["А", "Б"]);
    assert_eq!(
        rows.iter().filter(|(_, p)| p.as_deref() == Some(a_id.as_str())).map(|(t, _)| t.as_str()).collect::<Vec<_>>(),
        ["А1", "А2"]
    );
    assert!(rows.iter().all(|(_, p)| p.as_deref() != Some(b_id.as_str())));
    assert!(tree[0].get("md").is_none(), "в дереве текста страниц нет");
    assert!(id_of(&a1) != id_of(&a2));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn page_comes_with_text_and_unknown_page_is_404(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let page = c.page(None, "Заметки").await;
    let r = c.save(&page, json!({ "md": "# Привет\n\nТекст" })).await;
    c.ok(r, StatusCode::OK).await;

    let r = c.get(&format!("/api/v1/wiki/{}", id_of(&page))).await;
    assert_eq!(c.ok(r, StatusCode::OK).await["md"], "# Привет\n\nТекст");
    assert_eq!(c.get(&format!("/api/v1/wiki/{}", Uuid::new_v4())).await.status, StatusCode::NOT_FOUND);
    assert_eq!(c.get("/api/v1/wiki/не-идентификатор").await.status, StatusCode::BAD_REQUEST);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn page_needs_an_existing_parent_and_sane_fields(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let r = c.post("/api/v1/wiki", json!({ "parent_id": Uuid::new_v4() })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "{}", r.body);
    let r = c.post("/api/v1/wiki", json!({ "title": "я".repeat(201) })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let r = c.post("/api/v1/wiki", json!({ "md": "я".repeat(500_001) })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let r = c.post("/api/v1/wiki", json!({ "color": "red" })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "лишнее поле запроса");
    assert!(c.titles().await.is_empty());
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn saving_changes_text_and_title_and_raises_the_revision(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let page = c.page(None, "").await;

    let r = c.save(&page, json!({ "md": "Первая строка\r\nВторая" })).await;
    let page = c.ok(r, StatusCode::OK).await;
    assert_eq!(page["md"], "Первая строка\nВторая", "переводы строк приводятся к \\n");
    assert_eq!(page["rev"], 2);

    let r = c.save(&page, json!({ "title": "Новое название" })).await;
    let page = c.ok(r, StatusCode::OK).await;
    assert_eq!(page["rev"], 3);
    assert_eq!(page["md"], "Первая строка\nВторая", "текст не тронут");
    assert_eq!(c.titles().await, ["Новое название"]);

    // правки текста в ленту не пишутся, только создание
    assert_eq!(c.feed().await, [ev("doc", "Новая страница вики", "создана")]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn saving_the_same_content_keeps_the_revision(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let page = c.page(None, "Тут").await;
    let r = c.save(&page, json!({ "md": "Текст" })).await;
    let page = c.ok(r, StatusCode::OK).await;

    let r = c.save(&page, json!({ "md": "Текст", "title": "Тут" })).await;
    let same = c.ok(r, StatusCode::OK).await;
    assert_eq!(same["rev"], page["rev"]);
    assert_eq!(same["updated_at"], page["updated_at"]);

    let r = c.save(&page, json!({})).await;
    assert_eq!(c.ok(r, StatusCode::OK).await["rev"], page["rev"], "пустой PATCH ничего не меняет");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn stale_revision_gets_409_with_the_current_version(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let page = c.page(None, "Общая").await;

    // два клиента открыли одну и ту же версию
    let mine = page.clone();
    let theirs = page;
    let r = c.save(&theirs, json!({ "md": "Правка соседа" })).await;
    let saved = c.ok(r, StatusCode::OK).await;

    let r = c.save(&mine, json!({ "md": "Моя правка" })).await;
    assert_eq!(r.status, StatusCode::CONFLICT, "{}", r.body);
    assert_eq!(r.body["code"], "conflict");
    assert_eq!(r.body["message"], "Страницу изменил другой участник");
    assert_eq!(r.body["current"]["md"], "Правка соседа");
    assert_eq!(r.body["current"]["rev"], saved["rev"]);

    // «Оставить мою»: тот же текст с актуальной версией
    let r = c.save(&r.body["current"], json!({ "md": "Моя правка" })).await;
    let kept = c.ok(r, StatusCode::OK).await;
    assert_eq!(kept["md"], "Моя правка");
    assert_eq!(kept["rev"], 3);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn two_saves_with_the_same_revision_cannot_both_win(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let page = c.page(None, "Гонка").await;
    let uri = format!("/api/v1/wiki/{}", id_of(&page));

    let (a, b) =
        tokio::join!(c.patch(&uri, json!({ "rev": 1, "md": "А" })), c.patch(&uri, json!({ "rev": 1, "md": "Б" })),);
    let mut statuses = [a.status, b.status];
    statuses.sort();
    assert_eq!(statuses, [StatusCode::OK, StatusCode::CONFLICT]);

    let r = c.get(&uri).await;
    assert_eq!(c.ok(r, StatusCode::OK).await["rev"], 2);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn revision_is_required_and_unknown_fields_are_refused(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let page = c.page(None, "Тест").await;
    let uri = format!("/api/v1/wiki/{}", id_of(&page));

    assert_eq!(c.patch(&uri, json!({ "md": "без версии" })).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(c.patch(&uri, json!({ "rev": 1, "color": "red" })).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(c.patch(&uri, json!({ "rev": 1, "title": "я".repeat(201) })).await.status, StatusCode::BAD_REQUEST);
    let missing = format!("/api/v1/wiki/{}", Uuid::new_v4());
    assert_eq!(c.patch(&missing, json!({ "rev": 1 })).await.status, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn moving_a_page_puts_it_last_under_the_new_parent(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let a = c.page(None, "А").await;
    let b = c.page(None, "Б").await;
    let b1 = c.page(Some(id_of(&b)), "Б1").await;
    let a1 = c.page(Some(id_of(&a)), "А1").await;

    // «А1» переезжает под «Б» после «Б1»
    let r = c.patch(&page_uri(&a1), json!({ "parent_id": id_of(&b) })).await;
    let moved = c.ok(r, StatusCode::OK).await;
    assert_eq!(moved["parent_id"], id_of(&b).to_string());
    assert!(moved["position"].as_f64() > b1["position"].as_f64());

    // в корень
    let r = c.patch(&page_uri(&moved), json!({ "parent_id": null })).await;
    let root = c.ok(r, StatusCode::OK).await;
    assert_eq!(root["parent_id"], Value::Null);
    assert!(root["position"].as_f64() > b["position"].as_f64());
}

fn page_uri(page: &Value) -> String {
    format!("/api/v1/wiki/{}", id_of(page))
}

impl Ctx {
    /// Названия страниц одного родителя в порядке дерева
    async fn children(&self, parent: Option<&Value>) -> Vec<String> {
        let want = parent.map(|p| str_field(p, "id").to_owned());
        self.tree()
            .await
            .as_array()
            .unwrap()
            .iter()
            .filter(|p| p["parent_id"].as_str().map(str::to_owned) == want)
            .map(|p| str_field(p, "title").to_owned())
            .collect()
    }
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn before_id_reorders_pages_among_siblings(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let a = c.page(None, "А").await;
    let b = c.page(None, "Б").await;
    let d = c.page(None, "В").await;
    assert_eq!(c.children(None).await, ["А", "Б", "В"]);

    // «В» встаёт перед «А»
    let r = c.patch(&page_uri(&d), json!({ "before_id": id_of(&a) })).await;
    c.ok(r, StatusCode::OK).await;
    assert_eq!(c.children(None).await, ["В", "А", "Б"]);

    // «В» — в самый конец
    let r = c.patch(&page_uri(&d), json!({ "before_id": null })).await;
    c.ok(r, StatusCode::OK).await;
    assert_eq!(c.children(None).await, ["А", "Б", "В"]);

    // «В» перед «Б»: в середину
    let r = c.patch(&page_uri(&d), json!({ "before_id": id_of(&b) })).await;
    c.ok(r, StatusCode::OK).await;
    assert_eq!(c.children(None).await, ["А", "В", "Б"]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn page_moves_to_another_parent_before_a_given_child(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let a = c.page(None, "А").await;
    let b = c.page(None, "Б").await;
    c.page(Some(id_of(&b)), "Б1").await;
    let b2 = c.page(Some(id_of(&b)), "Б2").await;
    let a1 = c.page(Some(id_of(&a)), "А1").await;

    let r = c.patch(&page_uri(&a1), json!({ "parent_id": id_of(&b), "before_id": id_of(&b2) })).await;
    let moved = c.ok(r, StatusCode::OK).await;
    assert_eq!(moved["parent_id"], id_of(&b).to_string());
    assert_eq!(c.children(Some(&b)).await, ["Б1", "А1", "Б2"]);
    assert!(c.children(Some(&a)).await.is_empty());

    // «Б2» — первым среди вложенных в «Б»
    let first = c.tree().await.as_array().unwrap().iter().find(|p| p["title"] == "Б1").unwrap().clone();
    let r = c.patch(&page_uri(&b2), json!({ "before_id": id_of(&first) })).await;
    c.ok(r, StatusCode::OK).await;
    assert_eq!(c.children(Some(&b)).await, ["Б2", "Б1", "А1"]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn moving_needs_no_revision_and_leaves_it_alone(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let a = c.page(None, "А").await;
    let b = c.page(None, "Б").await;
    let r = c.save(&b, json!({ "md": "Текст Б" })).await;
    let b = c.ok(r, StatusCode::OK).await;
    assert_eq!(b["rev"], 2);

    // перенос без версии проходит, версия, текст и время правки на месте
    let r = c.patch(&page_uri(&b), json!({ "parent_id": id_of(&a) })).await;
    let moved = c.ok(r, StatusCode::OK).await;
    assert_eq!(moved["rev"], 2);
    assert_eq!(moved["md"], "Текст Б");
    assert_eq!(moved["updated_at"], b["updated_at"]);

    // страницу, которую кто-то только что переносил, всё равно можно сохранить со своей версией
    let r = c.patch(&page_uri(&b), json!({ "rev": 2, "md": "Новый текст" })).await;
    let saved = c.ok(r, StatusCode::OK).await;
    assert_eq!(saved["rev"], 3);
    assert_eq!(saved["parent_id"], id_of(&a).to_string());
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn text_and_move_in_one_request_check_the_revision_first(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let a = c.page(None, "А").await;
    let b = c.page(None, "Б").await;

    let r = c.patch(&page_uri(&b), json!({ "rev": 7, "md": "Чужая версия", "parent_id": id_of(&a) })).await;
    assert_eq!(r.status, StatusCode::CONFLICT);
    assert!(c.children(Some(&a)).await.is_empty(), "при конфликте ничего не перенесено");

    let r = c.patch(&page_uri(&b), json!({ "rev": 1, "md": "Текст", "parent_id": id_of(&a) })).await;
    let both = c.ok(r, StatusCode::OK).await;
    assert_eq!(both["rev"], 2);
    assert_eq!(both["parent_id"], id_of(&a).to_string());
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn title_or_text_without_a_revision_is_refused(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let page = c.page(None, "А").await;
    let r = c.patch(&page_uri(&page), json!({ "title": "Новое" })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "{}", r.body);
    let r = c.patch(&page_uri(&page), json!({ "md": "Текст", "parent_id": null })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    // пустой запрос ничего не меняет
    let r = c.patch(&page_uri(&page), json!({})).await;
    assert_eq!(c.ok(r, StatusCode::OK).await["rev"], 1);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn before_id_must_be_a_page_of_the_target_parent(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let a = c.page(None, "А").await;
    let b = c.page(None, "Б").await;
    let a1 = c.page(Some(id_of(&a)), "А1").await;

    // такой страницы нет вообще
    let r = c.patch(&page_uri(&a1), json!({ "parent_id": null, "before_id": Uuid::new_v4() })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "{}", r.body);
    // перед самой собой
    let r = c.patch(&page_uri(&b), json!({ "parent_id": id_of(&a), "before_id": id_of(&b) })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    // страница есть, но стоит у другого родителя
    let r = c.patch(&page_uri(&b), json!({ "before_id": id_of(&a1) })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(c.children(None).await, ["А", "Б"], "ничего не сдвинулось");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn moving_to_the_same_place_changes_nothing(pool: PgPool) {
    let c = Ctx::new(pool).await;
    c.page(None, "А").await;
    let b = c.page(None, "Б").await;
    let d = c.page(None, "В").await;
    let before = c.tree().await;

    // «Б» уже стоит перед «В», а «В» уже в конце
    for body in [json!({ "before_id": id_of(&d) }), json!({ "parent_id": null, "before_id": id_of(&d) })] {
        let r = c.patch(&page_uri(&b), body).await;
        c.ok(r, StatusCode::OK).await;
    }
    let r = c.patch(&page_uri(&d), json!({ "before_id": null })).await;
    c.ok(r, StatusCode::OK).await;
    assert_eq!(c.tree().await, before);
    assert_eq!(c.children(None).await, ["А", "Б", "В"]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn order_survives_many_insertions_into_the_same_gap(pool: PgPool) {
    let c = Ctx::new(pool).await;
    c.page(None, "Первая").await;
    let last = c.page(None, "Последняя").await;
    let mut expected = vec!["Первая".to_owned(), "Последняя".to_owned()];

    // каждая новая страница встаёт перед «Последней»: зазор делится пополам, пока позиции не придётся пересчитать
    for i in 0..45 {
        let title = format!("Вставка {i}");
        let page = c.page(None, &title).await;
        let r = c.patch(&page_uri(&page), json!({ "before_id": id_of(&last) })).await;
        c.ok(r, StatusCode::OK).await;
        expected.insert(expected.len() - 1, title);
    }
    assert_eq!(c.children(None).await, expected);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn page_cannot_move_into_itself_or_its_descendants(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let a = c.page(None, "А").await;
    let a1 = c.page(Some(id_of(&a)), "А1").await;
    let a2 = c.page(Some(id_of(&a1)), "А2").await;

    for target in [&a, &a1, &a2] {
        let r = c.save(&a, json!({ "parent_id": id_of(target) })).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "в {}: {}", target["title"], r.body);
    }
    let r = c.save(&a, json!({ "parent_id": Uuid::new_v4() })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "нет такого родителя");

    let a_now = c.get(&format!("/api/v1/wiki/{}", id_of(&a))).await;
    assert_eq!(c.ok(a_now, StatusCode::OK).await["rev"], 1, "ничего не изменилось");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn deleting_a_page_takes_nested_pages_and_keeps_their_files(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let a = c.page(None, "Родитель").await;
    let a1 = c.page(Some(id_of(&a)), "Ребёнок").await;
    let other = c.page(None, "Соседняя").await;

    let r = c.upload("/api/v1/files", &[file_part("схема.png", b"png"), text_part("wiki_page_id", id_of(&a1))]).await;
    let file = c.ok(r, StatusCode::CREATED).await[0].clone();

    let r = c.delete(&format!("/api/v1/wiki/{}", id_of(&a))).await;
    assert_eq!(r.status, StatusCode::NO_CONTENT);
    assert_eq!(c.titles().await, ["Соседняя"]);
    assert_eq!(c.get(&format!("/api/v1/wiki/{}", id_of(&a1))).await.status, StatusCode::NOT_FOUND);
    assert_eq!(c.get(&format!("/api/v1/wiki/{}", id_of(&other))).await.status, StatusCode::OK);

    // файл остался в библиотеке, но уже не привязан к странице
    let r = c.get("/api/v1/files").await;
    let list = c.ok(r, StatusCode::OK).await;
    assert_eq!(list["files"][0]["id"], file["id"]);
    assert_eq!(list["files"][0]["wiki_page_id"], Value::Null);
    assert_eq!(c.dir.stored().len(), 1, "содержимое файла на диске осталось");

    let last = c.feed().await.pop().unwrap();
    assert_eq!(last, ev("doc", "Страница «Родитель»", "удалена вместе с вложенными (1)"));
    assert_eq!(c.delete(&format!("/api/v1/wiki/{}", id_of(&a))).await.status, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn deleting_a_single_page_is_logged_plainly(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let untitled = c.page(None, "").await;
    c.delete(&format!("/api/v1/wiki/{}", id_of(&untitled))).await;
    assert_eq!(c.feed().await.pop().unwrap(), ev("doc", "Новая страница вики", "удалена"));
}
