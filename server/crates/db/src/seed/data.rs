//! Демо-данные: перенос seed() из design/Main.dc.html. Даты указаны так, как в макете («сегодня» там 2026-10-18),
//! при заполнении базы они сдвигаются на разницу с реальным днём.

pub const MOCK_TODAY: &str = "2026-10-18";

pub struct SeedUser {
    /// Буква, по которой макет ссылается на человека
    pub key: &'static str,
    pub email: &'static str,
    pub name: &'static str,
    pub role: &'static str,
    pub tone: i16,
    pub admin: bool,
}

pub const USERS: &[SeedUser] = &[
    SeedUser { key: "Л", email: "lena@example.com", name: "Лена М.", role: "Frontend", tone: 0, admin: true },
    SeedUser { key: "А", email: "artem@example.com", name: "Артём К.", role: "", tone: 1, admin: false },
    SeedUser { key: "Д", email: "daniil@example.com", name: "Даниил С.", role: "", tone: 2, admin: false },
    SeedUser { key: "С", email: "sonya@example.com", name: "Соня В.", role: "", tone: 3, admin: false },
    SeedUser { key: "И", email: "igor@example.com", name: "Игорь П.", role: "", tone: 4, admin: false },
];

/// Кого считаем автором действий, созданных не людьми из списка (создатель задач, вики, документов)
pub const DEFAULT_ACTOR: &str = "Л";

pub struct SeedProject {
    pub id: &'static str,
    pub key: &'static str,
    pub name: &'static str,
    pub color: &'static str,
    pub last_number: i32,
}

pub const PROJECTS: &[SeedProject] = &[
    SeedProject { id: "web", key: "WEB", name: "Web-приложение", color: "accent", last_number: 158 },
    SeedProject { id: "api", key: "API", name: "Мобильный API", color: "warn", last_number: 44 },
    SeedProject { id: "infra", key: "INF", name: "Инфраструктура", color: "ok", last_number: 14 },
];

pub struct SeedColumn {
    pub id: &'static str,
    pub title: &'static str,
    pub color: &'static str,
    pub done: bool,
}

/// Колонки одинаковые у всех проектов (cols() в макете)
pub const COLUMNS: &[SeedColumn] = &[
    SeedColumn { id: "todo", title: "К выполнению", color: "muted", done: false },
    SeedColumn { id: "progress", title: "В работе", color: "accent", done: false },
    SeedColumn { id: "review", title: "На ревью", color: "warn", done: false },
    SeedColumn { id: "done", title: "Готово", color: "ok", done: true },
];

/// (ключ в макете, подпись, индекс цвета в TONES)
pub const TAGS: &[(&str, &str, i16)] = &[
    ("bug", "Баг", 0),
    ("feat", "Фича", 1),
    ("debt", "Техдолг", 2),
    ("front", "Фронт", 3),
    ("back", "Бэк", 5),
    ("urgent", "Срочно", 4),
    ("design", "Нужен дизайн", 6),
];

pub struct SeedModule {
    pub id: &'static str,
    pub project: &'static str,
    pub title: &'static str,
    pub lead: &'static str,
    pub status: &'static str,
    pub from: &'static str,
    pub to: &'static str,
    pub note: &'static str,
}

pub const MODULES: &[SeedModule] = &[
    SeedModule {
        id: "m1",
        project: "web",
        title: "SSO",
        lead: "А",
        status: "progress",
        from: "2026-10-05",
        to: "2026-11-06",
        note: "Корпоративный вход через OpenID Connect",
    },
    SeedModule {
        id: "m2",
        project: "web",
        title: "Уведомления",
        lead: "Д",
        status: "progress",
        from: "2026-10-12",
        to: "2026-11-13",
        note: "Переработка модуля и каналов доставки",
    },
    SeedModule {
        id: "m3",
        project: "web",
        title: "Тёмная тема",
        lead: "Л",
        status: "progress",
        from: "2026-10-13",
        to: "2026-10-30",
        note: "Все экраны приложения",
    },
    SeedModule {
        id: "m4",
        project: "web",
        title: "Надёжность",
        lead: "С",
        status: "plan",
        from: "2026-11-02",
        to: "2026-11-27",
        note: "Производительность и ошибки на проде",
    },
    SeedModule {
        id: "m5",
        project: "api",
        title: "API v2",
        lead: "А",
        status: "progress",
        from: "2026-10-10",
        to: "2026-11-20",
        note: "Новая версия публичных эндпоинтов",
    },
    SeedModule {
        id: "m6",
        project: "infra",
        title: "Автоскейлинг",
        lead: "И",
        status: "plan",
        from: "2026-10-26",
        to: "2026-11-27",
        note: "",
    },
];

