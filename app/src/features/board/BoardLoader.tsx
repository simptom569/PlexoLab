import type { ReactNode } from 'react'
import { Button, EmptyState } from '../../components'
import { BoardProvider } from './BoardProvider'
import { useBoardModel } from './model'

/**
 * Загружает данные проекта (доска, бэклог, модули и вехи лежат в одном ответе сервера) и даёт экрану модель и мутации.
 * `what`: как назвать загружаемое в сообщениях («доску», «бэклог», «модули»).
 */
export function BoardLoader({ projectId, what, children }: { projectId: string; what: string; children: ReactNode }) {
  const loaded = useBoardModel(projectId)
  if (loaded.status === 'loading') return <EmptyState>{`Загружаю ${what}…`}</EmptyState>
  if (loaded.status === 'error') {
    return (
      <EmptyState>
        {`Не удалось загрузить ${what}`}
        <div style={{ marginTop: 12 }}>
          <Button onClick={loaded.retry}>Повторить</Button>
        </div>
      </EmptyState>
    )
  }
  return <BoardProvider model={loaded.model}>{children}</BoardProvider>
}
