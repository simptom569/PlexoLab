import { Icon } from '../../components'
import { PRIORITY_LABELS } from '../../lib/domain'
import { useUi } from '../../lib/ui-store'
import { NONE } from './logic'
import { DUE_LABELS } from './filterLabels'
import { useModel } from './model'

/** Чипы включённых фильтров под панелью инструментов */
export function ActiveFilters() {
  const m = useModel()
  const { filters, toggleFilter, setDue } = useUi()

  const chips: Array<{ key: string; label: string; remove: () => void }> = [
    ...filters.who.map((v) => ({
      key: `who:${v}`,
      label: v === NONE ? 'Без исполнителя' : (m.usersById.get(v)?.name ?? ''),
      remove: () => toggleFilter('who', v),
    })),
    ...filters.prio.map((v) => ({ key: `prio:${v}`, label: PRIORITY_LABELS[v], remove: () => toggleFilter('prio', v) })),
    ...filters.tag.map((v) => ({ key: `tag:${v}`, label: m.tagsById.get(v)?.label ?? '', remove: () => toggleFilter('tag', v) })),
    ...filters.module.map((v) => ({
      key: `module:${v}`,
      label: v === NONE ? 'Без модуля' : (m.modulesById.get(v)?.title ?? ''),
      remove: () => toggleFilter('module', v),
    })),
    ...(filters.due !== 'any' ? [{ key: 'due', label: DUE_LABELS[filters.due], remove: () => setDue('any') }] : []),
  ]
  if (chips.length === 0) return null

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <span style={{ color: 'var(--muted)', fontSize: 13 }}>Активные фильтры:</span>
      {chips.map((chip) => (
        <span key={chip.key} className="filter-chip">
          {chip.label}
          <button type="button" aria-label={`Убрать фильтр ${chip.label}`} onClick={chip.remove}>
            <Icon name="close" sm />
          </button>
        </span>
      ))}
    </div>
  )
}