/// (ключ, проект, название, дата)
pub const MILESTONES: &[(&str, &str, &str, &str)] = &[
    ("ms1", "web", "Релиз 2.8.0", "2026-10-23"),
    ("ms2", "web", "Бета для сотрудников", "2026-10-30"),
    ("ms3", "web", "Релиз 2.9.0", "2026-11-20"),
    ("ms4", "api", "API v2 в тестировании", "2026-11-06"),
    ("ms5", "infra", "Автоскейлинг на стейдже", "2026-11-13"),
];

/// Когда произошло событие, как это записано в макете
#[derive(Clone, Copy)]
pub enum When {
    MinutesAgo(i64),
    HoursAgo(i64),
    /// «вчера, 18:20»
    YesterdayAt(u8, u8),
    /// «15 окт, 11:40» при «сегодня» 18 окт: дней назад, часы, минуты
    DaysAgoAt(i64, u8, u8),
}

#[derive(Default)]
pub struct SeedTask {
    pub id: &'static str,
    pub project: &'static str,
    pub title: &'static str,
    /// None: бэклог
    pub col: Option<&'static str>,
    pub who: Option<&'static str>,
    pub prio: &'static str,
    pub start: Option<&'static str>,
    pub due: Option<&'static str>,
    pub tags: &'static [&'static str],
    pub module: Option<&'static str>,
    pub ms: Option<&'static str>,
    pub pr: &'static str,
    pub desc: &'static str,
    /// (название, готово)
    pub subs: &'static [(&'static str, bool)],
    /// (кто, текст, когда)
    pub comments: &'static [(&'static str, &'static str, Option<When>)],
    /// (имя файла, размер, например «184 КБ»)
    pub files: &'static [(&'static str, &'static str)],
}

#[allow(clippy::too_many_arguments)]
fn t(
    id: &'static str,
    project: &'static str,
    title: &'static str,
    col: Option<&'static str>,
    who: Option<&'static str>,
    prio: &'static str,
    start: Option<&'static str>,
    due: Option<&'static str>,
    tags: &'static [&'static str],
) -> SeedTask {
    SeedTask { id, project, title, col, who, prio, start, due, tags, ..Default::default() }
}

