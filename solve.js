// SiteForge — a fast drop-in for the reference site generator, version 1.0.0.
//
// The same build, the same answers, byte for byte, but quicker: plain-text runs
// are moved in bulk instead of one escaped character at a time, the Markdown
// reader works from character tests instead of a regex per line, slugs are
// cached, and every template is compiled once into a small function that
// renders straight into a string. Written from the reference generator's documented
// rules; no part of the reference program is copied.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/g;
const ESC_TEST = /[&<>"']/;

/** `text` with & < > " and ' escaped. */
function esc(text) {
  return ESC_TEST.test(text) ? text.replace(ESC_RE, (c) => ESCAPES[c]) : text;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A YYYY-MM-DD date in words, from the string alone. */
function longDate(date) {
  const y = date.slice(0, 4);
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const slugCache = new Map();

/**
 * The slug of `text`: NFKD, combining marks dropped, A-Z lowered, every run of
 * characters other than a-z and 0-9 one "-", none at either end, at most 64
 * characters (a "-" left at the cut dropped), "untitled" when nothing is left.
 * Pure ASCII text skips the normalisation: NFKD leaves it unchanged and it
 * holds no combining marks.
 */
function slugify(text) {
  const hit = slugCache.get(text);
  if (hit !== undefined) return hit;
  let plain = text;
  let ascii = true;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) { ascii = false; break; }
  }
  if (!ascii) plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';
  let gap = false;
  for (let i = 0; i < plain.length; i++) {
    const ch = plain[i];
    let keep = '';
    if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
    if (keep === '') { gap = out.length > 0; continue; }
    if (gap) out += '-';
    gap = false;
    out += keep;
  }
  out = out.slice(0, 64).replace(/-+$/, '');
  const slug = out === '' ? 'untitled' : out;
  if (slugCache.size < 50000) slugCache.set(text, slug);
  return slug;
}

/** `slug` made unique against `taken` (and added to it): slug, slug-2, slug-3 ... */
function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

/** Code-unit order (never the locale's). */
function byCodeUnits(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------- front matter

const FM_KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];

function isKeyChar(c) {
  return (c >= 'a' && c <= 'z') || c === '_';
}
function isNameChar(c) {
  return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '-';
}
function isDigit(c) {
  return c >= '0' && c <= '9';
}

/** A string value: "..." with \" and \\ its only escapes, or a bare line. */
function stringValue(raw, key) {
  if (raw[0] === '"') {
    if (raw.length < 2 || raw[raw.length - 1] !== '"') return { error: `key "${key}": a quoted string is not closed` };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) {
          return { error: `key "${key}": a quoted string holds an escape other than \\" or \\\\` };
        }
        out += n;
        i++;
      } else if (c === '"') {
        return { error: `key "${key}": a quoted string holds a stray quote` };
      } else out += c;
    }
    return { value: out };
  }
  if (raw[0] === '[') return { error: `key "${key}": a bare string opens on [` };
  return { value: raw };
}

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** One key's value, or why it is refused. */
function keyValue(key, raw) {
  switch (key) {
    case 'title':
    case 'summary':
      return stringValue(raw, key);
    case 'date': {
      let ok = raw.length === 10 && raw[4] === '-' && raw[7] === '-';
      if (ok) {
        for (let i = 0; i < 10; i++) {
          if (i === 4 || i === 7) continue;
          if (!isDigit(raw[i])) { ok = false; break; }
        }
      }
      const y = ok ? Number(raw.slice(0, 4)) : 0;
      const mo = ok ? Number(raw.slice(5, 7)) : 0;
      const d = ok ? Number(raw.slice(8, 10)) : 0;
      if (!ok || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) {
        return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      }
      return { value: raw };
    }
    case 'tags': {
      if (raw[0] !== '[' || raw[raw.length - 1] !== ']') return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      for (const t of tags) {
        if (t === '') return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
        for (let i = 0; i < t.length; i++) {
          const c = t[i];
          if (c === '"' || c === '[' || c === ']') return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
        }
      }
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout': {
      if (raw.length === 0) return { error: 'key "layout": not a template name' };
      for (let i = 0; i < raw.length; i++) if (!isNameChar(raw[i])) return { error: 'key "layout": not a template name' };
      return { value: raw };
    }
    case 'slug': {
      if (raw.length === 0 || raw.length > 64) return { error: 'key "slug": not a slug' };
      let prevDash = true;
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (c === '-') {
          if (prevDash) return { error: 'key "slug": not a slug' };
          prevDash = true;
        } else if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
          prevDash = false;
        } else return { error: 'key "slug": not a slug' };
      }
      if (prevDash) return { error: 'key "slug": not a slug' };
      return { value: raw };
    }
    default:
      return { error: `unknown key "${key}"` };
  }
}

