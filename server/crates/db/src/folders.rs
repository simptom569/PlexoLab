//! Папки библиотеки файлов

use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Folder {
    pub id: Uuid,
    pub name: String,
    /// Сколько файлов лежит в папке (вложения страниц тоже считаются)
    pub file_count: i64,
}

macro_rules! select_folder {
    ($tail:literal) => {
        concat!(
            "select f.id, f.name, (select count(*) from files x where x.folder_id = f.id) as file_count ",
            "from folders f ",
            $tail
        )
    };
}

/// Папки в порядке создания
pub async fn list<'e>(ex: impl PgExecutor<'e>) -> Result<Vec<Folder>, sqlx::Error> {
    sqlx::query_as(select_folder!("order by f.seq")).fetch_all(ex).await
}

pub async fn get<'e>(ex: impl PgExecutor<'e>, id: Uuid) -> Result<Option<Folder>, sqlx::Error> {
    sqlx::query_as(select_folder!("where f.id = $1")).bind(id).fetch_optional(ex).await
}

/// Создаёт папку. Если такая уже есть, вернёт `None` (имена не повторяются).
pub async fn insert(conn: &mut PgConnection, name: &str) -> Result<Option<Folder>, sqlx::Error> {
    let id: Option<Uuid> =
        sqlx::query_scalar("insert into folders (name) values ($1) on conflict (name) do nothing returning id")
            .bind(name)
            .fetch_optional(&mut *conn)
            .await?;
    match id {
        Some(id) => get(conn, id).await,
        None => Ok(None),
    }
}

/// Папка с таким именем; если нет — создаётся. Для вложений страниц.
pub async fn find_or_create(conn: &mut PgConnection, name: &str) -> Result<Uuid, sqlx::Error> {
    sqlx::query("insert into folders (name) values ($1) on conflict (name) do nothing")
        .bind(name)
        .execute(&mut *conn)
        .await?;
    sqlx::query_scalar("select id from folders where name = $1").bind(name).fetch_one(conn).await
}

pub async fn delete(conn: &mut PgConnection, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from folders where id = $1").bind(id).execute(conn).await?;
    Ok(())
}
