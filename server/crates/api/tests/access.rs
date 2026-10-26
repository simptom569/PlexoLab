//! Доступ к проектам (docs/PROJECTS.md, раздел 5): чужого проекта «нет», права администратора, события и лента
//! только для участников. Главная проверка здесь — обход всех адресов из схемы OpenAPI: у каждого адреса должна быть
//! пометка, и каждый адрес с проектом отказывает постороннему. Новый адрес без пометки сразу роняет тест.

mod common;

use std::collections::BTreeSet;

use api::events::Audience;
use axum::http::{Method, StatusCode};
use common::*;
use db::PgPool;
use serde_json::{Value, json};
use uuid::Uuid;

// ===== Таблица адресов =====

/// Как адрес относится к доступу
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    /// Без токена: вход и обновление токена
    Public,
    /// Любому вошедшему: свои данные и общие данные приложения (вики и библиотека файлов)
    Open,
    /// Приглашение: действует только приглашённый
    Invitee,
    /// Данные проекта: только участники, посторонний получает 404
    Scoped,
    /// Данные проекта, и менять их может только администратор: участник получает 403
    AdminOnly,
    /// Запись, принадлежащая одному человеку (уведомление): чужую не видно никому, даже администратору проекта
    Own,
}

use Kind::*;

/// К чему относится `{id}` в адресе
#[derive(Clone, Copy)]
enum Of {
    Nothing,
    Proj,
    Col,
    Task,
    Sub,
    Module,
    Mile,
    Rel,
    Item,
    Tag,
    Inv,
    File,
    Doc,
    Group,
    Link,
    Notif,
}

use Of::*;