function isBlankLine(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c !== ' ' && c !== '\t') return false;
  }
  return true;
}

function stripTrailing(line) {
  let end = line.length;
  while (end > 0 && (line[end - 1] === ' ' || line[end - 1] === '\t')) end--;
  return line.slice(0, end);
}

/**
 * A source's front matter and the index of its first body line in `lines`,
 * or { error } with the first reason it is refused.
 */
function parseFrontMatter(lines) {
  if (lines[0] !== '---') return { error: 'no front matter' };
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { close = i; break; }
  }
  if (close === -1) return { error: 'the front matter is not closed' };
  const data = {};
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    if (isBlankLine(line) || line[0] === '#') continue;
    const ci = line.indexOf(':');
    if (ci <= 0) return { error: `line ${i + 1} is not "key: value"` };
    let keyOk = true;
    for (let k = 0; k < ci; k++) {
      if (!isKeyChar(line[k])) { keyOk = false; break; }
    }
    if (!keyOk) return { error: `line ${i + 1} is not "key: value"` };
    const key = line.slice(0, ci);
    let raw;
    if (ci + 1 === line.length) raw = '';
    else if (line[ci + 1] === ' ') raw = stripTrailing(line.slice(ci + 2));
    else return { error: `line ${i + 1} is not "key: value"` };
    if (!FM_KEYS.includes(key)) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = keyValue(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, bodyStart: close + 1 };
}

// ---------------------------------------------------------------- Markdown

const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);
const NEXT_SPECIAL = /[\\`*\[&<>"']/g;

function isWs(c) {
  const code = c.charCodeAt(0);
  return code === 9 || code === 10 || code === 11 || code === 12 || code === 13 || code === 32
    || code === 160 || code === 5760 || (code >= 8192 && code <= 8202) || code === 8232
    || code === 8233 || code === 8239 || code === 8287 || code === 12288 || code === 65279;
}

function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b && (line[a] === ' ' || line[a] === '\t')) a++;
  while (b > a && (line[b - 1] === ' ' || line[b - 1] === '\t')) b--;
  return line.slice(a, b);
}

/** A fence's language, or null when the line opens no fence. */
function fenceOpen(line) {
  if (line[0] !== '`' || line[1] !== '`' || line[2] !== '`') return null;
  let i = 3;
  while (i < line.length) {
    const c = line[i];
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '_' || c === '+' || c === '-') i++;
    else break;
  }
  const lang = line.slice(3, i);
  while (i < line.length) {
    if (line[i] !== ' ' && line[i] !== '\t') return null;
    i++;
  }
  return lang;
}

function fenceClose(line) {
  if (line[0] !== '`' || line[1] !== '`' || line[2] !== '`') return false;
  for (let i = 3; i < line.length; i++) {
    if (line[i] !== ' ' && line[i] !== '\t') return false;
  }
  return true;
}

/** A heading line's level and text, or null. */
function headingOf(line) {
  let n = 0;
  while (n < 6 && line[n] === '#') n++;
  if (n === 0) return null;
  if (n === 6 && line[6] === '#') return null;
  if (line[n] !== ' ' && line[n] !== '\t') return null;
  const text = trimLine(line.slice(n));
  return text === '' ? null : { depth: n, text };
}

