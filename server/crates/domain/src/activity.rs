//! Лента активности: категории фильтра «Тип события» и курсор постраничной выдачи.

use uuid::Uuid;

/// Событий на странице ленты (docs/ROADMAP.md, этап 7)
pub const PAGE_SIZE: i64 = 50;

/// Категории фильтра «Тип события» в том виде, как их называет клиент (`kindOf` в макете)
pub const CATEGORIES: [&str; 8] = ["tasks", "comment", "code", "doc", "wiki", "release", "file", "module"];

/// Типы событий (`act_kind`), из которых состоит категория; `None`, если такой категории нет
pub fn kinds_of(category: &str) -> Option<&'static [&'static str]> {
    Some(match category {
        "tasks" => &["move", "create", "delete"],
        "comment" => &["comment"],
        "code" => &["code"],
        "doc" => &["doc"],
        "wiki" => &["wiki"],
        "release" => &["release"],
        "file" => &["file"],
        "module" => &["module"],
        _ => return None,
    })
}

/// Категория события: по ней клиент выбирает цветную метку. Незнакомый тип считается задачей, как в макете.
pub fn category_of(kind: &str) -> &'static str {
    match kind {
        "comment" => "comment",
        "code" => "code",
        "doc" => "doc",
        "wiki" => "wiki",
        "release" => "release",
        "file" => "file",
        "module" => "module",
        _ => "tasks",
    }
}

/// Место в ленте, после которого начинается следующая страница. События идут от новых к старым, поэтому
/// «после» — это более старые. Время в микросекундах (точность `timestamptz`), идентификатор разводит события
/// с одинаковым временем.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cursor {
    pub micros: i64,
    pub id: Uuid,
}

impl Cursor {
    /// Вид для адреса запроса: `1792324800000000_6f1d…`
    pub fn encode(&self) -> String {
        format!("{}_{}", self.micros, self.id)
    }

    pub fn parse(raw: &str) -> Option<Cursor> {
        let (micros, id) = raw.split_once('_')?;
        Some(Cursor { micros: micros.parse().ok()?, id: id.parse().ok()? })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_category_has_kinds_and_every_kind_maps_back() {
        for category in CATEGORIES {
            let kinds = kinds_of(category).unwrap_or_else(|| panic!("нет типов у категории {category}"));
            assert!(!kinds.is_empty());
            for kind in kinds {
                assert_eq!(category_of(kind), category, "тип {kind}");
            }
        }
        assert_eq!(kinds_of("tasks"), Some(&["move", "create", "delete"][..]));
        assert_eq!(kinds_of("all"), None);
        assert_eq!(kinds_of(""), None);
    }

    #[test]
    fn unknown_kind_counts_as_a_task_like_in_the_mockup() {
        assert_eq!(category_of("whatever"), "tasks");
    }

    #[test]
    fn cursor_roundtrips() {
        let cursor = Cursor { micros: 1_792_324_800_123_456, id: Uuid::new_v4() };
        assert_eq!(Cursor::parse(&cursor.encode()), Some(cursor));
        let before_epoch = Cursor { micros: -5, id: Uuid::new_v4() };
        assert_eq!(Cursor::parse(&before_epoch.encode()), Some(before_epoch));
    }

    #[test]
    fn broken_cursor_is_rejected() {
        for raw in ["", "1", "1_", "_2", "x_6f1d", "1_not-a-uuid", "1.5_00000000-0000-0000-0000-000000000000"] {
            assert_eq!(Cursor::parse(raw), None, "{raw:?}");
        }
    }
}
