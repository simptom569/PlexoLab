//! Задачи, подзадачи, комментарии. Изменения доски идут по очереди внутри проекта (блокировка проекта),
//! запись в ленту активности делается в той же транзакции, что и действие.

use axum::{Json, extract::State, http::StatusCode};
use db::{
    columns::Column,
    projects::Project,
    sqlx::PgConnection,
    tasks::{self, Patch, Task},
};
use domain::board::{self, MAX_COMMENT_LEN, MAX_DESCRIPTION_LEN, MAX_PR_LEN, MAX_TITLE_LEN};
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::dto::{
    CommentDto, CreateComment, CreateSubtask, CreateTask, SubtaskDto, TaskDetailDto, UpdateSubtask, UpdateTask,
    task_label,
};
use crate::{
    access,
    error::{ApiError, ApiResult, ErrorBody},
    extract::{ApiJson, ApiPath, AuthUser},
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(create_task))
        .routes(routes!(get_task, update_task, delete_task))
        .routes(routes!(create_subtask))
        .routes(routes!(update_subtask, delete_subtask))
        .routes(routes!(create_comment))
}

// ===== Вспомогательное =====

fn bad(message: impl Into<String>) -> ApiError {
    ApiError::BadRequest(message.into())
}

fn clean_title(raw: &str) -> ApiResult<String> {
    board::clean_text(raw, MAX_TITLE_LEN).ok_or_else(|| bad(format!("Название: от 1 до {MAX_TITLE_LEN} символов")))
}

/// «WEB-151 Название» для ленты активности
pub(super) fn target(project: &Project, task: &Task) -> String {
    format!("{} {}", task_label(project.key.as_deref(), task), task.title)
}

async fn column_in_project(conn: &mut PgConnection, column_id: Uuid, project_id: Uuid) -> ApiResult<Column> {
    db::columns::get(&mut *conn, column_id)
        .await?
        .filter(|c| c.project_id == project_id)
        .ok_or_else(|| bad("Колонка не найдена в проекте этой задачи"))
}

/// Находит задачу, если человек участник её проекта (для чтения и мелких правок без блокировки)
pub(super) async fn load(conn: &mut PgConnection, auth: AuthUser, task_id: Uuid) -> ApiResult<(Task, Project)> {
    let task = tasks::get(&mut *conn, task_id).await?.ok_or(ApiError::NotFound)?;
    let project = access::project(conn, auth, task.project_id).await?.project;
    Ok((task, project))
}

/// Находит задачу и блокирует проект и задачу до конца транзакции
pub(super) async fn load_locked(conn: &mut PgConnection, auth: AuthUser, task_id: Uuid) -> ApiResult<(Task, Project)> {
    let task = tasks::get(&mut *conn, task_id).await?.ok_or(ApiError::NotFound)?;
    let project = access::project_locked(conn, auth, task.project_id).await?.project;
    // пока ждали блокировку проекта, задачу могли удалить или изменить: читаем заново
    let task = tasks::get_for_update(conn, task_id).await?.ok_or(ApiError::NotFound)?;
    Ok((task, project))
}

/// Задача со всем содержимым для панели
async fn detail(conn: &mut PgConnection, task: Task, project: &Project) -> ApiResult<TaskDetailDto> {
    let tag_ids = tasks::tag_ids(&mut *conn, task.id).await?;
    let subtasks = db::subtasks::list(&mut *conn, task.id).await?;
    let comments = db::comments::list(&mut *conn, task.id).await?;
    let files = db::files::list_for_task(&mut *conn, task.id).await?;
    Ok(TaskDetailDto {
        key: task_label(project.key.as_deref(), &task),
        id: task.id,
        project_id: task.project_id,
        number: task.number,
        title: task.title,
        description: task.description,
        column_id: task.column_id,
        position: task.position,
        assignee_id: task.assignee_id,
        priority: task.priority,
        start_date: task.start_date,
        due_date: task.due_date,
        module_id: task.module_id,
        milestone_id: task.milestone_id,
        pr: task.pr,
        tag_ids,
        subtasks: subtasks.into_iter().map(Into::into).collect(),
        comments: comments.into_iter().map(Into::into).collect(),
        files: files.into_iter().map(Into::into).collect(),
        created_by: task.created_by,
        created_at: task.created_at,
        updated_at: task.updated_at,
    })
}

