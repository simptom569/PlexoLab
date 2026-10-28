//! Доступ к проектам и к вики команды: единственное место, где ручки получают проект и команду (docs/TEAMS.md, раздел 3).
//!
//! Проект видят: явные участники, администраторы его команды и, при видимости «Вся команда», члены команды; команда не
//! в архиве. Администратор сервера видит всё. Всем остальным проекта «нет»: ответ такой же, как для несуществующего
//! (404), чтобы не раскрывать, что он есть. Участник без прав администратора на действие, требующее их, получает 403:
//! проект он и так видит. Ручки не обращаются к `db::projects` напрямую (это проверяет тест
//! `routes_get_projects_only_through_access`), а значит забыть проверку труднее, чем сделать.
//!
//! Вики и библиотеку файлов читает член команды, гость проекта команды при включённой настройке и администратор сервера;
//! пишет только член команды (и администратор сервера). Кто не может читать, получает 404; кто читает, но не пишет, 403.

use db::sqlx::{PgConnection, PgExecutor};
use domain::projects::Role;
use uuid::Uuid;

use crate::{
    error::{ApiError, ApiResult},
    events,
    extract::AuthUser,
};

/// Проект и роль человека в нём
#[derive(Debug, Clone)]
pub struct Access {
    pub project: db::projects::Project,
    /// Роль в проекте: высшая из оснований. Администратором считаются явный админ проекта, администратор команды
    /// проекта и администратор сервера.
    pub role: Role,
    /// Явный участник, который не член команды проекта
    pub guest: bool,
}

impl Access {
    pub fn is_admin(&self) -> bool {
        self.role == Role::Admin
    }

    /// Действие только для администратора проекта
    pub fn require_admin(&self) -> ApiResult<()> {
        if self.is_admin() { Ok(()) } else { Err(ApiError::Forbidden) }
    }
}

impl From<db::projects::MemberProject> for Access {
    fn from(found: db::projects::MemberProject) -> Self {
        // в базе роль только из двух значений; неизвестное считаем самой слабой
        let role = Role::parse(&found.role).unwrap_or(Role::Member);
        Access { project: found.project, role, guest: found.guest }
    }
}

/// Проект для чтения. Событие, которое вызовет запрос, уйдёт только тем, кто видит проект.
pub async fn project<'e>(ex: impl PgExecutor<'e>, user: AuthUser, project_id: Uuid) -> ApiResult<Access> {
    let found = db::projects::for_user(ex, project_id, user.id).await?.ok_or(ApiError::NotFound)?;
    events::note_project(project_id);
    Ok(found.into())
}

/// То же, но блокирует проект до конца транзакции (все изменения доски идут через него)
pub async fn project_locked(conn: &mut PgConnection, user: AuthUser, project_id: Uuid) -> ApiResult<Access> {
    let found = db::projects::for_user_locked(conn, project_id, user.id).await?.ok_or(ApiError::NotFound)?;
    events::note_project(project_id);
    Ok(found.into())
}

/// Проект для действия администратора; блокирует его до конца транзакции
pub async fn admin_locked(conn: &mut PgConnection, user: AuthUser, project_id: Uuid) -> ApiResult<Access> {
    let access = project_locked(conn, user, project_id).await?;
    access.require_admin()?;
    Ok(access)
}

/// Проект для чтения администратором (список приглашений и т. п.)
pub async fn admin<'e>(ex: impl PgExecutor<'e>, user: AuthUser, project_id: Uuid) -> ApiResult<Access> {
    let access = project(ex, user, project_id).await?;
    access.require_admin()?;
    Ok(access)
}

// ===== Команды =====

/// Команда и положение в ней человека
#[derive(Debug, Clone)]
pub struct TeamAccess {
    pub team: db::teams::Team,
    /// Роль в команде, если человек её член
    pub role: Option<Role>,
    /// Не член, но явный участник проекта этой команды
    pub guest: bool,
    pub server_admin: bool,
}