/// Все адреса приложения: метод, адрес из схемы, чей `{id}`, как он относится к доступу
#[rustfmt::skip]
const ROUTES: &[(&str, &str, Of, Kind)] = &[
    // вход
    ("POST",   "/auth/login",                          Nothing,      Public),
    ("POST",   "/auth/refresh",                        Nothing,      Public),
    ("POST",   "/auth/logout",                         Nothing,   Public), // выходит по refresh-токену из тела
    ("POST",   "/auth/password",                       Nothing,      Open),
    // я сам и общие списки
    ("GET",    "/me",                                  Nothing,      Open),
    ("PATCH",  "/me",                                  Nothing,      Open),
    ("GET",    "/users",                               Nothing,      Open),
    // проекты, участники, приглашения
    ("GET",    "/projects",                            Nothing,      Open),
    ("POST",   "/projects",                            Nothing,      Open),
    ("PATCH",  "/projects/{id}",                       Proj,   AdminOnly),
    ("POST",   "/projects/{id}/archive",               Proj,   AdminOnly),
    ("POST",   "/projects/{id}/unarchive",             Proj,   AdminOnly),
    ("GET",    "/projects/{id}/board",                 Proj,   Scoped),
    ("GET",    "/projects/{id}/members",               Proj,   Scoped),
    ("GET",    "/projects/{id}/activity",              Proj,   Scoped), // события проекта и общие (вики)
    ("GET",    "/projects/{id}/activity/actors",       Proj,   Scoped),
    ("PATCH",  "/projects/{id}/members/{user_id}",     Proj,   AdminOnly),
    ("DELETE", "/projects/{id}/members/{user_id}",     Proj,   AdminOnly),
    ("POST",   "/projects/{id}/invites",               Proj,   AdminOnly),
    ("GET",    "/invites",                             Nothing,      Open),
    ("DELETE", "/invites/{id}",                        Inv,    AdminOnly),
    ("POST",   "/invites/{id}/accept",                 Inv,    Invitee),
    ("POST",   "/invites/{id}/decline",                Inv,    Invitee),
    // доска
    ("POST",   "/projects/{id}/columns",               Proj,   Scoped),
    ("PATCH",  "/columns/{id}",                        Col,    Scoped),
    ("DELETE", "/columns/{id}",                        Col,    Scoped),
    ("POST",   "/projects/{id}/tasks",                 Proj,   Scoped),
    ("GET",    "/tasks/{id}",                          Task,      Scoped),
    ("PATCH",  "/tasks/{id}",                          Task,      Scoped),
    ("DELETE", "/tasks/{id}",                          Task,      Scoped),
    ("POST",   "/tasks/{id}/subtasks",                 Task,      Scoped),
    ("PATCH",  "/subtasks/{id}",                       Sub,   Scoped),
    ("DELETE", "/subtasks/{id}",                       Sub,   Scoped),
    ("POST",   "/tasks/{id}/comments",                 Task,      Scoped),
    ("POST",   "/tasks/{id}/files",                    Task,      Scoped),
    // метки
    ("GET",    "/projects/{id}/tags",                  Proj,   Scoped),
    ("POST",   "/projects/{id}/tags",                  Proj,   Scoped),
    ("PATCH",  "/tags/{id}",                           Tag,       AdminOnly),
    ("DELETE", "/tags/{id}",                           Tag,       AdminOnly),
    // модули, вехи, релизы
    ("POST",   "/projects/{id}/modules",               Proj,   Scoped),
    ("PATCH",  "/modules/{id}",                        Module,    Scoped),
    ("DELETE", "/modules/{id}",                        Module,    Scoped),
    ("POST",   "/projects/{id}/milestones",            Proj,   Scoped),
    ("PATCH",  "/milestones/{id}",                     Mile, Scoped),
    ("DELETE", "/milestones/{id}",                     Mile, Scoped),
    ("GET",    "/projects/{id}/releases",              Proj,   Scoped),
    ("POST",   "/projects/{id}/releases",              Proj,   Scoped),
    ("PATCH",  "/releases/{id}",                       Rel,   Scoped),
    ("DELETE", "/releases/{id}",                       Rel,   Scoped),
    ("POST",   "/releases/{id}/items",                 Rel,   Scoped),
    ("PATCH",  "/release-items/{id}",                  Item,      Scoped),
    ("DELETE", "/release-items/{id}",                  Item,      Scoped),
    // вложения задач: скачать и удалить вложение — как и сама задача, только для участников её проекта
    ("GET",    "/files/{id}/download",                 File,      Scoped),
    ("DELETE", "/files/{id}",                          File,      Scoped),
    // вики и библиотека файлов: общие для всех вошедших (`access::wiki`)
    ("GET",    "/wiki",                                Nothing,      Open),
    ("POST",   "/wiki",                                Nothing,      Open),
    ("GET",    "/wiki/{id}",                           Nothing,      Open),
    ("PATCH",  "/wiki/{id}",                           Nothing,      Open),
    ("DELETE", "/wiki/{id}",                           Nothing,      Open),
    ("GET",    "/files",                               Nothing,      Open),
    ("POST",   "/files",                               Nothing,      Open),
    ("GET",    "/folders",                             Nothing,      Open),
    ("POST",   "/folders",                             Nothing,      Open),
    ("DELETE", "/folders/{id}",                        Nothing,      Open),
    // документы и ссылки принадлежат проекту: только его участники
    ("GET",    "/projects/{id}/docs",                  Proj,   Scoped),
    ("POST",   "/projects/{id}/docs",                  Proj,   Scoped),
    ("GET",    "/docs/{id}",                           Doc,    Scoped),
    ("PATCH",  "/docs/{id}",                           Doc,    Scoped),
    ("DELETE", "/docs/{id}",                           Doc,    Scoped),
    ("PUT",    "/docs/{id}/canvas",                    Doc,    Scoped),
    ("PUT",    "/docs/{id}/star",                      Doc,    Scoped),
    ("GET",    "/projects/{id}/link-groups",           Proj,   Scoped),
    ("POST",   "/projects/{id}/link-groups",           Proj,   Scoped),
    ("PATCH",  "/link-groups/{id}",                    Group,  Scoped),
    ("DELETE", "/link-groups/{id}",                    Group,  Scoped),
    ("POST",   "/link-groups/{id}/links",              Group,  Scoped),
    ("DELETE", "/links/{id}",                          Link,   Scoped),
    // уведомления: список свой по определению, отметка действует только для владельца записи
    ("GET",    "/notifications",                       Nothing,      Open),
    ("POST",   "/notifications/read-all",              Nothing,      Open),
    ("POST",   "/notifications/{id}/read",             Notif,        Own),
];

/// Все адреса из схемы OpenAPI без префикса `/api/v1`: (метод, адрес)
fn schema_routes() -> BTreeSet<(String, String)> {
    let doc = api::openapi_document();
    let mut out = BTreeSet::new();
    for (path, item) in doc["paths"].as_object().unwrap() {
        for method in item.as_object().unwrap().keys() {
            out.insert((method.to_uppercase(), path.trim_start_matches("/api/v1").to_owned()));
        }
    }
    out
}

