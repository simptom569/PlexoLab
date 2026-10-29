//! Ручки команд на настоящем Postgres (docs/TEAMS.md, этап К2): создание и лимит, роли, выход и исключение, приглашения,
//! архив, настройка для гостей, видимость проекта с числом затронутых людей, состав проекта, список для администратора
//! сервера и события WebSocket.

mod common;

use api::events::Audience;
use axum::http::StatusCode;
use common::*;
use db::PgPool;
use serde_json::{Value, json};
use uuid::Uuid;

fn names(list: &Value) -> Vec<String> {
    list.as_array().unwrap().iter().map(|x| str_field(x, "name").to_owned()).collect()
}

fn message(r: &Reply) -> String {
    str_field(&r.body, "message").to_owned()
}

/// Команда, созданная через API, и её id
async fn create_team(who: &Ctx, name: &str) -> Uuid {
    let r = who.post("/api/v1/teams", json!({ "name": name })).await;
    assert_eq!(r.status, StatusCode::CREATED, "{}", r.body);
    id_of(&r.body)
}

/// Приглашает по e-mail и сразу принимает от имени приглашённого
async fn add_member(admin: &Ctx, team: Uuid, who: &Ctx, role: &str) {
    let r =
        admin.post(&format!("/api/v1/teams/{team}/invites"), json!({ "email": who.user.email, "role": role })).await;
    assert_eq!(r.status, StatusCode::CREATED, "{}", r.body);
    let accepted = who.post(&format!("/api/v1/team-invites/{}/accept", id_of(&r.body)), json!({})).await;
    assert_eq!(accepted.status, StatusCode::NO_CONTENT, "{}", accepted.body);
}

/// Состав команды
async fn roster(who: &Ctx, team: Uuid) -> Value {
    let r = who.get(&format!("/api/v1/teams/{team}/members")).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    r.body
}

/// Сколько человек затронет смена видимости проекта
async fn impact(who: &Ctx, project: Uuid, to: &str) -> Reply {
    who.get(&format!("/api/v1/projects/{project}/visibility-impact?to={to}")).await
}

/// Строки состава проекта: (имя, роль, администратор команды, неявный, e-mail)
async fn project_rows(who: &Ctx, project: Uuid) -> Vec<(String, String, bool, bool, String)> {
    let r = who.get(&format!("/api/v1/projects/{project}/members")).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    r.body["members"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| {
            (
                str_field(m, "name").to_owned(),
                str_field(m, "role").to_owned(),
                m["team_admin"].as_bool().unwrap(),
                m["implicit"].as_bool().unwrap(),
                str_field(m, "email").to_owned(),
            )
        })
        .collect()
}

async fn team_names(who: &Ctx) -> Vec<String> {
    names(&who.get("/api/v1/teams").await.body)
}

async fn project_names(who: &Ctx) -> Vec<String> {
    names(&who.get("/api/v1/projects").await.body)
}

