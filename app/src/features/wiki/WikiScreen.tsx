import { useEffect, useRef } from 'react'
import { Button, EmptyState } from '../../components'
import { useLibrary, useWiki } from '../../lib/api/queries'
import { FilesLibrary } from './FilesLibrary'
import { ancestorsOf, currentPage } from './logic'
import { PageView } from './PageView'
import { useWikiStore } from './store'
import { WikiTree } from './WikiTree'

/** Экран «Вики»: слева дерево страниц, справа открытая страница или библиотека файлов */
export function WikiScreen() {
  const pages = useWiki()
  const library = useLibrary()
  const { pageId, view } = useWikiStore()
  const reveal = useWikiStore((s) => s.reveal)
  const cur = pages.data ? currentPage(pages.data, pageId) : null

  // при входе дерево раскрыто до открытой страницы (сохранённой с прошлого раза), дальше им управляет человек
  const revealed = useRef(false)
  useEffect(() => {
    if (revealed.current || !pages.data || !cur) return
    revealed.current = true
    reveal(ancestorsOf(pages.data, cur.id))
  }, [pages.data, cur, reveal])

  if (pages.isPending) return <EmptyState>Загружаю вики…</EmptyState>
  if (pages.isError) {
    return (
      <EmptyState>
        Не удалось загрузить вики
        <div style={{ marginTop: 12 }}>
          <Button onClick={() => void pages.refetch()}>Повторить</Button>
        </div>
      </EmptyState>
    )
  }

  return (
    <>
      <header className="head">
        <div className="head-l">
          <h1 className="h1">Вики</h1>
          <p className="sub">
            Постоянные знания команды: инструкции, регламенты, файлы. Страницы пишутся на markdown, ссылки между ними ставятся двойными скобками.
          </p>
        </div>
      </header>
      <div className="docs">
        <WikiTree pages={pages.data} currentId={view === 'page' ? (cur?.id ?? null) : null} fileTotal={library.data?.total ?? 0} />
        <div className="doc-main">
          {view === 'files' ? (
            <FilesLibrary />
          ) : cur ? (
            <PageView pageId={cur.id} />
          ) : (
            <EmptyState>Страниц нет. Создай первую кнопкой слева</EmptyState>
          )}
        </div>
      </div>
    </>
  )
}
