//! Правила команд (docs/TEAMS.md): название, лимит обычных команд на человека.

/// Самое длинное название команды, символов
pub const MAX_NAME_LEN: usize = 60;

/// Сколько обычных команд может создать один человек (личная «Личное» не считается); меняется настройкой сервера
pub const DEFAULT_MAX_TEAMS_PER_USER: u32 = 5;

/// Название команды: без пробелов по краям, от 1 до [`MAX_NAME_LEN`] символов. Названия не уникальны.
pub fn clean_name(raw: &str) -> Option<String> {
    let name = raw.trim();
    (!name.is_empty() && name.chars().count() <= MAX_NAME_LEN).then(|| name.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_trimmed_and_limited() {
        assert_eq!(clean_name("  Веб ").as_deref(), Some("Веб"));
        assert_eq!(clean_name(""), None);
        assert_eq!(clean_name("   "), None);
        assert!(clean_name(&"я".repeat(MAX_NAME_LEN)).is_some());
        assert_eq!(clean_name(&"я".repeat(MAX_NAME_LEN + 1)), None);
    }
}
