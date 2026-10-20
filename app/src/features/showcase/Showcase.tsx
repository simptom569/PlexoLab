import { useState, type CSSProperties, type ReactNode } from 'react'
import {
  Anchor,
  Avatar,
  Badge,
  Button,
  Chip,
  Count,
  Dot,
  EmptyState,
  Icon,
  ICON_NAMES,
  IconButton,
  Input,
  MenuItem,
  Opt,
  Panel,
  Pill,
  Popover,
  PopoverItems,
  PopoverTitle,
  PriorityBars,
  ProgressBar,
  SearchField,
  Segmented,
  Sq,
  Switch,
  Tag,
  Textarea,
  Tick,
  TitleInput,
} from '../../components'
import { ThemeRoot } from '../../components/AppShell'
import { BrandIcon, BrandSlot } from '../../components/Brand'
import { toneAt, TONES } from '../../lib/tones'

// Витрина компонентов для разработки и визуальных тестов: /showcase (обе темы), /showcase?theme=light|dark (одна тема).
// Раскладка здесь служебная, сами компоненты используют классы из styles.css как есть.

const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }
const caption: CSSProperties = { fontSize: 12, color: 'var(--muted)' }

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel aria-label={title}>
      <h2 className="sec-h" style={{ margin: 0 }}>
        {title}
      </h2>
      {children}
    </Panel>
  )
}

function Row({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ ...row, ...style }}>{children}</div>
}

// Сетка, а не flex-колонка: иначе flex-basis из styles.css (например, у .search) превращается в высоту
function Cell({ label, children, stretch }: { label: string; children: ReactNode; stretch?: boolean }) {
  return (
    <div style={{ display: 'grid', justifyItems: stretch ? 'stretch' : 'start', gap: 6 }}>
      <span style={caption}>{label}</span>
      {children}
    </div>
  )
}

const VIEW_OPTIONS = [
  { value: 'board', label: 'Доска' },
  { value: 'list', label: 'Список' },
  { value: 'table', label: 'Таблица' },
  { value: 'cal', label: 'Календарь' },
  { value: 'gantt', label: 'Ганта' },
] as const

const TAG_LABELS = ['Баг', 'Фича', 'Техдолг', 'Фронт', 'Бэк', 'Срочно', 'Нужен дизайн', 'Метка']

function DemoCard({ id, title, drag }: { id: string; title: string; drag?: boolean }) {
  return (
    <article className={drag ? 'card drag' : 'card'}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
          {id}
        </span>
        <PriorityBars prio="med" labelled style={{ marginLeft: 'auto' }} />
      </div>
      <button className="card-title" type="button">
        {title}
      </button>
      <div className="meta">
        <span className="i">
          <Icon name="calendar" sm />
          22 окт
        </span>
        <Avatar name="Лена М." tone={0} style={{ marginLeft: 'auto' }} />
      </div>
    </article>
  )
}

