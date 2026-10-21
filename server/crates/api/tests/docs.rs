//! Документы: список и порядок, версии (`rev`) и конфликт 409, режим, звёздочки у разных людей, поиск, холст целиком,
//! удаление, запись в ленту. На настоящем Postgres.

mod common;

use axum::http::{Method, StatusCode};
use common::*;
use db::PgPool;
use serde_json::{Value, json};
use uuid::Uuid;

fn ev(kind: &str, target: &str, text: &str) -> (String, String, String) {
    (kind.to_owned(), target.to_owned(), text.to_owned())
}

fn doc_uri(doc: &Value) -> String {
    format!("/api/v1/docs/{}", id_of(doc))
}

fn canvas_uri(doc: &Value) -> String {
    format!("/api/v1/docs/{}/canvas", id_of(doc))
}

/// Объект холста для тела запроса
fn obj(id: Uuid, kind: &str, x: f64, y: f64, text: &str) -> Value {
    json!({ "id": id, "type": kind, "x": x, "y": y, "w": 120.0, "h": 60.0, "text": text, "color": 3 })
}

fn canvas(objects: &[Value], links: &[(Uuid, Uuid)]) -> Value {
    json!({
        "note": { "x": 24.0, "y": 28.0, "w": 400.0 },
        "objects": objects,
        "links": links.iter().map(|(a, b)| json!({ "a": a, "b": b })).collect::<Vec<_>>(),
    })
}

/// Контекст теста: проект «Web-приложение», в котором лежат все документы теста
async fn ctx(pool: PgPool) -> Ctx {
    let c = Ctx::new(pool.clone()).await;
    make_project(&pool, "WEB", "Web-приложение", "accent").await;
    c
}

impl Ctx {
    async fn project(&self) -> Uuid {
        db::sqlx::query_scalar("select id from projects order by seq limit 1").fetch_one(&self.pool).await.unwrap()
    }

    /// Адрес списка и создания документов проекта теста
    async fn docs_path(&self) -> String {
        format!("/api/v1/projects/{}/docs", self.project().await)
    }

    async fn doc(&self, title: &str, mode: &str) -> Value {
        let r = self.post(&self.docs_path().await, json!({ "title": title, "mode": mode })).await;
        self.ok(r, StatusCode::CREATED).await
    }

    async fn page(&self, title: &str) -> Value {
        self.doc(title, "page").await
    }

    /// Сохраняет название или текст с версией, которую видел клиент
    async fn save(&self, doc: &Value, body: Value) -> Reply {
        let mut body = body;
        body["rev"] = doc["rev"].clone();
        self.patch(&doc_uri(doc), body).await
    }

    async fn list(&self, query: &str) -> Value {
        let r = self.get(&format!("{}{query}", self.docs_path().await)).await;
        self.ok(r, StatusCode::OK).await
    }

    async fn titles(&self, query: &str) -> Vec<String> {
        self.list(query).await.as_array().unwrap().iter().map(|d| str_field(d, "title").to_owned()).collect()
    }

    async fn open(&self, doc: &Value) -> Value {
        let r = self.get(&doc_uri(doc)).await;
        self.ok(r, StatusCode::OK).await
    }

    async fn feed(&self) -> Vec<(String, String, String)> {
        db::sqlx::query_as("select kind::text, target, text from activity order by created_at, text")
            .fetch_all(&self.pool)
            .await
            .unwrap()
    }

    /// Второй участник: его токен
    async fn other_token(&self) -> String {
        let user = make_user(&self.pool, "second@example.com", "Второй В.", "second-password").await;
        join(&self.pool, self.project().await, user.id, "member").await;
        let tokens = login_ok(&self.app, "second@example.com", "second-password").await;
        str_field(&tokens, "access_token").to_owned()
    }

