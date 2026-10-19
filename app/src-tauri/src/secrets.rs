//! Секреты в системном хранилище учётных данных (на Windows это Credential Manager).
//! Там лежит refresh-токен: он не должен храниться открытым текстом в файле настроек.
//! Токен привязан к адресу сервера, чтобы токены разных серверов не путались.

use keyring_core::{Entry, Error};

const SERVICE: &str = "com.simptom.plexolab";

/// Подключает хранилище ОС. Вызывается один раз при старте.
pub fn init() {
    #[cfg(windows)]
    match windows_native_keyring_store::Store::new() {
        Ok(store) => keyring_core::set_default_store(store),
        Err(e) => eprintln!("не удалось подключить хранилище паролей Windows: {e}"),
    }
}

fn entry(server: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, &format!("refresh-token@{server}")).map_err(|e| e.to_string())
}

fn get(server: &str) -> Result<Option<String>, String> {
    match entry(server)?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn set(server: &str, token: &str) -> Result<(), String> {
    entry(server)?.set_password(token).map_err(|e| e.to_string())
}

fn delete(server: &str) -> Result<(), String> {
    match entry(server)?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Сохранённый refresh-токен для сервера; None, если токена нет
#[tauri::command]
pub fn token_get(server: String) -> Result<Option<String>, String> {
    get(&server)
}

#[tauri::command]
pub fn token_set(server: String, token: String) -> Result<(), String> {
    set(&server, &token)
}

/// Удаляет токен; если его не было, это не ошибка
#[tauri::command]
pub fn token_delete(server: String) -> Result<(), String> {
    delete(&server)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    /// Работает с настоящим Credential Manager, но под уникальным именем, и за собой убирает
    #[test]
    fn token_roundtrip_in_the_windows_credential_manager() {
        init();
        let server = format!("http://test-{}.invalid:8080", uuid::Uuid::new_v4());

        assert_eq!(get(&server), Ok(None), "токена ещё нет");
        set(&server, "first-token").unwrap();
        assert_eq!(get(&server), Ok(Some("first-token".to_owned())));
        set(&server, "second-token").unwrap();
        assert_eq!(get(&server), Ok(Some("second-token".to_owned())), "токен заменяется");

        let other = format!("{server}/other");
        assert_eq!(get(&other), Ok(None), "токены разных серверов не смешиваются");

        delete(&server).unwrap();
        assert_eq!(get(&server), Ok(None));
        delete(&server).unwrap(); // повторное удаление не ошибка
    }
}
