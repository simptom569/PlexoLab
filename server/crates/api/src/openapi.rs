use utoipa::{
    Modify, OpenApi,
    openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme},
};

#[derive(OpenApi)]
#[openapi(
    info(
        title = "PlexoLab API",
        description = "Бэкенд PlexoLab. Все ручки под /api/v1, кроме входа нужен токен доступа.",
        version = "0.1.0"
    ),
    modifiers(&SecurityAddon),
    tags(
        (name = "auth", description = "Вход и сессии"),
        (name = "users", description = "Люди, которых вижу"),
        (name = "teams", description = "Команды"),
        (name = "projects", description = "Проекты и данные доски"),
        (name = "columns", description = "Колонки доски"),
        (name = "tasks", description = "Задачи, подзадачи, комментарии"),
        (name = "tags", description = "Метки"),
        (name = "modules", description = "Модули проекта"),
        (name = "milestones", description = "Вехи проекта"),
        (name = "releases", description = "Релизы и чек-лист выкатки"),
        (name = "wiki", description = "Страницы вики"),
        (name = "docs", description = "Документы и холст"),
        (name = "files", description = "Библиотека файлов, папки, вложения задач"),
        (name = "activity", description = "Лента активности команды"),
        (name = "links", description = "Ссылки команды"),
        (name = "notifications", description = "Уведомления: назначили, упомянули"),
        (name = "search", description = "Поиск по названиям: задачи, документы, вики, файлы")
    )
)]
pub struct ApiDoc;

struct SecurityAddon;

impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let components = openapi.components.get_or_insert_with(Default::default);
        components.add_security_scheme(
            "bearer",
            SecurityScheme::Http(HttpBuilder::new().scheme(HttpAuthScheme::Bearer).bearer_format("JWT").build()),
        );
    }
}