impl TeamAccess {
    /// Читает вики и библиотеку: член, гость при включённой настройке, администратор сервера
    pub fn can_read_wiki(&self) -> bool {
        self.server_admin || self.role.is_some() || (self.guest && self.team.guests_read_wiki)
    }

    /// Правит вики и библиотеку: член команды и администратор сервера. Гость никогда.
    pub fn can_write_wiki(&self) -> bool {
        self.server_admin || self.role.is_some()
    }

    /// Член команды или администратор сервера: видит состав и настройки (гостю и постороннему их знать незачем)
    pub fn is_member(&self) -> bool {
        self.server_admin || self.role.is_some()
    }

    /// Управляет командой: её администратор или администратор сервера
    pub fn is_admin(&self) -> bool {
        self.server_admin || self.role == Some(Role::Admin)
    }
}

impl From<db::teams::TeamForUser> for TeamAccess {
    fn from(found: db::teams::TeamForUser) -> Self {
        let role = found.role.as_deref().and_then(Role::parse);
        TeamAccess { team: found.team, role, guest: found.guest, server_admin: found.server_admin }
    }
}

/// Команда, которую человек видит (член, гость, администратор сервера); остальным её «нет»
pub async fn team<'e>(ex: impl PgExecutor<'e>, user: AuthUser, team_id: Uuid) -> ApiResult<TeamAccess> {
    let found = db::teams::for_user(ex, team_id, user.id).await?.ok_or(ApiError::NotFound)?;
    events::note_team(team_id);
    Ok(found.into())
}

/// Команда для члена: гость и посторонний её «не видят» (состав команды им не показывают)
pub async fn team_member<'e>(ex: impl PgExecutor<'e>, user: AuthUser, team_id: Uuid) -> ApiResult<TeamAccess> {
    let access = team(ex, user, team_id).await?;
    if access.is_member() { Ok(access) } else { Err(ApiError::NotFound) }
}

/// Команда для действия администратора команды: член без прав получает 403, гость и посторонний 404
pub async fn team_admin<'e>(ex: impl PgExecutor<'e>, user: AuthUser, team_id: Uuid) -> ApiResult<TeamAccess> {
    let access = team_member(ex, user, team_id).await?;
    if access.is_admin() { Ok(access) } else { Err(ApiError::Forbidden) }
}

/// То же, но находит и архивную команду: администратор может вернуть её из архива
pub async fn team_admin_incl_archived<'e>(
    ex: impl PgExecutor<'e>,
    user: AuthUser,
    team_id: Uuid,
) -> ApiResult<TeamAccess> {
    let found = db::teams::for_admin_incl_archived(ex, team_id, user.id).await?.ok_or(ApiError::NotFound)?;
    events::note_team(team_id);
    let access = TeamAccess::from(found);
    if !access.is_member() {
        return Err(ApiError::NotFound);
    }
    if access.is_admin() { Ok(access) } else { Err(ApiError::Forbidden) }
}

/// Администратор сервера. Остальным 403: адрес есть, но он не для них.
pub async fn server_admin<'e>(ex: impl PgExecutor<'e>, user: AuthUser) -> ApiResult<()> {
    let found = db::users::is_admin(ex, user.id).await?;
    if found { Ok(()) } else { Err(ApiError::Forbidden) }
}

/// Команда для чтения вики и файлов
pub async fn wiki_read<'e>(ex: impl PgExecutor<'e>, user: AuthUser, team_id: Uuid) -> ApiResult<TeamAccess> {
    let access = team(ex, user, team_id).await?;
    if access.can_read_wiki() { Ok(access) } else { Err(ApiError::NotFound) }
}

/// Команда для записи в вики и файлы: кто её читает, но не пишет (гость), получает 403
pub async fn wiki_write<'e>(ex: impl PgExecutor<'e>, user: AuthUser, team_id: Uuid) -> ApiResult<TeamAccess> {
    let access = wiki_read(ex, user, team_id).await?;
    if access.can_write_wiki() { Ok(access) } else { Err(ApiError::Forbidden) }
}
