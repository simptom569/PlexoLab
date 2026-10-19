//! Библиотека файлов, папки и вложения задач. Содержимое пишется на диск потоком (сервер маленький, файл целиком
//! в память не берём), запись в базу и в ленту активности делается в одной транзакции после того, как файлы сохранены.

use axum::{
    Json,
    body::Body,
    extract::{DefaultBodyLimit, Multipart, State, multipart::Field},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use db::{
    files::{File, FolderScope, LibraryFilter, NewFile},
    sqlx::PgConnection,
};
use domain::files::{
    self, ATTACHMENTS_FOLDER, MAX_FILES_PER_UPLOAD, clean_file_name, clean_folder_name, file_kind, files_text,
};
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::{
    dto::TaskFileDto,
    library_dto::{CreateFolder, FileDto, FileListDto, FolderDto, ListFilesQuery, TaskUploadForm, UploadForm},
    tasks,
};
use crate::{
    error::{ApiError, ApiResult, ErrorBody},
    extract::{ApiJson, ApiPath, ApiQuery, AuthUser},
    state::AppState,
    storage,
};

pub fn router() -> OpenApiRouter<AppState> {
    // Размер тела проверяется на лету при записи на диск (лимит на файл), общий лимит axum для загрузок не нужен
    let uploads = OpenApiRouter::new()
        .routes(routes!(upload_files))
        .routes(routes!(upload_task_files))
        .layer(DefaultBodyLimit::disable());
    OpenApiRouter::new()
        .routes(routes!(list_files))
        .routes(routes!(download_file))
        .routes(routes!(delete_file))
        .routes(routes!(list_folders, create_folder))
        .routes(routes!(delete_folder))
        .merge(uploads)
}

fn bad(message: impl Into<String>) -> ApiError {
    ApiError::BadRequest(message.into())
}

// ===== Приём файлов =====

/// Файл, уже записанный на диск
struct Received {
    name: String,
    key: String,
    size: u64,
}

/// Всё, что пришло в форме загрузки
#[derive(Default)]
struct Incoming {
    files: Vec<Received>,
    folder_id: Option<Uuid>,
    wiki_page_id: Option<Uuid>,
}

impl Incoming {
    fn keys(&self) -> Vec<String> {
        self.files.iter().map(|f| f.key.clone()).collect()
    }
}

/// Самое длинное текстовое поле формы (идентификатор): больше не читаем
const MAX_TEXT_FIELD: usize = 64;
/// Полей в форме всего: защита от потока пустых полей
const MAX_FIELDS: usize = 4 * MAX_FILES_PER_UPLOAD;

fn upload_error(e: axum::extract::multipart::MultipartError) -> ApiError {
    if e.status() == StatusCode::PAYLOAD_TOO_LARGE {
        ApiError::TooLarge("Запрос слишком большой".into())
    } else {
        bad("Не удалось прочитать форму загрузки")
    }
}

async fn text_field(mut field: Field<'_>) -> ApiResult<String> {
    let mut bytes = Vec::new();
    while let Some(chunk) = field.chunk().await.map_err(upload_error)? {
        if bytes.len() + chunk.len() > MAX_TEXT_FIELD {
            return Err(bad("Поле формы слишком длинное"));
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|_| bad("Поле формы не в UTF-8"))
}

fn optional_uuid(raw: &str, what: &str) -> ApiResult<Option<Uuid>> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(None);
    }
    raw.parse().map(Some).map_err(|_| bad(format!("{what}: некорректный идентификатор")))
}

/// Пишет поле-файл на диск, пока не упрётся в лимит. Запись попадает в `incoming` до записи байтов,
/// чтобы при ошибке недописанный файл тоже убрался.
async fn save_file(state: &AppState, incoming: &mut Incoming, mut field: Field<'_>) -> ApiResult<()> {
    let raw_name = field.file_name().ok_or_else(|| bad("У файла нет имени"))?.to_owned();
    let name = clean_file_name(&raw_name).ok_or_else(|| bad("Недопустимое имя файла"))?;
    if incoming.files.len() >= MAX_FILES_PER_UPLOAD {
        return Err(bad(format!("За один раз можно загрузить не больше {MAX_FILES_PER_UPLOAD} файлов")));
    }
    storage::ensure_dir(&state.data_dir).await.map_err(|e| ApiError::Internal(e.into()))?;
    let key = storage::new_key();
    let path = storage::path(&state.data_dir, &key).expect("новый ключ всегда годится для пути");
    incoming.files.push(Received { name: name.clone(), key, size: 0 });
    let received = incoming.files.last_mut().expect("только что добавлен");

    let mut out = tokio::fs::File::create(&path).await.map_err(|e| ApiError::Internal(e.into()))?;
    while let Some(chunk) = field.chunk().await.map_err(upload_error)? {
        received.size += chunk.len() as u64;
        if received.size > state.max_upload_bytes {
            return Err(ApiError::TooLarge(format!(
                "Файл «{name}» больше допустимых {} МБ",
                state.max_upload_bytes / (1024 * 1024)
            )));
        }
        out.write_all(&chunk).await.map_err(|e| ApiError::Internal(e.into()))?;
    }
    out.flush().await.map_err(|e| ApiError::Internal(e.into()))?;
    Ok(())
}

