//! Правила файлов: тип по расширению, чистка имени, лимиты. Одни и те же для библиотеки вики и вложений задач.

/// Типы файлов в базе (`files.kind`)
pub const FILE_KINDS: [&str; 6] = ["img", "pdf", "doc", "sheet", "zip", "other"];

pub const MAX_FILE_NAME_LEN: usize = 255;
pub const MAX_FOLDER_NAME_LEN: usize = 100;
/// Файлов в одной загрузке: больше человек за раз не прикладывает, а лишнее съедало бы диск запросами без конца
pub const MAX_FILES_PER_UPLOAD: usize = 50;
/// Лимит одного файла по умолчанию (docs/ARCHITECTURE.md), меняется настройкой `MAX_UPLOAD_MB`
pub const DEFAULT_MAX_UPLOAD_BYTES: u64 = 25 * 1024 * 1024;

/// Папка, куда попадают файлы, прикреплённые к странице вики (`uploadFiles('Вложения', ...)` в макете)
pub const ATTACHMENTS_FOLDER: &str = "Вложения";

pub fn is_kind(value: &str) -> bool {
    FILE_KINDS.contains(&value)
}

/// Тип файла по расширению (`kindOf` в макете)
pub fn file_kind(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("").to_lowercase().as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" => "img",
        "pdf" => "pdf",
        "doc" | "docx" | "txt" | "md" | "rtf" => "doc",
        "xls" | "xlsx" | "csv" => "sheet",
        "zip" | "rar" | "7z" | "gz" | "tar" => "zip",
        _ => "other",
    }
}

/// Имя файла из заголовка загрузки. Старые браузеры присылают полный путь, берём последнюю часть.
/// `None`, если имени нет или оно длиннее `MAX_FILE_NAME_LEN`.
pub fn clean_file_name(raw: &str) -> Option<String> {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let name: String = base.chars().filter(|c| !c.is_control()).collect();
    let name = name.trim();
    (!name.is_empty() && name != "." && name != ".." && name.chars().count() <= MAX_FILE_NAME_LEN)
        .then(|| name.to_owned())
}

/// Название новой папки по краям без пробелов
pub fn clean_folder_name(raw: &str) -> Option<String> {
    let name = raw.trim();
    (!name.is_empty() && name.chars().count() <= MAX_FOLDER_NAME_LEN).then(|| name.to_owned())
}

/// «1 файл», «3 файла», «5 файлов» для записей в ленте
pub fn files_text(count: usize) -> String {
    let word = match (count % 100, count % 10) {
        (11..=14, _) => "файлов",
        (_, 1) => "файл",
        (_, 2..=4) => "файла",
        _ => "файлов",
    };
    format!("{count} {word}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_follows_the_extension_case_insensitively() {
        assert_eq!(file_kind("sso-flow.PNG"), "img");
        assert_eq!(file_kind("architecture-v2.pdf"), "pdf");
        assert_eq!(file_kind("заметки.md"), "doc");
        assert_eq!(file_kind("метрики-q3.xlsx"), "sheet");
        assert_eq!(file_kind("ui-kit.zip"), "zip");
        assert_eq!(file_kind("Makefile"), "other");
        assert_eq!(file_kind("archive.tar.gz"), "zip");
        assert!(FILE_KINDS.iter().all(|k| is_kind(k)));
        assert!(!is_kind("video"));
    }

    #[test]
    fn file_name_loses_the_path_and_control_characters() {
        assert_eq!(clean_file_name("C:\\Users\\me\\Desktop\\план.pdf").as_deref(), Some("план.pdf"));
        assert_eq!(clean_file_name("../../etc/passwd").as_deref(), Some("passwd"));
        assert_eq!(clean_file_name("  отчёт\u{0}.xlsx\n").as_deref(), Some("отчёт.xlsx"));
    }

    #[test]
    fn bad_file_names_are_rejected() {
        for bad in ["", "   ", ".", "..", "dir/", "a\\"] {
            assert_eq!(clean_file_name(bad), None, "{bad:?}");
        }
        assert!(clean_file_name(&"я".repeat(MAX_FILE_NAME_LEN)).is_some());
        assert!(clean_file_name(&"я".repeat(MAX_FILE_NAME_LEN + 1)).is_none());
    }

    #[test]
    fn folder_name_is_trimmed() {
        assert_eq!(clean_folder_name("  Дизайн ").as_deref(), Some("Дизайн"));
        assert_eq!(clean_folder_name("  "), None);
        assert!(clean_folder_name(&"я".repeat(MAX_FOLDER_NAME_LEN + 1)).is_none());
    }

    #[test]
    fn files_text_picks_the_right_form() {
        let text: Vec<String> = [1, 2, 4, 5, 11, 12, 21, 22, 25, 111].map(files_text).into();
        assert_eq!(
            text,
            [
                "1 файл",
                "2 файла",
                "4 файла",
                "5 файлов",
                "11 файлов",
                "12 файлов",
                "21 файл",
                "22 файла",
                "25 файлов",
                "111 файлов"
            ]
        );
    }
}
