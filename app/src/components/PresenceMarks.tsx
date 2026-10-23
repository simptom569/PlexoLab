import { useEffect, useState } from 'react'
import { cx } from '../lib/cx'
import type { PlacedMark } from '../lib/realtime/presence'
import { presenceClass } from '../lib/tones'

// Метки присутствия в редакторе: кто сейчас в этом блоке. В макете их нет; цвета человека те же, что у его аватара
// (пары `--a-bg`…`--e-fg`), стили в `styles/presence.css`.

/** Сколько ярлык показывает имя после появления, потом остаётся кружок с буквой (при наведении имя возвращается) */
const NAME_SHOWN_MS = 3000

function useFolded(fixed: boolean): boolean {
  const [folded, setFolded] = useState(false)
  useEffect(() => {
    if (fixed) return
    const timer = setTimeout(() => setFolded(true), NAME_SHOWN_MS)
    return () => clearTimeout(timer)
  }, [fixed])
  return folded && !fixed
}

/** Ярлык: кружок с буквой и имя. `fixed` — имя не сворачивается (пустой блок, мой блок), `label` — своя подпись вместо имени. */
function PresenceChip({ mark, fixed = false, label }: { mark: PlacedMark; fixed?: boolean; label?: string }) {
  const folded = useFolded(fixed)
  return (
    <span className={cx('pm-chip', presenceClass(mark.tone), folded && 'fold')} title={mark.name} aria-hidden="true">
      <b className="pm-dot">{mark.name.trim().charAt(0).toUpperCase()}</b>
      <span className="pm-name">{label ?? mark.name}</span>
    </span>
  )
}

const names = (marks: PlacedMark[]) => marks.map((m) => m.name).join(', ')

/**
 * Полоска слева и ярлыки в блоке, где сейчас кто-то есть (метки идут в порядке прихода). Блок рисует их внутри себя и
 * сам красится цветом последнего пришедшего (`pmTone`). `mine`: это мой открытый блок, ярлык подписан «тоже здесь».
 */
export function BlockMarks({ marks, mine = false }: { marks: PlacedMark[]; mine?: boolean }) {
  return (
    <>
      <span className="pm-bar" aria-hidden="true" />
      <span className="pm-chips">
        {marks.map((m) => (
          <PresenceChip key={m.key} mark={m} fixed={mine} label={mine ? `${m.name} тоже здесь` : undefined} />
        ))}
      </span>
      <span className="sr">{names(marks)} {marks.length > 1 ? 'в этом блоке' : mine ? 'тоже в этом блоке' : 'в этом блоке'}</span>
    </>
  )
}

/** Человек вставил блок между абзацами и ещё ничего не написал: пустого блока не видно, видна строка-заглушка */
export function PresenceSlot({ marks }: { marks: PlacedMark[] }) {
  const last = marks[marks.length - 1]!
  return (
    <div className={cx('pm-slot', presenceClass(last.tone))}>
      {marks.map((m) => (
        <PresenceChip key={m.key} mark={m} fixed />
      ))}
      <span>{marks.length > 1 ? 'добавляют блок' : 'добавляет блок'}</span>
    </div>
  )
}
