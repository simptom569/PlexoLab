//! Лента проекта на настоящем Postgres: страницы по 50, курсор, фильтры по участнику и типу, ошибки в запросе, события
//! только своего проекта плюс общие (вики), отказ постороннему.

mod common;

use axum::http::StatusCode;
use common::*;
use db::PgPool;
use serde_json::{Value, json};
use uuid::Uuid;

/// Событие вики или библиотеки (без проекта) напрямую в базе, в первой команде, с заданным временем (так проще получить
/// сотню событий и одинаковые времена)
async fn event(pool: &PgPool, actor: Uuid, kind: &str, target: &str, text: &str, at: &str) {
    db::sqlx::query("insert into activity (actor_id, team_id, kind, target, text, created_at) values ($1, (select id from teams order by seq limit 1), $2::act_kind, $3, $4, $5::timestamptz)")
        .bind(actor)
        .bind(kind)
        .bind(target)
        .bind(text)
        .bind(at)
        .execute(pool)
        .await
        .unwrap();
}

/// `n` событий подряд с интервалом в минуту, самое раннее первым: «Событие 1» старше «Событие n»
async fn many(pool: &PgPool, actor: Uuid, n: usize) {
    db::sqlx::query(
        "insert into activity (actor_id, team_id, kind, target, text, created_at) \
         select $1, (select id from teams order by seq limit 1), 'comment', 'Событие ' || i, 'тест', timestamptz '2026-10-01 00:00:00+00' + i * interval '1 minute' \
         from generate_series(1, $2::int) as i",
    )
    .bind(actor)
    .bind(n as i32)
    .execute(pool)
    .await
    .unwrap();
}

/// Контекст теста: проект «Web-приложение», ленту которого читают
async fn ctx(pool: PgPool) -> Ctx {
    let c = Ctx::new(pool.clone()).await;
    make_project(&pool, "WEB", "Web-приложение", "accent").await;
    c
}

/// Проект теста: первый по порядку создания
async fn project_of(pool: &PgPool) -> Uuid {
    db::sqlx::query_scalar("select id from projects order by seq limit 1").fetch_one(pool).await.unwrap()
}

async fn feed(c: &Ctx, query: &str) -> Value {
    let project = project_of(&c.pool).await;
    let r = c.get(&format!("/api/v1/projects/{project}/activity{query}")).await;
    c.ok(r, StatusCode::OK).await
}

fn targets(page: &Value) -> Vec<String> {
    page["items"].as_array().unwrap().iter().map(|e| str_field(e, "target").to_owned()).collect()
}

