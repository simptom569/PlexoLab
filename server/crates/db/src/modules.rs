//! Модули и вехи проекта. Прогресс («2 из 5 задач готово») считает база: задача готова,
//! если лежит в колонке с отметкой «Готово»; задачи из бэклога в счёт «готово» не входят.

use sqlx::{PgConnection, PgExecutor};
use time::Date;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Module {
    pub id: Uuid,
    pub project_id: Uuid,
    pub title: String,
    /// Ключ задач: префикс id (`SEO-3`) у задач в ряду модуля; `None`: задачи нумеруются рядом проекта
    pub key: Option<String>,
    pub lead_id: Option<Uuid>,
    /// plan | progress | done
    pub status: String,
    pub date_from: Option<Date>,
    pub date_to: Option<Date>,
    pub note: String,
    pub tasks_total: i64,
    pub tasks_done: i64,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Milestone {
    pub id: Uuid,
    pub project_id: Uuid,
    pub title: String,
    pub due_date: Date,
    pub tasks_total: i64,
    pub tasks_done: i64,
}

macro_rules! select_module {
    ($tail:literal) => {
        concat!(
            "select m.id, m.project_id, m.title, m.key, m.lead_id, m.status::text as status, m.date_from, m.date_to, m.note, \
               (select count(*) from tasks t where t.module_id = m.id) as tasks_total, \
               (select count(*) from tasks t join board_columns c on c.id = t.column_id \
                 where t.module_id = m.id and c.is_done) as tasks_done \
             from modules m ",
            $tail
        )
    };
}

macro_rules! select_milestone {
    ($tail:literal) => {
        concat!(
            "select m.id, m.project_id, m.title, m.due_date, \
               (select count(*) from tasks t where t.milestone_id = m.id) as tasks_total, \
               (select count(*) from tasks t join board_columns c on c.id = t.column_id \
                 where t.milestone_id = m.id and c.is_done) as tasks_done \
             from milestones m ",
            $tail
        )
    };
}

/// Модули в порядке добавления
pub async fn list_modules<'e>(ex: impl PgExecutor<'e>, project_id: Uuid) -> Result<Vec<Module>, sqlx::Error> {
    sqlx::query_as(select_module!("where m.project_id = $1 order by m.seq")).bind(project_id).fetch_all(ex).await
}

/// Вехи по возрастанию даты
pub async fn list_milestones<'e>(ex: impl PgExecutor<'e>, project_id: Uuid) -> Result<Vec<Milestone>, sqlx::Error> {
    sqlx::query_as(select_milestone!("where m.project_id = $1 order by m.due_date, m.id"))
        .bind(project_id)
        .fetch_all(ex)
        .await
}

pub async fn get_module<'e>(ex: impl PgExecutor<'e>, id: Uuid) -> Result<Option<Module>, sqlx::Error> {
    sqlx::query_as(select_module!("where m.id = $1")).bind(id).fetch_optional(ex).await
}

pub async fn get_milestone<'e>(ex: impl PgExecutor<'e>, id: Uuid) -> Result<Option<Milestone>, sqlx::Error> {
    sqlx::query_as(select_milestone!("where m.id = $1")).bind(id).fetch_optional(ex).await
}

/// Принадлежит ли модуль проекту
pub async fn module_in_project<'e>(ex: impl PgExecutor<'e>, id: Uuid, project_id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select exists (select 1 from modules where id = $1 and project_id = $2)")
        .bind(id)
        .bind(project_id)
        .fetch_one(ex)
        .await
}

/// Принадлежит ли веха проекту
pub async fn milestone_in_project<'e>(
    ex: impl PgExecutor<'e>,
    id: Uuid,
    project_id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select exists (select 1 from milestones where id = $1 and project_id = $2)")
        .bind(id)
        .bind(project_id)
        .fetch_one(ex)
        .await
}

/// Новый модуль: «Запланирован», без дат и заметки
pub async fn insert_module(
    conn: &mut PgConnection,
    project_id: Uuid,
    title: &str,
    lead_id: Uuid,
) -> Result<Module, sqlx::Error> {
    let id: Uuid =
        sqlx::query_scalar("insert into modules (project_id, title, lead_id) values ($1, $2, $3) returning id")
            .bind(project_id)
            .bind(title)
            .bind(lead_id)
            .fetch_one(&mut *conn)
            .await?;
    sqlx::query_as(select_module!("where m.id = $1")).bind(id).fetch_one(conn).await
}

