//! Поиск по названиям: задачи (название и id), документы, страницы вики, файлы библиотеки (docs/OFFLINE-NOTIFY-SEARCH.md,
//! раздел 3). Содержимое не ищется. Обычный поиск подстроки по коротким полям: без расширений и индексов, на нашем объёме
//! этого хватает.
//!
//! Сравнение без учёта регистра идёт через `lower()` по обе стороны и `position`, а не через `like`: так `%`, `_` и `\`
//! в запросе остаются обычными знаками. Различает ли `lower()` регистр русских букв, зависит от локали базы (README,
//! «Локаль базы данных»); `lowercase_works` проверяет это.
//!
//! Задачи и документы берутся только из проектов выбранной команды, которые видны человеку (`can_access_project`), без
//! архивных. Страницы вики и файлы библиотеки берутся из выбранной команды; право читать её вики проверяет вызывающий.

use sqlx::PgExecutor;
use uuid::Uuid;

/// Проекты команды `$4`, видимые человеку `$1` в поиске, без архивных
macro_rules! visible_projects {
    () => {
        "visible as ( \
           select p.id, p.key, p.name from projects p \
           where p.team_id = $4 and p.archived_at is null and can_access_project(p.id, $1) \
         )"
    };
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct TaskHit {
    pub id: Uuid,
    pub project_id: Uuid,
    pub project_name: String,
    /// Ключ ряда задачи (модуля или проекта) и номер: из них собирается id для показа
    pub prefix: Option<String>,
    pub number: i32,
    pub title: String,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct DocHit {
    pub id: Uuid,
    pub project_id: Uuid,
    pub project_name: String,
    pub title: String,
    /// page | edge
    pub mode: String,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct WikiHit {
    pub id: Uuid,
    pub title: String,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct FileHit {
    pub id: Uuid,
    pub name: String,
    pub kind: String,
    pub size_bytes: i64,
}

/// Задачи, у которых название или id (`WEB-141`) содержит запрос. Сначала точное совпадение с id, потом начало названия
/// или id, потом остальное; внутри группы недавно менявшиеся первыми.
pub async fn tasks<'e>(
    ex: impl PgExecutor<'e>,
    user_id: Uuid,
    team_id: Uuid,
    q: &str,
    limit: i64,
) -> Result<Vec<TaskHit>, sqlx::Error> {
    sqlx::query_as(concat!(
        "with ",
        visible_projects!(),
        ", found as ( \
           select t.id, t.project_id, v.name as project_name, coalesce(m.key, v.key) as prefix, t.number, t.title, \
                  t.updated_at, \
                  coalesce(m.key, v.key, 'TASK') || '-' || t.number::text as label \
           from tasks t \
           join visible v on v.id = t.project_id \
           left join modules m on m.id = t.series_module_id \
         ) \
         select id, project_id, project_name, prefix, number, title from found \
         where position(lower($2) in lower(title)) > 0 or position(lower($2) in lower(label)) > 0 \
         order by case when lower(label) = lower($2) then 0 \
                       when position(lower($2) in lower(label)) = 1 or position(lower($2) in lower(title)) = 1 then 1 \
                       else 2 end, \
                  updated_at desc, id \
         limit $3"
    ))
    .bind(user_id)
    .bind(q)
    .bind(limit)
    .bind(team_id)
    .fetch_all(ex)
    .await
}

/// Документы проектов, у которых название содержит запрос. Содержимое не ищется.
pub async fn docs<'e>(
    ex: impl PgExecutor<'e>,
    user_id: Uuid,
    team_id: Uuid,
    q: &str,
    limit: i64,
) -> Result<Vec<DocHit>, sqlx::Error> {
    sqlx::query_as(concat!(
        "with ",
        visible_projects!(),
        " select d.id, d.project_id, v.name as project_name, d.title, d.mode::text as mode \
         from docs d join visible v on v.id = d.project_id \
         where position(lower($2) in lower(d.title)) > 0 \
         order by case when position(lower($2) in lower(d.title)) = 1 then 0 else 1 end, d.updated_at desc, d.id \
         limit $3"
    ))
    .bind(user_id)
    .bind(q)
    .bind(limit)
    .bind(team_id)
    .fetch_all(ex)
    .await
}

/// Страницы вики команды, у которых название содержит запрос
pub async fn wiki<'e>(ex: impl PgExecutor<'e>, team_id: Uuid, q: &str, limit: i64) -> Result<Vec<WikiHit>, sqlx::Error> {
    sqlx::query_as(
        "select id, title from wiki_pages \
         where team_id = $3 and position(lower($1) in lower(title)) > 0 \
         order by case when position(lower($1) in lower(title)) = 1 then 0 else 1 end, updated_at desc, id \
         limit $2",
    )
    .bind(q)
    .bind(limit)
    .bind(team_id)
    .fetch_all(ex)
    .await
}

/// Файлы библиотеки команды (вложения задач не входят), у которых имя содержит запрос
pub async fn files<'e>(ex: impl PgExecutor<'e>, team_id: Uuid, q: &str, limit: i64) -> Result<Vec<FileHit>, sqlx::Error> {
    sqlx::query_as(
        "select id, name, kind, size_bytes from files \
         where team_id = $3 and task_id is null and position(lower($1) in lower(name)) > 0 \
         order by case when position(lower($1) in lower(name)) = 1 then 0 else 1 end, created_at desc, id \
         limit $2",
    )
    .bind(q)
    .bind(limit)
    .bind(team_id)
    .fetch_all(ex)
    .await
}

/// Различает ли `lower()` базы регистр русских букв. В локали `C` нет, и поиск «планирование» не найдёт «Планирование».
pub async fn lowercase_works<'e>(ex: impl PgExecutor<'e>) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select lower('ЁЖИК Я') = 'ёжик я'").fetch_one(ex).await
}
