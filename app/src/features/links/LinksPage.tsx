import { useState, type MouseEvent } from 'react'
import { Button, ConfirmDelete, EmptyState, Icon, IconButton, Input, TitleInput } from '../../components'
import { useLinkGroups } from '../../lib/api/queries'
import type { LinkGroup, LinkItem } from '../../lib/api/types'
import { openExternal } from '../../lib/platform/opener'
import { useDraftField } from '../../lib/useDraft'
import { hostOf, normalizeUrl } from './logic'
import { useLinkMutations, type LinkMutations } from './mutations'

/**
 * Внешняя ссылка открывается в системном браузере, а не внутри окна приложения. Адрес остаётся в `href`
 * (виден при наведении, копируется), но переход перехватывается; средняя кнопка и Ctrl+клик ведут туда же.
 */
function openInBrowser(url: string) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.type === 'auxclick' && e.button !== 1) return
    e.preventDefault()
    void openExternal(url)
  }
}

/** Карточка ссылки (.link-card) */
function LinkCard({ link, mutations }: { link: LinkItem; mutations: LinkMutations }) {
  const open = openInBrowser(link.url)
  return (
    <div className="link-card">
      <a className="link-main" href={link.url} target="_blank" rel="noopener noreferrer" onClick={open} onAuxClick={open}>
        <span className="ft" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
          <Icon name="link" />
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 2 }}>
          <strong>{link.title}</strong>
          <span className="mono" style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {hostOf(link.url)}
          </span>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{link.description}</span>
        </span>
      </a>
      <IconButton icon="close" small label={`Удалить ссылку ${link.title}`} onClick={() => mutations.deleteLink.mutate({ id: link.id })} />
    </div>
  )
}

/** Пунктирная плитка «Добавить ссылку» (.link-add) */
function NewLink({ group, mutations }: { group: LinkGroup; mutations: LinkMutations }) {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const add = () => {
    const name = title.trim()
    const address = normalizeUrl(url)
    if (!name || !address) return
    mutations.createLink.mutate({ groupId: group.id, title: name, url: address })
    setTitle('')
    setUrl('')
  }
  const onKeyDown = (e: { key: string }) => {
    if (e.key === 'Enter') add()
  }
  return (
    <div className="link-add">
      <Input placeholder="Название ссылки" aria-label="Название новой ссылки" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={onKeyDown} />
      <Input
        placeholder="Адрес, например example.com/repo"
        aria-label="Адрес новой ссылки"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <Button style={{ alignSelf: 'flex-start' }} onClick={add}>
        Добавить ссылку
      </Button>
    </div>
  )
}

function GroupSection({ group, mutations }: { group: LinkGroup; mutations: LinkMutations }) {
  const title = useDraftField(group.title, (next) => mutations.renameGroup.mutate({ id: group.id, title: next }))
  return (
    <section aria-label={group.title}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, maxWidth: 520 }}>
        <TitleInput style={{ fontSize: 16 }} aria-label="Название группы" {...title} />
        <ConfirmDelete confirmKey={`lg:${group.id}`} onConfirm={() => mutations.deleteGroup.mutate({ id: group.id })} />
      </div>
      <div className="cards-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(270px,1fr))' }}>
        {group.links.map((link) => (
          <LinkCard key={link.id} link={link} mutations={mutations} />
        ))}
        <NewLink group={group} mutations={mutations} />
      </div>
    </section>
  )
}

export function LinksPage() {
  const groups = useLinkGroups()
  const mutations = useLinkMutations()
  const [draft, setDraft] = useState('')
  const addGroup = () => {
    const title = draft.trim()
    if (!title) return
    mutations.createGroup.mutate({ title })
    setDraft('')
  }

  return (
    <>
      <header className="head">
        <div className="head-l">
          <h1 className="h1">Ссылки команды</h1>
          <p className="sub">Всё, что нужно под рукой: репозитории, мониторинг, дизайн, окружения. Адреса в макете условные.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Input
            style={{ width: 220 }}
            placeholder="Название новой группы"
            aria-label="Название новой группы"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addGroup()
            }}
          />
          <Button variant="primary" onClick={addGroup}>
            Группа
          </Button>
        </div>
      </header>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {groups.data?.map((group) => <GroupSection key={group.id} group={group} mutations={mutations} />)}
        {groups.isError && (
          <EmptyState>
            Не удалось загрузить ссылки
            <div style={{ marginTop: 12 }}>
              <Button onClick={() => void groups.refetch()}>Повторить</Button>
            </div>
          </EmptyState>
        )}
        {!groups.isError && !groups.data && <EmptyState>Загружаю ссылки…</EmptyState>}
        {groups.data?.length === 0 && <EmptyState>Групп пока нет. Создай первую справа вверху</EmptyState>}
      </div>
    </>
  )
}
