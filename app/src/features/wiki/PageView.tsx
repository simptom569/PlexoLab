import { useQueryClient } from '@tanstack/react-query'
import { Fragment, useEffect } from 'react'
import { Button, EmptyState, Icon, MarkdownEditor, Panel, Pill } from '../../components'
import { keys, useLibrary, useWiki, useWikiPage } from '../../lib/api/queries'
import type { WikiNode, WikiPage } from '../../lib/api/types'
import { formatSize } from '../../lib/format'
import { pickedFiles } from '../../lib/upload'
import { openExternal } from '../../lib/platform/opener'
import { UPLOAD_FAILED, useToast } from '../../lib/toast'
import { useOpenWikiLink } from './actions'
import { ConfirmDelete, FileName, FileTile } from './FileBits'
import { fileDate, kindOf, lowerTitles, pathTo } from './logic'
import { useDeleteFile, useDeletePage, useUploadFiles } from './mutations'
import { usePageDraft } from './drafts'
import { useWikiStore } from './store'

/** Баннер конфликта: страницу успел изменить другой участник. В макете такого элемента нет, собран из его переменных. */
function ConflictBanner({ onTheirs, onMine }: { onTheirs: () => void; onMine: () => void }) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        borderRadius: 12,
        border: '1px solid var(--line-strong)',
        background: 'var(--bug-bg)',
        color: 'var(--bug-fg)',
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      <span style={{ flex: 1, minWidth: 220 }}>Страницу изменил другой участник</span>
      <Button onClick={onTheirs}>Загрузить его версию</Button>
      <Button onClick={onMine}>Оставить мою</Button>
    </div>
  )
}

function PageFiles({ page }: { page: WikiNode }) {
  const files = (useLibrary().data?.files ?? []).filter((f) => f.wiki_page_id === page.id)
  const upload = useUploadFiles()
  const deleteFile = useDeleteFile()
  const showFiles = useWikiStore((s) => s.showFiles)

  return (
    <Panel aria-label="Файлы страницы">
      <h3 className="sec-title" style={{ margin: 0 }}>
        Файлы страницы <Pill>{files.length}</Pill>
      </h3>
      <div>
        {files.map((f) => (
          <div key={f.id} className="file-row" style={{ marginBottom: 8 }}>
            <FileTile file={f} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <FileName file={f} />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                {kindOf(f).single} · {formatSize(f.size_bytes)} · {fileDate(f.created_at)}
              </span>
            </span>
            <ConfirmDelete confirmKey={`file:${f.id}`} onConfirm={() => deleteFile.mutate({ id: f.id })} />
          </div>
        ))}
        {files.length === 0 && (
          <div className="drop-hint" style={{ marginBottom: 8 }}>
            К странице пока ничего не прикреплено
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label className="btn" style={{ cursor: 'pointer' }}>
            <Icon name="paperclip" sm />
            Прикрепить файлы
            <input
              className="sr"
              type="file"
              multiple
              onChange={(e) => {
                const picked = pickedFiles(e.currentTarget)
                if (picked.length) upload.mutate({ files: picked, wikiPageId: page.id }, { onError: () => useToast.getState().show(UPLOAD_FAILED) })
              }}
            />
          </label>
          <Button variant="ghost" onClick={showFiles}>
            Открыть библиотеку
          </Button>
        </div>
      </div>
    </Panel>
  )
}

/** Загруженная страница: название, редактор, файлы */
function LoadedPage({ page }: { page: WikiPage }) {
  const qc = useQueryClient()
  const pages = useWiki().data ?? []
  const { draft, state } = usePageDraft(page)
  const openPage = useWikiStore((s) => s.openPage)
  const autoEdit = useWikiStore((s) => s.editNew === page.id)
  const editStarted = useWikiStore((s) => s.editStarted)
  const deletePage = useDeletePage()
  const openLink = useOpenWikiLink()

  // новая страница открылась сразу на первом блоке: «просьба» выполнена, повторять при возврате не нужно
  useEffect(() => {
    if (autoEdit) editStarted()
  }, [autoEdit, editStarted])

  const node = pages.find((p) => p.id === page.id) ?? page
  const path = pathTo(pages, page.id)

  const setTitle = (title: string) => {
    draft.setTitle(title)
    // дерево и «хлебные крошки» показывают название сразу, не дожидаясь сохранения
    qc.setQueryData<WikiNode[]>(keys.wiki, (list) => list?.map((n) => (n.id === page.id ? { ...n, title } : n)))
  }

  return (
    <>
      <div className="head" style={{ alignItems: 'center' }}>
        <div className="crumb" style={{ flexWrap: 'wrap' }}>
          {path.map((p, i) => (
            <Fragment key={p.id}>
              <button className="crumb-btn" type="button" onClick={() => openPage(p.id)}>
                {p.title || 'Без названия'}
              </button>
              {i < path.length - 1 && <span aria-hidden="true">/</span>}
            </Fragment>
          ))}
        </div>
        <ConfirmDelete confirmKey={`wiki:${page.id}`} onConfirm={() => deletePage.mutate({ id: page.id })} />
      </div>
      <input
        className="doc-title"
        placeholder="Без названия"
        aria-label="Название страницы"
        value={state.title}
        onChange={(e) => setTitle(e.target.value)}
      />
      {state.conflict && <ConflictBanner onTheirs={() => draft.acceptTheirs()} onMine={() => draft.keepMine()} />}
      <MarkdownEditor
        // чужая версия заменила текст: редактор начинается заново
        key={state.resetKey}
        md={state.md}
        onChange={(md) => draft.setMd(md)}
        wikiTitles={lowerTitles(pages)}
        onOpenWiki={openLink}
        onOpenUrl={(url) => void openExternal(url)}
        autoEdit={autoEdit}
        onFinish={() => void draft.flush()}
      />
      <PageFiles page={node} />
    </>
  )
}

/** Открытая страница: загружает её текст и показывает */
export function PageView({ pageId }: { pageId: string }) {
  const page = useWikiPage(pageId)
  if (page.isPending) return <EmptyState>Загружаю страницу…</EmptyState>
  if (page.isError) {
    return (
      <EmptyState>
        Не удалось загрузить страницу
        <div style={{ marginTop: 12 }}>
          <Button onClick={() => void page.refetch()}>Повторить</Button>
        </div>
      </EmptyState>
    )
  }
  return <LoadedPage key={pageId} page={page.data} />
}
