import { describe, expect, it } from 'vitest'
import { mdBlocks, mdInline, mdKindOf, mdTidy, mdTidyBlock, rowsFor } from './engine'

const blocks = (md: string) => mdBlocks(md.split('\n'), 0).map((b) => [b.kind, b.start, b.end])

describe('mdBlocks', () => {
  it('делит текст на блоки по пустым строкам', () => {
    expect(blocks('Раз\nдва\n\nТри')).toEqual([['p', 0, 2], ['p', 3, 4]])
  })

  it('несколько пустых строк подряд только разделяют', () => {
    expect(blocks('А\n\n\n\nБ')).toEqual([['p', 0, 1], ['p', 4, 5]])
    expect(blocks('')).toEqual([])
    expect(blocks('\n\n')).toEqual([])
  })

  it('заголовки бывают трёх уровней, четвёртый уровень — абзац', () => {
    expect(blocks('# А\n## Б\n### В\n#### Г')).toEqual([['h1', 0, 1], ['h2', 1, 2], ['h3', 2, 3], ['p', 3, 4]])
    expect(blocks('#без пробела')).toEqual([['p', 0, 1]])
  })

  it('абзац обрывается там, где начинается другой блок', () => {
    expect(blocks('Текст\n- пункт')).toEqual([['p', 0, 1], ['list', 1, 2]])
    expect(blocks('Текст\n## Заголовок')).toEqual([['p', 0, 1], ['h2', 1, 2]])
    expect(blocks('Текст\n> цитата')).toEqual([['p', 0, 1], ['quote', 1, 2]])
    expect(blocks('Текст\n| a |')).toEqual([['p', 0, 1], ['table', 1, 2]])
    expect(blocks('Текст\n```\nкод\n```')).toEqual([['p', 0, 1], ['code', 1, 4]])
    expect(blocks('Текст\n---')).toEqual([['p', 0, 1], ['hr', 1, 2]])
  })

  it('список объединяет подряд идущие пункты любого вида', () => {
    expect(blocks('- а\n  - вложенный\n1. номер\n- [ ] задача\n\n- новый')).toEqual([['list', 0, 4], ['list', 5, 6]])
    expect(blocks('* звёздочка\n+ плюс\n2) скобка')).toEqual([['list', 0, 3]])
  })

  it('блок кода идёт до закрывающих кавычек, незакрытый — до конца текста', () => {
    expect(blocks('```bash\nmake\n\nrelease\n```\nпосле')).toEqual([['code', 0, 5], ['p', 5, 6]])
    expect(blocks('```\nбез конца\nещё')).toEqual([['code', 0, 3]])
    expect(blocks('```\n```')).toEqual([['code', 0, 2]])
  })

  it('таблица и цитата берут все подряд идущие строки с их маркером', () => {
    expect(blocks('| a | b |\n| --- | --- |\n| 1 | 2 |\nтекст')).toEqual([['table', 0, 3], ['p', 3, 4]])
    expect(blocks('> [!tip] Совет\n> строка\nтекст')).toEqual([['quote', 0, 2], ['p', 2, 3]])
  })

  it('разделитель: три и больше дефисов или звёздочек', () => {
    expect(blocks('---\n-----\n***\n--')).toEqual([['hr', 0, 1], ['hr', 1, 2], ['hr', 2, 3], ['p', 3, 4]])
  })

  it('смещение прибавляется к номерам строк', () => {
    expect(mdBlocks(['А', '', 'Б'], 10)).toEqual([{ kind: 'p', start: 10, end: 11 }, { kind: 'p', start: 12, end: 13 }])
  })

  it('разбирает страницу «Соглашения по коду» из макета', () => {
    const md = [
      'Короткие правила, чтобы историю репозитория было приятно читать.',
      '',
      '## Имена веток',
      '',
      '```',
      'feature/WEB-144-sso-login',
      'chore/update-deps',
      '```',
      '',
      '## Коммиты',
      '',
      '| Тип | Когда использовать | Пример |',
      '| --- | --- | --- |',
      '| feat | Новая функциональность | feat: вход через SSO |',
      '',
      '## Ревью',
      '',
      '- Не больше 400 строк в одном PR',
      '- Отвечаем на ревью в течение рабочего дня',
    ].join('\n')
    expect(blocks(md).map((b) => b[0])).toEqual(['p', 'h2', 'code', 'h2', 'table', 'h2', 'list'])
  })
})

