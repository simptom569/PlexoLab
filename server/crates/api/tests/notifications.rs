//! Уведомления (docs/OFFLINE-NOTIFY-SEARCH.md, раздел 2): назначили исполнителем и упомянули в комментарии, список
//! своих, прочтение, события только адресату. Доступ к чужим записям проверяет обход адресов в access.rs.

mod common;

use api::events::Audience;
use axum::http::StatusCode;
use common::*;
use db::PgPool;
use serde_json::{Value, json};
use uuid::Uuid;

/// Проект WEB с тремя участниками: тестер (администратор, он же автор действий), Лена и Артём, и задача WEB-1
struct World {
    f: Fx,
    lena: Ctx,
    artem: Ctx,
    task: Uuid,
}

async fn world(pool: PgPool) -> World {
    let f = Fx::new(pool).await;
    let lena = f.c.another("lena@example.com", "Лена М.").await;
    let artem = f.c.another("artem@example.com", "Артём К.").await;
    join(&f.c.pool, f.project, lena.user.id, "member").await;
    join(&f.c.pool, f.project, artem.user.id, "member").await;
    let task = id_of(&f.task(Some(f.todo), "Экспорт отчёта").await);
    World { f, lena, artem, task }
}

impl World {
    fn task_uri(&self) -> String {
        format!("/api/v1/tasks/{}", self.task)
    }

    async fn assign(&self, who: Option<Uuid>) -> StatusCode {
        self.f.c.patch(&self.task_uri(), json!({ "assignee_id": who })).await.status
    }

    /// Комментарий от тестера
    async fn comment(&self, body: &str) -> Value {
        let r = self.f.c.post(&format!("{}/comments", self.task_uri()), json!({ "body": body })).await;
        self.f.c.ok(r, StatusCode::CREATED).await
    }
}

fn mark(user: &Ctx) -> String {
    format!("@[{}]", user.user.id)
}

async fn list(who: &Ctx) -> Value {
    who.ok(who.get("/api/v1/notifications").await, StatusCode::OK).await
}

fn items(list: &Value) -> &Vec<Value> {
    list["items"].as_array().unwrap()
}

