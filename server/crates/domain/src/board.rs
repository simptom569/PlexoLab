//! Правила доски: допустимые значения и ограничения длины.

pub const PRIORITIES: [&str; 3] = ["high", "med", "low"];

/// Цвета колонок (токены из styles.css), COLCOL в макете. Новая колонка берёт цвет по кругу.
pub const COLUMN_COLORS: [&str; 6] = ["muted", "accent", "warn", "ok", "b-fg", "e-fg"];

pub const MAX_TITLE_LEN: usize = 500;
pub const MAX_COLUMN_TITLE_LEN: usize = 100;
pub const MAX_DESCRIPTION_LEN: usize = 20_000;
pub const MAX_PR_LEN: usize = 100;
pub const MAX_COMMENT_LEN: usize = 5_000;
pub const MAX_TAG_LEN: usize = 50;
/// Тонов у меток 8 (TONES в макете)
pub const TONE_COUNT: i16 = 8;

pub fn is_priority(value: &str) -> bool {
    PRIORITIES.contains(&value)
}

pub fn is_column_color(value: &str) -> bool {
    COLUMN_COLORS.contains(&value)
}

/// Цвет новой колонки: по кругу в зависимости от того, сколько колонок уже есть
pub fn default_column_color(existing_columns: usize) -> &'static str {
    COLUMN_COLORS[existing_columns % COLUMN_COLORS.len()]
}

/// Префикс id задач, у которых нет ни ключа модуля, ни ключа проекта
pub const DEFAULT_KEY: &str = "TASK";

/// Префикс id задачи (docs/PROJECTS.md, раздел 4.1): ключ модуля, если задача в его ряду, иначе ключ проекта,
/// иначе `TASK`
pub fn id_prefix<'a>(series_key: Option<&'a str>, project_key: Option<&'a str>) -> &'a str {
    series_key.or(project_key).unwrap_or(DEFAULT_KEY)
}

/// Ключ задачи для интерфейса: `WEB-151`
pub fn task_key(prefix: &str, number: i32) -> String {
    format!("{prefix}-{number}")
}

/// Название по краям без пробелов. `None`, если пусто или длиннее `max` символов.
pub fn clean_text(value: &str, max: usize) -> Option<String> {
    let v = value.trim();
    (!v.is_empty() && v.chars().count() <= max).then(|| v.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn priorities_and_colors_are_checked() {
        assert!(is_priority("med"));
        assert!(!is_priority("urgent"));
        assert!(!is_priority(""));
        assert!(is_column_color("b-fg"));
        assert!(!is_column_color("red"));
    }

    #[test]
    fn new_column_colors_go_round() {
        assert_eq!(default_column_color(0), "muted");
        assert_eq!(default_column_color(4), "b-fg");
        assert_eq!(default_column_color(6), "muted");
    }

    #[test]
    fn task_key_has_project_prefix() {
        assert_eq!(task_key("WEB", 159), "WEB-159");
    }

    #[test]
    fn id_prefix_goes_module_then_project_then_default() {
        assert_eq!(id_prefix(Some("SEO"), Some("PLX")), "SEO", "ключ модуля главнее");
        assert_eq!(id_prefix(None, Some("PLX")), "PLX");
        assert_eq!(id_prefix(None, None), "TASK");
        assert_eq!(task_key(id_prefix(None, None), 12), "TASK-12");
    }

    #[test]
    fn clean_text_trims_and_limits() {
        assert_eq!(clean_text("  Задача  ", 10).as_deref(), Some("Задача"));
        assert_eq!(clean_text("   ", 10), None);
        assert_eq!(clean_text("", 10), None);
        assert_eq!(clean_text("абвгд", 5).as_deref(), Some("абвгд"), "длина в символах, а не в байтах");
        assert_eq!(clean_text("абвгде", 5), None);
    }
}
