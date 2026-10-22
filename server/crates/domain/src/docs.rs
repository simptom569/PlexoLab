//! Правила документов и холста: длины, подписи для ленты, фрагмент текста для карточки, проверка холста.

use uuid::Uuid;

pub const MAX_TITLE_LEN: usize = 200;
/// Текст документа целиком (markdown), как у страницы вики
pub const MAX_MD_LEN: usize = 500_000;

/// Режимы документа в базе (`doc_mode`): страница и холст
pub const MODES: [&str; 2] = ["page", "edge"];
/// Типы объектов холста в базе (`obj_type`)
pub const OBJECT_KINDS: [&str; 4] = ["sticky", "rect", "ellipse", "text"];

/// Как документ называется в ленте, пока у него нет названия (createDoc в макете)
pub const UNTITLED_TARGET: &str = "Новый документ";

/// Карточка с текстом на холсте нового документа (createDoc в макете: x 40, y 36, ширина 440)
pub const NEW_NOTE: Note = Note { x: 40.0, y: 36.0, w: 440.0 };

/// Объектов на одном холсте и стрелок между ними: с запасом для схемы на несколько экранов
pub const MAX_OBJECTS: usize = 500;
pub const MAX_LINKS: usize = 2_000;
pub const MAX_OBJECT_TEXT_LEN: usize = 1_000;
/// Расстояние от начала координат холста в любую сторону: холст бесконечный, но дальше 100 000 пикселей не нужно
pub const MAX_COORD: f32 = 100_000.0;
/// Ширина и высота объекта
pub const MAX_SIZE: f32 = 5_000.0;
/// Ширина карточки с текстом: не уже, чем `min-width` в стилях макета
pub const MIN_NOTE_W: f32 = 300.0;
/// Число цветов в палитре объектов (TONES в макете)
pub const COLORS: i16 = 8;

/// Сколько знаков фрагмента текста уходит в карточку списка: в карточку помещаются три строки
pub const SNIPPET_LEN: usize = 300;
/// Сколько первых знаков документа разбирается на фрагмент
pub const SNIPPET_SOURCE_LEN: usize = 4_000;

pub fn is_mode(value: &str) -> bool {
    MODES.contains(&value)
}

/// Название документа по краям без пробелов. Пустое название допустимо («Без названия» рисует клиент).
pub fn clean_title(raw: &str) -> Option<String> {
    let t = raw.trim();
    (t.chars().count() <= MAX_TITLE_LEN).then(|| t.to_owned())
}

/// Цель записи в ленте: название или заглушка для документа без названия
pub fn target(title: &str) -> String {
    if title.trim().is_empty() { UNTITLED_TARGET.to_owned() } else { format!("Документ «{title}»") }
}

/// Что сказать в ленте о новом документе: «создан» или «создан как холст»
pub fn created_text(mode: &str) -> &'static str {
    if mode == "edge" { "создан как холст" } else { "создан" }
}

// ----- Фрагмент текста для карточки -----

/// Убирает в начале строки маркер блока: заголовок, цитату или выноску, пункт списка, номер.
/// Так же, как первый `replace` в `plain` макета (vDocs).
fn strip_marker(line: &str) -> &str {
    let ws = |c: char| c.is_whitespace();

    // `#{1,3}\s+`
    let hashes = line.chars().take_while(|c| *c == '#').count();
    if (1..=3).contains(&hashes) {
        let rest = &line[hashes..];
        if rest.starts_with(ws) {
            return rest.trim_start_matches(ws);
        }
        return line;
    }

    // `>\s?(\[!\w+\]\s*)?`
    if let Some(rest) = line.strip_prefix('>') {
        let rest = rest.strip_prefix(ws).unwrap_or(rest);
        if let Some(after) = rest.strip_prefix("[!") {
            let word = after.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_').count();
            if word > 0
                && let Some(tail) = after[word..].strip_prefix(']')
            {
                return tail.trim_start_matches(ws);
            }
        }
        return rest;
    }

    // `[-*+]\s+(\[[ xX]\]\s+)?`
    if let Some(rest) = line.strip_prefix(['-', '*', '+'])
        && rest.starts_with(ws)
    {
        let rest = rest.trim_start_matches(ws);
        if let Some(tail) = rest.strip_prefix('[')
            && let Some(mark) = tail.chars().next()
            && matches!(mark, ' ' | 'x' | 'X')
            && let Some(after) = tail[mark.len_utf8()..].strip_prefix(']')
            && after.starts_with(ws)
        {
            return after.trim_start_matches(ws);
        }
        return rest;
    }

    // `\d+[.)]\s+`
    let digits = line.chars().take_while(char::is_ascii_digit).count();
    if digits > 0
        && let Some(rest) = line[digits..].strip_prefix(['.', ')'])
        && rest.starts_with(ws)
    {
        return rest.trim_start_matches(ws);
    }

    line
}

