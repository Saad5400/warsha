/**
 * How `console.log` turns values into text — shared by the two places student
 * JavaScript runs: the headless script worker (js.ts) and the page preview's
 * console bridge (web.ts). Both inject this source verbatim into a context we
 * do not share a module graph with (a blob worker, a sandboxed srcdoc iframe),
 * which is why it is a string and not a function.
 *
 * It follows Node's `util.inspect` closely enough that the output matches what a
 * course or a tutorial shows, because the old one-liner (`JSON.stringify`) was
 * wrong in ways students hit on day one: `console.log(0 / 0)` printed `null`,
 * `[1, undefined]` printed `[1,null]`, a Map or a Set printed `{}`, and a
 * function printed nothing at all.
 *
 * Defines, in the scope it is injected into:
 *   __wfmt(value)          one value, top level (strings unquoted); __wfmt.nested quotes them
 *   __wline(args)          a console.log line: printf-style %s %d %i %f %o %O %j %c, then values, '\n'
 *   __wtable(data, cols)   console.table's box drawing
 *
 * Deliberately single-line (no 72-column wrapping) and bounded: nesting deeper
 * than 2 prints [Object]/[Array], and long arrays, maps and strings are cut, so
 * logging a huge structure cannot freeze the tab.
 */
export const CONSOLE_FORMAT_SOURCE = String.raw`
var __wfmt = (function () {
  var MAX_ITEMS = 100, MAX_DEPTH = 2, MAX_STR = 10000
  function ctorName(v) {
    try { var p = Object.getPrototypeOf(v); var c = p && p.constructor; return (c && typeof c.name === 'string') ? c.name : '' } catch (e) { return '' }
  }
  function isClass(fn) { try { return /^class[\s{]/.test(Function.prototype.toString.call(fn)) } catch (e) { return false } }
  function quote(s) {
    if (s.length > MAX_STR) s = s.slice(0, MAX_STR) + '...'
    var q = s.indexOf("'") === -1 ? "'" : s.indexOf('"') === -1 ? '"' : '\x60'
    return q + s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t').split(q).join('\\' + q) + q
  }
  function key(k) { return typeof k === 'symbol' ? '[' + k.toString() + ']' : /^[A-Za-z_$][\w$]*$/.test(k) ? k : quote(k) }
  function more(n) { return '... ' + n + ' more item' + (n === 1 ? '' : 's') }
  function braces(open, items, close) { return items.length ? open + ' ' + items.join(', ') + ' ' + close : open + close }
  function fn(v) {
    if (isClass(v)) return '[class ' + (v.name || '(anonymous)') + ']'
    return v.name ? '[Function: ' + v.name + ']' : '[Function (anonymous)]'
  }
  function inspect(v, depth, seen) {
    switch (typeof v) {
      case 'string': return quote(v)
      case 'number': return Object.is(v, -0) ? '-0' : String(v)
      case 'bigint': return v + 'n'
      case 'boolean': case 'undefined': return String(v)
      case 'symbol': return v.toString()
      case 'function': return fn(v)
    }
    if (v === null) return 'null'
    if (seen.indexOf(v) !== -1) return '[Circular]'
    try {
      if (v instanceof Error) return v.stack || (v.name + ': ' + v.message)
      if (v instanceof Date) return isNaN(v.getTime()) ? 'Invalid Date' : v.toISOString()
      if (v instanceof RegExp) return String(v)
      if (typeof Promise !== 'undefined' && v instanceof Promise) return 'Promise { <pending> }'
      var name = ctorName(v)
      if (depth > MAX_DEPTH) return Array.isArray(v) ? '[Array]' : '[' + (name || 'Object') + ']'
      seen = seen.concat([v])
      var items = [], i, n
      if (Array.isArray(v) || ArrayBuffer.isView(v)) {
        n = Math.min(v.length, MAX_ITEMS)
        for (i = 0; i < n; i++) items.push(i in v ? inspect(v[i], depth + 1, seen) : '<empty item>')
        if (v.length > n) items.push(more(v.length - n))
        var head = Array.isArray(v) ? (name && name !== 'Array' ? name + '(' + v.length + ') ' : '') : name + '(' + v.length + ') '
        return head + braces('[', items, ']')
      }
      if (v instanceof Map) {
        v.forEach(function (val, k) { if (items.length < MAX_ITEMS) items.push(inspect(k, depth + 1, seen) + ' => ' + inspect(val, depth + 1, seen)) })
        if (v.size > MAX_ITEMS) items.push(more(v.size - MAX_ITEMS))
        return 'Map(' + v.size + ') ' + braces('{', items, '}')
      }
      if (v instanceof Set) {
        v.forEach(function (val) { if (items.length < MAX_ITEMS) items.push(inspect(val, depth + 1, seen)) })
        if (v.size > MAX_ITEMS) items.push(more(v.size - MAX_ITEMS))
        return 'Set(' + v.size + ') ' + braces('{', items, '}')
      }
      var keys = Object.keys(v)
      n = Math.min(keys.length, MAX_ITEMS)
      for (i = 0; i < n; i++) items.push(key(keys[i]) + ': ' + inspect(v[keys[i]], depth + 1, seen))
      if (keys.length > n) items.push(more(keys.length - n))
      var prefix = name === 'Object' ? '' : name ? name + ' ' : '[Object: null prototype] '
      return prefix + braces('{', items, '}')
    } catch (e) {
      try { return String(v) } catch (e2) { return '[object]' }
    }
  }
  var top = function (v) { return typeof v === 'string' ? v : inspect(v, 0, []) }
  // Nested rendering (strings quoted), for console.table's cells.
  top.nested = function (v) { return inspect(v, 1, []) }
  return top
})()

function __wline(args) {
  args = Array.prototype.slice.call(args)
  var out = []
  if (typeof args[0] === 'string' && args.length > 1 && args[0].indexOf('%') !== -1) {
    var rest = args.slice(1)
    out.push(args[0].replace(/%([sdifoOjc%])/g, function (m, c) {
      if (c === '%') return '%'
      if (!rest.length) return m
      var a = rest.shift()
      switch (c) {
        case 's': return typeof a === 'string' ? a : __wfmt(a)
        case 'd': case 'i': return typeof a === 'object' ? 'NaN' : String(c === 'i' ? parseInt(a, 10) : Number(a))
        case 'f': return String(parseFloat(a))
        case 'j': try { return JSON.stringify(a) } catch (e) { return '[Circular]' }
        case 'c': return ''
        default: return __wfmt(a)
      }
    }))
    args = rest
  }
  for (var i = 0; i < args.length; i++) out.push(__wfmt(args[i]))
  return out.join(' ') + '\n'
}

function __wtable(data, columns) {
  if (data === null || typeof data !== 'object') return __wline([data])
  var rows = [], cols = [], hasValues = false
  var add = function (c) { if (cols.indexOf(c) === -1) cols.push(c) }
  var cell = __wfmt.nested
  var entries = data instanceof Map ? Array.from(data.entries()) : Object.keys(data).map(function (k) { return [k, data[k]] })
  entries.forEach(function (e) {
    var row = { index: String(e[0]), cells: {} }, v = e[1]
    if (v !== null && typeof v === 'object') Object.keys(v).forEach(function (k) { add(k); row.cells[k] = cell(v[k]) })
    else { hasValues = true; row.value = cell(v) }
    rows.push(row)
  })
  if (columns) cols = columns.map(String)
  var head = ['(index)'].concat(cols, hasValues ? ['Values'] : [])
  var body = rows.map(function (r) {
    return [r.index].concat(cols.map(function (c) { return c in r.cells ? r.cells[c] : '' }), hasValues ? [r.value === undefined ? '' : r.value] : [])
  })
  var widths = head.map(function (h, i) { return Math.max.apply(null, [h.length].concat(body.map(function (b) { return b[i].length }))) + 2 })
  var pad = function (s, w) { var l = Math.floor((w - s.length) / 2); return ' '.repeat(l) + s + ' '.repeat(w - s.length - l) }
  var rule = function (a, b, c) { return a + widths.map(function (w) { return '─'.repeat(w) }).join(b) + c }
  var line = function (cells) { return '│' + cells.map(function (s, i) { return pad(s, widths[i]) }).join('│') + '│' }
  return [rule('┌', '┬', '┐'), line(head), rule('├', '┼', '┤')].concat(body.map(line), [rule('└', '┴', '┘')]).join('\n') + '\n'
}
`