function isHr(line) {
  if (line !== '---' && line !== '***') {
    if (!line.startsWith('---') && !line.startsWith('***')) return false;
    const rest = line.slice(3);
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] !== ' ' && rest[i] !== '\t') return false;
    }
    return true;
  }
  return true;
}

/** A list item's kind, start and text, or null. */
function listStart(line) {
  const c0 = line[0];
  if ((c0 === '-' || c0 === '*') && line[1] === ' ') return { ordered: false, start: 1, text: line.slice(2) };
  if (isDigit(c0)) {
    let i = 1;
    while (i < 9 && isDigit(line[i])) i++;
    if (line[i] === '.' && line[i + 1] === ' ') {
      return { ordered: true, start: Number(line.slice(0, i)), text: line.slice(i + 2) };
    }
  }
  return null;
}

function isContinued(line) {
  let i = 0;
  while (line[i] === ' ') i++;
  return i >= 2 && i < line.length && !isWs(line[i]);
}

/** Whether `line` ends a paragraph: blank, a fence, a heading or a break. */
function endsParagraph(line) {
  return isBlankLine(line) || fenceOpen(line) !== null || headingOf(line) !== null || isHr(line);
}

/** The first index from `from` where `s` holds `what` outside a backslash escape, or -1. */
function findUnescaped(s, what, from) {
  for (let j = from; j <= s.length - what.length; j++) {
    if (s[j] === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) { j++; continue; }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

/** The first single * from `from` (one whose run is not **), outside an escape, or -1. */
function findSingleStar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) { j++; continue; }
    if (c !== '*') continue;
    if (s[j + 1] === '*') { j++; continue; }
    return j;
  }
  return -1;
}

/** `s` rendered inline; `env.link(target)` is a link's href. */
function inline(s, env) {
  let out = '';
  let i = 0;
  const n = s.length;
  const re = NEXT_SPECIAL;
  while (i < n) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (m === null) { out += s.slice(i); break; }
    const k = m.index;
    if (k > i) out += s.slice(i, k);
    const c = s[k];
    if (c === '\\') {
      if (k + 1 < n && ESCAPABLE.has(s[k + 1])) { out += esc(s[k + 1]); i = k + 2; }
      else { out += '\\'; i = k + 1; }
      continue;
    }
    if (c === '`') {
      const j = s.indexOf('`', k + 1);
      if (j > k + 1) { out += `<code>${esc(s.slice(k + 1, j))}</code>`; i = j + 1; }
      else { out += '`'; i = k + 1; }
      continue;
    }
    if (c === '*') {
      if (s[k + 1] === '*') {
        const j = findUnescaped(s, '**', k + 2);
        if (j > k + 2) { out += `<strong>${inline(s.slice(k + 2, j), env)}</strong>`; i = j + 2; }
        else { out += '**'; i = k + 2; }
        continue;
      }
      const j = findSingleStar(s, k + 1);
      if (j > k + 1) { out += `<em>${inline(s.slice(k + 1, j), env)}</em>`; i = j + 1; }
      else { out += '*'; i = k + 1; }
      continue;
    }
    if (c === '[') {
      const k2 = findUnescaped(s, ']', k + 1);
      const m2 = k2 !== -1 && s[k2 + 1] === '(' ? s.indexOf(')', k2 + 2) : -1;
      const target = m2 === -1 ? '' : s.slice(k2 + 2, m2);
      if (target !== '' && !/\s/.test(target)) {
        out += `<a href="${esc(env.link(target))}">${inline(s.slice(k + 1, k2), env)}</a>`;
        i = m2 + 1;
        continue;
      }
      out += '[';
      i = k + 1;
      continue;
    }
    out += ESCAPES[c];
    i = k + 1;
  }
  return out;
}

