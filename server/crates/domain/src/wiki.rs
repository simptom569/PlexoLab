//! Правила страниц вики: длины и подписи для ленты активности.

pub const MAX_TITLE_LEN: usize = 200;
/// Текст страницы целиком (markdown). Хватает на сотни страниц печатного текста.
pub const MAX_MD_LEN: usize = 500_000;

/// Как страница называется в ленте, пока у неё нет названия (createWiki в макете)
pub const UNTITLED_TARGET: &str = "Новая страница вики";

/// Название страницы по краям без пробелов. Пустое название допустимо («Без названия» рисует клиент).
pub fn clean_title(raw: &str) -> Option<String> {
    let t = raw.trim();
    (t.chars().count() <= MAX_TITLE_LEN).then(|| t.to_owned())
}

/// Цель записи в ленте: название или заглушка для страницы без названия
pub fn target(title: &str) -> String {
    if title.trim().is_empty() { UNTITLED_TARGET.to_owned() } else { format!("Страница «{title}»") }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_is_trimmed_and_may_be_empty() {
        assert_eq!(clean_title("  Архитектура "), Some("Архитектура".to_owned()));
        assert_eq!(clean_title("   "), Some(String::new()));
    }

    #[test]
    fn title_length_is_counted_in_characters() {
        assert!(clean_title(&"я".repeat(MAX_TITLE_LEN)).is_some());
        assert!(clean_title(&"я".repeat(MAX_TITLE_LEN + 1)).is_none());
    }

    #[test]
    fn target_matches_the_mockup() {
        assert_eq!(target("Архитектура"), "Страница «Архитектура»");
        assert_eq!(target(""), "Новая страница вики");
        assert_eq!(target("  "), "Новая страница вики");
    }
}
