//! Формы запросов и ответов вики и файлов. Время RFC 3339.

use db::{
    files::File,
    folders::Folder,
    wiki::{WikiNode, WikiPage},
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::serde_helpers::present;

// ===== Вики =====

/// Страница в дереве: без текста
#[derive(Debug, Serialize, ToSchema)]
pub struct WikiNodeDto {
    pub id: Uuid,
    /// Родительская страница; `null` — корень дерева
    pub parent_id: Option<Uuid>,
    /// Может быть пустым: интерфейс пишет «Без названия»
    pub title: String,
    /// Порядок среди страниц одного родителя
    pub position: f64,
    /// Номер версии: растёт на единицу при каждом изменении
    pub rev: i32,
    pub updated_by: Option<Uuid>,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

impl From<WikiNode> for WikiNodeDto {
    fn from(p: WikiNode) -> Self {
        WikiNodeDto {
            id: p.id,
            parent_id: p.parent_id,
            title: p.title,
            position: p.position,
            rev: p.rev,
            updated_by: p.updated_by,
            updated_at: p.updated_at,
        }
    }
}

/// Страница вместе с текстом
#[derive(Debug, Serialize, ToSchema)]
pub struct WikiPageDto {
    pub id: Uuid,
    pub parent_id: Option<Uuid>,
    pub title: String,
    /// Весь текст страницы одной строкой markdown
    pub md: String,
    pub position: f64,
    pub rev: i32,
    pub updated_by: Option<Uuid>,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

impl From<WikiPage> for WikiPageDto {
    fn from(p: WikiPage) -> Self {
        WikiPageDto {
            id: p.id,
            parent_id: p.parent_id,
            title: p.title,
            md: p.md,
            position: p.position,
            rev: p.rev,
            updated_by: p.updated_by,
            updated_at: p.updated_at,
        }
    }
}

/// Ответ 409: страницу уже изменили. В `current` лежит актуальная версия.
#[derive(Debug, Serialize, ToSchema)]
pub struct WikiConflictDto {
    #[schema(example = "conflict")]
    pub code: String,
    #[schema(example = "Страницу изменил другой участник")]
    pub message: String,
    pub current: WikiPageDto,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateWikiPage {
    /// Родитель; не передано или `null` — страница в корне
    pub parent_id: Option<Uuid>,
    pub title: Option<String>,
    pub md: Option<String>,
}

/// Изменения страницы. `rev` — версия, которую клиент видел последней: если страницу успели изменить, ответ 409.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateWikiPage {
    pub rev: i32,
    pub title: Option<String>,
    pub md: Option<String>,
    /// Перенести под другую страницу; `null` — в корень
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<Uuid>)]
    pub parent_id: Option<Option<Uuid>>,
}

// ===== Файлы =====

/// Файл библиотеки или вложение
#[derive(Debug, Serialize, ToSchema)]
pub struct FileDto {
    pub id: Uuid,
    pub name: String,
    pub size_bytes: i64,
    /// img | pdf | doc | sheet | zip | other
    pub kind: String,
    pub uploader_id: Option<Uuid>,
    pub folder_id: Option<Uuid>,
    /// Страница вики, к которой прикреплён файл
    pub wiki_page_id: Option<Uuid>,
    /// Задача, к которой прикреплён файл
    pub task_id: Option<Uuid>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

impl From<File> for FileDto {
    fn from(f: File) -> Self {
        FileDto {
            id: f.id,
            name: f.name,
            size_bytes: f.size_bytes,
            kind: f.kind,
            uploader_id: f.uploader_id,
            folder_id: f.folder_id,
            wiki_page_id: f.wiki_page_id,
            task_id: f.task_id,
            created_at: f.created_at,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct FileListDto {
    /// Сколько файлов в библиотеке всего, независимо от фильтров
    pub total: i64,
    /// Подходящие под фильтр, новые первыми
    pub files: Vec<FileDto>,
}

/// Условия отбора файлов
#[derive(Debug, Deserialize, IntoParams)]
pub struct ListFilesQuery {
    /// `root` — только файлы вне папок, идентификатор папки — файлы в ней, не передано — везде
    pub folder: Option<String>,
    /// img | pdf | doc | sheet | zip | other
    pub kind: Option<String>,
    /// Часть имени файла
    pub q: Option<String>,
    /// Только вложения этой страницы
    pub wiki_page_id: Option<Uuid>,
}

/// Поля формы загрузки (multipart/form-data)
#[derive(Debug, ToSchema)]
#[allow(dead_code)] // только для схемы OpenAPI
pub struct UploadForm {
    /// Файлы; поле `file` можно повторять
    #[schema(value_type = Vec<String>, format = Binary)]
    pub file: Vec<Vec<u8>>,
    /// Папка. Для вложения страницы без папки сервер кладёт файл в папку «Вложения».
    pub folder_id: Option<Uuid>,
    /// Страница вики, к которой прикрепить
    pub wiki_page_id: Option<Uuid>,
}

/// Поля формы загрузки вложения задачи
#[derive(Debug, ToSchema)]
#[allow(dead_code)] // только для схемы OpenAPI
pub struct TaskUploadForm {
    /// Файлы; поле `file` можно повторять
    #[schema(value_type = Vec<String>, format = Binary)]
    pub file: Vec<Vec<u8>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct FolderDto {
    pub id: Uuid,
    pub name: String,
    /// Файлов в папке, вложения страниц тоже считаются
    pub file_count: i64,
}

impl From<Folder> for FolderDto {
    fn from(f: Folder) -> Self {
        FolderDto { id: f.id, name: f.name, file_count: f.file_count }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateFolder {
    pub name: String,
}
