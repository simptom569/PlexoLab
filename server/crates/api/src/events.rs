//! События для живых обновлений: что поменялось и у кого. Данных в событии нет, только «что и где»: клиент
//! перечитывает нужный запрос (docs/DATA-MODEL.md, раздел про WebSocket).
//!
//! События рассылает один слой над всеми ручками (`publish_events`), а не сами ручки. Слой видит ответ уже после того,
//! как ручка закончила, а значит, и после `commit`: откатившаяся транзакция даёт ошибку, а на ошибку событие не
//! рассылается. Какие события даёт ручка, записано в таблице `TABLE`; тест сверяет её со схемой OpenAPI, поэтому новая
//! ручка записи без строки в таблице не пройдёт тесты.

use std::sync::Arc;

use axum::{
    extract::{MatchedPath, RawPathParams, Request, State},
    http::Method,
    middleware::Next,
    response::Response,
};
use serde::Serialize;
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::state::AppState;

/// Сколько событий канал хранит для медленных получателей. Кто отстал больше, получает `resync` и перечитывает всё.
pub const DEFAULT_CAPACITY: usize = 256;

/// Заголовок, которым клиент называет себя. Событие от его же запроса клиент пропускает.
pub const CLIENT_ID_HEADER: &str = "x-client-id";

/// Самая длинная допустимая метка клиента; длиннее и с лишними символами игнорируется
const MAX_CLIENT_ID_LEN: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Event {
    /// `task.updated`, `wiki.updated` и т. п.
    #[serde(rename = "type")]
    pub kind: &'static str,
    /// Что изменилось, если ручка это знает (задача, страница, документ…). Без него клиент перечитывает всё такого рода.
    pub id: Option<Uuid>,
    /// Проект, если событие относится к одному проекту и ручка его знает
    pub project_id: Option<Uuid>,
    /// Метка клиента, который это сделал (заголовок `X-Client-Id`); он своё событие пропускает
    pub origin: Option<String>,
}

/// Канал, по которому события идут ко всем подключённым клиентам. Внутри одного процесса: сервер один.
#[derive(Clone)]
pub struct Events {
    tx: broadcast::Sender<Arc<Event>>,
}

impl Events {
    pub fn new(capacity: usize) -> Self {
        Events { tx: broadcast::channel(capacity).0 }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Arc<Event>> {
        self.tx.subscribe()
    }

    /// Разослать. Если никто не подключён, событие просто пропадает: так и задумано.
    pub fn publish(&self, event: Event) {
        let _ = self.tx.send(Arc::new(event));
    }
}

impl Default for Events {
    fn default() -> Self {
        Events::new(DEFAULT_CAPACITY)
    }
}

/// Одно событие ручки: тип и берётся ли `id` из адреса (`{id}`)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rule {
    pub kind: &'static str,
    pub with_id: bool,
}

/// Событие без `id`: клиент перечитывает всё такого рода
const fn all(kind: &'static str) -> Rule {
    Rule { kind, with_id: false }
}

/// Событие с `id` из адреса
const fn one(kind: &'static str) -> Rule {
    Rule { kind, with_id: true }
}

/// В ленту активности могла попасть запись
const ACTIVITY: Rule = all("activity.created");

const API: &str = "/api/v1";

