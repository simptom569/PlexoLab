//! Команды (docs/TEAMS.md): общая вики и библиотека файлов, люди, место для проектов.
//!
//! Команду человек видит, если он её член, если он гость (явный участник проекта этой команды, но не член) или если он
//! администратор сервера. Архивную команду не видит никто, кроме администратора сервера.

use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

/// Название личной команды, которую триггер базы создаёт вместе с аккаунтом
pub const PERSONAL_NAME: &str = "Личное";

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Team {
    pub id: Uuid,
    pub name: String,
    /// Чья это личная команда «Личное»; у обычной пусто
    pub personal_for: Option<Uuid>,
    /// Гости проектов команды (не члены) могут читать её вики и библиотеку
    pub guests_read_wiki: bool,
    pub archived: bool,
}

/// Команда и положение в ней конкретного человека
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct TeamForUser {
    #[sqlx(flatten)]
    pub team: Team,
    /// `admin` | `member`, если человек член команды
    pub role: Option<String>,
    /// Не член команды, но явный участник одного из её проектов
    pub guest: bool,
    /// Администратор сервера: видит и правит всё
    pub server_admin: bool,
}

/// Команды человека с его положением в каждой. Колонки одинаковые у одной и многих команд, поэтому запрос собирается
/// макросом; фильтр и порядок дописывает вызывающий.
macro_rules! team_for_user_sql {
    ($cols:literal, $tail:literal) => {
        concat!(
            "select ",
            $cols,
            " from ( \
               select t.id, t.name, t.personal_for, t.guests_read_wiki, (t.archived_at is not null) as archived, \
                      t.seq, tm.role::text as role, \
                      (tm.user_id is null and exists ( \
                         select 1 from project_members m join projects p on p.id = m.project_id \
                         where m.user_id = u.id and p.team_id = t.id and p.archived_at is null)) as guest, \
                      u.is_admin as server_admin \
               from teams t \
               join users u on u.id = $1 \
               left join team_members tm on tm.team_id = t.id and tm.user_id = u.id \
             ) x ",
            $tail
        )
    };
}

/// Команда для человека; `None`, если её нет или она ему не видна (посторонний, архивная)
pub async fn for_user<'e>(
    ex: impl PgExecutor<'e>,
    team_id: Uuid,
    user_id: Uuid,
) -> Result<Option<TeamForUser>, sqlx::Error> {
    sqlx::query_as(team_for_user_sql!(
        "*",
        "where id = $2 and (server_admin or (not archived and (role is not null or guest)))"
    ))
    .bind(user_id)
    .bind(team_id)
    .fetch_optional(ex)
    .await
}

/// Команды человека: те, где он член, и те, где он гость. Личная первой, гостевые в конце. Администратор сервера видит
/// здесь только свои (остальные ему открывает отдельный список).
pub async fn list_for_user<'e>(ex: impl PgExecutor<'e>, user_id: Uuid) -> Result<Vec<TeamForUser>, sqlx::Error> {
    sqlx::query_as(team_for_user_sql!(
        "*",
        "where not archived and (role is not null or guest) \
         order by (role is null), (personal_for is null), seq"
    ))
    .bind(user_id)
    .fetch_all(ex)
    .await
}

/// Команды, события вики которых получает человек: он их член, он гость при включённой настройке, он администратор сервера
pub async fn wiki_ids<'e>(ex: impl PgExecutor<'e>, user_id: Uuid) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar("select id from teams where can_read_team(id, $1)").bind(user_id).fetch_all(ex).await
}

/// Личная команда человека
pub async fn personal_of<'e>(ex: impl PgExecutor<'e>, user_id: Uuid) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar("select id from teams where personal_for = $1").bind(user_id).fetch_optional(ex).await
}

/// Команда по id без проверки доступа. Только для служебных нужд (сид, тесты); ручки берут команду через `for_user`.
pub async fn get<'e>(ex: impl PgExecutor<'e>, id: Uuid) -> Result<Option<Team>, sqlx::Error> {
    sqlx::query_as(
        "select id, name, personal_for, guests_read_wiki, (archived_at is not null) as archived from teams where id = $1",
    )
    .bind(id)
    .fetch_optional(ex)
    .await
}

/// Новая обычная команда; создатель становится её администратором
pub async fn insert(conn: &mut PgConnection, name: &str, created_by: Uuid) -> Result<Team, sqlx::Error> {
    let team: Team = sqlx::query_as(
        "insert into teams (name, created_by) values ($1, $2) \
         returning id, name, personal_for, guests_read_wiki, (archived_at is not null) as archived",
    )
    .bind(name)
    .bind(created_by)
    .fetch_one(&mut *conn)
    .await?;
    sqlx::query("insert into team_members (team_id, user_id, role) values ($1, $2, 'admin')")
        .bind(team.id)
        .bind(created_by)
        .execute(conn)
        .await?;
    Ok(team)
}
