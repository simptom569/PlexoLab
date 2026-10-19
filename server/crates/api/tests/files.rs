//! Библиотека файлов, папки и вложения задач: загрузка на диск, скачивание, лимит, удаление, запись в ленту.
//! На настоящем Postgres и во временной папке данных.

mod common;

use axum::http::{StatusCode, header};
use common::*;
use db::PgPool;
use serde_json::{Value, json};
use uuid::Uuid;

fn ev(kind: &str, target: &str, text: &str) -> (String, String, String) {
    (kind.to_owned(), target.to_owned(), text.to_owned())
}

impl Ctx {
    /// Загрузка в библиотеку с проверкой успеха: тела созданных файлов
    async fn put_files(&self, parts: &[Part]) -> Vec<Value> {
        let r = self.upload("/api/v1/files", parts).await;
        self.ok(r, StatusCode::CREATED).await.as_array().unwrap().clone()
    }

    async fn put(&self, name: &str, data: &[u8]) -> Value {
        self.put_files(&[file_part(name, data)]).await.remove(0)
    }

    async fn library(&self, query: &str) -> Value {
        let r = self.get(&format!("/api/v1/files{query}")).await;
        self.ok(r, StatusCode::OK).await
    }

    async fn names(&self, query: &str) -> Vec<String> {
        self.library(query).await["files"].as_array().unwrap().iter().map(|f| str_field(f, "name").to_owned()).collect()
    }

    async fn folder(&self, name: &str) -> Value {
        let r = self.post("/api/v1/folders", json!({ "name": name })).await;
        self.ok(r, StatusCode::CREATED).await
    }

    async fn page(&self, title: &str) -> Value {
        let r = self.post("/api/v1/wiki", json!({ "title": title })).await;
        self.ok(r, StatusCode::CREATED).await
    }

    async fn feed(&self) -> Vec<(String, String, String)> {
        db::sqlx::query_as("select kind::text, target, text from activity order by created_at, text")
            .fetch_all(&self.pool)
            .await
            .unwrap()
    }
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn files_and_folders_need_a_token(pool: PgPool) {
    let app = app(pool);
    let id = Uuid::new_v4();
    for (method, uri) in [
        (axum::http::Method::GET, "/api/v1/files".to_owned()),
        (axum::http::Method::POST, "/api/v1/files".to_owned()),
        (axum::http::Method::GET, format!("/api/v1/files/{id}/download")),
        (axum::http::Method::DELETE, format!("/api/v1/files/{id}")),
        (axum::http::Method::POST, format!("/api/v1/tasks/{id}/files")),
        (axum::http::Method::GET, "/api/v1/folders".to_owned()),
        (axum::http::Method::POST, "/api/v1/folders".to_owned()),
        (axum::http::Method::DELETE, format!("/api/v1/folders/{id}")),
    ] {
        let r = send(&app, method.clone(), &uri, None, None).await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED, "{method} {uri}");
    }
}

