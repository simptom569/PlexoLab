# Карта макета: блок → компонент

Номера строк относятся к `design/Main.dc.html` из этого архива. Если файл правили, ищи по комментариям `<!-- ... -->` в разметке и по именам методов.

## Как читать макет

- Разметка лежит внутри `<x-dc>`. Условия `<sc-if value="{{x}}">` — это `{x && ...}`, циклы `<sc-for list="{{xs}}" as="item">` — это `xs.map(item => ...)`. Атрибут `hint-placeholder-*` игнорируй, он нужен редактору.
- Значения `{{a.b}}` берутся из методов `v*` класса `Component` (`vBoard`, `vPanel`, и т.д.). Эти методы — готовая спецификация того, что должен отдавать компонент.
- Обработчики `onClick="{{x}}"` лежат в тех же методах.
- Инлайн-стили в разметке (`style="display:flex;gap:..."`) — часть дизайна, переноси их без изменений.
- Корневой контейнер в макете имеет `min-height:1380px` для рабочего поля артефакта. В приложении замени на `min-height:100vh`. Это единственное допустимое отличие в корне.

## Каркас (строки 328–400)

| Блок | Компонент | Классы |
|---|---|---|
| Весь экран | `AppShell` | `.app`, `.app.dark` |
| Шапка меню: место под иконку + «PlexoLab» | `Brand` | `.brand-slot` (заглушка, пока нет файла иконки; потом `<img>` 32×32 с `border-radius:10px`) |
| Боковое меню | `Sidebar` | `.side`, `.nav`, `.nav.on`, `.nav.cur`, `.count`, `.sq`, `.avatar.lg` |
| Контент | `<main class="main">` | `.main` |
| Подложка закрытия поповеров | `Backdrop` | `.backdrop` |

## Общие компоненты (сделать первыми, этап 1)

`Button` (`.btn`, `.btn-primary`, `.btn-ghost`, `.btn.danger`, `.btn.on`), `IconButton` (`.icon-btn`), `Chip` (`.chip`, `.chip.on`), `Segmented` (`.seg`), `Avatar` (`.avatar`, `.sm`, `.lg`, `.av-a…av-e`, `.av-none`), `Tag` (`.tag`), `Pill` (`.pill`), `Count` (`.count`), `ProgressBar` (`.bar`, `.fill`, `.fill.ok`), `PriorityBars` (`.prio.p-high|med|low`), `Popover` (`.pop`, `.pop.right`, `.pop.sm`, `.pop-title`, `.pop-items`, `.opt`), `MenuItem` (`.menu-item`), `Tick` (`.tick`), `SearchField` (`.search`), `Input` (`.inp`, `.title-inp`), `EmptyState` (`.empty`), `Panel` (`.panel`), `Icon` (`.ic`, `.ic.sm`, все иконки это inline-SVG из разметки, вынести в компоненты без изменений).

## Доска (строки 395–751)

| Блок | Строки | Компонент |
|---|---|---|
| Шапка доски, прогресс, «Новая задача» | 402–423 | `BoardHeader` |
| Панель инструментов: поиск, «Мои задачи», «Фильтры», «Отображение», переключатель видов | 424–486 | `BoardToolbar`, `FiltersPopover`, `DisplayPopover` |
| Чипы активных фильтров | 487–496 | `ActiveFilters` (`.filter-chip`) |
| Вид «Доска» | 497–629 | `KanbanView`, `KanbanColumn` (`.col`, `.col-head`, `.col-body`, `.col-input`, `.grip`, `.col-new`, `.add-col`), `TaskCard` (`.card`, `.card-title`, `.meta`, `.late`, `.card.before`), `QuickAdd` (`.quick`) |
| Вид «Список» | 630–658 | `ListView` (`.sheet`, `.list-head`, `.row`, `.row-title`, `.row-tags`) |
| Вид «Таблица» | 659–686 | `TableView` (`.trow`, `.trow.thead`, `.sort`) |
| Вид «Календарь» | 687–713 | `CalendarView` (`.cal-head`, `.cal-grid`, `.cal-cell`, `.cal-num`, `.cal-pill`, `.cal-wd`, `.cal-scroll`, `.cal-inner`) |
| Вид «Ганта» | 714–752 | `GanttView` (`.g-row`, `.g-label`, `.g-track`, `.g-bar`, `.g-tick`, `.g-today`) |