// ===== Задачи =====

/// Новая задача в конце колонки или в бэклоге. Номер (WEB-159) выдаётся в той же транзакции.
#[utoipa::path(
    post,
    path = "/projects/{id}/tasks",
    tag = "tasks",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Проект")),
    request_body = CreateTask,
    responses(
        (status = 201, description = "Задача создана", body = TaskDetailDto),
        (status = 400, description = "Некорректный запрос или колонка из другого проекта", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого проекта", body = ErrorBody),
    )
)]
async fn create_task(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(project_id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<CreateTask>,
) -> ApiResult<(StatusCode, Json<TaskDetailDto>)> {
    let title = clean_title(&req.title)?;

    let mut tx = state.pool.begin().await?;
    let project = access::project_locked(&mut tx, auth, project_id).await?.project;
    if let Some(column_id) = req.column_id {
        column_in_project(&mut tx, column_id, project_id).await?;
    }
    // новая задача без модуля: ряд проекта
    let number = tasks::next_number(&mut tx, tasks::Series::Project(project_id)).await?;
    let position = tasks::next_position(&mut tx, project_id, req.column_id).await?;
    let task = tasks::insert(
        &mut tx,
        &tasks::NewTask { project_id, number, title, column_id: req.column_id, position, created_by: auth.id },
    )
    .await?;
    db::activity::insert(&mut tx, auth.id, Some(project_id), "create", &target(&project, &task), "создана").await?;
    let dto = detail(&mut tx, task, &project).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(dto)))
}

