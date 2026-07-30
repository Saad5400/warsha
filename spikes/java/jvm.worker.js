// Warsha spike — CheerpJ JVM hosted inside a Web Worker.
//
// Why a worker: cheerpjInit() can only be called ONCE per JS context ("CheerpJ:
// Already initialized") and CheerpJ 4.3 exposes no terminate/interrupt API. A
// Java loop that never yields therefore wedges whichever event loop the JVM runs
// on. Put the JVM in a worker and worker.terminate() becomes a real, immediate
// kill that cannot be refused, while the UI thread stays responsive.
//
// loader.js MUST be loaded with importScripts (a classic script). It declares
// cheerpjInit inside an `if (!self.cj3LoaderPath) { ... }` block, which is only
// hoisted to global scope in sloppy-mode classic scripts — in a module worker it
// would stay block-scoped and be invisible.
importScripts("https://cjrtnc.leaningtech.com/4.3/loader.js");

const post = (msg) => self.postMessage(msg);
const log = (text) => post({ type: "log", text });

// javac is invoked through its own main(), so its System.out/System.err are NOT
// the ones Bridge redirects (that only happens inside warsha.Launcher). With no
// DOM there is no #console element either, so CheerpJ falls back to the JS
// console — hook it so compiler diagnostics actually reach the page.
// Noise CheerpJ itself emits on the same channel. It must never reach the
// student's output pane. ECJ's parser has one enormous generated method
// (Parser.consumeRule) that CheerpJ's JIT refuses, so it logs a "JIT failure"
// line and falls back to the interpreter — harmless but alarming, and it would
// otherwise appear above the program's first line of output.
const RUNTIME_NOISE = /^JIT failure|please report a bug/;

for (const level of ["log", "info", "warn", "error"]) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    orig(...args);
    const text = args.map(String).join(" ");
    post({ type: RUNTIME_NOISE.test(text) ? "jvmnoise" : "jvmconsole", level, text });
  };
}

// --- stdin: the JS side of warsha.Bridge.readLine --------------------------
// CheerpJ awaits async natives, so the Java thread really blocks here. No
// Atomics/SharedArrayBuffer needed, which matters because that would require
// COOP/COEP headers that a plain static host may not be able to set.
const stdinQueue = [];
let stdinWaiter = null;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === "stdin") {
    if (stdinWaiter) { const r = stdinWaiter; stdinWaiter = null; r(m.line); }
    else stdinQueue.push(m.line);
  } else if (m.type === "run") {
    compileAndRun(m.sources, m.mainClass);
  }
};

function nextStdinLine() {
  if (stdinQueue.length) return Promise.resolve(stdinQueue.shift());
  post({ type: "stdinRequest" });
  return new Promise((res) => { stdinWaiter = res; });
}

async function Java_warsha_Bridge_readLine() {
  return await nextStdinLine();
}

// --- stdout/stderr --------------------------------------------------------
// There is no DOM in a worker, so CheerpJ's #console element trick is not
// available. Instead the Java side re-points System.out/System.err at these
// natives, which works in any context and gives us real stream separation.
async function Java_warsha_Bridge_writeOut(lib, text) { post({ type: "out", text }); }
async function Java_warsha_Bridge_writeErr(lib, text) { post({ type: "err", text }); }

const OUT_DIR = "/files/";

// ECJ (Eclipse Compiler for Java) 3.26.0, EPL-2.0, fetched by fetch-compiler.sh.
// Replaces the JDK tools.jar this spike started with: Oracle JDK binaries are
// not redistributable. 3.26.0 is the last ECJ whose own class files are Java 8,
// which is what CheerpJ's default runtime provides.
const COMPILER_JAR = "/app/ecj.jar";
const COMPILER_MAIN = "org.eclipse.jdt.internal.compiler.batch.Main";

(async function init() {
  const s = performance.now();
  await cheerpjInit({
    status: "none",
    natives: {
      Java_warsha_Bridge_readLine,
      Java_warsha_Bridge_writeOut,
      Java_warsha_Bridge_writeErr,
    },
  });
  post({ type: "ready", initMs: performance.now() - s });
})().catch((e) => post({ type: "fatal", text: "cheerpjInit failed in worker: " + e }));

function addFile(path, content) {
  const fn = self.cheerpOSAddStringFile || self.cheerpjAddStringFile;
  fn(path, new TextEncoder().encode(content));
}

async function compileAndRun(sources, mainClass) {
  try {
    const paths = [];
    for (const [name, content] of Object.entries(sources)) {
      addFile("/str/" + name, content);
      paths.push("/str/" + name);
    }
    log(`wrote ${paths.length} sources to /str/ (flat namespace)`);

    let s = performance.now();
    const rc = await cheerpjRunMain(
      COMPILER_MAIN, COMPILER_JAR,
      // -g asks for full debug info. It does not actually buy us line numbers
      // at runtime (see SPIKE.md §8.2) but costs nothing and is correct.
      // -proc:none skips annotation processing; -nowarn keeps the console clean.
      ...paths, "-d", OUT_DIR, "-g", "-1.8", "-proc:none", "-nowarn"
    );
    const compileMs = performance.now() - s;
    log(`javac exit=${rc} in ${compileMs.toFixed(0)}ms`);
    if (rc !== 0) { post({ type: "done", exit: rc, compileMs, runMs: 0, failed: "compile" }); return; }

    s = performance.now();
    const exit = await cheerpjRunMain("warsha.Launcher", OUT_DIR, mainClass);
    const runMs = performance.now() - s;
    post({ type: "done", exit, compileMs, runMs });
  } catch (e) {
    post({ type: "fatal", text: "worker exception: " + (e && e.stack || e) });
  }
}