describe('mdKindOf', () => {
  it('берёт тип первого блока', () => {
    expect(mdKindOf('# Заголовок')).toBe('h1')
    expect(mdKindOf('- [ ] задача')).toBe('list')
    expect(mdKindOf('> [!note] Заметка\n> текст')).toBe('quote')
    expect(mdKindOf('```\n\n```')).toBe('code')
  })

  it('пустой текст — абзац', () => {
    expect(mdKindOf('')).toBe('p')
    expect(mdKindOf('\n\n')).toBe('p')
  })
})

describe('mdTidy', () => {
  it('убирает пустые маркеры', () => {
    expect(mdTidy('Текст\n\n-\n\n#\n\n##\n\n>\n\n1.\n\n- [ ]\n\n* [x]')).toBe('Текст')
    expect(mdTidy('- пункт\n-')).toBe('- пункт')
  })

  it('маркер с текстом остаётся', () => {
    expect(mdTidy('# Заголовок\n- пункт\n> цитата\n1. один')).toBe('# Заголовок\n- пункт\n> цитата\n1. один')
  })

  it('убирает пробелы в конце строк', () => {
    expect(mdTidy('Строка   \nещё\t')).toBe('Строка\nещё')
  })

  it('схлопывает лишние пустые строки и обрезает края', () => {
    expect(mdTidy('\n\nА\n\n\n\nБ\n\n\n')).toBe('А\n\nБ')
  })

  it('маркер с пробелами после него тоже пустой', () => {
    expect(mdTidy('А\n\n-   \n\nБ')).toBe('А\n\nБ')
  })

  it('пустой текст остаётся пустым', () => {
    expect(mdTidy('')).toBe('')
    expect(mdTidy('\n\n  \n')).toBe('')
  })
})

// Очистка при выходе из блока идёт только вокруг него: чужой пустой блок или свежий маркер, которые другой человек только
// что вставил (они лежат в общем тексте), не должны пропадать, иначе у него закрывается редактор и слетает фокус.
describe('mdTidyBlock', () => {
  it('убирает пустой маркер в своём блоке и схлопывает пустоту вокруг', () => {
    expect(mdTidyBlock('Текст\n\n-\n\nДругой', 2, 3)).toBe('Текст\n\nДругой')
    expect(mdTidyBlock('А\n\n\n\nБ', 2, 3)).toBe('А\n\nБ')
  })

  it('чужой пустой блок рядом не трогается, с какой стороны ни выходить', () => {
    const md = 'А\n\n\n\nБ'
    expect(mdTidyBlock(md, 0, 1)).toBe(md)
    expect(mdTidyBlock(md, 4, 5)).toBe(md)
  })

  it('чужой свежий маркер рядом не стирается', () => {
    expect(mdTidyBlock('А\n\n-\n\nБ', 0, 1)).toBe('А\n\n-\n\nБ')
    expect(mdTidyBlock('А\n\n## \n\nБ', 4, 5)).toBe('А\n\n## \n\nБ')
  })

  it('пробелы в конце строк убираются только в своём блоке', () => {
    expect(mdTidyBlock('А   \n\nБ   ', 2, 3)).toBe('А   \n\nБ')
  })

  it('блок без пустоты по краям ничего вокруг себя не меняет', () => {
    expect(mdTidyBlock('А\n\nБ\n\nВ', 2, 3)).toBe('А\n\nБ\n\nВ')
  })

  it('лишний Enter в конце блока схлопывается', () => {
    expect(mdTidyBlock('А\n\nБ\n\n\nВ', 2, 4)).toBe('А\n\nБ\n\nВ')
  })

  it('пустой блок в конце и в начале текста уходит совсем', () => {
    expect(mdTidyBlock('А\n\n\n', 2, 3)).toBe('А')
    expect(mdTidyBlock('\n\nА', 0, 1)).toBe('А')
    expect(mdTidyBlock('\n\n', 0, 1)).toBe('')
  })

  it('одна пустая строка в конце или начале текста — остаток после удаления соседнего блока, она убирается', () => {
    expect(mdTidyBlock('Раз\n', 0, 1)).toBe('Раз')
    expect(mdTidyBlock('\nДва', 1, 2)).toBe('Два')
  })

  it('две пустые строки в конце — чужой пустой блок, он остаётся', () => {
    expect(mdTidyBlock('Текст\n\n', 0, 1)).toBe('Текст\n\n')
  })

  it('блок за пределами текста ничего не меняет', () => {
    expect(mdTidyBlock('А\n\n', 5, 6)).toBe('А\n\n')
  })

  it('блок на весь текст даёт то же, что mdTidy на любых строках', () => {
    // случайные тексты из строк, на которых mdTidy что-то делает: пустые, маркеры, пробелы, обычный текст
    const alphabet = ['а', '', '', '-', '#', '>', '1.', '  ', '- [ ]', '- б', 'в  ']
    let seed = 7
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296
    }
    for (let n = 0; n < 500; n++) {
      const lines = Array.from({ length: Math.floor(rand() * 10) }, () => alphabet[Math.floor(rand() * alphabet.length)])
      const md = lines.join('\n')
      expect(mdTidyBlock(md, 0, lines.length), JSON.stringify(md)).toBe(mdTidy(md))
    }
  })
})