/// Поля модуля, которые меняются. `None` — не трогать; у необязательных полей `Some(None)` очищает значение.
#[derive(Debug, Default, Clone)]
pub struct ModulePatch {
    pub title: Option<String>,
    pub key: Option<Option<String>>,
    pub lead: Option<Option<Uuid>>,
    pub status: Option<String>,
    pub date_from: Option<Option<Date>>,
    pub date_to: Option<Option<Date>>,
    pub note: Option<String>,
}

pub async fn update_module(conn: &mut PgConnection, id: Uuid, p: &ModulePatch) -> Result<Module, sqlx::Error> {
    sqlx::query(
        "update modules set \
           title = coalesce($2, title), \
           lead_id = case when $3 then $4 else lead_id end, \
           status = coalesce($5::work_status, status), \
           date_from = case when $6 then $7 else date_from end, \
           date_to = case when $8 then $9 else date_to end, \
           note = coalesce($10, note), \
           key = case when $11 then $12 else key end \
         where id = $1",
    )
    .bind(id)
    .bind(p.title.as_deref())
    .bind(p.lead.is_some())
    .bind(p.lead.flatten())
    .bind(p.status.as_deref())
    .bind(p.date_from.is_some())
    .bind(p.date_from.flatten())
    .bind(p.date_to.is_some())
    .bind(p.date_to.flatten())
    .bind(p.note.as_deref())
    .bind(p.key.is_some())
    .bind(p.key.as_ref().and_then(|k| k.as_deref()))
    .execute(&mut *conn)
    .await?;
    sqlx::query_as(select_module!("where m.id = $1")).bind(id).fetch_one(conn).await
}

/// Занят ли ключ другим модулем проекта (кроме `except`)
pub async fn key_taken<'e>(
    ex: impl PgExecutor<'e>,
    project_id: Uuid,
    key: &str,
    except: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select exists (select 1 from modules where project_id = $1 and key = $2 and id <> $3)")
        .bind(project_id)
        .bind(key)
        .bind(except)
        .fetch_one(ex)
        .await
}

/// Следующий номер ряда модуля (SEO-12). Вызывать внутри транзакции после блокировки проекта.
pub async fn next_number(conn: &mut PgConnection, id: Uuid) -> Result<i32, sqlx::Error> {
    sqlx::query_scalar("update modules set last_number = last_number + 1 where id = $1 returning last_number")
        .bind(id)
        .fetch_one(conn)
        .await
}

/// Задачи модуля остаются, у них пропадает модуль (`on delete set null`)
pub async fn delete_module(conn: &mut PgConnection, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from modules where id = $1").bind(id).execute(conn).await?;
    Ok(())
}

pub async fn insert_milestone(
    conn: &mut PgConnection,
    project_id: Uuid,
    title: &str,
    due_date: Date,
) -> Result<Milestone, sqlx::Error> {
    let id: Uuid =
        sqlx::query_scalar("insert into milestones (project_id, title, due_date) values ($1, $2, $3) returning id")
            .bind(project_id)
            .bind(title)
            .bind(due_date)
            .fetch_one(&mut *conn)
            .await?;
    sqlx::query_as(select_milestone!("where m.id = $1")).bind(id).fetch_one(conn).await
}

pub async fn update_milestone(
    conn: &mut PgConnection,
    id: Uuid,
    title: Option<&str>,
    due_date: Option<Date>,
) -> Result<Milestone, sqlx::Error> {
    sqlx::query("update milestones set title = coalesce($2, title), due_date = coalesce($3, due_date) where id = $1")
        .bind(id)
        .bind(title)
        .bind(due_date)
        .execute(&mut *conn)
        .await?;
    sqlx::query_as(select_milestone!("where m.id = $1")).bind(id).fetch_one(conn).await
}

/// Задачи вехи остаются, у них пропадает веха (`on delete set null`)
pub async fn delete_milestone(conn: &mut PgConnection, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from milestones where id = $1").bind(id).execute(conn).await?;
    Ok(())
}