async fn read_form(state: &AppState, multipart: &mut Multipart, incoming: &mut Incoming) -> ApiResult<()> {
    let mut fields = 0;
    while let Some(field) = multipart.next_field().await.map_err(upload_error)? {
        fields += 1;
        if fields > MAX_FIELDS {
            return Err(bad("В форме слишком много полей"));
        }
        match field.name() {
            Some("file") => save_file(state, incoming, field).await?,
            Some("folder_id") => incoming.folder_id = optional_uuid(&text_field(field).await?, "folder_id")?,
            Some("wiki_page_id") => {
                incoming.wiki_page_id = optional_uuid(&text_field(field).await?, "wiki_page_id")?;
            }
            _ => {}
        }
    }
    if incoming.files.is_empty() {
        return Err(bad("В форме нет файлов (поле «file»)"));
    }
    Ok(())
}

/// Принимает форму; при любой ошибке уже записанные файлы убираются с диска
async fn receive(state: &AppState, mut multipart: Multipart) -> ApiResult<Incoming> {
    let mut incoming = Incoming::default();
    match read_form(state, &mut multipart, &mut incoming).await {
        Ok(()) => Ok(incoming),
        Err(e) => {
            storage::remove_all(&state.data_dir, &incoming.keys()).await;
            Err(e)
        }
    }
}

/// Если запись в базе не удалась, файлы на диске больше не нужны
async fn discard_on_error<T>(state: &AppState, incoming: &Incoming, result: ApiResult<T>) -> ApiResult<T> {
    if result.is_err() {
        storage::remove_all(&state.data_dir, &incoming.keys()).await;
    }
    result
}

async fn insert_all(
    conn: &mut PgConnection,
    incoming: &Incoming,
    uploader: Uuid,
    folder_id: Option<Uuid>,
    task_id: Option<Uuid>,
) -> ApiResult<Vec<File>> {
    let mut saved = Vec::with_capacity(incoming.files.len());
    for f in &incoming.files {
        let new = NewFile {
            name: &f.name,
            size_bytes: i64::try_from(f.size).map_err(|_| bad("Файл слишком большой"))?,
            kind: file_kind(&f.name),
            storage_key: &f.key,
            uploader_id: uploader,
            folder_id,
            wiki_page_id: incoming.wiki_page_id,
            task_id,
        };
        saved.push(db::files::insert(&mut *conn, &new).await?);
    }
    Ok(saved)
}

// ===== Библиотека =====

/// Файлы библиотеки (вложения задач сюда не входят), новые первыми
#[utoipa::path(
    get,
    path = "/files",
    tag = "files",
    security(("bearer" = [])),
    params(ListFilesQuery),
    responses(
        (status = 200, description = "Файлы и общее число файлов в библиотеке", body = FileListDto),
        (status = 400, description = "Некорректные условия отбора", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
    )
)]
async fn list_files(
    _auth: AuthUser,
    State(state): State<AppState>,
    ApiQuery(q): ApiQuery<ListFilesQuery>,
) -> ApiResult<Json<FileListDto>> {
    let folder = match q.folder.as_deref().map(str::trim).filter(|f| !f.is_empty()) {
        None => FolderScope::Any,
        Some("root") => FolderScope::Root,
        Some(id) => FolderScope::One(id.parse().map_err(|_| bad("folder: root или идентификатор папки"))?),
    };
    let kind = q.kind.as_deref().filter(|k| !k.is_empty());
    if let Some(kind) = kind
        && !files::is_kind(kind)
    {
        return Err(bad("Тип файла: img, pdf, doc, sheet, zip или other"));
    }
    let query = q.q.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let filter = LibraryFilter { folder, kind, query, wiki_page_id: q.wiki_page_id };

    let mut conn = state.pool.acquire().await?;
    let found = db::files::list_library(&mut *conn, &filter).await?;
    let total = db::files::count_library(&mut *conn).await?;
    Ok(Json(FileListDto { total, files: found.into_iter().map(Into::into).collect() }))
}

