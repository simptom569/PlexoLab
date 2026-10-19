import { Avatar, Button, Chip, Icon, Input, SearchField } from '../../components'
import { useFolders, useLibrary, useUsers, useWiki } from '../../lib/api/queries'
import type { LibraryFile } from '../../lib/api/types'
import { formatSize } from '../../lib/format'
import { pickedFiles } from '../../lib/upload'
import { UPLOAD_FAILED, useToast } from '../../lib/toast'
import { ConfirmDelete, FileName, FileTile } from './FileBits'
import { FILE_KINDS, KINDS, fileDate, fileWhere, filesCount, kindOf, libraryView } from './logic'
import { useCreateFolder, useDeleteFile, useDeleteFolder, useUploadFiles } from './mutations'
import { useWikiStore } from './store'

/** Библиотека файлов: папки, поиск, тип, загрузка (Файлы в макете) */
export function FilesLibrary() {
  const { folder, kind, fileQ, newFolder, setFolder, setKind, setFileQuery, setNewFolder, libraryRoot, openPage } = useWikiStore()
  const files = useLibrary().data?.files ?? []
  const folders = useFolders().data ?? []
  const pages = useWiki().data ?? []
  const users = useUsers().data ?? []
  const upload = useUploadFiles()
  const deleteFile = useDeleteFile()
  const createFolder = useCreateFolder()
  const deleteFolder = useDeleteFolder()

  const view = libraryView(files, folders, { folder, kind, q: fileQ })
  const currentFolder = folder ? folders.find((f) => f.id === folder) : undefined

  const addFolder = () => {
    const name = newFolder.trim()
    if (!name || folders.some((f) => f.name === name) || createFolder.isPending) return
    createFolder.mutate({ name })
    setNewFolder('')
  }

  const row = (f: LibraryFile) => {
    const who = users.find((u) => u.id === f.uploader_id)
    const where = fileWhere(f, pages, folders)
    return (
      <div key={f.id} className="frow">
        <FileTile file={f} />
        <span style={{ minWidth: 0 }}>
          <FileName file={f} />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{kindOf(f).single}</span>
        </span>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>
          {where.text}
          {where.page && (
            <>
              {' '}
              <button className="crumb-btn" type="button" style={{ color: 'var(--accent)' }} onClick={() => openPage(where.page!.id)}>
                Открыть
              </button>
            </>
          )}
        </span>
        <Avatar name={who?.name ?? null} tone={who?.tone} size="sm" emptyLabel="Неизвестный автор" />
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{fileDate(f.created_at)}</span>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{formatSize(f.size_bytes)}</span>
        <ConfirmDelete confirmKey={`file:${f.id}`} onConfirm={() => deleteFile.mutate({ id: f.id })} />
      </div>
    )
  }

  return (
    <>
      <div className="head" style={{ alignItems: 'center' }}>
        <div>
          <h2 className="sec-h" style={{ margin: '0 0 4px' }}>
            Файлы
          </h2>
          <div className="crumb">
            <button className="crumb-btn" type="button" onClick={libraryRoot}>
              Все файлы
            </button>
            {currentFolder && (
              <>
                <span aria-hidden="true">/</span>
                <span>{currentFolder.name}</span>
              </>
            )}
          </div>
        </div>
        <label className="btn-primary" style={{ cursor: 'pointer' }}>
          <Icon name="upload" />
          Загрузить файлы
          <input
            className="sr"
            type="file"
            multiple
            onChange={(e) => {
              const picked = pickedFiles(e.currentTarget)
              if (picked.length) upload.mutate({ files: picked, folderId: folder }, { onError: () => useToast.getState().show(UPLOAD_FAILED) })
            }}
          />
        </label>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <SearchField
          label="Поиск по файлам"
          placeholder="Поиск файлов"
          value={fileQ}
          onChange={setFileQuery}
          style={{ flex: '0 1 240px', minWidth: 180 }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} role="group" aria-label="Тип файла">
          <Chip toggle on={kind === 'all'} onClick={() => setKind('all')}>
            Все
          </Chip>
          {FILE_KINDS.map((k) => (
            <Chip key={k} toggle on={kind === k} onClick={() => setKind(k)}>
              {KINDS[k].label}
            </Chip>
          ))}
        </div>
        {folder === null && (
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            <Input
              style={{ width: 170 }}
              placeholder="Новая папка"
              aria-label="Название новой папки"
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addFolder()}
            />
            <Button onClick={addFolder}>Создать</Button>
          </div>
        )}
      </div>
      {view.folders.length > 0 && (
        <div className="folder-grid">
          {view.folders.map(({ folder: f, count }) => (
            <div key={f.id} className="folder">
              <span className="ft" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                <Icon name="folder" />
              </span>
              <button className="open" type="button" onClick={() => setFolder(f.id)}>
                <span>{f.name}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>{filesCount(count)}</span>
              </button>
              {count === 0 && <ConfirmDelete confirmKey={`fo:${f.id}`} onConfirm={() => deleteFolder.mutate({ id: f.id })} />}
            </div>
          ))}
        </div>
      )}
      <div className="sheet">
        <div className="sheet-scroll">
          {view.files.map(row)}
          {view.files.length === 0 && view.folders.length === 0 && (
            <div style={{ padding: '22px 16px', color: 'var(--muted)', textAlign: 'center' }}>Файлов нет. Загрузи первые кнопкой справа вверху</div>
          )}
        </div>
      </div>
    </>
  )
}
