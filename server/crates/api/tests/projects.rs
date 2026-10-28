//! Проекты, участники, роли, приглашения и архив (docs/PROJECTS.md, раздел 1) на настоящем Postgres.

mod common;

use axum::http::StatusCode;
use common::*;
use db::PgPool;
use serde_json::{Value, json};
use uuid::Uuid;

fn project_uri(project: Uuid) -> String {
    format!("/api/v1/projects/{project}")
}

/// Человек на том же сервере, участник проекта с этой ролью
async fn member(f: &Fx, email: &str, role: &str) -> Ctx {
    let c = f.c.another(email, email).await;
    join(&f.c.pool, f.project, c.user.id, role).await;
    c
}

fn names(list: &Value) -> Vec<String> {
    list.as_array().unwrap().iter().map(|p| str_field(p, "name").to_owned()).collect()
}

fn roles_by_email(members: &Value) -> Vec<(String, String)> {
    members["members"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| (str_field(m, "email").to_owned(), str_field(m, "role").to_owned()))
        .collect()
}

// ===== Список и создание =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn people_see_only_their_projects_and_global_admins_see_all(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let other = c.another("other@example.com", "Другой").await;
    let admin = c.another_admin("admin@example.com", "Админ").await;
    c.ok(c.post("/api/v1/projects", json!({ "team_id": c.team, "name": "Мой" })).await, StatusCode::CREATED).await;
    other.ok(other.post("/api/v1/projects", json!({ "team_id": other.team, "name": "Чужой" })).await, StatusCode::CREATED).await;

    assert_eq!(names(&c.ok(c.get("/api/v1/projects").await, StatusCode::OK).await), ["Мой"]);
    assert_eq!(names(&other.ok(other.get("/api/v1/projects").await, StatusCode::OK).await), ["Чужой"]);
    let seen = admin.ok(admin.get("/api/v1/projects").await, StatusCode::OK).await;
    assert_eq!(names(&seen), ["Мой", "Чужой"], "глобальному админу доступны все, участвовать не нужно");
    assert!(seen.as_array().unwrap().iter().all(|p| p["role"] == "admin"));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn creating_a_project_makes_the_creator_admin_and_gives_the_default_board(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let project = c
        .ok(
            c.post("/api/v1/projects", json!({ "team_id": c.team, "name": "  Сайт ", "color": "warn", "key": " plx " })).await,
            StatusCode::CREATED,
        )
        .await;
    assert_eq!(
        (project["name"].as_str(), project["color"].as_str(), project["key"].as_str(), project["role"].as_str()),
        (Some("Сайт"), Some("warn"), Some("PLX"), Some("admin"))
    );
    assert_eq!(project["archived"], false);
    let id = id_of(&project);

    let board = c.ok(c.get(&format!("{}/board", project_uri(id))).await, StatusCode::OK).await;
    let columns: Vec<&str> = board["columns"].as_array().unwrap().iter().map(|c| str_field(c, "title")).collect();
    assert_eq!(columns, ["К выполнению", "В работе", "На ревью", "Готово"]);
    assert_eq!(board["tags"], json!([]), "новый проект начинается без меток");
    let members = c.ok(c.get(&format!("{}/members", project_uri(id))).await, StatusCode::OK).await;
    assert_eq!(roles_by_email(&members), [("tester@example.com".to_owned(), "admin".to_owned())]);

    let task = c
        .ok(c.post(&format!("{}/tasks", project_uri(id)), json!({ "title": "Первая" })).await, StatusCode::CREATED)
        .await;
    assert_eq!(task["key"], "PLX-1");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_project_without_a_key_gives_tasks_the_default_key(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let project =
        c.ok(c.post("/api/v1/projects", json!({ "team_id": c.team, "name": "Без ключа", "key": "" })).await, StatusCode::CREATED).await;
    assert_eq!(project["key"], Value::Null);
    assert_eq!(project["color"], "accent", "цвет по умолчанию");
    let task = c
        .ok(
            c.post(&format!("{}/tasks", project_uri(id_of(&project))), json!({ "title": "Первая" })).await,
            StatusCode::CREATED,
        )
        .await;
    assert_eq!(task["key"], "TASK-1");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn project_input_is_validated(pool: PgPool) {
    let c = Ctx::new(pool).await;
    for body in [
        json!({ "name": "" }),
        json!({ "name": "   " }),
        json!({ "name": "x".repeat(61) }),
        json!({ "name": "Ок", "color": "red" }),
        json!({ "name": "Ок", "key": "A" }),
        json!({ "name": "Ок", "key": "TOOLONGKEY" }),
        json!({ "name": "Ок", "key": "1AB" }),
        json!({ "name": "Ок", "key": "A-B" }),
        json!({ "name": "Ок", "key": "ПЛЕКС" }),
        json!({ "name": "Ок", "visibility": "everyone" }),
        json!({}),
        json!({ "name": "Ок", "extra": 1 }),
    ] {
        // команда указана верно: отказ должен быть из-за самого тела
        let mut body = body;
        body.as_object_mut().unwrap().insert("team_id".to_owned(), json!(c.team));
        assert_eq!(c.post("/api/v1/projects", body.clone()).await.status, StatusCode::BAD_REQUEST, "{body}");
    }
    // без команды проект не создать
    assert_eq!(c.post("/api/v1/projects", json!({ "name": "Ок" })).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(names(&c.ok(c.get("/api/v1/projects").await, StatusCode::OK).await), Vec::<String>::new());
}

// ===== Настройки, права, архив =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn only_an_admin_changes_settings_and_a_stranger_does_not_see_the_project(pool: PgPool) {
    let f = Fx::new(pool).await;
    let mate = member(&f, "mate@example.com", "member").await;
    let stranger = f.c.another("stranger@example.com", "Посторонний").await;
    let p = project_uri(f.project);

    // участник видит проект, но настройки ему недоступны: 403
    mate.ok(mate.get(&format!("{p}/board")).await, StatusCode::OK).await;
    for (method, uri, body) in [
        ("PATCH", p.clone(), json!({ "name": "Другое" })),
        ("POST", format!("{p}/archive"), json!({})),
        ("POST", format!("{p}/invites"), json!({ "email": "x@example.com" })),
    ] {
        let r = send(&mate.app, method.parse().unwrap(), &uri, Some(body), Some(&mate.token)).await;
        assert_eq!(r.status, StatusCode::FORBIDDEN, "{method} {uri}");
    }
    // постороннему проекта «нет»
    for (method, uri, body) in [
        ("GET", format!("{p}/board"), json!(null)),
        ("GET", format!("{p}/members"), json!(null)),
        ("PATCH", p.clone(), json!({ "name": "Другое" })),
        ("POST", format!("{p}/archive"), json!({})),
        ("POST", format!("{p}/invites"), json!({ "email": "x@example.com" })),
    ] {
        let b = (method != "GET").then_some(body);
        let r = send(&stranger.app, method.parse().unwrap(), &uri, b, Some(&stranger.token)).await;
        assert_eq!(r.status, StatusCode::NOT_FOUND, "{method} {uri}");
    }

    let changed = f.c.ok(f.c.patch(&p, json!({ "name": "Новое имя", "color": "ok" })).await, StatusCode::OK).await;
    assert_eq!((changed["name"].as_str(), changed["color"].as_str()), (Some("Новое имя"), Some("ok")));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn project_key_is_edited_without_renumbering_but_cannot_clash_with_a_module_key(pool: PgPool) {
    let f = Fx::new(pool.clone()).await;
    let task = f.task(Some(f.todo), "Первая").await;
    assert_eq!(task["key"], "WEB-1");
    let p = project_uri(f.project);

    // переименование: меняется только подпись, номер тот же
    let r = f.c.ok(f.c.patch(&p, json!({ "key": "site" })).await, StatusCode::OK).await;
    assert_eq!(r["key"], "SITE");
    let board = f.board().await;
    assert_eq!(board["tasks"][0]["key"], "SITE-1");
    // убрали ключ: TASK
    let r = f.c.ok(f.c.patch(&p, json!({ "key": null })).await, StatusCode::OK).await;
    assert_eq!(r["key"], Value::Null);
    assert_eq!(f.board().await["tasks"][0]["key"], "TASK-1");

    // ключ модуля занимает ключ проекта
    db::sqlx::query("insert into modules (project_id, title, key) values ($1, 'SEO', 'SEO'), ($1, 'Задачи', 'TASK')")
        .bind(f.project)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(f.c.patch(&p, json!({ "key": "seo" })).await.status, StatusCode::CONFLICT);
    assert_eq!(
        f.c.patch(&p, json!({ "key": null })).await.status,
        StatusCode::CONFLICT,
        "без ключа у задач TASK, а его занял модуль"
    );
    assert_eq!(f.c.patch(&p, json!({ "key": "other" })).await.status, StatusCode::OK);
    assert_eq!(f.c.patch(&p, json!({ "key": "bad key" })).await.status, StatusCode::BAD_REQUEST);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn archiving_hides_the_project_and_unarchiving_returns_it(pool: PgPool) {
    let f = Fx::new(pool).await;
    let mate = member(&f, "mate@example.com", "member").await;
    let p = project_uri(f.project);

    let archived = f.c.ok(f.c.post(&format!("{p}/archive"), json!({})).await, StatusCode::OK).await;
    assert_eq!(archived["archived"], true);
    assert_eq!(names(&f.c.ok(f.c.get("/api/v1/projects").await, StatusCode::OK).await), Vec::<String>::new());
    let list = f.c.ok(f.c.get("/api/v1/projects?archived=true").await, StatusCode::OK).await;
    assert_eq!(names(&list), ["Web-приложение"], "архив видит тот, кто им управляет");
    assert_eq!(
        names(&mate.ok(mate.get("/api/v1/projects?archived=true").await, StatusCode::OK).await),
        Vec::<String>::new(),
        "участнику архив не показывается"
    );
    // данные целы, проект открывается по id
    f.c.ok(f.c.get(&format!("{p}/board")).await, StatusCode::OK).await;
    assert_eq!(mate.post(&format!("{p}/unarchive"), json!({})).await.status, StatusCode::FORBIDDEN);

    let back = f.c.ok(f.c.post(&format!("{p}/unarchive"), json!({})).await, StatusCode::OK).await;
    assert_eq!(back["archived"], false);
    assert_eq!(names(&f.c.ok(f.c.get("/api/v1/projects").await, StatusCode::OK).await), ["Web-приложение"]);
}

// ===== Участники =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn the_member_list_shows_pending_invites_only_to_admins(pool: PgPool) {
    let f = Fx::new(pool).await;
    let mate = member(&f, "mate@example.com", "member").await;
    let guest = f.c.another("guest@example.com", "Гость").await;
    let p = project_uri(f.project);
    f.c.ok(f.c.post(&format!("{p}/invites"), json!({ "email": "guest@example.com" })).await, StatusCode::CREATED).await;

    let for_admin = f.c.ok(f.c.get(&format!("{p}/members")).await, StatusCode::OK).await;
    assert_eq!(for_admin["invites"].as_array().unwrap().len(), 1);
    assert_eq!(for_admin["invites"][0]["email"], "guest@example.com");
    assert_eq!(for_admin["invites"][0]["user_id"], guest.user.id.to_string());
    let for_member = mate.ok(mate.get(&format!("{p}/members")).await, StatusCode::OK).await;
    assert_eq!(for_member["invites"], json!([]), "приглашения видит только администратор");
    assert_eq!(
        roles_by_email(&for_member),
        [(String::new(), "admin".to_owned()), ("mate@example.com".to_owned(), "member".to_owned())],
        "сначала администраторы; e-mail чужих участнику не показывают, свой виден"
    );
    let seen_by_admin = roles_by_email(&for_admin);
    assert_eq!(seen_by_admin[1].0, "mate@example.com", "администратор проекта видит e-mail участников");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_project_is_never_left_without_an_admin_because_the_team_admin_stands_above_it(pool: PgPool) {
    // проект лежит в «Личном» первого человека: он администратор команды и потому администратор проекта
    let f = Fx::new(pool).await;
    let me = f.c.user.id;
    let p = project_uri(f.project);
    let mate = member(&f, "mate@example.com", "member").await;

    // блокировки «единственный администратор» нет: можно понизить себя и выйти
    assert_eq!(f.c.patch(&format!("{p}/members/{me}"), json!({ "role": "member" })).await.status, StatusCode::NO_CONTENT);
    let projects = f.c.ok(f.c.get("/api/v1/projects").await, StatusCode::OK).await;
    assert_eq!(projects[0]["role"], "admin", "роль в проекте высшая из оснований: администратор команды");

    assert_eq!(
        f.c.patch(&format!("{p}/members/{}", mate.user.id), json!({ "role": "admin" })).await.status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(mate.delete(&format!("{p}/members/{}", mate.user.id)).await.status, StatusCode::NO_CONTENT, "гость выходит");
    assert_eq!(mate.get(&format!("{p}/board")).await.status, StatusCode::NOT_FOUND, "после выхода проекта «нет»");

    // администратор команды выходит из списка участников, но остаётся над проектом
    assert_eq!(f.c.delete(&format!("{p}/members/{me}")).await.status, StatusCode::NO_CONTENT);
    assert_eq!(f.c.get(&format!("{p}/board")).await.status, StatusCode::OK);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn an_admin_removes_members_and_roles_are_checked(pool: PgPool) {
    let f = Fx::new(pool).await;
    let mate = member(&f, "mate@example.com", "member").await;
    let p = project_uri(f.project);

    assert_eq!(
        f.c.patch(&format!("{p}/members/{}", mate.user.id), json!({ "role": "owner" })).await.status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        f.c.patch(&format!("{p}/members/{}", Uuid::new_v4()), json!({ "role": "admin" })).await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        mate.delete(&format!("{p}/members/{}", f.c.user.id)).await.status,
        StatusCode::FORBIDDEN,
        "убрать другого может админ"
    );

    assert_eq!(f.c.delete(&format!("{p}/members/{}", mate.user.id)).await.status, StatusCode::NO_CONTENT);
    assert_eq!(
        f.c.delete(&format!("{p}/members/{}", mate.user.id)).await.status,
        StatusCode::NOT_FOUND,
        "его там уже нет"
    );
    assert_eq!(mate.get(&format!("{p}/board")).await.status, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_removed_member_keeps_his_name_on_old_tasks_but_cannot_be_assigned_again(pool: PgPool) {
    let f = Fx::new(pool).await;
    let mate = member(&f, "mate@example.com", "member").await;
    let other = member(&f, "other@example.com", "member").await;
    let task = f.task(Some(f.todo), "Задача").await;
    let uri = format!("/api/v1/tasks/{}", id_of(&task));
    f.c.ok(f.c.patch(&uri, json!({ "assignee_id": mate.user.id })).await, StatusCode::OK).await;

    f.c.delete(&format!("{}/members/{}", project_uri(f.project), mate.user.id)).await;
    let t = f.c.ok(f.c.get(&uri).await, StatusCode::OK).await;
    assert_eq!(t["assignee_id"], mate.user.id.to_string(), "имя на старой задаче остаётся");
    // другие поля такой задачи правятся, исполнитель при этом не меняется
    f.c.ok(f.c.patch(&uri, json!({ "title": "Новое" })).await, StatusCode::OK).await;
    assert_eq!(
        f.c.patch(&uri, json!({ "assignee_id": mate.user.id })).await.status,
        StatusCode::OK,
        "тот же исполнитель допустим"
    );
    // а назначить вышедшего на другую задачу или заменить исполнителя чужим нельзя
    let second = f.task(Some(f.todo), "Вторая").await;
    let r = f.c.patch(&format!("/api/v1/tasks/{}", id_of(&second)), json!({ "assignee_id": mate.user.id })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let stranger = f.c.another("stranger@example.com", "Посторонний").await;
    assert_eq!(f.c.patch(&uri, json!({ "assignee_id": stranger.user.id })).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(f.c.patch(&uri, json!({ "assignee_id": other.user.id })).await.status, StatusCode::OK);
}

// ===== Приглашения =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn an_invitation_is_accepted_and_the_person_becomes_a_member(pool: PgPool) {
    let f = Fx::new(pool).await;
    let guest = f.c.another("guest@example.com", "Гость").await;
    let p = project_uri(f.project);
    assert_eq!(guest.get(&format!("{p}/board")).await.status, StatusCode::NOT_FOUND);

    // регистр адреса и пробелы не мешают; роль по умолчанию — участник
    let created =
        f.c.ok(f.c.post(&format!("{p}/invites"), json!({ "email": " GUEST@Example.com " })).await, StatusCode::CREATED)
            .await;
    assert_eq!(
        (created["role"].as_str(), created["user_id"].as_str()),
        (Some("member"), Some(guest.user.id.to_string().as_str()))
    );

    let mine = guest.ok(guest.get("/api/v1/invites").await, StatusCode::OK).await;
    assert_eq!(mine.as_array().unwrap().len(), 1);
    assert_eq!(
        (mine[0]["project_name"].as_str(), mine[0]["invited_by_name"].as_str(), mine[0]["role"].as_str()),
        (Some("Web-приложение"), Some("Тестер Т."), Some("member"))
    );
    assert_eq!(guest.get(&format!("{p}/board")).await.status, StatusCode::NOT_FOUND, "пока не принял, проекта «нет»");

    assert_eq!(
        guest.post(&format!("/api/v1/invites/{}/accept", id_of(&created)), json!({})).await.status,
        StatusCode::NO_CONTENT
    );
    guest.ok(guest.get(&format!("{p}/board")).await, StatusCode::OK).await;
    assert_eq!(guest.ok(guest.get("/api/v1/invites").await, StatusCode::OK).await, json!([]));
    let members = f.c.ok(f.c.get(&format!("{p}/members")).await, StatusCode::OK).await;
    assert!(roles_by_email(&members).contains(&("guest@example.com".to_owned(), "member".to_owned())));
    assert_eq!(members["invites"], json!([]));
    // приглашение закрыто: второй раз принять нельзя
    assert_eq!(
        guest.post(&format!("/api/v1/invites/{}/accept", id_of(&created)), json!({})).await.status,
        StatusCode::CONFLICT
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn an_invitation_can_carry_the_admin_role_be_declined_and_sent_again(pool: PgPool) {
    let f = Fx::new(pool).await;
    let guest = f.c.another("guest@example.com", "Гость").await;
    let p = project_uri(f.project);

    let first =
        f.c.ok(
            f.c.post(&format!("{p}/invites"), json!({ "email": "guest@example.com", "role": "admin" })).await,
            StatusCode::CREATED,
        )
        .await;
    assert_eq!(
        guest.post(&format!("/api/v1/invites/{}/decline", id_of(&first)), json!({})).await.status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(guest.get(&format!("{p}/board")).await.status, StatusCode::NOT_FOUND, "отказался: не участник");
    assert_eq!(guest.ok(guest.get("/api/v1/invites").await, StatusCode::OK).await, json!([]));

    // после отказа пригласить снова можно
    let second =
        f.c.ok(
            f.c.post(&format!("{p}/invites"), json!({ "email": "guest@example.com", "role": "admin" })).await,
            StatusCode::CREATED,
        )
        .await;
    guest.post(&format!("/api/v1/invites/{}/accept", id_of(&second)), json!({})).await;
    let members = f.c.ok(f.c.get(&format!("{p}/members")).await, StatusCode::OK).await;
    assert!(roles_by_email(&members).contains(&("guest@example.com".to_owned(), "admin".to_owned())));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn invitation_errors_are_clear(pool: PgPool) {
    let f = Fx::new(pool).await;
    let p = project_uri(f.project);
    let guest = f.c.another("guest@example.com", "Гость").await;

    let unknown = f.c.post(&format!("{p}/invites"), json!({ "email": "nobody@example.com" })).await;
    assert_eq!(unknown.status, StatusCode::BAD_REQUEST);
    assert_eq!(unknown.body["message"], "Аккаунта с таким адресом нет");
    let me = f.c.post(&format!("{p}/invites"), json!({ "email": "tester@example.com" })).await;
    assert_eq!((me.status, me.body["message"].as_str()), (StatusCode::CONFLICT, Some("Уже в проекте")));
    assert_eq!(
        f.c.post(&format!("{p}/invites"), json!({ "email": "guest@example.com", "role": "owner" })).await.status,
        StatusCode::BAD_REQUEST
    );

    f.c.ok(f.c.post(&format!("{p}/invites"), json!({ "email": "guest@example.com" })).await, StatusCode::CREATED).await;
    let again = f.c.post(&format!("{p}/invites"), json!({ "email": "guest@example.com" })).await;
    assert_eq!((again.status, again.body["message"].as_str()), (StatusCode::CONFLICT, Some("Уже приглашён")));
    assert_eq!(guest.get("/api/v1/invites").await.body.as_array().unwrap().len(), 1, "дубля нет");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn only_the_invitee_answers_and_an_admin_can_revoke(pool: PgPool) {
    let f = Fx::new(pool).await;
    let guest = f.c.another("guest@example.com", "Гость").await;
    let intruder = f.c.another("intruder@example.com", "Чужой").await;
    let mate = member(&f, "mate@example.com", "member").await;
    let p = project_uri(f.project);
    let invite =
        f.c.ok(f.c.post(&format!("{p}/invites"), json!({ "email": "guest@example.com" })).await, StatusCode::CREATED)
            .await;
    let id = id_of(&invite);

    // чужое приглашение для постороннего «нет», принять и отклонить может только приглашённый
    assert_eq!(intruder.post(&format!("/api/v1/invites/{id}/accept"), json!({})).await.status, StatusCode::NOT_FOUND);
    assert_eq!(intruder.post(&format!("/api/v1/invites/{id}/decline"), json!({})).await.status, StatusCode::NOT_FOUND);
    assert_eq!(
        f.c.post(&format!("/api/v1/invites/{id}/accept"), json!({})).await.status,
        StatusCode::NOT_FOUND,
        "даже админ не принимает за другого"
    );
    // отозвать может администратор проекта: не участник «не находит», участник получает отказ
    assert_eq!(intruder.delete(&format!("/api/v1/invites/{id}")).await.status, StatusCode::NOT_FOUND);
    assert_eq!(mate.delete(&format!("/api/v1/invites/{id}")).await.status, StatusCode::FORBIDDEN);
    assert_eq!(
        guest.delete(&format!("/api/v1/invites/{id}")).await.status,
        StatusCode::NOT_FOUND,
        "приглашённый проект не видит, отозвать не может"
    );

    assert_eq!(f.c.delete(&format!("/api/v1/invites/{id}")).await.status, StatusCode::NO_CONTENT);
    assert_eq!(f.c.delete(&format!("/api/v1/invites/{id}")).await.status, StatusCode::CONFLICT, "уже закрыто");
    assert_eq!(guest.ok(guest.get("/api/v1/invites").await, StatusCode::OK).await, json!([]));
    assert_eq!(guest.post(&format!("/api/v1/invites/{id}/accept"), json!({})).await.status, StatusCode::CONFLICT);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn an_invitation_to_an_archived_project_is_hidden_and_cannot_be_accepted(pool: PgPool) {
    let f = Fx::new(pool).await;
    let guest = f.c.another("guest@example.com", "Гость").await;
    let p = project_uri(f.project);
    let invite =
        f.c.ok(f.c.post(&format!("{p}/invites"), json!({ "email": "guest@example.com" })).await, StatusCode::CREATED)
            .await;
    f.c.post(&format!("{p}/archive"), json!({})).await;

    assert_eq!(guest.ok(guest.get("/api/v1/invites").await, StatusCode::OK).await, json!([]));
    assert_eq!(
        guest.post(&format!("/api/v1/invites/{}/accept", id_of(&invite)), json!({})).await.status,
        StatusCode::NOT_FOUND
    );
    f.c.post(&format!("{p}/unarchive"), json!({})).await;
    assert_eq!(
        guest.ok(guest.get("/api/v1/invites").await, StatusCode::OK).await.as_array().unwrap().len(),
        1,
        "из архива приглашение возвращается"
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn people_added_to_a_project_via_the_project_creator_flow_see_it_in_their_list(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let guest = c.another("guest@example.com", "Гость").await;
    let project = c.ok(c.post("/api/v1/projects", json!({ "team_id": c.team, "name": "Командный" })).await, StatusCode::CREATED).await;
    let invite = c
        .ok(
            c.post(&format!("{}/invites", project_uri(id_of(&project))), json!({ "email": "guest@example.com" })).await,
            StatusCode::CREATED,
        )
        .await;
    guest.post(&format!("/api/v1/invites/{}/accept", id_of(&invite)), json!({})).await;
    assert_eq!(names(&guest.ok(guest.get("/api/v1/projects").await, StatusCode::OK).await), ["Командный"]);
    assert_eq!(guest.ok(guest.get("/api/v1/projects").await, StatusCode::OK).await[0]["role"], "member");
}
