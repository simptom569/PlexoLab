//! Письма с кодами: шаблоны и отправка. Три способа отправки на выбор настроек сервера (`config::MailConfig`):
//! Resend (боевой), запись в папку (разработка и e2e-тесты) и память (тесты сервера). Если ничего не задано, почта
//! выключена: регистрации и сброса пароля по почте нет, остаётся `server user add`.

use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::json;

use crate::config::MailConfig;

/// Иконка приложения 72×72 (в письме показывается 36×36); `design/icon.png`, уменьшенная
const LOGO_PNG: &[u8] = include_bytes!("../mail/logo.png");
/// Как письмо ссылается на вложенную иконку: `<img src="cid:logo">`
const LOGO_CONTENT_ID: &str = "logo";
const RESEND_ENDPOINT: &str = "https://api.resend.com/emails";
/// Resend отвечает за доли секунды; дольше ждать нет смысла, человек смотрит на экран регистрации
const SEND_TIMEOUT: Duration = Duration::from_secs(10);

const REGISTRATION_HTML: &str = include_str!("../mail/registration.html");
const REGISTRATION_TEXT: &str = include_str!("../mail/registration.txt");
const PASSWORD_RESET_HTML: &str = include_str!("../mail/password-reset.html");
const PASSWORD_RESET_TEXT: &str = include_str!("../mail/password-reset.txt");

