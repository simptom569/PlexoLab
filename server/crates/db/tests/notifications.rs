//! Уведомления на настоящем Postgres: ограничения таблицы, замена повторных «назначили», очистка при создании нового,
//! видимость в списке (участие, архив), отметки о прочтении, каскады и обратная миграция
//! (docs/OFFLINE-NOTIFY-SEARCH.md, раздел 2).

use db::{PgPool, comments, notifications};
use uuid::Uuid;

const DOWN: &str = include_str!("../../../migrations_down/0017_notifications.down.sql");

async fn exec(pool: &PgPool, sql: &str) {
    sqlx::query(sqlx::AssertSqlSafe(sql.to_owned())).execute(pool).await.unwrap();
}

async fn count(pool: &PgPool, sql: &str) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(sql.to_owned())).fetch_one(pool).await.unwrap()
}

async fn user(pool: &PgPool, email: &str, name: &str) -> Uuid {
    sqlx::query_scalar("insert into users (email, name, password_hash) values ($1, $2, 'h') returning id")
        .bind(email)
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Проект WEB, в нём двое участников (Лена получает уведомления, Артём их создаёт), задача и комментарий Артёма
struct World {
    lena: Uuid,
    artem: Uuid,
    project: Uuid,
    task: Uuid,
    comment: Uuid,
}

async fn world(pool: &PgPool) -> World {
    let lena = user(pool, "lena@example.com", "Лена М.").await;
    let artem = user(pool, "artem@example.com", "Артём К.").await;
    let project: Uuid = sqlx::query_scalar("insert into projects (team_id, key, name, color) values ((select id from teams where name = 'Тест'), 'WEB', 'Web', 'accent') returning id")
        .fetch_one(pool)
        .await
        .unwrap();
    for u in [lena, artem] {
        sqlx::query("insert into project_members (project_id, user_id) values ($1, $2)")
            .bind(project)
            .bind(u)
            .execute(pool)
            .await
            .unwrap();
    }
    let task = add_task(pool, project, 1, "Экспорт отчёта").await;
    let comment = add_comment(pool, task, artem, "Посмотри").await;
    World { lena, artem, project, task, comment }
}

async fn add_task(pool: &PgPool, project: Uuid, number: i32, title: &str) -> Uuid {
    sqlx::query_scalar("insert into tasks (project_id, number, title, position) values ($1, $2, $3, 1) returning id")
        .bind(project)
        .bind(number)
        .bind(title)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn add_comment(pool: &PgPool, task: Uuid, author: Uuid, body: &str) -> Uuid {
    sqlx::query_scalar("insert into comments (task_id, author_id, body) values ($1, $2, $3) returning id")
        .bind(task)
        .bind(author)
        .bind(body)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn assigned(pool: &PgPool, w: &World, task: Uuid) -> notifications::Notification {
    let mut conn = pool.acquire().await.unwrap();
    notifications::insert_assigned(&mut conn, w.lena, w.artem, w.project, task).await.unwrap()
}

async fn mentioned(pool: &PgPool, w: &World, comment: Uuid) -> notifications::Notification {
    let mut conn = pool.acquire().await.unwrap();
    notifications::insert_mentioned(&mut conn, w.lena, w.artem, w.project, w.task, comment).await.unwrap()
}

// ===== Таблица =====

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn the_kind_and_the_comment_go_together(pool: PgPool) {
    let w = world(&pool).await;
    // «упомянули» без комментария и «назначили» с комментарием не бывают
    let bad = [
        ("mentioned", None::<Uuid>),
        ("assigned", Some(w.comment)),
    ];
    for (kind, comment) in bad {
        let r = sqlx::query(
            "insert into notifications (user_id, kind, project_id, task_id, comment_id) values ($1, $2::notification_kind, $3, $4, $5)",
        )
        .bind(w.lena)
        .bind(kind)
        .bind(w.project)
        .bind(w.task)
        .bind(comment)
        .execute(&pool)
        .await;
        assert!(r.is_err(), "{kind} / {comment:?}");
    }
    // а правильные пары принимаются
    assigned(&pool, &w, w.task).await;
    mentioned(&pool, &w, w.comment).await;
    assert_eq!(count(&pool, "select count(*) from notifications").await, 2);
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn unknown_kind_is_refused(pool: PgPool) {
    let w = world(&pool).await;
    let r = sqlx::query("insert into notifications (user_id, kind, project_id, task_id) values ($1, 'other', $2, $3)")
        .bind(w.lena)
        .bind(w.project)
        .bind(w.task)
        .execute(&pool)
        .await;
    assert!(r.is_err());
}

// ===== Комментарий и упомянутые =====

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn a_comment_keeps_the_list_of_mentioned_people(pool: PgPool) {
    let w = world(&pool).await;
    let mut conn = pool.acquire().await.unwrap();
    let saved = comments::insert(&mut conn, w.task, w.artem, &format!("@[{}] глянь", w.lena), &[w.lena]).await.unwrap();
    assert_eq!(saved.mentions, vec![w.lena]);
    let plain = comments::insert(&mut conn, w.task, w.artem, "без упоминаний", &[]).await.unwrap();
    assert!(plain.mentions.is_empty());

    let listed = comments::list(&mut *conn, w.task).await.unwrap();
    let by_id = |id: Uuid| listed.iter().find(|c| c.id == id).unwrap();
    assert_eq!(by_id(saved.id).mentions, vec![w.lena]);
    assert!(by_id(plain.id).mentions.is_empty());
    // комментарии, написанные до миграции, получают пустой список
    assert!(by_id(w.comment).mentions.is_empty());
}

// ===== Назначили =====

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn a_repeated_unread_assignment_of_the_same_task_replaces_the_old_one(pool: PgPool) {
    let w = world(&pool).await;
    let first = assigned(&pool, &w, w.task).await;
    let second = assigned(&pool, &w, w.task).await;
    assert_ne!(first.id, second.id);
    assert_eq!(count(&pool, "select count(*) from notifications").await, 1);
    assert_eq!(count(&pool, &format!("select count(*) from notifications where id = '{}'", second.id)).await, 1);
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn a_read_assignment_stays_and_a_new_one_is_added(pool: PgPool) {
    let w = world(&pool).await;
    let first = assigned(&pool, &w, w.task).await;
    assert!(notifications::mark_read(&pool, w.lena, first.id).await.unwrap());
    assigned(&pool, &w, w.task).await;
    assert_eq!(count(&pool, "select count(*) from notifications").await, 2);
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn assignments_of_different_tasks_or_people_do_not_replace_each_other(pool: PgPool) {
    let w = world(&pool).await;
    let other_task = add_task(&pool, w.project, 2, "Другая").await;
    assigned(&pool, &w, w.task).await;
    assigned(&pool, &w, other_task).await;
    let mut conn = pool.acquire().await.unwrap();
    notifications::insert_assigned(&mut conn, w.artem, w.lena, w.project, w.task).await.unwrap();
    assert_eq!(count(&pool, "select count(*) from notifications").await, 3);
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn every_mention_is_its_own_notification(pool: PgPool) {
    let w = world(&pool).await;
    let second = add_comment(&pool, w.task, w.artem, "Ещё раз").await;
    mentioned(&pool, &w, w.comment).await;
    mentioned(&pool, &w, second).await;
    assert_eq!(count(&pool, "select count(*) from notifications").await, 2);
}

// ===== Очистка =====

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn creating_a_new_one_removes_old_read_ones_only(pool: PgPool) {
    let w = world(&pool).await;
    let other_task = add_task(&pool, w.project, 2, "Другая").await;
    let old_read = assigned(&pool, &w, w.task).await;
    let young_read = mentioned(&pool, &w, w.comment).await;
    let old_unread = {
        let third = add_comment(&pool, w.task, w.artem, "Давно").await;
        mentioned(&pool, &w, third).await
    };
    let days = notifications::READ_KEEP_DAYS;
    exec(&pool, &format!("update notifications set read_at = now() - interval '{} days' where id = '{}'", days + 1, old_read.id)).await;
    exec(&pool, &format!("update notifications set read_at = now() - interval '{} days' where id = '{}'", days - 1, young_read.id)).await;
    exec(&pool, &format!("update notifications set created_at = now() - interval '90 days' where id = '{}'", old_unread.id)).await;

    assigned(&pool, &w, other_task).await; // новое уведомление запускает очистку

    let left: Vec<Uuid> = sqlx::query_scalar("select id from notifications where user_id = $1").bind(w.lena).fetch_all(&pool).await.unwrap();
    assert!(!left.contains(&old_read.id), "прочитанное давно убрано");
    assert!(left.contains(&young_read.id), "прочитанное недавно осталось");
    assert!(left.contains(&old_unread.id), "непрочитанное не убирается по возрасту");
    assert_eq!(left.len(), 3);
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn only_the_newest_ones_are_kept_per_person(pool: PgPool) {
    let w = world(&pool).await;
    // 250 старых упоминаний одного человека и одно упоминание другого
    exec(
        &pool,
        &format!(
            "insert into notifications (user_id, kind, project_id, task_id, comment_id, created_at) \
             select '{lena}', 'mentioned', '{p}', '{t}', '{c}', now() - make_interval(mins => g) from generate_series(10, 259) g",
            lena = w.lena,
            p = w.project,
            t = w.task,
            c = w.comment
        ),
    )
    .await;
    exec(
        &pool,
        &format!(
            "insert into notifications (user_id, kind, project_id, task_id, comment_id) values ('{}', 'mentioned', '{}', '{}', '{}')",
            w.artem, w.project, w.task, w.comment
        ),
    )
    .await;
    let newest: Uuid = sqlx::query_scalar("select id from notifications where user_id = $1 order by created_at desc limit 1")
        .bind(w.lena)
        .fetch_one(&pool)
        .await
        .unwrap();

    let fresh = mentioned(&pool, &w, w.comment).await;

    let mine = count(&pool, &format!("select count(*) from notifications where user_id = '{}'", w.lena)).await;
    assert_eq!(mine, notifications::KEEP_PER_USER);
    let kept: Vec<Uuid> = sqlx::query_scalar("select id from notifications where user_id = $1").bind(w.lena).fetch_all(&pool).await.unwrap();
    assert!(kept.contains(&fresh.id) && kept.contains(&newest), "остаются самые новые");
    let oldest_kept: i64 = count(
        &pool,
        &format!("select count(*) from notifications where user_id = '{}' and created_at < now() - interval '255 minutes'", w.lena),
    )
    .await;
    assert_eq!(oldest_kept, 0, "самые старые убраны");
    assert_eq!(count(&pool, &format!("select count(*) from notifications where user_id = '{}'", w.artem)).await, 1, "чужие не тронуты");
}

// ===== Список =====

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn the_list_carries_task_project_actor_and_the_comment(pool: PgPool) {
    let w = world(&pool).await;
    assigned(&pool, &w, w.task).await;
    mentioned(&pool, &w, w.comment).await;

    let list = notifications::list(&pool, w.lena, 50).await.unwrap();
    assert_eq!(list.len(), 2);
    let first = &list[0]; // новые первыми
    assert_eq!(first.notification.kind, "mentioned");
    assert_eq!(first.comment_body.as_deref(), Some("Посмотри"));
    assert_eq!(first.actor_name.as_deref(), Some("Артём К."));
    assert_eq!((first.task_number, first.task_title.as_str()), (1, "Экспорт отчёта"));
    assert_eq!((first.project_key.as_deref(), first.project_name.as_str()), (Some("WEB"), "Web"));
    assert_eq!(list[1].notification.kind, "assigned");
    assert!(list[1].comment_body.is_none());
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn a_task_in_a_module_with_a_key_carries_the_key_of_its_series(pool: PgPool) {
    let w = world(&pool).await;
    let module: Uuid = sqlx::query_scalar("insert into modules (project_id, title, key) values ($1, 'SEO', 'SEO') returning id")
        .bind(w.project)
        .fetch_one(&pool)
        .await
        .unwrap();
    // номер 2: первый уже занят задачей из мира, а в ряд модуля задача переедет следом
    let task = add_task(&pool, w.project, 2, "В модуле").await;
    sqlx::query("update tasks set module_id = $1, series_module_id = $1 where id = $2").bind(module).bind(task).execute(&pool).await.unwrap();
    assigned(&pool, &w, task).await;
    let list = notifications::list(&pool, w.lena, 50).await.unwrap();
    assert_eq!(list[0].series_key.as_deref(), Some("SEO"));
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn the_limit_cuts_the_list_but_not_the_counter(pool: PgPool) {
    let w = world(&pool).await;
    for n in 0..5 {
        let comment = add_comment(&pool, w.task, w.artem, &format!("к{n}")).await;
        mentioned(&pool, &w, comment).await;
    }
    assert_eq!(notifications::list(&pool, w.lena, 3).await.unwrap().len(), 3);
    assert_eq!(notifications::unread_count(&pool, w.lena).await.unwrap(), 5);
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn leaving_the_project_hides_its_notifications_and_returning_shows_them_again(pool: PgPool) {
    let w = world(&pool).await;
    assigned(&pool, &w, w.task).await;
    exec(&pool, &format!("delete from project_members where user_id = '{}'", w.lena)).await;
    assert!(notifications::list(&pool, w.lena, 50).await.unwrap().is_empty());
    assert_eq!(notifications::unread_count(&pool, w.lena).await.unwrap(), 0);

    exec(&pool, &format!("insert into project_members (project_id, user_id) values ('{}', '{}')", w.project, w.lena)).await;
    assert_eq!(notifications::list(&pool, w.lena, 50).await.unwrap().len(), 1);
    assert_eq!(notifications::unread_count(&pool, w.lena).await.unwrap(), 1);
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn notifications_of_an_archived_project_are_hidden(pool: PgPool) {
    let w = world(&pool).await;
    assigned(&pool, &w, w.task).await;
    exec(&pool, &format!("update projects set archived_at = now() where id = '{}'", w.project)).await;
    assert!(notifications::list(&pool, w.lena, 50).await.unwrap().is_empty());
    assert_eq!(notifications::unread_count(&pool, w.lena).await.unwrap(), 0);
    exec(&pool, &format!("update projects set archived_at = null where id = '{}'", w.project)).await;
    assert_eq!(notifications::list(&pool, w.lena, 50).await.unwrap().len(), 1);
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn the_list_and_the_counter_belong_to_their_owner(pool: PgPool) {
    let w = world(&pool).await;
    assigned(&pool, &w, w.task).await;
    assert!(notifications::list(&pool, w.artem, 50).await.unwrap().is_empty());
    assert_eq!(notifications::unread_count(&pool, w.artem).await.unwrap(), 0);
}

// ===== Прочитано =====

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn marking_read_works_for_the_owner_only_and_is_repeatable(pool: PgPool) {
    let w = world(&pool).await;
    let n = assigned(&pool, &w, w.task).await;
    assert!(!notifications::mark_read(&pool, w.artem, n.id).await.unwrap(), "чужое");
    assert!(!notifications::mark_read(&pool, w.lena, Uuid::new_v4()).await.unwrap(), "несуществующее");
    assert_eq!(notifications::unread_count(&pool, w.lena).await.unwrap(), 1);

    assert!(notifications::mark_read(&pool, w.lena, n.id).await.unwrap());
    assert_eq!(notifications::unread_count(&pool, w.lena).await.unwrap(), 0);
    let first: time::OffsetDateTime = sqlx::query_scalar("select read_at from notifications where id = $1").bind(n.id).fetch_one(&pool).await.unwrap();
    assert!(notifications::mark_read(&pool, w.lena, n.id).await.unwrap());
    let again: time::OffsetDateTime = sqlx::query_scalar("select read_at from notifications where id = $1").bind(n.id).fetch_one(&pool).await.unwrap();
    assert_eq!(first, again, "повторная отметка не двигает время");
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn mark_all_read_touches_only_my_unread_ones(pool: PgPool) {
    let w = world(&pool).await;
    let other_task = add_task(&pool, w.project, 2, "Другая").await;
    assigned(&pool, &w, w.task).await;
    assigned(&pool, &w, other_task).await;
    let mut conn = pool.acquire().await.unwrap();
    notifications::insert_assigned(&mut conn, w.artem, w.lena, w.project, w.task).await.unwrap();

    assert_eq!(notifications::mark_all_read(&pool, w.lena).await.unwrap(), 2);
    assert_eq!(notifications::mark_all_read(&pool, w.lena).await.unwrap(), 0, "второй раз отмечать нечего");
    assert_eq!(notifications::unread_count(&pool, w.lena).await.unwrap(), 0);
    assert_eq!(notifications::unread_count(&pool, w.artem).await.unwrap(), 1, "чужие не тронуты");
}

// ===== Каскады =====

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn deleting_the_task_the_project_or_the_recipient_removes_notifications(pool: PgPool) {
    let w = world(&pool).await;
    let other_task = add_task(&pool, w.project, 2, "Другая").await;
    assigned(&pool, &w, w.task).await;
    assigned(&pool, &w, other_task).await;

    exec(&pool, &format!("delete from tasks where id = '{}'", w.task)).await;
    assert_eq!(count(&pool, "select count(*) from notifications").await, 1, "вместе с задачей");

    exec(&pool, &format!("delete from users where id = '{}'", w.lena)).await;
    assert_eq!(count(&pool, "select count(*) from notifications").await, 0, "вместе с получателем");

    let w2 = world_again(&pool).await;
    assigned(&pool, &w2, w2.task).await;
    exec(&pool, &format!("delete from projects where id = '{}'", w2.project)).await;
    assert_eq!(count(&pool, "select count(*) from notifications").await, 0, "вместе с проектом");
}

async fn world_again(pool: &PgPool) -> World {
    let lena = user(pool, "lena2@example.com", "Лена Вторая").await;
    let artem = user(pool, "artem2@example.com", "Артём Второй").await;
    let project: Uuid = sqlx::query_scalar("insert into projects (team_id, key, name, color) values ((select id from teams where name = 'Тест'), 'API', 'Api', 'warn') returning id")
        .fetch_one(pool)
        .await
        .unwrap();
    let task = add_task(pool, project, 1, "Задача").await;
    let comment = add_comment(pool, task, artem, "Привет").await;
    World { lena, artem, project, task, comment }
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn deleting_the_author_keeps_the_notification_without_a_name(pool: PgPool) {
    let w = world(&pool).await;
    let task = add_task(&pool, w.project, 2, "Без автора").await;
    assigned(&pool, &w, task).await;
    // у комментария автор обязателен, поэтому убираем его комментарии вместе с ним
    exec(&pool, &format!("delete from comments where author_id = '{}'", w.artem)).await;
    exec(&pool, &format!("delete from users where id = '{}'", w.artem)).await;
    let list = notifications::list(&pool, w.lena, 50).await.unwrap();
    assert_eq!(list.len(), 1);
    assert!(list[0].notification.actor_id.is_none());
    assert!(list[0].actor_name.is_none());
}

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn deleting_the_comment_removes_the_mention_notification(pool: PgPool) {
    let w = world(&pool).await;
    mentioned(&pool, &w, w.comment).await;
    exec(&pool, &format!("delete from comments where id = '{}'", w.comment)).await;
    assert_eq!(count(&pool, "select count(*) from notifications").await, 0);
}

// ===== Обратная миграция =====

#[sqlx::test(migrator = "db::MIGRATOR", fixtures("team"))]
async fn down_migration_drops_notifications_but_keeps_comment_texts(pool: PgPool) {
    let w = world(&pool).await;
    let mut conn = pool.acquire().await.unwrap();
    let body = format!("@[{}] глянь", w.lena);
    comments::insert(&mut conn, w.task, w.artem, &body, &[w.lena]).await.unwrap();
    drop(conn);
    assigned(&pool, &w, w.task).await;

    sqlx::raw_sql(sqlx::AssertSqlSafe(DOWN.to_owned())).execute(&pool).await.expect("обратная миграция выполняется");

    assert_eq!(count(&pool, "select count(*) from information_schema.tables where table_name = 'notifications'").await, 0);
    assert_eq!(count(&pool, "select count(*) from information_schema.columns where table_name = 'comments' and column_name = 'mentions'").await, 0);
    assert_eq!(count(&pool, "select count(*) from pg_type where typname = 'notification_kind'").await, 0);
    let texts: Vec<String> = sqlx::query_scalar("select body from comments order by created_at, id").fetch_all(&pool).await.unwrap();
    assert!(texts.contains(&body), "текст комментария остался как был");
}
