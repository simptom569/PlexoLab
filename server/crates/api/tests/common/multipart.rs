//! Тело формы multipart/form-data для тестов загрузки

use super::Part;

/// Тип содержимого и тело формы
pub fn multipart_body(parts: &[Part]) -> (String, Vec<u8>) {
    let boundary = "----plexolab-test-boundary";
    let mut body = Vec::new();
    for p in parts {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        let mut disposition = format!("Content-Disposition: form-data; name=\"{}\"", p.name);
        if let Some(f) = &p.filename {
            disposition.push_str(&format!("; filename=\"{f}\""));
        }
        body.extend_from_slice(disposition.as_bytes());
        body.extend_from_slice(b"\r\n\r\n");
        body.extend_from_slice(&p.data);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    (format!("multipart/form-data; boundary={boundary}"), body)
}
