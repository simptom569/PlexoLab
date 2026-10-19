import type { ComponentProps } from 'react'
import { cx } from '../lib/cx'

/** Пустое состояние с пунктирной рамкой (.empty) */
export function EmptyState({ className, ...rest }: ComponentProps<'div'>) {
  return <div className={cx('empty', className)} {...rest} />
}

/** Карточка-панель (.panel) */
export function Panel({ className, ...rest }: ComponentProps<'section'>) {
  return <section className={cx('panel', className)} {...rest} />
}
