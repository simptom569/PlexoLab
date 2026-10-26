//! Упоминания в комментариях: в тексте метка `@[<id человека>]`, а не имя, чтобы после смены имени старые комментарии
//! показывали новое (docs/OFFLINE-NOTIFY-SEARCH.md, раздел 2).

use uuid::Uuid;

/// Больше людей в одном комментарии упомянуть нельзя
pub const MAX_MENTIONS: usize = 20;

/// Длина id с дефисами: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
const ID_LEN: usize = 36;

/// Одна метка в тексте: где она (байты) и чей id
struct Found {
    start: usize,
    end: usize,
    id: Uuid,
}

fn find_all(body: &str) -> Vec<Found> {
    let mut out = Vec::new();
    let bytes = body.as_bytes();
    let mut i = 0;
    while let Some(at) = body[i..].find("@[") {
        let start = i + at;
        let id_start = start + 2;
        let id_end = id_start + ID_LEN;
        // id из 36 знаков и закрывающая скобка; всё остальное в квадратных скобках обычный текст
        if id_end < bytes.len()
            && bytes[id_end] == b']'
            && let Some(slice) = body.get(id_start..id_end)
            && let Ok(id) = Uuid::parse_str(slice)
        {
            out.push(Found { start, end: id_end + 1, id });
            i = id_end + 1;
        } else {
            i = id_start;
        }
    }
    out
}

/// Id упомянутых людей в порядке появления, без повторов
pub fn extract(body: &str) -> Vec<Uuid> {
    let mut out: Vec<Uuid> = Vec::new();
    for found in find_all(body) {
        if !out.contains(&found.id) {
            out.push(found.id);
        }
    }
    out
}

/// Текст без меток: вместо `@[id]` стоит `@Имя` (для превью в уведомлении). Кого нет среди известных, показывается как `@кто-то`.
pub fn render(body: &str, name_of: impl Fn(Uuid) -> Option<String>) -> String {
    let mut out = String::with_capacity(body.len());
    let mut at = 0;
    for found in find_all(body) {
        out.push_str(&body[at..found.start]);
        out.push('@');
        out.push_str(&name_of(found.id).unwrap_or_else(|| "кто-то".to_owned()));
        at = found.end;
    }
    out.push_str(&body[at..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "11111111-1111-4111-8111-111111111111";
    const B: &str = "22222222-2222-4222-8222-222222222222";

    fn id(s: &str) -> Uuid {
        Uuid::parse_str(s).unwrap()
    }

    #[test]
    fn finds_marks_in_order_without_repeats() {
        let body = format!("@[{A}] посмотри, @[{B}] тоже, и ещё раз @[{A}]");
        assert_eq!(extract(&body), vec![id(A), id(B)]);
    }

    #[test]
    fn plain_text_and_other_brackets_are_not_marks() {
        for body in [
            "",
            "без упоминаний",
            "@[не-id]",
            "@[]",
            "[см. заметку]",
            "@Лена",
            &format!("@[{}]", &A[..35]),   // id короче
            &format!("@[{A}x]"),           // лишний знак перед скобкой
            &format!("@{A}"),              // без скобок
            &format!("@ [{A}]"),           // пробел после @
            &format!("[@{A}]"),            // скобка снаружи
        ] {
            assert!(extract(body).is_empty(), "{body:?}");
        }
    }

    #[test]
    fn a_mark_works_next_to_text_and_punctuation() {
        assert_eq!(extract(&format!("(@[{A}])")), vec![id(A)]);
        assert_eq!(extract(&format!("Привет,@[{A}]!")), vec![id(A)]);
        assert_eq!(extract(&format!("@[{A}]@[{B}]")), vec![id(A), id(B)]);
    }

    #[test]
    fn upper_case_id_is_the_same_person() {
        assert_eq!(extract(&format!("@[{}]", A.to_uppercase())), vec![id(A)]);
    }

    #[test]
    fn multibyte_text_around_marks_does_not_break_slicing() {
        let body = format!("Ёж🦔 @[{A}] — юникод ✓ @[{B}]я");
        assert_eq!(extract(&body), vec![id(A), id(B)]);
        // метка, оборванная многобайтовым знаком: не паника, а обычный текст
        assert!(extract("@[11111111-1111-4111-8111-11111111111я]").is_empty());
    }

    #[test]
    fn render_puts_names_instead_of_marks() {
        let body = format!("@[{A}] посмотри, @[{B}] тоже");
        let text = render(&body, |u| (u == id(A)).then(|| "Лена М.".to_owned()));
        assert_eq!(text, "@Лена М. посмотри, @кто-то тоже");
    }

    #[test]
    fn render_leaves_text_without_marks_as_is() {
        assert_eq!(render("Просто текст @ с [скобками]", |_| None), "Просто текст @ с [скобками]");
        assert_eq!(render("", |_| None), "");
    }
}