/// Ручки записи и события, которые они дают. `{id}` в адресе `/projects/{id}/...` — это проект, он попадает в
/// `project_id`, а у остальных ручек `{id}` — сама изменённая запись (`one`).
///
/// Перенос карточки идёт тем же `PATCH /tasks/{id}`, что и правка, а тело запроса слой не разбирает, поэтому он даёт
/// `task.updated`. `task.moved` — это задачи, переехавшие при удалении колонки.
#[rustfmt::skip]
static TABLE: &[(&str, &str, &[Rule])] = &[
    // доска
    ("POST",   "/projects/{id}/columns",    &[all("column.changed")]),
    ("PATCH",  "/columns/{id}",             &[one("column.changed")]),
    ("DELETE", "/columns/{id}",             &[one("column.changed"), all("task.moved")]),
    ("POST",   "/projects/{id}/tasks",      &[all("task.created"), ACTIVITY]),
    ("PATCH",  "/tasks/{id}",               &[one("task.updated"), ACTIVITY]),
    ("DELETE", "/tasks/{id}",               &[one("task.deleted"), ACTIVITY]),
    ("POST",   "/tasks/{id}/subtasks",      &[one("task.updated")]),
    ("PATCH",  "/subtasks/{id}",            &[all("task.updated")]),
    ("DELETE", "/subtasks/{id}",            &[all("task.updated")]),
    ("POST",   "/tasks/{id}/comments",      &[one("comment.created"), ACTIVITY]),
    ("POST",   "/tasks/{id}/files",         &[one("task.updated"), all("file.changed"), ACTIVITY]),
    ("POST",   "/tags",                     &[all("tag.changed")]),
    ("DELETE", "/tags/{id}",                &[one("tag.changed"), all("task.updated")]),
    // модули, вехи, релизы
    ("POST",   "/projects/{id}/modules",    &[all("module.changed"), ACTIVITY]),
    ("PATCH",  "/modules/{id}",             &[one("module.changed"), ACTIVITY]),
    ("DELETE", "/modules/{id}",             &[one("module.changed"), all("task.updated"), ACTIVITY]),
    ("POST",   "/projects/{id}/milestones", &[all("milestone.changed"), ACTIVITY]),
    ("PATCH",  "/milestones/{id}",          &[one("milestone.changed")]),
    ("DELETE", "/milestones/{id}",          &[one("milestone.changed"), all("task.updated"), ACTIVITY]),
    ("POST",   "/projects/{id}/releases",   &[all("release.changed"), ACTIVITY]),
    ("PATCH",  "/releases/{id}",            &[one("release.changed"), ACTIVITY]),
    ("DELETE", "/releases/{id}",            &[one("release.changed"), ACTIVITY]),
    ("POST",   "/releases/{id}/items",      &[one("release.changed")]),
    ("PATCH",  "/release-items/{id}",       &[all("release.changed"), ACTIVITY]),
    ("DELETE", "/release-items/{id}",       &[all("release.changed")]),
    // вики
    ("POST",   "/wiki",                     &[all("wiki.updated"), ACTIVITY]),
    ("PATCH",  "/wiki/{id}",                &[one("wiki.updated"), ACTIVITY]),
    ("DELETE", "/wiki/{id}",                &[one("wiki.updated"), all("file.changed"), ACTIVITY]),
    // документы и холст
    ("POST",   "/docs",                     &[all("doc.updated"), ACTIVITY]),
    ("PATCH",  "/docs/{id}",                &[one("doc.updated"), ACTIVITY]),
    ("DELETE", "/docs/{id}",                &[one("doc.updated"), ACTIVITY]),
    ("PUT",    "/docs/{id}/canvas",         &[one("doc.canvas")]),
    ("PUT",    "/docs/{id}/star",           &[one("doc.updated")]),
    // файлы и папки
    ("POST",   "/files",                    &[all("file.changed"), ACTIVITY]),
    ("DELETE", "/files/{id}",               &[one("file.changed"), ACTIVITY]),
    ("POST",   "/folders",                  &[all("file.changed")]),
    ("DELETE", "/folders/{id}",             &[all("file.changed")]),
    // участники: человек поменял своё имя, подпись или цвет аватара; клиенты перечитывают список участников
    ("PATCH",  "/me",                       &[all("user.changed")]),
    // ссылки команды
    ("POST",   "/link-groups",              &[all("link.changed")]),
    ("PATCH",  "/link-groups/{id}",         &[one("link.changed")]),
    ("DELETE", "/link-groups/{id}",         &[one("link.changed")]),
    ("POST",   "/link-groups/{id}/links",   &[one("link.changed")]),
    ("DELETE", "/links/{id}",               &[all("link.changed")]),
];

/// События ручки записи; пусто, если ручка ничего не меняет (чтение, вход) или её нет в таблице
pub fn rules(method: &Method, path: &str) -> &'static [Rule] {
    let Some(short) = path.strip_prefix(API) else { return &[] };
    TABLE.iter().find(|(m, p, _)| *m == method.as_str() && *p == short).map_or(&[], |(_, _, rules)| rules)
}

