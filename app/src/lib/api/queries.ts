// Чтение данных с сервера через TanStack Query. Ключи собраны в одном месте, чтобы изменения (мутации)
// и события WebSocket (этап 8) обращались к тем же самым записям кэша.

import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { api } from './client'
import type {
  ActivityPage,
  Board,
  Doc,
  DocSummary,
  FileList,
  Folder,
  LinkGroup,
  Project,
  Release,
  TaskDetail,
  User,
  WikiNode,
  WikiPage,
} from './types'

export const keys = {
  projects: ['projects'] as const,
  invites: ['invites'] as const,
  users: ['users'] as const,
  board: (projectId: string) => ['board', projectId] as const,
  task: (taskId: string) => ['task', taskId] as const,
  releases: (projectId: string) => ['releases', projectId] as const,
  wiki: ['wiki'] as const,
  wikiPage: (id: string) => ['wiki-page', id] as const,
  files: ['files'] as const,
  folders: ['folders'] as const,
  /** Все документы в порядке списка. Поиск лежит под этим же началом ключа, поэтому `['docs']` затрагивает и его. */
  docs: ['docs'] as const,
  docSearch: (q: string) => ['docs', 'search', q] as const,
  doc: (id: string) => ['doc', id] as const,
  /** Все ленты активности (при любых фильтрах) */
  activity: ['activity'] as const,
  activityFeed: (actor: string | null, kind: string | null) => ['activity', actor, kind] as const,
  linkGroups: ['link-groups'] as const,
}

export const useProjects = () => useQuery({ queryKey: keys.projects, queryFn: () => api.get<Project[]>('/projects') })

export const useUsers = () => useQuery({ queryKey: keys.users, queryFn: () => api.get<User[]>('/users'), staleTime: 60_000 })

export const useBoard = (projectId: string | null) =>
  useQuery({
    queryKey: keys.board(projectId ?? ''),
    queryFn: () => api.get<Board>(`/projects/${projectId}/board`),
    enabled: projectId !== null,
  })

export const useReleases = (projectId: string) =>
  useQuery({ queryKey: keys.releases(projectId), queryFn: () => api.get<Release[]>(`/projects/${projectId}/releases`) })

export const useTask = (taskId: string | null) =>
  useQuery({
    queryKey: keys.task(taskId ?? ''),
    queryFn: () => api.get<TaskDetail>(`/tasks/${taskId}`),
    enabled: taskId !== null,
  })

/** Дерево страниц вики без текста */
export const useWiki = () => useQuery({ queryKey: keys.wiki, queryFn: () => api.get<WikiNode[]>('/wiki') })

/** Страница с текстом. Правки идут через `usePageDraft`, который сам держит кэш страницы в порядке. */
export const useWikiPage = (id: string | null) =>
  useQuery({
    queryKey: keys.wikiPage(id ?? ''),
    queryFn: () => api.get<WikiPage>(`/wiki/${id}`),
    enabled: id !== null,
  })

/** Вся библиотека файлов сразу: поиск, тип и папки отбираются на экране, так они откликаются мгновенно */
export const useLibrary = () => useQuery({ queryKey: keys.files, queryFn: () => api.get<FileList>('/files') })

export const useFolders = () => useQuery({ queryKey: keys.folders, queryFn: () => api.get<Folder[]>('/folders') })

/** Все документы, без текста: карточки списка. Порядок общий для команды. */
export const useDocs = () => useQuery({ queryKey: keys.docs, queryFn: () => api.get<DocSummary[]>('/docs') })

/** Поиск по названию и тексту: ищет сервер, потому что текст в список не приходит. Пока ответа нет, остаётся прошлый. */
export const useDocSearch = (q: string) =>
  useQuery({
    queryKey: keys.docSearch(q),
    queryFn: () => api.get<DocSummary[]>(`/docs?q=${encodeURIComponent(q)}`),
    enabled: q !== '',
    placeholderData: keepPreviousData,
  })

/** Документ с текстом и холстом. Правки идут через черновики (docDrafts, canvasDraft), которые сами держат кэш в порядке. */
export const useDoc = (id: string | null) =>
  useQuery({
    queryKey: keys.doc(id ?? ''),
    queryFn: () => api.get<Doc>(`/docs/${id}`),
    enabled: id !== null,
  })

/** Адрес страницы ленты: фильтры по участнику и типу и курсор следующей страницы */
export function activityPath(actor: string | null, kind: string | null, before: string | null): string {
  const params = new URLSearchParams()
  if (actor) params.set('actor', actor)
  if (kind) params.set('kind', kind)
  if (before) params.set('before', before)
  const query = params.toString()
  return query ? `/activity?${query}` : '/activity'
}

/**
 * Лента активности постранично (по 50). `actor` и `kind` — фильтры, null значит «все». Страницы дозагружаются
 * `fetchNextPage`; при обновлении запрос перечитывает все загруженные страницы по порядку, поэтому стыки остаются целыми.
 */
export const useActivity = (actor: string | null, kind: string | null, enabled = true) =>
  useInfiniteQuery({
    queryKey: keys.activityFeed(actor, kind),
    queryFn: ({ pageParam }) => api.get<ActivityPage>(activityPath(actor, kind, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next ?? null,
    enabled,
    // события появляются от действий на других экранах: при каждом открытии ленты читаем её заново
    staleTime: 0,
  })

/** Группы ссылок команды вместе со ссылками */
export const useLinkGroups = () => useQuery({ queryKey: keys.linkGroups, queryFn: () => api.get<LinkGroup[]>('/link-groups') })
