use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Project {
    pub id: Uuid,
    /// Префикс id задач вне модулей с ключом; `None`: у таких задач `TASK`
    pub key: Option<String>,
    pub name: String,
    pub color: String,
    /// В архиве: скрыт из списков, данные целы
    pub archived: bool,
    /// Команда, которой принадлежит проект
    pub team_id: Uuid,
    /// `members`: явные участники и администраторы команды; `team`: ещё и все члены команды
    pub visibility: String,
}

/// Проект, роль человека в нём и его положение относительно команды проекта
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct MemberProject {
    #[sqlx(flatten)]
    pub project: Project,
    /// `admin` | `member`. Администратор: явный админ проекта, администратор его команды или администратор сервера.
    pub role: String,
    /// Явный участник, который не член команды проекта (администратор сервера гостем не считается)
    pub guest: bool,
}

/// Столбцы проекта в запросах, где в `from` он назван `p`
macro_rules! project_cols {
    () => {
        "p.id, p.key, p.name, p.color, (p.archived_at is not null) as archived, p.team_id, \
         p.visibility::text as visibility"
    };
}

/// Столбцы проекта в запросах без псевдонима (`returning`, одна таблица)
macro_rules! bare_cols {
    () => {
        "id, key, name, color, (archived_at is not null) as archived, team_id, visibility::text as visibility"
    };
}

/// Доступ к проекту (docs/TEAMS.md, раздел 3.3): явный участник ИЛИ администратор команды ИЛИ (видимость «Вся команда»
/// И член команды), и команда не в архиве. Администратор сервера видит всё. Роль: высшая из оснований.
/// `$1` — проект, `$2` — человек.
macro_rules! for_user_sql {
    ($tail:literal) => {
        concat!(
            "select ",
            project_cols!(),
            ", case when u.is_admin or tm.role = 'admin' or m.role = 'admin' then 'admin' else 'member' end as role, \
                  (tm.user_id is null and not u.is_admin) as guest \
             from projects p \
             join users u on u.id = $2 \
             join teams t on t.id = p.team_id \
             left join project_members m on m.project_id = p.id and m.user_id = u.id \
             left join team_members tm on tm.team_id = p.team_id and tm.user_id = u.id \
             where p.id = $1 and (u.is_admin or (t.archived_at is null and \
                   (m.user_id is not null or tm.role = 'admin' or (p.visibility = 'team' and tm.user_id is not null))))",
            $tail
        )
    };
}

/// Проект и роль человека в нём; `None`, если проекта нет или человек его не видит
pub async fn for_user<'e>(
    ex: impl PgExecutor<'e>,
    project_id: Uuid,
    user_id: Uuid,
) -> Result<Option<MemberProject>, sqlx::Error> {
    sqlx::query_as(for_user_sql!("")).bind(project_id).bind(user_id).fetch_optional(ex).await
}

/// То же, но блокирует проект до конца транзакции: изменения доски одного проекта идут по очереди. Так два
/// одновременных переноса не посчитают позиции по устаревшему списку.
pub async fn for_user_locked(
    conn: &mut PgConnection,
    project_id: Uuid,
    user_id: Uuid,
) -> Result<Option<MemberProject>, sqlx::Error> {
    sqlx::query_as(for_user_sql!(" for update of p")).bind(project_id).bind(user_id).fetch_optional(conn).await
}

/// Проекты человека в порядке создания. Без архивных; `archived`: только архивные, которыми он управляет.
pub async fn list_for_user<'e>(
    ex: impl PgExecutor<'e>,
    user_id: Uuid,
    archived: bool,
) -> Result<Vec<MemberProject>, sqlx::Error> {
    sqlx::query_as(concat!(
        "select ",
        project_cols!(),
        ", case when u.is_admin or tm.role = 'admin' or m.role = 'admin' then 'admin' else 'member' end as role, \
              (tm.user_id is null and not u.is_admin) as guest \
         from projects p \
         join users u on u.id = $1 \
         join teams t on t.id = p.team_id \
         left join project_members m on m.project_id = p.id and m.user_id = u.id \
         left join team_members tm on tm.team_id = p.team_id and tm.user_id = u.id \
         where (p.archived_at is not null) = $2 \
           and (u.is_admin or (t.archived_at is null and ( \
                (m.user_id is not null and (not $2 or m.role = 'admin')) \
                or tm.role = 'admin' \
                or (not $2 and p.visibility = 'team' and tm.user_id is not null)))) \
         order by p.seq"
    ))
    .bind(user_id)
    .bind(archived)
    .fetch_all(ex)
    .await
}

