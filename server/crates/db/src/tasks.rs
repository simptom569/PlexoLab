//! Задачи

use domain::position::{self, Placement};
use sqlx::{PgConnection, PgExecutor};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Task {
    pub id: Uuid,
    pub project_id: Uuid,
    pub number: i32,
    pub title: String,
    /// None: бэклог
    pub column_id: Option<Uuid>,
    pub position: f64,
    pub assignee_id: Option<Uuid>,
    /// high | med | low
    pub priority: String,
    pub start_date: Option<Date>,
    pub due_date: Option<Date>,
    pub module_id: Option<Uuid>,
    pub milestone_id: Option<Uuid>,
    pub pr: String,
    pub description: String,
    pub created_by: Option<Uuid>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

/// Задача для доски: с метками и счётчиками подзадач (описание не передаётся)
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct TaskCard {
    #[sqlx(flatten)]
    pub task: Task,
    /// В порядке создания меток
    pub tag_ids: Vec<Uuid>,
    pub subtasks_total: i64,
    pub subtasks_done: i64,
}

macro_rules! task_columns {
    () => {
        "id, project_id, number, title, column_id, position, assignee_id, priority::text as priority, start_date, \
         due_date, module_id, milestone_id, pr, description, created_by, created_at, updated_at"
    };
}

macro_rules! select_task {
    ($tail:literal) => {
        concat!("select ", task_columns!(), " from tasks ", $tail)
    };
}

pub async fn get<'e>(ex: impl PgExecutor<'e>, id: Uuid) -> Result<Option<Task>, sqlx::Error> {
    sqlx::query_as(select_task!("where id = $1")).bind(id).fetch_optional(ex).await
}

/// Блокирует задачу до конца транзакции
pub async fn get_for_update(conn: &mut PgConnection, id: Uuid) -> Result<Option<Task>, sqlx::Error> {
    sqlx::query_as(select_task!("where id = $1 for update")).bind(id).fetch_optional(conn).await
}

/// Все задачи проекта (доска и бэклог) для первой загрузки доски
pub async fn list_cards<'e>(ex: impl PgExecutor<'e>, project_id: Uuid) -> Result<Vec<TaskCard>, sqlx::Error> {
    sqlx::query_as(
        "select t.id, t.project_id, t.number, t.title, t.column_id, t.position, t.assignee_id, \
                t.priority::text as priority, t.start_date, t.due_date, t.module_id, t.milestone_id, t.pr, \
                ''::text as description, t.created_by, t.created_at, t.updated_at, \
                array(select tt.tag_id from task_tags tt join tags g on g.id = tt.tag_id \
                      where tt.task_id = t.id order by g.seq) as tag_ids, \
                (select count(*) from subtasks s where s.task_id = t.id) as subtasks_total, \
                (select count(*) from subtasks s where s.task_id = t.id and s.done) as subtasks_done \
         from tasks t where t.project_id = $1 order by t.position, t.id",
    )
    .bind(project_id)
    .fetch_all(ex)
    .await
}

/// Метки задачи в порядке создания меток
pub async fn tag_ids<'e>(ex: impl PgExecutor<'e>, task_id: Uuid) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        "select tt.tag_id from task_tags tt join tags g on g.id = tt.tag_id where tt.task_id = $1 order by g.seq",
    )
    .bind(task_id)
    .fetch_all(ex)
    .await
}

