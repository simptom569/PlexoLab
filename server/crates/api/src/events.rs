//! События для живых обновлений: что поменялось и у кого. Данных в событии нет, только «что и где»: клиент
//! перечитывает нужный запрос (docs/DATA-MODEL.md, раздел про WebSocket).
//!
//! События рассылает один слой над всеми ручками (`publish_events`), а не сами ручки. Слой видит ответ уже после того,
//! как ручка закончила, а значит, и после `commit`: откатившаяся транзакция даёт ошибку, а на ошибку событие не
//! рассылается. Какие события даёт ручка, записано в таблице `TABLE`; тест сверяет её со схемой OpenAPI, поэтому новая
//! ручка записи без строки в таблице не пройдёт тесты.

use std::{cell::RefCell, sync::Arc};

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
    /// Команда, если событие относится к вики или библиотеке файлов одной команды и ручка её знает. У событий проектов
    /// поля нет.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_id: Option<Uuid>,
    /// Метка клиента, который это сделал (заголовок `X-Client-Id`); он своё событие пропускает
    pub origin: Option<String>,
    /// Кому событие доставляется. Клиенту не передаётся: фильтрует сервер (`ws`).
    #[serde(skip)]
    pub audience: Audience,
}

/// Кому доставляется событие (docs/PROJECTS.md, раздел 5; docs/TEAMS.md, раздел 13): события проекта получают те, кто его
/// видит, события вики и файлов команды те, кто их читает
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum Audience {
    /// Всем вошедшим: только то, что не принадлежит ни проекту, ни команде (имя человека поменялось)
    #[default]
    Everyone,
    /// Тем, кто видит проект (и администраторам сервера)
    Project(Uuid),
    /// Тем, кто читает вики и файлы команды (и администраторам сервера)
    Team(Uuid),
    /// Только этим людям, независимо от участия в проекте: приглашённому, исключённому
    Users(Vec<Uuid>),
}

/// Что ручка сообщает слою событий о том, к кому относится изменение. Хранится на время одного запроса.
#[derive(Debug, Clone, Default)]
struct Hints {
    project: Option<Uuid>,
    team: Option<Uuid>,
    users: Vec<Uuid>,
}

tokio::task_local! {
    static HINTS: RefCell<Hints>;
}

/// Ручка сообщает, что изменение относится к этому проекту: событие уйдёт только его участникам.
/// Вызывается при получении проекта через `access`, так что ручки делают это не вручную.
pub fn note_project(project_id: Uuid) {
    let _ = HINTS.try_with(|h| h.borrow_mut().project = Some(project_id));
}

/// Ручка сообщает, что изменение относится к вики или файлам этой команды: событие уйдёт только тем, кто их читает.
/// Вызывается при получении команды через `access`.
pub fn note_team(team_id: Uuid) {
    let _ = HINTS.try_with(|h| h.borrow_mut().team = Some(team_id));
}