/// Убирает разметку внутри строки: `*`, `` ` ``, `~`, `|`, `[[` и `]]`
fn strip_inline(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(c) = rest.chars().next() {
        if matches!(c, '*' | '`' | '~' | '|') {
            rest = &rest[c.len_utf8()..];
        } else if rest.starts_with("[[") || rest.starts_with("]]") {
            rest = &rest[2..];
        } else {
            out.push(c);
            rest = &rest[c.len_utf8()..];
        }
    }
    out
}

/// Строки текста без разметки: пустые и разделители таблиц (`| --- |`) пропущены. Порт `plain` из vDocs макета.
///
/// Как и в макете, строка ```` ```bash ```` теряет обратные кавычки раньше, чем проверяется на ограждение блока кода,
/// поэтому в строки попадает слово `bash`. Это поведение макета, оно сохранено.
pub fn plain_lines(md: &str) -> Vec<String> {
    md.split('\n')
        .map(|l| strip_inline(strip_marker(l)))
        .filter(|l| !l.trim().is_empty() && !l.chars().all(|c| c == '-' || c == ':' || c.is_whitespace()))
        .collect()
}

/// Фрагмент текста для карточки документа: первые три строки без разметки через « · ».
/// Пустая строка означает пустой документ: надпись «Пустой документ» подставляет клиент.
pub fn snippet(md: &str) -> String {
    let source: String = md.chars().take(SNIPPET_SOURCE_LEN).collect();
    let lines = plain_lines(&source);
    lines.iter().take(3).map(String::as_str).collect::<Vec<_>>().join(" · ").chars().take(SNIPPET_LEN).collect()
}

// ----- Холст -----

