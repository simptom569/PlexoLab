//! Документы: название и текст с версией (`rev`), порядок в списке, звёздочки по пользователям и холст
//! (объекты и стрелки). Список документов общий для команды, звёздочка у каждого своя.

use domain::{
    docs::{Link, Note, Object},
    position::{self, Placement},
};
use sqlx::{PgConnection, PgExecutor};
use time::OffsetDateTime;
use uuid::Uuid;

/// Документ целиком. `starred` — отмечен ли он звёздочкой тем, чей идентификатор передан в запрос.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Doc {
    pub id: Uuid,
    pub title: String,
    pub md: String,
    /// page | edge
    pub mode: String,
    pub note_x: f32,
    pub note_y: f32,
    pub note_w: f32,
    pub position: f64,
    pub rev: i32,
    pub created_by: Option<Uuid>,
    pub updated_by: Option<Uuid>,
    pub updated_at: OffsetDateTime,
    pub starred: bool,
}

impl Doc {
    pub fn note(&self) -> Note {
        Note { x: self.note_x, y: self.note_y, w: self.note_w }
    }
}

/// Документ для карточки списка: вместо текста его начало, из которого сервер делает фрагмент
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct DocListItem {
    pub id: Uuid,
    pub title: String,
    pub head: String,
    pub mode: String,
    pub note_x: f32,
    pub note_y: f32,
    pub note_w: f32,
    pub position: f64,
    pub created_by: Option<Uuid>,
    pub updated_at: OffsetDateTime,
    pub starred: bool,
    pub object_count: i64,
}

/// Объект холста вместе с документом, которому он принадлежит
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct DocObject {
    pub id: Uuid,
    pub doc_id: Uuid,
    /// sticky | rect | ellipse | text
    pub kind: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub text: String,
    pub color: i16,
}

macro_rules! select_doc {
    ($tail:literal) => {
        concat!(
            "select d.id, d.title, d.md, d.mode::text as mode, d.note_x, d.note_y, d.note_w, d.position, d.rev, ",
            "d.created_by, d.updated_by, d.updated_at, ",
            "exists(select 1 from doc_stars s where s.doc_id = d.id and s.user_id = $1) as starred ",
            "from docs d ",
            $tail
        )
    };
}

/// Документы для списка в порядке `position`. `query` ищет по названию и тексту без учёта регистра (как макет),
/// `starred_only` оставляет документы со звёздочкой `user`.
pub async fn list<'e>(
    ex: impl PgExecutor<'e>,
    user: Uuid,
    query: Option<&str>,
    starred_only: bool,
    head_len: i32,
) -> Result<Vec<DocListItem>, sqlx::Error> {
    sqlx::query_as(concat!(
        "select d.id, d.title, left(d.md, $4) as head, d.mode::text as mode, d.note_x, d.note_y, d.note_w, d.position, ",
        "d.created_by, d.updated_at, ",
        "exists(select 1 from doc_stars s where s.doc_id = d.id and s.user_id = $1) as starred, ",
        "(select count(*) from doc_objects o where o.doc_id = d.id) as object_count ",
        "from docs d ",
        "where ($2::text is null or position(lower($2) in lower(d.title)) > 0 or position(lower($2) in lower(d.md)) > 0) ",
        "and (not $3 or exists(select 1 from doc_stars s where s.doc_id = d.id and s.user_id = $1)) ",
        "order by d.position, d.id"
    ))
    .bind(user)
    .bind(query)
    .bind(starred_only)
    .bind(head_len)
    .fetch_all(ex)
    .await
}

pub async fn get<'e>(ex: impl PgExecutor<'e>, id: Uuid, user: Uuid) -> Result<Option<Doc>, sqlx::Error> {
    sqlx::query_as(select_doc!("where d.id = $2")).bind(user).bind(id).fetch_optional(ex).await
}

/// Документ с блокировкой строки до конца транзакции: так проверка `rev` и запись не разойдутся
pub async fn get_for_update(conn: &mut PgConnection, id: Uuid, user: Uuid) -> Result<Option<Doc>, sqlx::Error> {
    sqlx::query_as(select_doc!("where d.id = $2 for update of d")).bind(user).bind(id).fetch_optional(conn).await
}

/// Создание и перенос документов идут по очереди: позиции соседей считаются «в начало» и «между»
pub async fn lock(conn: &mut PgConnection) -> Result<(), sqlx::Error> {
    sqlx::query("select pg_advisory_xact_lock(hashtext('docs_order'))").execute(conn).await?;
    Ok(())
}