#[test]
fn every_route_of_the_api_is_classified_and_nothing_stale_is_left() {
    let schema = schema_routes();
    let table: BTreeSet<(String, String)> =
        ROUTES.iter().map(|(m, p, _, _)| ((*m).to_owned(), (*p).to_owned())).collect();
    assert_eq!(table.len(), ROUTES.len(), "адрес записан в таблице дважды");
    let missing: Vec<_> = schema.difference(&table).collect();
    assert!(missing.is_empty(), "адреса без пометки доступа (добавьте в ROUTES): {missing:?}");
    let stale: Vec<_> = table.difference(&schema).collect();
    assert!(stale.is_empty(), "в таблице есть адреса, которых нет в схеме: {stale:?}");
}

/// Откуда ручкам разрешено получать проект: только через `access` (src/access.rs)
#[test]
fn routes_get_projects_only_through_access() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/routes");
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_none_or(|e| e != "rs") {
            continue;
        }
        let text = std::fs::read_to_string(&path).unwrap();
        for banned in [
            "projects::get(",
            "projects::lock(",
            "projects::for_user(",
            "projects::for_user_locked(",
            "projects::list(",
        ] {
            assert!(!text.contains(banned), "{}: прямой вызов db::{banned} в обход access", path.display());
        }
    }
}

// ===== Мир для обхода =====

/// Записи проекта, на которые ссылаются адреса
struct World {
    project: Uuid,
    column: Uuid,
    task: Uuid,
    subtask: Uuid,
    module: Uuid,
    milestone: Uuid,
    release: Uuid,
    item: Uuid,
    tag: Uuid,
    invite: Uuid,
    file: Uuid,
    doc: Uuid,
    group: Uuid,
    link: Uuid,
    /// Уведомление приглашённого (он не участник, но отметка прочитанным касается только владельца записи)
    notification: Uuid,
}

impl World {
    /// Свежий набор записей в проекте; `invitee` приглашён в проект
    async fn build(f: &Fx, invitee: &Ctx) -> World {
        let c = &f.c;
        let p = format!("/api/v1/projects/{}", f.project);
        let column = id_of(
            &c.ok(c.post(&format!("{p}/columns"), json!({ "title": "Колонка" })).await, StatusCode::CREATED).await,
        );
        let task = f.task(Some(f.todo), "Задача").await;
        let t = format!("/api/v1/tasks/{}", id_of(&task));
        let subtask =
            id_of(&c.ok(c.post(&format!("{t}/subtasks"), json!({ "title": "Шаг" })).await, StatusCode::CREATED).await);
        let module = id_of(
            &c.ok(c.post(&format!("{p}/modules"), json!({ "title": "Модуль" })).await, StatusCode::CREATED).await,
        );
        let milestone = id_of(
            &c.ok(
                c.post(&format!("{p}/milestones"), json!({ "title": "Веха", "due_date": "2026-11-03" })).await,
                StatusCode::CREATED,
            )
            .await,
        );
        let release = c
            .ok(
                c.post(&format!("{p}/releases"), json!({ "version": "1.0.0", "release_date": "2026-11-20" })).await,
                StatusCode::CREATED,
            )
            .await;
        let item = id_of(
            &c.ok(
                c.post(&format!("/api/v1/releases/{}/items", id_of(&release)), json!({ "title": "Пункт" })).await,
                StatusCode::CREATED,
            )
            .await,
        );
        let tag = id_of(
            &c.ok(
                c.post(&format!("{p}/tags"), json!({ "label": format!("Метка {}", Uuid::new_v4()) })).await,
                StatusCode::CREATED,
            )
            .await,
        );
        // приглашение для того, кого в проекте нет: после прошлого обхода он мог принять приглашение и войти
        db::sqlx::query("delete from project_members where user_id = $1 and project_id = $2")
            .bind(invitee.user.id)
            .bind(f.project)
            .execute(&c.pool)
            .await
            .unwrap();
        db::sqlx::query("update project_invites set status = 'revoked' where user_id = $1 and status = 'pending'")
            .bind(invitee.user.id)
            .execute(&c.pool)
            .await
            .unwrap();
        let invite = id_of(
            &c.ok(c.post(&format!("{p}/invites"), json!({ "email": invitee.user.email })).await, StatusCode::CREATED)
                .await,
        );
        let files =
            c.ok(c.upload(&format!("{t}/files"), &[file_part("вложение.txt", b"1")]).await, StatusCode::CREATED).await;
        let doc =
            id_of(&c.ok(c.post(&format!("{p}/docs"), json!({ "title": "Документ" })).await, StatusCode::CREATED).await);
        let group = id_of(
            &c.ok(c.post(&format!("{p}/link-groups"), json!({ "title": "Группа" })).await, StatusCode::CREATED).await,
        );
        let link = id_of(
            &c.ok(
                c.post(
                    &format!("/api/v1/link-groups/{group}/links"),
                    json!({ "title": "Ссылка", "url": "example.com" }),
                )
                .await,
                StatusCode::CREATED,
            )
            .await,
        );
        let notification = {
            let mut conn = c.pool.acquire().await.unwrap();
            db::notifications::insert_assigned(&mut conn, invitee.user.id, c.user.id, f.project, id_of(&task))
                .await
                .unwrap()
                .id
        };
        World {
            project: f.project,
            column,
            task: id_of(&task),
            subtask,
            module,
            milestone,
            release: id_of(&release),
            item,
            tag,
            invite,
            file: id_of(&files[0]),
            doc,
            group,
            link,
            notification,
        }
    }