/// Загрузить файлы в библиотеку (multipart/form-data). Поле `file` можно повторять, `folder_id` и `wiki_page_id`
/// необязательны. Файл, прикреплённый к странице без указания папки, попадает в папку «Вложения».
#[utoipa::path(
    post,
    path = "/files",
    tag = "files",
    security(("bearer" = [])),
    request_body(content = UploadForm, content_type = "multipart/form-data"),
    responses(
        (status = 201, description = "Файлы сохранены", body = [FileDto]),
        (status = 400, description = "Некорректная форма, нет такой папки или страницы", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 413, description = "Файл больше лимита", body = ErrorBody),
    )
)]
async fn upload_files(
    auth: AuthUser,
    State(state): State<AppState>,
    multipart: Multipart,
) -> ApiResult<(StatusCode, Json<Vec<FileDto>>)> {
    let incoming = receive(&state, multipart).await?;
    let saved = save_library_files(&state, &incoming, auth.id).await;
    let saved = discard_on_error(&state, &incoming, saved).await?;
    Ok((StatusCode::CREATED, Json(saved.into_iter().map(Into::into).collect())))
}

async fn save_library_files(state: &AppState, incoming: &Incoming, uploader: Uuid) -> ApiResult<Vec<File>> {
    let mut tx = state.pool.begin().await?;
    if let Some(page) = incoming.wiki_page_id {
        db::wiki::get(&mut *tx, page).await?.ok_or_else(|| bad("Страница не найдена"))?;
    }
    let folder_id = match (incoming.folder_id, incoming.wiki_page_id) {
        (Some(folder), _) => {
            db::folders::get(&mut *tx, folder).await?.ok_or_else(|| bad("Папка не найдена"))?;
            Some(folder)
        }
        (None, Some(_)) => Some(db::folders::find_or_create(&mut tx, ATTACHMENTS_FOLDER).await?),
        (None, None) => None,
    };
    let saved = insert_all(&mut tx, incoming, uploader, folder_id, None).await?;
    let target = match saved.as_slice() {
        [one] => one.name.clone(),
        many => files_text(many.len()),
    };
    db::activity::insert(&mut tx, uploader, None, "file", &target, "загружено в вики").await?;
    tx.commit().await?;
    Ok(saved)
}

/// Скачать содержимое файла
#[utoipa::path(
    get,
    path = "/files/{id}/download",
    tag = "files",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Файл")),
    responses(
        (status = 200, description = "Содержимое файла", content_type = "application/octet-stream", body = Vec<u8>),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого файла или у записи нет содержимого (пример из сида)", body = ErrorBody),
    )
)]
async fn download_file(
    _auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<Response> {
    let file = db::files::get(&state.pool, id).await?.ok_or(ApiError::NotFound)?;
    let path = storage::path(&state.data_dir, &file.storage_key).ok_or(ApiError::NotFound)?;
    let content = tokio::fs::File::open(&path).await.map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => ApiError::NotFound,
        _ => ApiError::Internal(e.into()),
    })?;
    let length = content.metadata().await.map_err(|e| ApiError::Internal(e.into()))?.len();

    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/octet-stream"));
    headers.insert(header::CONTENT_LENGTH, HeaderValue::from(length));
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&content_disposition(&file.name)).expect("значение заголовка собрано из ASCII"),
    );
    Ok((headers, Body::from_stream(ReaderStream::new(content))).into_response())
}

/// `attachment; filename="..."; filename*=UTF-8''...`: ASCII-вариант для старых программ и точное имя для остальных
fn content_disposition(name: &str) -> String {
    let ascii: String =
        name.chars().map(|c| if c.is_ascii() && !matches!(c, '"' | '\\' | '%') { c } else { '_' }).collect();
    let mut encoded = String::new();
    for b in name.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            encoded.push(b as char);
        } else {
            encoded.push_str(&format!("%{b:02X}"));
        }
    }
    format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{encoded}")
}

/// Удалить файл (библиотеки или вложение задачи) вместе с содержимым на диске
#[utoipa::path(
    delete,
    path = "/files/{id}",
    tag = "files",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Файл")),
    responses(
        (status = 204, description = "Файл удалён"),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такого файла", body = ErrorBody),
    )
)]
async fn delete_file(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    let file = db::files::get(&mut *tx, id).await?.ok_or(ApiError::NotFound)?;
    match file.task_id {
        Some(task_id) => {
            // вложение задачи: запись в ленту идёт на задачу, поэтому нужны её проект и блокировка
            let (task, project) = tasks::load_locked(&mut tx, task_id).await?;
            db::files::delete(&mut tx, id).await?;
            let text = format!("удалён файл «{}»", file.name);
            db::activity::insert(&mut tx, auth.id, Some(project.id), "file", &tasks::target(&project, &task), &text)
                .await?;
        }
        None => {
            db::files::delete(&mut tx, id).await?;
            db::activity::insert(&mut tx, auth.id, None, "file", &file.name, "удалён").await?;
        }
    }
    tx.commit().await?;
    storage::remove_all(&state.data_dir, std::slice::from_ref(&file.storage_key)).await;
    Ok(StatusCode::NO_CONTENT)
}

// ===== Вложения задач =====