describe('mdInline', () => {
  it('простой текст — один кусок', () => {
    expect(mdInline('просто текст')).toEqual([{ t: 'просто текст', cls: '' }])
  })

  it('пустая строка даёт неразрывный пробел, чтобы строка не схлопнулась', () => {
    expect(mdInline('')).toEqual([{ t: '\u00a0', cls: '' }])
  })

  it('жирный, курсив, зачёркнутый и код', () => {
    expect(mdInline('а **жирный** б *курсив* в ~~зачёркнутый~~ г `код`')).toEqual([
      { t: 'а ', cls: '' },
      { t: 'жирный', cls: 'b' },
      { t: ' б ', cls: '' },
      { t: 'курсив', cls: 'i' },
      { t: ' в ', cls: '' },
      { t: 'зачёркнутый', cls: 's' },
      { t: ' г ', cls: '' },
      { t: 'код', cls: 'c' },
    ])
  })

  it('звёздочка с пробелом после неё курсивом не считается', () => {
    expect(mdInline('2 * 3 * 4')).toEqual([{ t: '2 * 3 * 4', cls: '' }])
  })

  it('ссылка на страницу вики и ссылка с подписью', () => {
    expect(mdInline('см. [[Соглашения по коду]]')).toEqual([
      { t: 'см. ', cls: '' },
      { t: 'Соглашения по коду', cls: 'wl', wiki: 'Соглашения по коду' },
    ])
    expect(mdInline('[[ Деплой | на выкатку ]]')).toEqual([{ t: 'на выкатку', cls: 'wl', wiki: 'Деплой' }])
  })

  it('внешняя ссылка', () => {
    expect(mdInline('вот [так](https://example.com)!')).toEqual([
      { t: 'вот ', cls: '' },
      { t: 'так', cls: 'lk', url: 'https://example.com' },
      { t: '!', cls: '' },
    ])
  })

  it('тег — только после пробела или в начале строки', () => {
    expect(mdInline('#тег и #ещё_один')).toEqual([
      { t: '#тег', cls: 'tg' },
      { t: ' и ', cls: '' },
      { t: '#ещё_один', cls: 'tg' },
    ])
    expect(mdInline('слово#нетег')).toEqual([{ t: 'слово#нетег', cls: '' }])
    expect(mdInline('ветка #feature/WEB-1 живёт')).toEqual([
      { t: 'ветка ', cls: '' },
      { t: '#feature/WEB-1', cls: 'tg' },
      { t: ' живёт', cls: '' },
    ])
  })

  it('разбирает строку из страницы «Начало работы»', () => {
    const runs = mdInline('Выделяй **жирным**, *курсивом* и `кодом`, ставь #теги, ссылайся на страницы двойными скобками.')
    expect(runs.map((r) => r.cls)).toEqual(['', 'b', '', 'i', '', 'c', '', 'tg', ''])
  })

  it('незакрытая разметка остаётся текстом', () => {
    expect(mdInline('**не закрыто')).toEqual([{ t: '**не закрыто', cls: '' }])
    expect(mdInline('`не закрыто')).toEqual([{ t: '`не закрыто', cls: '' }])
    expect(mdInline('[[нет скобок')).toEqual([{ t: '[[нет скобок', cls: '' }])
  })
})

describe('rowsFor', () => {
  it('минимум одна строка', () => {
    expect(rowsFor('')).toBe(1)
    expect(rowsFor('коротко')).toBe(1)
  })

  it('считает переносы и длинные строки по 78 знаков', () => {
    expect(rowsFor('а\nб\nв')).toBe(3)
    expect(rowsFor('а'.repeat(78))).toBe(1)
    expect(rowsFor('а'.repeat(79))).toBe(2)
    expect(rowsFor(`${'а'.repeat(160)}\nб`)).toBe(4)
  })
})