// ===== Назначили =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn assigning_a_member_notifies_them_and_nobody_else(pool: PgPool) {
    let w = world(pool).await;
    assert_eq!(w.assign(Some(w.lena.user.id)).await, StatusCode::OK);

    let mine = list(&w.lena).await;
    assert_eq!(mine["unread"], 1);
    let n = &items(&mine)[0];
    assert_eq!(n["kind"], "assigned");
    assert_eq!(n["actor_id"], w.f.c.user.id.to_string());
    assert_eq!(n["project_id"], w.f.project.to_string());
    assert_eq!(n["task_id"], w.task.to_string());
    assert_eq!(n["task_key"], "WEB-1");
    assert_eq!(n["task_title"], "Экспорт отчёта");
    assert_eq!(n["comment"], Value::Null);
    assert_eq!(n["read"], false);
    assert!(n["created_at"].as_str().unwrap().contains('T'));

    assert_eq!(list(&w.artem).await, json!({ "items": [], "unread": 0 }), "соседу ничего не пришло");
    assert_eq!(list(&w.f.c).await["unread"], 0, "и тому, кто назначил");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn assigning_yourself_changing_nothing_or_clearing_the_assignee_notifies_nobody(pool: PgPool) {
    let w = world(pool).await;
    assert_eq!(w.assign(Some(w.f.c.user.id)).await, StatusCode::OK);
    assert_eq!(list(&w.f.c).await["unread"], 0, "себя назначил: сообщать незачем");

    assert_eq!(w.assign(Some(w.lena.user.id)).await, StatusCode::OK);
    assert_eq!(list(&w.lena).await["unread"], 1);
    // тот же исполнитель ещё раз и просто правка названия: нового уведомления нет
    assert_eq!(w.assign(Some(w.lena.user.id)).await, StatusCode::OK);
    w.f.c.ok(w.f.c.patch(&w.task_uri(), json!({ "title": "Новое название" })).await, StatusCode::OK).await;
    assert_eq!(items(&list(&w.lena).await).len(), 1);

    // снял исполнителя: тоже тишина
    assert_eq!(w.assign(None).await, StatusCode::OK);
    assert_eq!(items(&list(&w.lena).await).len(), 1);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn an_unread_assignment_is_replaced_when_the_person_is_assigned_again(pool: PgPool) {
    let w = world(pool).await;
    w.assign(Some(w.lena.user.id)).await;
    let first = items(&list(&w.lena).await)[0]["id"].clone();
    w.assign(Some(w.artem.user.id)).await;
    w.assign(Some(w.lena.user.id)).await; // назначили, переназначили, снова назначили
    let again = list(&w.lena).await;
    assert_eq!(items(&again).len(), 1, "в списке одно свежее");
    assert_ne!(items(&again)[0]["id"], first);
    assert_eq!(items(&list(&w.artem).await).len(), 1, "Артёму своё");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn assigning_somebody_who_is_not_in_the_project_is_refused_and_creates_nothing(pool: PgPool) {
    let w = world(pool).await;
    let stranger = w.f.c.another("stranger@example.com", "Посторонний").await;
    assert_eq!(w.assign(Some(stranger.user.id)).await, StatusCode::BAD_REQUEST);
    assert_eq!(list(&stranger).await["unread"], 0);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_move_or_other_edit_that_does_not_touch_the_assignee_is_silent(pool: PgPool) {
    let w = world(pool).await;
    w.assign(Some(w.lena.user.id)).await;
    let r = w.f.c.patch(&w.task_uri(), json!({ "column_id": w.f.doing, "priority": "high" })).await;
    w.f.c.ok(r, StatusCode::OK).await;
    assert_eq!(items(&list(&w.lena).await).len(), 1);
}

// ===== Упомянули =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_mention_notifies_the_member_and_the_comment_keeps_the_marks(pool: PgPool) {
    let w = world(pool).await;
    let body = format!("{} посмотри, пожалуйста", mark(&w.lena));
    let comment = w.comment(&body).await;
    assert_eq!(comment["body"], body, "метка остаётся в тексте как есть");
    assert_eq!(comment["mentions"], json!([w.lena.user.id.to_string()]));

    let mine = list(&w.lena).await;
    let n = &items(&mine)[0];
    assert_eq!(n["kind"], "mentioned");
    assert_eq!(n["actor_id"], w.f.c.user.id.to_string());
    assert_eq!(n["task_key"], "WEB-1");
    assert_eq!(n["comment"], "@Лена М. посмотри, пожалуйста", "в превью вместо метки имя");
    assert_eq!(mine["unread"], 1);

    // задача отдаёт комментарий вместе со списком упомянутых
    let task = w.f.c.ok(w.f.c.get(&w.task_uri()).await, StatusCode::OK).await;
    assert_eq!(task["comments"][0]["mentions"], json!([w.lena.user.id.to_string()]));
    assert_eq!(list(&w.artem).await["unread"], 0);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn every_mentioned_member_gets_one_and_the_author_gets_none(pool: PgPool) {
    let w = world(pool).await;
    let body = format!("{l} и {a}, ещё раз {l}, и я сам {me}", l = mark(&w.lena), a = mark(&w.artem), me = mark(&w.f.c));
    let comment = w.comment(&body).await;
    assert_eq!(comment["mentions"].as_array().unwrap().len(), 3, "в списке все трое, без повторов");

    assert_eq!(items(&list(&w.lena).await).len(), 1);
    assert_eq!(items(&list(&w.artem).await).len(), 1);
    assert_eq!(list(&w.f.c).await["unread"], 0, "сам себе уведомление не шлёт");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn every_comment_with_a_mention_is_its_own_notification(pool: PgPool) {
    let w = world(pool).await;
    w.comment(&format!("раз {}", mark(&w.lena))).await;
    w.comment(&format!("два {}", mark(&w.lena))).await;
    let mine = list(&w.lena).await;
    assert_eq!(items(&mine).len(), 2);
    assert_eq!(items(&mine)[0]["comment"], "два @Лена М.", "новое первым");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn mentioning_somebody_outside_the_project_or_unknown_is_refused(pool: PgPool) {
    let w = world(pool).await;
    let stranger = w.f.c.another("stranger@example.com", "Посторонний").await;
    for target in [stranger.user.id, Uuid::new_v4()] {
        let r = w.f.c.post(&format!("{}/comments", w.task_uri()), json!({ "body": format!("привет @[{target}]") })).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{target}");
    }
    // даже вместе с настоящим участником: комментарий не создаётся целиком, и участнику ничего не приходит
    let both = format!("{} и @[{}]", mark(&w.lena), stranger.user.id);
    assert_eq!(w.f.c.post(&format!("{}/comments", w.task_uri()), json!({ "body": both })).await.status, StatusCode::BAD_REQUEST);
    let task = w.f.c.ok(w.f.c.get(&w.task_uri()).await, StatusCode::OK).await;
    assert!(task["comments"].as_array().unwrap().is_empty());
    assert_eq!(list(&w.lena).await["unread"], 0);
    assert_eq!(list(&stranger).await["unread"], 0);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn too_many_mentions_are_refused(pool: PgPool) {
    let w = world(pool).await;
    let many: Vec<String> = (0..=domain::mentions::MAX_MENTIONS).map(|_| format!("@[{}]", Uuid::new_v4())).collect();
    let r = w.f.c.post(&format!("{}/comments", w.task_uri()), json!({ "body": many.join(" ") })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert!(r.body["message"].as_str().unwrap().contains("не больше"), "{}", r.body);
    // ровно столько, сколько можно, но и это не участники, а значит отказ по другой причине
    let r = w.f.c.post(&format!("{}/comments", w.task_uri()), json!({ "body": format!("@[{}]", Uuid::new_v4()) })).await;
    assert!(r.body["message"].as_str().unwrap().contains("участника проекта"), "{}", r.body);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn text_that_only_looks_like_a_mark_is_just_text(pool: PgPool) {
    let w = world(pool).await;
    for body in ["@[не-id] и [скобки] и @Лена", "почта a@b.c", "@[]"] {
        let comment = w.comment(body).await;
        assert_eq!(comment["mentions"], json!([]), "{body}");
    }
    assert_eq!(list(&w.lena).await["unread"], 0);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn the_preview_follows_a_new_name_and_is_cut_when_long(pool: PgPool) {
    let w = world(pool).await;
    let long = format!("{} {}", mark(&w.lena), "очень длинный текст ".repeat(20));
    w.comment(&long).await;
    let n = items(&list(&w.lena).await)[0].clone();
    let text = n["comment"].as_str().unwrap().to_owned();
    assert!(text.starts_with("@Лена М. очень длинный текст"), "{text}");
    assert!(text.ends_with('…') && text.chars().count() <= 141, "{text}");

    // Лена сменила имя: в метках новое
    w.lena.ok(w.lena.patch("/api/v1/me", json!({ "name": "Елена Мельникова" })).await, StatusCode::OK).await;
    let renamed = items(&list(&w.lena).await)[0]["comment"].as_str().unwrap().to_owned();
    assert!(renamed.starts_with("@Елена Мельникова "), "{renamed}");
}

// ===== Список =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn the_list_is_only_mine_newest_first_and_counts_unread(pool: PgPool) {
    let w = world(pool).await;
    w.assign(Some(w.lena.user.id)).await;
    w.comment(&format!("раз {}", mark(&w.lena))).await;
    w.comment(&format!("для Артёма {}", mark(&w.artem))).await;
    w.comment(&format!("два {}", mark(&w.lena))).await;

    let mine = list(&w.lena).await;
    let kinds: Vec<_> = items(&mine).iter().map(|n| n["kind"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["mentioned", "mentioned", "assigned"], "новые первыми");
    assert_eq!(mine["unread"], 3);
    assert_eq!(items(&list(&w.artem).await).len(), 1);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn leaving_the_project_hides_notifications_and_archiving_hides_them_too(pool: PgPool) {
    let w = world(pool).await;
    w.assign(Some(w.lena.user.id)).await;
    let p = format!("/api/v1/projects/{}", w.f.project);

    w.f.c.ok(w.f.c.delete(&format!("{p}/members/{}", w.lena.user.id)).await, StatusCode::NO_CONTENT).await;
    assert_eq!(list(&w.lena).await, json!({ "items": [], "unread": 0 }));
    join(&w.f.c.pool, w.f.project, w.lena.user.id, "member").await;
    assert_eq!(list(&w.lena).await["unread"], 1, "вернулся, и уведомление снова видно");

    w.f.c.ok(w.f.c.post(&format!("{p}/archive"), json!({})).await, StatusCode::OK).await;
    assert_eq!(list(&w.lena).await["unread"], 0);
    w.f.c.ok(w.f.c.post(&format!("{p}/unarchive"), json!({})).await, StatusCode::OK).await;
    assert_eq!(list(&w.lena).await["unread"], 1);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn deleting_the_task_removes_its_notifications(pool: PgPool) {
    let w = world(pool).await;
    w.assign(Some(w.lena.user.id)).await;
    w.comment(&format!("тут {}", mark(&w.lena))).await;
    assert_eq!(list(&w.lena).await["unread"], 2);
    w.f.c.ok(w.f.c.delete(&w.task_uri()).await, StatusCode::NO_CONTENT).await;
    assert_eq!(list(&w.lena).await, json!({ "items": [], "unread": 0 }));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_task_in_a_module_with_a_key_is_named_by_its_series(pool: PgPool) {
    let w = world(pool).await;
    let module = w
        .f
        .c
        .ok(
            w.f.c.post(&format!("/api/v1/projects/{}/modules", w.f.project), json!({ "title": "SEO" })).await,
            StatusCode::CREATED,
        )
        .await;
    w.f.c
        .ok(w.f.c.patch(&format!("/api/v1/modules/{}", id_of(&module)), json!({ "key": "SEO" })).await, StatusCode::OK)
        .await;
    let task = id_of(&w.f.task(Some(w.f.todo), "В модуле").await);
    w.f.c
        .ok(w.f.c.patch(&format!("/api/v1/tasks/{task}"), json!({ "module_id": id_of(&module) })).await, StatusCode::OK)
        .await;
    w.f.c
        .ok(w.f.c.patch(&format!("/api/v1/tasks/{task}"), json!({ "assignee_id": w.lena.user.id })).await, StatusCode::OK)
        .await;
    assert_eq!(items(&list(&w.lena).await)[0]["task_key"], "SEO-1");
}

// ===== Прочитано =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn reading_one_notification_marks_it_and_lowers_the_counter(pool: PgPool) {
    let w = world(pool).await;
    w.assign(Some(w.lena.user.id)).await;
    w.comment(&format!("тут {}", mark(&w.lena))).await;
    let mine = list(&w.lena).await;
    let id = items(&mine)[0]["id"].as_str().unwrap().to_owned();

    w.lena.ok(w.lena.post(&format!("/api/v1/notifications/{id}/read"), json!({})).await, StatusCode::NO_CONTENT).await;
    let after = list(&w.lena).await;
    assert_eq!(after["unread"], 1);
    assert_eq!(items(&after)[0]["read"], true);
    assert_eq!(items(&after)[1]["read"], false);
    // повторно: то же самое, без ошибки
    w.lena.ok(w.lena.post(&format!("/api/v1/notifications/{id}/read"), json!({})).await, StatusCode::NO_CONTENT).await;
    assert_eq!(list(&w.lena).await["unread"], 1);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn somebody_elses_or_unknown_notification_is_not_found(pool: PgPool) {
    let w = world(pool).await;
    w.assign(Some(w.lena.user.id)).await;
    let id = items(&list(&w.lena).await)[0]["id"].as_str().unwrap().to_owned();
    for who in [&w.artem, &w.f.c] {
        assert_eq!(who.post(&format!("/api/v1/notifications/{id}/read"), json!({})).await.status, StatusCode::NOT_FOUND);
    }
    let unknown = Uuid::new_v4();
    assert_eq!(w.lena.post(&format!("/api/v1/notifications/{unknown}/read"), json!({})).await.status, StatusCode::NOT_FOUND);
    assert_eq!(w.lena.post("/api/v1/notifications/не-id/read", json!({})).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(list(&w.lena).await["unread"], 1, "чужие попытки ничего не прочитали");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn read_all_marks_only_my_notifications(pool: PgPool) {
    let w = world(pool).await;
    w.assign(Some(w.lena.user.id)).await;
    w.comment(&format!("тут {} и {}", mark(&w.lena), mark(&w.artem))).await;

    w.lena.ok(w.lena.post("/api/v1/notifications/read-all", json!({})).await, StatusCode::NO_CONTENT).await;
    let mine = list(&w.lena).await;
    assert_eq!(mine["unread"], 0);
    assert!(items(&mine).iter().all(|n| n["read"] == true));
    assert_eq!(list(&w.artem).await["unread"], 1, "у Артёма не тронуто");
    // когда читать нечего, тоже без ошибки
    w.lena.ok(w.lena.post("/api/v1/notifications/read-all", json!({})).await, StatusCode::NO_CONTENT).await;
}

// ===== События =====

type Heard = Vec<(&'static str, Audience)>;

fn heard(rx: &mut tokio::sync::broadcast::Receiver<std::sync::Arc<api::Event>>) -> Heard {
    let mut out = Vec::new();
    while let Ok(e) = rx.try_recv() {
        out.push((e.kind, e.audience.clone()));
    }
    out
}

fn notification_audiences(heard: &Heard) -> Vec<Audience> {
    heard.iter().filter(|(kind, _)| *kind == "notification.changed").map(|(_, a)| a.clone()).collect()
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_mention_and_an_assignment_tell_only_the_addressee(pool: PgPool) {
    let w = world(pool).await;
    let mut rx = w.f.c.events.subscribe();

    w.comment(&format!("{} и {}", mark(&w.lena), mark(&w.artem))).await;
    let sent = heard(&mut rx);
    assert_eq!(notification_audiences(&sent), [Audience::Users(vec![w.lena.user.id, w.artem.user.id])], "{sent:?}");
    assert!(sent.iter().any(|(k, a)| *k == "comment.created" && *a == Audience::Project(w.f.project)), "{sent:?}");

    w.assign(Some(w.lena.user.id)).await;
    let sent = heard(&mut rx);
    assert_eq!(notification_audiences(&sent), [Audience::Users(vec![w.lena.user.id])], "{sent:?}");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn without_a_recipient_there_is_no_notification_event(pool: PgPool) {
    let w = world(pool).await;
    let mut rx = w.f.c.events.subscribe();
    w.comment("просто комментарий").await;
    w.comment(&format!("себе {}", mark(&w.f.c))).await;
    w.assign(Some(w.f.c.user.id)).await;
    w.assign(None).await;
    assert!(notification_audiences(&heard(&mut rx)).is_empty());
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn reading_tells_the_readers_other_windows_only(pool: PgPool) {
    let w = world(pool).await;
    w.assign(Some(w.lena.user.id)).await;
    let id = items(&list(&w.lena).await)[0]["id"].as_str().unwrap().to_owned();
    let mut rx = w.f.c.events.subscribe();

    w.lena.post(&format!("/api/v1/notifications/{id}/read"), json!({})).await;
    assert_eq!(notification_audiences(&heard(&mut rx)), [Audience::Users(vec![w.lena.user.id])]);
    w.lena.post("/api/v1/notifications/read-all", json!({})).await;
    assert_eq!(notification_audiences(&heard(&mut rx)), [Audience::Users(vec![w.lena.user.id])]);

    // чужая попытка: ошибка, события нет
    w.artem.post(&format!("/api/v1/notifications/{id}/read"), json!({})).await;
    assert!(heard(&mut rx).is_empty());
}