/// Готовое письмо
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mail {
    pub to: String,
    pub subject: String,
    pub html: String,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Template {
    /// Код подтверждения при регистрации
    Registration,
    /// Код для сброса пароля
    PasswordReset,
}

/// Собирает письмо: подставляет код и адрес получателя (в HTML адрес экранируется)
pub fn render(template: Template, code: &str, to: &str) -> Mail {
    let (subject, html, text) = match template {
        Template::Registration => ("PlexoLab: код подтверждения", REGISTRATION_HTML, REGISTRATION_TEXT),
        Template::PasswordReset => ("PlexoLab: код для сброса пароля", PASSWORD_RESET_HTML, PASSWORD_RESET_TEXT),
    };
    Mail {
        to: to.to_owned(),
        subject: subject.to_owned(),
        html: fill(&strip_comments(html), code, &escape_html(to)),
        text: fill(text, code, to),
    }
}

fn fill(template: &str, code: &str, email: &str) -> String {
    // сначала код (одни цифры), потом адрес: чужой текст подставляется последним и заново не разбирается
    template.replace("{{code}}", code).replace("{{email}}", email)
}

/// Убирает HTML-комментарии: в шаблонах они для тех, кто его правит, получателю они не нужны. Условных комментариев
/// для Outlook (`<!--[if mso]>`) в шаблонах нет; появятся, значит, эту функцию надо будет поправить.
fn strip_comments(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(start) = rest.find("<!--") {
        out.push_str(&rest[..start]);
        match rest[start..].find("-->") {
            Some(end) => rest = &rest[start + end + 3..],
            None => {
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    out
}

fn escape_html(raw: &str) -> String {
    raw.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

#[derive(Debug, thiserror::Error)]
pub enum MailError {
    #[error("сервис почты не принял письмо (ответ {0})")]
    Rejected(u16),
    #[error("не удалось связаться с сервисом почты: {0}")]
    Network(String),
    #[error("не удалось записать письмо в папку: {0}")]
    Outbox(String),
}

#[derive(Clone)]
enum Transport {
    Off,
    Resend { client: reqwest::Client, endpoint: String, api_key: String, from: String },
    Outbox(PathBuf),
    Memory(Arc<Mutex<Vec<Mail>>>),
}

/// Отправитель писем. Копируется дёшево, живёт в `AppState`.
#[derive(Clone)]
pub struct Mailer {
    transport: Transport,
}

impl Mailer {
    /// Почта выключена
    pub fn off() -> Mailer {
        Mailer { transport: Transport::Off }
    }

    /// Отправитель по настройкам сервера
    pub fn from_config(config: &MailConfig) -> anyhow::Result<Mailer> {
        Ok(match config {
            MailConfig::Off => Mailer::off(),
            MailConfig::Resend { api_key, from } => Mailer::resend(api_key.expose(), from)?,
            MailConfig::Outbox(dir) => Mailer::outbox(dir),
        })
    }

    /// Отправка через API Resend
    pub fn resend(api_key: &str, from: &str) -> anyhow::Result<Mailer> {
        Mailer::resend_at(RESEND_ENDPOINT, api_key, from)
    }

    /// То же по другому адресу API: нужен тестам, которые подставляют свой «Resend»
    pub fn resend_at(endpoint: &str, api_key: &str, from: &str) -> anyhow::Result<Mailer> {
        // reqwest собран без встроенного шифрования (`rustls-no-provider`): выбираем ring, как легче собирается.
        // Ошибка значит, что провайдер уже установлен, и это нормально.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::builder()
            // Resend отвечает 403 запросам без User-Agent
            .user_agent(concat!("plexolab-server/", env!("CARGO_PKG_VERSION")))
            .timeout(SEND_TIMEOUT)
            .build()?;
        Ok(Mailer {
            transport: Transport::Resend {
                client,
                endpoint: endpoint.to_owned(),
                api_key: api_key.to_owned(),
                from: from.to_owned(),
            },
        })
    }

    /// Письма пишутся файлами в папку (по файлу на письмо, JSON): для разработки и e2e-тестов клиента
    pub fn outbox(dir: &Path) -> Mailer {
        Mailer { transport: Transport::Outbox(dir.to_owned()) }
    }

    /// Письма копятся в памяти (`sent`): для тестов сервера
    pub fn memory() -> Mailer {
        Mailer { transport: Transport::Memory(Arc::default()) }
    }

    /// Есть ли куда отправлять: от этого зависят регистрация и сброс пароля
    pub fn is_enabled(&self) -> bool {
        !matches!(self.transport, Transport::Off)
    }

    /// Что накопилось в памяти (только у `memory()`, у остальных пусто)
    pub fn sent(&self) -> Vec<Mail> {
        match &self.transport {
            Transport::Memory(sent) => sent.lock().unwrap_or_else(|e| e.into_inner()).clone(),
            _ => Vec::new(),
        }
    }

    pub async fn send(&self, mail: Mail) -> Result<(), MailError> {
        match &self.transport {
            // до сюда доходить не должно: ручки проверяют `is_enabled` раньше
            Transport::Off => Ok(()),
            Transport::Memory(sent) => {
                sent.lock().unwrap_or_else(|e| e.into_inner()).push(mail);
                Ok(())
            }
            Transport::Outbox(dir) => write_to_outbox(dir, &mail).await,
            Transport::Resend { client, endpoint, api_key, from } => {
                send_via_resend(client, endpoint, api_key, from, &mail).await
            }
        }
    }
}

async fn write_to_outbox(dir: &Path, mail: &Mail) -> Result<(), MailError> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let to_err = |e: std::io::Error| MailError::Outbox(e.to_string());
    tokio::fs::create_dir_all(dir).await.map_err(to_err)?;
    let millis = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    // имена по возрастанию: последнее письмо — последний файл
    let name = format!("{millis:016}-{:06}.json", COUNTER.fetch_add(1, Ordering::Relaxed));
    let body = json!({ "to": mail.to, "subject": mail.subject, "text": mail.text, "html": mail.html });
    tokio::fs::write(dir.join(name), serde_json::to_vec_pretty(&body).unwrap_or_default()).await.map_err(to_err)?;
    tracing::info!(to = %mail.to, subject = %mail.subject, "письмо записано в папку (MAIL_OUTBOX_DIR)");
    Ok(())
}

async fn send_via_resend(
    client: &reqwest::Client,
    endpoint: &str,
    api_key: &str,
    from: &str,
    mail: &Mail,
) -> Result<(), MailError> {
    let body = json!({
        "from": from,
        "to": [mail.to],
        "subject": mail.subject,
        "html": mail.html,
        "text": mail.text,
        // иконка вкладывается в письмо, а не лежит по ссылке: хостинга у нас нет, и ссылка могла бы умереть
        "attachments": [{
            "filename": "logo.png",
            "content": STANDARD.encode(LOGO_PNG),
            "content_type": "image/png",
            "content_id": LOGO_CONTENT_ID,
        }],
    });
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        // текст ошибки reqwest содержит адрес запроса, но не ключ
        .map_err(|e| MailError::Network(e.without_url().to_string()))?;
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    // что именно не понравилось Resend (чужой домен, неверный ключ, лимит), видно только в журнале сервера
    let detail = response.text().await.unwrap_or_default();
    tracing::error!(status = status.as_u16(), detail = %detail, "Resend не принял письмо");
    Err(MailError::Rejected(status.as_u16()))
}

#[cfg(test)]
mod tests {
    use domain::codes::CODE_TTL_MINUTES;

    use super::*;

    #[test]
    fn registration_mail_carries_code_and_address() {
        let mail = render(Template::Registration, "123456", "lena@example.com");
        assert_eq!(mail.to, "lena@example.com");
        assert_eq!(mail.subject, "PlexoLab: код подтверждения");
        for body in [&mail.html, &mail.text] {
            assert!(body.contains("123456"));
            assert!(body.contains("lena@example.com"));
            assert!(!body.contains("{{"), "остались неподставленные метки");
        }
        assert!(mail.text.contains("Код подтверждения: 123456"));
        assert!(mail.html.contains("Подтвердите e-mail"));
    }

    #[test]
    fn password_reset_mail_carries_code_and_address() {
        let mail = render(Template::PasswordReset, "654321", "lena@example.com");
        assert_eq!(mail.subject, "PlexoLab: код для сброса пароля");
        for body in [&mail.html, &mail.text] {
            assert!(body.contains("654321"));
            assert!(body.contains("lena@example.com"));
            assert!(!body.contains("{{"));
        }
        assert!(mail.text.contains("Код для сброса пароля: 654321"));
        assert!(mail.html.contains("Сброс пароля"));
    }

    #[test]
    fn code_appears_in_the_hidden_preview_and_in_the_big_box() {
        let html = render(Template::Registration, "123456", "a@b.c").html;
        assert_eq!(html.matches("123456").count(), 2, "прехедер и крупный код");
    }

    #[test]
    fn address_is_escaped_in_html_but_not_in_text() {
        let mail = render(Template::Registration, "123456", "a<b>&\"'@example.com");
        assert!(mail.html.contains("a&lt;b&gt;&amp;&quot;&#39;@example.com"));
        assert!(!mail.html.contains("a<b>"), "чужая разметка в письмо не попадает");
        assert!(mail.text.contains("a<b>&\"'@example.com"), "в тексте экранировать нечего");
    }

    #[test]
    fn address_that_looks_like_a_placeholder_is_not_expanded() {
        let mail = render(Template::Registration, "123456", "{{code}}@example.com");
        assert!(mail.text.contains("{{code}}@example.com"));
        assert_eq!(mail.text.matches("123456").count(), 1, "код подставлен один раз, в своё место");
    }

    #[test]
    fn html_comments_are_stripped_and_the_logo_is_inline() {
        for template in [Template::Registration, Template::PasswordReset] {
            let html = render(template, "123456", "a@b.c").html;
            assert!(!html.contains("<!--") && !html.contains("-->"), "комментарии остались");
            assert!(html.contains(r#"src="cid:logo""#), "иконка вставляется вложением");
            assert!(html.starts_with("<!doctype html>"));
        }
    }

    #[test]
    fn strip_comments_handles_edge_cases() {
        assert_eq!(strip_comments("a<!-- x -->b<!--y-->c"), "abc");
        assert_eq!(strip_comments("без комментариев"), "без комментариев");
        assert_eq!(strip_comments("до<!-- незакрытый"), "до", "незакрытый комментарий обрезает хвост");
    }

    #[test]
    fn texts_name_the_same_lifetime_as_the_server() {
        for template in [Template::Registration, Template::PasswordReset] {
            let mail = render(template, "123456", "a@b.c");
            let phrase = format!("Срок: {CODE_TTL_MINUTES} минут");
            assert!(mail.html.contains(&phrase), "в HTML письма срок не «{CODE_TTL_MINUTES} минут»");
            assert!(mail.text.contains(&phrase), "в тексте письма срок не «{CODE_TTL_MINUTES} минут»");
            assert!(mail.html.contains(&format!("Действует {CODE_TTL_MINUTES} минут")), "в прехедере срок другой");
        }
    }

    #[test]
    fn logo_is_a_small_png() {
        assert_eq!(&LOGO_PNG[..8], b"\x89PNG\r\n\x1a\n");
        assert!(LOGO_PNG.len() < 20_000, "иконка в письме должна быть лёгкой: {} байт", LOGO_PNG.len());
    }

    #[tokio::test]
    async fn memory_mailer_keeps_what_was_sent() {
        let mailer = Mailer::memory();
        assert!(mailer.is_enabled());
        mailer.send(render(Template::Registration, "111111", "a@b.c")).await.unwrap();
        mailer.send(render(Template::PasswordReset, "222222", "d@e.f")).await.unwrap();
        let sent = mailer.sent();
        assert_eq!(sent.len(), 2);
        assert_eq!(sent[1].to, "d@e.f");
        assert!(sent[1].text.contains("222222"));
    }

    #[test]
    fn off_mailer_is_disabled_and_remembers_nothing() {
        let mailer = Mailer::off();
        assert!(!mailer.is_enabled());
        assert!(mailer.sent().is_empty());
    }
}
