import { describe, expect, it } from 'vitest'
import { addBlock, append, finish, insertBlock, keyAction, put, segments, split, toggleCheck, wrap, type Edit, type KeyInput } from './ops'

/** Нажатие клавиши в блоке `ed`; курсор по умолчанию в конце текста блока */
const press = (md: string, ed: Edit, key: string, o: Partial<KeyInput> = {}) => {
  const value = md.split('\n').slice(ed.start, ed.end).join('\n')
  const at = o.selStart ?? value.length
  return keyAction(md, ed, { key, shift: false, mod: false, value, selStart: at, selEnd: o.selEnd ?? at, ...o })
}

describe('put и split', () => {
  it('put заменяет строки активного блока и растягивает его', () => {
    expect(put('А\n\nБ', { start: 0, end: 1 }, 'А1\nА2', 3)).toEqual({
      md: 'А1\nА2\n\nБ',
      edit: { start: 0, end: 2 },
      caret: 3,
    })
  })

  it('split оставляет начало в блоке, а конец уносит в новый блок', () => {
    expect(split('Привет мир', { start: 0, end: 1 }, 'Привет', ' мир')).toEqual({
      md: 'Привет\n\n мир',
      edit: { start: 2, end: 3 },
      caret: 0,
    })
  })

  it('split между блоками ставит новый блок на место пустой строки-разделителя', () => {
    expect(split('А\n\nБ', { start: 0, end: 1 }, 'А', 'В').md).toBe('А\n\nВ\n\nБ')
    // пустой новый блок получает свои пустые строки вокруг
    expect(split('А\n\nБ', { start: 0, end: 1 }, 'А', '').md).toBe('А\n\n\n\nБ')
  })
})

describe('addBlock: «+» между блоками', () => {
  it('между блоками: пустой блок на месте разделителя, тот же текст, что у Enter в конце блока', () => {
    const step = addBlock('А\n\nБ', 1)
    expect(step).toEqual({ md: 'А\n\n\n\nБ', edit: { start: 2, end: 3 }, caret: 0 })
    expect(step.md).toBe(split('А\n\nБ', { start: 0, end: 1 }, 'А', '').md)
  })

  it('выше первого блока: пустой блок в самом начале', () => {
    expect(addBlock('А\n\nБ', null)).toEqual({ md: '\n\n\nА\n\nБ', edit: { start: 1, end: 2 }, caret: 0 })
  })

  it('под последним блоком: пустой блок в конце', () => {
    expect(addBlock('А\n\nБ', 3)).toEqual({ md: 'А\n\nБ\n\n', edit: { start: 4, end: 5 }, caret: 0 })
  })

  it('если промежуток шире (чужой пустой блок), новый блок встаёт сразу под верхним', () => {
    expect(addBlock('А\n\n\n\nБ', 1)).toEqual({ md: 'А\n\n\n\n\nБ', edit: { start: 2, end: 3 }, caret: 0 })
  })

  it('оставили пустым: после выхода текст такой же, как был', () => {
    for (const prevEnd of [null, 1, 3]) {
      const step = addBlock('А\n\nБ', prevEnd)
      expect(finish(step.md, step.edit).md, String(prevEnd)).toBe('А\n\nБ')
    }
  })

  it('написали текст: блок встал на своё место, лишних пустых строк нет', () => {
    const typed = (prevEnd: number | null, text: string) => {
      const step = addBlock('А\n\nБ', prevEnd)
      const put1 = put(step.md, step.edit!, text)
      return finish(put1.md, put1.edit).md
    }
    expect(typed(null, 'Новый')).toBe('Новый\n\nА\n\nБ')
    expect(typed(1, 'Новый')).toBe('А\n\nНовый\n\nБ')
    expect(typed(3, 'Новый')).toBe('А\n\nБ\n\nНовый')
  })

  it('открытый блок и промежуток рядом с ним: новый блок встаёт в промежуток, текст открытого не теряется', () => {
    const step = addBlock('А\n\nБ\n\nВ', 3)
    expect(step.md).toBe('А\n\nБ\n\n\n\nВ')
    expect(step.edit).toEqual({ start: 4, end: 5 })
  })
})

