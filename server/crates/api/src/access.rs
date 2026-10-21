//! Доступ к проектам: единственное место, где ручки получают проект (docs/PROJECTS.md, раздел 5).
//!
//! Проект видят его участники и глобальные администраторы. Всем остальным его «нет»: ответ такой же, как для
//! несуществующего проекта (404), чтобы не раскрывать, что он есть. Участник без прав администратора на действие,
//! требующее их, получает 403: проект он и так видит. Ручки не обращаются к `db::projects` напрямую (это проверяет
//! тест `routes_get_projects_only_through_access`), а значит забыть проверку труднее, чем сделать.

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
    /// Роль в проекте; у глобального администратора всегда администратор
    pub role: Role,
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
        Access { project: found.project, role }
    }
}

/// Доступ к вики и файлам вики. Вики общая для всех вошедших; все её ручки проверяют доступ здесь, поэтому когда
/// появится «команда» (docs/PROJECTS.md, раздел 7), членство в ней проверится в одном месте.
pub fn wiki(_user: AuthUser) -> ApiResult<()> {
    Ok(())
}

/// Проект для чтения. Событие, которое вызовет запрос, уйдёт только участникам проекта.
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
