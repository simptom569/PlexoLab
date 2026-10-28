use sqlx::{PgConnection, PgExecutor, PgPool, Row};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub role: String,
    pub tone: i16,
    pub is_admin: bool,
    pub password_hash: String,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct NewUser {
    /// Уже приведён к нижнему регистру (domain::auth::normalize_email)
    pub email: String,
    pub name: String,
    pub role: String,
    pub tone: i16,
    pub is_admin: bool,
    pub password_hash: String,
}

#[derive(Debug, thiserror::Error)]
pub enum CreateUserError {
    #[error("пользователь с таким e-mail уже есть")]
    EmailTaken,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

// sqlx 0.9 принимает только статические строки SQL, поэтому список колонок собирается макросом
macro_rules! select_user {
    ($tail:literal) => {
        concat!("select id, email, name, role, tone, is_admin, password_hash, created_at from users ", $tail)
    };
}

pub async fn create(pool: &PgPool, u: &NewUser) -> Result<User, CreateUserError> {
    sqlx::query_as::<_, User>(
        "insert into users (email, name, role, tone, is_admin, password_hash) \
         values ($1, $2, $3, $4, $5, $6) \
         returning id, email, name, role, tone, is_admin, password_hash, created_at",
    )
    .bind(&u.email)
    .bind(&u.name)
    .bind(&u.role)
    .bind(u.tone)
    .bind(u.is_admin)
    .bind(&u.password_hash)
    .fetch_one(pool)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(d) if d.is_unique_violation() => CreateUserError::EmailTaken,
        _ => CreateUserError::Db(e),
    })
}

#[derive(Debug, thiserror::Error)]
pub enum ChangePasswordError {
    #[error("пользователь с таким e-mail не найден")]
    NotFound,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

/// Меняет пароль пользователя и завершает все его сессии: refresh-токены удаляются, и войти по старым
/// нельзя. Уже выданные токены доступа действуют до конца своего срока (до 12 часов).
/// `email` должен быть в нижнем регистре.
pub async fn change_password(pool: &PgPool, email: &str, password_hash: &str) -> Result<User, ChangePasswordError> {
    let mut tx = pool.begin().await?;
    let user: User = sqlx::query_as(
        "update users set password_hash = $2 where email = $1 \
         returning id, email, name, role, tone, is_admin, password_hash, created_at",
    )
    .bind(email)
    .bind(password_hash)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ChangePasswordError::NotFound)?;
    crate::tokens::delete_all_for_user(&mut *tx, user.id).await?;
    tx.commit().await?;
    Ok(user)
}

/// Заменяет только хэш пароля. Сессии не трогает: чьи сессии и когда завершать, решает вызывающий
/// (при смене пароля из приложения текущую сессию заменяют новой, остальные завершают).
pub async fn set_password(conn: &mut PgConnection, id: Uuid, password_hash: &str) -> Result<(), sqlx::Error> {
    sqlx::query("update users set password_hash = $2 where id = $1").bind(id).bind(password_hash).execute(conn).await?;
    Ok(())
}

/// Правка профиля самим человеком. Не заданное (`None`) остаётся как было; пустая строка в `role` очищает подпись.
/// `None` в ответе — такого пользователя нет.
pub async fn update_profile(
    pool: &PgPool,
    id: Uuid,
    name: Option<&str>,
    role: Option<&str>,
    tone: Option<i16>,
) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(
        "update users set name = coalesce($2, name), role = coalesce($3, role), tone = coalesce($4, tone) \
         where id = $1 \
         returning id, email, name, role, tone, is_admin, password_hash, created_at",
    )
    .bind(id)
    .bind(name)
    .bind(role)
    .bind(tone)
    .fetch_optional(pool)
    .await
}

pub async fn find_by_email(pool: &PgPool, email: &str) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(select_user!("where email = $1")).bind(email).fetch_optional(pool).await
}

pub async fn find_by_id(pool: &PgPool, id: Uuid) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(select_user!("where id = $1")).bind(id).fetch_optional(pool).await
}

/// Администратор ли сервера
pub async fn is_admin<'e>(ex: impl PgExecutor<'e>, id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select coalesce((select is_admin from users where id = $1), false)").bind(id).fetch_one(ex).await
}

