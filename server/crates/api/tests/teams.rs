//! Команды на настоящем Postgres (docs/TEAMS.md): личная команда «Личное», список моих команд, правило доступа к проекту
//! (явный участник, администратор команды, «Вся команда»), создание проекта в команде, вики и файлы по командам,
//! гость и настройка команды, список людей и e-mail.

mod common;

use axum::http::StatusCode;
use common::*;
use db::PgPool;
use serde_json::{Value, json};
use uuid::Uuid;

fn names(list: &Value) -> Vec<String> {
    list.as_array().unwrap().iter().map(|x| str_field(x, "name").to_owned()).collect()
}

async fn project_names(who: &Ctx) -> Vec<String> {
    names(&who.get("/api/v1/projects").await.body)
}

async fn board(who: &Ctx, project: Uuid) -> Reply {
    who.get(&format!("/api/v1/projects/{project}/board")).await
}

async fn rename(who: &Ctx, project: Uuid) -> StatusCode {
    who.patch(&format!("/api/v1/projects/{project}"), json!({ "name": "Новое" })).await.status
}

async fn create_project(who: &Ctx, body: Value) -> Reply {
    who.post("/api/v1/projects", body).await
}

/// Названия целей событий ленты проекта
async fn feed_targets(who: &Ctx, project: Uuid) -> Vec<String> {
    let r = who.get(&format!("/api/v1/projects/{project}/activity")).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    r.body["items"].as_array().unwrap().iter().map(|e| str_field(e, "target").to_owned()).collect()
}

/// Видимые люди: (имя, e-mail)
async fn people_of(who: &Ctx) -> Vec<(String, String)> {
    let r = who.get("/api/v1/users").await;
    assert_eq!(r.status, StatusCode::OK);
    r.body
        .as_array()
        .unwrap()
        .iter()
        .map(|u| (str_field(u, "name").to_owned(), str_field(u, "email").to_owned()))
        .collect()
}

async fn set_guests_read(pool: &PgPool, team: Uuid, on: bool) {
    db::sqlx::query("update teams set guests_read_wiki = $2 where id = $1")
        .bind(team)
        .bind(on)
        .execute(pool)
        .await
        .unwrap();
}

// ===== Мои команды =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn every_account_has_a_personal_team_and_it_comes_first(pool: PgPool) {
    let c = Ctx::new(pool.clone()).await;
    let teams = c.ok(c.get("/api/v1/teams").await, StatusCode::OK).await;
    assert_eq!(names(&teams), ["Личное"]);
    let mine = &teams[0];
    assert_eq!(mine["id"], c.team.to_string());
    assert_eq!(mine["personal"], true);
    assert_eq!(mine["role"], "admin");
    assert_eq!(mine["guest"], false);
    assert_eq!(mine["wiki"], true);
    assert_eq!(mine["guests_read_wiki"], false, "по умолчанию гости вики не читают");

    // обычная команда идёт после «Личного», даже если создана раньше аккаунта... или позже
    let web = make_team(&pool, "Веб", &[(c.user.id, "member")]).await;
    let teams = c.ok(c.get("/api/v1/teams").await, StatusCode::OK).await;
    assert_eq!(names(&teams), ["Личное", "Веб"]);
    assert_eq!(teams[1]["id"], web.to_string());
    assert_eq!(teams[1]["personal"], false);
    assert_eq!(teams[1]["role"], "member");

    // у каждого аккаунта своя личная команда и ровно одна
    let other = c.another("other@example.com", "Другой").await;
    let theirs = other.ok(other.get("/api/v1/teams").await, StatusCode::OK).await;
    assert_eq!(names(&theirs), ["Личное"]);
    assert_ne!(theirs[0]["id"], mine["id"]);
    let personal: i64 = db::sqlx::query_scalar("select count(*) from teams where personal_for is not null")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(personal, 2);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_team_where_i_am_only_a_guest_is_listed_with_a_mark_and_without_its_secrets(pool: PgPool) {
    let f = Fx::new(pool).await;
    let guest = f.c.another("guest@example.com", "Гость").await;
    join(&f.c.pool, f.project, guest.user.id, "member").await;

    let teams = guest.ok(guest.get("/api/v1/teams").await, StatusCode::OK).await;
    assert_eq!(names(&teams), ["Личное", "Личное"], "своя личная и чужая, где я гость");
    let theirs = &teams[1];
    assert_eq!(theirs["id"], f.c.team.to_string());
    assert_eq!(theirs["guest"], true);
    assert_eq!(theirs["role"], Value::Null);
    assert_eq!(theirs["wiki"], false);
    assert!(theirs.get("guests_read_wiki").is_none(), "настройку команды видят только её члены: {theirs}");

    set_guests_read(&f.c.pool, f.c.team, true).await;
    let teams = guest.ok(guest.get("/api/v1/teams").await, StatusCode::OK).await;
    assert_eq!(teams[1]["wiki"], true, "разрешили читать вики");
    assert!(teams[1].get("guests_read_wiki").is_none());

    // архивная команда исчезает из списка
    db::sqlx::query("update teams set archived_at = now() where id = $1")
        .bind(f.c.team)
        .execute(&f.c.pool)
        .await
        .unwrap();
    let teams = guest.ok(guest.get("/api/v1/teams").await, StatusCode::OK).await;
    assert_eq!(names(&teams), ["Личное"]);
}