/**
 * A body's lines rendered: its HTML (each block on its own lines, a "\n"
 * after the last), its table of contents and its excerpt.
 */
function renderMarkdown(lines, start, env) {
  const ids = new Set();
  const blocks = [];
  const toc = [];
  let excerpt = null;
  let i = start;
  const n = lines.length;
  while (i < n) {
    const line = lines[i];
    if (isBlankLine(line)) { i++; continue; }
    const lang = fenceOpen(line);
    if (lang !== null) {
      const body = [];
      i++;
      while (i < n && !fenceClose(lines[i])) body.push(lines[i++]);
      i++;
      const cls = lang === '' ? '' : ` class="language-${esc(lang)}"`;
      let code = '';
      for (const l of body) { code += esc(l); code += '\n'; }
      blocks.push(`<pre><code${cls}>${code}</code></pre>`);
      continue;
    }
    const hd = headingOf(line);
    if (hd !== null) {
      const id = uniqueSlug(slugify(hd.text), ids);
      const html = inline(hd.text, env);
      blocks.push(`<h${hd.depth} id="${id}">${html}</h${hd.depth}>`);
      if (hd.depth === 2 || hd.depth === 3) toc.push({ level: hd.depth, id, html });
      i++;
      continue;
    }
    if (isHr(line)) { blocks.push('<hr>'); i++; continue; }
    if (line[0] === '>') {
      const body = [];
      while (i < n && lines[i][0] === '>') {
        const l = lines[i++];
        body.push(l[1] === ' ' ? l.slice(2) : l.slice(1));
      }
      const kept = [];
      for (const l of body) {
        const t = trimLine(l);
        if (t !== '') kept.push(t);
      }
      blocks.push(kept.length === 0 ? '<blockquote>\n</blockquote>' : `<blockquote>\n<p>${inline(kept.join('\n'), env)}</p>\n</blockquote>`);
      continue;
    }
    const li = listStart(line);
    if (li !== null) {
      const ordered = li.ordered;
      const items = [];
      while (i < n) {
        const m = listStart(lines[i]);
        if (m !== null && m.ordered === ordered) { items.push([trimLine(m.text)]); i++; }
        else if (isContinued(lines[i])) { items[items.length - 1].push(trimLine(lines[i])); i++; }
        else break;
      }
      const tag = ordered ? 'ol' : 'ul';
      const open = ordered && li.start !== 1 ? `<ol start="${li.start}">` : `<${tag}>`;
      let inner = '';
      for (const parts of items) inner += `<li>${inline(parts.join('\n'), env)}</li>\n`;
      blocks.push(`${open}\n${inner}</${tag}>`);
      continue;
    }
    const body = [trimLine(line)];
    i++;
    while (i < n && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const html = inline(body.join('\n'), env);
    if (excerpt === null) excerpt = html;
    blocks.push(`<p>${html}</p>`);
  }
  let html = '';
  for (const b of blocks) { html += b; html += '\n'; }
  return { html, toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- templates

class TemplateError extends Error {}

/** The path `text` names, split at its dots, or a TemplateError. */
function pathOf(name, text) {
  const parts = text.split('.');
  for (const p of parts) {
    if (p.length === 0) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
    const c0 = p[0];
    if (!((c0 >= 'A' && c0 <= 'Z') || (c0 >= 'a' && c0 <= 'z') || c0 === '_')) {
      throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
    }
    for (let i = 1; i < p.length; i++) {
      const c = p[i];
      if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '_')) {
        throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
      }
    }
  }
  return parts;
}

function isIdent(text) {
  if (text.length === 0) return false;
  const c0 = text[0];
  if (!((c0 >= 'A' && c0 <= 'Z') || (c0 >= 'a' && c0 <= 'z') || c0 === '_')) return false;
  for (let i = 1; i < text.length; i++) {
    const c = text[i];
    if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '_')) return false;
  }
  return true;
}

