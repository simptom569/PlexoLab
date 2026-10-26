//! Формы запросов и ответов доски. Даты `ГГГГ-ММ-ДД`, время RFC 3339.

use db::{
    columns::Column,
    comments::Comment,
    files::TaskFile,
    modules,
    projects::Project,
    releases::{Release, ReleaseItem},
    subtasks::Subtask,
    tags::Tag,
};
use domain::board::{id_prefix, task_key};
use serde::{Deserialize, Serialize};
use time::{Date, OffsetDateTime};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::serde_helpers::{iso_date, present};

// ===== Ответы =====

#[derive(Debug, Serialize, ToSchema)]
pub struct ProjectDto {
    pub id: Uuid,
    /// Ключ проекта: префикс id задач вне модулей с ключом. Без ключа у таких задач `TASK`.
    #[schema(example = "WEB", nullable)]
    pub key: Option<String>,
    #[schema(example = "Web-приложение")]
    pub name: String,
    /// Токен цвета: accent | warn | ok
    #[schema(example = "accent")]
    pub color: String,
    /// Роль текущего человека в проекте: admin | member (у глобального админа всегда admin)
    #[schema(example = "member")]
    pub role: String,
    /// Проект в архиве
    pub archived: bool,
}

impl ProjectDto {
    pub fn new(p: Project, role: &str) -> Self {
        ProjectDto { id: p.id, key: p.key, name: p.name, color: p.color, role: role.to_owned(), archived: p.archived }
    }
}