// ===== Правило доступа к проекту =====

/// Команда «Веб»: администратор `lead`, член `dev`, гость `guest` (только в закрытом проекте), посторонний `out`
struct Web {
    lead: Ctx,
    dev: Ctx,
    guest: Ctx,
    out: Ctx,
    team: Uuid,
    /// видимость «Только участники», гость в нём явный участник
    private: Uuid,
    /// видимость «Вся команда»
    open: Uuid,
}

async fn web(pool: PgPool) -> Web {
    let lead = Ctx::new(pool.clone()).await;
    let dev = lead.another("dev@example.com", "Разработчик").await;
    let guest = lead.another("guest@example.com", "Гость").await;
    let out = lead.another("out@example.com", "Посторонний").await;
    let team = make_team(&pool, "Веб", &[(lead.user.id, "admin"), (dev.user.id, "member")]).await;
    let private = make_project_in(&pool, team, "members", "PRIV", "Закрытый", "accent").await;
    let open = make_project_in(&pool, team, "team", "OPEN", "Открытый", "warn").await;
    join(&pool, private, guest.user.id, "member").await;
    Web { lead, dev, guest, out, team, private, open }
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn projects_follow_the_visibility_rule_for_every_kind_of_person(pool: PgPool) {
    let w = web(pool.clone()).await;
    // администратор команды видит все проекты, член только «Вся команда», гость только свой, посторонний ничего
    assert_eq!(project_names(&w.lead).await, ["Закрытый", "Открытый"]);
    assert_eq!(project_names(&w.dev).await, ["Открытый"]);
    assert_eq!(project_names(&w.guest).await, ["Закрытый"]);
    assert!(project_names(&w.out).await.is_empty());

    assert_eq!(board(&w.dev, w.private).await.status, StatusCode::NOT_FOUND, "закрытый проект члену команды «нет»");
    assert_eq!(board(&w.out, w.open).await.status, StatusCode::NOT_FOUND);
    assert_eq!(board(&w.guest, w.open).await.status, StatusCode::NOT_FOUND, "гость не видит других проектов команды");

    // роль: администратор команды администратор в любом проекте, член команды в «Вся команда» участник
    let seen = board(&w.lead, w.private).await;
    assert_eq!(seen.status, StatusCode::OK);
    assert_eq!(seen.body["project"]["role"], "admin");
    assert_eq!(seen.body["project"]["guest"], false);
    assert_eq!(seen.body["project"]["team_id"], w.team.to_string());
    assert_eq!(seen.body["project"]["visibility"], "members");
    let open_for_dev = board(&w.dev, w.open).await;
    assert_eq!(open_for_dev.body["project"]["role"], "member");
    assert_eq!(open_for_dev.body["project"]["visibility"], "team");
    let for_guest = board(&w.guest, w.private).await;
    assert_eq!(for_guest.body["project"]["guest"], true, "гость помечен");
    assert_eq!(for_guest.body["project"]["role"], "member");

    // права: член команды в открытом проекте не администратор, администратор команды правит чужой закрытый проект
    assert_eq!(rename(&w.dev, w.open).await, StatusCode::FORBIDDEN);
    assert_eq!(rename(&w.lead, w.private).await, StatusCode::OK);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn switching_the_visibility_gives_and_takes_access_at_once(pool: PgPool) {
    let w = web(pool.clone()).await;
    let can = |p: Uuid| {
        let dev = &w.dev;
        let uri = format!("/api/v1/projects/{p}/board");
        async move { dev.get(&uri).await.status == StatusCode::OK }
    };
    assert!(!can(w.private).await);
    db::sqlx::query("update projects set visibility = 'team' where id = $1")
        .bind(w.private)
        .execute(&pool)
        .await
        .unwrap();
    assert!(can(w.private).await, "«Вся команда» открыла проект");
    db::sqlx::query("update projects set visibility = 'members' where id = $1")
        .bind(w.open)
        .execute(&pool)
        .await
        .unwrap();
    assert!(!can(w.open).await, "«Только участники» закрыла");

    // выход из команды отзывает неявный доступ сразу
    db::sqlx::query("update projects set visibility = 'team' where id = $1").bind(w.open).execute(&pool).await.unwrap();
    assert!(can(w.open).await);
    db::sqlx::query("delete from team_members where team_id = $1 and user_id = $2")
        .bind(w.team)
        .bind(w.dev.user.id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(!can(w.open).await);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn an_archived_team_hides_all_its_projects_even_from_guests_but_not_from_the_server_admin(pool: PgPool) {
    let w = web(pool.clone()).await;
    let root = w.lead.another_admin("root@example.com", "Админ сервера").await;
    db::sqlx::query("update teams set archived_at = now() where id = $1").bind(w.team).execute(&pool).await.unwrap();

    for (who, label) in [(&w.lead, "администратор команды"), (&w.dev, "член"), (&w.guest, "гость")]
    {
        for p in [w.private, w.open] {
            let r = who.get(&format!("/api/v1/projects/{p}/board")).await;
            assert_eq!(r.status, StatusCode::NOT_FOUND, "{label}");
        }
    }
    assert_eq!(root.get(&format!("/api/v1/projects/{}/board", w.private)).await.status, StatusCode::OK);
}

// ===== Создание проекта в команде =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_project_is_created_in_a_team_by_its_members_only(pool: PgPool) {
    let w = web(pool.clone()).await;
    // член команды создаёт, видимость по умолчанию «Только участники», создатель администратор
    let r = create_project(&w.dev, json!({ "team_id": w.team, "name": "Новый" })).await;
    assert_eq!(r.status, StatusCode::CREATED, "{}", r.body);
    assert_eq!(r.body["team_id"], w.team.to_string());
    assert_eq!(r.body["visibility"], "members");
    assert_eq!(r.body["role"], "admin");
    let r = create_project(&w.dev, json!({ "team_id": w.team, "name": "Для всех", "visibility": "team" })).await;
    assert_eq!(r.body["visibility"], "team");

    // гость и посторонний команды «не видят»; своя личная команда годится всегда
    assert_eq!(create_project(&w.guest, json!({ "team_id": w.team, "name": "Х" })).await.status, StatusCode::NOT_FOUND);
    assert_eq!(create_project(&w.out, json!({ "team_id": w.team, "name": "Х" })).await.status, StatusCode::NOT_FOUND);
    assert_eq!(
        create_project(&w.out, json!({ "team_id": Uuid::new_v4(), "name": "Х" })).await.status,
        StatusCode::NOT_FOUND
    );
    let r = create_project(&w.out, json!({ "team_id": w.out.team, "name": "Мой" })).await;
    assert_eq!(r.status, StatusCode::CREATED);

    // свежий проект члена команды при «Только участники» администратору команды виден
    let lead_list = w.lead.ok(w.lead.get("/api/v1/projects").await, StatusCode::OK).await;
    assert!(names(&lead_list).contains(&"Новый".to_owned()), "администратор команды видит все проекты");
    assert!(!names(&w.out.ok(w.out.get("/api/v1/projects").await, StatusCode::OK).await).contains(&"Новый".to_owned()));
}

// ===== Вики и библиотека: команды не смешиваются =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn wiki_pages_files_and_folders_never_cross_a_team_border(pool: PgPool) {
    let w = web(pool.clone()).await;
    let mine = format!("/api/v1/teams/{}", w.lead.team);
    let web_team = format!("/api/v1/teams/{}", w.team);

    let page =
        w.lead.ok(w.lead.post(&format!("{mine}/wiki"), json!({ "title": "Личная" })).await, StatusCode::CREATED).await;
    let folder =
        w.lead.ok(w.lead.post(&format!("{mine}/folders"), json!({ "name": "Папка" })).await, StatusCode::CREATED).await;

    // страница-родитель из другой команды
    let r = w.lead.post(&format!("{web_team}/wiki"), json!({ "title": "Дочерняя", "parent_id": id_of(&page) })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "родитель из другой команды: {}", r.body);
    let own = w
        .lead
        .ok(w.lead.post(&format!("{web_team}/wiki"), json!({ "title": "Своя" })).await, StatusCode::CREATED)
        .await;
    let r = w.lead.patch(&format!("/api/v1/wiki/{}", id_of(&own)), json!({ "parent_id": id_of(&page) })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "перенос под страницу чужой команды: {}", r.body);

    // файл, привязанный к странице или папке другой команды
    let r = w
        .lead
        .upload(&format!("{web_team}/files"), &[file_part("a.txt", b"1"), text_part("wiki_page_id", id_of(&page))])
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "страница чужой команды: {}", r.body);
    let r = w
        .lead
        .upload(&format!("{web_team}/files"), &[file_part("a.txt", b"1"), text_part("folder_id", id_of(&folder))])
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "папка чужой команды: {}", r.body);

    // у каждой команды свои списки, одинаковое название папки в разных командах допустимо
    let same = w.lead.post(&format!("{web_team}/folders"), json!({ "name": "Папка" })).await;
    assert_eq!(same.status, StatusCode::CREATED, "название уникально внутри команды, а не на весь сервер");
    let again = w.lead.post(&format!("{web_team}/folders"), json!({ "name": "Папка" })).await;
    assert_eq!(again.status, StatusCode::CONFLICT);
    assert_eq!(names2(&w.lead.get(&format!("{mine}/wiki")).await.body, "title"), ["Личная"]);
    assert_eq!(names2(&w.lead.get(&format!("{web_team}/wiki")).await.body, "title"), ["Своя"]);
    assert_eq!(w.lead.get(&format!("{mine}/folders")).await.body.as_array().unwrap().len(), 1);

    // файл лежит в команде, в которую загружен
    let up = w
        .lead
        .ok(w.lead.upload(&format!("{web_team}/files"), &[file_part("общий.txt", b"1")]).await, StatusCode::CREATED)
        .await;
    assert_eq!(w.lead.get(&format!("{mine}/files")).await.body["total"], 0);
    assert_eq!(w.lead.get(&format!("{web_team}/files")).await.body["total"], 1);
    assert_eq!(
        w.out.download(&format!("/api/v1/files/{}/download", id_of(&up[0]))).await.status,
        StatusCode::NOT_FOUND
    );
}