/// Положение и ширина карточки с текстом документа
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Note {
    pub x: f32,
    pub y: f32,
    pub w: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Object {
    pub id: Uuid,
    pub kind: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub text: String,
    pub color: i16,
}

/// Стрелка от объекта `a` к объекту `b`
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Link {
    pub a: Uuid,
    pub b: Uuid,
}

fn coord(name: &str, v: f32) -> Result<(), String> {
    if v.is_finite() && (-MAX_COORD..=MAX_COORD).contains(&v) {
        Ok(())
    } else {
        Err(format!("{name}: число от -{MAX_COORD} до {MAX_COORD}"))
    }
}

fn size(name: &str, v: f32, min: f32) -> Result<(), String> {
    if v.is_finite() && (min..=MAX_SIZE).contains(&v) {
        Ok(())
    } else {
        Err(format!("{name}: число от {min} до {MAX_SIZE}"))
    }
}

/// Проверяет холст целиком. Текст ошибки готов для ответа 400.
pub fn check_canvas(note: &Note, objects: &[Object], links: &[Link]) -> Result<(), String> {
    coord("Карточка с текстом, x", note.x)?;
    coord("Карточка с текстом, y", note.y)?;
    size("Карточка с текстом, ширина", note.w, MIN_NOTE_W)?;

    if objects.len() > MAX_OBJECTS {
        return Err(format!("Слишком много объектов на холсте: не больше {MAX_OBJECTS}"));
    }
    if links.len() > MAX_LINKS {
        return Err(format!("Слишком много стрелок на холсте: не больше {MAX_LINKS}"));
    }

    let mut ids = std::collections::HashSet::with_capacity(objects.len());
    for o in objects {
        if !ids.insert(o.id) {
            return Err(format!("Объект {} указан дважды", o.id));
        }
        if !OBJECT_KINDS.contains(&o.kind.as_str()) {
            return Err(format!("Неизвестный тип объекта «{}»", o.kind));
        }
        coord("Объект, x", o.x)?;
        coord("Объект, y", o.y)?;
        size("Объект, ширина", o.w, 1.0)?;
        size("Объект, высота", o.h, 1.0)?;
        if o.text.chars().count() > MAX_OBJECT_TEXT_LEN {
            return Err(format!("Текст объекта: не длиннее {MAX_OBJECT_TEXT_LEN} символов"));
        }
        if !(0..COLORS).contains(&o.color) {
            return Err(format!("Цвет объекта: число от 0 до {}", COLORS - 1));
        }
    }

    // пара объектов соединяется одной стрелкой, в какую бы сторону она ни шла (wbLink в макете)
    let mut pairs = std::collections::HashSet::with_capacity(links.len());
    for l in links {
        if l.a == l.b {
            return Err("Стрелка не может вести от объекта к нему самому".to_owned());
        }
        if !ids.contains(&l.a) || !ids.contains(&l.b) {
            return Err("Стрелка ведёт к объекту, которого нет на холсте".to_owned());
        }
        let pair = if l.a < l.b { (l.a, l.b) } else { (l.b, l.a) };
        if !pairs.insert(pair) {
            return Err("Два объекта соединяются одной стрелкой".to_owned());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_is_trimmed_and_may_be_empty() {
        assert_eq!(clean_title("  План "), Some("План".to_owned()));
        assert_eq!(clean_title("   "), Some(String::new()));
        assert!(clean_title(&"я".repeat(MAX_TITLE_LEN)).is_some());
        assert!(clean_title(&"я".repeat(MAX_TITLE_LEN + 1)).is_none());
    }

    #[test]
    fn feed_text_matches_the_mockup() {
        assert_eq!(target(""), "Новый документ");
        assert_eq!(target("Схема сервисов"), "Документ «Схема сервисов»");
        assert_eq!(created_text("page"), "создан");
        assert_eq!(created_text("edge"), "создан как холст");
    }

    #[test]
    fn plain_text_drops_block_markers() {
        let md = "## Цели квартала\n\n1. Выпустить релиз\n2) Второй\n- пункт\n+ плюс\n* звезда\n- [ ] задача\n- [x] готово\n> цитата\n> [!tip] Совет\n> [!warning]";
        assert_eq!(
            plain_lines(md),
            [
                "Цели квартала",
                "Выпустить релиз",
                "Второй",
                "пункт",
                "плюс",
                "звезда",
                "задача",
                "готово",
                "цитата",
                "Совет"
            ]
        );
    }

    #[test]
    fn markers_need_the_right_shape() {
        // четыре решётки, дефис без пробела, число без точки: это обычный текст
        assert_eq!(plain_lines("#### тоже текст"), ["#### тоже текст"]);
        assert_eq!(plain_lines("-минус"), ["-минус"]);
        assert_eq!(plain_lines("2026 год"), ["2026 год"]);
        assert_eq!(plain_lines("#тег"), ["#тег"]);
        // после пустого пункта списка остаётся метка задачи как текст
        assert_eq!(plain_lines("- [ ]"), ["[ ]"]);
    }

    #[test]
    fn inline_markup_is_removed() {
        assert_eq!(
            plain_lines("**жирный** и *курсив* и ~~зачёркнутый~~ и `код`"),
            ["жирный и курсив и зачёркнутый и код"]
        );
        // вертикальная черта убирается везде, в том числе из `[[Страница|подпись]]`: так в макете
        assert_eq!(
            plain_lines("см. [[Соглашения по коду]] и [[Страница|подпись]]"),
            ["см. Соглашения по коду и Страницаподпись"]
        );
        assert_eq!(plain_lines("[ссылка](https://example.com)"), ["[ссылка](https://example.com)"]);
    }

    #[test]
    fn table_separators_and_blank_lines_are_skipped() {
        let md = "| Кто | Фокус |\n| --- | :---: |\n| Лена | Тема |\n\n---\n   ";
        assert_eq!(plain_lines(md), [" Кто  Фокус ", " Лена  Тема "]);
    }

    #[test]
    fn code_fence_with_language_keeps_the_word_like_the_mockup() {
        assert_eq!(plain_lines("```bash\nmake release\n```"), ["bash", "make release"]);
    }

    #[test]
    fn snippet_is_the_first_three_lines() {
        let md = "## Цели квартала\n\n1. Выпустить релиз 2.9.0 до 20 ноября\n2. Закрыть техдолг по авторизации\n3. Подготовить бету";
        assert_eq!(snippet(md), "Цели квартала · Выпустить релиз 2.9.0 до 20 ноября · Закрыть техдолг по авторизации");
        assert_eq!(snippet(""), "");
        assert_eq!(snippet("\n\n---\n"), "");
    }

    #[test]
    fn snippet_is_cut_in_characters() {
        let long = "я".repeat(1_000);
        assert_eq!(snippet(&long).chars().count(), SNIPPET_LEN);
    }

    fn object(n: u128) -> Object {
        Object {
            id: Uuid::from_u128(n),
            kind: "rect".into(),
            x: 10.0,
            y: 20.0,
            w: 100.0,
            h: 50.0,
            text: "Клиент".into(),
            color: 3,
        }
    }

    const NOTE: Note = Note { x: 24.0, y: 28.0, w: 400.0 };

    fn link(a: u128, b: u128) -> Link {
        Link { a: Uuid::from_u128(a), b: Uuid::from_u128(b) }
    }

    #[test]
    fn a_normal_canvas_is_accepted() {
        assert_eq!(check_canvas(&NOTE, &[object(1), object(2)], &[link(1, 2)]), Ok(()));
        assert_eq!(check_canvas(&NOTE, &[], &[]), Ok(()));
    }

    #[test]
    fn note_may_lie_left_and_above_the_origin_but_not_beyond_the_limit() {
        assert!(check_canvas(&Note { x: -1.0, y: -MAX_COORD, ..NOTE }, &[], &[]).is_ok());
        assert!(check_canvas(&Note { x: -MAX_COORD - 1.0, ..NOTE }, &[], &[]).is_err());
        assert!(check_canvas(&Note { y: MAX_COORD + 1.0, ..NOTE }, &[], &[]).is_err());
        assert!(check_canvas(&Note { y: f32::NAN, ..NOTE }, &[], &[]).is_err());
        assert!(check_canvas(&Note { w: 299.0, ..NOTE }, &[], &[]).is_err());
        assert!(check_canvas(&Note { w: MAX_SIZE + 1.0, ..NOTE }, &[], &[]).is_err());
    }

    #[test]
    fn objects_are_checked_one_by_one() {
        let bad = |f: fn(&mut Object)| {
            let mut o = object(1);
            f(&mut o);
            check_canvas(&NOTE, &[o], &[]).is_err()
        };
        assert!(bad(|o| o.kind = "circle".into()));
        assert!(!bad(|o| o.x = -0.5));
        assert!(!bad(|o| o.y = -MAX_COORD));
        assert!(bad(|o| o.x = -MAX_COORD - 1.0));
        assert!(bad(|o| o.y = MAX_COORD + 1.0));
        assert!(bad(|o| o.y = f32::INFINITY));
        assert!(bad(|o| o.w = 0.0));
        assert!(bad(|o| o.h = MAX_SIZE + 1.0));
        assert!(bad(|o| o.color = 8));
        assert!(bad(|o| o.color = -1));
        assert!(bad(|o| o.text = "я".repeat(MAX_OBJECT_TEXT_LEN + 1)));
        assert!(!bad(|o| o.text = "я".repeat(MAX_OBJECT_TEXT_LEN)));
        assert!(!bad(|o| o.color = 7));
    }

    #[test]
    fn same_object_twice_is_rejected() {
        assert!(check_canvas(&NOTE, &[object(1), object(1)], &[]).is_err());
    }

    #[test]
    fn links_must_join_two_different_objects_once() {
        let objects = [object(1), object(2), object(3)];
        assert!(check_canvas(&NOTE, &objects, &[link(1, 1)]).is_err(), "сама на себя");
        assert!(check_canvas(&NOTE, &objects, &[link(1, 9)]).is_err(), "к несуществующему");
        assert!(check_canvas(&NOTE, &objects, &[link(1, 2), link(1, 2)]).is_err(), "дважды");
        assert!(check_canvas(&NOTE, &objects, &[link(1, 2), link(2, 1)]).is_err(), "в обе стороны");
        assert!(check_canvas(&NOTE, &objects, &[link(1, 2), link(2, 3), link(3, 1)]).is_ok());
    }

    #[test]
    fn canvas_size_is_limited() {
        let many: Vec<Object> = (0..=MAX_OBJECTS as u128).map(object).collect();
        assert!(check_canvas(&NOTE, &many, &[]).is_err());
        assert!(check_canvas(&NOTE, &many[..MAX_OBJECTS], &[]).is_ok());
    }
}