// ===== Загрузка и скачивание =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn uploaded_file_lands_on_disk_in_the_library_and_in_the_feed(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let body = "Привет, файл".as_bytes();
    let f = c.put("План работ.PDF", body).await;

    assert_eq!(f["name"], "План работ.PDF");
    assert_eq!(f["kind"], "pdf");
    assert_eq!(f["size_bytes"], body.len());
    assert_eq!(f["uploader_id"], c.user.id.to_string());
    assert_eq!(f["folder_id"], Value::Null);
    assert_eq!(f["wiki_page_id"], Value::Null);
    assert_eq!(f["task_id"], Value::Null);

    let stored = c.dir.stored();
    assert_eq!(stored.len(), 1);
    assert_eq!(std::fs::read(c.dir.0.join("files").join(&stored[0])).unwrap(), body);
    assert_ne!(stored[0], "План работ.PDF", "на диске файл лежит под случайным ключом");

    let lib = c.library("").await;
    assert_eq!(lib["total"], 1);
    assert_eq!(lib["files"][0]["id"], f["id"]);
    assert_eq!(c.feed().await, [ev("file", "План работ.PDF", "загружено в вики")]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn several_files_make_one_feed_entry_and_go_to_the_folder(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let folder = c.folder("Дизайн").await;
    let files = c
        .put_files(&[
            file_part("a.png", b"1"),
            file_part("b.zip", b"22"),
            file_part("c.csv", b"333"),
            text_part("folder_id", id_of(&folder)),
        ])
        .await;

    assert_eq!(files.iter().map(|f| str_field(f, "kind")).collect::<Vec<_>>(), ["img", "zip", "sheet"]);
    assert!(files.iter().all(|f| f["folder_id"] == folder["id"]));
    assert_eq!(c.feed().await, [ev("file", "3 файла", "загружено в вики")]);
    assert_eq!(c.dir.stored().len(), 3);

    let r = c.get("/api/v1/folders").await;
    assert_eq!(c.ok(r, StatusCode::OK).await[0]["file_count"], 3);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn page_attachments_go_to_the_attachments_folder(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let page = c.page("Архитектура").await;
    let other = c.page("Соседняя").await;

    let first = c.put_files(&[file_part("sso.png", b"1"), text_part("wiki_page_id", id_of(&page))]).await;
    let second = c.put_files(&[file_part("db.pdf", b"2"), text_part("wiki_page_id", id_of(&page))]).await;
    c.put_files(&[file_part("чужой.txt", b"3"), text_part("wiki_page_id", id_of(&other))]).await;

    assert_eq!(first[0]["wiki_page_id"], page["id"]);
    assert_eq!(first[0]["folder_id"], second[0]["folder_id"], "папка «Вложения» создаётся один раз");
    let r = c.get("/api/v1/folders").await;
    let folders = c.ok(r, StatusCode::OK).await;
    assert_eq!(folders.as_array().unwrap().len(), 1);
    assert_eq!(folders[0]["name"], "Вложения");
    assert_eq!(folders[0]["file_count"], 3);

    assert_eq!(c.names(&format!("?wiki_page_id={}", id_of(&page))).await, ["db.pdf", "sso.png"]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn explicit_folder_wins_over_the_attachments_folder(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let page = c.page("Страница").await;
    let folder = c.folder("Скриншоты").await;
    let f = c
        .put_files(&[
            file_part("shot.png", b"1"),
            text_part("wiki_page_id", id_of(&page)),
            text_part("folder_id", id_of(&folder)),
        ])
        .await;
    assert_eq!(f[0]["folder_id"], folder["id"]);
    assert_eq!(f[0]["wiki_page_id"], page["id"]);
    let r = c.get("/api/v1/folders").await;
    assert_eq!(c.ok(r, StatusCode::OK).await.as_array().unwrap().len(), 1, "«Вложения» не появилась");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn wrong_folder_or_page_rejects_the_upload_and_leaves_no_files(pool: PgPool) {
    let c = Ctx::new(pool).await;
    for part in [text_part("folder_id", Uuid::new_v4()), text_part("wiki_page_id", Uuid::new_v4())] {
        let r = c.upload("/api/v1/files", &[file_part("a.txt", b"1"), part]).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{}", r.body);
    }
    let r = c.upload("/api/v1/files", &[file_part("a.txt", b"1"), text_part("folder_id", "не-uuid")]).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);

    assert!(c.dir.stored().is_empty(), "записанное на диск убрано");
    assert_eq!(c.library("").await["total"], 0);
    assert!(c.feed().await.is_empty());
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn form_without_a_file_or_a_name_is_refused(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let r = c.upload("/api/v1/files", &[text_part("folder_id", "")]).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "{}", r.body);
    let r = c.upload("/api/v1/files", &[nameless_file_part(b"1")]).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let r = c.upload("/api/v1/files", &[file_part("..", b"1")]).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let r = c.upload("/api/v1/files", &[]).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert!(c.dir.stored().is_empty());
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn path_in_the_file_name_is_dropped(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let f = c.put("C:\\Users\\me\\отчёт.xlsx", b"1").await;
    assert_eq!(f["name"], "отчёт.xlsx");
    assert_eq!(f["kind"], "sheet");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn file_over_the_limit_gets_413_and_nothing_is_kept(pool: PgPool) {
    let c = Ctx::with_upload_limit(pool, 10).await;
    let exact = c.put("ровно.bin", &[7; 10]).await;
    assert_eq!(exact["size_bytes"], 10, "ровно по лимиту проходит");

    let r = c.upload("/api/v1/files", &[file_part("мелкий.bin", b"1"), file_part("огромный.bin", &[7; 11])]).await;
    assert_eq!(r.status, StatusCode::PAYLOAD_TOO_LARGE, "{}", r.body);
    assert_eq!(r.body["code"], "payload_too_large");
    assert!(str_field(&r.body, "message").contains("огромный.bin"));

    assert_eq!(c.dir.stored().len(), 1, "остался только первый файл");
    assert_eq!(c.library("").await["total"], 1);
    assert_eq!(c.feed().await.len(), 1);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn too_many_files_in_one_request_are_refused(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let parts: Vec<Part> = (0..51).map(|i| file_part(&format!("{i}.txt"), b"x")).collect();
    let r = c.upload("/api/v1/files", &parts).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "{}", r.body);
    assert!(c.dir.stored().is_empty());
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn download_returns_the_bytes_with_a_proper_name(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let data: Vec<u8> = (0..=255).collect();
    let f = c.put("Отчёт 100%.txt", &data).await;

    let got = c.download(&format!("/api/v1/files/{}/download", id_of(&f))).await;
    assert_eq!(got.status, StatusCode::OK);
    assert_eq!(got.bytes, data);
    assert_eq!(got.headers[header::CONTENT_LENGTH], "256");
    assert_eq!(got.headers[header::CONTENT_TYPE], "application/octet-stream");
    assert_eq!(got.headers[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
    let disposition = got.headers[header::CONTENT_DISPOSITION].to_str().unwrap();
    assert!(disposition.starts_with("attachment; "), "{disposition}");
    assert!(disposition.contains("filename=\"_____ 100_.txt\""), "запасное имя только из ASCII: {disposition}");
    assert!(
        disposition.contains("filename*=UTF-8''%D0%9E%D1%82%D1%87%D1%91%D1%82%20100%25.txt"),
        "точное имя в UTF-8: {disposition}"
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn download_of_unknown_or_contentless_file_is_404(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let missing = c.download(&format!("/api/v1/files/{}/download", Uuid::new_v4())).await;
    assert_eq!(missing.status, StatusCode::NOT_FOUND);

    // запись из сида: содержимого на диске у неё нет
    let seeded: Uuid = db::sqlx::query_scalar(
        "insert into files (name, size_bytes, kind, storage_key) values ('демо.png', 5, 'img', 'seed:демо.png') returning id",
    )
    .fetch_one(&c.pool)
    .await
    .unwrap();
    assert_eq!(c.download(&format!("/api/v1/files/{seeded}/download")).await.status, StatusCode::NOT_FOUND);

    // файл пропал с диска
    let f = c.put("пропал.txt", b"1").await;
    std::fs::remove_file(c.dir.0.join("files").join(&c.dir.stored()[0])).unwrap();
    assert_eq!(c.download(&format!("/api/v1/files/{}/download", id_of(&f))).await.status, StatusCode::NOT_FOUND);
}

// ===== Список и фильтры =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn library_filters_by_folder_kind_and_name(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let design = c.folder("Дизайн").await;
    let root_pdf = c.put("Регламент.pdf", b"1").await;
    c.put_files(&[
        file_part("Логотип.PNG", b"2"),
        file_part("макет.zip", b"3"),
        text_part("folder_id", id_of(&design)),
    ])
    .await;
    c.put("метрики.xlsx", b"4").await;

    assert_eq!(c.library("").await["total"], 4);
    assert_eq!(c.names("?folder=root").await, ["метрики.xlsx", "Регламент.pdf"], "новые первыми");
    assert_eq!(c.names(&format!("?folder={}", id_of(&design))).await.len(), 2);
    assert_eq!(c.names("?kind=pdf").await, ["Регламент.pdf"]);
    assert_eq!(c.names("?kind=img").await, ["Логотип.PNG"]);
    assert_eq!(c.names("?q=ЛОГО").await, ["Логотип.PNG"], "без учёта регистра, в том числе кириллица");
    assert_eq!(c.names("?q=.zip").await, ["макет.zip"]);
    assert_eq!(c.names("?q=%25").await, Vec::<String>::new(), "процент ищется как символ, а не шаблон");
    assert_eq!(c.names(&format!("?folder={}&kind=zip&q=макет", id_of(&design))).await, ["макет.zip"]);
    assert_eq!(c.names("?folder=root&kind=zip").await, Vec::<String>::new());
    assert_eq!(c.library("?kind=pdf").await["total"], 4, "total не зависит от фильтров");
    assert_eq!(id_of(&root_pdf).to_string(), c.library("?kind=pdf").await["files"][0]["id"]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn bad_filters_are_refused(pool: PgPool) {
    let c = Ctx::new(pool).await;
    assert_eq!(c.get("/api/v1/files?kind=video").await.status, StatusCode::BAD_REQUEST);
    assert_eq!(c.get("/api/v1/files?folder=нет").await.status, StatusCode::BAD_REQUEST);
    assert_eq!(c.get("/api/v1/files?wiki_page_id=нет").await.status, StatusCode::BAD_REQUEST);
    assert_eq!(c.get("/api/v1/files?q=&kind=&folder=").await.status, StatusCode::OK, "пустые условия не ограничивают");
}

// ===== Удаление =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn deleting_a_file_removes_the_record_and_the_content(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let keep = c.put("останется.txt", b"1").await;
    let gone = c.put("уйдёт.txt", b"2").await;
    assert_eq!(c.dir.stored().len(), 2);

    let r = c.delete(&format!("/api/v1/files/{}", id_of(&gone))).await;
    assert_eq!(r.status, StatusCode::NO_CONTENT);
    assert_eq!(c.dir.stored().len(), 1);
    assert_eq!(c.names("").await, ["останется.txt"]);
    assert_eq!(c.feed().await.pop().unwrap(), ev("file", "уйдёт.txt", "удалён"));
    assert_eq!(c.delete(&format!("/api/v1/files/{}", id_of(&gone))).await.status, StatusCode::NOT_FOUND);
    assert_eq!(c.download(&format!("/api/v1/files/{}/download", id_of(&keep))).await.status, StatusCode::OK);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn deleting_a_record_without_content_still_works(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let seeded: Uuid = db::sqlx::query_scalar(
        "insert into files (name, size_bytes, kind, storage_key) values ('демо.png', 5, 'img', 'seed:демо.png') returning id",
    )
    .fetch_one(&c.pool)
    .await
    .unwrap();
    assert_eq!(c.delete(&format!("/api/v1/files/{seeded}")).await.status, StatusCode::NO_CONTENT);
}

// ===== Папки =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn folders_keep_creation_order_and_unique_names(pool: PgPool) {
    let c = Ctx::new(pool).await;
    for name in ["Дизайн", "Договорённости", "Скриншоты"] {
        let f = c.folder(name).await;
        assert_eq!(f["file_count"], 0);
    }
    let r = c.get("/api/v1/folders").await;
    let names: Vec<String> =
        c.ok(r, StatusCode::OK).await.as_array().unwrap().iter().map(|f| str_field(f, "name").to_owned()).collect();
    assert_eq!(names, ["Дизайн", "Договорённости", "Скриншоты"], "не по алфавиту, а по порядку создания");

    let r = c.post("/api/v1/folders", json!({ "name": "  Дизайн " })).await;
    assert_eq!(r.status, StatusCode::CONFLICT, "{}", r.body);
    assert_eq!(c.post("/api/v1/folders", json!({ "name": "   " })).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(c.post("/api/v1/folders", json!({ "name": "я".repeat(101) })).await.status, StatusCode::BAD_REQUEST);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn only_an_empty_folder_can_be_deleted(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let used = c.folder("С файлами").await;
    let empty = c.folder("Пустая").await;
    c.put_files(&[file_part("a.txt", b"1"), text_part("folder_id", id_of(&used))]).await;

    let r = c.delete(&format!("/api/v1/folders/{}", id_of(&used))).await;
    assert_eq!(r.status, StatusCode::CONFLICT, "{}", r.body);
    assert_eq!(c.names("").await, ["a.txt"]);
    assert_eq!(c.library("").await["files"][0]["folder_id"], used["id"], "файл остался в своей папке");

    assert_eq!(c.delete(&format!("/api/v1/folders/{}", id_of(&empty))).await.status, StatusCode::NO_CONTENT);
    assert_eq!(c.delete(&format!("/api/v1/folders/{}", id_of(&empty))).await.status, StatusCode::NOT_FOUND);
}

// ===== Вложения задач =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn task_attachments_are_not_part_of_the_library(pool: PgPool) {
    let f = Fx::new(pool).await;
    let task = f.task(Some(f.todo), "Подключить SSO").await;
    let uri = format!("/api/v1/tasks/{}/files", id_of(&task));

    let r = f.c.upload(&uri, &[file_part("sso-flow.png", b"1234"), file_part("notes.md", b"5")]).await;
    let attached = f.c.ok(r, StatusCode::CREATED).await;
    assert_eq!(attached.as_array().unwrap().len(), 2);
    assert_eq!(attached[0]["name"], "sso-flow.png");
    assert_eq!(attached[0]["kind"], "img");
    assert_eq!(attached[0]["size_bytes"], 4);
    assert_eq!(attached[0]["uploader_id"], f.c.user.id.to_string());
    assert_eq!(f.c.dir.stored().len(), 2);

    let r = f.c.get(&format!("/api/v1/tasks/{}", id_of(&task))).await;
    let detail = f.c.ok(r, StatusCode::OK).await;
    assert_eq!(detail["files"].as_array().unwrap().len(), 2);

    assert_eq!(f.c.library("").await["total"], 0, "в библиотеку вложения задач не попадают");
    let last = f.activity().await.pop().unwrap();
    assert_eq!(last, ev("file", "WEB-1 Подключить SSO", "прикреплено: 2 файла"));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn one_attachment_is_logged_by_name_and_goes_with_the_project(pool: PgPool) {
    let f = Fx::new(pool).await;
    let task = f.task(None, "Из бэклога").await;
    let r = f.c.upload(&format!("/api/v1/tasks/{}/files", id_of(&task)), &[file_part("a.pdf", b"1")]).await;
    f.c.ok(r, StatusCode::CREATED).await;
    assert_eq!(f.activity().await.pop().unwrap(), ev("file", "WEB-1 Из бэклога", "прикреплён файл «a.pdf»"));
    let project: Option<Uuid> = db::sqlx::query_scalar("select project_id from activity where kind = 'file'")
        .fetch_one(&f.c.pool)
        .await
        .unwrap();
    assert_eq!(project, Some(f.project));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn attaching_to_an_unknown_task_writes_nothing(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let r = c.upload(&format!("/api/v1/tasks/{}/files", Uuid::new_v4()), &[file_part("a.pdf", b"1")]).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert!(c.dir.stored().is_empty());
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn task_attachment_can_be_downloaded_and_deleted(pool: PgPool) {
    let f = Fx::new(pool).await;
    let task = f.task(Some(f.todo), "Задача").await;
    let r = f.c.upload(&format!("/api/v1/tasks/{}/files", id_of(&task)), &[file_part("x.txt", b"abc")]).await;
    let file = f.c.ok(r, StatusCode::CREATED).await[0].clone();

    let got = f.c.download(&format!("/api/v1/files/{}/download", id_of(&file))).await;
    assert_eq!(got.bytes, b"abc");

    let r = f.c.delete(&format!("/api/v1/files/{}", id_of(&file))).await;
    assert_eq!(r.status, StatusCode::NO_CONTENT);
    assert!(f.c.dir.stored().is_empty());
    let r = f.c.get(&format!("/api/v1/tasks/{}", id_of(&task))).await;
    assert!(f.c.ok(r, StatusCode::OK).await["files"].as_array().unwrap().is_empty());
    assert_eq!(f.activity().await.pop().unwrap(), ev("file", "WEB-1 Задача", "удалён файл «x.txt»"));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn deleting_a_task_removes_its_attachments_from_disk(pool: PgPool) {
    let f = Fx::new(pool).await;
    let task = f.task(Some(f.todo), "Временная").await;
    let other = f.task(Some(f.todo), "Остаётся").await;
    for t in [&task, &other] {
        let r = f.c.upload(&format!("/api/v1/tasks/{}/files", id_of(t)), &[file_part("x.bin", b"1")]).await;
        f.c.ok(r, StatusCode::CREATED).await;
    }
    assert_eq!(f.c.dir.stored().len(), 2);

    let r = f.c.delete(&format!("/api/v1/tasks/{}", id_of(&task))).await;
    assert_eq!(r.status, StatusCode::NO_CONTENT);
    assert_eq!(f.c.dir.stored().len(), 1, "файл удалённой задачи убран, чужой на месте");
    let count: i64 = db::sqlx::query_scalar("select count(*) from files").fetch_one(&f.c.pool).await.unwrap();
    assert_eq!(count, 1);
}
