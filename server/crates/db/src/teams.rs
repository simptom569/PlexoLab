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

// ===== Команды: создание, правка, архив (этап К2) =====

/// Сколько обычных команд создал человек. «Личное» не считается, архивные считаются: архив не освобождает место, иначе
/// лимит обходился бы «создал, заархивировал, создал».
pub async fn count_created<'e>(ex: impl PgExecutor<'e>, user_id: Uuid) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("select count(*) from teams where created_by = $1 and personal_for is null")
        .bind(user_id)
        .fetch_one(ex)
        .await
}

/// Команда для её администратора, в том числе архивная: чтобы вернуть из архива. Остальным то же, что в [`for_user`].
pub async fn for_admin_incl_archived<'e>(
    ex: impl PgExecutor<'e>,
    team_id: Uuid,
    user_id: Uuid,
) -> Result<Option<TeamForUser>, sqlx::Error> {
    sqlx::query_as(team_for_user_sql!(
        "*",
        "where id = $2 and (server_admin or role = 'admin' or (not archived and (role is not null or guest)))"
    ))
    .bind(user_id)
    .bind(team_id)
    .fetch_optional(ex)
    .await
}

/// Архивные команды, которыми человек управляет (окно «Архив проектов», раздел «Команды»)
pub async fn list_archived_for_admin<'e>(
    ex: impl PgExecutor<'e>,
    user_id: Uuid,
) -> Result<Vec<TeamForUser>, sqlx::Error> {
    sqlx::query_as(team_for_user_sql!("*", "where archived and role = 'admin' order by seq"))
        .bind(user_id)
        .fetch_all(ex)
        .await
}

/// Очередь создателей: два одновременных запроса одного человека не проскочат лимит команд вдвоём
pub async fn lock_creator(conn: &mut PgConnection, user_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("select pg_advisory_xact_lock(hashtext('team_creator'), hashtext(($1::uuid)::text))")
        .bind(user_id)
        .execute(conn)
        .await?;
    Ok(())
}

/// Блокирует команду до конца транзакции: правки состава идут по очереди, поэтому проверка «последний администратор»
/// не разойдётся с записью
pub async fn lock(conn: &mut PgConnection, team_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("select id from teams where id = $1 for update").bind(team_id).execute(conn).await?;
    Ok(())
}

/// Что меняется у команды. `None`: не трогать.
#[derive(Debug, Clone, Default)]
pub struct TeamPatch {
    pub name: Option<String>,
    pub guests_read_wiki: Option<bool>,
}

pub async fn update(conn: &mut PgConnection, id: Uuid, p: &TeamPatch) -> Result<Team, sqlx::Error> {
    sqlx::query_as(
        "update teams set name = coalesce($2, name), guests_read_wiki = coalesce($3, guests_read_wiki) \
         where id = $1 returning id, name, personal_for, guests_read_wiki, (archived_at is not null) as archived",
    )
    .bind(id)
    .bind(p.name.as_deref())
    .bind(p.guests_read_wiki)
    .fetch_one(conn)
    .await
}

pub async fn set_archived(conn: &mut PgConnection, id: Uuid, archived: bool) -> Result<Team, sqlx::Error> {
    sqlx::query_as(
        "update teams set archived_at = case when $2 then coalesce(archived_at, now()) end where id = $1 \
         returning id, name, personal_for, guests_read_wiki, (archived_at is not null) as archived",
    )
    .bind(id)
    .bind(archived)
    .fetch_one(conn)
    .await
}

// ===== Участники =====

/// Член команды вместе со сведениями об аккаунте
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct TeamMember {
    pub user_id: Uuid,
    pub email: String,
    pub name: String,
    /// Подпись под именем («Frontend»)
    pub job: String,
    pub tone: i16,
    /// admin | member
    pub role: String,
    pub joined_at: time::OffsetDateTime,
}

/// Члены команды: сначала администраторы, потом по времени входа
pub async fn members<'e>(ex: impl PgExecutor<'e>, team_id: Uuid) -> Result<Vec<TeamMember>, sqlx::Error> {
    sqlx::query_as(
        "select u.id as user_id, u.email, u.name, u.role as job, u.tone, m.role::text as role, m.created_at as joined_at \
         from team_members m join users u on u.id = m.user_id \
         where m.team_id = $1 \
         order by (m.role = 'admin') desc, m.created_at, u.id",
    )
    .bind(team_id)
    .fetch_all(ex)
    .await
}