    fn id(&self, of: Of) -> Uuid {
        match of {
            Nothing => Uuid::nil(),
            Proj => self.project,
            Col => self.column,
            Task => self.task,
            Sub => self.subtask,
            Module => self.module,
            Mile => self.milestone,
            Rel => self.release,
            Item => self.item,
            Tag => self.tag,
            Inv => self.invite,
            File => self.file,
            Doc => self.doc,
            Group => self.group,
            Link => self.link,
            Notif => self.notification,
        }
    }
}

/// Тело запроса, которое проходит разбор: до проверки доступа ручка не должна упасть на 400
fn body(method: &str, path: &str, w: &World) -> Option<Value> {
    Some(match (method, path) {
        ("PATCH", "/projects/{id}") => json!({ "name": "Новое имя" }),
        ("PATCH", "/projects/{id}/members/{user_id}") => json!({ "role": "member" }),
        ("POST", "/projects/{id}/invites") => json!({ "email": "nobody-at-all@example.com" }),
        ("POST", "/projects/{id}/columns") => json!({ "title": "Ещё колонка" }),
        ("PATCH", "/columns/{id}") => json!({ "title": "Другое" }),
        ("POST", "/projects/{id}/tasks") => json!({ "title": "Ещё задача" }),
        ("PATCH", "/tasks/{id}") => json!({ "title": "Другое" }),
        ("POST", "/tasks/{id}/subtasks") => json!({ "title": "Ещё шаг" }),
        ("PATCH", "/subtasks/{id}") => json!({ "done": true }),
        ("POST", "/tasks/{id}/comments") => json!({ "body": "Привет" }),
        ("POST", "/projects/{id}/tags") => json!({ "label": "Новая" }),
        ("PATCH", "/tags/{id}") => json!({ "tone": 3 }),
        ("POST", "/projects/{id}/modules") => json!({ "title": "Ещё модуль" }),
        ("PATCH", "/modules/{id}") => json!({ "title": "Другое" }),
        ("POST", "/projects/{id}/milestones") => json!({ "title": "Ещё веха", "due_date": "2026-12-01" }),
        ("PATCH", "/milestones/{id}") => json!({ "title": "Другая" }),
        ("POST", "/projects/{id}/releases") => json!({ "version": "2.0.0", "release_date": "2026-12-20" }),
        ("PATCH", "/releases/{id}") => json!({ "status": "progress" }),
        ("POST", "/releases/{id}/items") => json!({ "title": "Ещё пункт" }),
        ("PATCH", "/release-items/{id}") => json!({ "done": true }),
        ("POST", "/projects/{id}/docs") => json!({ "title": "Ещё документ" }),
        ("PATCH", "/docs/{id}") => json!({ "title": "Другое", "rev": 1 }),
        ("PUT", "/docs/{id}/canvas") => {
            json!({ "note": { "x": 24.0, "y": 28.0, "w": 400.0 }, "objects": [], "links": [] })
        }
        ("PUT", "/docs/{id}/star") => json!({ "starred": true }),
        ("POST", "/projects/{id}/link-groups") => json!({ "title": "Ещё группа" }),
        ("PATCH", "/link-groups/{id}") => json!({ "title": "Другая" }),
        ("POST", "/link-groups/{id}/links") => json!({ "title": "Ещё ссылка", "url": "example.org" }),
        _ => {
            let _ = w;
            return Option::None;
        }
    })
}

