//! Правила ссылок команды: длины и адрес. Ссылку открывают в системном браузере, поэтому адрес всегда http или https.

pub const MAX_GROUP_TITLE_LEN: usize = 200;
pub const MAX_LINK_TITLE_LEN: usize = 200;
pub const MAX_URL_LEN: usize = 2_000;
pub const MAX_DESCRIPTION_LEN: usize = 500;

fn has_scheme(url: &str) -> bool {
    let head: String = url.chars().take(8).collect::<String>().to_ascii_lowercase();
    head.starts_with("http://") || head.starts_with("https://")
}

/// Адрес для хранения: без пробелов по краям, без схемы — `https://` (addLink в макете). `None`, если адрес пустой,
/// после схемы ничего нет, он слишком длинный или в нём есть управляющие символы (перенос строки и подобное).
pub fn normalize_url(raw: &str) -> Option<String> {
    let url = raw.trim();
    if url.is_empty() || url.chars().any(char::is_control) {
        return None;
    }
    let url = if has_scheme(url) { url.to_owned() } else { format!("https://{url}") };
    let rest = url.split_once("://").map_or("", |(_, rest)| rest);
    (!rest.is_empty() && url.chars().count() <= MAX_URL_LEN).then_some(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scheme_is_added_when_missing() {
        assert_eq!(normalize_url("example.com/repo").as_deref(), Some("https://example.com/repo"));
        assert_eq!(normalize_url("  example.com  ").as_deref(), Some("https://example.com"));
    }

    #[test]
    fn http_and_https_are_kept_in_any_case() {
        assert_eq!(normalize_url("http://example.com").as_deref(), Some("http://example.com"));
        assert_eq!(normalize_url("HTTPS://Example.com/A").as_deref(), Some("HTTPS://Example.com/A"));
    }

    #[test]
    fn other_schemes_become_part_of_the_host() {
        // «javascript:» и «ftp://» схемой не считаются: клиент открывает только http и https
        assert_eq!(normalize_url("javascript:alert(1)").as_deref(), Some("https://javascript:alert(1)"));
        assert_eq!(normalize_url("ftp://example.com").as_deref(), Some("https://ftp://example.com"));
    }

    #[test]
    fn empty_and_broken_addresses_are_rejected() {
        for raw in ["", "   ", "https://", "http://  ", "example.com\nevil", "example.com\u{0}"] {
            assert_eq!(normalize_url(raw), None, "{raw:?}");
        }
    }

    #[test]
    fn length_is_counted_in_characters() {
        let ok = format!("example.com/{}", "я".repeat(MAX_URL_LEN - "https://example.com/".len()));
        assert!(normalize_url(&ok).is_some());
        let long = format!("{ok}я");
        assert_eq!(normalize_url(&long), None);
    }
}
