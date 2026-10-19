//! Правила модулей, вех и релизов: статусы, ограничения длины, шаги нового релиза.

/// Статусы модуля и релиза в базе (`work_status`); порядок переключения по кругу задаёт клиент
pub const WORK_STATUSES: [&str; 3] = ["plan", "progress", "done"];

pub const MAX_MODULE_TITLE_LEN: usize = 200;
pub const MAX_MODULE_NOTE_LEN: usize = 5_000;
pub const MAX_MILESTONE_TITLE_LEN: usize = 200;
pub const MAX_VERSION_LEN: usize = 50;
pub const MAX_RELEASE_NOTES_LEN: usize = 20_000;
pub const MAX_RELEASE_STEP_LEN: usize = 500;

/// Шаги чек-листа нового релиза (addRel в макете)
pub const DEFAULT_RELEASE_STEPS: [&str; 4] =
    ["Заморозка кода", "Регрессионные тесты", "Обновить changelog", "Выкатка на прод"];

pub fn is_status(value: &str) -> bool {
    WORK_STATUSES.contains(&value)
}

/// Подпись статуса модуля для ленты активности
pub fn module_status_label(status: &str) -> &'static str {
    match status {
        "progress" => "В работе",
        "done" => "Завершён",
        _ => "Запланирован",
    }
}

/// Подпись статуса релиза для ленты активности
pub fn release_status_label(status: &str) -> &'static str {
    match status {
        "progress" => "Готовится",
        "done" => "Выпущен",
        _ => "Запланирован",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn statuses_are_checked() {
        assert!(is_status("progress"));
        assert!(!is_status("released"));
        assert!(!is_status(""));
    }

    #[test]
    fn status_labels_match_the_mockup() {
        assert_eq!(WORK_STATUSES.map(module_status_label), ["Запланирован", "В работе", "Завершён"]);
        assert_eq!(WORK_STATUSES.map(release_status_label), ["Запланирован", "Готовится", "Выпущен"]);
    }
}