pub fn tasks() -> Vec<SeedTask> {
    vec![
        t(
            "WEB-151",
            "web",
            "Экспорт отчёта в CSV",
            Some("todo"),
            Some("Л"),
            "med",
            Some("2026-10-19"),
            Some("2026-10-22"),
            &["feat", "front"],
        ),
        t(
            "WEB-149",
            "web",
            "Обновить зависимости до React 19",
            Some("todo"),
            Some("Д"),
            "low",
            None,
            Some("2026-10-30"),
            &["debt", "front"],
        ),
        SeedTask {
            module: Some("m4"),
            ..t(
                "WEB-153",
                "web",
                "Медленная пагинация в списке пользователей",
                Some("todo"),
                Some("А"),
                "high",
                Some("2026-10-19"),
                Some("2026-10-21"),
                &["bug", "back", "urgent"],
            )
        },
        SeedTask {
            module: Some("m1"),
            ms: Some("ms1"),
            pr: "#321",
            desc: "Подключить вход через OpenID Connect. Пользователям с корпоративным доменом создавать аккаунт автоматически.",
            subs: &[
                ("Настроить провайдера", true),
                ("Обработка callback", true),
                ("Привязка к существующим аккаунтам", true),
                ("Страница настроек SSO", false),
                ("Тесты", false),
            ],
            comments: &[("Д", "Callback проверил на стейдже, работает.", Some(When::YesterdayAt(17, 40)))],
            files: &[("sso-flow.png", "184 КБ")],
            ..t(
                "WEB-144",
                "web",
                "Вход через SSO для корпоративных аккаунтов",
                Some("progress"),
                Some("А"),
                "high",
                Some("2026-10-12"),
                Some("2026-10-23"),
                &["feat", "back"],
            )
        },
        t(
            "WEB-146",
            "web",
            "Не загружается аватар в Safari",
            Some("progress"),
            Some("С"),
            "high",
            Some("2026-10-15"),
            Some("2026-10-20"),
            &["bug", "front"],
        ),
        SeedTask {
            module: Some("m2"),
            subs: &[
                ("Вынести очередь", true),
                ("Шаблоны писем", true),
                ("Каналы доставки", false),
                ("Настройки пользователя", false),
                ("Миграция данных", false),
                ("Удалить старый код", false),
            ],
            ..t(
                "WEB-139",
                "web",
                "Рефакторинг модуля уведомлений",
                Some("progress"),
                Some("Д"),
                "med",
                Some("2026-10-12"),
                Some("2026-10-28"),
                &["debt", "back"],
            )
        },
        SeedTask {
            module: Some("m3"),
            ms: Some("ms1"),
            pr: "#318",
            ..t(
                "WEB-141",
                "web",
                "Тёмная тема для страницы настроек",
                Some("review"),
                Some("Л"),
                "med",
                Some("2026-10-13"),
                Some("2026-10-19"),
                &["feat", "front", "design"],
            )
        },
        SeedTask {
            pr: "#315",
            ..t(
                "WEB-137",
                "web",
                "Неверные часовые пояса в календаре",
                Some("review"),
                Some("И"),
                "med",
                Some("2026-10-14"),
                Some("2026-10-20"),
                &["bug", "back"],
            )
        },
        SeedTask {
            pr: "#309",
            ms: Some("ms1"),
            ..t(
                "WEB-133",
                "web",
                "Кэширование справочников на клиенте",
                Some("done"),
                Some("И"),
                "low",
                Some("2026-10-05"),
                Some("2026-10-14"),
                &["feat", "front"],
            )
        },
        t(
            "WEB-130",
            "web",
            "Перевод CI на новый раннер",
            Some("done"),
            Some("Д"),
            "low",
            Some("2026-10-06"),
            Some("2026-10-12"),
            &["debt"],
        ),
        SeedTask {
            pr: "#306",
            ..t(
                "WEB-128",
                "web",
                "Ошибка 500 при пустом профиле",
                Some("done"),
                Some("С"),
                "high",
                Some("2026-10-08"),
                Some("2026-10-12"),
                &["bug", "back", "urgent"],
            )
        },
        t(
            "WEB-126",
            "web",
            "Обновить мета-теги и favicon",
            Some("done"),
            Some("Л"),
            "low",
            Some("2026-10-07"),
            Some("2026-10-09"),
            &["debt", "front"],
        ),
        t("WEB-154", "web", "Фильтр по дате в журнале действий", None, None, "med", None, None, &["feat"]),
        t("WEB-155", "web", "Загрузка нескольких файлов за раз", None, None, "med", None, None, &["feat", "front"]),
        t("WEB-156", "web", "Метрики времени ответа в мониторинге", None, None, "low", None, None, &["debt", "back"]),
        SeedTask {
            module: Some("m2"),
            ..t("WEB-157", "web", "Дубли уведомлений при повторном входе", None, None, "high", None, None, &["bug"])
        },
        SeedTask {
            module: Some("m1"),
            ..t("WEB-158", "web", "Двухфакторная аутентификация", None, None, "med", None, None, &["feat", "back"])
        },
        SeedTask {
            module: Some("m5"),
            ms: Some("ms4"),
            ..t(
                "API-41",
                "api",
                "Версионирование эндпоинтов /v2",
                Some("todo"),
                Some("А"),
                "med",
                Some("2026-10-20"),
                Some("2026-11-06"),
                &["feat", "back"],
            )
        },
        SeedTask {
            module: Some("m5"),
            ..t(
                "API-39",
                "api",
                "Лимиты запросов на токен",
                Some("progress"),
                Some("Д"),
                "high",
                Some("2026-10-14"),
                Some("2026-10-24"),
                &["feat", "back"],
            )
        },
        t(
            "API-37",
            "api",
            "Устаревшие поля в ответе профиля",
            Some("done"),
            Some("С"),
            "low",
            Some("2026-10-08"),
            Some("2026-10-13"),
            &["debt"],
        ),
        t("API-44", "api", "Пагинация по курсору", None, None, "med", None, None, &["feat"]),
        SeedTask {
            module: Some("m6"),
            ms: Some("ms5"),
            ..t(
                "INF-12",
                "infra",
                "Автоскейлинг для воркеров",
                Some("progress"),
                Some("И"),
                "med",
                Some("2026-10-15"),
                Some("2026-11-06"),
                &["feat"],
            )
        },
        t(
            "INF-9",
            "infra",
            "Ротация секретов",
            Some("todo"),
            Some("И"),
            "high",
            Some("2026-10-19"),
            Some("2026-10-23"),
            &["debt", "urgent"],
        ),
        t("INF-14", "infra", "Бэкап в другой регион", None, None, "low", None, None, &["debt"]),
    ]
}

