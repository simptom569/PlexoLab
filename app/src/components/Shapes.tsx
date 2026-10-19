/** Цветная точка 8×8 (.dot): цвет колонки, статус */
export function Dot({ color }: { color: string }) {
  return <span className="dot" style={{ background: color }} />
}

/** Цветной квадрат 10×10 (.sq): цвет проекта */
export function Sq({ color }: { color: string }) {
  return <span className="sq" style={{ background: color }} />
}