fn names2(list: &Value, field: &str) -> Vec<String> {
    list.as_array().unwrap().iter().map(|x| str_field(x, field).to_owned()).collect()
}

// ===== Гость и вики команды =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_guest_reads_the_wiki_only_when_the_team_allows_it_and_never_writes(pool: PgPool) {
    let w = web(pool.clone()).await;
    let wiki = format!("/api/v1/teams/{}/wiki", w.team);
    let files = format!("/api/v1/teams/{}/files", w.team);
    let folders = format!("/api/v1/teams/{}/folders", w.team);
    let page = w.lead.ok(w.lead.post(&wiki, json!({ "title": "Для своих" })).await, StatusCode::CREATED).await;
    let file = w.lead.ok(w.lead.upload(&files, &[file_part("план.txt", b"1")]).await, StatusCode::CREATED).await;
    let folder = w.lead.ok(w.lead.post(&folders, json!({ "name": "Папка" })).await, StatusCode::CREATED).await;
    let page_uri = format!("/api/v1/wiki/{}", id_of(&page));
    let download = format!("/api/v1/files/{}/download", id_of(&file[0]));

    // настройка выключена: ничего нет
    for uri in [&wiki, &page_uri, &files, &folders] {
        assert_eq!(w.guest.get(uri).await.status, StatusCode::NOT_FOUND, "{uri}");
    }
    assert_eq!(w.guest.download(&download).await.status, StatusCode::NOT_FOUND);

    // включена: читает и скачивает
    set_guests_read(&pool, w.team, true).await;
    for uri in [&wiki, &page_uri, &files, &folders] {
        assert_eq!(w.guest.get(uri).await.status, StatusCode::OK, "{uri}");
    }
    assert_eq!(w.guest.download(&download).await.status, StatusCode::OK);

    // но не пишет никогда
    assert_eq!(w.guest.post(&wiki, json!({ "title": "Х" })).await.status, StatusCode::FORBIDDEN);
    assert_eq!(w.guest.patch(&page_uri, json!({ "rev": 1, "md": "x" })).await.status, StatusCode::FORBIDDEN);
    assert_eq!(w.guest.delete(&page_uri).await.status, StatusCode::FORBIDDEN);
    assert_eq!(w.guest.upload(&files, &[file_part("б.txt", b"2")]).await.status, StatusCode::FORBIDDEN);
    assert_eq!(w.guest.delete(&format!("/api/v1/files/{}", id_of(&file[0]))).await.status, StatusCode::FORBIDDEN);
    assert_eq!(w.guest.post(&folders, json!({ "name": "Новая" })).await.status, StatusCode::FORBIDDEN);
    assert_eq!(w.guest.delete(&format!("/api/v1/folders/{}", id_of(&folder))).await.status, StatusCode::FORBIDDEN);

    // страница цела, а посторонний не видит и при включённой настройке: гостем он не является
    assert_eq!(w.lead.get(&page_uri).await.status, StatusCode::OK);
    assert_eq!(w.out.get(&wiki).await.status, StatusCode::NOT_FOUND);
    assert_eq!(w.out.get(&page_uri).await.status, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn the_project_feed_shows_the_teams_wiki_events_only_to_those_who_read_the_wiki(pool: PgPool) {
    let w = web(pool.clone()).await;
    w.lead
        .ok(
            w.lead.post(&format!("/api/v1/teams/{}/wiki", w.team), json!({ "title": "Новость команды" })).await,
            StatusCode::CREATED,
        )
        .await;
    let other_page = format!("/api/v1/teams/{}/wiki", w.out.team);
    w.out.ok(w.out.post(&other_page, json!({ "title": "Чужая новость" })).await, StatusCode::CREATED).await;

    let wiki_news = |targets: &[String]| targets.iter().any(|t| t.contains("Новость команды"));
    assert!(wiki_news(&feed_targets(&w.dev, w.open).await), "член команды видит события вики");
    assert!(wiki_news(&feed_targets(&w.lead, w.private).await));
    assert!(!wiki_news(&feed_targets(&w.guest, w.private).await), "гость без разрешения: событий вики нет");
    set_guests_read(&pool, w.team, true).await;
    assert!(wiki_news(&feed_targets(&w.guest, w.private).await), "разрешили: гость видит события вики");
    assert!(
        !feed_targets(&w.lead, w.private).await.iter().any(|t| t.contains("Чужая")),
        "вики другой команды в ленте нет"
    );
}

// ===== Люди =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn the_people_list_shows_only_people_i_may_see_and_hides_emails_by_the_rules(pool: PgPool) {
    let w = web(pool.clone()).await;
    let people = |v: &[(String, String)]| v.iter().map(|(n, _)| n.clone()).collect::<Vec<_>>();
    let email_of = |v: &[(String, String)], name: &str| v.iter().find(|(n, _)| n == name).map(|(_, e)| e.clone());

    // посторонний видит только себя
    let out = people_of(&w.out).await;
    assert_eq!(people(&out), ["Посторонний"]);
    assert_eq!(email_of(&out, "Посторонний").as_deref(), Some("out@example.com"), "свой e-mail виден");

    // член команды видит членов команды (без их e-mail) и себя
    let dev = people_of(&w.dev).await;
    assert_eq!(people(&dev), ["Тестер Т.", "Разработчик"]);
    assert_eq!(email_of(&dev, "Тестер Т.").as_deref(), Some(""), "e-mail администратора члену команды не показывают");
    assert_eq!(email_of(&dev, "Разработчик").as_deref(), Some("dev@example.com"));

    // администратор команды видит e-mail всех её членов и явных участников своих проектов
    let lead = people_of(&w.lead).await;
    assert_eq!(people(&lead), ["Тестер Т.", "Разработчик", "Гость"]);
    assert_eq!(email_of(&lead, "Разработчик").as_deref(), Some("dev@example.com"));
    assert_eq!(email_of(&lead, "Гость").as_deref(), Some("guest@example.com"));

    // гость видит себя и участников своего проекта, но не членов команды
    let guest = people_of(&w.guest).await;
    assert_eq!(people(&guest), ["Гость"]);

    // is_admin другим людям не отдаётся
    let r = w.lead.get("/api/v1/users").await;
    assert!(r.body.as_array().unwrap().iter().all(|u| u["is_admin"] == false));

    // администратор сервера видит всех, с e-mail
    let root = w.lead.another_admin("root@example.com", "Админ сервера").await;
    let all = people_of(&root).await;
    assert_eq!(all.len(), 5);
    assert!(all.iter().all(|(_, e)| !e.is_empty()));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_person_who_left_is_still_named_on_the_data_i_can_see(pool: PgPool) {
    let w = web(pool.clone()).await;
    // разработчик пишет комментарий в открытом проекте и уходит из команды
    let todo = db::sqlx::query_scalar::<_, Uuid>(
        "insert into board_columns (project_id, title, color, position) values ($1, 'К выполнению', 'muted', 1) returning id",
    )
    .bind(w.open)
    .fetch_one(&pool)
    .await
    .unwrap();
    let task = w
        .dev
        .ok(
            w.dev
                .post(&format!("/api/v1/projects/{}/tasks", w.open), json!({ "title": "Задача", "column_id": todo }))
                .await,
            StatusCode::CREATED,
        )
        .await;
    w.dev
        .ok(
            w.dev.post(&format!("/api/v1/tasks/{}/comments", id_of(&task)), json!({ "body": "Сделал" })).await,
            StatusCode::CREATED,
        )
        .await;
    db::sqlx::query("delete from team_members where team_id = $1 and user_id = $2")
        .bind(w.team)
        .bind(w.dev.user.id)
        .execute(&pool)
        .await
        .unwrap();

    // администратор команды всё ещё видит его имя на задаче: оно осталось на видимых ему данных
    let r = w.lead.get("/api/v1/users").await;
    let seen: Vec<String> = r.body.as_array().unwrap().iter().map(|u| str_field(u, "name").to_owned()).collect();
    assert!(seen.contains(&"Разработчик".to_owned()), "{seen:?}");
    // а у постороннего его нет
    let r = w.out.get("/api/v1/users").await;
    assert_eq!(r.body.as_array().unwrap().len(), 1);
}

// ===== Согласованность всей базы =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn the_database_stays_consistent_after_a_typical_session(pool: PgPool) {
    let w = web(pool.clone()).await;
    w.lead
        .ok(w.lead.post(&format!("/api/v1/teams/{}/wiki", w.team), json!({ "title": "П" })).await, StatusCode::CREATED)
        .await;
    w.dev
        .ok(w.dev.post("/api/v1/projects", json!({ "team_id": w.team, "name": "Ещё" })).await, StatusCode::CREATED)
        .await;
    w.out
        .ok(
            w.out.post(&format!("/api/v1/teams/{}/folders", w.out.team), json!({ "name": "Ф" })).await,
            StatusCode::CREATED,
        )
        .await;

    let one = |sql: &'static str| {
        let pool = pool.clone();
        async move { db::sqlx::query_scalar::<_, i64>(sql).fetch_one(&pool).await.unwrap() }
    };
    assert_eq!(
        one("select count(*) from users u where (select count(*) from teams t where t.personal_for = u.id) <> 1").await,
        0,
        "у каждого аккаунта ровно одна личная команда"
    );
    assert_eq!(one("select count(*) from teams t where not exists (select 1 from team_members m where m.team_id = t.id and m.role = 'admin')").await, 0, "у каждой команды есть администратор");
    assert_eq!(one("select count(*) from projects where team_id is null").await, 0);
    assert_eq!(
        one("select count(*) from wiki_pages c join wiki_pages p on p.id = c.parent_id where c.team_id <> p.team_id")
            .await,
        0,
        "страница и её родитель в одной команде"
    );
    assert_eq!(
        one("select count(*) from files f join wiki_pages p on p.id = f.wiki_page_id where f.team_id <> p.team_id")
            .await,
        0
    );
    assert_eq!(
        one("select count(*) from files f join folders d on d.id = f.folder_id where f.team_id <> d.team_id").await,
        0
    );
    assert_eq!(one("select count(*) from files f join tasks t on t.id = f.task_id join projects p on p.id = t.project_id where f.team_id <> p.team_id").await, 0, "вложение задачи в команде её проекта");
}