/// Заменяет набор меток задачи
pub async fn set_tags(conn: &mut PgConnection, task_id: Uuid, tag_ids: &[Uuid]) -> Result<(), sqlx::Error> {
    sqlx::query("delete from task_tags where task_id = $1").bind(task_id).execute(&mut *conn).await?;
    sqlx::query("insert into task_tags (task_id, tag_id) select $1, unnest($2::uuid[]) on conflict do nothing")
        .bind(task_id)
        .bind(tag_ids)
        .execute(conn)
        .await?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct NewTask {
    pub project_id: Uuid,
    pub number: i32,
    pub title: String,
    pub column_id: Option<Uuid>,
    pub position: f64,
    pub created_by: Uuid,
}

pub async fn insert(conn: &mut PgConnection, t: &NewTask) -> Result<Task, sqlx::Error> {
    sqlx::query_as(concat!(
        "insert into tasks (project_id, number, title, column_id, position, created_by) \
         values ($1, $2, $3, $4, $5, $6) returning ",
        task_columns!()
    ))
    .bind(t.project_id)
    .bind(t.number)
    .bind(&t.title)
    .bind(t.column_id)
    .bind(t.position)
    .bind(t.created_by)
    .fetch_one(conn)
    .await
}

/// Поля, которые меняются через PATCH. `None`: не трогать. У необязательных полей внешний `Some(None)` означает
/// «очистить».
#[derive(Debug, Clone, Default)]
pub struct Patch {
    pub title: Option<String>,
    pub description: Option<String>,
    pub pr: Option<String>,
    pub priority: Option<String>,
    pub assignee: Option<Option<Uuid>>,
    pub start_date: Option<Option<Date>>,
    pub due_date: Option<Option<Date>>,
    pub module: Option<Option<Uuid>>,
    pub milestone: Option<Option<Uuid>>,
}

impl Patch {
    /// Нет ни одного поля для изменения
    pub fn is_empty(&self) -> bool {
        self.title.is_none()
            && self.description.is_none()
            && self.pr.is_none()
            && self.priority.is_none()
            && self.assignee.is_none()
            && self.start_date.is_none()
            && self.due_date.is_none()
            && self.module.is_none()
            && self.milestone.is_none()
    }
}

pub async fn update(conn: &mut PgConnection, id: Uuid, p: &Patch) -> Result<Task, sqlx::Error> {
    sqlx::query_as(concat!(
        "update tasks set \
           title = coalesce($2, title), \
           description = coalesce($3, description), \
           pr = coalesce($4, pr), \
           priority = coalesce($5::priority, priority), \
           assignee_id = case when $6 then $7 else assignee_id end, \
           start_date = case when $8 then $9 else start_date end, \
           due_date = case when $10 then $11 else due_date end, \
           module_id = case when $12 then $13 else module_id end, \
           milestone_id = case when $14 then $15 else milestone_id end, \
           updated_at = now() \
         where id = $1 returning ",
        task_columns!()
    ))
    .bind(id)
    .bind(p.title.as_deref())
    .bind(p.description.as_deref())
    .bind(p.pr.as_deref())
    .bind(p.priority.as_deref())
    .bind(p.assignee.is_some())
    .bind(p.assignee.flatten())
    .bind(p.start_date.is_some())
    .bind(p.start_date.flatten())
    .bind(p.due_date.is_some())
    .bind(p.due_date.flatten())
    .bind(p.module.is_some())
    .bind(p.module.flatten())
    .bind(p.milestone.is_some())
    .bind(p.milestone.flatten())
    .fetch_one(conn)
    .await
}

/// Обновляет `updated_at` (изменились подзадачи и т. п.)
pub async fn touch(conn: &mut PgConnection, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("update tasks set updated_at = now() where id = $1").bind(id).execute(conn).await?;
    Ok(())
}

pub async fn delete(conn: &mut PgConnection, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from tasks where id = $1").bind(id).execute(conn).await?;
    Ok(())
}

/// Задачи колонки (None: бэклог) по возрастанию позиции, без `exclude`
pub async fn siblings(
    conn: &mut PgConnection,
    project_id: Uuid,
    column_id: Option<Uuid>,
    exclude: Option<Uuid>,
) -> Result<Vec<(Uuid, f64)>, sqlx::Error> {
    sqlx::query_as(
        "select id, position from tasks \
         where project_id = $1 and column_id is not distinct from $2 and ($3::uuid is null or id <> $3) \
         order by position, id",
    )
    .bind(project_id)
    .bind(column_id)
    .bind(exclude)
    .fetch_all(conn)
    .await
}

#[derive(Debug, thiserror::Error)]
pub enum PlaceError {
    #[error("задача, перед которой нужно встать, не найдена в этой колонке")]
    BeforeNotFound,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

/// Ставит задачу в колонку `column_id` (None: бэклог) перед задачей `before` или в конец.
/// Если зазор между соседями исчерпан, позиции всей колонки пересчитываются.
/// Вызывать внутри транзакции после `projects::lock`.
pub async fn place(
    conn: &mut PgConnection,
    task: &Task,
    column_id: Option<Uuid>,
    before: Option<Uuid>,
) -> Result<Task, PlaceError> {
    let siblings = siblings(&mut *conn, task.project_id, column_id, Some(task.id)).await?;
    let position = match position::place(&siblings, task.id, before).map_err(|_| PlaceError::BeforeNotFound)? {
        Placement::One(p) => p,
        Placement::All(all) => {
            let (ids, positions): (Vec<Uuid>, Vec<f64>) = all.iter().copied().unzip();
            sqlx::query(
                "update tasks set position = v.pos from unnest($1::uuid[], $2::float8[]) as v(id, pos) \
                 where tasks.id = v.id",
            )
            .bind(ids)
            .bind(positions)
            .execute(&mut *conn)
            .await?;
            all.iter().find(|(k, _)| *k == task.id).map_or(position::STEP, |(_, p)| *p)
        }
    };
    let moved = sqlx::query_as(concat!(
        "update tasks set column_id = $2, position = $3, updated_at = now() where id = $1 returning ",
        task_columns!()
    ))
    .bind(task.id)
    .bind(column_id)
    .bind(position)
    .fetch_one(conn)
    .await?;
    Ok(moved)
}

/// Позиция в конце колонки (None: бэклог) для новой задачи
pub async fn next_position(
    conn: &mut PgConnection,
    project_id: Uuid,
    column_id: Option<Uuid>,
) -> Result<f64, sqlx::Error> {
    let last: Option<f64> = sqlx::query_scalar(
        "select max(position) from tasks where project_id = $1 and column_id is not distinct from $2",
    )
    .bind(project_id)
    .bind(column_id)
    .fetch_one(conn)
    .await?;
    Ok(position::after(last))
}

/// Переносит все задачи колонки `from` в конец колонки `to`, сохраняя их порядок
pub async fn move_all(conn: &mut PgConnection, project_id: Uuid, from: Uuid, to: Uuid) -> Result<u64, sqlx::Error> {
    let base = next_position(&mut *conn, project_id, Some(to)).await?;
    let r = sqlx::query(
        "update tasks t set column_id = $3, position = $4 + r.n * $5, updated_at = now() \
         from (select id, row_number() over (order by position, id) - 1 as n from tasks \
               where project_id = $1 and column_id = $2) r \
         where t.id = r.id",
    )
    .bind(project_id)
    .bind(from)
    .bind(to)
    .bind(base)
    .bind(position::STEP)
    .execute(conn)
    .await?;
    Ok(r.rows_affected())
}
