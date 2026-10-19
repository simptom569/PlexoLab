import { ICON_PATHS, type IconName } from './iconPaths'

type IconProps = { name: IconName; sm?: boolean }

export function Icon({ name, sm }: IconProps) {
  return (
    <svg className={sm ? 'ic sm' : 'ic'} viewBox="0 0 24 24" aria-hidden="true">
      {ICON_PATHS[name]}
    </svg>
  )
}