function Components() {
  const [view, setView] = useState<(typeof VIEW_OPTIONS)[number]['value']>('board')
  const [live, setLive] = useState(true)

  return (
    <>
      <Section title="Кнопки">
        <Row>
          <Cell label="Button">
            <Button>Кнопка</Button>
          </Cell>
          <Cell label="on">
            <Button on>Включена</Button>
          </Cell>
          <Cell label="danger">
            <Button danger>
              <Icon name="trash" sm />
              Удалить
            </Button>
          </Cell>
          <Cell label="primary">
            <Button variant="primary">
              <Icon name="plus" />
              Новая задача
            </Button>
          </Cell>
          <Cell label="ghost">
            <Button variant="ghost">Отмена</Button>
          </Cell>
          <Cell label="с иконкой">
            <Button>
              <Icon name="paperclip" sm />
              Прикрепить файл
            </Button>
          </Cell>
        </Row>
        <Row>
          <Cell label="IconButton">
            <IconButton label="Добавить" icon="plus" />
          </Cell>
          <Cell label="меню">
            <IconButton label="Меню" icon="dots" />
          </Cell>
          <Cell label="small">
            <IconButton label="Закрыть" icon="close" small />
          </Cell>
        </Row>
      </Section>

      <Section title="Чипы, переключатель, счётчики">
        <Row>
          <Cell label="Chip">
            <Chip toggle>Мои задачи</Chip>
          </Cell>
          <Cell label="on">
            <Chip toggle on>
              Мои задачи
            </Chip>
          </Cell>
          <Cell label="с иконкой и Badge">
            <Chip on>
              <Icon name="filter" sm />
              Фильтры
              <Badge>3</Badge>
            </Chip>
          </Cell>
          <Cell label="с иконкой">
            <Chip>
              <Icon name="sliders" sm />
              Отображение
            </Chip>
          </Cell>
        </Row>
        <Row>
          <Cell label="Segmented">
            <Segmented label="Вид задач" options={VIEW_OPTIONS} value={view} onChange={setView} />
          </Cell>
        </Row>
        <Row>
          <Cell label="Switch (нажимается)">
            <Switch label="Обновлять вживую" checked={live} onChange={setLive} />
          </Cell>
          <Cell label="выключен">
            <Switch label="Выключен" checked={false} onChange={() => {}} />
          </Cell>
          <Cell label="включён">
            <Switch label="Включён" checked onChange={() => {}} />
          </Cell>
          <Cell label="недоступен">
            <Switch label="Недоступен, выключен" checked={false} disabled onChange={() => {}} />
          </Cell>
          <Cell label="недоступен, включён">
            <Switch label="Недоступен, включён" checked disabled onChange={() => {}} />
          </Cell>
        </Row>
        <Row style={{ alignItems: 'flex-start' }}>
          <Cell label="Count">
            <Count>5</Count>
          </Cell>
          <Cell label="Pill">
            <Pill>Пилюля</Pill>
          </Cell>
          <Cell label="Pill (модуль на карточке)">
            <Pill style={{ padding: '1px 8px' }}>SSO</Pill>
          </Cell>
          <Cell label="Count surface в .list-head">
            <div className="sheet" style={{ minWidth: 220 }}>
              <div className="list-head">
                <Dot color="var(--warn)" />
                <span>На ревью</span>
                <Count surface>2</Count>
              </div>
            </div>
          </Cell>
        </Row>
      </Section>

      <Section title="Аватары, метки, приоритет">
        {(['sm', undefined, 'lg'] as const).map((size) => (
          <Row key={size ?? 'md'}>
            <span style={{ ...caption, width: 52 }}>{size ?? 'обычный'}</span>
            {['Лена М.', 'Артём К.', 'Даниил С.', 'Соня В.', 'Игорь П.'].map((n, i) => (
              <Avatar key={n} name={n} tone={i} size={size} />
            ))}
            <Avatar name={null} size={size} />
          </Row>
        ))}
        <Row>
          {TAG_LABELS.map((label, i) => (
            <Tag key={label} tone={i}>
              {label}
            </Tag>
          ))}
        </Row>
        <Row>
          <Cell label="Dot">
            <Row style={{ gap: 8 }}>
              <Dot color="var(--muted)" />
              <Dot color="var(--accent)" />
              <Dot color="var(--warn)" />
              <Dot color="var(--ok)" />
            </Row>
          </Cell>
          <Cell label="Sq">
            <Row style={{ gap: 8 }}>
              <Sq color="var(--accent)" />
              <Sq color="var(--warn)" />
              <Sq color="var(--ok)" />
            </Row>
          </Cell>
          <Cell label="PriorityBars">
            <Row>
              <span style={{ ...row, gap: 6 }}>
                <PriorityBars prio="high" /> Высокий
              </span>
              <span style={{ ...row, gap: 6 }}>
                <PriorityBars prio="med" /> Средний
              </span>
              <span style={{ ...row, gap: 6 }}>
                <PriorityBars prio="low" /> Низкий
              </span>
            </Row>
          </Cell>
        </Row>
      </Section>

      <Section title="Прогресс">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 360 }}>
          <Cell label="0%" stretch>
            <ProgressBar pct={0} />
          </Cell>
          <Cell label="40%" stretch>
            <ProgressBar pct={40} />
          </Cell>
          <Cell label="100%, ok" stretch>
            <ProgressBar pct={100} ok />
          </Cell>
          <Cell label="small, 60%" stretch>
            <ProgressBar pct={60} small />
          </Cell>
        </div>
      </Section>

      <Section title="Поля ввода и отметки">
        <Row style={{ alignItems: 'flex-start' }}>
          <Cell label="SearchField">
            <SearchField label="Поиск по задачам" placeholder="Поиск по задачам" value="" onChange={() => {}} />
          </Cell>
          <Cell label="Input">
            <Input placeholder="Новая задача в бэклог, затем Enter" aria-label="Пример поля" style={{ width: 280 }} readOnly />
          </Cell>
          <Cell label="TitleInput">
            <TitleInput aria-label="Пример заголовка" defaultValue="Название модуля" style={{ width: 220 }} readOnly />
          </Cell>
          <Cell label="Textarea">
            <Textarea aria-label="Пример описания" placeholder="Что нужно сделать, критерии готовности, ссылки" style={{ width: 280 }} readOnly />
          </Cell>
        </Row>
        <Row>
          <Cell label="Tick">
            <Tick label="Отметить" />
          </Cell>
          <Cell label="done">
            <Tick label="Снять отметку" done />
          </Cell>
        </Row>
      </Section>

      <Section title="Поповеры и меню">
        <Row style={{ alignItems: 'flex-start', gap: 24, minHeight: 300 }}>
          <Anchor>
            <Chip on>
              <Icon name="filter" sm />
              Фильтры
              <Badge>2</Badge>
            </Chip>
            <Popover aria-label="Фильтры">
              <div>
                <PopoverTitle>Приоритет</PopoverTitle>
                <PopoverItems>
                  <Opt on>Высокий</Opt>
                  <Opt>Средний</Opt>
                  <Opt>Низкий</Opt>
                </PopoverItems>
              </div>
              <div>
                <PopoverTitle>Метки</PopoverTitle>
                <PopoverItems>
                  {TAG_LABELS.slice(0, 4).map((label, i) => (
                    <Opt key={label} on={i === 1} swatch={toneAt(i).fg}>
                      {label}
                    </Opt>
                  ))}
                </PopoverItems>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <Button variant="ghost">Сбросить всё</Button>
                <Button>Готово</Button>
              </div>
            </Popover>
          </Anchor>
          <Anchor style={{ marginLeft: 'auto' }}>
            <IconButton label="Меню колонки" icon="dots" />
            <Popover small right>
              <MenuItem>Переименовать</MenuItem>
              <MenuItem>Считать колонкой «Готово»</MenuItem>
              <MenuItem danger>
                <span>
                  Удалить колонку<small>Задачи (3) переедут в «К выполнению»</small>
                </span>
              </MenuItem>
            </Popover>
          </Anchor>
        </Row>
      </Section>

      <Section title="Пустое состояние и панель">
        <EmptyState>Релизов пока нет</EmptyState>
        <Panel style={{ background: 'var(--surface2)' }}>Вложенная панель (.panel)</Panel>
      </Section>

      <Section title="Бренд">
        <Row style={{ gap: 24 }}>
          <Cell label="BrandIcon 32×32">
            <BrandIcon />
          </Cell>
          <Cell label="BrandSlot (заглушка макета)">
            <BrandSlot />
          </Cell>
        </Row>
      </Section>

      <Section title="Перетаскивание: заглушки (.ph, .ph-col, .brow-ph, .cal-ph, .drag)">
        <Row style={{ alignItems: 'flex-start', gap: 16 }}>
          <Cell label="Карточка в колонке-цели: .col.over, .card.drag, .ph">
            <section className="col over" aria-label="Колонка-цель" style={{ width: 272, flex: 'none' }}>
              <div className="col-head">
                <span className="grip" aria-hidden="true">
                  <Icon name="grip" sm />
                </span>
                <Dot color="var(--warn)" />
                <h2>На ревью</h2>
                <Count surface>2</Count>
              </div>
              <div className="col-body">
                <DemoCard id="WEB-141" title="Тёмная тема для страницы настроек" />
                <div className="ph" style={{ height: 112 }} />
                <DemoCard id="WEB-151" title="Экспорт отчёта в CSV" drag />
              </div>
            </section>
          </Cell>
          <Cell label="Колонка: .col.drag и .ph.ph-col">
            <Row style={{ alignItems: 'flex-start', gap: 16 }}>
              <section className="col drag" aria-label="Переносимая колонка" style={{ width: 272, flex: 'none' }}>
                <div className="col-head">
                  <span className="grip" aria-hidden="true">
                    <Icon name="grip" sm />
                  </span>
                  <Dot color="var(--ok)" />
                  <h2>Готово</h2>
                  <Count surface>4</Count>
                </div>
                <div className="col-body">
                  <DemoCard id="WEB-133" title="Кэширование справочников на клиенте" />
                </div>
              </section>
              <div className="ph ph-col" style={{ width: 272, height: 200 }} />
            </Row>
          </Cell>
        </Row>
        <Cell label="Строка бэклога: .brow.drag и .brow-ph" stretch>
          <div className="sheet">
            <div className="sheet-scroll">
              <div className="brow drag">
                <span className="grip" aria-hidden="true">
                  <Icon name="grip" sm />
                </span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
                  WEB-154
                </span>
                <button className="row-title" type="button">
                  Фильтр по дате в журнале действий
                </button>
                <div className="row-tags">
                  <Tag tone={1}>Фича</Tag>
                </div>
                <span style={{ fontSize: 13, color: 'var(--muted)' }} />
                <Avatar name={null} />
                <PriorityBars prio="med" labelled />
                <Button>На доску</Button>
              </div>
              <div className="brow-ph" style={{ height: 44 }} />
              <div className="brow">
                <span className="grip" aria-hidden="true">
                  <Icon name="grip" sm />
                </span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
                  WEB-155
                </span>
                <button className="row-title" type="button">
                  Загрузка нескольких файлов за раз
                </button>
                <div className="row-tags">
                  <Tag tone={1}>Фича</Tag>
                  <Tag tone={3}>Фронт</Tag>
                </div>
                <span style={{ fontSize: 13, color: 'var(--muted)' }} />
                <Avatar name={null} />
                <PriorityBars prio="med" labelled />
                <Button>На доску</Button>
              </div>
            </div>
          </div>
        </Cell>
        <Cell label="Календарь: .cal-cell.over с .cal-ph, .cal-pill.drag, .today, .out" stretch>
          <div className="sheet">
            <div className="cal-scroll">
              <div className="cal-inner">
                <div className="cal-grid">
                  {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((w) => (
                    <div key={w} className="cal-wd">
                      {w}
                    </div>
                  ))}
                  <div className="cal-cell out">
                    <span className="cal-num">28</span>
                  </div>
                  <div className="cal-cell">
                    <span className="cal-num">29</span>
                  </div>
                  <div className="cal-cell">
                    <span className="cal-num">30</span>
                    <button
                      className="cal-pill drag"
                      type="button"
                      style={{ background: TONES[1].bg, color: TONES[1].fg }}
                    >
                      Экспорт отчёта в CSV
                    </button>
                  </div>
                  <div className="cal-cell over">
                    <span className="cal-num">1</span>
                    <div className="cal-ph">Экспорт отчёта в CSV</div>
                  </div>
                  <div className="cal-cell today">
                    <span className="cal-num">2</span>
                  </div>
                  <div className="cal-cell">
                    <span className="cal-num">3</span>
                  </div>
                  <div className="cal-cell">
                    <span className="cal-num">4</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Cell>
      </Section>

      <Section title="Иконки">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))', gap: 12 }}>
          {ICON_NAMES.map((name) => (
            <div key={name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Icon name={name} />
                <Icon name={name} sm />
              </span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                {name}
              </span>
            </div>
          ))}
        </div>
      </Section>
    </>
  )
}

function ThemeShowcase({ dark }: { dark: boolean }) {
  return (
    <ThemeRoot dark={dark}>
      <main className="main" data-theme-showcase={dark ? 'dark' : 'light'}>
        <header className="head">
          <div className="head-l">
            <div className="crumb">Витрина компонентов</div>
            <h1 className="h1">{dark ? 'Тёмная тема' : 'Светлая тема'}</h1>
          </div>
        </header>
        <Components />
      </main>
    </ThemeRoot>
  )
}

export default function Showcase() {
  const theme = new URLSearchParams(location.search).get('theme')
  return (
    <>
      {theme !== 'dark' && <ThemeShowcase dark={false} />}
      {theme !== 'light' && <ThemeShowcase dark />}
    </>
  )
}
