//! Файлы на диске: `<DATA_DIR>/files/<ключ>`, где ключ — случайный uuid. Имя файла живёт только в базе,
//! поэтому по диску нельзя ни угадать путь, ни выйти за папку.

use std::path::{Path, PathBuf};

use uuid::Uuid;

/// Папка с файлами внутри папки данных
fn files_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("files")
}

/// Новый ключ для файла
pub fn new_key() -> String {
    Uuid::new_v4().to_string()
}

/// Путь к файлу по ключу. `None`, если ключ не похож на наш (например, `seed:...` у демо-файлов).
pub fn path(data_dir: &Path, key: &str) -> Option<PathBuf> {
    let id = Uuid::parse_str(key).ok().filter(|id| id.to_string() == key)?;
    Some(files_dir(data_dir).join(id.to_string()))
}

pub async fn ensure_dir(data_dir: &Path) -> std::io::Result<()> {
    tokio::fs::create_dir_all(files_dir(data_dir)).await
}

/// Удаляет файлы с диска. Нет файла — не ошибка; остальные сбои уходят в лог, ответ пользователю они не портят.
pub async fn remove_all(data_dir: &Path, keys: &[String]) {
    for key in keys {
        let Some(path) = path(data_dir, key) else { continue };
        match tokio::fs::remove_file(&path).await {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => tracing::warn!(error = %e, path = %path.display(), "не удалось удалить файл с диска"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_uuids_become_paths() {
        let dir = Path::new("/data");
        let key = new_key();
        assert_eq!(path(dir, &key), Some(PathBuf::from("/data").join("files").join(&key)));
        for bad in ["", "seed:sso-flow.png", "../secret", &key.to_uppercase(), &format!("{key}/x"), &key[1..]] {
            assert_eq!(path(dir, bad), None, "{bad:?}");
        }
    }
}
