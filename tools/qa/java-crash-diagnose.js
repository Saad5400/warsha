// Paste into DevTools Console on https://warsha.sb.sa (the tab that shows the error).
// Prints a report and copies it to the clipboard. Changes nothing.
(async () => {
  const out = []
  const log = (...a) => { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); out.push(s); console.log(s) }

  log('ua:', navigator.userAgent)
  log('build:', document.querySelector('script[type="module"][src*="/assets/index-"]')?.src)
  log('sw:', navigator.serviceWorker?.controller?.scriptURL ?? 'none')

  // 1. CheerpJ's IndexedDB filesystems: records with no type, and dir entries that point at nothing.
  const dbs = (await indexedDB.databases?.()) ?? []
  log('idb:', dbs.map((d) => `${d.name}@${d.version}`).join(', '))
  for (const d of dbs.filter((x) => x.name.startsWith('cjFS_'))) {
    const db = await new Promise((ok, no) => { const r = indexedDB.open(d.name); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) })
    if (!db.objectStoreNames.contains('files')) { log(d.name, 'no files store'); db.close(); continue }
    const all = await new Promise((ok, no) => {
      const st = db.transaction('files', 'readonly').objectStore('files'); const m = new Map()
      const c = st.openCursor(); c.onsuccess = () => { const cur = c.result; if (!cur) return ok(m); m.set(cur.key, cur.value); cur.continue() }; c.onerror = () => no(c.error)
    })
    let bad = 0
    for (const [k, v] of all) {
      if (!v || typeof v !== 'object' || !v.type) { bad++; if (bad < 30) log('  BAD RECORD', d.name, k, typeof v, v && Object.keys(v)) }
      else if (v.type === 'dir' && Array.isArray(v.contents)) {
        for (const child of v.contents) {
          const key = String(k).replace(/\/$/, '') + (String(child).startsWith('/') ? '' : '/') + child
          if (!all.has(key)) { bad++; if (bad < 30) log('  DANGLING', d.name, k, '->', child) }
        }
      }
    }
    log(d.name, 'records:', all.size, 'problems:', bad)
    db.close()
  }

  // 2. Boot a throwaway JVM worker and run a tiny Scanner program; catch the REAL error location.
  await new Promise((done) => {
    const w = new Worker('/warsha-jvm.worker.js')
    const t = setTimeout(() => { log('worker: timeout after 120s'); w.terminate(); done() }, 120000)
    const end = () => { clearTimeout(t); w.terminate(); done() }
    w.onerror = (e) => { log('WORKER ERROR:', e.message, '@', `${e.filename}:${e.lineno}:${e.colno}`); end() }
    w.onmessage = ({ data: m }) => {
      if (!m) return log('worker posted EMPTY message')
      if (m.type === 'internal' && !m.noise && m.level !== 'log') log('internal', m.level, m.text.slice(0, 500))
      if (m.type === 'fatal') { log('FATAL:', m.text.slice(0, 1500)); end() }
      if (m.type === 'stdout') log('stdout:', m.text)
      if (m.type === 'stderr') log('stderr:', m.text.slice(0, 500))
      if (m.type === 'ready') {
        log('ready', m)
        w.postMessage({ type: 'run', runId: 'diag_1', entryPath: 'Main.java', files: [{ path: 'Main.java', content:
          'import java.util.Scanner;\npublic class Main { public static void main(String[] a) { System.out.print("ok "); Scanner s = new Scanner(System.in); System.out.println(s.nextInt()); } }\n' }] })
      }
      if (m.type === 'stdin-request') w.postMessage({ type: 'stdin', line: '5' })
      if (m.type === 'compile-failed') { log('compile-failed', m); end() }
      if (m.type === 'done') { log('done', m); end() }
    }
    w.postMessage({ type: 'init', compilerJarPath: '/app/ecj.jar', bootJarPath: '/app/warsha-boot.jar' })
  })

  const report = out.join('\n')
  try { (window.copy||(()=>{}))(report); console.log('%c(report copied to clipboard)', 'color:green') } catch {}
})()
