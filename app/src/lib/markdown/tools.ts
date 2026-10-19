// Кнопки панели форматирования (vEditor в макете). Вставляющие кнопки добавляют новый блок, оборачивающие — берут выделение.

export type Tool =
  | { label: string; title: string; kind: 'insert'; text: string; caret?: number; sep?: boolean }
  | { label: string; title: string; kind: 'wrap'; before: string; after: string; sep?: boolean }

export const TOOLS: Tool[] = [
  { label: 'H1', title: 'Заголовок 1', kind: 'insert', text: '# ' },
  { label: 'H2', title: 'Заголовок 2', kind: 'insert', text: '## ', sep: true },
  { label: 'B', title: 'Жирный (Ctrl+B)', kind: 'wrap', before: '**', after: '**' },
  { label: 'I', title: 'Курсив (Ctrl+I)', kind: 'wrap', before: '*', after: '*' },
  { label: 'S', title: 'Зачёркнутый', kind: 'wrap', before: '~~', after: '~~' },
  { label: '</>', title: 'Код в строке', kind: 'wrap', before: '`', after: '`' },
  { label: '[[ ]]', title: 'Ссылка на страницу вики', kind: 'wrap', before: '[[', after: ']]', sep: true },
  { label: '•', title: 'Маркированный список', kind: 'insert', text: '- ' },
  { label: '1.', title: 'Нумерованный список', kind: 'insert', text: '1. ' },
  { label: '☐', title: 'Список задач', kind: 'insert', text: '- [ ] ' },
  { label: '“', title: 'Цитата', kind: 'insert', text: '> ' },
  { label: '!', title: 'Выноска', kind: 'insert', text: '> [!note] Заметка\n> ', sep: true },
  { label: '{ }', title: 'Блок кода', kind: 'insert', text: '```\n\n```', caret: 4 },
  {
    label: '▦',
    title: 'Таблица',
    kind: 'insert',
    text: '| Колонка 1 | Колонка 2 | Колонка 3 |\n| --- | --- | --- |\n|  |  |  |',
    caret: 2,
  },
]

/** Подписи этих кнопок набраны моноширинным шрифтом (класс `mono`) */
export const isMonoTool = (label: string) => /^[A-Z[<{]/.test(label)