describe('append и insertBlock', () => {
  it('append в пустой документ открывает первую строку', () => {
    expect(append('')).toEqual({ md: '', edit: { start: 0, end: 1 }, caret: 0 })
  })

  it('append добавляет пустой блок после текста', () => {
    expect(append('Текст\n\n\n')).toEqual({ md: 'Текст\n\n\n\n', edit: { start: 2, end: 3 }, caret: 0 })
  })

  it('кнопка без активного блока вставляет блок в конец', () => {
    expect(insertBlock('Текст', null, '## ')).toEqual({ md: 'Текст\n\n## ', edit: { start: 2, end: 3 }, caret: 3 })
  })

  it('кнопка в пустом документе заменяет документ', () => {
    expect(insertBlock('', null, '- ')).toEqual({ md: '- ', edit: { start: 0, end: 1 }, caret: 2 })
    expect(insertBlock('', null, '```\n\n```', 4)).toEqual({ md: '```\n\n```', edit: { start: 0, end: 3 }, caret: 4 })
  })

  it('кнопка при пустом активном блоке пишет в него', () => {
    expect(insertBlock('А\n\n', { start: 2, end: 3 }, '> ')).toEqual({
      md: 'А\n\n> ',
      edit: { start: 2, end: 3 },
      caret: 2,
    })
  })

  it('кнопка при непустом активном блоке вставляет новый после него', () => {
    expect(insertBlock('А\n\nБ', { start: 0, end: 1 }, '# ')).toEqual({
      md: 'А\n\n# \n\nБ',
      edit: { start: 2, end: 3 },
      caret: 2,
    })
  })
})

describe('wrap и toggleCheck', () => {
  it('wrap оборачивает выделение и ставит курсор после закрывающего знака', () => {
    expect(wrap('Привет мир', 7, 10, '**', '**')).toEqual({ text: 'Привет **мир**', caret: 14 })
  })

  it('wrap без выделения вставляет «текст»', () => {
    expect(wrap('', 0, 0, '`', '`')).toEqual({ text: '`текст`', caret: 7 })
    expect(wrap('ab', 1, 1, '[[', ']]')).toEqual({ text: 'a[[текст]]b', caret: 10 })
  })

  it('toggleCheck переключает только указанную строку', () => {
    const md = '- [ ] А\n- [x] Б\n- [X] В'
    expect(toggleCheck(md, 0)).toBe('- [x] А\n- [x] Б\n- [X] В')
    expect(toggleCheck(md, 1)).toBe('- [ ] А\n- [ ] Б\n- [X] В')
    expect(toggleCheck(md, 2)).toBe('- [ ] А\n- [x] Б\n- [ ] В')
    expect(toggleCheck('Просто строка', 0)).toBe('Просто строка')
  })
})

describe('finish', () => {
  it('чистит текст вокруг блока и закрывает редактирование', () => {
    expect(finish('Текст\n\n-\n\n\n\n', { start: 2, end: 3 })).toEqual({ md: 'Текст', edit: null })
  })

  it('чужой пустой блок рядом с выходящим не стирается: Esc и Ctrl+Enter', () => {
    const md = 'А\n\n\n\nБ'
    expect(finish(md, { start: 0, end: 1 })).toEqual({ md, edit: null })
    expect(press(md, { start: 0, end: 1 }, 'Escape')!.step).toEqual({ md, edit: null })
    expect(press(md, { start: 4, end: 5 }, 'Enter', { mod: true })!.step).toEqual({ md, edit: null })
  })

  it('без активного блока ничего не чистит', () => {
    expect(finish('А\n\n\n\nБ', null)).toEqual({ md: 'А\n\n\n\nБ', edit: null })
  })
})

describe('segments', () => {
  it('без активного блока — обычные блоки', () => {
    const r = segments('# А\n\nБ', null)
    expect(r.segs.map((s) => [s.kind, s.start, s.end])).toEqual([['h1', 0, 1], ['p', 2, 3]])
  })

  it('активный блок стоит между блоками до и после него', () => {
    const r = segments('А\n\nБ\n\nВ', { start: 2, end: 3 })
    expect(r.segs.map((s) => [s.kind, s.start, s.end])).toEqual([['p', 0, 1], ['edit', 2, 3], ['p', 4, 5]])
  })

  it('активный блок за пределами текста отбрасывается', () => {
    const r = segments('А', { start: 5, end: 6 })
    expect(r.ed).toBeNull()
    expect(r.segs).toHaveLength(1)
  })

  it('пустой активный блок в конце виден как отдельный сегмент', () => {
    const r = segments('А\n\n', { start: 2, end: 3 })
    expect(r.segs.map((s) => s.kind)).toEqual(['p', 'edit'])
  })
})

