//! Профиль пользователя: что человек может поменять в нём сам и в каких пределах.

use crate::board;

pub const MAX_NAME_LEN: usize = 60;
pub const MAX_ROLE_LEN: usize = 40;
/// Цветов аватара пять: `.av-a` … `.av-e`, в базе 0..4
pub const AVATAR_TONES: i16 = 5;

/// Имя без пробелов по краям: от 1 до `MAX_NAME_LEN` символов
pub fn clean_name(raw: &str) -> Option<String> {
    board::clean_text(raw, MAX_NAME_LEN)
}

/// Подпись под именем без пробелов по краям: может быть пустой, не длиннее `MAX_ROLE_LEN` символов
pub fn clean_role(raw: &str) -> Option<String> {
    let role = raw.trim();
    (role.chars().count() <= MAX_ROLE_LEN).then(|| role.to_owned())
}

pub fn is_avatar_tone(tone: i16) -> bool {
    (0..AVATAR_TONES).contains(&tone)
}

/// Цвет аватара для нового аккаунта, который зарегистрировался сам: из адреса, поэтому у разных людей цвета разные,
/// а у одного и того же адреса всегда один и тот же. Потом человек выбирает цвет сам.
pub fn tone_for(email: &str) -> i16 {
    (email.bytes().map(u32::from).sum::<u32>() % AVATAR_TONES as u32) as i16
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_is_trimmed_and_limited() {
        assert_eq!(clean_name("  Лена М.  ").as_deref(), Some("Лена М."));
        assert_eq!(clean_name("   "), None, "из одних пробелов");
        assert_eq!(clean_name(""), None);
        assert!(clean_name(&"я".repeat(MAX_NAME_LEN)).is_some(), "ровно предел, считаются символы");
        assert_eq!(clean_name(&"я".repeat(MAX_NAME_LEN + 1)), None);
    }

    #[test]
    fn role_may_be_empty_but_not_long() {
        assert_eq!(clean_role("  Frontend ").as_deref(), Some("Frontend"));
        assert_eq!(clean_role("").as_deref(), Some(""), "подпись можно очистить");
        assert_eq!(clean_role("   ").as_deref(), Some(""));
        assert!(clean_role(&"я".repeat(MAX_ROLE_LEN)).is_some());
        assert_eq!(clean_role(&"я".repeat(MAX_ROLE_LEN + 1)), None);
    }

    #[test]
    fn registered_tone_is_valid_and_stable() {
        for email in ["a@b.c", "lena@example.com", "иван@пример.рф", ""] {
            assert!(is_avatar_tone(tone_for(email)), "{email}");
            assert_eq!(tone_for(email), tone_for(email));
        }
        let tones: std::collections::BTreeSet<i16> =
            (0..40).map(|i| tone_for(&format!("user{i}@example.com"))).collect();
        assert!(tones.len() > 1, "все цвета одинаковые: {tones:?}");
    }

    #[test]
    fn avatar_has_five_tones() {
        for tone in 0..=4 {
            assert!(is_avatar_tone(tone), "{tone}");
        }
        assert!(!is_avatar_tone(-1));
        assert!(!is_avatar_tone(5));
    }
}
