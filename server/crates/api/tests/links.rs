//! Ссылки команды на настоящем Postgres: группы, ссылки, адрес с автоматическим `https://`, каскад, порядок.

mod common;

use axum::http::{Method, StatusCode};
use common::*;
use db::PgPool;
use serde_json::{Value, json};

async fn groups(c: &Ctx) -> Value {
    let r = c.get("/api/v1/link-groups").await;
    c.ok(r, StatusCode::OK).await
}

fn group_titles(list: &Value) -> Vec<&str> {
    list.as_array().unwrap().iter().map(|g| str_field(g, "title")).collect()
}

fn link_titles(group: &Value) -> Vec<&str> {
    group["links"].as_array().unwrap().iter().map(|l| str_field(l, "title")).collect()
}

async fn group(c: &Ctx, title: &str) -> Value {
    let r = c.post("/api/v1/link-groups", json!({ "title": title })).await;
    c.ok(r, StatusCode::CREATED).await
}

async fn link(c: &Ctx, group: &Value, title: &str, url: &str) -> Value {
    let r = c.post(&format!("/api/v1/link-groups/{}/links", id_of(group)), json!({ "title": title, "url": url })).await;
    c.ok(r, StatusCode::CREATED).await
}

async fn activity_count(c: &Ctx) -> i64 {
    db::sqlx::query_scalar("select count(*) from activity").fetch_one(&c.pool).await.unwrap()
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn there_are_no_groups_at_first(pool: PgPool) {
    let c = Ctx::new(pool).await;
    assert_eq!(groups(&c).await, json!([]));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn new_group_is_empty_trimmed_and_goes_last(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let first = group(&c, "  Код и сборка  ").await;
    assert_eq!(first["title"], "Код и сборка");
    assert_eq!(first["links"], json!([]));
    group(&c, "Мониторинг").await;
    group(&c, "Дизайн").await;
    assert_eq!(
        group_titles(&groups(&c).await),
        ["Код и сборка", "Мониторинг", "Дизайн"],
        "порядок создания, не по алфавиту"
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn group_title_is_checked(pool: PgPool) {
    let c = Ctx::new(pool).await;
    for title in ["", "   "] {
        assert_eq!(
            c.post("/api/v1/link-groups", json!({ "title": title })).await.status,
            StatusCode::BAD_REQUEST,
            "{title:?}"
        );
    }
    assert_eq!(
        c.post("/api/v1/link-groups", json!({ "title": "я".repeat(201) })).await.status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(c.post("/api/v1/link-groups", json!({ "title": "я".repeat(200) })).await.status, StatusCode::CREATED);
    assert_eq!(c.post("/api/v1/link-groups", json!({})).await.status, StatusCode::BAD_REQUEST, "нет названия");
    assert_eq!(c.post("/api/v1/link-groups", json!({ "title": "A", "x": 1 })).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(group_titles(&groups(&c).await).len(), 1, "ошибочные запросы ничего не создали");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn group_is_renamed(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let g = group(&c, "Старое").await;
    link(&c, &g, "Ссылка", "example.com").await;

    let r = c.patch(&format!("/api/v1/link-groups/{}", id_of(&g)), json!({ "title": "  Новое  " })).await;
    let body = c.ok(r, StatusCode::OK).await;
    assert_eq!(body["title"], "Новое");
    assert_eq!(link_titles(&body), ["Ссылка"], "в ответе группа вместе со ссылками");
    assert_eq!(group_titles(&groups(&c).await), ["Новое"]);

    let uri = format!("/api/v1/link-groups/{}", id_of(&g));
    assert_eq!(c.patch(&uri, json!({ "title": " " })).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(c.patch(&uri, json!({})).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(group_titles(&groups(&c).await), ["Новое"]);

    let missing = format!("/api/v1/link-groups/{}", uuid::Uuid::new_v4());
    assert_eq!(c.patch(&missing, json!({ "title": "Нет" })).await.status, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn link_gets_https_when_the_address_has_no_scheme(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let g = group(&c, "Код").await;

    let l = link(&c, &g, "  Репозиторий  ", "  example.com/git/api  ").await;
    assert_eq!(l["title"], "Репозиторий");
    assert_eq!(l["url"], "https://example.com/git/api");
    assert_eq!(l["description"], "");
    assert_eq!(l["group_id"], g["id"]);

    assert_eq!(link(&c, &g, "A", "http://example.com/a").await["url"], "http://example.com/a", "http остаётся http");
    assert_eq!(link(&c, &g, "B", "HTTPS://Example.com/B").await["url"], "HTTPS://Example.com/B");
    assert_eq!(
        link(&c, &g, "C", "javascript:alert(1)").await["url"],
        "https://javascript:alert(1)",
        "чужая схема не проходит как схема: клиент всё равно открывает только http и https"
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn link_may_carry_a_description(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let g = group(&c, "Код").await;
    let uri = format!("/api/v1/link-groups/{}/links", id_of(&g));

    let r = c.post(&uri, json!({ "title": "A", "url": "example.com", "description": "  Основной код  " })).await;
    assert_eq!(c.ok(r, StatusCode::CREATED).await["description"], "Основной код");
    let too_long = "я".repeat(501);
    let r = c.post(&uri, json!({ "title": "B", "url": "example.com", "description": too_long })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let r = c.post(&uri, json!({ "title": "B", "url": "example.com", "description": null })).await;
    assert_eq!(c.ok(r, StatusCode::CREATED).await["description"], "", "null — как не передано");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn link_input_is_checked(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let g = group(&c, "Код").await;
    let uri = format!("/api/v1/link-groups/{}/links", id_of(&g));

    for body in [
        json!({ "title": "", "url": "example.com" }),
        json!({ "title": "   ", "url": "example.com" }),
        json!({ "title": "A", "url": "" }),
        json!({ "title": "A", "url": "   " }),
        json!({ "title": "A", "url": "https://" }),
        json!({ "title": "A", "url": "example.com\nevil.com" }),
        json!({ "title": "A" }),
        json!({ "url": "example.com" }),
        json!({ "title": "я".repeat(201), "url": "example.com" }),
        json!({ "title": "A", "url": format!("example.com/{}", "a".repeat(2_000)) }),
        json!({ "title": "A", "url": "example.com", "unknown": 1 }),
    ] {
        let r = c.post(&uri, body.clone()).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{body}: {}", r.body);
        assert_eq!(r.body["code"], "bad_request");
    }
    assert_eq!(groups(&c).await[0]["links"], json!([]), "ошибочные запросы ничего не добавили");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn links_stay_in_the_order_they_were_added_inside_their_group(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let code = group(&c, "Код").await;
    let ops = group(&c, "Мониторинг").await;
    link(&c, &code, "Яблоко", "example.com/1").await;
    link(&c, &ops, "Метрики", "example.com/m").await;
    link(&c, &code, "Арбуз", "example.com/2").await;
    link(&c, &code, "Мёд", "example.com/3").await;

    let list = groups(&c).await;
    assert_eq!(link_titles(&list[0]), ["Яблоко", "Арбуз", "Мёд"], "порядок добавления, а не по алфавиту");
    assert_eq!(link_titles(&list[1]), ["Метрики"], "ссылки не смешиваются между группами");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn link_needs_an_existing_group(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let r = c
        .post(
            &format!("/api/v1/link-groups/{}/links", uuid::Uuid::new_v4()),
            json!({ "title": "A", "url": "example.com" }),
        )
        .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(
        c.post("/api/v1/link-groups/не-uuid/links", json!({ "title": "A", "url": "example.com" })).await.status,
        StatusCode::BAD_REQUEST
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn link_is_deleted(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let g = group(&c, "Код").await;
    let keep = link(&c, &g, "Остаётся", "example.com/a").await;
    let gone = link(&c, &g, "Уходит", "example.com/b").await;

    let uri = format!("/api/v1/links/{}", id_of(&gone));
    assert_eq!(c.delete(&uri).await.status, StatusCode::NO_CONTENT);
    assert_eq!(link_titles(&groups(&c).await[0]), ["Остаётся"]);
    assert_eq!(c.delete(&uri).await.status, StatusCode::NOT_FOUND, "второй раз такой ссылки уже нет");
    assert_eq!(c.delete(&format!("/api/v1/links/{}", id_of(&keep))).await.status, StatusCode::NO_CONTENT);
    assert_eq!(groups(&c).await[0]["links"], json!([]));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn deleting_a_group_deletes_its_links_and_only_them(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let doomed = group(&c, "Уходит").await;
    let kept = group(&c, "Остаётся").await;
    link(&c, &doomed, "A", "example.com/a").await;
    link(&c, &doomed, "B", "example.com/b").await;
    link(&c, &kept, "C", "example.com/c").await;

    let uri = format!("/api/v1/link-groups/{}", id_of(&doomed));
    assert_eq!(c.delete(&uri).await.status, StatusCode::NO_CONTENT);
    let list = groups(&c).await;
    assert_eq!(group_titles(&list), ["Остаётся"]);
    assert_eq!(link_titles(&list[0]), ["C"]);
    let left: i64 = db::sqlx::query_scalar("select count(*) from links").fetch_one(&c.pool).await.unwrap();
    assert_eq!(left, 1, "ссылки удалённой группы не остались в базе");
    assert_eq!(c.delete(&uri).await.status, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn links_do_not_write_to_the_feed(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let g = group(&c, "Код").await;
    let l = link(&c, &g, "A", "example.com").await;
    c.patch(&format!("/api/v1/link-groups/{}", id_of(&g)), json!({ "title": "Новое" })).await;
    c.delete(&format!("/api/v1/links/{}", id_of(&l))).await;
    c.delete(&format!("/api/v1/link-groups/{}", id_of(&g))).await;
    assert_eq!(activity_count(&c).await, 0, "в макете этих действий в ленте нет");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn links_need_a_token(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let g = group(&c, "Код").await;
    let id = id_of(&g);
    for (method, uri, body) in [
        (Method::GET, "/api/v1/link-groups".to_owned(), None),
        (Method::POST, "/api/v1/link-groups".to_owned(), Some(json!({ "title": "A" }))),
        (Method::PATCH, format!("/api/v1/link-groups/{id}"), Some(json!({ "title": "A" }))),
        (Method::DELETE, format!("/api/v1/link-groups/{id}"), None),
        (Method::POST, format!("/api/v1/link-groups/{id}/links"), Some(json!({ "title": "A", "url": "a.b" }))),
        (Method::DELETE, format!("/api/v1/links/{id}"), None),
    ] {
        let r = send(&c.app, method.clone(), &uri, body, None).await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED, "{method} {uri}");
    }
    assert_eq!(groups(&c).await.as_array().unwrap().len(), 1, "без токена ничего не изменилось");
}