    async fn as_other(&self, token: &str, method: Method, uri: &str, body: Option<Value>) -> Reply {
        send(&self.app, method, uri, body, Some(token)).await
    }
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn docs_need_a_token(pool: PgPool) {
    let app = app(pool);
    let id = Uuid::new_v4();
    for (method, uri) in [
        (Method::GET, format!("/api/v1/projects/{id}/docs")),
        (Method::POST, format!("/api/v1/projects/{id}/docs")),
        (Method::GET, format!("/api/v1/docs/{id}")),
        (Method::PATCH, format!("/api/v1/docs/{id}")),
        (Method::DELETE, format!("/api/v1/docs/{id}")),
        (Method::PUT, format!("/api/v1/docs/{id}/star")),
        (Method::PUT, format!("/api/v1/docs/{id}/canvas")),
    ] {
        let r = send(&app, method.clone(), &uri, Some(json!({})), None).await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED, "{method} {uri}");
    }
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn new_document_is_empty_at_revision_one_and_goes_to_the_feed(pool: PgPool) {
    let c = ctx(pool).await;
    let r = c.post(&c.docs_path().await, json!({})).await;
    let doc = c.ok(r, StatusCode::CREATED).await;

    assert_eq!(doc["title"], "");
    assert_eq!(doc["md"], "");
    assert_eq!(doc["mode"], "page");
    assert_eq!(doc["rev"], 1);
    assert_eq!(doc["canvas_rev"], 0, "холст ещё ни разу не сохраняли");
    assert_eq!(doc["starred"], false);
    assert_eq!(doc["note"], json!({ "x": 40.0, "y": 36.0, "w": 440.0 }), "карточка с текстом, как в макете");
    assert_eq!(doc["objects"], json!([]));
    assert_eq!(doc["links"], json!([]));
    assert_eq!(doc["created_by"], c.user.id.to_string());
    assert_eq!(doc["updated_by"], c.user.id.to_string());

    let named = c.doc("  Схема  ", "edge").await;
    assert_eq!(named["title"], "Схема", "пробелы по краям убираются");
    assert_eq!(named["mode"], "edge");
    assert_eq!(
        c.feed().await,
        [ev("doc", "Новый документ", "создан"), ev("doc", "Документ «Схема»", "создан как холст")]
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn new_document_needs_sane_fields(pool: PgPool) {
    let c = ctx(pool).await;
    let r = c.post(&c.docs_path().await, json!({ "title": "я".repeat(201) })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "{}", r.body);
    let r = c.post(&c.docs_path().await, json!({ "md": "я".repeat(500_001) })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let r = c.post(&c.docs_path().await, json!({ "mode": "board" })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "режимов только два");
    let r = c.post(&c.docs_path().await, json!({ "color": "red" })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "лишнее поле запроса");
    assert!(c.titles("").await.is_empty());
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn new_documents_go_first(pool: PgPool) {
    let c = ctx(pool).await;
    let a = c.page("А").await;
    let b = c.page("Б").await;
    let d = c.page("В").await;
    assert_eq!(c.titles("").await, ["В", "Б", "А"]);
    assert!(d["position"].as_f64() < b["position"].as_f64());
    assert!(b["position"].as_f64() < a["position"].as_f64());
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn list_has_summaries_without_the_text(pool: PgPool) {
    let c = ctx(pool).await;
    let page = c.page("Планирование").await;
    let md = "## Цели квартала\n\n1. Выпустить релиз\n2. Закрыть техдолг\n3. Подготовить бету\n4. Лишнее";
    let r = c.save(&page, json!({ "md": md })).await;
    c.ok(r, StatusCode::OK).await;

    let canvas_doc = c.doc("Схема", "edge").await;
    let ids = [Uuid::new_v4(), Uuid::new_v4()];
    let body = canvas(
        &[obj(ids[0], "rect", 10.0, 20.0, "Клиент"), obj(ids[1], "sticky", 200.0, 20.0, "Шлюз")],
        &[(ids[0], ids[1])],
    );
    let r = c.put_json(&canvas_uri(&canvas_doc), body).await;
    c.ok(r, StatusCode::OK).await;

    let empty = c.page("Пустой").await;

    let list = c.list("").await;
    let by_title = |t: &str| list.as_array().unwrap().iter().find(|d| d["title"] == t).unwrap().clone();

    let plan = by_title("Планирование");
    assert_eq!(plan["snippet"], "Цели квартала · Выпустить релиз · Закрыть техдолг", "три первые строки без разметки");
    assert!(plan.get("md").is_none(), "текста в списке нет");
    assert_eq!(plan["mode"], "page");
    assert_eq!(plan["object_count"], 0);
    assert_eq!(plan["thumb"], json!([]));
    assert_eq!(plan["created_by"], c.user.id.to_string());
    assert_eq!(plan["starred"], false);

    let scheme = by_title("Схема");
    assert_eq!(scheme["mode"], "edge");
    assert_eq!(scheme["object_count"], 2);
    assert_eq!(scheme["note"], json!({ "x": 24.0, "y": 28.0, "w": 400.0 }));
    let thumb = scheme["thumb"].as_array().unwrap();
    assert_eq!(thumb.len(), 2, "для миниатюры объекты есть у документа-холста");
    assert_eq!(thumb[0]["type"], "rect");
    assert_eq!(thumb[1]["type"], "sticky");
    assert!(thumb[0].get("text").is_none(), "в миниатюре текста нет");

    assert_eq!(by_title("Пустой")["snippet"], "", "пустой документ: надпись подставляет клиент");
    assert_eq!(id_of(&by_title("Пустой")), id_of(&empty));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn thumbnails_are_only_for_documents_in_canvas_mode(pool: PgPool) {
    let c = ctx(pool).await;
    let doc = c.page("Идеи").await;
    let id = Uuid::new_v4();
    let r = c.put_json(&canvas_uri(&doc), canvas(&[obj(id, "sticky", 10.0, 10.0, "Идея")], &[])).await;
    c.ok(r, StatusCode::OK).await;

    let list = c.list("").await;
    assert_eq!(list[0]["object_count"], 1, "в карточке «1 объект на холсте» и у страницы");
    assert_eq!(list[0]["thumb"], json!([]), "а миниатюры у страницы нет");

    let r = c.patch(&doc_uri(&doc), json!({ "mode": "edge" })).await;
    c.ok(r, StatusCode::OK).await;
    assert_eq!(c.list("").await[0]["thumb"].as_array().unwrap().len(), 1);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn document_comes_with_text_and_canvas(pool: PgPool) {
    let c = ctx(pool).await;
    let doc = c.page("Заметки").await;
    let r = c.save(&doc, json!({ "md": "# Привет\n\nТекст" })).await;
    c.ok(r, StatusCode::OK).await;

    let open = c.open(&doc).await;
    assert_eq!(open["md"], "# Привет\n\nТекст");
    assert_eq!(c.get(&format!("/api/v1/docs/{}", Uuid::new_v4())).await.status, StatusCode::NOT_FOUND);
    assert_eq!(c.get("/api/v1/docs/не-идентификатор").await.status, StatusCode::BAD_REQUEST);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn saving_changes_text_and_title_and_raises_the_revision(pool: PgPool) {
    let c = ctx(pool).await;
    let doc = c.page("").await;

    let r = c.save(&doc, json!({ "md": "Первая строка\r\nВторая" })).await;
    let doc = c.ok(r, StatusCode::OK).await;
    assert_eq!(doc["md"], "Первая строка\nВторая", "переводы строк приводятся к \\n");
    assert_eq!(doc["rev"], 2);

    let r = c.save(&doc, json!({ "title": "  Новое название " })).await;
    let doc = c.ok(r, StatusCode::OK).await;
    assert_eq!(doc["rev"], 3);
    assert_eq!(doc["title"], "Новое название");
    assert_eq!(doc["md"], "Первая строка\nВторая", "текст не тронут");
    assert_eq!(c.titles("").await, ["Новое название"]);

    // правки текста в ленту не пишутся, только создание
    assert_eq!(c.feed().await, [ev("doc", "Новый документ", "создан")]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn saving_the_same_content_keeps_the_revision(pool: PgPool) {
    let c = ctx(pool).await;
    let doc = c.page("Тут").await;
    let r = c.save(&doc, json!({ "md": "Текст" })).await;
    let doc = c.ok(r, StatusCode::OK).await;

    let r = c.save(&doc, json!({ "md": "Текст", "title": "Тут" })).await;
    let same = c.ok(r, StatusCode::OK).await;
    assert_eq!(same["rev"], doc["rev"]);
    assert_eq!(same["updated_at"], doc["updated_at"]);

    let r = c.save(&doc, json!({})).await;
    assert_eq!(c.ok(r, StatusCode::OK).await["rev"], doc["rev"], "пустой PATCH ничего не меняет");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn stale_revision_gets_409_with_the_current_version(pool: PgPool) {
    let c = ctx(pool).await;
    let doc = c.page("Общий").await;

    // два клиента открыли одну и ту же версию
    let mine = doc.clone();
    let r = c.save(&doc, json!({ "md": "Правка соседа" })).await;
    let saved = c.ok(r, StatusCode::OK).await;

    let r = c.save(&mine, json!({ "md": "Моя правка" })).await;
    assert_eq!(r.status, StatusCode::CONFLICT, "{}", r.body);
    assert_eq!(r.body["code"], "conflict");
    assert_eq!(r.body["message"], "Документ изменил другой участник");
    assert_eq!(r.body["current"]["md"], "Правка соседа");
    assert_eq!(r.body["current"]["rev"], saved["rev"]);
    assert!(r.body["current"]["objects"].is_array(), "в current лежит документ целиком");

    // «Оставить мою»: тот же текст с актуальной версией
    let r = c.save(&r.body["current"], json!({ "md": "Моя правка" })).await;
    let kept = c.ok(r, StatusCode::OK).await;
    assert_eq!(kept["md"], "Моя правка");
    assert_eq!(kept["rev"], 3);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn two_saves_with_the_same_revision_cannot_both_win(pool: PgPool) {
    let c = ctx(pool).await;
    let doc = c.page("Гонка").await;
    let uri = doc_uri(&doc);

    let (a, b) =
        tokio::join!(c.patch(&uri, json!({ "rev": 1, "md": "А" })), c.patch(&uri, json!({ "rev": 1, "md": "Б" })),);
    let mut statuses = [a.status, b.status];
    statuses.sort();
    assert_eq!(statuses, [StatusCode::OK, StatusCode::CONFLICT]);
    assert_eq!(c.open(&doc).await["rev"], 2);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn revision_is_required_and_unknown_fields_are_refused(pool: PgPool) {
    let c = ctx(pool).await;
    let doc = c.page("Тест").await;
    let uri = doc_uri(&doc);

    assert_eq!(c.patch(&uri, json!({ "md": "без версии" })).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(c.patch(&uri, json!({ "title": "без версии" })).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(c.patch(&uri, json!({ "rev": 1, "color": "red" })).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(c.patch(&uri, json!({ "rev": 1, "title": "я".repeat(201) })).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(c.patch(&uri, json!({ "mode": "board" })).await.status, StatusCode::BAD_REQUEST);
    let missing = format!("/api/v1/docs/{}", Uuid::new_v4());
    assert_eq!(c.patch(&missing, json!({ "rev": 1 })).await.status, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn switching_the_mode_is_a_view_change_not_an_edit(pool: PgPool) {
    let c = ctx(pool).await;
    let doc = c.page("Вид").await;
    let r = c.save(&doc, json!({ "md": "Текст" })).await;
    let doc = c.ok(r, StatusCode::OK).await;

    // версия не нужна, и она не растёт; время правки тоже не меняется
    let r = c.patch(&doc_uri(&doc), json!({ "mode": "edge" })).await;
    let edge = c.ok(r, StatusCode::OK).await;
    assert_eq!(edge["mode"], "edge");
    assert_eq!(edge["rev"], doc["rev"]);
    assert_eq!(edge["updated_at"], doc["updated_at"]);
    assert_eq!(edge["md"], "Текст", "текст общий в обоих режимах");
    assert_eq!(c.list("").await[0]["mode"], "edge");

    // правка текста, которая шла параллельно со сменой режима, не получает конфликта
    let r = c.save(&doc, json!({ "md": "Текст 2" })).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn before_id_reorders_documents(pool: PgPool) {
    let c = ctx(pool).await;
    let a = c.page("А").await;
    let b = c.page("Б").await;
    let d = c.page("В").await;
    let e = c.page("Г").await;
    assert_eq!(c.titles("").await, ["Г", "В", "Б", "А"]);

    // «А» встаёт на первое место
    let r = c.patch(&doc_uri(&a), json!({ "before_id": id_of(&e) })).await;
    let moved = c.ok(r, StatusCode::OK).await;
    assert_eq!(c.titles("").await, ["А", "Г", "В", "Б"]);
    assert_eq!(moved["rev"], a["rev"], "перенос версию не меняет");
    assert_eq!(moved["updated_at"], a["updated_at"], "и время правки тоже");

    // «А» — в самый конец
    let r = c.patch(&doc_uri(&a), json!({ "before_id": null })).await;
    c.ok(r, StatusCode::OK).await;
    assert_eq!(c.titles("").await, ["Г", "В", "Б", "А"]);

    // «Г» между «Б» и «А»
    let r = c.patch(&doc_uri(&e), json!({ "before_id": id_of(&a) })).await;
    c.ok(r, StatusCode::OK).await;
    assert_eq!(c.titles("").await, ["В", "Б", "Г", "А"]);

    // перенос на то же место ничего не меняет
    let before = c.list("").await;
    let r = c.patch(&doc_uri(&b), json!({ "before_id": id_of(&e) })).await;
    c.ok(r, StatusCode::OK).await;
    assert_eq!(c.list("").await, before);
    let _ = d;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn before_id_must_be_another_existing_document(pool: PgPool) {
    let c = ctx(pool).await;
    let a = c.page("А").await;
    c.page("Б").await;
    let r = c.patch(&doc_uri(&a), json!({ "before_id": Uuid::new_v4() })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "{}", r.body);
    let r = c.patch(&doc_uri(&a), json!({ "before_id": id_of(&a) })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "перед самим собой встать нельзя");
    assert_eq!(c.titles("").await, ["Б", "А"]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn order_survives_hundreds_of_moves_into_the_same_gap(pool: PgPool) {
    let c = ctx(pool).await;
    c.page("Низ").await;
    let y = c.page("У").await;
    let x = c.page("Х").await;
    c.page("Верх").await;
    // порядок: Верх, Х, У, Низ. Х и У по очереди встают друг перед другом, то есть между «Верх» и соседом:
    // зазор каждый раз делится пополам, пока сервер не пересчитает позиции заново
    let mut order = ["Х", "У"];
    for i in 0..45 {
        let (mover, before) = if i % 2 == 0 { (&y, &x) } else { (&x, &y) };
        let r = c.patch(&doc_uri(mover), json!({ "before_id": id_of(before) })).await;
        c.ok(r, StatusCode::OK).await;
        order.swap(0, 1);
        assert_eq!(c.titles("").await, ["Верх", order[0], order[1], "Низ"], "после перестановки {}", i + 1);
    }
    let positions: Vec<f64> =
        c.list("").await.as_array().unwrap().iter().map(|d| d["position"].as_f64().unwrap()).collect();
    assert!(positions.windows(2).all(|w| w[0] < w[1]), "позиции строго возрастают: {positions:?}");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn stars_belong_to_each_person(pool: PgPool) {
    let c = ctx(pool).await;
    let other = c.other_token().await;
    let a = c.page("А").await;
    let b = c.page("Б").await;

    let r = c.put_json(&format!("{}/star", doc_uri(&a)), json!({ "starred": true })).await;
    assert_eq!(r.status, StatusCode::NO_CONTENT, "{}", r.body);
    // повторная звёздочка ничего не ломает
    let r = c.put_json(&format!("{}/star", doc_uri(&a)), json!({ "starred": true })).await;
    assert_eq!(r.status, StatusCode::NO_CONTENT);

    assert_eq!(c.open(&a).await["starred"], true);
    assert_eq!(c.titles("?starred=true").await, ["А"]);
    assert_eq!(c.list("").await.as_array().unwrap().iter().filter(|d| d["starred"] == true).count(), 1);

    // у второго участника звёздочки нет
    let r = c.as_other(&other, Method::GET, &doc_uri(&a), None).await;
    assert_eq!(c.ok(r, StatusCode::OK).await["starred"], false);
    let r = c.as_other(&other, Method::GET, &format!("{}?starred=true", c.docs_path().await), None).await;
    assert_eq!(c.ok(r, StatusCode::OK).await, json!([]));

    // он ставит свою на другой документ; у первого она не появляется
    let r = c.as_other(&other, Method::PUT, &format!("{}/star", doc_uri(&b)), Some(json!({ "starred": true }))).await;
    assert_eq!(r.status, StatusCode::NO_CONTENT);
    assert_eq!(c.titles("?starred=true").await, ["А"]);
    let r = c.as_other(&other, Method::GET, &format!("{}?starred=true", c.docs_path().await), None).await;
    let theirs = c.ok(r, StatusCode::OK).await;
    assert_eq!(theirs.as_array().unwrap().len(), 1);
    assert_eq!(theirs[0]["title"], "Б");

    // снять свою звёздочку; снова снять — тоже тихо
    for _ in 0..2 {
        let r = c.put_json(&format!("{}/star", doc_uri(&a)), json!({ "starred": false })).await;
        assert_eq!(r.status, StatusCode::NO_CONTENT);
    }
    assert_eq!(c.open(&a).await["starred"], false);
    assert_eq!(c.titles("?starred=true").await, Vec::<String>::new());
    let r = c.as_other(&other, Method::GET, &format!("{}?starred=true", c.docs_path().await), None).await;
    assert_eq!(c.ok(r, StatusCode::OK).await.as_array().unwrap().len(), 1, "чужая звёздочка осталась");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn star_does_not_touch_the_document_and_needs_an_existing_one(pool: PgPool) {
    let c = ctx(pool).await;
    let doc = c.page("Звезда").await;
    let r = c.put_json(&format!("{}/star", doc_uri(&doc)), json!({ "starred": true })).await;
    assert_eq!(r.status, StatusCode::NO_CONTENT);
    let after = c.open(&doc).await;
    assert_eq!(after["rev"], doc["rev"]);
    assert_eq!(after["updated_at"], doc["updated_at"]);

    let missing = format!("/api/v1/docs/{}/star", Uuid::new_v4());
    assert_eq!(c.put_json(&missing, json!({ "starred": true })).await.status, StatusCode::NOT_FOUND);
    assert_eq!(c.put_json(&missing, json!({ "starred": false })).await.status, StatusCode::NOT_FOUND);
    let r = c.put_json(&format!("{}/star", doc_uri(&doc)), json!({})).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "нужно поле starred");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn search_looks_in_title_and_text_ignoring_case(pool: PgPool) {
    let c = ctx(pool).await;
    let plan = c.page("Планирование Q4").await;
    let r = c.save(&plan, json!({ "md": "Выпустить Релиз 2.9.0" })).await;
    c.ok(r, StatusCode::OK).await;
    let notes = c.page("Заметки").await;
    let r = c.save(&notes, json!({ "md": "Согласовать 100% бюджета" })).await;
    c.ok(r, StatusCode::OK).await;
    c.page("Идеи").await;

    assert_eq!(c.titles("?q=планиров").await, ["Планирование Q4"], "по названию, кириллица без учёта регистра");
    assert_eq!(c.titles("?q=РЕЛИЗ").await, ["Планирование Q4"], "по тексту");
    assert_eq!(c.titles("?q=q4").await, ["Планирование Q4"]);
    assert_eq!(c.titles("?q=%25").await, ["Заметки"], "процент ищется как символ, а не шаблон");
    assert_eq!(c.titles("?q=_").await, Vec::<String>::new(), "подчёркивание тоже");
    assert_eq!(c.titles("?q=%20%20").await.len(), 3, "из пробелов ничего не ищем");
    assert_eq!(c.titles("?q=").await.len(), 3);
    assert_eq!(c.titles("?q=нет%20такого").await, Vec::<String>::new());

    // с фильтром «Избранные»
    let r = c.put_json(&format!("{}/star", doc_uri(&notes)), json!({ "starred": true })).await;
    assert_eq!(r.status, StatusCode::NO_CONTENT);
    assert_eq!(c.titles("?starred=true&q=%25").await, ["Заметки"]);
    assert_eq!(c.titles("?starred=true&q=релиз").await, Vec::<String>::new());
    assert_eq!(c.get(&format!("{}?q={}", c.docs_path().await, "я".repeat(201))).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(c.get(&format!("{}?starred=может", c.docs_path().await)).await.status, StatusCode::BAD_REQUEST);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn canvas_is_saved_as_a_whole(pool: PgPool) {
    let c = ctx(pool).await;
    let doc = c.doc("Схема", "edge").await;
    let (a, b, d) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());

    let body = canvas(
        &[
            obj(a, "rect", 460.0, 120.0, "Клиент"),
            obj(b, "ellipse", 620.0, 120.0, "Шлюз"),
            obj(d, "sticky", 620.0, 300.0, "Кэш"),
        ],
        &[(a, b), (b, d)],
    );
    let r = c.put_json(&canvas_uri(&doc), body).await;
    let saved = c.ok(r, StatusCode::OK).await;
    assert_eq!(saved["note"], json!({ "x": 24.0, "y": 28.0, "w": 400.0 }));
    let ids: Vec<&str> = saved["objects"].as_array().unwrap().iter().map(|o| str_field(o, "id")).collect();
    assert_eq!(ids, [a.to_string(), b.to_string(), d.to_string()], "слои в том порядке, в каком пришли");
    assert_eq!(saved["links"].as_array().unwrap().len(), 2);

    let open = c.open(&doc).await;
    assert_eq!(open["note"], saved["note"]);
    assert_eq!(open["objects"], saved["objects"]);
    assert_eq!(open["links"], saved["links"]);
    assert_eq!(open["objects"][1]["type"], "ellipse");
    assert_eq!(open["objects"][0]["text"], "Клиент");
    assert_eq!(open["objects"][0]["color"], 3);
    assert_eq!(open["rev"], doc["rev"], "версия текста не меняется");
    assert_eq!(open["mode"], "edge");
    assert_eq!(saved["canvas_rev"], 1, "версия холста растёт с каждым сохранением");
    assert_eq!(open["canvas_rev"], 1);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn saving_the_canvas_again_updates_in_place_and_removes_what_is_missing(pool: PgPool) {
    let c = ctx(pool).await;
    let doc = c.doc("Схема", "edge").await;
    let (a, b, d, new) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
    let r = c
        .put_json(
            &canvas_uri(&doc),
            canvas(
                &[obj(a, "rect", 10.0, 10.0, "А"), obj(b, "rect", 200.0, 10.0, "Б"), obj(d, "rect", 400.0, 10.0, "В")],
                &[(a, b), (b, d), (a, d)],
            ),
        )
        .await;
    c.ok(r, StatusCode::OK).await;

    // «Б» убрали, «А» подвинули и переименовали, добавили «Новый»; порядок в запросе другой, слои прежние
    let mut moved = obj(a, "rect", 15.0, 99.0, "А2");
    moved["color"] = json!(6);
    let r = c
        .put_json(
            &canvas_uri(&doc),
            canvas(
                &[obj(new, "text", 5.0, 5.0, "Новый"), obj(d, "rect", 400.0, 10.0, "В"), moved],
                &[(a, d), (new, a)],
            ),
        )
        .await;
    c.ok(r, StatusCode::OK).await;

    let open = c.open(&doc).await;
    let texts: Vec<&str> = open["objects"].as_array().unwrap().iter().map(|o| str_field(o, "text")).collect();
    assert_eq!(texts, ["А2", "В", "Новый"], "прежние объекты на своих слоях, новый сверху");
    assert_eq!(open["objects"][0]["x"], 15.0);
    assert_eq!(open["objects"][0]["y"], 99.0);
    assert_eq!(open["objects"][0]["color"], 6);
    assert_eq!(open["objects"][0]["id"], a.to_string(), "объект обновлён на месте, идентификатор тот же");
    let pairs: Vec<(String, String)> = open["links"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| (str_field(l, "a").to_owned(), str_field(l, "b").to_owned()))
        .collect();
    assert_eq!(pairs.len(), 2);
    assert!(pairs.contains(&(a.to_string(), d.to_string())));
    assert!(pairs.contains(&(new.to_string(), a.to_string())));

    // пустой холст убирает всё
    let r = c.put_json(&canvas_uri(&doc), canvas(&[], &[])).await;
    c.ok(r, StatusCode::OK).await;
    let open = c.open(&doc).await;
    assert_eq!(open["objects"], json!([]));
    assert_eq!(open["links"], json!([]));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn saving_the_canvas_touches_the_edit_time_but_not_the_revision_or_the_feed(pool: PgPool) {
    let c = ctx(pool).await;
    let doc = c.page("Время").await;
    let r = c.put_json(&canvas_uri(&doc), canvas(&[obj(Uuid::new_v4(), "text", 1.0, 1.0, "Т")], &[])).await;
    c.ok(r, StatusCode::OK).await;
    let after = c.open(&doc).await;
    assert_eq!(after["rev"], doc["rev"]);
    assert_eq!(after["canvas_rev"], 1);
    let at = |v: &Value| {
        time::OffsetDateTime::parse(str_field(v, "updated_at"), &time::format_description::well_known::Rfc3339).unwrap()
    };
    assert!(at(&after) > at(&doc), "дата правки обновилась");
    assert_eq!(c.feed().await, [ev("doc", "Документ «Время»", "создан")], "холст в ленту не пишется");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn the_canvas_is_checked_and_a_refused_one_changes_nothing(pool: PgPool) {
    let c = ctx(pool).await;
    let doc = c.doc("Строгий", "edge").await;
    let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
    let good = canvas(&[obj(a, "rect", 10.0, 10.0, "А"), obj(b, "rect", 200.0, 10.0, "Б")], &[(a, b)]);
    let r = c.put_json(&canvas_uri(&doc), good.clone()).await;
    c.ok(r, StatusCode::OK).await;

    let with = |f: &dyn Fn(&mut Value)| {
        let mut v = good.clone();
        f(&mut v);
        v
    };
    let bad = [
        ("неизвестный тип", with(&|v| v["objects"][0]["type"] = json!("circle"))),
        ("минус по x", with(&|v| v["objects"][0]["x"] = json!(-1))),
        ("цвета 8 нет", with(&|v| v["objects"][0]["color"] = json!(8))),
        ("нулевая ширина", with(&|v| v["objects"][0]["w"] = json!(0))),
        ("длинный текст", with(&|v| v["objects"][0]["text"] = json!("я".repeat(1001)))),
        ("один объект дважды", with(&|v| v["objects"][1]["id"] = json!(a))),
        ("стрелка к чужому", with(&|v| v["links"][0]["b"] = json!(Uuid::new_v4()))),
        ("стрелка на себя", with(&|v| v["links"][0]["b"] = json!(a))),
        ("стрелка дважды", with(&|v| v["links"] = json!([{ "a": a, "b": b }, { "a": b, "b": a }]))),
        ("карточка уже минимума", with(&|v| v["note"]["w"] = json!(100))),
        ("лишнее поле", with(&|v| v["objects"][0]["z"] = json!(1))),
        ("без списка стрелок", json!({ "note": good["note"], "objects": [] })),
    ];
    for (what, body) in bad {
        let r = c.put_json(&canvas_uri(&doc), body).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{what}: {}", r.body);
    }
    let too_many: Vec<Value> = (0..501).map(|i| obj(Uuid::new_v4(), "text", f64::from(i), 0.0, "")).collect();
    assert_eq!(c.put_json(&canvas_uri(&doc), canvas(&too_many, &[])).await.status, StatusCode::BAD_REQUEST);

    let open = c.open(&doc).await;
    assert_eq!(open["objects"].as_array().unwrap().len(), 2, "холст остался прежним");
    assert_eq!(open["links"].as_array().unwrap().len(), 1);

    let missing = format!("/api/v1/docs/{}/canvas", Uuid::new_v4());
    assert_eq!(c.put_json(&missing, good).await.status, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn an_object_id_of_another_document_is_refused_and_nothing_changes(pool: PgPool) {
    let c = ctx(pool).await;
    let mine = c.doc("Мой", "edge").await;
    let other = c.doc("Чужой", "edge").await;
    let (a, taken) = (Uuid::new_v4(), Uuid::new_v4());
    let r = c.put_json(&canvas_uri(&mine), canvas(&[obj(a, "rect", 1.0, 1.0, "Мой объект")], &[])).await;
    c.ok(r, StatusCode::OK).await;
    let r = c.put_json(&canvas_uri(&other), canvas(&[obj(taken, "rect", 1.0, 1.0, "Чужой объект")], &[])).await;
    c.ok(r, StatusCode::OK).await;

    // в мой документ приходит объект с идентификатором чужого, а моего «А» в списке нет
    let r = c.put_json(&canvas_uri(&mine), canvas(&[obj(taken, "rect", 9.0, 9.0, "Подмена")], &[])).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "{}", r.body);

    let mine_after = c.open(&mine).await;
    assert_eq!(mine_after["objects"][0]["text"], "Мой объект", "удаление «А» откатилось вместе со всем");
    assert_eq!(mine_after["objects"].as_array().unwrap().len(), 1);
    let other_after = c.open(&other).await;
    assert_eq!(other_after["objects"][0]["text"], "Чужой объект", "чужой документ не тронут");
    assert_eq!(other_after["objects"][0]["x"], 1.0);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn deleting_a_document_removes_its_canvas_and_stars_and_goes_to_the_feed(pool: PgPool) {
    let c = ctx(pool).await;
    let keep = c.page("Остаётся").await;
    let doc = c.doc("Схема", "edge").await;
    let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
    let r = c
        .put_json(&canvas_uri(&doc), canvas(&[obj(a, "rect", 1.0, 1.0, "А"), obj(b, "rect", 2.0, 2.0, "Б")], &[(a, b)]))
        .await;
    c.ok(r, StatusCode::OK).await;
    let r = c.put_json(&format!("{}/star", doc_uri(&doc)), json!({ "starred": true })).await;
    assert_eq!(r.status, StatusCode::NO_CONTENT);

    let r = c.delete(&doc_uri(&doc)).await;
    assert_eq!(r.status, StatusCode::NO_CONTENT, "{}", r.body);
    assert_eq!(c.get(&doc_uri(&doc)).await.status, StatusCode::NOT_FOUND);
    assert_eq!(c.titles("").await, ["Остаётся"]);
    for table in ["doc_objects", "doc_links", "doc_stars"] {
        let n: i64 = db::sqlx::query_scalar(db::sqlx::AssertSqlSafe(format!("select count(*) from {table}")))
            .fetch_one(&c.pool)
            .await
            .unwrap();
        assert_eq!(n, 0, "{table}");
    }
    assert_eq!(
        c.feed().await,
        [
            ev("doc", "Документ «Остаётся»", "создан"),
            ev("doc", "Документ «Схема»", "создан как холст"),
            ev("doc", "Документ «Схема»", "удалён")
        ]
    );
    assert_eq!(c.delete(&doc_uri(&doc)).await.status, StatusCode::NOT_FOUND);
    let _ = keep;
}
