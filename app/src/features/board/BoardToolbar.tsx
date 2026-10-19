import type { ReactNode } from 'react'
import { Anchor, Badge, Button, Chip, Icon, Opt, Popover, PopoverItems, PopoverTitle, SearchField, Segmented } from '../../components'
import { PRIORITY_LABELS } from '../../lib/domain'
import { toneAt } from '../../lib/tones'
import { DISPLAY_KEYS, VIEWS, type DueFilter } from '../../lib/settings'
import { useUi } from '../../lib/ui-store'
import { countFilters, DISPLAY_LABELS, DUE_LABELS, VIEW_LABELS } from './filterLabels'
import { NONE } from './logic'
import { useModel } from './model'

function FiltersPopover() {
  const m = useModel()
  const { filters, toggleFilter, setDue, clearFilters, closeMenus } = useUi()
  const group = (title: string, items: ReactNode[]) => (
    <div>
      <PopoverTitle>{title}</PopoverTitle>
      <PopoverItems>{items}</PopoverItems>
    </div>
  )
  return (
    <Popover aria-label="Фильтры">
      {group('Исполнитель', [
        ...m.users.map((u) => (
          <Opt key={u.id} on={filters.who.includes(u.id)} onClick={() => toggleFilter('who', u.id)}>
            {u.name}
          </Opt>
        )),
        <Opt key={NONE} on={filters.who.includes(NONE)} onClick={() => toggleFilter('who', NONE)}>
          Без исполнителя
        </Opt>,
      ])}
      {group(
        'Приоритет',
        (['high', 'med', 'low'] as const).map((k) => (
          <Opt key={k} on={filters.prio.includes(k)} onClick={() => toggleFilter('prio', k)}>
            {PRIORITY_LABELS[k]}
          </Opt>
        )),
      )}
      {group(
        'Метки',
        m.board.tags.map((tag) => (
          <Opt key={tag.id} on={filters.tag.includes(tag.id)} swatch={toneAt(tag.tone).fg} onClick={() => toggleFilter('tag', tag.id)}>
            {tag.label}
          </Opt>
        )),
      )}
      {group('Модуль', [
        ...m.board.modules.map((mod) => (
          <Opt key={mod.id} on={filters.module.includes(mod.id)} onClick={() => toggleFilter('module', mod.id)}>
            {mod.title}
          </Opt>
        )),
        <Opt key={NONE} on={filters.module.includes(NONE)} onClick={() => toggleFilter('module', NONE)}>
          Без модуля
        </Opt>,
      ])}
      {group(
        'Срок',
        (Object.keys(DUE_LABELS) as DueFilter[]).map((k) => (
          <Opt key={k} on={filters.due === k} onClick={() => setDue(k)}>
            {DUE_LABELS[k]}
          </Opt>
        )),
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <Button variant="ghost" onClick={clearFilters}>
          Сбросить всё
        </Button>
        <Button onClick={closeMenus}>Готово</Button>
      </div>
    </Popover>
  )
}

function DisplayPopover() {
  const { display, toggleDisplay } = useUi()
  return (
    <Popover aria-label="Что показывать на карточке">
      <div>
        <PopoverTitle>Показывать на карточке</PopoverTitle>
        <PopoverItems>
          {DISPLAY_KEYS.map((key) => (
            <Opt key={key} on={display[key]} onClick={() => toggleDisplay(key)}>
              {DISPLAY_LABELS[key]}
            </Opt>
          ))}
        </PopoverItems>
      </div>
    </Popover>
  )
}

/** Поиск, «Мои задачи», «Фильтры», «Отображение» и переключатель видов */
export function BoardToolbar() {
  const m = useModel()
  const { q, setQuery, filters, setFilters, menu, toggleMenu, view, setView } = useUi()
  const count = countFilters(filters)
  const mineOn = filters.who.length === 1 && filters.who[0] === m.me.id

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
      <SearchField label="Поиск по задачам" placeholder="Поиск по задачам" value={q} onChange={setQuery} />

      <Chip toggle on={mineOn} onClick={() => setFilters({ ...filters, who: mineOn ? [] : [m.me.id] })}>
        Мои задачи
      </Chip>

      <Anchor>
        <Chip on={count > 0} aria-expanded={menu === 'filters'} onClick={() => toggleMenu('filters')}>
          <Icon name="filter" sm />
          Фильтры
          {count > 0 && <Badge>{count}</Badge>}
        </Chip>
        {menu === 'filters' && <FiltersPopover />}
      </Anchor>

      <Anchor>
        <Chip aria-expanded={menu === 'display'} onClick={() => toggleMenu('display')}>
          <Icon name="sliders" sm />
          Отображение
        </Chip>
        {menu === 'display' && <DisplayPopover />}
      </Anchor>

      <Segmented
        label="Вид задач"
        options={VIEWS.map((v) => ({ value: v, label: VIEW_LABELS[v] }))}
        value={view}
        onChange={setView}
        style={{ marginLeft: 'auto' }}
      />
    </div>
  )
}