/// Лента активности: (кто, цель, текст, тип, проект, когда)
pub type ActivityRow = (&'static str, &'static str, &'static str, &'static str, Option<&'static str>, When);

pub const ACTIVITY: &[ActivityRow] = &[
    // В макете здесь «PR #312 влит в main», но приложение «влит» не отмечает (решение владельца, этап 4): единственное
    // событие кода — «добавлен PR», когда в задаче заполнили поле PR. Поэтому строка такая же, как её пишет сервер,
    // с задачей из сида, у которой этот PR есть.
    ("Д", "WEB-137 Неверные часовые пояса в календаре", "добавлен PR #315", "code", Some("web"), When::MinutesAgo(12)),
    ("С", "WEB-128 Ошибка 500 при пустом профиле", "перемещена в «Готово»", "move", Some("web"), When::HoursAgo(1)),
    (
        "Л",
        "WEB-141 Тёмная тема для страницы настроек",
        "перемещена в «На ревью»",
        "move",
        Some("web"),
        When::HoursAgo(3),
    ),
    (
        "И",
        "WEB-137 Неверные часовые пояса в календаре",
        "новый комментарий",
        "comment",
        Some("web"),
        When::YesterdayAt(18, 20),
    ),
    ("А", "Страница «Архитектура»", "обновлена", "doc", None, When::YesterdayAt(15, 2)),
    ("Д", "Релиз 2.8.0", "отмечен шаг «Проверить миграции БД»", "release", Some("web"), When::YesterdayAt(12, 10)),
    ("С", "WEB-146 Не загружается аватар в Safari", "создана", "create", Some("web"), When::DaysAgoAt(3, 11, 40)),
    ("А", "WEB-144 Вход через SSO", "добавлен PR #321", "code", Some("web"), When::DaysAgoAt(3, 10, 5)),
];

pub struct SeedRelease {
    pub project: &'static str,
    pub version: &'static str,
    pub date: &'static str,
    pub status: &'static str,
    pub notes: &'static str,
    pub checklist: &'static [(&'static str, bool)],
}

pub const RELEASES: &[SeedRelease] = &[
    SeedRelease {
        project: "web",
        version: "2.8.0",
        date: "2026-10-23",
        status: "progress",
        notes: "• Вход через SSO для корпоративных аккаунтов\n• Тёмная тема страницы настроек\n• Исправлены часовые пояса в календаре",
        checklist: &[
            ("Заморозка кода", true),
            ("Регрессионные тесты", true),
            ("Обновить changelog", true),
            ("Проверить миграции БД", true),
            ("Ревью релиз-нотов", false),
            ("Бэкап прод-базы", false),
            ("Выкатка на прод", false),
        ],
    },
    SeedRelease {
        project: "web",
        version: "2.9.0",
        date: "2026-11-20",
        status: "plan",
        notes: "",
        checklist: &[
            ("Заморозка кода", false),
            ("Регрессионные тесты", false),
            ("Обновить changelog", false),
            ("Выкатка на прод", false),
        ],
    },
    SeedRelease {
        project: "web",
        version: "2.7.2",
        date: "2026-10-02",
        status: "done",
        notes: "• Исправлена ошибка 500 при пустом профиле\n• Обновлены мета-теги и favicon",
        checklist: &[("Заморозка кода", true), ("Регрессионные тесты", true), ("Выкатка на прод", true)],
    },
    SeedRelease {
        project: "api",
        version: "1.14.0",
        date: "2026-11-06",
        status: "plan",
        notes: "",
        checklist: &[
            ("Заморозка кода", false),
            ("Проверить обратную совместимость", false),
            ("Выкатка на прод", false),
        ],
    },
];

pub struct SeedWiki {
    pub id: &'static str,
    pub parent: Option<&'static str>,
    pub title: &'static str,
    /// Строки markdown, склеиваются через \n
    pub md: &'static [&'static str],
}

