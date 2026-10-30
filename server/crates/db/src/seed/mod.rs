//! Демо-данные для разработки (`cargo run --bin seed`): пятеро пользователей, три проекта, доска,
//! модули, релизы, вики, документы, файлы (записи без реальных файлов), ссылки и лента активности.
//! Всё заполняется одной транзакцией. Данные из seed() макета design/Main.dc.html, см. `data.rs`.

mod data;

use std::collections::HashMap;

use sqlx::{PgConnection, PgPool};
use time::{Date, Duration, Month, OffsetDateTime, Time};
use uuid::Uuid;

use data::*;
use domain::files::file_kind;

#[derive(Debug, thiserror::Error)]
pub enum SeedError {
    #[error("база не пустая: пользователи уже есть (запустите с --reset, чтобы очистить её)")]
    NotEmpty,
    #[error("не удалось вычислить хэш пароля")]
    Hash,
    #[error("ошибка в данных сида: {0}")]
    Data(String),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

pub struct SeedOptions {
    /// День, который считается «сегодня»: относительно него сдвигаются даты макета
    pub today: Date,
    /// Текущий момент: от него отсчитывается «12 минут назад» в ленте
    pub now: OffsetDateTime,
    /// Пароль всех демо-пользователей (только для разработки)
    pub password: String,
}

impl SeedOptions {
    /// Реальные дата и время, пароль как задан
    pub fn now(password: impl Into<String>) -> Self {
        let now = OffsetDateTime::now_utc();
        SeedOptions { today: now.date(), now, password: password.into() }
    }

    /// «Сегодня» — заданный день, «сейчас» — полдень этого дня по UTC: лента («12 минут назад», «вчера, 18:20»)
    /// получается одной и той же, в какой бы день ни запустили сид. Нужно тестам интерфейса с замороженными часами.
    pub fn on(today: Date, password: impl Into<String>) -> Self {
        SeedOptions {
            today,
            now: OffsetDateTime::new_utc(today, Time::from_hms(12, 0, 0).unwrap()),
            password: password.into(),
        }
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct SeedReport {
    pub users: usize,
    pub projects: usize,
    pub columns: usize,
    pub tags: usize,
    pub modules: usize,
    pub milestones: usize,
    pub tasks: usize,
    pub subtasks: usize,
    pub comments: usize,
    pub releases: usize,
    pub release_items: usize,
    pub wiki_pages: usize,
    pub docs: usize,
    pub doc_objects: usize,
    pub doc_links: usize,
    pub folders: usize,
    pub files: usize,
    pub link_groups: usize,
    pub links: usize,
    pub activity: usize,
}

impl std::fmt::Display for SeedReport {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let rows = [
            ("пользователей", self.users),
            ("проектов", self.projects),
            ("колонок", self.columns),
            ("меток", self.tags),
            ("модулей", self.modules),
            ("вех", self.milestones),
            ("задач", self.tasks),
            ("подзадач", self.subtasks),
            ("комментариев", self.comments),
            ("релизов", self.releases),
            ("шагов релизов", self.release_items),
            ("страниц вики", self.wiki_pages),
            ("документов", self.docs),
            ("объектов холста", self.doc_objects),
            ("стрелок", self.doc_links),
            ("папок", self.folders),
            ("файлов", self.files),
            ("групп ссылок", self.link_groups),
            ("ссылок", self.links),
            ("событий активности", self.activity),
        ];
        for (name, n) in rows {
            writeln!(f, "  {name}: {n}")?;
        }
        Ok(())
    }
}

/// Очищает все данные (структура остаётся). Только для разработки.
pub async fn reset(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "truncate table users, teams, projects, tags, folders, wiki_pages, docs, link_groups, activity, email_codes restart identity cascade",
    )
    .execute(pool)
    .await?;
    Ok(())
}

struct Ctx {
    /// На сколько дней сдвигаем даты макета
    shift: Duration,
    now: OffsetDateTime,
    today: Date,
}

fn parse_date(s: &str) -> Result<Date, SeedError> {
    let bad = || SeedError::Data(format!("дата «{s}»"));
    let mut parts = s.split('-');
    let year = parts.next().and_then(|p| p.parse().ok()).ok_or_else(bad)?;
    let month: u8 = parts.next().and_then(|p| p.parse().ok()).ok_or_else(bad)?;
    let day = parts.next().and_then(|p| p.parse().ok()).ok_or_else(bad)?;
    Date::from_calendar_date(year, Month::try_from(month).map_err(|_| bad())?, day).map_err(|_| bad())
}

fn at(date: Date, h: u8, m: u8) -> OffsetDateTime {
    OffsetDateTime::new_utc(date, Time::from_hms(h, m, 0).unwrap_or(Time::MIDNIGHT))
}

impl Ctx {
    fn date(&self, s: &str) -> Result<Date, SeedError> {
        Ok(parse_date(s)? + self.shift)
    }