/// Метка клиента из заголовка: до 64 букв, цифр, дефисов и подчёркиваний, остальное игнорируется
fn clean_client_id(raw: &str) -> Option<String> {
    let ok = !raw.is_empty()
        && raw.len() <= MAX_CLIENT_ID_LEN
        && raw.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    ok.then(|| raw.to_owned())
}

/// Слой над ручками записи: после успешного ответа рассылает события ручки
pub async fn publish_events(
    State(state): State<AppState>,
    matched: MatchedPath,
    params: RawPathParams,
    request: Request,
    next: Next,
) -> Response {
    let method = request.method().clone();
    let origin = request.headers().get(CLIENT_ID_HEADER).and_then(|v| v.to_str().ok()).and_then(clean_client_id);
    let path = matched.as_str().to_owned();
    let id = params.iter().find(|(name, _)| *name == "id").and_then(|(_, value)| Uuid::parse_str(value).ok());

    let response = next.run(request).await;

    if response.status().is_success() {
        // в адресах `/projects/{id}/...` идентификатор — проект, у остальных — сама запись
        let in_project = path.starts_with("/api/v1/projects/{id}/");
        for rule in rules(&method, &path) {
            state.events.publish(Event {
                kind: rule.kind,
                id: if rule.with_id && !in_project { id } else { None },
                project_id: if in_project { id } else { None },
                origin: origin.clone(),
            });
        }
    }
    response
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    /// Ручки входа не меняют общих данных: событий не дают
    fn is_auth(path: &str) -> bool {
        path.starts_with("/api/v1/auth/")
    }

    /// Все ручки записи из схемы OpenAPI: (метод, адрес)
    fn mutating_routes() -> Vec<(Method, String)> {
        let doc = crate::openapi_document();
        let mut routes = Vec::new();
        for (path, item) in doc["paths"].as_object().expect("в схеме есть paths") {
            for method in item.as_object().expect("у адреса есть методы").keys() {
                if method == "get" || is_auth(path) {
                    continue;
                }
                routes.push((Method::from_bytes(method.to_uppercase().as_bytes()).unwrap(), path.clone()));
            }
        }
        routes
    }

    #[test]
    fn every_mutating_route_has_events() {
        let routes = mutating_routes();
        assert!(routes.len() > 40, "ручек записи подозрительно мало: {}", routes.len());
        for (method, path) in routes {
            assert!(
                !rules(&method, &path).is_empty(),
                "{method} {path}: нет строки в events::TABLE, клиенты не узнают об изменении"
            );
        }
    }

    #[test]
    fn table_has_no_stale_rows() {
        let routes: HashSet<(String, String)> =
            mutating_routes().into_iter().map(|(m, p)| (m.to_string(), p)).collect();
        for (method, path, rules) in TABLE {
            assert!(!rules.is_empty(), "{method} {path}: пустой список событий");
            assert!(routes.contains(&(method.to_string(), format!("{API}{path}"))), "{method} {path}: такой ручки нет");
        }
        let unique: HashSet<_> = TABLE.iter().map(|(m, p, _)| (*m, *p)).collect();
        assert_eq!(unique.len(), TABLE.len(), "ручка записана в таблице дважды");
    }

    #[test]
    fn reads_and_login_give_no_events() {
        assert!(rules(&Method::GET, "/api/v1/tasks/{id}").is_empty());
        assert!(rules(&Method::GET, "/api/v1/activity").is_empty());
        assert!(rules(&Method::POST, "/api/v1/auth/login").is_empty());
        assert!(rules(&Method::POST, "/api/v1/auth/refresh").is_empty());
        assert!(rules(&Method::POST, "/other/tasks/{id}").is_empty());
    }

    #[test]
    fn project_routes_never_carry_the_record_id() {
        for (_, path, rules) in TABLE {
            if path.starts_with("/projects/{id}/") {
                assert!(rules.iter().all(|r| !r.with_id), "{path}: в адресе проект, а не запись");
            }
        }
    }

    #[test]
    fn client_id_is_checked() {
        assert_eq!(clean_client_id("6f1d-AB_9").as_deref(), Some("6f1d-AB_9"));
        for bad in ["", "с пробелом", "a b", "a\nb", &"x".repeat(65)] {
            assert_eq!(clean_client_id(bad), None, "{bad:?}");
        }
        assert!(clean_client_id(&"x".repeat(64)).is_some());
    }
}
