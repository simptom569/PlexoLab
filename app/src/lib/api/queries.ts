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
  Invite,
  NotificationList,
  LinkGroup,
  Members,
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
  /** Архивные проекты, которыми я управляю; лежит под началом ключа проектов, поэтому `['projects']` затрагивает и его */
  archivedProjects: ['projects', 'archived'] as const,
  members: (projectId: string) => ['members', projectId] as const,
  users: ['users'] as const,
  board: (projectId: string) => ['board', projectId] as const,
  task: (taskId: string) => ['task', taskId] as const,
  releases: (projectId: string) => ['releases', projectId] as const,
  wiki: ['wiki'] as const,
  wikiPage: (id: string) => ['wiki-page', id] as const,
  files: ['files'] as const,
  folders: ['folders'] as const,
  /** Начало ключа всех списков документов (всех проектов, с поиском): `['docs']` затрагивает любой из них */
  docs: ['docs'] as const,
  /** Документы проекта в порядке списка. Поиск лежит под этим же началом ключа. */
  projectDocs: (projectId: string) => ['docs', projectId] as const,
  docSearch: (projectId: string, q: string) => ['docs', projectId, 'search', q] as const,
  doc: (id: string) => ['doc', id] as const,
  /** Все ленты активности (всех проектов, при любых фильтрах) */
  activity: ['activity'] as const,
  activityFeed: (projectId: string, actor: string | null, kind: string | null) => ['activity', projectId, actor, kind] as const,
  /** Кто есть в ленте проекта; лежит под началом ключа ленты, поэтому новое событие перечитывает и его */
  activityActors: (projectId: string) => ['activity', projectId, 'actors'] as const,
  /** Мои уведомления и счётчик непрочитанных (число в меню пользователя) */
  notifications: ['notifications'] as const,
  /** Начало ключа групп ссылок всех проектов */
  linkGroups: ['link-groups'] as const,
  projectLinkGroups: (projectId: string) => ['link-groups', projectId] as const,
}

export const useProjects = () => useQuery({ queryKey: keys.projects, queryFn: () => api.get<Project[]>('/projects') })

/** Мои архивные проекты: те, которыми я управляю */
export const useArchivedProjects = () =>
  useQuery({ queryKey: keys.archivedProjects, queryFn: () => api.get<Project[]>('/projects?archived=true') })

/** Приглашения, на которые я не ответил (их число показывает боковое меню) */
export const useMyInvites = () => useQuery({ queryKey: keys.invites, queryFn: () => api.get<Invite[]>('/invites') })

/** Мои уведомления: назначили исполнителем, упомянули. Число непрочитанных показывает боковое меню. */
export const useNotifications = () =>
  useQuery({ queryKey: keys.notifications, queryFn: () => api.get<NotificationList>('/notifications') })

/** Участники проекта; ожидающие приглашения приходят только администратору */
export const useMembers = (projectId: string | null) =>
  useQuery({
    queryKey: keys.members(projectId ?? ''),
    queryFn: () => api.get<Members>(`/projects/${projectId}/members`),
    enabled: projectId !== null,
  })

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

/** Документы проекта без текста: карточки списка. Порядок общий для участников проекта. */
export const useDocs = (projectId: string) =>
  useQuery({ queryKey: keys.projectDocs(projectId), queryFn: () => api.get<DocSummary[]>(`/projects/${projectId}/docs`) })

/** Поиск по названию и тексту: ищет сервер, потому что текст в список не приходит. Пока ответа нет, остаётся прошлый. */
export const useDocSearch = (projectId: string, q: string) =>
  useQuery({
    queryKey: keys.docSearch(projectId, q),
    queryFn: () => api.get<DocSummary[]>(`/projects/${projectId}/docs?q=${encodeURIComponent(q)}`),
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

/** Адрес страницы ленты проекта: фильтры по участнику и типу и курсор следующей страницы */
export function activityPath(projectId: string, actor: string | null, kind: string | null, before: string | null): string {
  const params = new URLSearchParams()
  if (actor) params.set('actor', actor)
  if (kind) params.set('kind', kind)
  if (before) params.set('before', before)
  const query = params.toString()
  return query ? `/projects/${projectId}/activity?${query}` : `/projects/${projectId}/activity`
}

/**
 * Лента активности постранично (по 50). `actor` и `kind` — фильтры, null значит «все». Страницы дозагружаются
 * `fetchNextPage`; при обновлении запрос перечитывает все загруженные страницы по порядку, поэтому стыки остаются целыми.
 */
export const useActivity = (projectId: string, actor: string | null, kind: string | null, enabled = true) =>
  useInfiniteQuery({
    queryKey: keys.activityFeed(projectId, actor, kind),
    queryFn: ({ pageParam }) => api.get<ActivityPage>(activityPath(projectId, actor, kind, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next ?? null,
    enabled,
    // события появляются от действий на других экранах: при каждом открытии ленты читаем её заново
    staleTime: 0,
  })

/** Кто есть в ленте проекта: у кого в ней есть события (вместе с участниками проекта из них собирается список «Участник») */
export const useActivityActors = (projectId: string) =>
  useQuery({ queryKey: keys.activityActors(projectId), queryFn: () => api.get<string[]>(`/projects/${projectId}/activity/actors`), staleTime: 0 })

/** Группы ссылок проекта вместе со ссылками */
export const useLinkGroups = (projectId: string) =>
  useQuery({ queryKey: keys.projectLinkGroups(projectId), queryFn: () => api.get<LinkGroup[]>(`/projects/${projectId}/link-groups`) })
