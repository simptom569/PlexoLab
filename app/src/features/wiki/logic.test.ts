import { describe, expect, it } from 'vitest'
import type { Folder, LibraryFile, WikiNode } from '../../lib/api/types'
import {
  ancestorsOf,
  currentPage,
  fileDate,
  fileExt,
  fileWhere,
  filesCount,
  findByTitle,
  libraryView,
  lowerTitles,
  pathTo,
  treeRows,
} from './logic'

const node = (id: string, title: string, parent: string | null = null): WikiNode => ({
  id,
  parent_id: parent,
  title,
  position: 0,
  rev: 1,
  updated_by: null,
  updated_at: '2026-10-18T12:00:00Z',
})

// страницы из макета
const PAGES = [
  node('w1', 'Начало работы'),
  node('w2', 'Разработка'),
  node('w6', 'Процессы'),
  node('w4', 'Соглашения по коду', 'w2'),
  node('w5', 'Деплой и окружения', 'w2'),
  node('w7', 'Работа с задачами', 'w6'),
  node('w8', 'Онбординг', 'w6'),
]

const titles = (rows: ReturnType<typeof treeRows>) => rows.map((r) => `${'  '.repeat(r.depth)}${r.node.title}${r.hasKids ? ' +' : ''}`)

describe('treeRows', () => {
  it('свёрнутое дерево показывает только корень', () => {
    expect(titles(treeRows(PAGES, {}, ''))).toEqual(['Начало работы', 'Разработка +', 'Процессы +'])
  })

  it('раскрытая страница показывает вложенные сразу под собой', () => {
    expect(titles(treeRows(PAGES, { w2: true }, ''))).toEqual([
      'Начало работы',
      'Разработка +',
      '  Соглашения по коду',
      '  Деплой и окружения',
      'Процессы +',
    ])
  })

  it('поиск плоский: страницы из любой глубины, без вложенности', () => {
    const rows = treeRows(PAGES, {}, '  ДЕПЛОЙ ')
    expect(titles(rows)).toEqual(['Деплой и окружения'])
    expect(rows[0].depth).toBe(0)
    expect(rows[0].hasKids).toBe(false)
  })

  it('страница без названия ищется как «Без названия»', () => {
    const pages = [node('a', ''), node('b', 'Другая')]
    expect(treeRows(pages, {}, 'без назв').map((r) => r.node.id)).toEqual(['a'])
  })

  it('ничего не найдено — пустой список', () => {
    expect(treeRows(PAGES, {}, 'нет такой')).toEqual([])
  })
})

describe('путь и поиск страниц', () => {
  it('pathTo даёт путь от корня', () => {
    expect(pathTo(PAGES, 'w4').map((p) => p.title)).toEqual(['Разработка', 'Соглашения по коду'])
    expect(pathTo(PAGES, 'w1').map((p) => p.title)).toEqual(['Начало работы'])
    expect(pathTo(PAGES, 'нет')).toEqual([])
    expect(pathTo(PAGES, null)).toEqual([])
  })

  it('pathTo не зацикливается на повреждённом дереве', () => {
    const loop = [node('a', 'А', 'b'), node('b', 'Б', 'a')]
    expect(pathTo(loop, 'a').length).toBeLessThanOrEqual(2)
  })

  it('ancestorsOf — родители без самой страницы', () => {
    expect(ancestorsOf(PAGES, 'w4')).toEqual(['w2'])
    expect(ancestorsOf(PAGES, 'w1')).toEqual([])
  })

  it('findByTitle без учёта регистра и пробелов по краям', () => {
    expect(findByTitle(PAGES, '  разработка ')?.id).toBe('w2')
    expect(findByTitle(PAGES, 'Нет такой')).toBeUndefined()
    expect(findByTitle([node('a', '')], '')?.id).toBe('a')
  })

  it('lowerTitles', () => {
    expect(lowerTitles(PAGES)[1]).toBe('разработка')
  })

  it('currentPage: сохранённая, иначе первая корневая, иначе пусто', () => {
    expect(currentPage(PAGES, 'w5')?.id).toBe('w5')
    expect(currentPage(PAGES, 'удалена')?.id).toBe('w1')
    expect(currentPage(PAGES, null)?.id).toBe('w1')
    expect(currentPage([], 'w1')).toBeNull()
  })
})