/** `src`'s tokens: text, {{ }}, {{{ }}} and {% %}, a standalone tag's line taken with it. */
function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) { text += src.slice(i); break; }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') { text += src.slice(i, open + 1); i = open + 1; continue; }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = isBlankLine(src.slice(lineStart, open)) && isBlankLine(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

/** `src` parsed into its tree of nodes (a TemplateError when it does not parse). */
function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      if (tag.startsWith('for ')) {
        const rest = tag.slice(4);
        const inAt = rest.indexOf(' in ');
        if (inAt === -1) throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
        const varName = rest.slice(0, inAt);
        const pathText = rest.slice(inAt + 4);
        if (!isIdent(varName) || pathText.length === 0 || /\s/.test(pathText)) {
          throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
        }
        const node = { kind: 'for', name: varName, path: pathOf(name, pathText), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if (tag === 'for' || tag.startsWith('for\t') || tag.startsWith('for ')) {
        throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
      } else if (tag.startsWith('if ')) {
        const rest = tag.slice(3);
        let not = false;
        let pathText = rest;
        if (rest.startsWith('not ')) { not = true; pathText = rest.slice(4); }
        if (pathText.length === 0 || /\s/.test(pathText)) throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
        const node = { kind: 'if', not, path: pathOf(name, pathText), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if (tag.startsWith('include "') && tag.endsWith('"')) {
        const incName = tag.slice(9, -1);
        let ok = incName.length > 0;
        for (let i = 0; i < incName.length && ok; i++) {
          const c = incName[i];
          if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '-')) ok = false;
        }
        if (!ok) throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
        body.push({ kind: 'include', name: incName });
      } else {
        throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
      }
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

// --- template runtime helpers (R) ---

const PARENT = Symbol('parent');

/** The value at a path's first name: the nearest loop frame holding it, else the page's values. */
function lk(S, V, name) {
  let s = S;
  while (s !== null) {
    if (Object.hasOwn(s, name)) return s[name];
    s = s[PARENT];
  }
  return Object.hasOwn(V, name) ? V[name] : undefined;
}

/** A value as text: a string itself, a number in JavaScript's digits, true or false, an array's items joined by ", ", else "". */
function txt(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) {
    let s = '';
    for (let i = 0; i < v.length; i++) {
      if (i > 0) s += ', ';
      s += txt(v[i]);
    }
    return s;
  }
  return '';
}

/** Whether a value counts as true in an if: not undefined, null, false, "", 0 or an empty array. */
function tr(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/**
 * A template's compiled form: a function (R, V, S, D) -> string, where R is
 * this runtime, V the page's values, S the enclosing loops' scope (or null)
 * and D the include depth. Loop variables the template itself binds are
 * plain locals in the generated code; a name bound by a caller's loop comes
 * through S.
 */
function compileTemplate(nodes) {
  let uid = 0;
  const lines = ['let _o = "";'];
  // env: a stack of frames; each frame maps a bound name to its local id.
  const env = [];
  function lookupLocal(name) {
    for (let f = env.length - 1; f >= 0; f--) {
      const id = env[f].get(name);
      if (id !== undefined) return id;
    }
    return null;
  }
  function pathExpr(path) {
    const first = path[0];
    const local = lookupLocal(first);
    let expr = local !== null ? local : `R.lk(S,V,${JSON.stringify(first)})`;
    if (path.length > 1) {
      const tmp = `_v${uid++}`;
      lines.push(`let ${tmp} = ${expr};`);
      for (let k = 1; k < path.length; k++) {
        lines.push(`${tmp} = (${tmp} !== null && typeof ${tmp} === 'object' && Object.hasOwn(${tmp}, ${JSON.stringify(path[k])})) ? ${tmp}[${JSON.stringify(path[k])}] : undefined;`);
      }
      expr = tmp;
    }
    return expr;
  }
  function scopeExpr() {
    if (env.length === 0) return 'S';
    let expr = 'S';
    for (let f = 0; f < env.length; f++) {
      const frame = env[f];
      const varId = frame.varId;
      const loopId = frame.loopId;
      expr = `({${JSON.stringify(frame.varName)}: ${varId}, loop: ${loopId}, [R.P]: ${expr}})`;
    }
    return expr;
  }
  function emit(list) {
    for (const n of list) {
      if (n.kind === 'text') {
        lines.push(`_o += ${JSON.stringify(n.text)};`);
      } else if (n.kind === 'var') {
        lines.push(`_o += R.esc(R.txt(${pathExpr(n.path)}));`);
      } else if (n.kind === 'raw') {
        lines.push(`_o += R.txt(${pathExpr(n.path)});`);
      } else if (n.kind === 'if') {
        lines.push(`if (R.tr(${pathExpr(n.path)}) !== ${n.not}) {`);
        emit(n.then);
        if (n.else !== null) {
          lines.push('} else {');
          emit(n.else);
        }
        lines.push('}');
      } else if (n.kind === 'for') {
        const a = `_a${uid++}`;
        const k = `_k${uid++}`;
        const x = `_x${uid++}`;
        const lp = `_l${uid++}`;
        const nn = `_n${uid++}`;
        lines.push(`{ const ${a} = ${pathExpr(n.path)}; if (Array.isArray(${a})) { const ${nn} = ${a}.length; for (let ${k} = 0; ${k} < ${nn}; ${k}++) { const ${x} = ${a}[${k}]; const ${lp} = { index: ${k} + 1, first: ${k} === 0, last: ${k} === ${nn} - 1, length: ${nn} };`);
        const frame = new Map();
        frame.set(n.name, x);
        frame.set('loop', lp);
        frame.varName = n.name;
        frame.varId = x;
        frame.loopId = lp;
        env.push(frame);
        emit(n.body);
        env.pop();
        lines.push('} } }');
      } else if (n.kind === 'include') {
        const f = `_f${uid++}`;
        lines.push(`if (D < 8) { const ${f} = R.T.get(${JSON.stringify(n.name)}); if (${f}) _o += ${f}(R,V,${scopeExpr()},D+1); }`);
      }
    }
  }
  emit(nodes);
  lines.push('return _o;');
  const fn = new Function('R', 'V', 'S', 'D', lines.join('\n'));
  return fn;
}

const templateCache = new Map();

/** A template's compiled function, or null when it does not parse (with the report line). */
function compile(name, src) {
  const key = `${name}\n${src}`;
  const hit = templateCache.get(key);
  if (hit !== undefined) return hit;
  let out;
  try {
    out = { fn: compileTemplate(parseTemplate(name, src)) };
  } catch (err) {
    if (!(err instanceof TemplateError)) throw err;
    out = { error: err.message };
  }
  if (templateCache.size < 500) templateCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------- the build

/** The words of a body: its runs of characters other than whitespace. */
function wordsOf(text) {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const ws = c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v' || (c > ' ' && isWs(c));
    if (ws) inWord = false;
    else if (!inWord) { inWord = true; count++; }
  }
  return count;
}

/** `rel` from the directory `dir` of a source, or null when it climbs out of the root. */
function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  const segs = rel.split('/');
  for (let s = 0; s < segs.length; s++) {
    const seg = segs[s];
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

const dirOf = (path) => {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
};

const RESERVED = ['posts', 'tags', 'page'];

/** One site's output tree: path -> text. */
export function run(input) {
  const templates = new Map();
  const report = [];
  const names = Object.keys(input.templates).sort(byCodeUnits);
  for (const name of names) {
    const c = compile(name, input.templates[name]);
    if ('error' in c) report.push(c.error);
    else templates.set(name, c.fn);
  }
  const R = { esc, txt, tr, lk, T: templates, P: PARENT };
  const base = input.site.base_url.replace(/\/+$/, '');
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  const sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) sources.push({ path: f.path, text: f.content.replace(/\r\n?/g, '\n') });
    else statics.push({ path: f.path, content: f.content });
  }
  // Front matter, in source order; the first failing check is the one reported.
  const kept = [];
  for (const s of sources) {
    const lines = s.text.split('\n');
    const fm = parseFrontMatter(lines);
    if ('error' in fm) { report.push(`refused ${s.path}: ${fm.error}`); continue; }
    s.data = fm.data;
    s.lines = lines;
    s.bodyStart = fm.bodyStart;
    s.post = s.path.startsWith('posts/');
    let own = null;
    if (s.path.startsWith('tags/')) own = 'tags';
    else if (s.path.startsWith('page/')) own = 'page';
    if (own !== null) { report.push(`refused ${s.path}: ${own}/ is the generator's own`); continue; }
    if (s.post && !Object.hasOwn(s.data, 'date')) { report.push(`refused ${s.path}: a post needs a date`); continue; }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) { report.push(`refused ${s.path}: layout "${layout}" is no template that parses`); continue; }
    s.layout = layout;
    if (s.data.draft === true) { report.push(`draft ${s.path}`); continue; }
    kept.push(s);
  }
  // Permalinks: each slug unique in its directory, in source order.
  const bySource = new Map();
  const taken = new Map();
  for (const s of kept) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? RESERVED : []);
      taken.set(dir, set);
    }
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), set);
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }
  // Markdown, each body's links resolved.
  const staticPaths = new Set();
  for (const f of statics) staticPaths.add(f.path);
  const broken = new Set();
  for (const s of kept) {
    const dir = dirOf(s.path);
    const env = {
      link: (target) => {
        if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target[0] === '/' || target[0] === '#') return target;
        const hash = target.indexOf('#');
        const rel = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : target.slice(hash);
        const path = rel === '' ? null : resolvePath(dir, rel);
        if (path !== null && bySource.has(path)) return `${bySource.get(path).url}${frag}`;
        if (path !== null && staticPaths.has(path)) return `${base}/${path}${frag}`;
        broken.add(`broken-link ${s.path} -> ${target}`);
        return target;
      },
    };
    const md = renderMarkdown(s.lines, s.bodyStart, env);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
    s.body = s.lines.slice(s.bodyStart).join('\n');
  }
  // Collections: posts newest first, equal dates by slug.
  const posts = kept.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  for (let k = 0; k < posts.length; k++) {
    posts[k].newer = k === 0 ? null : posts[k - 1];
    posts[k].older = k === posts.length - 1 ? null : posts[k + 1];
  }
  // Tags: grouped by slug, each named as first met in the posts' order.
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    for (const name of s.data.tags ?? []) {
      const slug = slugify(name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      out.push(name);
    }
    return out;
  };
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of kept) {
    if (s.post) continue;
    s.tagRefs = ownTags(s).map((name) => {
      const slug = slugify(name);
      return bySlug.get(slug) ?? { name, slug, url: '', posts: [] };
    });
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));
  // Cards, pages and layouts.
  const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });
  const cardOf = (s) => ({
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  });
  const cards = new Map();
  for (const p of posts) cards.set(p, cardOf(p));
  const pageOf = (s) => ({
    ...cardOf(s),
    slug: s.slug,
    content: s.html,
    toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
    newer: linkOf(s.newer ?? null),
    older: linkOf(s.older ?? null),
    is_post: s.post,
  });
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cards.get(p));
  const output = {};
  const render = (name, vars) => {
    const fn = templates.get(name);
    if (fn === undefined) return null;
    vars.site = site;
    vars.tags = allTags;
    vars.recent = recent;
    return fn(R, vars, null, 0);
  };
  for (const s of kept) output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s) });
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of tags) {
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) } });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }
  // The report: every line reported above and each broken link, sorted, then the counts.
  const lines = [...report, ...broken].sort(byCodeUnits);
  const pageCount = kept.filter((s) => !s.post).length;
  lines.push(`built ${pageCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output['build-report.txt'] = `${lines.join('\n')}\n`;
  return output;
}
