//! Аутентификация без привязки к HTTP и базе: пароли (argon2id), токен доступа (JWT HS256),
//! refresh-токены (случайная строка, в базе хранится только её sha256).

use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use argon2::{
    Argon2,
    password_hash::{PasswordHasher, PasswordVerifier},
};
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

/// Токен доступа живёт 12 часов
pub const ACCESS_TTL_SECS: u64 = 12 * 60 * 60;
/// Refresh-токен живёт 30 дней
pub const REFRESH_TTL_DAYS: i64 = 30;
/// Секрет подписи короче 32 байт не принимается
pub const MIN_JWT_SECRET_LEN: usize = 32;
/// Длиннее пароль не обрабатываем: argon2 дорогой, длинный пароль был бы способом нагрузить сервер
pub const MAX_PASSWORD_LEN: usize = 1024;

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("не удалось вычислить хэш пароля")]
    Hash,
    #[error("не удалось подписать токен")]
    Sign,
    #[error("токен недействителен или просрочен")]
    InvalidToken,
    #[error("нет случайных данных от ОС")]
    Random,
}

/// E-mail в базе хранится в нижнем регистре и без пробелов по краям
pub fn normalize_email(raw: &str) -> String {
    raw.trim().to_lowercase()
}

/// Текущее время в секундах Unix
pub fn now_unix() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

// ===== Пароли =====

/// Хэш пароля в формате PHC (`$argon2id$v=19$...`). Параметры по умолчанию (память 19 МиБ, 2 прохода)
/// рекомендованы OWASP и укладываются в бюджет памяти сервера.
pub fn hash_password(password: &str) -> Result<String, AuthError> {
    Argon2::default().hash_password(password.as_bytes()).map(|h| h.to_string()).map_err(|_| AuthError::Hash)
}

/// Проверяет пароль. Повреждённый хэш считается несовпадением.
pub fn verify_password(password: &str, hash: &str) -> bool {
    Argon2::default().verify_password(password.as_bytes(), hash).is_ok()
}

/// Проверка «вхолостую» для несуществующего пользователя: по времени ответа нельзя отличить
/// неизвестный e-mail от неверного пароля.
pub fn verify_password_dummy(password: &str) {
    static DUMMY: OnceLock<String> = OnceLock::new();
    let hash = DUMMY.get_or_init(|| hash_password("plexolab-dummy-password").unwrap_or_default());
    let _ = verify_password(password, hash);
}

// ===== Токен доступа =====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    /// Пользователь
    pub sub: Uuid,
    /// Выдан (секунды Unix)
    pub iat: u64,
    /// Истекает (секунды Unix)
    pub exp: u64,
}

/// Подписывает токен доступа на `ACCESS_TTL_SECS` секунд от `now`
pub fn issue_access_token(secret: &[u8], user_id: Uuid, now: u64) -> Result<String, AuthError> {
    let claims = Claims { sub: user_id, iat: now, exp: now + ACCESS_TTL_SECS };
    jsonwebtoken::encode(&Header::new(Algorithm::HS256), &claims, &EncodingKey::from_secret(secret))
        .map_err(|_| AuthError::Sign)
}

/// Проверяет подпись (только HS256) и срок
pub fn verify_access_token(secret: &[u8], token: &str) -> Result<Claims, AuthError> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.leeway = 5;
    validation.set_required_spec_claims(&["exp", "sub"]);
    jsonwebtoken::decode::<Claims>(token, &DecodingKey::from_secret(secret), &validation)
        .map(|t| t.claims)
        .map_err(|_| AuthError::InvalidToken)
}

// ===== Refresh-токены =====

/// Новый refresh-токен: 32 случайных байта в hex (64 символа)
pub fn generate_refresh_token() -> Result<String, AuthError> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| AuthError::Random)?;
    Ok(hex(&bytes))
}