/// Прикрепить файлы к задаче (multipart/form-data, поле `file` можно повторять)
#[utoipa::path(
    post,
    path = "/tasks/{id}/files",
    tag = "files",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Задача")),
    request_body(content = TaskUploadForm, content_type = "multipart/form-data"),
    responses(
        (status = 201, description = "Файлы прикреплены", body = [TaskFileDto]),
        (status = 400, description = "Некорректная форма", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такой задачи", body = ErrorBody),
        (status = 413, description = "Файл больше лимита", body = ErrorBody),
    )
)]
async fn upload_task_files(
    auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(task_id): ApiPath<Uuid>,
    multipart: Multipart,
) -> ApiResult<(StatusCode, Json<Vec<TaskFileDto>>)> {
    // не принимаем гигабайты для задачи, которой нет
    db::tasks::get(&state.pool, task_id).await?.ok_or(ApiError::NotFound)?;
    let mut incoming = receive(&state, multipart).await?;
    // к задаче прикрепляют только файлы, привязка к странице и папке тут не нужна
    incoming.folder_id = None;
    incoming.wiki_page_id = None;
    let saved = save_task_files(&state, &incoming, task_id, auth.id).await;
    let saved = discard_on_error(&state, &incoming, saved).await?;
    Ok((StatusCode::CREATED, Json(saved.into_iter().map(task_file).collect())))
}

fn task_file(f: File) -> TaskFileDto {
    TaskFileDto {
        id: f.id,
        name: f.name,
        size_bytes: f.size_bytes,
        kind: f.kind,
        uploader_id: f.uploader_id,
        created_at: f.created_at,
    }
}

async fn save_task_files(state: &AppState, incoming: &Incoming, task_id: Uuid, uploader: Uuid) -> ApiResult<Vec<File>> {
    let mut tx = state.pool.begin().await?;
    let (task, project) = tasks::load_locked(&mut tx, task_id).await?;
    let saved = insert_all(&mut tx, incoming, uploader, None, Some(task_id)).await?;
    let text = match saved.as_slice() {
        [one] => format!("прикреплён файл «{}»", one.name),
        many => format!("прикреплено: {}", files_text(many.len())),
    };
    db::activity::insert(&mut tx, uploader, Some(project.id), "file", &tasks::target(&project, &task), &text).await?;
    tx.commit().await?;
    Ok(saved)
}

// ===== Папки =====

/// Папки в порядке создания, с числом файлов
#[utoipa::path(
    get,
    path = "/folders",
    tag = "files",
    security(("bearer" = [])),
    responses(
        (status = 200, description = "Папки библиотеки", body = [FolderDto]),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
    )
)]
async fn list_folders(_auth: AuthUser, State(state): State<AppState>) -> ApiResult<Json<Vec<FolderDto>>> {
    let folders = db::folders::list(&state.pool).await?;
    Ok(Json(folders.into_iter().map(Into::into).collect()))
}

/// Новая папка. Названия не повторяются.
#[utoipa::path(
    post,
    path = "/folders",
    tag = "files",
    security(("bearer" = [])),
    request_body = CreateFolder,
    responses(
        (status = 201, description = "Папка создана", body = FolderDto),
        (status = 400, description = "Некорректное название", body = ErrorBody),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 409, description = "Папка с таким названием уже есть", body = ErrorBody),
    )
)]
async fn create_folder(
    _auth: AuthUser,
    State(state): State<AppState>,
    ApiJson(req): ApiJson<CreateFolder>,
) -> ApiResult<(StatusCode, Json<FolderDto>)> {
    let name = clean_folder_name(&req.name)
        .ok_or_else(|| bad(format!("Название папки: от 1 до {} символов", domain::files::MAX_FOLDER_NAME_LEN)))?;
    let mut conn = state.pool.acquire().await?;
    let folder = db::folders::insert(&mut conn, &name)
        .await?
        .ok_or_else(|| ApiError::Conflict("Папка с таким названием уже есть".into()))?;
    Ok((StatusCode::CREATED, Json(folder.into())))
}

/// Удалить пустую папку
#[utoipa::path(
    delete,
    path = "/folders/{id}",
    tag = "files",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Папка")),
    responses(
        (status = 204, description = "Папка удалена"),
        (status = 401, description = "Нет действительного токена", body = ErrorBody),
        (status = 404, description = "Нет такой папки", body = ErrorBody),
        (status = 409, description = "В папке есть файлы", body = ErrorBody),
    )
)]
async fn delete_folder(
    _auth: AuthUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> ApiResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    let folder = db::folders::get(&mut *tx, id).await?.ok_or(ApiError::NotFound)?;
    if folder.file_count > 0 {
        return Err(ApiError::Conflict("Папку можно удалить, только когда в ней нет файлов".into()));
    }
    db::folders::delete(&mut tx, id).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