describe('клавиши: Enter', () => {
  it('в абзаце новый блок получает текст после курсора', () => {
    const r = press('Привет мир', { start: 0, end: 1 }, 'Enter', { selStart: 6 })!
    expect(r.prevent).toBe(true)
    expect(r.step).toEqual({ md: 'Привет\n\n мир', edit: { start: 2, end: 3 }, caret: 0 })
  })

  it('в заголовке то же самое', () => {
    const r = press('# Заголовок', { start: 0, end: 1 }, 'Enter')!
    expect(r.step.md).toBe('# Заголовок\n\n')
    expect(r.step.edit).toEqual({ start: 2, end: 3 })
  })

  it('в списке продолжает список', () => {
    const r = press('- один', { start: 0, end: 1 }, 'Enter')!
    expect(r.step).toEqual({ md: '- один\n- ', edit: { start: 0, end: 2 }, caret: 9 })
  })

  it('в нумерованном списке увеличивает номер и сохраняет вид скобки', () => {
    expect(press('1. один', { start: 0, end: 1 }, 'Enter')!.step.md).toBe('1. один\n2. ')
    expect(press('9) девять', { start: 0, end: 1 }, 'Enter')!.step.md).toBe('9) девять\n10) ')
    expect(press('1. а\n  1. б', { start: 0, end: 2 }, 'Enter')!.step.md).toBe('1. а\n  1. б\n  2. ')
  })

  it('в списке задач новый пункт со снятой галочкой', () => {
    expect(press('- [x] сделано', { start: 0, end: 1 }, 'Enter')!.step.md).toBe('- [x] сделано\n- [ ] ')
  })

  it('курсор в середине пункта переносит остаток в новый пункт', () => {
    const r = press('- привет мир', { start: 0, end: 1 }, 'Enter', { selStart: 8 })!
    expect(r.step.md).toBe('- привет\n-  мир')
    expect(r.step.caret).toBe(11)
  })

  it('на пустом пункте выходит из списка', () => {
    const r = press('- один\n- ', { start: 0, end: 2 }, 'Enter')!
    expect(r.step).toEqual({ md: '- один\n\n', edit: { start: 2, end: 3 }, caret: 0 })
  })

  it('на единственном пустом пункте список заменяется пустым блоком', () => {
    const r = press('- ', { start: 0, end: 1 }, 'Enter')!
    expect(r.step.md).toBe('\n\n')
  })

  it('в таблице добавляет строку с тем же числом столбцов', () => {
    const r = press('| a | b |\n| --- | --- |\n| 1 | 2 |', { start: 0, end: 3 }, 'Enter')!
    expect(r.step.md).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |\n|  |  |')
    expect(r.step.caret).toBe(r.step.md.length - '|  |  |'.length + 2)
  })

  it('на пустой строке таблицы выходит из таблицы', () => {
    const r = press('| a | b |\n|  |  |', { start: 0, end: 2 }, 'Enter')!
    expect(r.step.md).toBe('| a | b |\n\n')
    expect(r.step.edit).toEqual({ start: 2, end: 3 })
  })

  it('в блоке кода ставит обычный перенос (отдаёт клавишу браузеру)', () => {
    expect(press('```\nкод', { start: 0, end: 2 }, 'Enter')).toBeNull()
    expect(press('```\nкод\n```', { start: 0, end: 3 }, 'Enter', { selStart: 3 })).toBeNull()
  })

  it('после закрывающих кавычек блока кода создаёт новый блок', () => {
    const r = press('```\nкод\n```', { start: 0, end: 3 }, 'Enter')!
    expect(r.prevent).toBe(true)
    expect(r.step).toEqual({ md: '```\nкод\n```\n\n', edit: { start: 4, end: 5 }, caret: 0 })
  })

  it('Shift+Enter в цитате продолжает цитату', () => {
    const r = press('> строка', { start: 0, end: 1 }, 'Enter', { shift: true })!
    expect(r.step).toEqual({ md: '> строка\n> ', edit: { start: 0, end: 2 }, caret: 11 })
  })

  it('Shift+Enter вне цитаты — обычный перенос браузера', () => {
    expect(press('Абзац', { start: 0, end: 1 }, 'Enter', { shift: true })).toBeNull()
    expect(press('- пункт', { start: 0, end: 1 }, 'Enter', { shift: true })).toBeNull()
  })
})

