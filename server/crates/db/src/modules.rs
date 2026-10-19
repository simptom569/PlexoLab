//! Модули и вехи проекта. Здесь только чтение для доски, управление добавится на этапе 4.

use sqlx::PgExecutor;
use time::Date;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Module {
    pub id: Uuid,
    pub project_id: Uuid,
    pub title: String,
    pub lead_id: Option<Uuid>,
    /// plan | progress | done
    pub status: String,
    pub date_from: Option<Date>,
    pub date_to: Option<Date>,
    pub note: String,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Milestone {
    pub id: Uuid,
    pub project_id: Uuid,
    pub title: String,
    pub due_date: Date,
}

pub async fn list_modules<'e>(ex: impl PgExecutor<'e>, project_id: Uuid) -> Result<Vec<Module>, sqlx::Error> {
    sqlx::query_as(
        "select id, project_id, title, lead_id, status::text as status, date_from, date_to, note \
         from modules where project_id = $1 order by date_from nulls last, id",
    )
    .bind(project_id)
    .fetch_all(ex)
    .await
}

pub async fn list_milestones<'e>(ex: impl PgExecutor<'e>, project_id: Uuid) -> Result<Vec<Milestone>, sqlx::Error> {
    sqlx::query_as("select id, project_id, title, due_date from milestones where project_id = $1 order by due_date, id")
        .bind(project_id)
        .fetch_all(ex)
        .await
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