/// То, что лежит в базе вместо самого токена
pub fn hash_refresh_token(token: &str) -> String {
    hex(Sha256::digest(token.as_bytes()).as_slice())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &[u8] = b"test-secret-test-secret-test-secret-32";

    #[test]
    fn email_is_trimmed_and_lowercased() {
        assert_eq!(normalize_email("  Lena@Example.COM "), "lena@example.com");
    }

    #[test]
    fn password_roundtrip() {
        let hash = hash_password("correct horse").unwrap();
        assert!(hash.starts_with("$argon2id$v=19$"), "argon2id: {hash}");
        assert!(verify_password("correct horse", &hash));
        assert!(!verify_password("wrong horse", &hash));
        assert!(!verify_password("", &hash));
    }

    #[test]
    fn same_password_gives_different_hashes() {
        assert_ne!(hash_password("dev").unwrap(), hash_password("dev").unwrap(), "соль у каждого своя");
    }

    #[test]
    fn broken_hash_is_a_mismatch_not_a_panic() {
        assert!(!verify_password("dev", "not-a-hash"));
        assert!(!verify_password("dev", ""));
    }

    #[test]
    fn dummy_verify_does_not_panic() {
        verify_password_dummy("anything");
    }

    #[test]
    fn access_token_roundtrip() {
        let id = Uuid::new_v4();
        let now = now_unix();
        let token = issue_access_token(SECRET, id, now).unwrap();
        let claims = verify_access_token(SECRET, &token).unwrap();
        assert_eq!(claims.sub, id);
        assert_eq!(claims.iat, now);
        assert_eq!(claims.exp, now + 12 * 60 * 60, "12 часов");
    }

    #[test]
    fn expired_access_token_is_rejected() {
        let long_ago = now_unix() - ACCESS_TTL_SECS - 3600;
        let token = issue_access_token(SECRET, Uuid::new_v4(), long_ago).unwrap();
        assert!(verify_access_token(SECRET, &token).is_err());
    }

    #[test]
    fn access_token_just_before_expiry_is_valid() {
        let token = issue_access_token(SECRET, Uuid::new_v4(), now_unix() - ACCESS_TTL_SECS + 60).unwrap();
        assert!(verify_access_token(SECRET, &token).is_ok());
    }

    #[test]
    fn access_token_with_other_secret_is_rejected() {
        let token = issue_access_token(SECRET, Uuid::new_v4(), now_unix()).unwrap();
        assert!(verify_access_token(b"another-secret-another-secret-32bytes", &token).is_err());
    }

    #[test]
    fn tampered_or_garbage_token_is_rejected() {
        let token = issue_access_token(SECRET, Uuid::new_v4(), now_unix()).unwrap();
        let mut parts: Vec<&str> = token.split('.').collect();
        parts[1] = "eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDAiLCJpYXQiOjAsImV4cCI6OTk5OTk5OTk5OX0";
        assert!(verify_access_token(SECRET, &parts.join(".")).is_err(), "подменённое содержимое");
        assert!(verify_access_token(SECRET, "garbage").is_err());
        assert!(verify_access_token(SECRET, "").is_err());
    }

    #[test]
    fn token_without_signature_algorithm_none_is_rejected() {
        // {"alg":"none","typ":"JWT"}.{"sub":"…","exp":9999999999}.
        let token = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDAiLCJpYXQiOjAsImV4cCI6OTk5OTk5OTk5OX0.";
        assert!(verify_access_token(SECRET, token).is_err());
    }

    #[test]
    fn refresh_tokens_are_random_and_hashed() {
        let a = generate_refresh_token().unwrap();
        let b = generate_refresh_token().unwrap();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
        let h = hash_refresh_token(&a);
        assert_eq!(h.len(), 64);
        assert_ne!(h, a, "в базу уходит хэш, а не токен");
        assert_eq!(h, hash_refresh_token(&a), "хэш детерминирован");
        assert_ne!(h, hash_refresh_token(&b));
    }

    #[test]
    fn sha256_matches_known_vector() {
        assert_eq!(hash_refresh_token("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
}
