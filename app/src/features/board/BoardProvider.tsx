import { useMemo, type ReactNode } from 'react'
import { BoardContext, type BoardModel } from './model'
import { useBoardMutations } from './mutations'

/** Даёт экранам доски модель и мутации через useModel и useMutations */
export function BoardProvider({ model, children }: { model: BoardModel; children: ReactNode }) {
  const mutations = useBoardMutations(model.projectId)
  const value = useMemo(() => ({ model, mutations }), [model, mutations])
  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>
}