impl From<db::projects::MemberProject> for ProjectDto {
    fn from(m: db::projects::MemberProject) -> Self {
        ProjectDto::new(m.project, &m.role)
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ColumnDto {
    pub id: Uuid,
    pub project_id: Uuid,
    #[schema(example = "На ревью")]
    pub title: String,
    /// Токен цвета: muted | accent | warn | ok | b-fg | e-fg
    pub color: String,
    /// Колонка считается «Готово»
    pub is_done: bool,
    /// Порядок слева направо
    pub position: f64,
}

impl From<Column> for ColumnDto {
    fn from(c: Column) -> Self {
        ColumnDto {
            id: c.id,
            project_id: c.project_id,
            title: c.title,
            color: c.color,
            is_done: c.is_done,
            position: c.position,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TagDto {
    pub id: Uuid,
    pub project_id: Uuid,
    #[schema(example = "Баг")]
    pub label: String,
    /// Индекс цвета в TONES (0..7)
    pub tone: i16,
}

impl From<Tag> for TagDto {
    fn from(t: Tag) -> Self {
        TagDto { id: t.id, project_id: t.project_id, label: t.label, tone: t.tone }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ModuleDto {
    pub id: Uuid,
    pub title: String,
    /// Ключ задач (префикс id у задач модуля, `SEO-3`); null: задачи нумеруются рядом проекта
    #[schema(example = "SEO", nullable)]
    pub key: Option<String>,
    pub lead_id: Option<Uuid>,
    /// plan | progress | done
    pub status: String,
    #[serde(with = "iso_date::option")]
    pub date_from: Option<Date>,
    #[serde(with = "iso_date::option")]
    pub date_to: Option<Date>,
    pub note: String,
    /// Все задачи модуля, включая бэклог
    pub tasks_total: i64,
    /// Задачи в колонках с отметкой «Готово»
    pub tasks_done: i64,
}

impl From<modules::Module> for ModuleDto {
    fn from(m: modules::Module) -> Self {
        ModuleDto {
            id: m.id,
            title: m.title,
            key: m.key,
            lead_id: m.lead_id,
            status: m.status,
            date_from: m.date_from,
            date_to: m.date_to,
            note: m.note,
            tasks_total: m.tasks_total,
            tasks_done: m.tasks_done,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MilestoneDto {
    pub id: Uuid,
    pub title: String,
    #[serde(with = "iso_date")]
    pub due_date: Date,
    /// Все задачи вехи, включая бэклог
    pub tasks_total: i64,
    /// Задачи в колонках с отметкой «Готово»
    pub tasks_done: i64,
}

impl From<modules::Milestone> for MilestoneDto {
    fn from(m: modules::Milestone) -> Self {
        MilestoneDto {
            id: m.id,
            title: m.title,
            due_date: m.due_date,
            tasks_total: m.tasks_total,
            tasks_done: m.tasks_done,
        }
    }
}

/// Шаг чек-листа релиза
#[derive(Debug, Serialize, ToSchema)]
pub struct ReleaseItemDto {
    pub id: Uuid,
    #[schema(example = "Заморозка кода")]
    pub title: String,
    pub done: bool,
    /// Порядок в чек-листе
    pub position: f64,
}

impl From<ReleaseItem> for ReleaseItemDto {
    fn from(i: ReleaseItem) -> Self {
        ReleaseItemDto { id: i.id, title: i.title, done: i.done, position: i.position }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ReleaseDto {
    pub id: Uuid,
    pub project_id: Uuid,
    #[schema(example = "2.9.0")]
    pub version: String,
    #[serde(with = "iso_date")]
    pub release_date: Date,
    /// plan | progress | done (Запланирован / Готовится / Выпущен)
    pub status: String,
    /// Changelog, свободный текст
    pub notes: String,
    pub items: Vec<ReleaseItemDto>,
}

impl ReleaseDto {
    pub fn new(r: Release, items: Vec<ReleaseItem>) -> Self {
        ReleaseDto {
            id: r.id,
            project_id: r.project_id,
            version: r.version,
            release_date: r.release_date,
            status: r.status,
            notes: r.notes,
            items: items.into_iter().map(Into::into).collect(),
        }
    }
}

/// Задача в списке доски: без описания, комментариев и вложений
#[derive(Debug, Serialize, ToSchema)]
pub struct TaskCardDto {
    pub id: Uuid,
    pub project_id: Uuid,
    /// Номер внутри проекта
    pub number: i32,
    /// Ключ для интерфейса, `WEB-151`
    #[schema(example = "WEB-151")]
    pub key: String,
    pub title: String,
    /// Колонка; null — задача в бэклоге
    pub column_id: Option<Uuid>,
    /// Порядок внутри колонки или бэклога
    pub position: f64,
    pub assignee_id: Option<Uuid>,
    /// high | med | low
    pub priority: String,
    #[serde(with = "iso_date::option")]
    pub start_date: Option<Date>,
    #[serde(with = "iso_date::option")]
    pub due_date: Option<Date>,
    pub module_id: Option<Uuid>,
    pub milestone_id: Option<Uuid>,
    /// Номер pull request, например `#321`
    pub pr: String,
    /// Метки в порядке создания меток
    pub tag_ids: Vec<Uuid>,
    pub subtasks_total: i64,
    pub subtasks_done: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

/// Id задачи для показа: `SEO-3`, `WEB-151`, `TASK-12` (ключ ряда задачи, иначе ключ проекта, иначе `TASK`)
pub fn task_label(project_key: Option<&str>, task: &db::tasks::Task) -> String {
    task_key(id_prefix(task.series_key.as_deref(), project_key), task.number)
}

impl TaskCardDto {
    pub fn new(card: db::tasks::TaskCard, project_key: Option<&str>) -> Self {
        let t = card.task;
        TaskCardDto {
            key: task_label(project_key, &t),
            id: t.id,
            project_id: t.project_id,
            number: t.number,
            title: t.title,
            column_id: t.column_id,
            position: t.position,
            assignee_id: t.assignee_id,
            priority: t.priority,
            start_date: t.start_date,
            due_date: t.due_date,
            module_id: t.module_id,
            milestone_id: t.milestone_id,
            pr: t.pr,
            tag_ids: card.tag_ids,
            subtasks_total: card.subtasks_total,
            subtasks_done: card.subtasks_done,
            updated_at: t.updated_at,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SubtaskDto {
    pub id: Uuid,
    pub title: String,
    pub done: bool,
    pub position: f64,
}

impl From<Subtask> for SubtaskDto {
    fn from(s: Subtask) -> Self {
        SubtaskDto { id: s.id, title: s.title, done: s.done, position: s.position }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CommentDto {
    pub id: Uuid,
    pub author_id: Uuid,
    /// Текст. Упоминание человека в нём метка `@[id]`, клиент показывает вместо неё его имя.
    pub body: String,
    /// Кого упомянули: участники проекта, проверенные при создании комментария
    pub mentions: Vec<Uuid>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

impl From<Comment> for CommentDto {
    fn from(c: Comment) -> Self {
        CommentDto { id: c.id, author_id: c.author_id, body: c.body, mentions: c.mentions, created_at: c.created_at }
    }
}

/// Вложение задачи
#[derive(Debug, Serialize, ToSchema)]
pub struct TaskFileDto {
    pub id: Uuid,
    pub name: String,
    pub size_bytes: i64,
    /// img | pdf | doc | sheet | zip | other
    pub kind: String,
    pub uploader_id: Option<Uuid>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

impl From<TaskFile> for TaskFileDto {
    fn from(f: TaskFile) -> Self {
        TaskFileDto {
            id: f.id,
            name: f.name,
            size_bytes: f.size_bytes,
            kind: f.kind,
            uploader_id: f.uploader_id,
            created_at: f.created_at,
        }
    }
}

/// Задача целиком: для панели задачи
#[derive(Debug, Serialize, ToSchema)]
pub struct TaskDetailDto {
    pub id: Uuid,
    pub project_id: Uuid,
    pub number: i32,
    #[schema(example = "WEB-151")]
    pub key: String,
    pub title: String,
    pub description: String,
    pub column_id: Option<Uuid>,
    pub position: f64,
    pub assignee_id: Option<Uuid>,
    pub priority: String,
    #[serde(with = "iso_date::option")]
    pub start_date: Option<Date>,
    #[serde(with = "iso_date::option")]
    pub due_date: Option<Date>,
    pub module_id: Option<Uuid>,
    pub milestone_id: Option<Uuid>,
    pub pr: String,
    pub tag_ids: Vec<Uuid>,
    pub subtasks: Vec<SubtaskDto>,
    pub comments: Vec<CommentDto>,
    pub files: Vec<TaskFileDto>,
    pub created_by: Option<Uuid>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

/// Всё для первой загрузки доски одним ответом
#[derive(Debug, Serialize, ToSchema)]
pub struct BoardDto {
    pub project: ProjectDto,
    /// Колонки слева направо
    pub columns: Vec<ColumnDto>,
    /// Все задачи проекта, доска и бэклог, по возрастанию позиции
    pub tasks: Vec<TaskCardDto>,
    /// Метки проекта в порядке создания
    pub tags: Vec<TagDto>,
    pub modules: Vec<ModuleDto>,
    pub milestones: Vec<MilestoneDto>,
}

// ===== Запросы =====

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateColumn {
    pub title: String,
    /// Токен цвета; без него цвет берётся по кругу
    pub color: Option<String>,
    pub is_done: Option<bool>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateColumn {
    pub title: Option<String>,
    pub color: Option<String>,
    pub is_done: Option<bool>,
    /// Переставить колонку перед этой; `null` — в конец. Если поля нет, порядок не меняется.
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<Uuid>)]
    pub before_id: Option<Option<Uuid>>,
}

#[derive(Debug, Deserialize)]
pub struct DeleteColumnQuery {
    /// В какую колонку перенести задачи. По умолчанию в первую из оставшихся.
    pub move_to: Option<Uuid>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateTask {
    pub title: String,
    /// Колонка; без неё или с `null` задача попадает в бэклог
    pub column_id: Option<Uuid>,
}

/// Любые поля задачи. Что не передано, не меняется. У необязательных полей `null` очищает значение.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateTask {
    pub title: Option<String>,
    pub description: Option<String>,
    pub pr: Option<String>,
    /// high | med | low
    pub priority: Option<String>,
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<Uuid>)]
    pub assignee_id: Option<Option<Uuid>>,
    #[serde(default, deserialize_with = "iso_date::patch::deserialize")]
    #[schema(value_type = Option<Date>)]
    pub start_date: Option<Option<Date>>,
    #[serde(default, deserialize_with = "iso_date::patch::deserialize")]
    #[schema(value_type = Option<Date>)]
    pub due_date: Option<Option<Date>>,
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<Uuid>)]
    pub module_id: Option<Option<Uuid>>,
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<Uuid>)]
    pub milestone_id: Option<Option<Uuid>>,
    /// Полный новый набор меток
    pub tag_ids: Option<Vec<Uuid>>,
    /// Перенос: колонка (`null` — в бэклог)
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<Uuid>)]
    pub column_id: Option<Option<Uuid>>,
    /// Перенос: встать перед этой задачей, она должна лежать в целевой колонке; `null` — в конец
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<Uuid>)]
    pub before_id: Option<Option<Uuid>>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateSubtask {
    pub title: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateSubtask {
    pub title: Option<String>,
    pub done: Option<bool>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateComment {
    pub body: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateModule {
    pub title: String,
}

/// Любые поля модуля. Что не передано, не меняется. У необязательных полей `null` очищает значение.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateModule {
    pub title: Option<String>,
    /// Ключ задач: 2–6 символов, латиница и цифры, с буквы; `null` или пустая строка убирают ключ. Первый ключ, смена ряда и
    /// снятие ключа дают задачам модуля новые номера, переименование меняет только подпись.
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<String>)]
    pub key: Option<Option<String>>,
    /// plan | progress | done
    pub status: Option<String>,
    /// Ответственный: участник проекта (прежнего, вышедшего из проекта, оставить можно); `null` — не назначен
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<Uuid>)]
    pub lead_id: Option<Option<Uuid>>,
    #[serde(default, deserialize_with = "iso_date::patch::deserialize")]
    #[schema(value_type = Option<Date>)]
    pub date_from: Option<Option<Date>>,
    #[serde(default, deserialize_with = "iso_date::patch::deserialize")]
    #[schema(value_type = Option<Date>)]
    pub date_to: Option<Option<Date>>,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateMilestone {
    pub title: String,
    #[serde(with = "iso_date")]
    #[schema(value_type = Date)]
    pub due_date: Date,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateMilestone {
    pub title: Option<String>,
    #[serde(default, with = "iso_date::option")]
    #[schema(value_type = Option<Date>)]
    pub due_date: Option<Date>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateRelease {
    #[schema(example = "2.10.0")]
    pub version: String,
    #[serde(with = "iso_date")]
    #[schema(value_type = Date)]
    pub release_date: Date,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateRelease {
    pub version: Option<String>,
    #[serde(default, with = "iso_date::option")]
    #[schema(value_type = Option<Date>)]
    pub release_date: Option<Date>,
    /// plan | progress | done
    pub status: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateReleaseItem {
    pub title: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateReleaseItem {
    pub title: Option<String>,
    pub done: Option<bool>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateTag {
    #[schema(example = "Нужен дизайн")]
    pub label: String,
    /// Индекс цвета 0..7; без него цвет берётся по кругу
    pub tone: Option<i16>,
}