/// Проект без проверки доступа. Только для служебных нужд (сид, тесты); ручки берут проект через `for_user`.
pub async fn get<'e>(ex: impl PgExecutor<'e>, id: Uuid) -> Result<Option<Project>, sqlx::Error> {
    sqlx::query_as(concat!("select ", bare_cols!(), " from projects where id = $1")).bind(id).fetch_optional(ex).await
}

/// Блокирует проект без проверки доступа. Только для служебных нужд и тестов базы; ручки блокируют проект через
/// `for_user_locked`.
pub async fn lock(conn: &mut PgConnection, id: Uuid) -> Result<Option<Project>, sqlx::Error> {
    sqlx::query_as(concat!("select ", bare_cols!(), " from projects where id = $1 for update"))
        .bind(id)
        .fetch_optional(conn)
        .await
}

/// Новый проект в команде; создатель становится его администратором
pub async fn insert(
    conn: &mut PgConnection,
    team_id: Uuid,
    visibility: &str,
    name: &str,
    color: &str,
    key: Option<&str>,
    created_by: Uuid,
) -> Result<Project, sqlx::Error> {
    let project: Project = sqlx::query_as(concat!(
        "insert into projects (team_id, visibility, name, color, key, created_by) \
         values ($1, $2::project_visibility, $3, $4, $5, $6) returning ",
        bare_cols!()
    ))
    .bind(team_id)
    .bind(visibility)
    .bind(name)
    .bind(color)
    .bind(key)
    .bind(created_by)
    .fetch_one(&mut *conn)
    .await?;
    crate::members::add(conn, project.id, created_by, "admin").await?;
    Ok(project)
}

/// Что меняется у проекта. `None`: не трогать; у ключа внешний `Some(None)` означает «убрать ключ».
#[derive(Debug, Clone, Default)]
pub struct ProjectPatch {
    pub name: Option<String>,
    pub color: Option<String>,
    pub key: Option<Option<String>>,
}

pub async fn update(conn: &mut PgConnection, id: Uuid, p: &ProjectPatch) -> Result<Project, sqlx::Error> {
    sqlx::query_as(concat!(
        "update projects set name = coalesce($2, name), color = coalesce($3, color), \
                key = case when $4 then $5 else key end \
         where id = $1 returning ",
        bare_cols!()
    ))
    .bind(id)
    .bind(p.name.as_deref())
    .bind(p.color.as_deref())
    .bind(p.key.is_some())
    .bind(p.key.as_ref().and_then(|k| k.as_deref()))
    .fetch_one(conn)
    .await
}

pub async fn set_archived(conn: &mut PgConnection, id: Uuid, archived: bool) -> Result<Project, sqlx::Error> {
    sqlx::query_as(concat!(
        "update projects set archived_at = case when $2 then coalesce(archived_at, now()) end where id = $1 returning ",
        bare_cols!()
    ))
    .bind(id)
    .bind(archived)
    .fetch_one(conn)
    .await
}

/// Занят ли ключ модулем этого проекта (ключ проекта не может совпадать с ключом модуля)
pub async fn module_has_key<'e>(ex: impl PgExecutor<'e>, project_id: Uuid, key: &str) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select exists (select 1 from modules where project_id = $1 and key = $2)")
        .bind(project_id)
        .bind(key)
        .fetch_one(ex)
        .await
}

/// Следующий свободный номер задач проекта (WEB-159). Вызывать внутри транзакции после блокировки проекта.
pub async fn next_number(conn: &mut PgConnection, id: Uuid) -> Result<i32, sqlx::Error> {
    sqlx::query_scalar("update projects set last_number = last_number + 1 where id = $1 returning last_number")
        .bind(id)
        .fetch_one(conn)
        .await
}