/// Подставляет записи мира в адрес из схемы; `{user_id}` — другой участник проекта
fn uri(path: &str, of: Of, w: &World, other_member: Uuid) -> String {
    format!("/api/v1{}", path.replace("{user_id}", &other_member.to_string()).replace("{id}", &w.id(of).to_string()))
}

async fn call(who: &Ctx, method: &str, path: &str, of: Of, w: &World, other_member: Uuid) -> StatusCode {
    let uri = uri(path, of, w, other_member);
    if (method, path) == ("POST", "/tasks/{id}/files") {
        return who.upload(&uri, &[file_part("ещё.txt", b"2")]).await.status;
    }
    if path == "/files/{id}/download" {
        return who.download(&uri).await.status;
    }
    send(&who.app, method.parse::<Method>().unwrap(), &uri, body(method, path, w), Some(&who.token)).await.status
}

// ===== Обход =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn every_address_with_project_data_refuses_a_stranger_and_works_for_members(pool: PgPool) {
    let f = Fx::new(pool).await;
    let stranger = f.c.another("stranger@example.com", "Посторонний").await;
    let mate = f.c.another("mate@example.com", "Участник").await;
    join(&f.c.pool, f.project, mate.user.id, "member").await;
    let invitee = f.c.another("invitee@example.com", "Приглашённый").await;

    let mut checked = 0;
    for (method, path, of, kind) in ROUTES {
        if !matches!(kind, Scoped | AdminOnly | Invitee | Own) {
            continue;
        }
        let w = World::build(&f, &invitee).await;
        // участник, которого можно трогать в адресах `.../members/{user_id}`: сам админ-хозяин проекта не годится
        let other = f.c.user.id;
        let label = format!("{method} {path}");
        match kind {
            Scoped | AdminOnly => {
                assert_eq!(
                    call(&stranger, method, path, *of, &w, other).await,
                    StatusCode::NOT_FOUND,
                    "посторонний: {label}"
                );
                if *kind == AdminOnly {
                    assert_eq!(
                        call(&mate, method, path, *of, &w, other).await,
                        StatusCode::FORBIDDEN,
                        "участник: {label}"
                    );
                    let s = call(&f.c, method, path, *of, &w, other).await;
                    assert!(s != StatusCode::NOT_FOUND && s != StatusCode::FORBIDDEN, "администратор: {label} → {s}");
                } else {
                    let s = call(&mate, method, path, *of, &w, other).await;
                    assert!(s != StatusCode::NOT_FOUND && s != StatusCode::FORBIDDEN, "участник: {label} → {s}");
                }
            }
            Invitee => {
                // чужое приглашение: «нет» и посторонним, и самому администратору проекта
                assert_eq!(
                    call(&stranger, method, path, *of, &w, other).await,
                    StatusCode::NOT_FOUND,
                    "посторонний: {label}"
                );
                assert_eq!(
                    call(&f.c, method, path, *of, &w, other).await,
                    StatusCode::NOT_FOUND,
                    "администратор: {label}"
                );
                let s = call(&invitee, method, path, *of, &w, other).await;
                assert!(s != StatusCode::NOT_FOUND && s != StatusCode::FORBIDDEN, "приглашённый: {label} → {s}");
            }
            Own => {
                // чужое уведомление «не найдено» всем, кроме владельца: и постороннему, и участнику, и администратору проекта
                for (who, name) in [(&stranger, "посторонний"), (&mate, "участник"), (&f.c, "администратор проекта")] {
                    assert_eq!(call(who, method, path, *of, &w, other).await, StatusCode::NOT_FOUND, "{name}: {label}");
                }
                let s = call(&invitee, method, path, *of, &w, other).await;
                assert!(s != StatusCode::NOT_FOUND && s != StatusCode::FORBIDDEN, "владелец: {label} → {s}");
            }
            _ => unreachable!(),
        }
        checked += 1;
    }
    assert!(checked > 35, "проверено подозрительно мало адресов: {checked}");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn every_address_except_login_and_refresh_requires_a_token(pool: PgPool) {
    let f = Fx::new(pool).await;
    let w = World::build(&f, &f.c.another("invitee@example.com", "Приглашённый").await).await;
    for (method, path, of, kind) in ROUTES {
        let uri = uri(path, *of, &w, f.c.user.id);
        let r = send(
            &f.c.app,
            method.parse::<Method>().unwrap(),
            &uri,
            body(method, path, &w).or_else(|| (*method != "GET" && *method != "DELETE").then(|| json!({}))),
            None,
        )
        .await;
        if *kind == Public {
            assert_ne!(r.status, StatusCode::UNAUTHORIZED, "{method} {path}: вход без токена");
        } else {
            assert_eq!(r.status, StatusCode::UNAUTHORIZED, "{method} {path}");
        }
    }
}

