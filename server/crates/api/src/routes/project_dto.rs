//! Формы запросов и ответов про проекты, участников и приглашения (docs/PROJECTS.md, раздел 1).

use db::{
    invites::{Invite, InviteForUser, PendingInvite},
    members::Member,
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::serde_helpers::present;

// ===== Запросы =====

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateProject {
    #[schema(example = "Сайт")]
    pub name: String,
    /// Токен цвета: accent | warn | ok; без него берётся accent
    #[schema(example = "accent")]
    pub color: Option<String>,
    /// Ключ id задач (2–6 символов, латиница и цифры, с буквы); без него у задач будет `TASK`
    #[schema(example = "PLX", nullable)]
    pub key: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateProject {
    pub name: Option<String>,
    /// accent | warn | ok
    pub color: Option<String>,
    /// Ключ id задач; `null` убирает ключ
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<String>)]
    pub key: Option<Option<String>>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateMember {
    /// admin | member
    #[schema(example = "admin")]
    pub role: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateInvite {
    /// E-mail существующего аккаунта, регистр не важен
    #[schema(example = "artem@example.com")]
    pub email: String,
    /// admin | member; без него member
    #[schema(example = "member")]
    pub role: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateTag {
    #[schema(example = "Нужен дизайн")]
    pub label: Option<String>,
    /// Индекс цвета 0..7
    pub tone: Option<i16>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ProjectsQuery {
    /// `true`: архивные проекты, которыми человек управляет
    #[serde(default)]
    pub archived: bool,
}

// ===== Ответы =====

/// Участник проекта
#[derive(Debug, Serialize, ToSchema)]
pub struct MemberDto {
    pub user_id: Uuid,
    pub email: String,
    pub name: String,
    /// Подпись под именем («Frontend»)
    pub job: String,
    pub tone: i16,
    /// Глобальный администратор приложения
    pub is_admin: bool,
    /// Роль в проекте: admin | member
    #[schema(example = "member")]
    pub role: String,
    #[serde(with = "time::serde::rfc3339")]
    pub joined_at: OffsetDateTime,
}

impl From<Member> for MemberDto {
    fn from(m: Member) -> Self {
        MemberDto {
            user_id: m.user_id,
            email: m.email,
            name: m.name,
            job: m.job,
            tone: m.tone,
            is_admin: m.is_admin,
            role: m.role,
            joined_at: m.joined_at,
        }
    }
}

/// Приглашение, ожидающее ответа, глазами администратора проекта
#[derive(Debug, Serialize, ToSchema)]
pub struct PendingInviteDto {
    pub id: Uuid,
    pub user_id: Uuid,
    pub email: String,
    pub name: String,
    pub job: String,
    pub tone: i16,
    /// Роль, с которой человек войдёт: admin | member
    pub role: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

impl From<PendingInvite> for PendingInviteDto {
    fn from(p: PendingInvite) -> Self {
        PendingInviteDto {
            id: p.invite.id,
            user_id: p.invite.user_id,
            email: p.email,
            name: p.name,
            job: p.job,
            tone: p.tone,
            role: p.invite.role,
            created_at: p.invite.created_at,
        }
    }
}

/// Участники проекта; ожидающие приглашения видит только администратор (у остальных список пуст)
#[derive(Debug, Serialize, ToSchema)]
pub struct MembersDto {
    pub members: Vec<MemberDto>,
    pub invites: Vec<PendingInviteDto>,
}

/// Приглашение глазами приглашённого
#[derive(Debug, Serialize, ToSchema)]
pub struct InviteDto {
    pub id: Uuid,
    pub project_id: Uuid,
    pub project_name: String,
    /// Токен цвета проекта
    pub project_color: String,
    #[schema(nullable)]
    pub project_key: Option<String>,
    /// Кто пригласил; пусто, если он удалён
    #[schema(nullable)]
    pub invited_by_name: Option<String>,
    /// Роль, с которой человек войдёт: admin | member
    pub role: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

impl From<InviteForUser> for InviteDto {
    fn from(i: InviteForUser) -> Self {
        InviteDto {
            id: i.invite.id,
            project_id: i.invite.project_id,
            project_name: i.project_name,
            project_color: i.project_color,
            project_key: i.project_key,
            invited_by_name: i.inviter_name,
            role: i.invite.role,
            created_at: i.invite.created_at,
        }
    }
}

/// Приглашение, только что созданное администратором
#[derive(Debug, Serialize, ToSchema)]
pub struct CreatedInviteDto {
    pub id: Uuid,
    pub user_id: Uuid,
    pub role: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

impl From<Invite> for CreatedInviteDto {
    fn from(i: Invite) -> Self {
        CreatedInviteDto { id: i.id, user_id: i.user_id, role: i.role, created_at: i.created_at }
    }
}
