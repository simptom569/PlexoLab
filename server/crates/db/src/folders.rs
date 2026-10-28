//! Папки библиотеки файлов. Принадлежат команде; названия уникальны внутри команды.

use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Folder {
    pub id: Uuid,
    /// Команда, которой принадлежит папка
    pub team_id: Uuid,
    pub name: String,
    /// Сколько файлов лежит в папке (вложения страниц тоже считаются)
    pub file_count: i64,
}

macro_rules! select_folder {
    ($tail:literal) => {
        concat!(
            "select f.id, f.team_id, f.name, (select count(*) from files x where x.folder_id = f.id) as file_count ",
            "from folders f ",
            $tail
        )
    };
}

/// Папки команды в порядке создания
pub async fn list<'e>(ex: impl PgExecutor<'e>, team_id: Uuid) -> Result<Vec<Folder>, sqlx::Error> {
    sqlx::query_as(select_folder!("where f.team_id = $1 order by f.seq")).bind(team_id).fetch_all(ex).await
}

/// Папка без проверки доступа: доступ к её команде проверяет вызывающий (`access`)
pub async fn get<'e>(ex: impl PgExecutor<'e>, id: Uuid) -> Result<Option<Folder>, sqlx::Error> {
    sqlx::query_as(select_folder!("where f.id = $1")).bind(id).fetch_optional(ex).await
}

/// Создаёт папку в команде. Если такая там уже есть, вернёт `None` (имена в команде не повторяются).
pub async fn insert(conn: &mut PgConnection, team_id: Uuid, name: &str) -> Result<Option<Folder>, sqlx::Error> {
    let id: Option<Uuid> = sqlx::query_scalar(
        "insert into folders (team_id, name) values ($1, $2) on conflict (team_id, name) do nothing returning id",
    )
    .bind(team_id)
    .bind(name)
    .fetch_optional(&mut *conn)
    .await?;
    match id {
        Some(id) => get(conn, id).await,
        None => Ok(None),
    }
}

/// Папка команды с таким именем; если нет — создаётся. Для вложений страниц.
pub async fn find_or_create(conn: &mut PgConnection, team_id: Uuid, name: &str) -> Result<Uuid, sqlx::Error> {
    sqlx::query("insert into folders (team_id, name) values ($1, $2) on conflict (team_id, name) do nothing")
        .bind(team_id)
        .bind(name)
        .execute(&mut *conn)
        .await?;
    sqlx::query_scalar("select id from folders where team_id = $1 and name = $2")
        .bind(team_id)
        .bind(name)
        .fetch_one(conn)
        .await
}

pub async fn delete(conn: &mut PgConnection, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from folders where id = $1").bind(id).execute(conn).await?;
    Ok(())
}