fn next(page: &Value) -> Option<String> {
    page["next"].as_str().map(str::to_owned)
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn feed_of_an_empty_database_is_empty(pool: PgPool) {
    let c = ctx(pool).await;
    assert_eq!(feed(&c, "").await, json!({ "items": [], "next": null }));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn events_come_newest_first_with_their_fields(pool: PgPool) {
    let c = ctx(pool.clone()).await;
    let project = project_of(&pool).await;
    db::sqlx::query("insert into activity (actor_id, project_id, kind, target, text, created_at) values ($1, $2, 'move', 'WEB-1 Задача', 'перемещена в «Готово»', '2026-10-17 18:20:00+00')")
        .bind(c.user.id)
        .bind(project)
        .execute(&pool)
        .await
        .unwrap();
    event(&pool, c.user.id, "wiki", "Страница «Архитектура»", "обновлена", "2026-10-18 09:00:00+00").await;
    event(&pool, c.user.id, "code", "WEB-1 Задача", "добавлен PR #1", "2026-10-16 09:00:00+00").await;

    let page = feed(&c, "").await;
    assert_eq!(targets(&page), ["Страница «Архитектура»", "WEB-1 Задача", "WEB-1 Задача"]);
    assert_eq!(page["next"], Value::Null);

    let wiki = &page["items"][0];
    assert_eq!(wiki["category"], "wiki");
    assert_eq!(wiki["text"], "обновлена");
    assert_eq!(wiki["actor_id"], c.user.id.to_string());
    assert_eq!(wiki["project_id"], Value::Null, "у страницы вики проекта нет, но в ленте проекта она есть");
    assert_eq!(wiki["created_at"], "2026-10-18T09:00:00Z");
    assert!(Uuid::parse_str(str_field(wiki, "id")).is_ok());

    let moved = &page["items"][1];
    assert_eq!(moved["category"], "tasks", "перенос задачи — категория «Задача»");
    assert_eq!(moved["project_id"], project.to_string());
    assert_eq!(page["items"][2]["category"], "code");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn wiki_events_are_their_own_category_and_not_documents(pool: PgPool) {
    let c = ctx(pool.clone()).await;
    let project = project_of(&pool).await;
    event(&pool, c.user.id, "wiki", "Страница «Архитектура»", "обновлена", "2026-10-18 09:00:00+00").await;
    db::sqlx::query("insert into activity (actor_id, project_id, kind, target, text, created_at) values ($1, $2, 'doc', 'Документ «Схема»', 'создан', '2026-10-18 10:00:00+00')")
        .bind(c.user.id)
        .bind(project)
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(targets(&feed(&c, "?kind=wiki").await), ["Страница «Архитектура»"]);
    assert_eq!(targets(&feed(&c, "?kind=doc").await), ["Документ «Схема»"], "вики в «Документах» нет");
    assert_eq!(targets(&feed(&c, "").await), ["Документ «Схема»", "Страница «Архитектура»"]);
    let all = feed(&c, "").await;
    assert_eq!(all["items"][0]["category"], "doc");
    assert_eq!(all["items"][1]["category"], "wiki");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn every_event_type_has_a_category(pool: PgPool) {
    let c = ctx(pool.clone()).await;
    let kinds: Vec<String> =
        db::sqlx::query_scalar("select unnest(enum_range(null::act_kind))::text").fetch_all(&pool).await.unwrap();
    assert!(kinds.len() >= 10, "типы событий: {kinds:?}");
    for (i, kind) in kinds.iter().enumerate() {
        event(&pool, c.user.id, kind, &format!("цель {i}"), "тест", &format!("2026-10-18 10:{i:02}:00+00")).await;
    }
    let page = feed(&c, "").await;
    for item in page["items"].as_array().unwrap() {
        let category = str_field(item, "category");
        assert!(domain::activity::CATEGORIES.contains(&category), "категория {category} неизвестна фильтру");
    }
    // и каждый тип находится фильтром своей категории
    for category in domain::activity::CATEGORIES {
        let page = feed(&c, &format!("?kind={category}")).await;
        assert!(!page["items"].as_array().unwrap().is_empty(), "по категории {category} ничего нет");
    }
}

// ===== Страницы =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn feed_is_paged_by_fifty_through_the_cursor(pool: PgPool) {
    let c = ctx(pool.clone()).await;
    many(&pool, c.user.id, 120).await;

    let first = feed(&c, "").await;
    assert_eq!(first["items"].as_array().unwrap().len(), 50);
    assert_eq!(targets(&first)[0], "Событие 120", "самое новое первым");
    assert_eq!(targets(&first)[49], "Событие 71");
    let cursor = next(&first).expect("есть ещё события");

    let second = feed(&c, &format!("?before={cursor}")).await;
    assert_eq!(second["items"].as_array().unwrap().len(), 50);
    assert_eq!(targets(&second)[0], "Событие 70", "ни пропуска, ни повтора на стыке страниц");
    assert_eq!(targets(&second)[49], "Событие 21");
    let cursor = next(&second).expect("осталось ещё 20");

    let third = feed(&c, &format!("?before={cursor}")).await;
    assert_eq!(third["items"].as_array().unwrap().len(), 20);
    assert_eq!(targets(&third)[19], "Событие 1");
    assert_eq!(next(&third), None, "последняя страница без курсора");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn exactly_one_page_has_no_cursor(pool: PgPool) {
    let c = ctx(pool.clone()).await;
    many(&pool, c.user.id, 50).await;
    let page = feed(&c, "").await;
    assert_eq!(page["items"].as_array().unwrap().len(), 50);
    assert_eq!(next(&page), None, "ровно пятьдесят событий: следующей страницы нет");

    many(&pool, c.user.id, 1).await;
    let page = feed(&c, "").await;
    assert_eq!(page["items"].as_array().unwrap().len(), 50);
    let cursor = next(&page).expect("пятьдесят первое событие осталось на второй странице");
    let rest = feed(&c, &format!("?before={cursor}")).await;
    assert_eq!(rest["items"].as_array().unwrap().len(), 1);
    assert_eq!(next(&rest), None);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn events_with_the_same_time_are_neither_lost_nor_repeated(pool: PgPool) {
    let c = ctx(pool.clone()).await;
    for i in 0..120 {
        event(&pool, c.user.id, "comment", &format!("Одно время {i}"), "тест", "2026-10-18 12:00:00+00").await;
    }
    let mut seen = Vec::new();
    let mut query = String::new();
    loop {
        let page = feed(&c, &query).await;
        seen.extend(page["items"].as_array().unwrap().iter().map(|e| str_field(e, "id").to_owned()));
        match next(&page) {
            Some(cursor) => query = format!("?before={cursor}"),
            None => break,
        }
    }
    assert_eq!(seen.len(), 120);
    let unique: std::collections::HashSet<_> = seen.iter().collect();
    assert_eq!(unique.len(), 120, "повторов нет");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn event_added_while_paging_does_not_shift_the_next_page(pool: PgPool) {
    let c = ctx(pool.clone()).await;
    many(&pool, c.user.id, 60).await;
    let first = feed(&c, "").await;
    let cursor = next(&first).unwrap();

    // пока читали первую страницу, появилось новое событие: курсор считает «от места», а не «с такой-то позиции»
    event(&pool, c.user.id, "comment", "Новое", "тест", "2026-12-01 00:00:00+00").await;
    let second = feed(&c, &format!("?before={cursor}")).await;
    assert_eq!(targets(&second), (1..=10).rev().map(|i| format!("Событие {i}")).collect::<Vec<_>>());
}

// ===== Фильтры =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn feed_is_filtered_by_actor_and_category(pool: PgPool) {
    let c = ctx(pool.clone()).await;
    let other = make_user(&pool, "other@example.com", "Другой Д.", "password-123").await;
    event(&pool, c.user.id, "move", "WEB-1 А", "перемещена", "2026-10-18 10:00:00+00").await;
    event(&pool, c.user.id, "create", "WEB-2 Б", "создана", "2026-10-18 10:01:00+00").await;
    event(&pool, c.user.id, "delete", "WEB-3 В", "удалена", "2026-10-18 10:02:00+00").await;
    event(&pool, other.id, "move", "WEB-4 Г", "перемещена", "2026-10-18 10:03:00+00").await;
    event(&pool, other.id, "comment", "WEB-4 Г", "новый комментарий", "2026-10-18 10:04:00+00").await;
    event(&pool, c.user.id, "module", "Модуль «SSO»", "создан", "2026-10-18 10:05:00+00").await;

    let tasks = feed(&c, "?kind=tasks").await;
    assert_eq!(targets(&tasks), ["WEB-4 Г", "WEB-3 В", "WEB-2 Б", "WEB-1 А"], "задачи: перенос, создание и удаление");

    let mine = feed(&c, &format!("?actor={}", c.user.id)).await;
    assert_eq!(targets(&mine), ["Модуль «SSO»", "WEB-3 В", "WEB-2 Б", "WEB-1 А"]);

    let both = feed(&c, &format!("?actor={}&kind=tasks", other.id)).await;
    assert_eq!(targets(&both), ["WEB-4 Г"]);

    assert_eq!(targets(&feed(&c, "?kind=module").await), ["Модуль «SSO»"]);
    assert_eq!(targets(&feed(&c, "?kind=comment").await), ["WEB-4 Г"]);
    assert_eq!(targets(&feed(&c, "?kind=file").await), Vec::<String>::new());
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn filters_work_together_with_the_cursor(pool: PgPool) {
    let c = ctx(pool.clone()).await;
    let other = make_user(&pool, "other@example.com", "Другой Д.", "password-123").await;
    many(&pool, c.user.id, 70).await;
    // между ними «чужие» события: они не должны попасть в страницы и сбивать курсор
    for i in 0..30 {
        event(&pool, other.id, "comment", &format!("Чужое {i}"), "тест", &format!("2026-10-01 00:{:02}:30+00", i + 1))
            .await;
    }

    let query = format!("?actor={}&kind=comment", c.user.id);
    let first = feed(&c, &query).await;
    assert_eq!(first["items"].as_array().unwrap().len(), 50);
    let cursor = next(&first).unwrap();
    let second = feed(&c, &format!("{query}&before={cursor}")).await;
    assert_eq!(second["items"].as_array().unwrap().len(), 20);
    assert_eq!(next(&second), None);
    assert!(targets(&first).iter().chain(targets(&second).iter()).all(|t| t.starts_with("Событие ")));
}

// ===== Ошибки =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn bad_query_is_rejected(pool: PgPool) {
    let c = ctx(pool).await;
    for query in [
        "?kind=all",
        "?kind=",
        "?kind=Tasks",
        "?before=abc",
        "?before=",
        "?before=1_2",
        "?before=9223372036854775807_00000000-0000-0000-0000-000000000000",
        "?actor=не-uuid",
    ] {
        let r = c.get(&format!("/api/v1/projects/{}/activity{query}", project_of(&c.pool).await)).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{query}: {}", r.body);
        assert_eq!(r.body["code"], "bad_request");
    }
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn feed_needs_a_token(pool: PgPool) {
    let c = ctx(pool).await;
    let uri = format!("/api/v1/projects/{}/activity", project_of(&c.pool).await);
    let r = send(&c.app, axum::http::Method::GET, &uri, None, None).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
}

// ===== Запись сервером =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn actions_on_other_pages_show_up_in_the_feed(pool: PgPool) {
    let f = Fx::new(pool).await;
    let task = f.task(Some(f.todo), "Новая задача").await;
    let r = f.c.post(&format!("/api/v1/tasks/{}/comments", id_of(&task)), json!({ "body": "Привет" })).await;
    f.c.ok(r, StatusCode::CREATED).await;
    let r = f.c.patch(&format!("/api/v1/tasks/{}", id_of(&task)), json!({ "column_id": f.done })).await;
    f.c.ok(r, StatusCode::OK).await;

    let page = feed(&f.c, "").await;
    let items = page["items"].as_array().unwrap();
    let got: Vec<(&str, &str, &str)> =
        items.iter().map(|e| (str_field(e, "category"), str_field(e, "target"), str_field(e, "text"))).collect();
    assert_eq!(
        got,
        [
            ("tasks", "WEB-1 Новая задача", "перемещена в «Готово»"),
            ("comment", "WEB-1 Новая задача", "новый комментарий"),
            ("tasks", "WEB-1 Новая задача", "создана"),
        ]
    );
    assert!(items.iter().all(|e| e["actor_id"] == f.c.user.id.to_string() && e["project_id"] == f.project.to_string()));
    assert_eq!(targets(&feed(&f.c, "?kind=comment").await), ["WEB-1 Новая задача"]);
}

// ===== Лента проекта: свои события, общие и чужие =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn feed_has_the_events_of_its_project_and_the_common_ones_but_not_another_projects(pool: PgPool) {
    let c = ctx(pool.clone()).await;
    let mine = project_of(&pool).await;
    let other = make_project(&pool, "API", "Мобильный API", "warn").await;
    for (project, target, at) in [
        (Some(mine), "WEB-1 Моя задача", "2026-10-18 10:00:00+00"),
        (Some(other), "API-1 Чужая задача", "2026-10-18 10:01:00+00"),
        (None, "Страница «Архитектура»", "2026-10-18 10:02:00+00"),
    ] {
        db::sqlx::query(
            "insert into activity (actor_id, project_id, team_id, kind, target, text, created_at) \
             values ($1, $2, case when $2::uuid is null then (select id from teams order by seq limit 1) end, 'create', $3, 'создана', $4::timestamptz)",
        )
        .bind(c.user.id)
        .bind(project)
        .bind(target)
        .bind(at)
        .execute(&pool)
        .await
        .unwrap();
    }

    assert_eq!(
        targets(&feed(&c, "").await),
        ["Страница «Архитектура»", "WEB-1 Моя задача"],
        "свои и общие, чужого проекта нет"
    );
    let r = c.get(&format!("/api/v1/projects/{other}/activity")).await;
    let page = c.ok(r, StatusCode::OK).await;
    assert_eq!(
        targets(&page),
        ["Страница «Архитектура»", "API-1 Чужая задача"],
        "у другого проекта своя лента, общие события те же"
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_stranger_gets_no_feed_of_a_project_and_a_missing_project_is_the_same_nothing(pool: PgPool) {
    let c = ctx(pool.clone()).await;
    let project = project_of(&pool).await;
    event(&pool, c.user.id, "comment", "Тайна", "тест", "2026-10-18 10:00:00+00").await;
    let stranger = c.another("stranger@example.com", "Посторонний").await;

    let uri = format!("/api/v1/projects/{project}/activity");
    assert_eq!(stranger.get(&uri).await.status, StatusCode::NOT_FOUND);
    let missing = format!("/api/v1/projects/{}/activity", Uuid::new_v4());
    assert_eq!(c.get(&missing).await.status, StatusCode::NOT_FOUND);
    assert_eq!(c.get(&uri).await.status, StatusCode::OK);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn the_feed_names_everyone_who_has_events_of_the_project_but_not_the_authors_of_common_ones(pool: PgPool) {
    let c = ctx(pool.clone()).await;
    let mine = project_of(&pool).await;
    let other_project = make_project(&pool, "API", "Мобильный API", "warn").await;
    let here = make_user(&pool, "here@example.com", "Здесь З.", "password-123").await;
    let there = make_user(&pool, "there@example.com", "Там Т.", "password-123").await;
    let wiki = make_user(&pool, "wiki@example.com", "Вики В.", "password-123").await;
    let quiet = make_user(&pool, "quiet@example.com", "Тихий Т.", "password-123").await;
    for (who, project, kind) in
        [(here.id, Some(mine), "code"), (there.id, Some(other_project), "code"), (wiki.id, None, "wiki")]
    {
        db::sqlx::query(
            "insert into activity (actor_id, project_id, kind, target, text) values ($1, $2, $3::act_kind, 'цель', 'тест')",
        )
        .bind(who)
        .bind(project)
        .bind(kind)
        .execute(&pool)
        .await
        .unwrap();
    }

    let uri = format!("/api/v1/projects/{mine}/activity/actors");
    let found = c.ok(c.get(&uri).await, StatusCode::OK).await;
    let ids: std::collections::BTreeSet<String> =
        found.as_array().unwrap().iter().map(|a| a.as_str().unwrap().to_owned()).collect();
    let expected: std::collections::BTreeSet<String> = [here.id].iter().map(|u| u.to_string()).collect();
    assert_eq!(ids, expected, "только авторы событий этого проекта");
    assert!(!ids.contains(&wiki.id.to_string()), "автор страницы вики в проекте не бывал: в списке его нет");
    assert!(!ids.contains(&quiet.id.to_string()), "у кого событий нет, того нет");
    assert!(!ids.contains(&there.id.to_string()));

    // чужому проект закрыт, как и сама лента
    let stranger = c.another("stranger@example.com", "Посторонний").await;
    assert_eq!(stranger.get(&uri).await.status, StatusCode::NOT_FOUND);
    assert_eq!(
        c.get(&format!("/api/v1/projects/{}/activity/actors", Uuid::new_v4())).await.status,
        StatusCode::NOT_FOUND
    );
}