// ===== Глобальный администратор =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_global_admin_can_manage_any_project_without_being_a_member(pool: PgPool) {
    let f = Fx::new(pool).await;
    let admin = f.c.another_admin("root@example.com", "Админ").await;
    let p = format!("/api/v1/projects/{}", f.project);
    admin.ok(admin.get(&format!("{p}/board")).await, StatusCode::OK).await;
    admin.ok(admin.patch(&p, json!({ "name": "Переименован админом" })).await, StatusCode::OK).await;
    admin.ok(admin.post(&format!("{p}/archive"), json!({})).await, StatusCode::OK).await;
    let members = admin.ok(admin.get(&format!("{p}/members")).await, StatusCode::OK).await;
    assert!(
        !members["members"].as_array().unwrap().iter().any(|m| m["email"] == "root@example.com"),
        "он не участник, но управляет"
    );
}

// ===== Метки и данные другого проекта =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_tag_of_another_project_cannot_be_put_on_a_task(pool: PgPool) {
    let f = Fx::new(pool.clone()).await;
    let other = make_project(&pool, "API", "Api", "warn").await;
    let foreign = id_of(
        &f.c.ok(
            f.c.post(&format!("/api/v1/projects/{other}/tags"), json!({ "label": "Чужая" })).await,
            StatusCode::CREATED,
        )
        .await,
    );
    let task = f.task(Some(f.todo), "Задача").await;
    let uri = format!("/api/v1/tasks/{}", id_of(&task));
    assert_eq!(f.c.patch(&uri, json!({ "tag_ids": [foreign] })).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(f.c.ok(f.c.get(&uri).await, StatusCode::OK).await["tag_ids"], json!([]));

    // и на уровне базы метка чужого проекта молча не привязывается
    let mut conn = pool.acquire().await.unwrap();
    db::tasks::set_tags(&mut conn, id_of(&task), &[foreign]).await.unwrap();
    assert!(db::tasks::tag_ids(&mut *conn, id_of(&task)).await.unwrap().is_empty());
}

// ===== Лента =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn the_activity_feed_of_a_project_shows_its_events_and_shared_ones_only_to_its_members(pool: PgPool) {
    let f = Fx::new(pool).await;
    let stranger = f.c.another("stranger@example.com", "Посторонний").await;
    f.task(Some(f.todo), "Секретная задача").await;
    f.c.ok(f.c.post("/api/v1/wiki", json!({ "title": "Общая страница" })).await, StatusCode::CREATED).await;

    let targets = |feed: &Value| -> Vec<String> {
        feed["items"].as_array().unwrap().iter().map(|e| str_field(e, "target").to_owned()).collect()
    };
    let own =
        stranger.ok(stranger.post("/api/v1/projects", json!({ "name": "Свой" })).await, StatusCode::CREATED).await;
    let mine = f.c.ok(f.c.get(&format!("/api/v1/projects/{}/activity", f.project)).await, StatusCode::OK).await;
    assert!(targets(&mine).iter().any(|t| t.contains("Секретная задача")));
    let theirs =
        stranger.ok(stranger.get(&format!("/api/v1/projects/{}/activity", id_of(&own))).await, StatusCode::OK).await;
    assert!(!targets(&theirs).iter().any(|t| t.contains("Секретная задача")), "события чужого проекта не видны");
    assert!(targets(&theirs).iter().any(|t| t.contains("Общая страница")), "события вики видны в ленте любого проекта");
    let foreign = stranger.get(&format!("/api/v1/projects/{}/activity", f.project)).await;
    assert_eq!(foreign.status, StatusCode::NOT_FOUND, "ленту чужого проекта не прочитать");
}