/// Роль человека в команде (`admin` | `member`), если он её член
pub async fn member_role<'e>(
    ex: impl PgExecutor<'e>,
    team_id: Uuid,
    user_id: Uuid,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("select role::text from team_members where team_id = $1 and user_id = $2")
        .bind(team_id)
        .bind(user_id)
        .fetch_optional(ex)
        .await
}

pub async fn add_member(conn: &mut PgConnection, team_id: Uuid, user_id: Uuid, role: &str) -> Result<(), sqlx::Error> {
    sqlx::query("insert into team_members (team_id, user_id, role) values ($1, $2, $3::team_role)")
        .bind(team_id)
        .bind(user_id)
        .bind(role)
        .execute(conn)
        .await?;
    Ok(())
}

/// Меняет роль; `false`, если человек не член команды
pub async fn set_member_role(
    conn: &mut PgConnection,
    team_id: Uuid,
    user_id: Uuid,
    role: &str,
) -> Result<bool, sqlx::Error> {
    let done = sqlx::query("update team_members set role = $3::team_role where team_id = $1 and user_id = $2")
        .bind(team_id)
        .bind(user_id)
        .bind(role)
        .execute(conn)
        .await?;
    Ok(done.rows_affected() > 0)
}

/// Убирает человека из команды и из всех явных участий в её проектах (docs/TEAMS.md, 4.4). Гостей не касается: гость не
/// член команды, из неё его никто не убирает. Имя на старых задачах остаётся. `false`, если он не был членом.
pub async fn remove_member(conn: &mut PgConnection, team_id: Uuid, user_id: Uuid) -> Result<bool, sqlx::Error> {
    let done = sqlx::query("delete from team_members where team_id = $1 and user_id = $2")
        .bind(team_id)
        .bind(user_id)
        .execute(&mut *conn)
        .await?;
    if done.rows_affected() == 0 {
        return Ok(false);
    }
    sqlx::query(
        "delete from project_members m using projects p \
         where m.project_id = p.id and p.team_id = $1 and m.user_id = $2",
    )
    .bind(team_id)
    .bind(user_id)
    .execute(conn)
    .await?;
    Ok(true)
}

/// Сколько администраторов в команде
pub async fn admin_count<'e>(ex: impl PgExecutor<'e>, team_id: Uuid) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("select count(*) from team_members where team_id = $1 and role = 'admin'")
        .bind(team_id)
        .fetch_one(ex)
        .await
}

/// Все члены команды (для адресных событий)
pub async fn member_ids<'e>(ex: impl PgExecutor<'e>, team_id: Uuid) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar("select user_id from team_members where team_id = $1").bind(team_id).fetch_all(ex).await
}

/// Гости команды: явные участники её проектов, которые не члены команды (для адресных событий)
pub async fn guest_ids<'e>(ex: impl PgExecutor<'e>, team_id: Uuid) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        "select distinct m.user_id from project_members m join projects p on p.id = m.project_id \
         where p.team_id = $1 and not exists (select 1 from team_members t where t.team_id = $1 and t.user_id = m.user_id)",
    )
    .bind(team_id)
    .fetch_all(ex)
    .await
}

// ===== Для администратора сервера =====

/// Команда в списке «Все команды сервера»
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct AdminTeam {
    pub id: Uuid,
    pub name: String,
    pub personal_for: Option<Uuid>,
    /// Имя владельца личной команды
    pub owner_name: Option<String>,
    pub archived: bool,
    pub member_count: i64,
    pub project_count: i64,
    pub created_at: time::OffsetDateTime,
}

/// Все команды сервера, найденные по части названия (регистр не важен; пусто: все). «Личное» ищется ещё по имени и
/// e-mail владельца: у всех оно называется одинаково.
pub async fn list_all<'e>(ex: impl PgExecutor<'e>, q: Option<&str>, limit: i64) -> Result<Vec<AdminTeam>, sqlx::Error> {
    sqlx::query_as(
        "select t.id, t.name, t.personal_for, o.name as owner_name, (t.archived_at is not null) as archived, \
                (select count(*) from team_members m where m.team_id = t.id) as member_count, \
                (select count(*) from projects p where p.team_id = t.id) as project_count, \
                t.created_at \
         from teams t left join users o on o.id = t.personal_for \
         where $1::text is null \
            or position(lower($1) in lower(t.name)) > 0 \
            or (o.id is not null and (position(lower($1) in lower(o.name)) > 0 or position(lower($1) in lower(o.email)) > 0)) \
         order by (t.personal_for is not null), t.seq limit $2",
    )
    .bind(q)
    .bind(limit)
    .fetch_all(ex)
    .await
}
