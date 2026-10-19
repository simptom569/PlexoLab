//! Слой доски на настоящем Postgres: перенос задач и колонок, дробные позиции и их пересчёт, нумерация, метки.

use db::{
    PgPool, columns, projects,
    tags::{self},
    tasks::{self, NewTask, PlaceError, Task},
    users::{self, NewUser},
};
use uuid::Uuid;

struct Board {
    project: projects::Project,
    user: Uuid,
    columns: Vec<columns::Column>,
}

async fn board(pool: &PgPool) -> Board {
    let user = users::create(
        pool,
        &NewUser {
            email: "u@example.com".into(),
            name: "U".into(),
            role: String::new(),
            tone: 0,
            is_admin: false,
            password_hash: "x".into(),
        },
    )
    .await
    .unwrap();
    let project_id: Uuid =
        db::sqlx::query_scalar("insert into projects (key, name, color) values ('WEB', 'Web', 'accent') returning id")
            .fetch_one(pool)
            .await
            .unwrap();
    let project = projects::get(pool, project_id).await.unwrap().unwrap();
    let mut conn = pool.acquire().await.unwrap();
    let mut cols = Vec::new();
    for (title, done) in [("К выполнению", false), ("В работе", false), ("Готово", true)] {
        cols.push(columns::insert(&mut conn, project_id, title, "muted", done).await.unwrap());
    }
    Board { project, user: user.id, columns: cols }
}