pub const WIKI: &[SeedWiki] = &[
    SeedWiki {
        id: "w1",
        parent: None,
        title: "Начало работы",
        md: &[
            "Здесь живёт всё, что нужно команде: договорённости по коду, инструкции и файлы. Слева дерево страниц, страницы можно вкладывать друг в друга.",
            "",
            "> [!tip] Как редактировать",
            "> Нажми на любой абзац, и он превратится в обычный текст с разметкой. Кликни в сторону, и он снова станет красивым.",
            "",
            "## С чего начать",
            "",
            "- [x] Прочитать [[Соглашения по коду]]",
            "- [ ] Поднять окружение по инструкции из [[Деплой и окружения]]",
            "- [ ] Взять первую задачу из бэклога",
            "",
            "## Разметка",
            "",
            "Выделяй **жирным**, *курсивом* и `кодом`, ставь #теги, ссылайся на страницы двойными скобками и на сайты, например [так](https://example.com).",
            "",
            "Кнопки над текстом вставляют заголовки, списки, таблицы и код.",
        ],
    },
    SeedWiki {
        id: "w2",
        parent: None,
        title: "Разработка",
        md: &[
            "Всё о том, как мы пишем код и как выкатываем изменения.",
            "",
            "- [[Соглашения по коду]]: ветки, коммиты, ревью",
            "- [[Деплой и окружения]]: что где живёт и как выкатывать",
            "- Схемы сервисов и планы лежат в разделе «Документы»",
        ],
    },
    SeedWiki {
        id: "w4",
        parent: Some("w2"),
        title: "Соглашения по коду",
        md: &[
            "Короткие правила, чтобы историю репозитория было приятно читать.",
            "",
            "## Имена веток",
            "",
            "```",
            "feature/WEB-144-sso-login",
            "fix/WEB-146-safari-avatar",
            "chore/update-deps",
            "```",
            "",
            "## Коммиты",
            "",
            "| Тип | Когда использовать | Пример |",
            "| --- | --- | --- |",
            "| feat | Новая функциональность | feat: вход через SSO |",
            "| fix | Исправление ошибки | fix: аватар в Safari |",
            "| chore | Служебные изменения | chore: обновить зависимости |",
            "",
            "## Ревью",
            "",
            "- Не больше 400 строк в одном PR",
            "- Отвечаем на ревью в течение рабочего дня",
        ],
    },
    SeedWiki {
        id: "w5",
        parent: Some("w2"),
        title: "Деплой и окружения",
        md: &[
            "| Окружение | Ветка | Адрес |",
            "| --- | --- | --- |",
            "| dev | develop | dev.example.dev |",
            "| stage | release/* | stage.example.dev |",
            "| prod | main | app.example.dev |",
            "",
            "## Перед выкаткой",
            "",
            "- [ ] Заморозка кода объявлена в чате",
            "- [ ] Регрессионные тесты зелёные",
            "- [ ] Миграции БД проверены на стейдже",
            "",
            "## Команда выкатки",
            "",
            "```bash",
            "make release VERSION=2.8.0",
            "```",
        ],
    },
    SeedWiki {
        id: "w6", parent: None, title: "Процессы", md: &["Как мы работаем вместе: задачи, ревью, релизы."]
    },
    SeedWiki {
        id: "w7",
        parent: Some("w6"),
        title: "Работа с задачами",
        md: &[
            "Каждая задача проходит колонки доски слева направо.",
            "",
            "1. Новая идея сначала попадает в бэклог",
            "2. Берёшь задачу в работу и ставишь себя исполнителем",
            "3. Когда готов PR, переносишь карточку в «На ревью»",
            "4. Влили в main, значит «Готово»",
        ],
    },
    SeedWiki {
        id: "w8",
        parent: Some("w6"),
        title: "Онбординг",
        md: &[
            "## Первая неделя",
            "",
            "- [ ] Получить доступы к репозиторию и мониторингу",
            "- [ ] Поднять проект локально",
            "- [ ] Познакомиться с командой",
            "- [ ] Закрыть первую небольшую задачу",
            "",
            "Советы по окружению: [[Деплой и окружения]]",
        ],
    },
];

pub struct SeedObject {
    pub id: &'static str,
    pub kind: &'static str,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub text: &'static str,
    pub color: i16,
}