/// Новый документ в начало списка (как createDoc в макете)
pub async fn insert(
    conn: &mut PgConnection,
    title: &str,
    md: &str,
    mode: &str,
    note: Note,
    user: Uuid,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(concat!(
        "insert into docs (title, md, mode, note_x, note_y, note_w, position, created_by, updated_by) ",
        "values ($1, $2, $3::doc_mode, $4, $5, $6, coalesce((select min(position) from docs) - 1024, 1024), $7, $7) ",
        "returning id"
    ))
    .bind(title)
    .bind(md)
    .bind(mode)
    .bind(note.x)
    .bind(note.y)
    .bind(note.w)
    .bind(user)
    .fetch_one(conn)
    .await
}

/// Что менять в содержимом. `None` — оставить как есть.
#[derive(Debug, Default)]
pub struct Patch<'a> {
    pub title: Option<&'a str>,
    pub md: Option<&'a str>,
}

/// Записывает название и текст и увеличивает `rev`. Проверку старого `rev` делает вызывающий.
pub async fn update_content(
    conn: &mut PgConnection,
    id: Uuid,
    patch: &Patch<'_>,
    user: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(concat!(
        "update docs set title = coalesce($2, title), md = coalesce($3, md), ",
        "rev = rev + 1, updated_by = $4, updated_at = now() where id = $1"
    ))
    .bind(id)
    .bind(patch.title)
    .bind(patch.md)
    .bind(user)
    .execute(conn)
    .await?;
    Ok(())
}

/// Переключает «Страница / Холст». Это вид, а не содержимое: версия и время правки не меняются.
pub async fn set_mode(conn: &mut PgConnection, id: Uuid, mode: &str) -> Result<(), sqlx::Error> {
    sqlx::query("update docs set mode = $2::doc_mode where id = $1").bind(id).bind(mode).execute(conn).await?;
    Ok(())
}

pub async fn delete(conn: &mut PgConnection, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from docs where id = $1").bind(id).execute(conn).await?;
    Ok(())
}

/// Ставит или снимает звёздочку `user`. Повторный вызов с тем же значением ничего не меняет.
pub async fn set_star(conn: &mut PgConnection, id: Uuid, user: Uuid, starred: bool) -> Result<(), sqlx::Error> {
    let sql = if starred {
        "insert into doc_stars (doc_id, user_id) values ($1, $2) on conflict do nothing"
    } else {
        "delete from doc_stars where doc_id = $1 and user_id = $2"
    };
    sqlx::query(sql).bind(id).bind(user).execute(conn).await?;
    Ok(())
}

#[derive(Debug, thiserror::Error)]
pub enum PlaceError {
    #[error("документ, перед которым нужно встать, не найден")]
    BeforeNotFound,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

/// Ставит документ перед документом `before` (None: в конец списка). Меняет только место в списке:
/// версия, текст и время правки не трогаются. Если документ уже стоит там, ничего не пишется.
/// Вызывающий держит `lock`.
pub async fn place(conn: &mut PgConnection, id: Uuid, before: Option<Uuid>) -> Result<(), PlaceError> {
    let all: Vec<(Uuid, f64)> =
        sqlx::query_as("select id, position from docs order by position, id").fetch_all(&mut *conn).await?;
    if let Some(i) = all.iter().position(|(k, _)| *k == id)
        && all.get(i + 1).map(|(k, _)| *k) == before
    {
        return Ok(());
    }

    let siblings: Vec<(Uuid, f64)> = all.into_iter().filter(|(k, _)| *k != id).collect();
    match position::place(&siblings, id, before).map_err(|_| PlaceError::BeforeNotFound)? {
        Placement::One(p) => {
            sqlx::query("update docs set position = $2 where id = $1").bind(id).bind(p).execute(&mut *conn).await?;
        }
        Placement::All(all) => {
            let (ids, positions): (Vec<Uuid>, Vec<f64>) = all.into_iter().unzip();
            sqlx::query(
                "update docs set position = v.pos from unnest($1::uuid[], $2::float8[]) as v(id, pos) \
                 where docs.id = v.id",
            )
            .bind(ids)
            .bind(positions)
            .execute(&mut *conn)
            .await?;
        }
    }
    Ok(())
}

// ----- Холст -----

/// Объекты холста указанных документов: по документам, внутри документа снизу вверх (в порядке слоёв)
pub async fn objects_of<'e>(ex: impl PgExecutor<'e>, doc_ids: &[Uuid]) -> Result<Vec<DocObject>, sqlx::Error> {
    sqlx::query_as(
        "select id, doc_id, type::text as kind, x, y, w, h, text, color from doc_objects \
         where doc_id = any($1) order by doc_id, seq",
    )
    .bind(doc_ids)
    .fetch_all(ex)
    .await
}

