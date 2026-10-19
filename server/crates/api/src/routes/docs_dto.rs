//! Формы запросов и ответов документов и холста. Время RFC 3339.

use std::collections::HashMap;

use db::docs::{Doc, DocListItem, DocObject};
use domain::docs::{self as rules, Link, Note, Object};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::serde_helpers::present;

/// Режим документа: страница или холст. Текст и объекты в обоих режимах одни и те же.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum DocMode {
    Page,
    Edge,
}

impl DocMode {
    pub fn as_str(self) -> &'static str {
        match self {
            DocMode::Page => "page",
            DocMode::Edge => "edge",
        }
    }

    fn from_db(value: &str) -> DocMode {
        if value == "edge" { DocMode::Edge } else { DocMode::Page }
    }
}

/// Тип объекта на холсте
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ObjectKind {
    Sticky,
    Rect,
    Ellipse,
    Text,
}

impl ObjectKind {
    fn as_str(self) -> &'static str {
        match self {
            ObjectKind::Sticky => "sticky",
            ObjectKind::Rect => "rect",
            ObjectKind::Ellipse => "ellipse",
            ObjectKind::Text => "text",
        }
    }

    fn from_db(value: &str) -> ObjectKind {
        match value {
            "sticky" => ObjectKind::Sticky,
            "rect" => ObjectKind::Rect,
            "ellipse" => ObjectKind::Ellipse,
            _ => ObjectKind::Text,
        }
    }
}

/// Карточка с текстом документа на холсте: где лежит и какой ширины (высота зависит от текста)
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
pub struct NoteDto {
    pub x: f32,
    pub y: f32,
    pub w: f32,
}

impl From<NoteDto> for Note {
    fn from(n: NoteDto) -> Note {
        Note { x: n.x, y: n.y, w: n.w }
    }
}

impl From<Note> for NoteDto {
    fn from(n: Note) -> NoteDto {
        NoteDto { x: n.x, y: n.y, w: n.w }
    }
}

/// Стикер, фигура или подпись на холсте. Идентификатор выдаёт клиент: стрелки ссылаются на него, а весь холст
/// сохраняется одним запросом.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CanvasObjectDto {
    pub id: Uuid,
    #[serde(rename = "type")]
    pub kind: ObjectKind,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub text: String,
    /// Индекс цвета в палитре (0..7)
    pub color: i16,
}

impl From<CanvasObjectDto> for Object {
    fn from(o: CanvasObjectDto) -> Object {
        Object {
            id: o.id,
            kind: o.kind.as_str().to_owned(),
            x: o.x,
            y: o.y,
            w: o.w,
            h: o.h,
            text: o.text,
            color: o.color,
        }
    }
}

impl From<DocObject> for CanvasObjectDto {
    fn from(o: DocObject) -> CanvasObjectDto {
        CanvasObjectDto {
            id: o.id,
            kind: ObjectKind::from_db(&o.kind),
            x: o.x,
            y: o.y,
            w: o.w,
            h: o.h,
            text: o.text,
            color: o.color,
        }
    }
}

/// Стрелка от объекта `a` к объекту `b`
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CanvasLinkDto {
    pub a: Uuid,
    pub b: Uuid,
}

impl From<CanvasLinkDto> for Link {
    fn from(l: CanvasLinkDto) -> Link {
        Link { a: l.a, b: l.b }
    }
}

/// Объект холста для миниатюры в списке: без текста
#[derive(Debug, Serialize, ToSchema)]
pub struct ThumbObjectDto {
    #[serde(rename = "type")]
    pub kind: ObjectKind,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub color: i16,
}

impl From<DocObject> for ThumbObjectDto {
    fn from(o: DocObject) -> ThumbObjectDto {
        ThumbObjectDto { kind: ObjectKind::from_db(&o.kind), x: o.x, y: o.y, w: o.w, h: o.h, color: o.color }
    }
}

/// Документ в списке: без текста, с фрагментом и данными для миниатюры холста
#[derive(Debug, Serialize, ToSchema)]
pub struct DocSummaryDto {
    pub id: Uuid,
    pub title: String,
    /// Первые строки текста без разметки через « · ». Пусто, если текста нет.
    pub snippet: String,
    pub mode: DocMode,
    pub note: NoteDto,
    /// Порядок в списке: меньше — выше. Общий для всей команды.
    pub position: f64,
    /// Автор документа
    pub created_by: Option<Uuid>,
    /// Когда меняли название, текст или холст
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
    /// Отмечен ли документ звёздочкой тем, кто спрашивает
    pub starred: bool,
    /// Сколько объектов на холсте
    pub object_count: i64,
    /// Объекты для миниатюры: только у документов в режиме «Холст»
    pub thumb: Vec<ThumbObjectDto>,
}