/// Задача целиком: поля, метки, подзадачи, комментарии, вложения
#[utoipa::path(
    get,
    path = "/tasks/{id}",
    tag = "tasks",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Задача")),
    responses(
        (status = 200, description = "Задача", body = TaskDetailDto),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такой задачи", body = ErrorBody),
    )
)]
async fn get_task(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<Json<TaskDetailDto>> {
    let mut conn = state.pool.acquire().await?;
    let (task, project) = load(&mut conn, auth, id).await?;
    Ok(Json(detail(&mut conn, task, &project).await?))
}

/// Изменить любые поля задачи. Перенос: `column_id` (null — в бэклог) и `before_id` (встать перед этой задачей,
/// null — в конец). Что не передано, не меняется.
///
/// Позиции дробные: при вставке между соседями берётся среднее, а если зазор меньше 1e-6, позиции всей колонки
/// пересчитываются с шагом 1024. В ленту пишутся перенос в другую колонку и добавление PR.
#[utoipa::path(
    patch,
    path = "/tasks/{id}",
    tag = "tasks",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Задача")),
    request_body = UpdateTask,
    responses(
        (status = 200, description = "Задача после изменений", body = TaskDetailDto),
        (status = 400, description = "Некорректное значение, чужая колонка, модуль, веха или before_id", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такой задачи", body = ErrorBody),
    )
)]
async fn update_task(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<UpdateTask>,
) -> ApiResult<Json<TaskDetailDto>> {
    // значения проверяем до транзакции
    let mut patch = Patch {
        assignee: req.assignee_id,
        start_date: req.start_date,
        due_date: req.due_date,
        module: req.module_id,
        milestone: req.milestone_id,
        ..Patch::default()
    };
    if let Some(title) = &req.title {
        patch.title = Some(clean_title(title)?);
    }
    if let Some(description) = req.description {
        if description.chars().count() > MAX_DESCRIPTION_LEN {
            return Err(bad(format!("Описание длиннее {MAX_DESCRIPTION_LEN} символов")));
        }
        patch.description = Some(description);
    }
    if let Some(pr) = &req.pr {
        let pr = pr.trim();
        if pr.chars().count() > MAX_PR_LEN {
            return Err(bad(format!("Номер PR длиннее {MAX_PR_LEN} символов")));
        }
        patch.pr = Some(pr.to_owned());
    }
    if let Some(priority) = req.priority {
        if !board::is_priority(&priority) {
            return Err(bad("Приоритет: high, med или low"));
        }
        patch.priority = Some(priority);
    }
    let tag_ids = req.tag_ids.map(|mut ids| {
        let mut seen = std::collections::HashSet::new();
        ids.retain(|id| seen.insert(*id));
        ids
    });

    let mut tx = state.pool.begin().await?;
    let (task, project) = load_locked(&mut tx, auth, id).await?;

    // исполнитель должен быть участником проекта; тот, кто уже назначен и вышел из проекта, остаётся
    if let Some(Some(assignee)) = patch.assignee
        && task.assignee_id != Some(assignee)
        && db::members::role_of(&mut *tx, project.id, assignee).await?.is_none()
    {
        return Err(bad("Исполнитель должен быть участником проекта"));
    }
    if let Some(Some(module_id)) = patch.module
        && !db::modules::module_in_project(&mut *tx, module_id, project.id).await?
    {
        return Err(bad("Модуль не найден в проекте этой задачи"));
    }
    if let Some(Some(milestone_id)) = patch.milestone
        && !db::modules::milestone_in_project(&mut *tx, milestone_id, project.id).await?
    {
        return Err(bad("Веха не найдена в проекте этой задачи"));
    }

    let mut current = if patch.is_empty() { task.clone() } else { tasks::update(&mut tx, id, &patch).await? };

    if let Some(ids) = &tag_ids {
        if db::tags::count_in_project(&mut *tx, project.id, ids).await? != ids.len() as i64 {
            return Err(bad("Среди меток есть несуществующая или из другого проекта"));
        }
        tasks::set_tags(&mut tx, id, ids).await?;
        tasks::touch(&mut tx, id).await?;
    }

    // перенос: в другую колонку или по порядку (before_id)
    let target_column = req.column_id.unwrap_or(task.column_id);
    let column_changed = req.column_id.is_some() && target_column != task.column_id;
    if column_changed || req.before_id.is_some() {
        let column = match target_column {
            Some(column_id) => Some(column_in_project(&mut tx, column_id, project.id).await?),
            None => None,
        };
        let before = req.before_id.flatten();
        current = tasks::place(&mut tx, &current, target_column, before).await.map_err(|e| match e {
            tasks::PlaceError::BeforeNotFound => bad("Задача before_id не найдена в целевой колонке"),
            tasks::PlaceError::Db(e) => e.into(),
        })?;
        if column_changed {
            let name = column.map_or("Бэклог".to_owned(), |c| c.title);
            let text = format!("перемещена в «{name}»");
            db::activity::insert(&mut tx, auth.id, Some(project.id), "move", &target(&project, &current), &text)
                .await?;
        }
    }

    if let Some(pr) = &patch.pr
        && !pr.is_empty()
        && *pr != task.pr
    {
        let text = format!("добавлен PR {pr}");
        db::activity::insert(&mut tx, auth.id, Some(project.id), "code", &target(&project, &current), &text).await?;
    }

    let current = tasks::get(&mut *tx, id).await?.ok_or(ApiError::NotFound)?;
    let dto = detail(&mut tx, current, &project).await?;
    tx.commit().await?;
    Ok(Json(dto))
}

/// Удалить задачу вместе с подзадачами, комментариями и вложениями
#[utoipa::path(
    delete,
    path = "/tasks/{id}",
    tag = "tasks",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Задача")),
    responses(
        (status = 204, description = "Задача удалена"),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такой задачи", body = ErrorBody),
    )
)]
async fn delete_task(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    let (task, project) = load_locked(&mut tx, auth, id).await?;
    // записи о вложениях уйдут вместе с задачей, а файлы на диске надо убрать самим
    let file_keys = db::files::storage_keys_for_task(&mut *tx, id).await?;
    db::activity::insert(&mut tx, auth.id, Some(project.id), "delete", &target(&project, &task), "удалена").await?;
    tasks::delete(&mut tx, id).await?;
    tx.commit().await?;
    crate::storage::remove_all(&state.data_dir, &file_keys).await;
    Ok(StatusCode::NO_CONTENT)
}

