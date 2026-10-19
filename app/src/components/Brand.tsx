import icon from '../assets/icon.png'
import { Icon } from './Icon'

/** Иконка приложения 32×32 (файл app/src/assets/icon.png, его можно заменить) */
export function BrandIcon() {
  return <img src={icon} alt="" width={32} height={32} style={{ borderRadius: 10, objectFit: 'contain', flex: 'none' }} />
}

/** Пунктирная заглушка из макета: место под иконку, пока файла иконки нет */
export function BrandSlot() {
  return (
    <span className="brand-slot" role="img" aria-label="Место под иконку приложения" title="Место под иконку приложения (32×32)">
      <Icon name="image" sm />
    </span>
  )
}