pub struct SeedDoc {
    pub title: &'static str,
    /// Кто создал и менял
    pub who: &'static str,
    pub starred: bool,
    pub updated: &'static str,
    pub mode: &'static str,
    pub note: (f32, f32, f32),
    pub md: &'static [&'static str],
    pub objects: &'static [SeedObject],
    /// Пары ключей объектов
    pub links: &'static [(&'static str, &'static str)],
}

#[allow(clippy::too_many_arguments)]
const fn obj(
    id: &'static str,
    kind: &'static str,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    text: &'static str,
    color: i16,
) -> SeedObject {
    SeedObject { id, kind, x, y, w, h, text, color }
}

pub const DOCS: &[SeedDoc] = &[
    SeedDoc {
        title: "Схема сервисов",
        who: "Д",
        starred: true,
        updated: "2026-10-16",
        mode: "edge",
        note: (24.0, 28.0, 400.0),
        md: &[
            "Как запрос проходит через систему. Схема справа, её можно двигать и дополнять стикерами.",
            "",
            "## Принципы",
            "",
            "- Клиент общается только с API-шлюзом",
            "- Долгие операции уходят в очередь заданий",
            "- Каждый сервис владеет своими данными",
            "",
            "> [!warning] Если схема устарела",
            "> Обнови её здесь же и напиши в чат команды.",
            "",
            "Правила кода: [[Соглашения по коду]]",
        ],
        objects: &[
            obj("w0", "text", 460.0, 24.0, 220.0, 36.0, "Схема запросов", 0),
            obj("w1", "rect", 460.0, 120.0, 110.0, 64.0, "Клиент", 3),
            obj("w2", "rect", 620.0, 120.0, 120.0, 64.0, "API-шлюз", 3),
            obj("w3", "rect", 800.0, 56.0, 150.0, 64.0, "Сервис пользователей", 5),
            obj("w4", "ellipse", 800.0, 190.0, 150.0, 80.0, "Очередь заданий", 6),
            obj("w5", "ellipse", 990.0, 120.0, 110.0, 80.0, "База данных", 4),
            obj("w6", "sticky", 620.0, 300.0, 190.0, 110.0, "Добавить кэш для справочников", 6),
        ],
        links: &[("w1", "w2"), ("w2", "w3"), ("w2", "w4"), ("w3", "w5"), ("w4", "w5")],
    },
    SeedDoc {
        title: "Планирование Q4",
        who: "Л",
        starred: false,
        updated: "2026-10-15",
        mode: "page",
        note: (24.0, 28.0, 440.0),
        md: &[
            "## Цели квартала",
            "",
            "1. Выпустить релиз 2.9.0 до 20 ноября",
            "2. Закрыть техдолг по авторизации",
            "3. Подготовить бету для сотрудников",
            "",
            "## Фокус по людям",
            "",
            "| Кто | Фокус | Статус |",
            "| --- | --- | --- |",
            "| Лена | Тёмная тема | В работе |",
            "| Артём | SSO | На ревью |",
            "| Даниил | Уведомления | В работе |",
            "",
            "## Риски",
            "",
            "- [ ] Нет окна для регрессионных тестов в конце ноября",
            "- [ ] Зависимость от внешнего SSO-провайдера",
            "- [x] Согласован бюджет на мониторинг",
            "",
            "#планирование #q4",
        ],
        objects: &[],
        links: &[],
    },
    SeedDoc {
        title: "Идеи по онбордингу",
        who: "С",
        starred: false,
        updated: "2026-10-14",
        mode: "page",
        note: (24.0, 28.0, 420.0),
        md: &[
            "Собираем, что поможет новичку быстрее влиться. Открой холст и добавляй стикеры рядом с текстом.",
            "",
            "- Чек-лист первой недели лежит в [[Онбординг]]",
            "- Нужен наставник на первые две недели",
            "- Короткое видео с обзором архитектуры",
        ],
        objects: &[
            obj("w1", "sticky", 480.0, 40.0, 190.0, 110.0, "Наставник на 2 недели", 6),
            obj("w2", "sticky", 700.0, 70.0, 190.0, 110.0, "Видео про архитектуру", 3),
            obj("w3", "sticky", 590.0, 200.0, 190.0, 110.0, "Тестовая задача на первый день", 5),
        ],
        links: &[],
    },
    SeedDoc {
        title: "Заметки со встречи 15 окт",
        who: "А",
        starred: false,
        updated: "2026-10-15",
        mode: "page",
        note: (24.0, 28.0, 440.0),
        md: &[
            "## Что обсудили",
            "",
            "Скоро релиз, договорились о заморозке кода в пятницу.",
            "",
            "- [x] Согласовать дату релиза",
            "- [ ] Обновить changelog",
            "- [ ] Написать пост для бета-группы",
            "",
            "## Решения",
            "",
            "> Фичи, которые не успели, переносим в следующий релиз без спешки.",
            "",
            "```bash",
            "make release VERSION=2.8.0",
            "```",
        ],
        objects: &[],
        links: &[],
    },
];

