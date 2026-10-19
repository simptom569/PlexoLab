import type { CSSProperties, ReactNode } from 'react'
import { Button } from '../../components'
import type { LibraryFile } from '../../lib/api/types'
import { downloadFile } from '../../lib/download'
import { toneAt } from '../../lib/tones'
import { useUi } from '../../lib/ui-store'
import { fileExt, kindOf } from './logic'

/** Плитка файла с расширением, цвет по типу (.ft) */
export function FileTile({ file }: { file: LibraryFile }) {
  const tone = toneAt(kindOf(file).tone)
  return (
    <span className="ft" style={{ background: tone.bg, color: tone.fg }}>
      {fileExt(file.name)}
    </span>
  )
}

const NAME_STYLE: CSSProperties = {
  display: 'block',
  maxWidth: '100%',
  padding: 0,
  border: 0,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontWeight: 600,
  textAlign: 'left',
  cursor: 'pointer',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

/**
 * Название файла: выглядит как в макете, а по нажатию файл скачивается.
 * `plain`: обычный вес шрифта и вся свободная ширина строки (так в панели задачи).
 */
export function FileName({ file, plain }: { file: { id: string; name: string }; plain?: boolean }) {
  return (
    <button
      type="button"
      style={plain ? { ...NAME_STYLE, display: 'inline', flex: 1, minWidth: 0, fontWeight: 'inherit' } : NAME_STYLE}
      title="Скачать"
      onClick={() => void downloadFile(file)}
    >
      {file.name}
    </button>
  )
}

/** «Удалить», после нажатия «Точно удалить?»; второе нажатие удаляет (confirmThen в макете) */
export function ConfirmDelete({ confirmKey, onConfirm, children }: { confirmKey: string; onConfirm: () => void; children?: ReactNode }) {
  const confirm = useUi((s) => s.confirm)
  const setConfirm = useUi((s) => s.setConfirm)
  return (
    <Button
      variant="ghost"
      onClick={() => {
        if (confirm === confirmKey) {
          setConfirm(null)
          onConfirm()
        } else setConfirm(confirmKey)
      }}
    >
      {confirm === confirmKey ? 'Точно удалить?' : (children ?? 'Удалить')}
    </Button>
  )
}
