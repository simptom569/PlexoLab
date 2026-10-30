//! Коды из писем (регистрация, сброс пароля): шесть цифр, срок жизни, число попыток, лимиты на письма.
//! В базе лежит только хэш кода, как и у refresh-токенов.

use sha2::{Digest, Sha256};

use crate::auth::AuthError;

/// Сколько цифр в коде
pub const CODE_LEN: usize = 6;
/// Сколько минут код действует. Это число написано и в текстах писем (`server/crates/api/mail/`): менять вместе.
pub const CODE_TTL_MINUTES: i64 = 15;
/// Сколько раз можно ошибиться в одном коде, потом он сгорает и нужен новый
pub const MAX_CODE_ATTEMPTS: i16 = 5;
/// Новое письмо на один адрес не чаще, чем раз в столько секунд
pub const RESEND_COOLDOWN_SECS: i64 = 60;
/// Сколько писем с кодами сервер отправляет за час (все адреса вместе); `MAIL_MAX_PER_HOUR` меняет
pub const DEFAULT_MAX_MAILS_PER_HOUR: u32 = 30;
/// Больше писем в час настройка не допускает: у бесплатного тарифа Resend есть дневной потолок
pub const MAX_MAILS_PER_HOUR_LIMIT: u32 = 1000;

/// Зачем выдан код. Код регистрации не подходит для сброса пароля и наоборот.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Purpose {
    Register,
    Reset,
}

impl Purpose {
    /// Значение колонки `email_codes.purpose`
    pub fn as_str(self) -> &'static str {
        match self {
            Purpose::Register => "register",
            Purpose::Reset => "reset",
        }
    }
}

/// Новый код из шести цифр. Цифры равновероятны: числа из «хвоста» диапазона, который не делится на миллион, отбрасываются.
pub fn generate_code() -> Result<String, AuthError> {
    loop {
        let mut bytes = [0u8; 4];
        getrandom::fill(&mut bytes).map_err(|_| AuthError::Random)?;
        if let Some(code) = digits_from(u32::from_le_bytes(bytes)) {
            return Ok(code);
        }
    }
}

/// Шесть цифр из случайного числа; `None`, если число попало в хвост, который сделал бы одни коды вероятнее других
fn digits_from(n: u32) -> Option<String> {
    const MILLION: u32 = 1_000_000;
    const LIMIT: u32 = (u32::MAX / MILLION) * MILLION;
    (n < LIMIT).then(|| format!("{:0width$}", n % MILLION, width = CODE_LEN))
}

/// Код, как его ввёл человек: пробелы и дефисы («123 456», «123-456») убираются; ровно шесть цифр или `None`
pub fn clean_code(input: &str) -> Option<String> {
    let code: String = input.chars().filter(|c| !c.is_whitespace() && *c != '-').collect();
    (code.len() == CODE_LEN && code.bytes().all(|b| b.is_ascii_digit())).then_some(code)
}

/// То, что лежит в базе вместо кода. В хэш входят назначение и адрес: хэш одного письма не подойдёт к другому.
pub fn hash_code(purpose: Purpose, email: &str, code: &str) -> String {
    let digest = Sha256::digest(format!("{}\n{email}\n{code}", purpose.as_str()).as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_has_six_digits_and_differs_from_time_to_time() {
        let codes: Vec<String> = (0..20).map(|_| generate_code().unwrap()).collect();
        for code in &codes {
            assert_eq!(code.len(), CODE_LEN, "{code}");
            assert!(code.bytes().all(|b| b.is_ascii_digit()), "{code}");
        }
        assert!(codes.iter().any(|c| c != &codes[0]), "двадцать одинаковых кодов подряд");
    }

    #[test]
    fn leading_zeros_are_kept() {
        assert_eq!(digits_from(0).as_deref(), Some("000000"));
        assert_eq!(digits_from(42).as_deref(), Some("000042"));
        assert_eq!(digits_from(999_999).as_deref(), Some("999999"));
        assert_eq!(digits_from(1_000_000).as_deref(), Some("000000"));
    }

    #[test]
    fn the_uneven_tail_of_the_range_is_thrown_away() {
        // 4 294 000 000 — наибольшее кратное миллиону, умещающееся в u32; всё выше сделало бы малые коды вероятнее
        assert!(digits_from(4_293_999_999).is_some());
        assert!(digits_from(4_294_000_000).is_none());
        assert!(digits_from(u32::MAX).is_none());
    }

    #[test]
    fn typed_code_is_cleaned_up() {
        assert_eq!(clean_code("123456").as_deref(), Some("123456"));
        assert_eq!(clean_code(" 123 456 ").as_deref(), Some("123456"));
        assert_eq!(clean_code("123-456").as_deref(), Some("123456"));
        for bad in ["", "12345", "1234567", "12345a", "١٢٣٤٥٦", "12 34 5", "abcdef"] {
            assert_eq!(clean_code(bad), None, "«{bad}»");
        }
    }

    #[test]
    fn hash_depends_on_purpose_email_and_code() {
        let base = hash_code(Purpose::Register, "a@b.c", "123456");
        assert_eq!(base.len(), 64);
        assert_eq!(base, hash_code(Purpose::Register, "a@b.c", "123456"), "хэш детерминирован");
        assert_ne!(base, hash_code(Purpose::Reset, "a@b.c", "123456"));
        assert_ne!(base, hash_code(Purpose::Register, "x@b.c", "123456"));
        assert_ne!(base, hash_code(Purpose::Register, "a@b.c", "123457"));
        assert!(!base.contains("123456"), "в хэше самого кода нет");
    }
}