// ===== Вложения =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn an_attachment_of_a_task_is_downloaded_only_by_project_members_while_library_files_are_shared(pool: PgPool) {
    let f = Fx::new(pool).await;
    let stranger = f.c.another("stranger@example.com", "Посторонний").await;
    let task = f.task(Some(f.todo), "Задача").await;
    let attached =
        f.c.ok(
            f.c.upload(&format!("/api/v1/tasks/{}/files", id_of(&task)), &[file_part("секрет.txt", b"abc")]).await,
            StatusCode::CREATED,
        )
        .await;
    let shared =
        f.c.ok(f.c.upload("/api/v1/files", &[file_part("общий.txt", b"xyz")]).await, StatusCode::CREATED).await;

    let attachment = format!("/api/v1/files/{}/download", id_of(&attached[0]));
    assert_eq!(f.c.download(&attachment).await.status, StatusCode::OK);
    assert_eq!(stranger.download(&attachment).await.status, StatusCode::NOT_FOUND);
    let library = format!("/api/v1/files/{}/download", id_of(&shared[0]));
    assert_eq!(stranger.download(&library).await.status, StatusCode::OK, "файл вики общий");
}

// ===== События =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn events_name_their_audience(pool: PgPool) {
    let f = Fx::new(pool).await;
    let guest = f.c.another("guest@example.com", "Гость").await;
    let mut rx = f.c.events.subscribe();
    let p = format!("/api/v1/projects/{}", f.project);
    let audiences =
        |rx: &mut tokio::sync::broadcast::Receiver<std::sync::Arc<api::Event>>| -> Vec<(&'static str, Audience)> {
            let mut out = Vec::new();
            while let Ok(e) = rx.try_recv() {
                out.push((e.kind, e.audience.clone()));
            }
            out
        };

    // правка задачи: событие проекта, а не «всем»
    let task = f.task(Some(f.todo), "Задача").await;
    audiences(&mut rx);
    f.c.ok(f.c.patch(&format!("/api/v1/tasks/{}", id_of(&task)), json!({ "title": "Другое" })).await, StatusCode::OK)
        .await;
    assert_eq!(
        audiences(&mut rx),
        [("task.updated", Audience::Project(f.project)), ("activity.created", Audience::Project(f.project))]
    );
    // общие данные: вики идёт всем
    f.c.ok(f.c.post("/api/v1/wiki", json!({ "title": "Страница" })).await, StatusCode::CREATED).await;
    assert_eq!(audiences(&mut rx), [("wiki.updated", Audience::Everyone), ("activity.created", Audience::Everyone)]);

    // документы и ссылки принадлежат проекту: их события тоже только его участникам
    f.c.ok(f.c.post(&format!("{p}/docs"), json!({ "title": "Документ" })).await, StatusCode::CREATED).await;
    assert_eq!(
        audiences(&mut rx),
        [("doc.updated", Audience::Project(f.project)), ("activity.created", Audience::Project(f.project))]
    );
    f.c.ok(f.c.post(&format!("{p}/link-groups"), json!({ "title": "Группа" })).await, StatusCode::CREATED).await;
    assert_eq!(audiences(&mut rx), [("link.changed", Audience::Project(f.project))]);

    // приглашение: участникам проекта «что-то изменилось», приглашённому его личное событие
    let invite =
        f.c.ok(f.c.post(&format!("{p}/invites"), json!({ "email": "guest@example.com" })).await, StatusCode::CREATED)
            .await;
    let sent = audiences(&mut rx);
    assert!(sent.contains(&("project.changed", Audience::Project(f.project))), "{sent:?}");
    assert!(sent.contains(&("invite.changed", Audience::Users(vec![guest.user.id]))), "{sent:?}");
    assert!(
        !sent.contains(&("invite.changed", Audience::Project(f.project))),
        "приглашение не для всего проекта: {sent:?}"
    );

    // принял: человек получает событие лично, ведь участником он стал только сейчас
    guest.post(&format!("/api/v1/invites/{}/accept", id_of(&invite)), json!({})).await;
    let accepted = audiences(&mut rx);
    assert!(accepted.contains(&("project.changed", Audience::Users(vec![guest.user.id]))), "{accepted:?}");
    assert!(accepted.contains(&("project.changed", Audience::Project(f.project))), "{accepted:?}");

    // убрали: события членам проекта и лично тому, кого убрали
    f.c.delete(&format!("{p}/members/{}", guest.user.id)).await;
    let removed = audiences(&mut rx);
    assert!(removed.contains(&("project.changed", Audience::Users(vec![guest.user.id]))), "{removed:?}");
}
