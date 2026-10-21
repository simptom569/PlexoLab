//! Правила проектов, ключей и участников (docs/PROJECTS.md).

/// Самое длинное название проекта, символов
pub const MAX_NAME_LEN: usize = 60;
/// Цвета проекта (токены из styles.css)
pub const COLORS: [&str; 3] = ["accent", "warn", "ok"];
/// Допустимая длина ключа проекта или модуля
pub const KEY_LEN: std::ops::RangeInclusive<usize> = 2..=6;

pub fn is_color(value: &str) -> bool {
    COLORS.contains(&value)
}

/// Ключ проекта или модуля (префикс id задач): без пробелов по краям, в верхнем регистре. `None`, если это не
/// 2–6 символов латиницы и цифр, начинающихся с буквы.
pub fn normalize_key(raw: &str) -> Option<String> {
    let key = raw.trim().to_ascii_uppercase();
    let mut chars = key.chars();
    let first = chars.next()?;
    let ok = KEY_LEN.contains(&key.len())
        && first.is_ascii_uppercase()
        && chars.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        // нелатинские буквы после приведения регистра остались бы, но не прошли бы проверку выше
        && key.is_ascii();
    ok.then_some(key)
}

/// Роль человека в проекте
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Admin,
    Member,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Admin => "admin",
            Role::Member => "member",
        }
    }

    pub fn parse(value: &str) -> Option<Role> {
        match value {
            "admin" => Some(Role::Admin),
            "member" => Some(Role::Member),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_are_normalized_and_checked() {
        assert_eq!(normalize_key("plx").as_deref(), Some("PLX"));
        assert_eq!(normalize_key("  Seo2 ").as_deref(), Some("SEO2"));
        assert_eq!(normalize_key("AB").as_deref(), Some("AB"));
        assert_eq!(normalize_key("ABCDEF").as_deref(), Some("ABCDEF"));
        for bad in ["", " ", "A", "ABCDEFG", "1AB", "A-B", "A B", "ПЛЕКС", "AБ", "TÄSK"] {
            assert_eq!(normalize_key(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn roles_round_trip() {
        for role in [Role::Admin, Role::Member] {
            assert_eq!(Role::parse(role.as_str()), Some(role));
        }
        assert_eq!(Role::parse("owner"), None);
        assert_eq!(Role::parse(""), None);
    }

    #[test]
    fn colors_are_from_the_design() {
        assert!(is_color("accent") && is_color("warn") && is_color("ok"));
        assert!(!is_color("red") && !is_color(""));
    }
}
