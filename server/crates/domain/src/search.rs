//! Поиск по названиям (docs/OFFLINE-NOTIFY-SEARCH.md, раздел 3): задачи (название и id), документы, страницы вики, файлы.

/// Самый длинный запрос: дальше это уже не название
pub const MAX_QUERY_LEN: usize = 100;

/// Сколько результатов каждого вида отдаёт поиск
pub const LIMIT_PER_KIND: i64 = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueryError {
    TooLong,
}

/// Запрос для поиска: пробелы по краям срезаны. `None`, если искать нечего (запроса нет или он из одних пробелов).
pub fn clean_query(raw: Option<&str>) -> Result<Option<String>, QueryError> {
    let q = raw.map(str::trim).unwrap_or_default();
    if q.is_empty() {
        return Ok(None);
    }
    if q.chars().count() > MAX_QUERY_LEN {
        return Err(QueryError::TooLong);
    }
    Ok(Some(q.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_or_blank_query_means_nothing_to_search() {
        assert_eq!(clean_query(None), Ok(None));
        assert_eq!(clean_query(Some("")), Ok(None));
        assert_eq!(clean_query(Some("   \t\n")), Ok(None));
    }

    #[test]
    fn spaces_at_the_edges_are_cut_inside_stay() {
        assert_eq!(clean_query(Some("  Планирование  Q4 ")), Ok(Some("Планирование  Q4".to_owned())));
    }

    #[test]
    fn length_is_counted_in_characters_not_bytes() {
        assert!(clean_query(Some(&"я".repeat(MAX_QUERY_LEN))).unwrap().is_some());
        assert_eq!(clean_query(Some(&"я".repeat(MAX_QUERY_LEN + 1))), Err(QueryError::TooLong));
        // пробелы по краям в длину не входят
        assert!(clean_query(Some(&format!("  {}  ", "я".repeat(MAX_QUERY_LEN)))).unwrap().is_some());
    }

    #[test]
    fn wildcards_are_ordinary_characters() {
        assert_eq!(clean_query(Some("100%_\\")), Ok(Some("100%_\\".to_owned())));
    }
}
