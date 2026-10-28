//! Файлы: библиотека вики, вложения страниц и задач. Содержимое лежит на диске (`storage_key`), здесь только записи.

use sqlx::{PgConnection, PgExecutor};
use time::OffsetDateTime;
use uuid::Uuid;

/// Префикс ключа у файлов из сида: содержимого на диске у них нет
pub const SEED_KEY_PREFIX: &str = "seed:";

/// Вложение задачи
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct TaskFile {
    pub id: Uuid,
    pub name: String,
    pub size_bytes: i64,
    /// img | pdf | doc | sheet | zip | other
    pub kind: String,
    pub uploader_id: Option<Uuid>,
    pub created_at: OffsetDateTime,
}

/// Файл целиком: и библиотека, и вложение задачи
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct File {
    pub id: Uuid,
    /// Команда, которой принадлежит файл (у вложения задачи это команда её проекта)
    pub team_id: Uuid,
    pub name: String,
    pub size_bytes: i64,
    pub kind: String,
    pub storage_key: String,
    pub uploader_id: Option<Uuid>,
    pub folder_id: Option<Uuid>,
    pub wiki_page_id: Option<Uuid>,
    pub task_id: Option<Uuid>,
    pub created_at: OffsetDateTime,
}

macro_rules! select_file {
    ($tail:literal) => {
        concat!(
            "select id, team_id, name, size_bytes, kind, storage_key, uploader_id, folder_id, wiki_page_id, task_id, \
                    created_at \
             from files ",
            $tail
        )
    };
}

pub async fn list_for_task<'e>(ex: impl PgExecutor<'e>, task_id: Uuid) -> Result<Vec<TaskFile>, sqlx::Error> {
    sqlx::query_as(
        "select id, name, size_bytes, kind, uploader_id, created_at from files where task_id = $1 order by created_at, id",
    )
    .bind(task_id)
    .fetch_all(ex)
    .await
}

/// В какой папке искать
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FolderScope {
    /// Во всех
    Any,
    /// Только в корне (без папки)
    Root,
    One(Uuid),
}

/// Условия выбора из библиотеки. Пустое условие не ограничивает.
#[derive(Debug, Clone)]
pub struct LibraryFilter<'a> {
    pub folder: FolderScope,
    pub kind: Option<&'a str>,
    /// Часть имени без учёта регистра
    pub query: Option<&'a str>,
    pub wiki_page_id: Option<Uuid>,
}

/// Файлы библиотеки команды (без вложений задач), новые первыми
pub async fn list_library<'e>(
    ex: impl PgExecutor<'e>,
    team_id: Uuid,
    filter: &LibraryFilter<'_>,
) -> Result<Vec<File>, sqlx::Error> {
    let (mode, folder_id) = match filter.folder {
        FolderScope::Any => ("any", None),
        FolderScope::Root => ("root", None),
        FolderScope::One(id) => ("one", Some(id)),
    };
    sqlx::query_as(select_file!(
        "where task_id is null and team_id = $6 \
         and ($1 = 'any' or ($1 = 'root' and folder_id is null) or ($1 = 'one' and folder_id = $2)) \
         and ($3::text is null or kind = $3) \
         and ($4::text is null or position(lower($4) in lower(name)) > 0) \
         and ($5::uuid is null or wiki_page_id = $5) \
         order by created_at desc, id"
    ))
    .bind(mode)
    .bind(folder_id)
    .bind(filter.kind)
    .bind(filter.query)
    .bind(filter.wiki_page_id)
    .bind(team_id)
    .fetch_all(ex)
    .await
}

/// Сколько файлов в библиотеке команды всего (вложения задач не в счёт)
pub async fn count_library<'e>(ex: impl PgExecutor<'e>, team_id: Uuid) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("select count(*) from files where task_id is null and team_id = $1")
        .bind(team_id)
        .fetch_one(ex)
        .await
}

pub async fn get<'e>(ex: impl PgExecutor<'e>, id: Uuid) -> Result<Option<File>, sqlx::Error> {
    sqlx::query_as(select_file!("where id = $1")).bind(id).fetch_optional(ex).await
}

/// Новая запись о файле, уже сохранённом на диске
#[derive(Debug)]
pub struct NewFile<'a> {
    pub team_id: Uuid,
    pub name: &'a str,
    pub size_bytes: i64,
    pub kind: &'a str,
    pub storage_key: &'a str,
    pub uploader_id: Uuid,
    pub folder_id: Option<Uuid>,
    pub wiki_page_id: Option<Uuid>,
    pub task_id: Option<Uuid>,
}

pub async fn insert(conn: &mut PgConnection, f: &NewFile<'_>) -> Result<File, sqlx::Error> {
    sqlx::query_as(concat!(
        "insert into files (name, size_bytes, kind, storage_key, uploader_id, folder_id, wiki_page_id, task_id, team_id) ",
        "values ($1, $2, $3, $4, $5, $6, $7, $8, $9) ",
        "returning id, team_id, name, size_bytes, kind, storage_key, uploader_id, folder_id, wiki_page_id, task_id, ",
        "created_at"
    ))
    .bind(f.name)
    .bind(f.size_bytes)
    .bind(f.kind)
    .bind(f.storage_key)
    .bind(f.uploader_id)
    .bind(f.folder_id)
    .bind(f.wiki_page_id)
    .bind(f.task_id)
    .bind(f.team_id)
    .fetch_one(conn)
    .await
}

pub async fn delete(conn: &mut PgConnection, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from files where id = $1").bind(id).execute(conn).await?;
    Ok(())
}

/// Ключи файлов, которые уйдут вместе с задачей (запись удаляет база, файл на диске надо убрать отдельно)
pub async fn storage_keys_for_task<'e>(ex: impl PgExecutor<'e>, task_id: Uuid) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar("select storage_key from files where task_id = $1").bind(task_id).fetch_all(ex).await
}