/// Ручка сообщает, что событие нужно доставить ещё и этому человеку, даже если он не участник проекта
/// (приглашённый, исключённый, принявший приглашение)
pub fn note_user(user_id: Uuid) {
    let _ = HINTS.try_with(|h| {
        let mut h = h.borrow_mut();
        if !h.users.contains(&user_id) {
            h.users.push(user_id);
        }
    });
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

/// Одно событие ручки: тип, берётся ли `id` из адреса (`{id}`) и кому оно адресовано
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rule {
    pub kind: &'static str,
    pub with_id: bool,
    /// Только людям, названным ручкой (`note_user`), а не участникам проекта
    pub to_users: bool,
}

/// Событие без `id`: клиент перечитывает всё такого рода
const fn all(kind: &'static str) -> Rule {
    Rule { kind, with_id: false, to_users: false }
}

/// Событие с `id` из адреса
const fn one(kind: &'static str) -> Rule {
    Rule { kind, with_id: true, to_users: false }
}

/// Событие только названным людям (приглашения): остальным участникам проекта оно не нужно
const fn users(kind: &'static str) -> Rule {
    Rule { kind, with_id: false, to_users: true }
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
    ("PATCH",  "/tasks/{id}",               &[one("task.updated"), ACTIVITY, users("notification.changed")]),
    ("DELETE", "/tasks/{id}",               &[one("task.deleted"), ACTIVITY]),
    ("POST",   "/tasks/{id}/subtasks",      &[one("task.updated")]),
    ("PATCH",  "/subtasks/{id}",            &[all("task.updated")]),
    ("DELETE", "/subtasks/{id}",            &[all("task.updated")]),
    ("POST",   "/tasks/{id}/comments",      &[one("comment.created"), ACTIVITY, users("notification.changed")]),
    ("POST",   "/tasks/{id}/files",         &[one("task.updated"), all("file.changed"), ACTIVITY]),
    ("POST",   "/projects/{id}/tags",       &[all("tag.changed")]),
    ("PATCH",  "/tags/{id}",                &[one("tag.changed")]),
    ("DELETE", "/tags/{id}",                &[one("tag.changed"), all("task.updated")]),
    // проекты, участники, приглашения: проект, список его участников или чьё-то приглашение изменились
    ("POST",   "/projects",                 &[all("project.changed")]),
    ("PATCH",  "/projects/{id}",            &[all("project.changed")]),
    ("POST",   "/projects/{id}/archive",    &[all("project.changed")]),
    ("POST",   "/projects/{id}/unarchive",  &[all("project.changed")]),
    ("PATCH",  "/projects/{id}/members/{user_id}",  &[all("project.changed")]),
    ("DELETE", "/projects/{id}/members/{user_id}",  &[all("project.changed")]),
    ("POST",   "/projects/{id}/invites",    &[all("project.changed"), users("invite.changed")]),
    ("DELETE", "/invites/{id}",             &[all("project.changed"), users("invite.changed")]),
    ("POST",   "/invites/{id}/accept",      &[all("project.changed"), users("invite.changed")]),
    ("POST",   "/invites/{id}/decline",     &[all("project.changed"), users("invite.changed")]),
    // уведомления: прочитал в одном окне, счётчик обновится в других окнах этого же человека
    ("POST",   "/notifications/read-all",   &[users("notification.changed")]),
    ("POST",   "/notifications/{id}/read",  &[users("notification.changed")]),
    // модули, вехи, релизы
    ("POST",   "/projects/{id}/modules",    &[all("module.changed"), ACTIVITY]),
    // ключ модуля меняет id его задач, поэтому перечитываются и задачи
    ("PATCH",  "/modules/{id}",             &[one("module.changed"), all("task.updated"), ACTIVITY]),
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
    ("POST",   "/teams/{id}/wiki",          &[all("wiki.updated"), ACTIVITY]),
    ("PATCH",  "/wiki/{id}",                &[one("wiki.updated"), ACTIVITY]),
    ("DELETE", "/wiki/{id}",                &[one("wiki.updated"), all("file.changed"), ACTIVITY]),
    // документы и холст
    ("POST",   "/projects/{id}/docs",       &[all("doc.updated"), ACTIVITY]),
    ("PATCH",  "/docs/{id}",                &[one("doc.updated"), ACTIVITY]),
    ("DELETE", "/docs/{id}",                &[one("doc.updated"), ACTIVITY]),
    ("PUT",    "/docs/{id}/canvas",         &[one("doc.canvas")]),
    ("PUT",    "/docs/{id}/star",           &[one("doc.updated")]),
    // файлы и папки
    ("POST",   "/teams/{id}/files",         &[all("file.changed"), ACTIVITY]),
    ("DELETE", "/files/{id}",               &[one("file.changed"), ACTIVITY]),
    ("POST",   "/teams/{id}/folders",       &[all("file.changed")]),
    ("DELETE", "/folders/{id}",             &[all("file.changed")]),
    // участники: человек поменял своё имя, подпись или цвет аватара; клиенты перечитывают список участников
    ("PATCH",  "/me",                       &[all("user.changed")]),
    // ссылки проекта
    ("POST",   "/projects/{id}/link-groups", &[all("link.changed")]),
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

    // ручка по ходу работы сообщает, к какому проекту и каким людям относится изменение (`note_project`, `note_user`)
    let (response, hints) = HINTS
        .scope(RefCell::new(Hints::default()), async {
            let response = next.run(request).await;
            let hints = HINTS.with(|h| h.borrow().clone());
            (response, hints)
        })
        .await;

    if response.status().is_success() {
        // в адресах `/projects/{id}/...` идентификатор — проект, в `/teams/{id}/...` — команда, у остальных — сама запись
        let in_project = path.starts_with("/api/v1/projects/{id}/");
        let in_team = path.starts_with("/api/v1/teams/{id}/");
        let project_id = hints.project.or(if in_project { id } else { None });
        let team_id = hints.team.or(if in_team { id } else { None });
        let for_project = match (project_id, team_id) {
            (Some(project), _) => Audience::Project(project),
            (None, Some(team)) => Audience::Team(team),
            (None, None) => Audience::Everyone,
        };
        for rule in rules(&method, &path) {
            let event = |audience: Audience| Event {
                kind: rule.kind,
                id: if rule.with_id && !in_project && !in_team { id } else { None },
                project_id,
                team_id,
                origin: origin.clone(),
                audience,
            };
            if !rule.to_users {
                state.events.publish(event(for_project.clone()));
            }
            // названные люди получают событие, даже если они не участники проекта (приглашённый, исключённый)
            if !hints.users.is_empty() {
                state.events.publish(event(Audience::Users(hints.users.clone())));
            }
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
    fn project_and_team_routes_never_carry_the_record_id() {
        for (_, path, rules) in TABLE {
            if path.starts_with("/projects/{id}/") || path.starts_with("/teams/{id}/") {
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
