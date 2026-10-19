import type { CSSProperties } from 'react'
import type { LibraryFile } from '../../lib/api/types'
import { downloadFile } from '../../lib/download'
import { toneAt } from '../../lib/tones'
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