pub const FOLDERS: &[&str] = &["Дизайн", "Договорённости", "Скриншоты", "Вложения"];

pub struct SeedFile {
    pub name: &'static str,
    /// Как в макете: «184 КБ», «1,2 МБ»
    pub size: &'static str,
    pub who: &'static str,
    pub date: &'static str,
    pub folder: Option<&'static str>,
    pub page: Option<&'static str>,
}

pub const FILES: &[SeedFile] = &[
    SeedFile {
        name: "sso-flow.png",
        size: "184 КБ",
        who: "А",
        date: "2026-10-16",
        folder: Some("Вложения"),
        page: Some("w2"),
    },
    SeedFile {
        name: "architecture-v2.pdf",
        size: "1,2 МБ",
        who: "Д",
        date: "2026-10-14",
        folder: Some("Вложения"),
        page: Some("w2"),
    },
    SeedFile {
        name: "deploy-checklist.pdf",
        size: "92 КБ",
        who: "И",
        date: "2026-10-09",
        folder: Some("Вложения"),
        page: Some("w5"),
    },
    SeedFile {
        name: "ui-kit.zip", size: "8,4 МБ", who: "Л", date: "2026-10-08", folder: Some("Дизайн"), page: None
    },
    SeedFile {
        name: "settings-dark.png",
        size: "312 КБ",
        who: "Л",
        date: "2026-10-15",
        folder: Some("Дизайн"),
        page: None,
    },
    SeedFile {
        name: "Соглашения о коммитах.md",
        size: "4 КБ",
        who: "Д",
        date: "2026-10-02",
        folder: Some("Договорённости"),
        page: None,
    },
    SeedFile {
        name: "Регламент ревью.docx",
        size: "38 КБ",
        who: "Д",
        date: "2026-10-02",
        folder: Some("Договорённости"),
        page: None,
    },
    SeedFile {
        name: "safari-avatar-bug.png",
        size: "96 КБ",
        who: "С",
        date: "2026-10-15",
        folder: Some("Скриншоты"),
        page: None,
    },
    SeedFile {
        name: "метрики-q3.xlsx", size: "54 КБ", who: "И", date: "2026-10-05", folder: None, page: None
    },
];

/// Группа ссылок: название и ссылки (название, адрес, описание)
/// (название, адрес, описание)
pub type LinkRow = (&'static str, &'static str, &'static str);

pub const LINK_GROUPS: &[(&str, &[LinkRow])] = &[
    (
        "Код и сборка",
        &[
            ("Репозиторий web-приложения", "https://example.com/git/web-app", "Основной код, ветки и pull request-ы"),
            ("Репозиторий API", "https://example.com/git/api", "Сервер и мобильное API"),
            ("Сборки и пайплайны", "https://example.com/ci", "Статус CI и история деплоев"),
        ],
    ),
    (
        "Мониторинг",
        &[
            ("Метрики сервисов", "https://example.com/metrics", "Нагрузка, время ответа, ошибки"),
            ("Журнал ошибок", "https://example.com/errors", "Падения и исключения на проде"),
        ],
    ),
    (
        "Дизайн",
        &[
            ("Макеты интерфейса", "https://example.com/design", "Актуальные экраны и компоненты"),
            ("UI-кит", "https://example.com/ui-kit", "Цвета, шрифты, иконки"),
        ],
    ),
    (
        "Окружения",
        &[
            ("Dev", "https://example.com/dev", "Ветка develop, обновляется при каждом пуше"),
            ("Stage", "https://example.com/stage", "Релизные кандидаты и проверка перед выкаткой"),
            ("Prod", "https://example.com/app", "Боевое окружение"),
        ],
    ),
];