Логика: `vBoard`, `moveTask`, `reorderCol`, `setCols`, `createTask`, `toggleDoneTask`, `ctx` (производные: фильтрация, выполненность), `dueInfo`.

**Перетаскивание и заглушка:** `dStart` (старт, запоминает размер переносимого элемента в `dragH`/`dragW`), `pastMid` (указатель в нижней/правой половине элемента), `overCardAt` (куда ставить заглушку карточки), `dropCard` (бросок; возврат на то же место ничего не меняет), `clearDrag`. Состояние: `dragId`, `dragK` (`card` или `col`), `dragH`, `dragW`, `overCol`, `overCard` (id или `__end`), `overSlot` (id колонки или `__end`), `overDay`. Классы: `.ph`, `.ph-col`, `.brow-ph`, `.cal-ph`, `.drag`. Обёртки `<div style="display:contents">` вокруг колонки, карточки и строки бэклога нужны только чтобы заглушка и элемент были соседями в одном flex-контейнере и ловили события вместе; в React-версии это не нужно, структура DOM там определяется `dnd-kit`.

## Панель задачи (строки 1341–1473, после закрытия `</main>`)

`TaskDrawer` (`.scrim`, `.drawer`, `.dr-head`, `.dr-body`, `.dr-title`, `.fields`, `.f-row`, `.f-label`, `.f-val`, `.sub-row`, `.sub-input`, `.comment`, `.bubble`, `.file-row`, `.mini-task`). Логика: `vPanel`.

## Остальные страницы

| Страница | Строки | Компоненты | Логика |
|---|---|---|---|
| Бэклог | 753–788 | `BacklogPage` (`.sheet`, `.row`) | `vBacklog` |
| Модули | 789–840 | `ModulesPage`, `ModuleCard` (`.cards-grid`, `.pill-btn`, `.bar`) | `vModules` |
| Релизы и вехи | 841–923 | `ReleasesPage`, `MilestoneRow` (`.ms-row`), `ReleaseCard` (`.two-col`, `.tick`) | `vReleases` |
| Вики | 924–1107 | `WikiPage`, `WikiTree` (`.docs`, `.tree`, `.tr`, `.tr-caret`, `.tr-title`, `.tr-add`), `WikiPageView` (`.doc-main`, `.doc-title`, `.crumb`, `.crumb-btn`), `FilesLibrary` (`.folder-grid`, `.folder`, `.frow`, `.ft`, `.file-row`) | `vWiki`, `uploadFiles`, `kindOf` |
| Документы | 1108–1250 | `DocsList` (`.dgrid`, `.dcard`, `.dcard-open`, `.dthumb`, `.dstar`), `DocView` (`.dbar`, `.cv-wrap`, `.cv.page|edge`, `.note`, `.note-grip`, `.eg-tools`, `.wb-item`, `.wb-line`) | `vDocs`, `wbDown`, `noteDown`, `wbLink` |
| Редактор markdown (внутри вики и документов) | в разметке вики/документов, блок `.md-bar` … `.md-add` | `MarkdownEditor`, `MarkdownBlock`, `FormatToolbar` | `vEditor`, `mdView`, `md*` |
| Активность | 1251–1292 | `ActivityPage` (`.act-row`, `.chip`, `.tag`) | `vActivity` |
| Ссылки команды | 1293–1337 | `LinksPage` (`.link-card`, `.link-main`, `.link-add`, `.cards-grid`) | `vLinks` |

## Цвета типов

Метки и аватары используют 8 пар «фон / текст»: `--bug-*`, `--feat-*`, `--debt-*`, `--a-*` … `--e-*`. В коде макета это массив `TONES`; индекс `tone` у метки или цвета у объекта холста — индекс в этом массиве. Значения лежат в первых строках `design/styles.css` для светлой и тёмной темы.

## Иконки

Все иконки — inline-SVG 24×24, `fill:none; stroke:currentColor`, толщина задаётся классом `.ic`. Копируй `<path>` из разметки макета, не подключай иконочные библиотеки.