impl DocSummaryDto {
    /// Собирает карточки из строк списка; объекты `thumb` нужны только документам в режиме «Холст»
    pub fn build(items: Vec<DocListItem>, objects: Vec<DocObject>) -> Vec<DocSummaryDto> {
        let mut by_doc: HashMap<Uuid, Vec<ThumbObjectDto>> = HashMap::new();
        for o in objects {
            by_doc.entry(o.doc_id).or_default().push(o.into());
        }
        items
            .into_iter()
            .map(|d| DocSummaryDto {
                snippet: rules::snippet(&d.head),
                mode: DocMode::from_db(&d.mode),
                note: NoteDto { x: d.note_x, y: d.note_y, w: d.note_w },
                thumb: by_doc.remove(&d.id).unwrap_or_default(),
                id: d.id,
                title: d.title,
                position: d.position,
                created_by: d.created_by,
                updated_at: d.updated_at,
                starred: d.starred,
                object_count: d.object_count,
            })
            .collect()
    }
}

/// Документ целиком: текст, холст
#[derive(Debug, Serialize, ToSchema)]
pub struct DocDto {
    pub id: Uuid,
    pub title: String,
    /// Весь текст документа одной строкой markdown
    pub md: String,
    pub mode: DocMode,
    pub note: NoteDto,
    pub position: f64,
    /// Номер версии названия и текста: растёт на единицу при каждом их изменении
    pub rev: i32,
    pub created_by: Option<Uuid>,
    pub updated_by: Option<Uuid>,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
    pub starred: bool,
    /// Объекты холста снизу вверх
    pub objects: Vec<CanvasObjectDto>,
    pub links: Vec<CanvasLinkDto>,
}

impl DocDto {
    pub fn build(doc: Doc, objects: Vec<DocObject>, links: Vec<(Uuid, Uuid)>) -> DocDto {
        DocDto {
            note: doc.note().into(),
            mode: DocMode::from_db(&doc.mode),
            id: doc.id,
            title: doc.title,
            md: doc.md,
            position: doc.position,
            rev: doc.rev,
            created_by: doc.created_by,
            updated_by: doc.updated_by,
            updated_at: doc.updated_at,
            starred: doc.starred,
            objects: objects.into_iter().map(Into::into).collect(),
            links: links.into_iter().map(|(a, b)| CanvasLinkDto { a, b }).collect(),
        }
    }
}

/// Ответ 409: название или текст документа уже изменили. В `current` лежит актуальная версия.
#[derive(Debug, Serialize, ToSchema)]
pub struct DocConflictDto {
    #[schema(example = "conflict")]
    pub code: String,
    #[schema(example = "Документ изменил другой участник")]
    pub message: String,
    pub current: DocDto,
}

/// Холст документа
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CanvasDto {
    pub note: NoteDto,
    /// Снизу вверх: объект, стоящий позже, лежит поверх более ранних
    pub objects: Vec<CanvasObjectDto>,
    pub links: Vec<CanvasLinkDto>,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct ListDocsQuery {
    /// Часть названия или текста, без учёта регистра
    pub q: Option<String>,
    /// `true` — только отмеченные звёздочкой тем, кто спрашивает
    pub starred: Option<bool>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateDoc {
    pub title: Option<String>,
    pub md: Option<String>,
    /// Не передано — страница
    pub mode: Option<DocMode>,
}

/// Изменения документа. Что не передано, не меняется.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateDoc {
    /// Версия, которую клиент видел последней. Нужна, когда меняются название или текст: если документ успели
    /// изменить, ответ 409. Для режима и переноса не нужна.
    pub rev: Option<i32>,
    pub title: Option<String>,
    pub md: Option<String>,
    pub mode: Option<DocMode>,
    /// Перед каким документом встать в списке; `null` — в конец. Не передано — порядок не меняется.
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<Uuid>)]
    pub before_id: Option<Option<Uuid>>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SetStar {
    pub starred: bool,
}