    fn opt_date(&self, s: Option<&str>) -> Result<Option<Date>, SeedError> {
        s.map(|s| self.date(s)).transpose()
    }

    fn noon(&self, s: &str) -> Result<OffsetDateTime, SeedError> {
        Ok(at(self.date(s)?, 12, 0))
    }

    fn when(&self, w: When) -> OffsetDateTime {
        match w {
            When::MinutesAgo(n) => self.now - Duration::minutes(n),
            When::HoursAgo(n) => self.now - Duration::hours(n),
            When::YesterdayAt(h, m) => at(self.today - Duration::days(1), h, m),
            When::DaysAgoAt(d, h, m) => at(self.today - Duration::days(d), h, m),
        }
    }
}

/// «184 КБ», «1,2 МБ» → байты
fn parse_size(s: &str) -> Result<i64, SeedError> {
    let bad = || SeedError::Data(format!("размер «{s}»"));
    let (num, unit) = s.split_once(' ').ok_or_else(bad)?;
    let value: f64 = num.replace(',', ".").parse().map_err(|_| bad())?;
    let unit = match unit {
        "КБ" => 1024.0,
        "МБ" => 1024.0 * 1024.0,
        _ => return Err(bad()),
    };
    Ok((value * unit).round() as i64)
}

fn pick<K: std::hash::Hash + Eq + std::fmt::Debug, V: Copy>(map: &HashMap<K, V>, key: K) -> Result<V, SeedError> {
    map.get(&key).copied().ok_or_else(|| SeedError::Data(format!("нет записи {key:?}")))
}

/// Заполняет пустую базу. Если пользователи уже есть, ничего не делает и возвращает `NotEmpty`.
pub async fn seed(pool: &PgPool, opts: &SeedOptions) -> Result<SeedReport, SeedError> {
    if crate::users::count(pool).await? > 0 {
        return Err(SeedError::NotEmpty);
    }
    let ctx = Ctx { shift: opts.today - parse_date(MOCK_TODAY)?, now: opts.now, today: opts.today };

    // argon2 считает на CPU, поэтому хэши готовим до транзакции и вне потока обработки
    let password = opts.password.clone();
    let hashes = tokio::task::spawn_blocking(move || {
        USERS.iter().map(|_| domain::auth::hash_password(&password)).collect::<Result<Vec<_>, _>>()
    })
    .await
    .map_err(|_| SeedError::Hash)?
    .map_err(|_| SeedError::Hash)?;

    let mut tx = pool.begin().await?;
    let report = fill(&mut tx, &ctx, &hashes).await?;
    tx.commit().await?;
    Ok(report)
}

async fn fill(c: &mut PgConnection, ctx: &Ctx, hashes: &[String]) -> Result<SeedReport, SeedError> {
    let mut r = SeedReport::default();

    // ----- Пользователи -----
    let mut users: HashMap<&str, Uuid> = HashMap::new();
    for (u, hash) in USERS.iter().zip(hashes) {
        let id = sqlx::query_scalar(
            "insert into users (email, name, role, tone, is_admin, password_hash) values ($1, $2, $3, $4, $5, $6) returning id",
        )
        .bind(u.email)
        .bind(u.name)
        .bind(u.role)
        .bind(u.tone)
        .bind(u.admin)
        .bind(hash)
        .fetch_one(&mut *c)
        .await?;
        users.insert(u.key, id);
        r.users += 1;
    }
    let me = pick(&users, DEFAULT_ACTOR)?;
    let user = |key: &str| pick(&users, key);
    let opt_user = |key: Option<&str>| key.map(user).transpose();

    // ----- Команда: личные «Личное» создала база вместе с аккаунтами; все данные сида живут в общей команде «Рабочее пространство» (как подпись в макете: так боковое меню в покое совпадает с эталонными снимками) -----
    let team: Uuid = sqlx::query_scalar("insert into teams (name, created_by) values ('Рабочее пространство', $1) returning id")
        .bind(me)
        .fetch_one(&mut *c)
        .await?;
    sqlx::query(
        "insert into team_members (team_id, user_id, role) \
         select $1, id, case when is_admin then 'admin'::team_role else 'member'::team_role end from users",
    )
    .bind(team)
    .execute(&mut *c)
    .await?;

    // ----- Проекты и колонки -----
    let mut projects: HashMap<&str, Uuid> = HashMap::new();
    let mut columns: HashMap<(&str, &str), Uuid> = HashMap::new();
    for p in PROJECTS {
        let id = sqlx::query_scalar(
            "insert into projects (key, name, color, last_number, team_id) values ($1, $2, $3, $4, $5) returning id",
        )
        .bind(p.key)
        .bind(p.name)
        .bind(p.color)
        .bind(p.last_number)
        .bind(team)
        .fetch_one(&mut *c)
        .await?;
        projects.insert(p.id, id);
        r.projects += 1;
        for (i, col) in COLUMNS.iter().enumerate() {
            let col_id = sqlx::query_scalar(
                "insert into board_columns (project_id, title, color, is_done, position) values ($1, $2, $3, $4, $5) returning id",
            )
            .bind(id)
            .bind(col.title)
            .bind(col.color)
            .bind(col.done)
            .bind(1024.0 * (i as f64 + 1.0))
            .fetch_one(&mut *c)
            .await?;
            columns.insert((p.id, col.id), col_id);
            r.columns += 1;
        }
    }

    // ----- Участники проектов: все пользователи сида во всех проектах, глобальные админы администраторами -----
    sqlx::query(
        "insert into project_members (project_id, user_id, role)          select p.id, u.id, case when u.is_admin then 'admin'::project_role else 'member'::project_role end          from projects p cross join users u",
    )
    .execute(&mut *c)
    .await?;

    // ----- Метки (у каждого проекта свои, одинаковый набор), модули, вехи -----
    let mut tags: HashMap<(&str, &str), Uuid> = HashMap::new();
    for p in PROJECTS {
        for (key, label, tone) in TAGS {
            let id = sqlx::query_scalar("insert into tags (project_id, label, tone) values ($1, $2, $3) returning id")
                .bind(pick(&projects, p.id)?)
                .bind(label)
                .bind(tone)
                .fetch_one(&mut *c)
                .await?;
            tags.insert((p.id, key), id);
            r.tags += 1;
        }
    }
    let mut modules: HashMap<&str, Uuid> = HashMap::new();
    for m in MODULES {
        let id = sqlx::query_scalar(
            "insert into modules (project_id, title, lead_id, status, date_from, date_to, note) \
             values ($1, $2, $3, $4::work_status, $5, $6, $7) returning id",
        )
        .bind(pick(&projects, m.project)?)
        .bind(m.title)
        .bind(user(m.lead)?)
        .bind(m.status)
        .bind(ctx.date(m.from)?)
        .bind(ctx.date(m.to)?)
        .bind(m.note)
        .fetch_one(&mut *c)
        .await?;
        modules.insert(m.id, id);
        r.modules += 1;
    }
    let mut milestones: HashMap<&str, Uuid> = HashMap::new();
    for (key, project, title, date) in MILESTONES {
        let id =
            sqlx::query_scalar("insert into milestones (project_id, title, due_date) values ($1, $2, $3) returning id")
                .bind(pick(&projects, project)?)
                .bind(title)
                .bind(ctx.date(date)?)
                .fetch_one(&mut *c)
                .await?;
        milestones.insert(key, id);
        r.milestones += 1;
    }

    // ----- Задачи -----
    // порядок в колонке (или в бэклоге) задаётся порядком в списке, шаг 1024
    let mut next_position: HashMap<(&str, Option<&str>), f64> = HashMap::new();
    for t in tasks() {
        let number: i32 =
            t.id.rsplit('-')
                .next()
                .and_then(|n| n.parse().ok())
                .ok_or_else(|| SeedError::Data(format!("номер задачи {}", t.id)))?;
        let position = next_position.entry((t.project, t.col)).or_insert(0.0);
        *position += 1024.0;
        let assignee = opt_user(t.who)?;
        let task_id: Uuid = sqlx::query_scalar(
            "insert into tasks (project_id, number, title, column_id, position, assignee_id, priority, start_date, due_date, \
             module_id, milestone_id, pr, description, created_by) \
             values ($1, $2, $3, $4, $5, $6, $7::priority, $8, $9, $10, $11, $12, $13, $14) returning id",
        )
        .bind(pick(&projects, t.project)?)
        .bind(number)
        .bind(t.title)
        .bind(t.col.map(|col| pick(&columns, (t.project, col))).transpose()?)
        .bind(*position)
        .bind(assignee)
        .bind(t.prio)
        .bind(ctx.opt_date(t.start)?)
        .bind(ctx.opt_date(t.due)?)
        .bind(t.module.map(|m| pick(&modules, m)).transpose()?)
        .bind(t.ms.map(|m| pick(&milestones, m)).transpose()?)
        .bind(t.pr)
        .bind(t.desc)
        .bind(assignee.unwrap_or(me))
        .fetch_one(&mut *c)
        .await?;
        r.tasks += 1;

        for tag in t.tags {
            sqlx::query("insert into task_tags (task_id, tag_id) values ($1, $2)")
                .bind(task_id)
                .bind(pick(&tags, (t.project, *tag))?)
                .execute(&mut *c)
                .await?;
        }
        for (i, (title, done)) in t.subs.iter().enumerate() {
            sqlx::query("insert into subtasks (task_id, title, done, position) values ($1, $2, $3, $4)")
                .bind(task_id)
                .bind(title)
                .bind(done)
                .bind(1024.0 * (i as f64 + 1.0))
                .execute(&mut *c)
                .await?;
            r.subtasks += 1;
        }
        for (who, body, when) in t.comments {
            sqlx::query("insert into comments (task_id, author_id, body, created_at) values ($1, $2, $3, $4)")
                .bind(task_id)
                .bind(user(who)?)
                .bind(body)
                .bind(when.map(|w| ctx.when(w)).unwrap_or(ctx.now))
                .execute(&mut *c)
                .await?;
            r.comments += 1;
        }
        for (name, size) in t.files {
            sqlx::query(
                "insert into files (name, size_bytes, kind, storage_key, uploader_id, task_id, team_id) \
                 values ($1, $2, $3, $4, $5, $6, $7)",
            )
            .bind(name)
            .bind(parse_size(size)?)
            .bind(file_kind(name))
            .bind(format!("{}{name}", crate::files::SEED_KEY_PREFIX))
            .bind(assignee.unwrap_or(me))
            .bind(task_id)
            .bind(team)
            .execute(&mut *c)
            .await?;
            r.files += 1;
        }
    }

    // ----- Активность -----
    for (who, target, text, kind, project, when) in ACTIVITY {
        sqlx::query(
            "insert into activity (actor_id, project_id, kind, target, text, created_at, team_id) \
             values ($1, $2, $3::act_kind, $4, $5, $6, $7)",
        )
        .bind(user(who)?)
        .bind(project.map(|p| pick(&projects, p)).transpose()?)
        .bind(kind)
        .bind(target)
        .bind(text)
        .bind(ctx.when(*when))
        // события без проекта это вики и файлы библиотеки, они принадлежат команде
        .bind(project.is_none().then_some(team))
        .execute(&mut *c)
        .await?;
        r.activity += 1;
    }

    // ----- Релизы -----
    for rel in RELEASES {
        let id: Uuid = sqlx::query_scalar(
            "insert into releases (project_id, version, release_date, status, notes) \
             values ($1, $2, $3, $4::work_status, $5) returning id",
        )
        .bind(pick(&projects, rel.project)?)
        .bind(rel.version)
        .bind(ctx.date(rel.date)?)
        .bind(rel.status)
        .bind(rel.notes)
        .fetch_one(&mut *c)
        .await?;
        r.releases += 1;
        for (i, (title, done)) in rel.checklist.iter().enumerate() {
            sqlx::query("insert into release_items (release_id, title, done, position) values ($1, $2, $3, $4)")
                .bind(id)
                .bind(title)
                .bind(done)
                .bind(1024.0 * (i as f64 + 1.0))
                .execute(&mut *c)
                .await?;
            r.release_items += 1;
        }
    }

    // ----- Вики (родители в списке идут раньше детей) -----
    let mut wiki: HashMap<&str, Uuid> = HashMap::new();
    let mut wiki_position: HashMap<Option<&str>, f64> = HashMap::new();
    for page in WIKI {
        let position = wiki_position.entry(page.parent).or_insert(0.0);
        *position += 1024.0;
        let id = sqlx::query_scalar(
            "insert into wiki_pages (parent_id, title, md, position, updated_by, team_id) \
             values ($1, $2, $3, $4, $5, $6) returning id",
        )
        .bind(page.parent.map(|p| pick(&wiki, p)).transpose()?)
        .bind(page.title)
        .bind(page.md.join("\n"))
        .bind(*position)
        .bind(me)
        .bind(team)
        .fetch_one(&mut *c)
        .await?;
        wiki.insert(page.id, id);
        r.wiki_pages += 1;
    }

    // ----- Документы и холст -----
    // документы и ссылки принадлежат проекту: в сиде это первый проект, как после миграции 0014
    let first_project = pick(&projects, PROJECTS[0].id)?;
    // порядок списка как в макете: первый документ вверху, дальше с шагом 1024
    for (i, d) in DOCS.iter().enumerate() {
        let author = user(d.who)?;
        let doc_id: Uuid = sqlx::query_scalar(
            "insert into docs (title, md, mode, note_x, note_y, note_w, position, created_by, updated_by, updated_at, project_id) \
             values ($1, $2, $3::doc_mode, $4, $5, $6, $7, $8, $8, $9, $10) returning id",
        )
        .bind(d.title)
        .bind(d.md.join("\n"))
        .bind(d.mode)
        .bind(d.note.0)
        .bind(d.note.1)
        .bind(d.note.2)
        .bind(1024.0 * (i as f64 + 1.0))
        .bind(author)
        .bind(ctx.noon(d.updated)?)
        .bind(first_project)
        .fetch_one(&mut *c)
        .await?;
        r.docs += 1;
        if d.starred {
            sqlx::query("insert into doc_stars (doc_id, user_id) values ($1, $2)")
                .bind(doc_id)
                .bind(me)
                .execute(&mut *c)
                .await?;
        }
        let mut objects: HashMap<&str, Uuid> = HashMap::new();
        for o in d.objects {
            let id = sqlx::query_scalar(
                "insert into doc_objects (doc_id, type, x, y, w, h, text, color) values ($1, $2::obj_type, $3, $4, $5, $6, $7, $8) returning id",
            )
            .bind(doc_id)
            .bind(o.kind)
            .bind(o.x)
            .bind(o.y)
            .bind(o.w)
            .bind(o.h)
            .bind(o.text)
            .bind(o.color)
            .fetch_one(&mut *c)
            .await?;
            objects.insert(o.id, id);
            r.doc_objects += 1;
        }
        for (a, b) in d.links {
            sqlx::query("insert into doc_links (doc_id, a, b) values ($1, $2, $3)")
                .bind(doc_id)
                .bind(pick(&objects, a)?)
                .bind(pick(&objects, b)?)
                .execute(&mut *c)
                .await?;
            r.doc_links += 1;
        }
    }

    // ----- Папки и файлы (записи без файлов на диске) -----
    let mut folders: HashMap<&str, Uuid> = HashMap::new();
    for name in FOLDERS {
        let id = sqlx::query_scalar("insert into folders (name, team_id) values ($1, $2) returning id")
            .bind(name)
            .bind(team)
            .fetch_one(&mut *c)
            .await?;
        folders.insert(name, id);
        r.folders += 1;
    }
    for f in FILES {
        sqlx::query(
            "insert into files (name, size_bytes, kind, storage_key, uploader_id, folder_id, wiki_page_id, created_at, team_id) \
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        )
        .bind(f.name)
        .bind(parse_size(f.size)?)
        .bind(file_kind(f.name))
        .bind(format!("{}{}", crate::files::SEED_KEY_PREFIX, f.name))
        .bind(user(f.who)?)
        .bind(f.folder.map(|n| pick(&folders, n)).transpose()?)
        .bind(f.page.map(|p| pick(&wiki, p)).transpose()?)
        .bind(ctx.noon(f.date)?)
        .bind(team)
        .execute(&mut *c)
        .await?;
        r.files += 1;
    }

    // ----- Ссылки проекта -----
    for (g, (title, links)) in LINK_GROUPS.iter().enumerate() {
        let group_id: Uuid = sqlx::query_scalar(
            "insert into link_groups (title, position, project_id) values ($1, $2, $3) returning id",
        )
        .bind(title)
        .bind(1024.0 * (g as f64 + 1.0))
        .bind(first_project)
        .fetch_one(&mut *c)
        .await?;
        r.link_groups += 1;
        for (i, (link_title, url, description)) in links.iter().enumerate() {
            sqlx::query("insert into links (group_id, title, url, description, position) values ($1, $2, $3, $4, $5)")
                .bind(group_id)
                .bind(link_title)
                .bind(url)
                .bind(description)
                .bind(1024.0 * (i as f64 + 1.0))
                .execute(&mut *c)
                .await?;
            r.links += 1;
        }
    }

    Ok(r)
}