/// Стрелки документа: пары объектов `(от, к)`
pub async fn links_of<'e>(ex: impl PgExecutor<'e>, doc_id: Uuid) -> Result<Vec<(Uuid, Uuid)>, sqlx::Error> {
    sqlx::query_as("select a, b from doc_links where doc_id = $1 order by a, b").bind(doc_id).fetch_all(ex).await
}

#[derive(Debug, thiserror::Error)]
pub enum CanvasError {
    #[error("идентификатор объекта уже занят объектом другого документа")]
    ObjectTaken,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

/// Заменяет холст документа целиком: карточку с текстом, объекты и стрелки. Объекты, которых нет в новом списке,
/// удаляются вместе с их стрелками, остальные обновляются на месте (слой не меняется), новые добавляются сверху.
/// Меняет время правки и автора, но не версию текста. Проверку холста (`domain::docs::check_canvas`) делает вызывающий,
/// транзакцию тоже: при ошибке откатывать её должен он.
pub async fn replace_canvas(
    conn: &mut PgConnection,
    id: Uuid,
    note: Note,
    objects: &[Object],
    links: &[Link],
    user: Uuid,
) -> Result<(), CanvasError> {
    let ids: Vec<Uuid> = objects.iter().map(|o| o.id).collect();
    sqlx::query("delete from doc_objects where doc_id = $1 and id <> all($2::uuid[])")
        .bind(id)
        .bind(&ids)
        .execute(&mut *conn)
        .await?;

    if !objects.is_empty() {
        let done = sqlx::query(concat!(
            "insert into doc_objects (id, doc_id, type, x, y, w, h, text, color) ",
            "select v.id, $1, v.kind::obj_type, v.x, v.y, v.w, v.h, v.text, v.color ",
            "from unnest($2::uuid[], $3::text[], $4::float4[], $5::float4[], $6::float4[], $7::float4[], $8::text[], $9::int2[]) ",
            "as v(id, kind, x, y, w, h, text, color) ",
            "on conflict (id) do update set type = excluded.type, x = excluded.x, y = excluded.y, w = excluded.w, ",
            "h = excluded.h, text = excluded.text, color = excluded.color ",
            "where doc_objects.doc_id = excluded.doc_id"
        ))
        .bind(id)
        .bind(&ids)
        .bind(objects.iter().map(|o| o.kind.clone()).collect::<Vec<_>>())
        .bind(objects.iter().map(|o| o.x).collect::<Vec<_>>())
        .bind(objects.iter().map(|o| o.y).collect::<Vec<_>>())
        .bind(objects.iter().map(|o| o.w).collect::<Vec<_>>())
        .bind(objects.iter().map(|o| o.h).collect::<Vec<_>>())
        .bind(objects.iter().map(|o| o.text.clone()).collect::<Vec<_>>())
        .bind(objects.iter().map(|o| o.color).collect::<Vec<_>>())
        .execute(&mut *conn)
        .await?;
        // объект с чужим идентификатором не обновляется и не вставляется: строк меньше, чем объектов
        if done.rows_affected() != objects.len() as u64 {
            return Err(CanvasError::ObjectTaken);
        }
    }

    sqlx::query("delete from doc_links where doc_id = $1").bind(id).execute(&mut *conn).await?;
    if !links.is_empty() {
        sqlx::query(
            "insert into doc_links (doc_id, a, b) select $1, v.a, v.b from unnest($2::uuid[], $3::uuid[]) as v(a, b)",
        )
        .bind(id)
        .bind(links.iter().map(|l| l.a).collect::<Vec<_>>())
        .bind(links.iter().map(|l| l.b).collect::<Vec<_>>())
        .execute(&mut *conn)
        .await?;
    }

    sqlx::query(
        "update docs set note_x = $2, note_y = $3, note_w = $4, updated_by = $5, updated_at = now() where id = $1",
    )
    .bind(id)
    .bind(note.x)
    .bind(note.y)
    .bind(note.w)
    .bind(user)
    .execute(&mut *conn)
    .await?;
    Ok(())
}