describe('клавиши: Backspace и стрелки', () => {
  it('Backspace на пустом блоке удаляет его и открывает предыдущий', () => {
    const r = press('Раз\n\n', { start: 2, end: 3 }, 'Backspace')!
    expect(r.prevent).toBe(true)
    expect(r.step).toEqual({ md: 'Раз\n', edit: { start: 0, end: 1 }, caret: null })
  })

  it('Backspace на единственном пустом блоке закрывает редактирование', () => {
    const r = press('', { start: 0, end: 1 }, 'Backspace')!
    expect(r.step).toEqual({ md: '', edit: null })
  })

  it('Backspace на непустом блоке — обычное стирание', () => {
    expect(press('Раз', { start: 0, end: 1 }, 'Backspace')).toBeNull()
  })

  it('стрелка вверх в начале блока уходит в предыдущий блок', () => {
    const r = press('Раз\n\nДва', { start: 2, end: 3 }, 'ArrowUp', { selStart: 0 })!
    expect(r.prevent).toBe(true)
    expect(r.step).toEqual({ md: 'Раз\n\nДва', edit: { start: 0, end: 1 }, caret: null })
  })

  it('стрелка вверх не в начале, при выделении или у первого блока — браузеру', () => {
    expect(press('Раз\n\nДва', { start: 2, end: 3 }, 'ArrowUp', { selStart: 1 })).toBeNull()
    expect(press('Раз\n\nДва', { start: 2, end: 3 }, 'ArrowUp', { selStart: 0, selEnd: 2 })).toBeNull()
    expect(press('Раз\n\nДва', { start: 0, end: 1 }, 'ArrowUp', { selStart: 0 })).toBeNull()
  })

  it('стрелка вниз в конце блока уходит в следующий блок, курсор в начало', () => {
    const r = press('Раз\n\nДва', { start: 0, end: 1 }, 'ArrowDown')!
    expect(r.prevent).toBe(true)
    expect(r.step).toEqual({ md: 'Раз\n\nДва', edit: { start: 2, end: 3 }, caret: 0 })
  })

  it('стрелка вниз не в конце или у последнего блока — браузеру', () => {
    expect(press('Раз\n\nДва', { start: 0, end: 1 }, 'ArrowDown', { selStart: 1 })).toBeNull()
    expect(press('Раз\n\nДва', { start: 2, end: 3 }, 'ArrowDown')).toBeNull()
  })
})

describe('клавиши: Tab, форматирование, выход', () => {
  it('Tab в списке сдвигает пункт, Shift+Tab возвращает', () => {
    const r = press('- один\n- два', { start: 0, end: 2 }, 'Tab')!
    expect(r.prevent).toBe(true)
    expect(r.step.md).toBe('- один\n  - два')
    expect(r.step.caret).toBe(14)
    const back = press('- один\n  - два', { start: 0, end: 2 }, 'Tab', { shift: true })!
    expect(back.step.md).toBe('- один\n- два')
  })

  it('Tab сдвигает ту строку, где курсор', () => {
    const r = press('- один\n- два', { start: 0, end: 2 }, 'Tab', { selStart: 2 })!
    expect(r.step.md).toBe('  - один\n- два')
  })

  it('Shift+Tab убирает отступ в одну табуляцию или в один-два пробела', () => {
    expect(press('\t- а', { start: 0, end: 1 }, 'Tab', { shift: true })!.step.md).toBe('- а')
    expect(press(' - а', { start: 0, end: 1 }, 'Tab', { shift: true })!.step.md).toBe('- а')
    expect(press('- а', { start: 0, end: 1 }, 'Tab', { shift: true })!.step.md).toBe('- а')
  })

  it('Tab вне списка — обычный переход фокуса', () => {
    expect(press('Абзац', { start: 0, end: 1 }, 'Tab')).toBeNull()
  })

  it('Ctrl+B и Ctrl+I оборачивают выделение', () => {
    const b = press('Привет мир', { start: 0, end: 1 }, 'b', { mod: true, selStart: 7, selEnd: 10 })!
    expect(b.step).toMatchObject({ md: 'Привет **мир**', caret: 14 })
    const i = press('Привет мир', { start: 0, end: 1 }, 'I', { mod: true, selStart: 0, selEnd: 6 })!
    expect(i.step).toMatchObject({ md: '*Привет* мир', caret: 8 })
  })

  it('Esc и Ctrl+Enter завершают редактирование с очисткой', () => {
    for (const o of [{ key: 'Escape' }, { key: 'Enter', mod: true }]) {
      const r = press('Текст\n\n-', { start: 2, end: 3 }, o.key, { mod: o.mod ?? false })!
      expect(r.prevent).toBe(true)
      expect(r.step).toEqual({ md: 'Текст', edit: null })
    }
  })

  it('обычные буквы клавиатура не трогает', () => {
    expect(press('Абзац', { start: 0, end: 1 }, 'a')).toBeNull()
    expect(press('Абзац', { start: 0, end: 1 }, 'ArrowLeft')).toBeNull()
  })
})