const folder = (id: string, name: string): Folder => ({ id, name, file_count: 0 })
const file = (id: string, name: string, kind: string, o: Partial<LibraryFile> = {}): LibraryFile => ({
  id,
  name,
  size_bytes: 1,
  kind,
  uploader_id: null,
  folder_id: null,
  wiki_page_id: null,
  task_id: null,
  created_at: '2026-10-05T12:00:00Z',
  ...o,
})

const FOLDERS = [folder('d', 'Дизайн'), folder('s', 'Скриншоты'), folder('v', 'Вложения')]
const FILES = [
  file('f1', 'sso-flow.png', 'img', { folder_id: 'v', wiki_page_id: 'w2' }),
  file('f2', 'architecture-v2.pdf', 'pdf', { folder_id: 'v', wiki_page_id: 'w2' }),
  file('f3', 'ui-kit.zip', 'zip', { folder_id: 'd' }),
  file('f4', 'dark-theme.png', 'img', { folder_id: 's' }),
  file('f5', 'метрики-q3.xlsx', 'sheet'),
]

describe('libraryView', () => {
  it('корень: папки со счётчиками и файлы вне папок', () => {
    const v = libraryView(FILES, FOLDERS, { folder: null, kind: 'all', q: '' })
    expect(v.flat).toBe(false)
    expect(v.folders.map((f) => [f.folder.name, f.count])).toEqual([['Дизайн', 1], ['Скриншоты', 1], ['Вложения', 2]])
    expect(v.files.map((f) => f.name)).toEqual(['метрики-q3.xlsx'])
  })

  it('внутри папки: её файлы и без списка папок', () => {
    const v = libraryView(FILES, FOLDERS, { folder: 'v', kind: 'all', q: '' })
    expect(v.folders).toEqual([])
    expect(v.files.map((f) => f.name)).toEqual(['sso-flow.png', 'architecture-v2.pdf'])
  })

  it('поиск идёт по всем папкам и прячет список папок', () => {
    const v = libraryView(FILES, FOLDERS, { folder: 'd', kind: 'all', q: ' DARK ' })
    expect(v.flat).toBe(true)
    expect(v.folders).toEqual([])
    expect(v.files.map((f) => f.name)).toEqual(['dark-theme.png'])
  })

  it('тип тоже ищет везде', () => {
    const v = libraryView(FILES, FOLDERS, { folder: null, kind: 'img', q: '' })
    expect(v.flat).toBe(true)
    expect(v.files.map((f) => f.name)).toEqual(['sso-flow.png', 'dark-theme.png'])
    expect(libraryView(FILES, FOLDERS, { folder: null, kind: 'img', q: 'sso' }).files).toHaveLength(1)
  })

  it('пустая библиотека', () => {
    const v = libraryView([], [], { folder: null, kind: 'all', q: '' })
    expect(v).toEqual({ flat: false, folders: [], files: [] })
  })
})

describe('подписи файлов', () => {
  it('расширение: до четырёх букв заглавными', () => {
    expect(fileExt('sso-flow.png')).toBe('PNG')
    expect(fileExt('metrics.xlsx')).toBe('XLSX')
    expect(fileExt('archive.tar.gz')).toBe('GZ')
    expect(fileExt('Makefile')).toBe('MAKE')
    expect(fileExt('data.jpeg2000')).toBe('JPEG')
  })

  it('число файлов со склонением', () => {
    expect([0, 1, 2, 5, 11, 21].map(filesCount)).toEqual(['0 файлов', '1 файл', '2 файла', '5 файлов', '11 файлов', '21 файл'])
  })

  it('дата: сегодня или короткая', () => {
    const now = new Date(2026, 9, 18, 12)
    expect(fileDate(new Date(2026, 9, 18, 9).toISOString(), now)).toBe('сегодня')
    expect(fileDate(new Date(2026, 9, 16, 12).toISOString(), now)).toBe('16 окт')
  })

  it('где лежит файл', () => {
    const [f1, , f3, , f5] = FILES
    expect(fileWhere(f1, PAGES, FOLDERS)).toEqual({ text: 'Страница «Разработка»', page: PAGES[1] })
    expect(fileWhere(f3, PAGES, FOLDERS)).toEqual({ text: 'Папка «Дизайн»', page: null })
    expect(fileWhere(f5, PAGES, FOLDERS)).toEqual({ text: 'Корень', page: null })
    expect(fileWhere({ ...f1, wiki_page_id: 'удалена' }, PAGES, FOLDERS).text).toBe('Папка «Вложения»')
  })
})