// ===== Создание, название, лимит =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_team_is_created_by_anyone_and_the_creator_becomes_its_admin(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let r = c.post("/api/v1/teams", json!({ "name": "  Веб " })).await;
    assert_eq!(r.status, StatusCode::CREATED, "{}", r.body);
    assert_eq!(r.body["name"], "Веб", "пробелы по краям убраны");
    assert_eq!(r.body["role"], "admin");
    assert_eq!(r.body["personal"], false);
    assert_eq!(r.body["guests_read_wiki"], false);
    assert_eq!(team_names(&c).await, ["Личное", "Веб"]);

    // названия не уникальны
    c.ok(c.post("/api/v1/teams", json!({ "name": "Веб" })).await, StatusCode::CREATED).await;

    for bad in [
        json!({ "name": "" }),
        json!({ "name": "   " }),
        json!({ "name": "я".repeat(61) }),
        json!({}),
        json!({ "name": "Ок", "extra": 1 }),
    ] {
        assert_eq!(c.post("/api/v1/teams", bad.clone()).await.status, StatusCode::BAD_REQUEST, "{bad}");
    }
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn one_person_creates_at_most_five_teams_and_personal_one_is_not_counted(pool: PgPool) {
    let c = Ctx::new(pool).await;
    let mut first = None;
    for i in 1..=5 {
        let id = create_team(&c, &format!("Команда {i}")).await;
        first.get_or_insert(id);
    }
    let r = c.post("/api/v1/teams", json!({ "name": "Шестая" })).await;
    assert_eq!(r.status, StatusCode::CONFLICT, "{}", r.body);
    assert!(message(&r).contains("не больше 5"), "{}", message(&r));

    // архив места не освобождает
    c.ok(c.post(&format!("/api/v1/teams/{}/archive", first.unwrap()), json!({})).await, StatusCode::OK).await;
    assert_eq!(c.post("/api/v1/teams", json!({ "name": "Шестая" })).await.status, StatusCode::CONFLICT);

    // у другого человека счёт свой; команда, в которую позвали, в счёт создателя не идёт
    let other = c.another("other@example.com", "Другой").await;
    create_team(&other, "Своя").await;
    let team = create_team(&other, "Ещё своя").await;
    add_member(&other, team, &c, "member").await;
    assert_eq!(c.post("/api/v1/teams", json!({ "name": "Шестая" })).await.status, StatusCode::CONFLICT);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn the_limit_can_be_set_by_the_server(pool: PgPool) {
    let dir = TestDir::new();
    let app = api::router(api::AppState::new(pool.clone(), SECRET).with_data_dir(&dir.0).with_max_teams_per_user(1));
    make_user(&pool, "solo@example.com", "Одиночка", "test-password").await;
    let token = str_field(&login_ok(&app, "solo@example.com", "test-password").await, "access_token").to_owned();
    let post = |name: &'static str| {
        let app = app.clone();
        let token = token.clone();
        async move {
            send(&app, axum::http::Method::POST, "/api/v1/teams", Some(json!({ "name": name })), Some(&token))
                .await
                .status
        }
    };
    assert_eq!(post("Первая").await, StatusCode::CREATED);
    assert_eq!(post("Вторая").await, StatusCode::CONFLICT);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn only_the_admin_renames_the_team_and_sees_who_is_in_it_with_emails(pool: PgPool) {
    let lead = Ctx::new(pool).await;
    let dev = lead.another("dev@example.com", "Разработчик").await;
    let team = create_team(&lead, "Веб").await;
    add_member(&lead, team, &dev, "member").await;
    let uri = format!("/api/v1/teams/{team}");

    let renamed = lead.patch(&uri, json!({ "name": "Веб-студия" })).await;
    assert_eq!(renamed.status, StatusCode::OK, "{}", renamed.body);
    assert_eq!(renamed.body["name"], "Веб-студия");
    assert_eq!(lead.patch(&uri, json!({ "name": "" })).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(dev.patch(&uri, json!({ "name": "Взлом" })).await.status, StatusCode::FORBIDDEN);

    let for_lead = roster(&lead, team).await;
    assert_eq!(names(&for_lead["members"]), ["Тестер Т.", "Разработчик"], "администраторы первыми");
    assert_eq!(for_lead["members"][1]["email"], "dev@example.com");
    let for_dev = roster(&dev, team).await;
    assert_eq!(for_dev["members"][0]["email"], "", "e-mail администратора рядовому члену не показывают");
    assert_eq!(for_dev["members"][1]["email"], "dev@example.com", "свой виден");
    assert_eq!(for_dev["invites"], json!([]), "ожидающих приглашений рядовой член не видит");

    // команду с настройками видят только члены
    assert_eq!(dev.get(&uri).await.body["guests_read_wiki"], false);
    let out = lead.another("out@example.com", "Посторонний").await;
    assert_eq!(out.get(&uri).await.status, StatusCode::NOT_FOUND);
}

// ===== Приглашения =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn an_invitation_is_answered_by_the_invitee_and_checked_on_creation(pool: PgPool) {
    let lead = Ctx::new(pool).await;
    let artem = lead.another("artem@example.com", "Артём").await;
    let team = create_team(&lead, "Веб").await;
    let invites = format!("/api/v1/teams/{team}/invites");

    // не похоже на адрес: ошибка (адрес без аккаунта принимается, см. ожидающие регистрации ниже)
    let malformed = lead.post(&invites, json!({ "email": "nobody" })).await;
    assert_eq!((malformed.status, message(&malformed).as_str()), (StatusCode::BAD_REQUEST, "Некорректный e-mail"));
    assert_eq!(
        lead.post(&invites, json!({ "email": "artem@example.com", "role": "owner" })).await.status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        lead.post(&invites, json!({ "email": "tester@example.com" })).await.status,
        StatusCode::CONFLICT,
        "себя звать незачем"
    );

    // регистр e-mail не важен
    let r = lead.post(&invites, json!({ "email": " Artem@Example.com " })).await;
    assert_eq!(r.status, StatusCode::CREATED, "{}", r.body);
    assert_eq!(r.body["role"], "member");
    let again = lead.post(&invites, json!({ "email": "artem@example.com" })).await;
    assert_eq!((again.status, message(&again).as_str()), (StatusCode::CONFLICT, "Уже приглашён"));

    // приглашённый видит приглашение, команда ему пока не видна
    let mine = artem.ok(artem.get("/api/v1/team-invites").await, StatusCode::OK).await;
    assert_eq!(mine.as_array().unwrap().len(), 1);
    assert_eq!(mine[0]["team_name"], "Веб");
    assert_eq!(mine[0]["invited_by_name"], "Тестер Т.");
    assert_eq!(artem.get(&format!("/api/v1/teams/{team}")).await.status, StatusCode::NOT_FOUND);
    // а администратор видит ожидающего в составе
    let roster = lead.ok(lead.get(&format!("/api/v1/teams/{team}/members")).await, StatusCode::OK).await;
    assert_eq!(roster["invites"][0]["email"], "artem@example.com");

    // чужой и посторонний ответить не могут
    let id = id_of(&mine[0]);
    let out = lead.another("out@example.com", "Посторонний").await;
    assert_eq!(out.post(&format!("/api/v1/team-invites/{id}/accept"), json!({})).await.status, StatusCode::NOT_FOUND);
    assert_eq!(lead.post(&format!("/api/v1/team-invites/{id}/accept"), json!({})).await.status, StatusCode::NOT_FOUND);

    assert_eq!(
        artem.post(&format!("/api/v1/team-invites/{id}/accept"), json!({})).await.status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(artem.get("/api/v1/team-invites").await.body, json!([]));
    assert_eq!(team_names(&artem).await, ["Личное", "Веб"]);
    assert_eq!(artem.post(&format!("/api/v1/team-invites/{id}/accept"), json!({})).await.status, StatusCode::CONFLICT);
    let in_team = lead.post(&invites, json!({ "email": "artem@example.com" })).await;
    assert_eq!((in_team.status, message(&in_team).as_str()), (StatusCode::CONFLICT, "Уже в команде"));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn declined_and_revoked_invitations_give_nothing_and_an_admin_role_is_kept(pool: PgPool) {
    let lead = Ctx::new(pool).await;
    let artem = lead.another("artem@example.com", "Артём").await;
    let team = create_team(&lead, "Веб").await;
    let invites = format!("/api/v1/teams/{team}/invites");

    let r = lead.ok(lead.post(&invites, json!({ "email": "artem@example.com" })).await, StatusCode::CREATED).await;
    assert_eq!(
        artem.post(&format!("/api/v1/team-invites/{}/decline", id_of(&r)), json!({})).await.status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(team_names(&artem).await, ["Личное"]);
    assert_eq!(
        artem.post(&format!("/api/v1/team-invites/{}/decline", id_of(&r)), json!({})).await.status,
        StatusCode::CONFLICT
    );

    let r = lead.ok(lead.post(&invites, json!({ "email": "artem@example.com" })).await, StatusCode::CREATED).await;
    assert_eq!(lead.delete(&format!("/api/v1/team-invites/{}", id_of(&r))).await.status, StatusCode::NO_CONTENT);
    assert_eq!(lead.delete(&format!("/api/v1/team-invites/{}", id_of(&r))).await.status, StatusCode::CONFLICT);
    assert_eq!(artem.get("/api/v1/team-invites").await.body, json!([]));
    assert_eq!(
        artem.post(&format!("/api/v1/team-invites/{}/accept", id_of(&r)), json!({})).await.status,
        StatusCode::CONFLICT
    );

    // с ролью администратора
    add_member(&lead, team, &artem, "admin").await;
    assert_eq!(artem.get(&format!("/api/v1/teams/{team}")).await.body["role"], "admin");

    // приглашения не истекают и в «Личное» тоже можно
    let guest = lead.another("guest@example.com", "Гость").await;
    let r = lead.post(&format!("/api/v1/teams/{}/invites", lead.team), json!({ "email": "guest@example.com" })).await;
    assert_eq!(r.status, StatusCode::CREATED, "{}", r.body);
    assert_eq!(guest.get("/api/v1/team-invites").await.body.as_array().unwrap().len(), 1);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn a_guest_who_accepts_an_invitation_stops_being_a_guest_and_keeps_his_project_role(pool: PgPool) {
    let lead = Ctx::new(pool.clone()).await;
    let igor = lead.another("igor@example.com", "Игорь").await;
    let team = create_team(&lead, "Веб").await;
    let project = make_project_in(&pool, team, "members", "SITE", "Сайт", "accent").await;
    join(&pool, project, igor.user.id, "admin").await;

    let before = igor.ok(igor.get("/api/v1/teams").await, StatusCode::OK).await;
    assert_eq!(before[1]["guest"], true);
    add_member(&lead, team, &igor, "member").await;
    let after = igor.ok(igor.get("/api/v1/teams").await, StatusCode::OK).await;
    assert_eq!((after[1]["guest"].clone(), after[1]["role"].clone()), (json!(false), json!("member")));
    assert_eq!(after[1]["wiki"], true, "теперь вики команды читается как у члена");
    let seen = igor.ok(igor.get(&format!("/api/v1/projects/{project}/board")).await, StatusCode::OK).await;
    assert_eq!(seen["project"]["role"], "admin", "роль в проекте осталась");
    assert_eq!(seen["project"]["guest"], false);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn an_invitation_to_an_archived_team_is_hidden_and_cannot_be_accepted(pool: PgPool) {
    let lead = Ctx::new(pool).await;
    let artem = lead.another("artem@example.com", "Артём").await;
    let team = create_team(&lead, "Веб").await;
    let r = lead
        .ok(
            lead.post(&format!("/api/v1/teams/{team}/invites"), json!({ "email": "artem@example.com" })).await,
            StatusCode::CREATED,
        )
        .await;
    lead.ok(lead.post(&format!("/api/v1/teams/{team}/archive"), json!({})).await, StatusCode::OK).await;
    assert_eq!(artem.get("/api/v1/team-invites").await.body, json!([]));
    assert_eq!(
        artem.post(&format!("/api/v1/team-invites/{}/accept", id_of(&r)), json!({})).await.status,
        StatusCode::NOT_FOUND
    );
    lead.ok(lead.post(&format!("/api/v1/teams/{team}/restore"), json!({})).await, StatusCode::OK).await;
    assert_eq!(
        artem.get("/api/v1/team-invites").await.body.as_array().unwrap().len(),
        1,
        "после возврата приглашение снова ждёт"
    );
}

/// Приглашение на адрес без аккаунта ждёт регистрации: администратор его видит и может отозвать, а новый аккаунт с этим
/// адресом получает приглашение в «Приглашениях» (решает сам)
#[sqlx::test(migrator = "db::MIGRATOR")]
async fn an_invitation_to_an_address_without_an_account_waits_for_registration(pool: PgPool) {
    let lead = Ctx::new(pool).await;
    let team = create_team(&lead, "Веб").await;
    let invites = format!("/api/v1/teams/{team}/invites");

    // ответ тот же, что и для существующего аккаунта; регистр и пробелы не важны
    let r = lead.post(&invites, json!({ "email": " Newbie@Example.com ", "role": "admin" })).await;
    assert_eq!(r.status, StatusCode::CREATED, "{}", r.body);
    assert_eq!((r.body["user_id"].clone(), r.body["role"].clone()), (Value::Null, json!("admin")));
    let again = lead.post(&invites, json!({ "email": "newbie@example.com" })).await;
    assert_eq!((again.status, message(&again).as_str()), (StatusCode::CONFLICT, "Уже приглашён"));

    // администратор видит ожидающего: имя заменено адресом, отметка «аккаунта нет»
    let before = roster(&lead, team).await;
    let waiting = &before["invites"][0];
    assert_eq!(
        (waiting["email"].clone(), waiting["name"].clone(), waiting["registered"].clone(), waiting["user_id"].clone()),
        (json!("newbie@example.com"), json!("newbie@example.com"), json!(false), Value::Null)
    );
    // отозвать можно как обычное
    let other = lead.post(&invites, json!({ "email": "revoked@example.com" })).await;
    assert_eq!(lead.delete(&format!("/api/v1/team-invites/{}", id_of(&other.body))).await.status, StatusCode::NO_CONTENT);

    // аккаунт создан: приглашение у него, отозванного нет, роль та, что указал администратор
    let newbie = lead.another("newbie@example.com", "Новичок").await;
    let revoked = lead.another("revoked@example.com", "Отозванный").await;
    let mine = newbie.ok(newbie.get("/api/v1/team-invites").await, StatusCode::OK).await;
    assert_eq!(mine.as_array().unwrap().len(), 1);
    assert_eq!((mine[0]["team_name"].clone(), mine[0]["role"].clone()), (json!("Веб"), json!("admin")));
    assert_eq!(mine[0]["invited_by_name"], "Тестер Т.");
    assert_eq!(newbie.get(&format!("/api/v1/teams/{team}")).await.status, StatusCode::NOT_FOUND, "пока не принял, команды нет");
    let accepted = newbie.post(&format!("/api/v1/team-invites/{}/accept", id_of(&mine[0])), json!({})).await;
    assert_eq!(accepted.status, StatusCode::NO_CONTENT, "{}", accepted.body);
    let after = roster(&lead, team).await;
    assert_eq!(after["invites"], json!([]));
    let admins: Vec<_> = after["members"].as_array().unwrap().iter().filter(|m| m["role"] == "admin").collect();
    assert_eq!(admins.len(), 2, "новичок вошёл администратором: {after}");
    assert!(revoked.get("/api/v1/team-invites").await.body.as_array().unwrap().is_empty());
}

// ===== Роли, выход и исключение =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn roles_are_changed_by_admins_only_and_the_last_admin_stays(pool: PgPool) {
    let lead = Ctx::new(pool).await;
    let dev = lead.another("dev@example.com", "Разработчик").await;
    let team = create_team(&lead, "Веб").await;
    add_member(&lead, team, &dev, "member").await;
    let uri = |user: Uuid| format!("/api/v1/teams/{team}/members/{user}");

    assert_eq!(lead.patch(&uri(dev.user.id), json!({ "role": "owner" })).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        dev.patch(&uri(dev.user.id), json!({ "role": "admin" })).await.status,
        StatusCode::FORBIDDEN,
        "себя повысить нельзя"
    );
    assert_eq!(lead.patch(&uri(Uuid::new_v4()), json!({ "role": "admin" })).await.status, StatusCode::NOT_FOUND);

    // единственного администратора не понизить, не убрать и ему не выйти
    let sole = lead.patch(&uri(lead.user.id), json!({ "role": "member" })).await;
    assert_eq!(sole.status, StatusCode::CONFLICT, "{}", sole.body);
    assert_eq!(lead.delete(&uri(lead.user.id)).await.status, StatusCode::CONFLICT);
    let leave = lead.post(&format!("/api/v1/teams/{team}/leave"), json!({})).await;
    assert_eq!(leave.status, StatusCode::CONFLICT);
    assert!(message(&leave).contains("единственный администратор"), "{}", message(&leave));

    // второй администратор снимает ограничение
    assert_eq!(lead.patch(&uri(dev.user.id), json!({ "role": "admin" })).await.status, StatusCode::NO_CONTENT);
    assert_eq!(dev.patch(&uri(lead.user.id), json!({ "role": "member" })).await.status, StatusCode::NO_CONTENT);
    // теперь единственный администратор dev
    assert_eq!(dev.delete(&uri(dev.user.id)).await.status, StatusCode::CONFLICT);
    assert_eq!(lead.delete(&uri(dev.user.id)).await.status, StatusCode::FORBIDDEN, "я уже рядовой член");
    // рядовой выходит свободно
    assert_eq!(lead.post(&format!("/api/v1/teams/{team}/leave"), json!({})).await.status, StatusCode::NO_CONTENT);
    assert_eq!(lead.get(&format!("/api/v1/teams/{team}")).await.status, StatusCode::NOT_FOUND);
    assert_eq!(
        lead.post(&format!("/api/v1/teams/{team}/leave"), json!({})).await.status,
        StatusCode::NOT_FOUND,
        "второй раз выходить некому"
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn the_owner_cannot_leave_be_removed_or_demoted_in_personal_but_guests_can_leave(pool: PgPool) {
    let owner = Ctx::new(pool).await;
    let friend = owner.another("friend@example.com", "Друг").await;
    let personal = owner.team;
    add_member(&owner, personal, &friend, "admin").await;
    let uri = |user: Uuid| format!("/api/v1/teams/{personal}/members/{user}");

    // у друга «Личное» владельца в списке своё «Личное» первым, а чужое помечено не его
    let friends = friend.ok(friend.get("/api/v1/teams").await, StatusCode::OK).await;
    assert_eq!(names(&friends), ["Личное", "Личное"]);
    assert_eq!((friends[0]["owner"].clone(), friends[0]["id"].clone()), (json!(true), json!(friend.team.to_string())));
    assert_eq!(
        (friends[1]["owner"].clone(), friends[1]["personal"].clone(), friends[1]["role"].clone()),
        (json!(false), json!(true), json!("admin"))
    );

    // даже при втором администраторе владелец защищён
    assert_eq!(friend.patch(&uri(owner.user.id), json!({ "role": "member" })).await.status, StatusCode::CONFLICT);
    assert_eq!(friend.delete(&uri(owner.user.id)).await.status, StatusCode::CONFLICT);
    let leave = owner.post(&format!("/api/v1/teams/{personal}/leave"), json!({})).await;
    assert_eq!(leave.status, StatusCode::CONFLICT);
    assert!(message(&leave).contains("Владелец"), "{}", message(&leave));
    // личную команду не архивируют
    let archive = owner.post(&format!("/api/v1/teams/{personal}/archive"), json!({})).await;
    assert_eq!(archive.status, StatusCode::CONFLICT, "{}", archive.body);

    // приглашённый администратор — обычный человек: его можно понизить, убрать, он может уйти
    assert_eq!(owner.patch(&uri(friend.user.id), json!({ "role": "member" })).await.status, StatusCode::NO_CONTENT);
    assert_eq!(friend.post(&format!("/api/v1/teams/{personal}/leave"), json!({})).await.status, StatusCode::NO_CONTENT);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn leaving_or_being_removed_takes_a_person_out_of_the_teams_projects_but_not_the_guests(pool: PgPool) {
    let lead = Ctx::new(pool.clone()).await;
    let dev = lead.another("dev@example.com", "Разработчик").await;
    let spare = lead.another("spare@example.com", "Запасной").await;
    let guest = lead.another("guest@example.com", "Гость").await;
    let team = create_team(&lead, "Веб").await;
    add_member(&lead, team, &dev, "member").await;
    add_member(&lead, team, &spare, "member").await;
    let open = make_project_in(&pool, team, "team", "OPEN", "Открытый", "accent").await;
    let closed = make_project_in(&pool, team, "members", "CLOSED", "Закрытый", "warn").await;
    let other_team_project = make_project_in(&pool, lead.team, "members", "MINE", "Из другой команды", "ok").await;
    for (project, user, role) in [
        (open, dev.user.id, "admin"),
        (closed, dev.user.id, "member"),
        (closed, guest.user.id, "member"),
        (other_team_project, dev.user.id, "member"),
        (closed, spare.user.id, "member"),
    ] {
        join(&pool, project, user, role).await;
    }
    assert_eq!(project_names(&dev).await, ["Открытый", "Закрытый", "Из другой команды"]);

    // выход: из команды и из явных участий в её проектах, но не из проекта другой команды (там dev гость)
    assert_eq!(dev.post(&format!("/api/v1/teams/{team}/leave"), json!({})).await.status, StatusCode::NO_CONTENT);
    assert_eq!(project_names(&dev).await, ["Из другой команды"]);
    let rows: i64 = db::sqlx::query_scalar("select count(*) from project_members where user_id = $1")
        .bind(dev.user.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(rows, 1, "осталось только гостевое участие в проекте другой команды");

    // исключение работает так же; гость команды не член и остаётся
    assert_eq!(
        lead.delete(&format!("/api/v1/teams/{team}/members/{}", spare.user.id)).await.status,
        StatusCode::NO_CONTENT
    );
    assert!(project_names(&spare).await.is_empty());
    assert_eq!(project_names(&guest).await, ["Закрытый"], "гостей из команды никто не убирает");
    assert_eq!(
        lead.delete(&format!("/api/v1/teams/{team}/members/{}", spare.user.id)).await.status,
        StatusCode::NOT_FOUND,
        "уже не член"
    );

    // вернуться можно только по новому приглашению, прежние проекты открывают их администраторы
    add_member(&lead, team, &dev, "member").await;
    assert!(project_names(&dev).await.contains(&"Открытый".to_owned()), "«Вся команда» открыта всем членам");
    assert!(!project_names(&dev).await.contains(&"Закрытый".to_owned()));
}

// ===== Архив =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn an_archived_team_disappears_for_everyone_and_the_admin_brings_it_back(pool: PgPool) {
    let lead = Ctx::new(pool.clone()).await;
    let dev = lead.another("dev@example.com", "Разработчик").await;
    let root = lead.another_admin("root@example.com", "Админ сервера").await;
    let team = create_team(&lead, "Веб").await;
    add_member(&lead, team, &dev, "member").await;
    let project = make_project_in(&pool, team, "team", "SITE", "Сайт", "accent").await;
    let uri = format!("/api/v1/teams/{team}");

    // рядовой архивировать не может
    assert_eq!(dev.post(&format!("{uri}/archive"), json!({})).await.status, StatusCode::FORBIDDEN);
    let archived = lead.ok(lead.post(&format!("{uri}/archive"), json!({})).await, StatusCode::OK).await;
    assert_eq!(archived["archived"], true);

    // исчезла из списков, проекты и вики недоступны, данные целы
    assert_eq!(team_names(&lead).await, ["Личное"]);
    assert_eq!(team_names(&dev).await, ["Личное"]);
    assert_eq!(lead.get(&uri).await.status, StatusCode::NOT_FOUND);
    assert_eq!(dev.get(&format!("/api/v1/projects/{project}/board")).await.status, StatusCode::NOT_FOUND);
    assert_eq!(lead.get(&format!("{uri}/wiki")).await.status, StatusCode::NOT_FOUND);
    // в архиве её видит только тот, кто ею управляет
    assert_eq!(names(&lead.get("/api/v1/teams?archived=true").await.body), ["Веб"]);
    assert_eq!(dev.get("/api/v1/teams?archived=true").await.body, json!([]));
    // вернуть может администратор команды; рядовой не видит и такого адреса
    assert_eq!(dev.post(&format!("{uri}/restore"), json!({})).await.status, StatusCode::NOT_FOUND);
    let back = lead.ok(lead.post(&format!("{uri}/restore"), json!({})).await, StatusCode::OK).await;
    assert_eq!(back["archived"], false);
    assert_eq!(team_names(&dev).await, ["Личное", "Веб"]);
    assert_eq!(dev.get(&format!("/api/v1/projects/{project}/board")).await.status, StatusCode::OK);

    // администратор сервера видит и возвращает любую
    lead.ok(lead.post(&format!("{uri}/archive"), json!({})).await, StatusCode::OK).await;
    assert_eq!(root.get(&uri).await.status, StatusCode::OK);
    root.ok(root.post(&format!("{uri}/restore"), json!({})).await, StatusCode::OK).await;
    assert_eq!(team_names(&dev).await, ["Личное", "Веб"]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn the_admin_lets_guests_read_the_wiki_and_only_the_admin_does(pool: PgPool) {
    let lead = Ctx::new(pool.clone()).await;
    let dev = lead.another("dev@example.com", "Разработчик").await;
    let guest = lead.another("guest@example.com", "Гость").await;
    let team = create_team(&lead, "Веб").await;
    add_member(&lead, team, &dev, "member").await;
    let project = make_project_in(&pool, team, "members", "SITE", "Сайт", "accent").await;
    join(&pool, project, guest.user.id, "member").await;
    let uri = format!("/api/v1/teams/{team}");
    lead.ok(lead.post(&format!("{uri}/wiki"), json!({ "title": "Для своих" })).await, StatusCode::CREATED).await;

    assert_eq!(guest.get(&format!("{uri}/wiki")).await.status, StatusCode::NOT_FOUND);
    assert_eq!(dev.patch(&uri, json!({ "guests_read_wiki": true })).await.status, StatusCode::FORBIDDEN);
    let on = lead.ok(lead.patch(&uri, json!({ "guests_read_wiki": true })).await, StatusCode::OK).await;
    assert_eq!(on["guests_read_wiki"], true);
    assert_eq!(guest.get(&format!("{uri}/wiki")).await.status, StatusCode::OK);
    assert_eq!(guest.get("/api/v1/teams").await.body[1]["wiki"], true);
    lead.ok(lead.patch(&uri, json!({ "guests_read_wiki": false })).await, StatusCode::OK).await;
    assert_eq!(guest.get(&format!("{uri}/wiki")).await.status, StatusCode::NOT_FOUND);

    // и в «Личном» настройка есть
    let own = lead
        .ok(
            lead.patch(&format!("/api/v1/teams/{}", lead.team), json!({ "guests_read_wiki": true })).await,
            StatusCode::OK,
        )
        .await;
    assert_eq!(own["guests_read_wiki"], true);
}

// ===== Видимость проекта и состав =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn the_visibility_is_switched_by_the_project_admin_after_a_count_of_affected_people(pool: PgPool) {
    let lead = Ctx::new(pool.clone()).await;
    let d1 = lead.another("d1@example.com", "Первый").await;
    let d2 = lead.another("d2@example.com", "Второй").await;
    let d3 = lead.another("d3@example.com", "Третий").await;
    let team = create_team(&lead, "Веб").await;
    for d in [&d1, &d2, &d3] {
        add_member(&lead, team, d, "member").await;
    }
    let created = lead
        .ok(lead.post("/api/v1/projects", json!({ "team_id": team, "name": "Сайт" })).await, StatusCode::CREATED)
        .await;
    let project = id_of(&created);
    join(&pool, project, d3.user.id, "member").await;
    let uri = format!("/api/v1/projects/{project}");

    // «Только участники»: Третий в списке, Первый и Второй не видят проект
    assert_eq!(d1.get(&format!("{uri}/board")).await.status, StatusCode::NOT_FOUND);
    let up = impact(&lead, project, "team").await;
    assert_eq!(
        (up.status, up.body["people"].clone(), up.body["to"].clone()),
        (StatusCode::OK, json!(2), json!("team"))
    );
    assert_eq!(impact(&lead, project, "members").await.body["people"], 0, "уже «Только участники»: менять нечего");
    assert_eq!(impact(&lead, project, "everyone").await.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        d3.get(&format!("{uri}/visibility-impact?to=team")).await.status,
        StatusCode::FORBIDDEN,
        "участник не администратор"
    );

    // менять может только администратор проекта
    assert_eq!(d3.patch(&uri, json!({ "visibility": "team" })).await.status, StatusCode::FORBIDDEN);
    assert_eq!(lead.patch(&uri, json!({ "visibility": "nobody" })).await.status, StatusCode::BAD_REQUEST);
    let changed = lead.ok(lead.patch(&uri, json!({ "visibility": "team" })).await, StatusCode::OK).await;
    assert_eq!(changed["visibility"], "team");
    assert_eq!(
        d1.get(&format!("{uri}/board")).await.body["project"]["role"],
        "member",
        "увидел и работает как участник"
    );
    assert_eq!(project_names(&d2).await, ["Сайт"]);

    // обратно: теряют доступ те, кого нет в списке; Третий (явный) и администратор команды остаются
    assert_eq!(impact(&lead, project, "members").await.body["people"], 2);
    lead.ok(lead.patch(&uri, json!({ "visibility": "members" })).await, StatusCode::OK).await;
    assert_eq!(d1.get(&format!("{uri}/board")).await.status, StatusCode::NOT_FOUND);
    assert_eq!(d2.get(&format!("{uri}/board")).await.status, StatusCode::NOT_FOUND);
    assert_eq!(d3.get(&format!("{uri}/board")).await.status, StatusCode::OK);
    assert_eq!(lead.get(&format!("{uri}/board")).await.status, StatusCode::OK);
    // название и видимость можно менять вместе
    let both = lead.ok(lead.patch(&uri, json!({ "name": "Сайт 2", "visibility": "team" })).await, StatusCode::OK).await;
    assert_eq!((both["name"].clone(), both["visibility"].clone()), (json!("Сайт 2"), json!("team")));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn the_member_list_of_a_project_shows_team_admins_and_the_whole_team_with_the_rules(pool: PgPool) {
    let lead = Ctx::new(pool.clone()).await;
    let dev = lead.another("dev@example.com", "Разработчик").await;
    let ann = lead.another("ann@example.com", "Анна").await;
    let guest = lead.another("guest@example.com", "Гость").await;
    let team = create_team(&lead, "Веб").await;
    add_member(&lead, team, &dev, "member").await;
    add_member(&lead, team, &ann, "member").await;
    let project = make_project_in(&pool, team, "team", "SITE", "Сайт", "accent").await;
    join(&pool, project, ann.user.id, "member").await;
    join(&pool, project, guest.user.id, "member").await;
    let uri = format!("/api/v1/projects/{project}");
    let row = |name: &str, role: &str, team_admin: bool, implicit: bool, email: &str| {
        (name.to_owned(), role.to_owned(), team_admin, implicit, email.to_owned())
    };

    // «Вся команда»: администратор команды (неявный, он создал команду, но в проекте не записан), Анна и Гость явные, Разработчик неявный
    let for_lead = project_rows(&lead, project).await;
    assert_eq!(
        for_lead,
        [
            row("Тестер Т.", "admin", true, true, "tester@example.com"),
            row("Анна", "member", false, false, "ann@example.com"),
            row("Гость", "member", false, false, "guest@example.com"),
            row("Разработчик", "member", false, true, "dev@example.com"),
        ]
    );
    // участник проекта e-mail чужих не видит, свой видит
    let for_ann = project_rows(&ann, project).await;
    assert_eq!(for_ann.iter().map(|r| r.4.as_str()).collect::<Vec<_>>(), ["", "ann@example.com", "", ""]);
    // гость видит тот же состав проекта (участники и команда), но не e-mail
    assert_eq!(project_rows(&guest, project).await.len(), 4);

    // повышение неявного создаёт явную запись без приглашения; убрать неявного нельзя; администратор команды всегда админ
    let dev_row = format!("{uri}/members/{}", dev.user.id);
    let remove = lead.delete(&dev_row).await;
    assert_eq!(remove.status, StatusCode::CONFLICT);
    assert!(message(&remove).contains("Доступ у всей команды"), "{}", message(&remove));
    assert_eq!(lead.patch(&dev_row, json!({ "role": "admin" })).await.status, StatusCode::NO_CONTENT);
    let after = project_rows(&lead, project).await;
    assert_eq!(
        after[0],
        row("Разработчик", "admin", false, false, "dev@example.com"),
        "явные администраторы первыми: {after:?}"
    );
    assert_eq!(
        lead.patch(&format!("{uri}/members/{}", lead.user.id), json!({ "role": "member" })).await.status,
        StatusCode::CONFLICT
    );
    let remove_admin = lead.delete(&format!("{uri}/members/{}", lead.user.id)).await;
    assert_eq!(remove_admin.status, StatusCode::CONFLICT, "администратор команды неявный, убрать нельзя");
    assert_eq!(lead.delete(&dev_row).await.status, StatusCode::NO_CONTENT, "явного убрать можно");
    assert_eq!(
        lead.patch(&format!("{uri}/members/{}", Uuid::new_v4()), json!({ "role": "admin" })).await.status,
        StatusCode::NOT_FOUND
    );

    // «Только участники»: неявные члены команды из списка уходят, администратор команды остаётся
    lead.ok(lead.patch(&uri, json!({ "visibility": "members" })).await, StatusCode::OK).await;
    let closed = project_rows(&lead, project).await;
    assert_eq!(closed.iter().map(|r| r.0.as_str()).collect::<Vec<_>>(), ["Тестер Т.", "Анна", "Гость"]);
    assert_eq!(
        lead.patch(&dev_row, json!({ "role": "admin" })).await.status,
        StatusCode::NOT_FOUND,
        "не в списке и не по команде"
    );
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn inviting_someone_who_already_sees_the_project_is_refused(pool: PgPool) {
    let lead = Ctx::new(pool.clone()).await;
    let dev = lead.another("dev@example.com", "Разработчик").await;
    let team = create_team(&lead, "Веб").await;
    add_member(&lead, team, &dev, "member").await;
    let project = make_project_in(&pool, team, "team", "SITE", "Сайт", "accent").await;
    let r = lead.post(&format!("/api/v1/projects/{project}/invites"), json!({ "email": "dev@example.com" })).await;
    assert_eq!(
        (r.status, message(&r).as_str()),
        (StatusCode::CONFLICT, "Уже в проекте"),
        "член команды в «Вся команда»"
    );
    let closed = make_project_in(&pool, team, "members", "PRIV", "Закрытый", "warn").await;
    let r = lead.post(&format!("/api/v1/projects/{closed}/invites"), json!({ "email": "dev@example.com" })).await;
    assert_eq!(r.status, StatusCode::CREATED, "в закрытый проект члена команды позвать можно: он его не видит");
}

// ===== Администратор сервера =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn the_server_admin_lists_all_teams_and_finds_them_by_name_or_owner(pool: PgPool) {
    let lead = Ctx::new(pool.clone()).await;
    let root = lead.another_admin("root@example.com", "Админ сервера").await;
    let dev = lead.another("dev@example.com", "Разработчик").await;
    let team = create_team(&dev, "Веб-студия").await;
    make_project_in(&pool, team, "members", "SITE", "Сайт", "accent").await;

    let all = root.ok(root.get("/api/v1/admin/teams").await, StatusCode::OK).await;
    assert_eq!(names(&all), ["Веб-студия", "Личное", "Личное", "Личное"], "обычные первыми");
    assert_eq!(
        (all[0]["member_count"].clone(), all[0]["project_count"].clone(), all[0]["personal"].clone()),
        (json!(1), json!(1), json!(false))
    );
    assert_eq!(all[1]["owner_name"], "Тестер Т.");

    let by_name = root.ok(root.get("/api/v1/admin/teams?q=%D0%B2%D0%B5%D0%B1").await, StatusCode::OK).await;
    assert_eq!(names(&by_name), ["Веб-студия"]);
    let by_owner = root.ok(root.get("/api/v1/admin/teams?q=dev%40").await, StatusCode::OK).await;
    assert_eq!(by_owner.as_array().unwrap().len(), 1);
    assert_eq!(by_owner[0]["owner_name"], "Разработчик");

    // чужую команду администратор сервера открывает обычными адресами и управляет ею
    assert_eq!(root.get(&format!("/api/v1/teams/{team}/members")).await.status, StatusCode::OK);
    assert_eq!(root.patch(&format!("/api/v1/teams/{team}"), json!({ "name": "Веб" })).await.status, StatusCode::OK);
    // а в его собственном списке команд только его
    assert_eq!(team_names(&root).await, ["Личное"]);
    assert_eq!(lead.get("/api/v1/admin/teams").await.status, StatusCode::FORBIDDEN);
}

// ===== События =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn team_events_name_their_audience(pool: PgPool) {
    let lead = Ctx::new(pool.clone()).await;
    let dev = lead.another("dev@example.com", "Разработчик").await;
    let guest = lead.another("guest@example.com", "Гость").await;
    let mut rx = lead.events.subscribe();
    let audiences =
        |rx: &mut tokio::sync::broadcast::Receiver<std::sync::Arc<api::Event>>| -> Vec<(&'static str, Audience)> {
            let mut out = Vec::new();
            while let Ok(e) = rx.try_recv() {
                out.push((e.kind, e.audience.clone()));
            }
            out
        };

    // создание: событие самой команде, создатель попадает в её аудиторию после пересчёта
    let team = create_team(&lead, "Веб").await;
    assert_eq!(audiences(&mut rx), [("team.changed", Audience::Team(team))]);

    // приглашение: команде «что-то изменилось», приглашённому личное событие
    let invite = lead
        .ok(
            lead.post(&format!("/api/v1/teams/{team}/invites"), json!({ "email": "dev@example.com" })).await,
            StatusCode::CREATED,
        )
        .await;
    let sent = audiences(&mut rx);
    assert!(sent.contains(&("team.changed", Audience::Team(team))), "{sent:?}");
    assert!(sent.contains(&("team-invite.changed", Audience::Users(vec![dev.user.id]))), "{sent:?}");
    assert!(
        !sent.contains(&("team-invite.changed", Audience::Team(team))),
        "приглашение не для всей команды: {sent:?}"
    );

    // принял: человек получает событие лично, ведь членом он стал только сейчас
    dev.post(&format!("/api/v1/team-invites/{}/accept", id_of(&invite)), json!({})).await;
    let accepted = audiences(&mut rx);
    assert!(accepted.contains(&("team.changed", Audience::Users(vec![dev.user.id]))), "{accepted:?}");
    assert!(accepted.contains(&("team.changed", Audience::Team(team))), "{accepted:?}");

    // настройка для гостей: гость получает событие лично, в аудиторию команды он не входит
    let project = make_project_in(&pool, team, "members", "SITE", "Сайт", "accent").await;
    join(&pool, project, guest.user.id, "member").await;
    audiences(&mut rx);
    lead.ok(lead.patch(&format!("/api/v1/teams/{team}"), json!({ "guests_read_wiki": true })).await, StatusCode::OK)
        .await;
    let toggled = audiences(&mut rx);
    assert!(toggled.contains(&("team.changed", Audience::Users(vec![guest.user.id]))), "{toggled:?}");

    // исключение: убранному личное событие, он уже не в аудитории команды
    lead.delete(&format!("/api/v1/teams/{team}/members/{}", dev.user.id)).await;
    let removed = audiences(&mut rx);
    assert!(removed.contains(&("team.changed", Audience::Users(vec![dev.user.id]))), "{removed:?}");
    assert!(removed.contains(&("project.changed", Audience::Users(vec![dev.user.id]))), "{removed:?}");

    // архив: все члены и гости получают личное событие
    lead.ok(lead.post(&format!("/api/v1/teams/{team}/archive"), json!({})).await, StatusCode::OK).await;
    let archived = audiences(&mut rx);
    let to_users = archived.iter().filter_map(|(k, a)| match (k, a) {
        (&"team.changed", Audience::Users(u)) => Some(u.clone()),
        _ => None,
    });
    let mut notified: Vec<Uuid> = to_users.flatten().collect();
    notified.sort();
    let mut expected = vec![lead.user.id, guest.user.id];
    expected.sort();
    assert_eq!(notified, expected, "{archived:?}");
}