// ===== Подзадачи =====

/// Новая подзадача в конец списка
#[utoipa::path(
    post,
    path = "/tasks/{id}/subtasks",
    tag = "tasks",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Задача")),
    request_body = CreateSubtask,
    responses(
        (status = 201, description = "Подзадача создана", body = SubtaskDto),
        (status = 400, description = "Некорректный запрос", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такой задачи", body = ErrorBody),
    )
)]
async fn create_subtask(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(task_id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<CreateSubtask>,
) -> ApiResult<(StatusCode, Json<SubtaskDto>)> {
    let title = clean_title(&req.title)?;
    let mut tx = state.pool.begin().await?;
    load(&mut tx, auth, task_id).await?;
    let subtask = db::subtasks::insert(&mut tx, task_id, &title).await?;
    tasks::touch(&mut tx, task_id).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(subtask.into())))
}

/// Переименовать подзадачу или отметить выполненной
#[utoipa::path(
    patch,
    path = "/subtasks/{id}",
    tag = "tasks",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Подзадача")),
    request_body = UpdateSubtask,
    responses(
        (status = 200, description = "Подзадача после изменений", body = SubtaskDto),
        (status = 400, description = "Некорректный запрос", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такой подзадачи", body = ErrorBody),
    )
)]
async fn update_subtask(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<UpdateSubtask>,
) -> ApiResult<Json<SubtaskDto>> {
    let title = req.title.as_deref().map(clean_title).transpose()?;
    let mut tx = state.pool.begin().await?;
    let existing = db::subtasks::get(&mut *tx, id).await?.ok_or(ApiError::NotFound)?;
    load(&mut tx, auth, existing.task_id).await?;
    let subtask = db::subtasks::update(&mut tx, id, title.as_deref(), req.done).await?;
    tasks::touch(&mut tx, existing.task_id).await?;
    tx.commit().await?;
    Ok(Json(subtask.into()))
}

/// Удалить подзадачу
#[utoipa::path(
    delete,
    path = "/subtasks/{id}",
    tag = "tasks",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Подзадача")),
    responses(
        (status = 204, description = "Подзадача удалена"),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такой подзадачи", body = ErrorBody),
    )
)]
async fn delete_subtask(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    let existing = db::subtasks::get(&mut *tx, id).await?.ok_or(ApiError::NotFound)?;
    load(&mut tx, auth, existing.task_id).await?;
    db::subtasks::delete(&mut tx, id).await?;
    tasks::touch(&mut tx, existing.task_id).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ===== Комментарии =====

/// Новый комментарий от имени текущего пользователя
#[utoipa::path(
    post,
    path = "/tasks/{id}/comments",
    tag = "tasks",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Задача")),
    request_body = CreateComment,
    responses(
        (status = 201, description = "Комментарий добавлен", body = CommentDto),
        (status = 400, description = "Пустой или слишком длинный комментарий", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такой задачи", body = ErrorBody),
    )
)]
async fn create_comment(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(task_id): ApiPath<Uuid>,
    ApiJson(req): ApiJson<CreateComment>,
) -> ApiResult<(StatusCode, Json<CommentDto>)> {
    let body = board::clean_text(&req.body, MAX_COMMENT_LEN)
        .ok_or_else(|| bad(format!("Комментарий: от 1 до {MAX_COMMENT_LEN} символов")))?;

    let mut tx = state.pool.begin().await?;
    let (task, project) = load(&mut tx, auth, task_id).await?;
    let comment = db::comments::insert(&mut tx, task_id, auth.id, &body).await?;
    db::activity::insert(&mut tx, auth.id, Some(project.id), "comment", &target(&project, &task), "новый комментарий")
        .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(comment.into())))
}
