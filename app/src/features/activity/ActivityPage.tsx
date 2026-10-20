import { useEffect, useRef } from 'react'
import { Avatar, Button, Chip, EmptyState, Tag } from '../../components'
import { useActivity, useUsers } from '../../lib/api/queries'
import type { ActivityEvent, User } from '../../lib/api/types'
import { whenText } from '../../lib/date'
import { effectiveWho, groupByDay, KIND_CHIPS, kindMeta } from './logic'
import { useActivityStore } from './store'

/** Начать грузить следующую страницу, когда до конца ленты остаётся столько пикселей */
const LOAD_AHEAD_PX = 600

/** Строка ленты (.act-row): аватар, объект и действие, участник со временем, метка типа */
function Row({ event, actor, lastRef }: { event: ActivityEvent; actor: User | undefined; lastRef?: (el: HTMLDivElement | null) => void }) {
  const meta = kindMeta(event.category)
  return (
    <div className="act-row" ref={lastRef}>
      <Avatar name={actor?.name ?? null} tone={actor?.tone} emptyLabel="Участник неизвестен" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span>
          <strong>{event.target}</strong> {event.text}
        </span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{`${actor?.name ?? 'Неизвестный участник'} · ${whenText(event.created_at)}`}</span>
      </div>
      <Tag tone={meta.tone}>{meta.label}</Tag>
    </div>
  )
}

export function ActivityPage() {
  const usersQuery = useUsers()
  const users = usersQuery.data
  const storedWho = useActivityStore((s) => s.who)
  const kind = useActivityStore((s) => s.kind)
  const setWho = useActivityStore((s) => s.setWho)
  const setKind = useActivityStore((s) => s.setKind)

  const who = effectiveWho(storedWho, users?.map((u) => u.id))
  // пока список участников не пришёл, ленту не запрашиваем: сохранённого участника, возможно, уже нет
  const feed = useActivity(who === 'all' ? null : who, kind === 'all' ? null : kind, !usersQuery.isPending)
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage } = feed

  const events = data?.pages.flatMap((p) => p.items) ?? []
  const groups = groupByDay(events)
  const usersById = new Map((users ?? []).map((u) => [u.id, u]))

  // Дозагрузка при прокрутке: следим за последней строкой. Наблюдатель создаётся заново после каждой страницы,
  // поэтому, если новая страница не заполнила экран, он сразу сработает ещё раз.
  const last = useRef<HTMLDivElement | null>(null)
  const pages = data?.pages.length ?? 0
  useEffect(() => {
    const el = last.current
    if (!el || !hasNextPage || isFetchingNextPage) return
    const watcher = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void fetchNextPage(), {
      rootMargin: `0px 0px ${LOAD_AHEAD_PX}px 0px`,
    })
    watcher.observe(el)
    return () => watcher.disconnect()
  }, [pages, hasNextPage, isFetchingNextPage, fetchNextPage])

  const lastGroup = groups[groups.length - 1]
  const filtered = who !== 'all' || kind !== 'all'

  return (
    <>
      <header className="head">
        <div className="head-l">
          <h1 className="h1">Активность</h1>
          <p className="sub">
            События команды: задачи, комментарии, код, документы, релизы и файлы. Всё, что ты делаешь на других страницах, появляется здесь.
          </p>
        </div>
      </header>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 24px' }}>
        <div role="group" aria-label="Участник" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip toggle on={who === 'all'} onClick={() => setWho('all')}>
            Все
          </Chip>
          {(users ?? []).map((u) => (
            <Chip key={u.id} toggle on={who === u.id} onClick={() => setWho(u.id)}>
              {u.name}
            </Chip>
          ))}
        </div>
        <div role="group" aria-label="Тип события" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {KIND_CHIPS.map(([value, label]) => (
            <Chip key={value} toggle on={kind === value} onClick={() => setKind(value)}>
              {label}
            </Chip>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 860 }}>
        {groups.map((g) => (
          <section key={g.day}>
            <h2 className="pop-title">{g.heading}</h2>
            <div className="sheet">
              {g.items.map((event, i) => (
                <Row
                  key={event.id}
                  event={event}
                  actor={usersById.get(event.actor_id)}
                  lastRef={g === lastGroup && i === g.items.length - 1 ? (el) => void (last.current = el) : undefined}
                />
              ))}
            </div>
          </section>
        ))}
        {feed.isError && (
          <EmptyState>
            Не удалось загрузить ленту
            <div style={{ marginTop: 12 }}>
              <Button onClick={() => void feed.refetch()}>Повторить</Button>
            </div>
          </EmptyState>
        )}
        {!feed.isError && (feed.isPending || usersQuery.isPending) && <EmptyState>Загружаю ленту…</EmptyState>}
        {data && groups.length === 0 && <EmptyState>{filtered ? 'Под такие фильтры событий нет' : 'Событий пока нет'}</EmptyState>}
        {isFetchingNextPage && (
          <span className="sr" role="status">
            Загружаю ещё события
          </span>
        )}
      </div>
    </>
  )
}
