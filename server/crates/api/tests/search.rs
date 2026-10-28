//! Поиск по названиям (docs/OFFLINE-NOTIFY-SEARCH.md, раздел 3): задачи и их id, документы, страницы вики, файлы
//! библиотеки; только из доступных проектов; содержимое не ищется. Всё на настоящем Postgres.

mod common;

use axum::http::StatusCode;
use common::*;
use db::PgPool;
use serde_json::{Value, json};
use uuid::Uuid;

/// Запрос в адресе: всё, кроме букв и цифр латиницы, байтами в процентной записи
fn enc(q: &str) -> String {
    q.bytes()
        .map(|b| if b.is_ascii_alphanumeric() { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

async fn find(who: &Ctx, q: &str) -> Value {
    let team = first_team(&who.pool).await;
    who.ok(who.get(&format!("/api/v1/search?team={team}&q={}", enc(q))).await, StatusCode::OK).await
}

/// Статус поиска по команде проектов: чужому команда не видна совсем
async fn find_status(who: &Ctx, q: &str) -> StatusCode {
    let team = first_team(&who.pool).await;
    who.get(&format!("/api/v1/search?team={team}&q={}", enc(q))).await.status
}

fn titles(hits: &Value, kind: &str, field: &str) -> Vec<String> {
    hits[kind].as_array().unwrap().iter().map(|h| str_field(h, field).to_owned()).collect()
}

fn keys(hits: &Value) -> Vec<String> {
    titles(hits, "tasks", "key")
}

async fn doc(f: &Fx, title: &str, md: &str) -> Uuid {
    let r = f.c.post(&format!("/api/v1/projects/{}/docs", f.project), json!({ "title": title, "md": md })).await;
    id_of(&f.c.ok(r, StatusCode::CREATED).await)
}

async fn wiki_page(f: &Fx, title: &str, md: &str) -> Uuid {
    id_of(&f.c.ok(f.c.post(&f.c.wiki_url(), json!({ "title": title, "md": md })).await, StatusCode::CREATED).await)
}

async fn library_file(f: &Fx, name: &str) -> Uuid {
    id_of(&f.c.ok(f.c.upload(&f.c.files_url(), &[file_part(name, b"x")]).await, StatusCode::CREATED).await[0])
}

// ===== Что находит =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_task_is_found_by_a_part_of_its_title_whatever_the_case(pool: PgPool) {
    let f = Fx::new(pool).await;
    f.task(Some(f.todo), "Экспорт отчёта в CSV").await;
    f.task(Some(f.todo), "Обновить зависимости").await;

    for q in ["экспорт", "ЭКСПОРТ", "отчёт", "в csv", "  экспорт  "] {
        assert_eq!(titles(&find(&f.c, q).await, "tasks", "title"), ["Экспорт отчёта в CSV"], "{q:?}");
    }
    assert!(keys(&find(&f.c, "несуществующее").await).is_empty());
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_task_is_found_by_its_id_in_any_case_and_by_a_part_of_it(pool: PgPool) {
    let f = Fx::new(pool).await;
    f.task(Some(f.todo), "Первая").await; // WEB-1
    f.task(Some(f.todo), "Вторая").await; // WEB-2

    assert_eq!(keys(&find(&f.c, "WEB-2").await), ["WEB-2"]);
    assert_eq!(keys(&find(&f.c, "web-2").await), ["WEB-2"]);
    assert_eq!(keys(&find(&f.c, "-2").await), ["WEB-2"]);
    // по общему началу находятся обе, а при равенстве свежая первой
    assert_eq!(keys(&find(&f.c, "WEB").await), ["WEB-2", "WEB-1"]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_task_in_a_module_with_a_key_is_found_by_the_key_of_its_series(pool: PgPool) {
    let f = Fx::new(pool).await;
    let module = f
        .c
        .ok(
            f.c.post(&format!("/api/v1/projects/{}/modules", f.project), json!({ "title": "Поиск" })).await,
            StatusCode::CREATED,
        )
        .await;
    f.c.ok(f.c.patch(&format!("/api/v1/modules/{}", id_of(&module)), json!({ "key": "SEO" })).await, StatusCode::OK).await;
    let task = id_of(&f.task(Some(f.todo), "Мета-теги").await);
    f.c.ok(f.c.patch(&format!("/api/v1/tasks/{task}"), json!({ "module_id": id_of(&module) })).await, StatusCode::OK)
        .await;

    let hits = find(&f.c, "SEO-1").await;
    assert_eq!(keys(&hits), ["SEO-1"]);
    assert_eq!(titles(&hits, "tasks", "title"), ["Мета-теги"]);
    assert!(keys(&find(&f.c, "WEB-2").await).is_empty(), "прежнего id у задачи больше нет");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_task_without_any_key_is_found_as_task(pool: PgPool) {
    let f = Fx::new(pool).await;
    db::sqlx::query("update projects set key = null where id = $1").bind(f.project).execute(&f.c.pool).await.unwrap();
    f.task(Some(f.todo), "Без ключа").await;
    assert_eq!(keys(&find(&f.c, "task-1").await), ["TASK-1"]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_hit_carries_everything_needed_to_open_it(pool: PgPool) {
    let f = Fx::new(pool).await;
    let task = f.task(Some(f.todo), "Тёмная тема").await;
    let d = doc(&f, "Тёмная палитра", "").await;
    let hits = find(&f.c, "тёмная").await;
    assert_eq!(
        hits["tasks"][0],
        json!({ "id": id_of(&task), "project_id": f.project, "project_name": "Web-приложение", "key": "WEB-1", "title": "Тёмная тема" })
    );
    assert_eq!(
        hits["docs"][0],
        json!({ "id": d, "project_id": f.project, "project_name": "Web-приложение", "title": "Тёмная палитра", "mode": "page" })
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn documents_wiki_pages_and_library_files_are_found_by_name(pool: PgPool) {
    let f = Fx::new(pool).await;
    doc(&f, "Планирование Q4", "").await;
    doc(&f, "Схема сервисов", "").await;
    wiki_page(&f, "Архитектура планирования", "").await;
    wiki_page(&f, "Онбординг", "").await;
    library_file(&f, "план-релиза.pdf").await;
    library_file(&f, "логотип.png").await;

    let hits = find(&f.c, "ПЛАН").await;
    assert_eq!(titles(&hits, "docs", "title"), ["Планирование Q4"]);
    assert_eq!(titles(&hits, "wiki", "title"), ["Архитектура планирования"]);
    assert_eq!(titles(&hits, "files", "name"), ["план-релиза.pdf"]);
    assert_eq!(hits["files"][0]["kind"], "pdf");
    assert_eq!(hits["files"][0]["size_bytes"], 1);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_canvas_document_is_marked_as_such(pool: PgPool) {
    let f = Fx::new(pool).await;
    let r = f.c.post(&format!("/api/v1/projects/{}/docs", f.project), json!({ "title": "Холст идей", "mode": "edge" })).await;
    f.c.ok(r, StatusCode::CREATED).await;
    assert_eq!(find(&f.c, "холст").await["docs"][0]["mode"], "edge");
}

// ===== Чего не находит =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn content_is_not_searched_only_names(pool: PgPool) {
    let f = Fx::new(pool).await;
    let task = f.task(Some(f.todo), "Обычная задача").await;
    f.c.ok(
        f.c.patch(&format!("/api/v1/tasks/{}", id_of(&task)), json!({ "description": "секретное слово в описании" })).await,
        StatusCode::OK,
    )
    .await;
    f.c.ok(f.c.post(&format!("/api/v1/tasks/{}/comments", id_of(&task)), json!({ "body": "секретное слово в комментарии" })).await, StatusCode::CREATED).await;
    doc(&f, "Обычный документ", "секретное слово в тексте").await;
    wiki_page(&f, "Обычная страница", "секретное слово на странице").await;

    let hits = find(&f.c, "секретное").await;
    for kind in ["tasks", "docs", "wiki", "files"] {
        assert!(hits[kind].as_array().unwrap().is_empty(), "{kind}: {hits}");
    }
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn task_attachments_are_not_library_files(pool: PgPool) {
    let f = Fx::new(pool).await;
    let task = f.task(Some(f.todo), "Задача").await;
    f.c.ok(
        f.c.upload(&format!("/api/v1/tasks/{}/files", id_of(&task)), &[file_part("вложение-задачи.txt", b"1")]).await,
        StatusCode::CREATED,
    )
    .await;
    library_file(&f, "файл-библиотеки.txt").await;
    assert!(titles(&find(&f.c, "вложение").await, "files", "name").is_empty());
    assert_eq!(titles(&find(&f.c, "файл-библиотеки").await, "files", "name"), ["файл-библиотеки.txt"]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn an_untitled_document_matches_nothing(pool: PgPool) {
    let f = Fx::new(pool).await;
    let r = f.c.post(&format!("/api/v1/projects/{}/docs", f.project), json!({ "md": "без названия" })).await;
    f.c.ok(r, StatusCode::CREATED).await;
    assert!(find(&f.c, "без").await["docs"].as_array().unwrap().is_empty());
}

// ===== Доступ =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn tasks_and_documents_of_a_foreign_project_are_not_found_and_wiki_and_files_belong_to_the_team(pool: PgPool) {
    let f = Fx::new(pool).await;
    let stranger = f.c.another("stranger@example.com", "Посторонний").await;
    let mate = f.c.another("mate@example.com", "Член команды").await;
    join_team(&f.c.pool, f.c.team, mate.user.id, "member").await;
    f.task(Some(f.todo), "Секретная задача").await;
    doc(&f, "Секретный документ", "").await;
    wiki_page(&f, "Секретная страница вики", "").await;
    library_file(&f, "секретный-файл.txt").await;

    let mine = find(&f.c, "секрет").await;
    assert_eq!(keys(&mine).len(), 1);
    assert_eq!(titles(&mine, "docs", "title").len(), 1);

    // посторонний не знает и о команде: искать в ней нельзя
    assert_eq!(find_status(&stranger, "секрет").await, StatusCode::NOT_FOUND);

    // член команды, которого нет в проекте: задача и документ закрыты, вики и файлы команды открыты
    let theirs = find(&mate, "секрет").await;
    assert!(keys(&theirs).is_empty(), "чужая задача не видна: {theirs}");
    assert!(titles(&theirs, "docs", "title").is_empty(), "чужой документ не виден: {theirs}");
    assert_eq!(titles(&theirs, "wiki", "title"), ["Секретная страница вики"]);
    assert_eq!(titles(&theirs, "files", "name"), ["секретный-файл.txt"]);

    // проект стал «Вся команда»: его задачи и документы видны всей команде
    db::sqlx::query("update projects set visibility = 'team' where id = $1").bind(f.project).execute(&f.c.pool).await.unwrap();
    let open = find(&mate, "секрет").await;
    assert_eq!(keys(&open).len(), 1);
    assert_eq!(titles(&open, "docs", "title").len(), 1);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_guest_searches_only_his_projects_and_the_wiki_only_when_the_team_allows_it(pool: PgPool) {
    let f = Fx::new(pool).await;
    let other = make_project(&f.c.pool, "API", "Api", "warn").await;
    let guest = f.c.another("guest@example.com", "Гость").await;
    join(&f.c.pool, f.project, guest.user.id, "member").await;
    f.task(Some(f.todo), "Видимая задача").await;
    db::sqlx::query("insert into tasks (project_id, number, title, position) values ($1, 1, 'Закрытая задача', 1)")
        .bind(other)
        .execute(&f.c.pool)
        .await
        .unwrap();
    wiki_page(&f, "Страница команды", "").await;
    library_file(&f, "файл-команды.txt").await;

    let hits = find(&guest, "задача").await;
    assert_eq!(keys(&hits).len(), 1, "только задача своего проекта: {hits}");
    assert!(titles(&hits, "wiki", "title").is_empty() && titles(&hits, "files", "name").is_empty(), "вики закрыта: {hits}");

    db::sqlx::query("update teams set guests_read_wiki = true").execute(&f.c.pool).await.unwrap();
    let hits = find(&guest, "команды").await;
    assert_eq!(titles(&hits, "wiki", "title"), ["Страница команды"]);
    assert_eq!(find(&guest, "файл-команды").await["files"].as_array().unwrap().len(), 1);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_member_sees_the_project_and_stops_seeing_it_after_leaving(pool: PgPool) {
    let f = Fx::new(pool).await;
    let mate = f.c.another("mate@example.com", "Участник").await;
    join(&f.c.pool, f.project, mate.user.id, "member").await;
    f.task(Some(f.todo), "Общая задача").await;
    doc(&f, "Общий документ", "").await;
    assert_eq!(keys(&find(&mate, "общая").await).len(), 1);
    assert_eq!(titles(&find(&mate, "общий").await, "docs", "title").len(), 1);

    f.c.ok(f.c.delete(&format!("/api/v1/projects/{}/members/{}", f.project, mate.user.id)).await, StatusCode::NO_CONTENT).await;
    // он не член команды, а гостем быть перестал: ни проект, ни сама команда ему больше не видны
    assert_eq!(find_status(&mate, "общая").await, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn an_archived_project_is_not_searched_until_it_returns(pool: PgPool) {
    let f = Fx::new(pool).await;
    f.task(Some(f.todo), "Задача в архиве").await;
    doc(&f, "Документ в архиве", "").await;
    let p = format!("/api/v1/projects/{}", f.project);

    f.c.ok(f.c.post(&format!("{p}/archive"), json!({})).await, StatusCode::OK).await;
    let hidden = find(&f.c, "в архиве").await;
    assert!(keys(&hidden).is_empty() && titles(&hidden, "docs", "title").is_empty(), "{hidden}");

    f.c.ok(f.c.post(&format!("{p}/unarchive"), json!({})).await, StatusCode::OK).await;
    assert_eq!(keys(&find(&f.c, "в архиве").await).len(), 1);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_global_admin_searches_every_project(pool: PgPool) {
    let f = Fx::new(pool).await;
    f.task(Some(f.todo), "Чужой секрет").await;
    let admin = f.c.another_admin("root@example.com", "Админ").await;
    assert_eq!(keys(&find(&admin, "секрет").await).len(), 1);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn each_person_finds_tasks_of_each_project_they_belong_to(pool: PgPool) {
    let f = Fx::new(pool.clone()).await;
    let second = make_project(&pool, "API", "Мобильный API", "warn").await;
    let other = f.c.another("other@example.com", "Другой").await;
    join(&pool, second, other.user.id, "member").await;
    f.task(Some(f.todo), "Задача в WEB").await;
    let r = f.c.post(&format!("/api/v1/projects/{second}/tasks"), json!({ "title": "Задача в API" })).await;
    f.c.ok(r, StatusCode::CREATED).await;

    let mine = find(&f.c, "задача в").await;
    assert_eq!(keys(&mine).len(), 2, "тестер состоит в обоих: {mine}");
    let theirs = find(&other, "задача в").await;
    assert_eq!(keys(&theirs), ["API-1"], "Другой только во втором: {theirs}");
    assert_eq!(theirs["tasks"][0]["project_name"], "Мобильный API");
}

// ===== Порядок и пределы =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn exact_id_comes_first_then_starts_with_then_the_rest(pool: PgPool) {
    let f = Fx::new(pool).await;
    for n in 0..11 {
        f.task(Some(f.todo), &format!("Задача номер {n}")).await; // WEB-1 … WEB-11
    }
    let by_id = find(&f.c, "web-1").await;
    assert_eq!(keys(&by_id)[0], "WEB-1", "точное совпадение с id первым: {by_id}");

    let a = f.task(Some(f.todo), "План релиза").await;
    f.task(Some(f.todo), "Согласовать план").await;
    f.task(Some(f.todo), "ПЛАНЕТА").await;
    let by_title = titles(&find(&f.c, "план").await, "tasks", "title");
    // сначала названия на «план» (позднее менявшееся выше), потом то, где «план» в середине
    assert_eq!(by_title.len(), 3);
    assert_eq!(by_title[2], "Согласовать план");
    assert!(by_title[..2].contains(&"План релиза".to_owned()) && by_title[..2].contains(&"ПЛАНЕТА".to_owned()), "{by_title:?}");
    let _ = a;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn the_most_recently_changed_goes_first_inside_a_group(pool: PgPool) {
    let f = Fx::new(pool).await;
    let first = f.task(Some(f.todo), "Отчёт один").await;
    f.task(Some(f.todo), "Отчёт два").await;
    // правка первой делает её самой свежей
    f.c.ok(f.c.patch(&format!("/api/v1/tasks/{}", id_of(&first)), json!({ "pr": "#1" })).await, StatusCode::OK).await;
    assert_eq!(titles(&find(&f.c, "отчёт").await, "tasks", "title"), ["Отчёт один", "Отчёт два"]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn each_kind_returns_at_most_eight(pool: PgPool) {
    let f = Fx::new(pool).await;
    for n in 0..12 {
        f.task(Some(f.todo), &format!("Сборка {n}")).await;
        doc(&f, &format!("Сборка документ {n}"), "").await;
        wiki_page(&f, &format!("Сборка страница {n}"), "").await;
        library_file(&f, &format!("сборка-{n}.txt")).await;
    }
    let hits = find(&f.c, "сборка").await;
    for kind in ["tasks", "docs", "wiki", "files"] {
        assert_eq!(hits[kind].as_array().unwrap().len(), domain::search::LIMIT_PER_KIND as usize, "{kind}");
    }
}

// ===== Запрос =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn an_empty_or_missing_query_finds_nothing_without_an_error(pool: PgPool) {
    let f = Fx::new(pool).await;
    f.task(Some(f.todo), "Задача").await;
    let empty = json!({ "tasks": [], "docs": [], "wiki": [], "files": [] });
    for tail in ["", "&q=", "&q=%20%20", "&other=1"] {
        let uri = format!("/api/v1/search?team={}{tail}", f.c.team);
        assert_eq!(f.c.ok(f.c.get(&uri).await, StatusCode::OK).await, empty, "{uri}");
    }
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_too_long_query_is_refused(pool: PgPool) {
    let f = Fx::new(pool).await;
    let long = "я".repeat(domain::search::MAX_QUERY_LEN + 1);
    let r = f.c.get(&format!("/api/v1/search?team={}&q={}", f.c.team, enc(&long))).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let ok = "я".repeat(domain::search::MAX_QUERY_LEN);
    f.c.ok(f.c.get(&format!("/api/v1/search?team={}&q={}", f.c.team, enc(&ok))).await, StatusCode::OK).await;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn wildcards_and_backslashes_in_the_query_are_ordinary_characters(pool: PgPool) {
    let f = Fx::new(pool).await;
    f.task(Some(f.todo), "Готово на 100% к релизу").await;
    f.task(Some(f.todo), "Готово на 100 к релизу").await;
    f.task(Some(f.todo), "snake_case имя").await;
    f.task(Some(f.todo), "snakeXcase имя").await;
    f.task(Some(f.todo), r"путь a\b").await;

    assert_eq!(titles(&find(&f.c, "100%").await, "tasks", "title"), ["Готово на 100% к релизу"]);
    assert_eq!(titles(&find(&f.c, "snake_case").await, "tasks", "title"), ["snake_case имя"]);
    assert_eq!(titles(&find(&f.c, r"a\b").await, "tasks", "title"), [r"путь a\b"]);
    assert!(keys(&find(&f.c, "%").await).len() == 1, "«%» находит только то, где он есть");
    assert_eq!(titles(&find(&f.c, "'; drop table tasks; --").await, "tasks", "title").len(), 0);
    assert_eq!(f.titles(Some(f.todo)).await.len(), 5, "таблица на месте");
}

// ===== Локаль базы =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn the_test_database_tells_russian_letters_apart_by_case(pool: PgPool) {
    // в локали C это не так, и поиск по-русски стал бы зависеть от регистра (README, «Локаль базы данных»)
    assert!(db::search::lowercase_works(&pool).await.unwrap());
}
