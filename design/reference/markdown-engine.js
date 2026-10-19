// ===== Markdown в стиле Obsidian: разбор =====
const NOOP = () => { };
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/;
const BLOCK_START = /^(```|#{1,3}\s|\||>|(-{3,}|\*{3,})\s*$)/;
const startsBlock = (l) => BLOCK_START.test(l) || LIST_RE.test(l);
const rowsFor = (t) => Math.max(1, String(t || '').split('\n').reduce((a, l) => a + Math.max(1, Math.ceil(l.length / 78)), 0));
const CALLOUT = { note: 'Заметка', tip: 'Совет', warning: 'Важно', info: 'Информация', todo: 'Сделать', bug: 'Ошибка' };

// Делит строки на блоки {kind, start, end}; пустые строки только разделяют блоки
function mdBlocks(lines, off) {
  const out = []; const n = lines.length; let i = 0;
  while (i < n) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let j = i + 1; let kind = 'p';
    if (/^```/.test(l)) { kind = 'code'; while (j < n && !/^```/.test(lines[j])) j++; j = Math.min(n, j + 1); }
    else if (/^#{1,3}\s/.test(l)) kind = 'h' + l.match(/^#+/)[0].length;
    else if (/^(-{3,}|\*{3,})\s*$/.test(l)) kind = 'hr';
    else if (/^\|/.test(l)) { kind = 'table'; while (j < n && /^\|/.test(lines[j])) j++; }
    else if (/^>/.test(l)) { kind = 'quote'; while (j < n && /^>/.test(lines[j])) j++; }
    else if (LIST_RE.test(l)) { kind = 'list'; while (j < n && lines[j].trim() && LIST_RE.test(lines[j])) j++; }
    else { while (j < n && lines[j].trim() && !startsBlock(lines[j])) j++; }
    out.push({ kind, start: off + i, end: off + j });
    i = j;
  }
  return out;
}
const mdKindOf = (text) => (mdBlocks(text.split('\n'), 0)[0] || { kind: 'p' }).kind;

// Убирает пустые маркеры и лишние пустые строки после выхода из редактирования
const mdTidy = (md) => md
  .replace(/^(?:#{1,3}|[-*+]|\d+[.)]|>|[-*+]\s\[[ xX]\])[ \t]*$/gm, '')
  .replace(/[ \t]+$/gm, '')
  .replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '');

// Разбор строки на куски: **жирный**, *курсив*, ~~зачёркнутый~~, `код`, [[страница]], [текст](адрес), #тег
const INLINE_SRC = '\\*\\*[^*]+\\*\\*|~~[^~]+~~|\\*[^*\\s][^*]*\\*|`[^`]+`|\\[\\[[^\\]]+\\]\\]|\\[[^\\]]+\\]\\([^)\\s]+\\)|#[\\p{L}\\d_\\/-]+';
function mdInline(t) {
  const out = []; const re = new RegExp(INLINE_SRC, 'gu'); let last = 0; let m;
  while ((m = re.exec(t))) {
    const s = m[0]; const i = m.index;
    if (s[0] === '#' && i > 0 && !/\s/.test(t[i - 1])) continue;
    if (i > last) out.push({ t: t.slice(last, i), cls: '' });
    if (s.slice(0, 2) === '**') out.push({ t: s.slice(2, -2), cls: 'b' });
    else if (s.slice(0, 2) === '~~') out.push({ t: s.slice(2, -2), cls: 's' });
    else if (s.slice(0, 2) === '[[') { const body = s.slice(2, -2).split('|'); out.push({ t: (body[1] || body[0]).trim(), cls: 'wl', wiki: body[0].trim() }); }
    else if (s[0] === '*') out.push({ t: s.slice(1, -1), cls: 'i' });
    else if (s[0] === '`') out.push({ t: s.slice(1, -1), cls: 'c' });
    else if (s[0] === '[') { const k = s.indexOf(']('); out.push({ t: s.slice(1, k), cls: 'lk', url: s.slice(k + 2, -1) }); }
    else out.push({ t: s, cls: 'tg' });
    last = i + s.length;
  }
  if (last < t.length) out.push({ t: t.slice(last), cls: '' });
  if (!out.length) out.push({ t: ' ', cls: '' });
  return out;
}
const MD_BASE = {
  active: false, view: true, isText: false, cls: '', hasTitle: false, cTitle: '', lines: [], isList: false, items: [],
  isCode: false, code: '', lang: '', hasLang: false, isHr: false, isTable: false, cols: 1, cells: [],
  text: '', rows: 1, edit: NOOP, viewKey: NOOP, change: NOOP, keyDown: NOOP, blur: NOOP
};
const M = (...a) => a.join('\n');