/// Есть ли такой пользователь. Работает и внутри транзакции.
pub async fn exists<'e>(ex: impl PgExecutor<'e>, id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select exists (select 1 from users where id = $1)").bind(id).fetch_one(ex).await
}

/// Имена людей по id (для текста уведомлений); кого нет, тех в ответе нет
pub async fn names<'e>(ex: impl PgExecutor<'e>, ids: &[Uuid]) -> Result<Vec<(Uuid, String)>, sqlx::Error> {
    sqlx::query_as("select id, name from users where id = any($1)").bind(ids).fetch_all(ex).await
}

/// Все аккаунты сервера в порядке добавления. Только для служебных нужд (сид, тесты); ручки отдают `list_visible`.
pub async fn list(pool: &PgPool) -> Result<Vec<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(select_user!("order by seq")).fetch_all(pool).await
}

/// Человек из списка «кого я вижу» и можно ли показать его e-mail
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct VisibleUser {
    #[sqlx(flatten)]
    pub user: User,
    pub email_visible: bool,
}

/// Люди, которых видит `viewer` (docs/TEAMS.md, раздел 8): он сам, члены его команд, участники проектов, к которым у него
/// есть доступ, и те, чьи имена остались на видимых ему данных (комментарии, задачи, события, страницы вики, файлы),
/// хоть бы они уже ушли. Администратор сервера видит всех. E-mail виден: самому человеку; администратору команды у всех её
/// членов; администратору проекта (явному, администратору его команды или сервера) у явных участников проекта.
pub async fn list_visible(pool: &PgPool, viewer: Uuid) -> Result<Vec<VisibleUser>, sqlx::Error> {
    sqlx::query_as(
        "with viewer as (select id, is_admin from users where id = $1), \
              vp as (select p.id from projects p where can_access_project(p.id, $1)), \
              rt as (select t.id from teams t where can_read_team(t.id, $1)), \
              my_teams as (select tm.team_id, tm.role from team_members tm join teams t on t.id = tm.team_id \
                           where tm.user_id = $1 and t.archived_at is null), \
              seen as ( \
                select id from viewer \
                union select user_id from team_members where team_id in (select team_id from my_teams) \
                union select user_id from project_members where project_id in (select id from vp) \
                union select actor_id from activity where project_id in (select id from vp) \
                                                         or team_id in (select id from rt) \
                union select c.author_id from comments c join tasks k on k.id = c.task_id \
                      where k.project_id in (select id from vp) \
                union select assignee_id from tasks where assignee_id is not null and project_id in (select id from vp) \
                union select created_by from tasks where created_by is not null and project_id in (select id from vp) \
                union select lead_id from modules where lead_id is not null and project_id in (select id from vp) \
                union select created_by from docs where created_by is not null and project_id in (select id from vp) \
                union select updated_by from docs where updated_by is not null and project_id in (select id from vp) \
                union select updated_by from wiki_pages where updated_by is not null and team_id in (select id from rt) \
                union select f.uploader_id from files f \
                      where f.uploader_id is not null \
                        and (f.team_id in (select id from rt) \
                             or f.task_id in (select id from tasks where project_id in (select id from vp))) \
                union select actor_id from notifications where user_id = $1 and actor_id is not null \
              ), \
              email_ok as ( \
                select id from viewer \
                union select tm.user_id from team_members tm \
                      where tm.team_id in (select team_id from my_teams where role = 'admin') \
                union select pm.user_id from project_members pm join projects p on p.id = pm.project_id \
                      join users v on v.id = $1 \
                      left join project_members me on me.project_id = p.id and me.user_id = v.id \
                      left join team_members vt on vt.team_id = p.team_id and vt.user_id = v.id \
                      where p.id in (select id from vp) and (v.is_admin or vt.role = 'admin' or me.role = 'admin') \
              ) \
         select u.id, u.email, u.name, u.role, u.tone, u.is_admin, u.password_hash, u.created_at, \
                (v.is_admin or u.id in (select id from email_ok)) as email_visible \
         from users u cross join viewer v \
         where v.is_admin or u.id in (select id from seen) \
         order by u.seq",
    )
    .bind(viewer)
    .fetch_all(pool)
    .await
}

pub async fn count(pool: &PgPool) -> Result<i64, sqlx::Error> {
    sqlx::query("select count(*) from users").fetch_one(pool).await?.try_get(0)
}