/// Новая задача в конце колонки (None: бэклог), как это делает создание задачи
async fn add(pool: &PgPool, b: &Board, column: Option<Uuid>, title: &str) -> Task {
    let mut tx = pool.begin().await.unwrap();
    projects::lock(&mut tx, b.project.id).await.unwrap();
    let number = projects::next_number(&mut tx, b.project.id).await.unwrap();
    let position = tasks::next_position(&mut tx, b.project.id, column).await.unwrap();
    let task = tasks::insert(
        &mut tx,
        &NewTask {
            project_id: b.project.id,
            number,
            title: title.into(),
            column_id: column,
            position,
            created_by: b.user,
        },
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    task
}

async fn order(pool: &PgPool, b: &Board, column: Option<Uuid>) -> Vec<String> {
    db::sqlx::query_scalar(
        "select title from tasks where project_id = $1 and column_id is not distinct from $2 order by position, id",
    )
    .bind(b.project.id)
    .bind(column)
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn positions(pool: &PgPool, b: &Board, column: Option<Uuid>) -> Vec<f64> {
    db::sqlx::query_scalar(
        "select position from tasks where project_id = $1 and column_id is not distinct from $2 order by position, id",
    )
    .bind(b.project.id)
    .bind(column)
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn place(pool: &PgPool, task: &Task, column: Option<Uuid>, before: Option<Uuid>) -> Result<Task, PlaceError> {
    let mut tx = pool.begin().await.unwrap();
    projects::lock(&mut tx, task.project_id).await.unwrap();
    let moved = tasks::place(&mut tx, task, column, before).await?;
    tx.commit().await.unwrap();
    Ok(moved)
}

// ===== Номера и позиции новых задач =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn new_tasks_get_consecutive_numbers_and_end_positions(pool: PgPool) {
    let b = board(&pool).await;
    let col = Some(b.columns[0].id);
    let a = add(&pool, &b, col, "A").await;
    let c = add(&pool, &b, col, "C").await;
    let backlog = add(&pool, &b, None, "Б").await;

    assert_eq!((a.number, c.number, backlog.number), (1, 2, 3), "номер общий на проект, не на колонку");
    assert_eq!((a.position, c.position), (1024.0, 2048.0));
    assert_eq!(backlog.position, 1024.0, "у бэклога своя нумерация позиций");
    let project = projects::get(&pool, b.project.id).await.unwrap().unwrap();
    let last: i32 = db::sqlx::query_scalar("select last_number from projects where id = $1")
        .bind(project.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(last, 3);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn concurrent_creation_never_duplicates_numbers(pool: PgPool) {
    let b = std::sync::Arc::new(board(&pool).await);
    let handles: Vec<_> = (0..12)
        .map(|i| {
            let (pool, b) = (pool.clone(), b.clone());
            tokio::spawn(async move { add(&pool, &b, Some(b.columns[0].id), &format!("T{i}")).await })
        })
        .collect();
    let mut numbers = Vec::new();
    for h in handles {
        numbers.push(h.await.unwrap().number);
    }
    numbers.sort();
    assert_eq!(numbers, (1..=12).collect::<Vec<_>>());
    let mut positions = positions(&pool, &b, Some(b.columns[0].id)).await;
    positions.dedup();
    assert_eq!(positions.len(), 12, "и позиции у всех разные");
}

// ===== Перенос =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn place_reorders_inside_a_column(pool: PgPool) {
    let b = board(&pool).await;
    let col = Some(b.columns[0].id);
    let (x, y, z) = (add(&pool, &b, col, "X").await, add(&pool, &b, col, "Y").await, add(&pool, &b, col, "Z").await);

    place(&pool, &z, col, Some(x.id)).await.unwrap();
    assert_eq!(order(&pool, &b, col).await, ["Z", "X", "Y"], "перед первым");
    let x = tasks::get(&pool, x.id).await.unwrap().unwrap();
    place(&pool, &x, col, None).await.unwrap();
    assert_eq!(order(&pool, &b, col).await, ["Z", "Y", "X"], "в конец своей колонки");
    let z = tasks::get(&pool, z.id).await.unwrap().unwrap();
    place(&pool, &z, col, Some(x.id)).await.unwrap();
    assert_eq!(order(&pool, &b, col).await, ["Y", "Z", "X"], "между соседями");
    let _ = y;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn place_moves_between_columns_and_to_backlog(pool: PgPool) {
    let b = board(&pool).await;
    let (todo, doing) = (Some(b.columns[0].id), Some(b.columns[1].id));
    let a = add(&pool, &b, todo, "A").await;
    let c = add(&pool, &b, todo, "C").await;
    let d = add(&pool, &b, doing, "D").await;

    let moved = place(&pool, &a, doing, Some(d.id)).await.unwrap();
    assert_eq!(moved.column_id, doing);
    assert_eq!(order(&pool, &b, doing).await, ["A", "D"]);
    assert_eq!(order(&pool, &b, todo).await, ["C"], "из исходной колонки задача ушла");

    place(&pool, &c, None, None).await.unwrap();
    assert_eq!(order(&pool, &b, None).await, ["C"], "бэклог: column_id = null");
    assert_eq!(tasks::get(&pool, c.id).await.unwrap().unwrap().column_id, None);

    // и обратно с бэклога на доску
    let c = tasks::get(&pool, c.id).await.unwrap().unwrap();
    place(&pool, &c, todo, None).await.unwrap();
    assert_eq!(order(&pool, &b, todo).await, ["C"]);
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn place_before_a_task_from_another_column_is_rejected(pool: PgPool) {
    let b = board(&pool).await;
    let a = add(&pool, &b, Some(b.columns[0].id), "A").await;
    let d = add(&pool, &b, Some(b.columns[1].id), "D").await;

    let err = place(&pool, &a, Some(b.columns[0].id), Some(d.id)).await.unwrap_err();
    assert!(matches!(err, PlaceError::BeforeNotFound));
    let err = place(&pool, &a, Some(b.columns[0].id), Some(Uuid::new_v4())).await.unwrap_err();
    assert!(matches!(err, PlaceError::BeforeNotFound));
    assert_eq!(order(&pool, &b, Some(b.columns[0].id)).await, ["A"], "ничего не изменилось");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn place_recalculates_positions_when_the_gap_runs_out(pool: PgPool) {
    let b = board(&pool).await;
    let col = Some(b.columns[0].id);
    let first = add(&pool, &b, col, "first").await;
    let second = add(&pool, &b, col, "second").await;
    let third = add(&pool, &b, col, "third").await;
    let moved = add(&pool, &b, col, "moved").await;
    // между first и second почти нет места
    db::sqlx::query("update tasks set position = 1.0 where id = $1").bind(first.id).execute(&pool).await.unwrap();
    db::sqlx::query("update tasks set position = 1.0000015 where id = $1")
        .bind(second.id)
        .execute(&pool)
        .await
        .unwrap();
    db::sqlx::query("update tasks set position = 5.0 where id = $1").bind(third.id).execute(&pool).await.unwrap();

    place(&pool, &moved, col, Some(second.id)).await.unwrap();

    assert_eq!(order(&pool, &b, col).await, ["first", "moved", "second", "third"]);
    assert_eq!(positions(&pool, &b, col).await, [1024.0, 2048.0, 3072.0, 4096.0], "пересчитано с шагом 1024");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn many_insertions_into_the_same_gap_keep_the_order(pool: PgPool) {
    let b = board(&pool).await;
    let col = Some(b.columns[0].id);
    let head = add(&pool, &b, col, "head").await;
    let tail = add(&pool, &b, col, "tail").await;
    // 40 раз подряд вставляем новую задачу прямо перед tail: зазор делится пополам и в какой-то момент пересчитывается
    for i in 0..40 {
        let t = add(&pool, &b, col, &format!("n{i:02}")).await;
        place(&pool, &t, col, Some(tail.id)).await.unwrap();
    }
    let titles = order(&pool, &b, col).await;
    assert_eq!(titles.len(), 42);
    assert_eq!(titles.first().map(String::as_str), Some("head"));
    assert_eq!(titles.last().map(String::as_str), Some("tail"));
    let inserted: Vec<String> = (0..40).map(|i| format!("n{i:02}")).collect();
    assert_eq!(titles[1..41], inserted[..], "каждая новая встала перед tail, то есть после предыдущих");
    let positions = positions(&pool, &b, col).await;
    assert!(positions.windows(2).all(|w| w[0] < w[1]), "позиции строго возрастают");
    let _ = head;
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn move_all_appends_to_the_target_column_keeping_order(pool: PgPool) {
    let b = board(&pool).await;
    let (from, to) = (b.columns[0].id, b.columns[1].id);
    for t in ["a1", "a2", "a3"] {
        add(&pool, &b, Some(from), t).await;
    }
    add(&pool, &b, Some(to), "b1").await;

    let mut tx = pool.begin().await.unwrap();
    let moved = tasks::move_all(&mut tx, b.project.id, from, to).await.unwrap();
    tx.commit().await.unwrap();

    assert_eq!(moved, 3);
    assert_eq!(order(&pool, &b, Some(to)).await, ["b1", "a1", "a2", "a3"]);
    assert!(order(&pool, &b, Some(from)).await.is_empty());
}

// ===== Колонки =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn columns_are_appended_and_reordered(pool: PgPool) {
    let b = board(&pool).await;
    let titles = |cols: Vec<columns::Column>| cols.into_iter().map(|c| c.title).collect::<Vec<_>>();
    assert_eq!(titles(columns::list(&pool, b.project.id).await.unwrap()), ["К выполнению", "В работе", "Готово"]);

    let mut conn = pool.acquire().await.unwrap();
    let last = &b.columns[2];
    columns::place(&mut conn, last, Some(b.columns[0].id)).await.unwrap();
    assert_eq!(titles(columns::list(&pool, b.project.id).await.unwrap()), ["Готово", "К выполнению", "В работе"]);

    let first = columns::get(&pool, last.id).await.unwrap().unwrap();
    columns::place(&mut conn, &first, None).await.unwrap();
    assert_eq!(titles(columns::list(&pool, b.project.id).await.unwrap()), ["К выполнению", "В работе", "Готово"]);

    let err = columns::place(&mut conn, &first, Some(Uuid::new_v4())).await.unwrap_err();
    assert!(matches!(err, columns::PlaceError::BeforeNotFound));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn column_update_changes_only_given_fields(pool: PgPool) {
    let b = board(&pool).await;
    let mut conn = pool.acquire().await.unwrap();
    let col = columns::update(&mut conn, b.columns[0].id, Some("Новое имя"), None, None).await.unwrap();
    assert_eq!((col.title.as_str(), col.color.as_str(), col.is_done), ("Новое имя", "muted", false));
    let col = columns::update(&mut conn, b.columns[0].id, None, Some("ok"), Some(true)).await.unwrap();
    assert_eq!((col.title.as_str(), col.color.as_str(), col.is_done), ("Новое имя", "ok", true));
}

// ===== Задачи: поля, метки, карточки =====

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn patch_updates_only_given_fields_and_can_clear_optional_ones(pool: PgPool) {
    let b = board(&pool).await;
    let t = add(&pool, &b, Some(b.columns[0].id), "T").await;
    let mut conn = pool.acquire().await.unwrap();

    let patch = tasks::Patch {
        title: Some("Новое".into()),
        priority: Some("high".into()),
        assignee: Some(Some(b.user)),
        due_date: Some(Some(time::macros::date!(2026 - 10 - 22))),
        pr: Some("#7".into()),
        ..Default::default()
    };
    let t1 = tasks::update(&mut conn, t.id, &patch).await.unwrap();
    assert_eq!((t1.title.as_str(), t1.priority.as_str(), t1.pr.as_str()), ("Новое", "high", "#7"));
    assert_eq!(t1.assignee_id, Some(b.user));
    assert_eq!(t1.due_date, Some(time::macros::date!(2026 - 10 - 22)));
    assert!(t1.updated_at >= t.updated_at);

    // пустой PATCH ничего не меняет, null очищает только то, что указано
    let t2 = tasks::update(&mut conn, t.id, &tasks::Patch::default()).await.unwrap();
    assert_eq!((t2.title.as_str(), t2.assignee_id, t2.due_date), ("Новое", Some(b.user), t1.due_date));
    let t3 =
        tasks::update(&mut conn, t.id, &tasks::Patch { assignee: Some(None), ..Default::default() }).await.unwrap();
    assert_eq!((t3.assignee_id, t3.due_date, t3.priority.as_str()), (None, t1.due_date, "high"));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn tags_come_in_creation_order_and_get_cycling_tones(pool: PgPool) {
    let mut conn = pool.acquire().await.unwrap();
    for label in ["Баг", "Фича", "Техдолг"] {
        tags::insert(&mut conn, label, None).await.unwrap();
    }
    let all = tags::list(&pool).await.unwrap();
    assert_eq!(all.iter().map(|t| t.label.as_str()).collect::<Vec<_>>(), ["Баг", "Фича", "Техдолг"]);
    assert_eq!(all.iter().map(|t| t.tone).collect::<Vec<_>>(), [0, 1, 2], "тон = число меток до этой, по кругу на 8");

    let explicit = tags::insert(&mut conn, "Срочно", Some(6)).await.unwrap();
    assert_eq!(explicit.tone, 6);
    for i in 0..5 {
        tags::insert(&mut conn, &format!("m{i}"), None).await.unwrap();
    }
    let ninth = tags::insert(&mut conn, "ninth", None).await.unwrap();
    assert_eq!(ninth.tone, 1, "10-я метка: 9 % 8");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn tag_lookup_ignores_case_and_duplicates_are_rejected(pool: PgPool) {
    let mut conn = pool.acquire().await.unwrap();
    let bug = tags::insert(&mut conn, "Bug", None).await.unwrap();
    assert_eq!(tags::find_by_label(&pool, "bUG").await.unwrap().map(|t| t.id), Some(bug.id));
    assert!(tags::find_by_label(&pool, "other").await.unwrap().is_none());
    let err = tags::insert(&mut conn, "bug", None).await.unwrap_err();
    assert!(matches!(&err, db::sqlx::Error::Database(d) if d.is_unique_violation()));
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn cards_carry_tags_in_creation_order_and_subtask_counts(pool: PgPool) {
    let b = board(&pool).await;
    let mut conn = pool.acquire().await.unwrap();
    let feat = tags::insert(&mut conn, "Фича", None).await.unwrap();
    let back = tags::insert(&mut conn, "Бэк", None).await.unwrap();
    let urgent = tags::insert(&mut conn, "Срочно", None).await.unwrap();
    drop(conn);
    let t = add(&pool, &b, Some(b.columns[0].id), "T").await;
    let plain = add(&pool, &b, Some(b.columns[0].id), "plain").await;

    let mut conn = pool.acquire().await.unwrap();
    // в «неудобном» порядке: на выходе всё равно порядок создания меток
    tasks::set_tags(&mut conn, t.id, &[urgent.id, feat.id]).await.unwrap();
    for (title, done) in [("s1", true), ("s2", true), ("s3", false)] {
        let s = db::subtasks::insert(&mut conn, t.id, title).await.unwrap();
        db::subtasks::update(&mut conn, s.id, None, Some(done)).await.unwrap();
    }
    drop(conn);

    let cards = tasks::list_cards(&pool, b.project.id).await.unwrap();
    let card = cards.iter().find(|c| c.task.id == t.id).unwrap();
    assert_eq!(card.tag_ids, [feat.id, urgent.id]);
    assert_eq!((card.subtasks_done, card.subtasks_total), (2, 3));
    assert_eq!(card.task.description, "", "описание в карточки доски не попадает");
    let none = cards.iter().find(|c| c.task.id == plain.id).unwrap();
    assert!(none.tag_ids.is_empty());
    assert_eq!((none.subtasks_done, none.subtasks_total), (0, 0));

    // повторная установка заменяет набор
    let mut conn = pool.acquire().await.unwrap();
    tasks::set_tags(&mut conn, t.id, &[back.id]).await.unwrap();
    assert_eq!(tasks::tag_ids(&mut *conn, t.id).await.unwrap(), [back.id]);
    tasks::set_tags(&mut conn, t.id, &[]).await.unwrap();
    assert!(tasks::tag_ids(&mut *conn, t.id).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn deleting_a_tag_removes_it_from_tasks(pool: PgPool) {
    let b = board(&pool).await;
    let mut conn = pool.acquire().await.unwrap();
    let tag = tags::insert(&mut conn, "Баг", None).await.unwrap();
    let t = add(&pool, &b, None, "T").await;
    tasks::set_tags(&mut conn, t.id, &[tag.id]).await.unwrap();
    assert!(tags::delete(&mut conn, tag.id).await.unwrap());
    assert!(tasks::tag_ids(&mut *conn, t.id).await.unwrap().is_empty());
    assert!(!tags::delete(&mut conn, tag.id).await.unwrap(), "повторное удаление: такой метки уже нет");
}

#[sqlx::test(migrator = "db::MIGRATOR")]
async fn subtasks_are_appended_in_order(pool: PgPool) {
    let b = board(&pool).await;
    let t = add(&pool, &b, None, "T").await;
    let mut conn = pool.acquire().await.unwrap();
    for title in ["one", "two", "three"] {
        db::subtasks::insert(&mut conn, t.id, title).await.unwrap();
    }
    let titles: Vec<String> =
        db::subtasks::list(&mut *conn, t.id).await.unwrap().into_iter().map(|s| s.title).collect();
    assert_eq!(titles, ["one", "two", "three"]);
}
