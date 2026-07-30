// src/pythonRuntime.ts
var STDIN_CAPACITY = 64 * 1024;
var HEADER_BYTES = 8;
var STATE_EMPTY = 0;
var STATE_LINE = 1;
var STATE_EOF = 2;
var NOT_ISOLATED = "Python needs cross-origin isolation (SharedArrayBuffer) to make input() block. Load coi-serviceworker.js as a plain <script> in <head> and serve the page over HTTPS or localhost, then reload.";
var PythonRuntime = class {
  id = "python";
  indexURL;
  isatty;
  worker = null;
  sab = null;
  ctrl = null;
  data = null;
  /** In-flight or settled boot of the current worker. null = no worker yet. */
  booting = null;
  bootSettle = null;
  progressListeners = /* @__PURE__ */ new Set();
  lastProgress = null;
  active = null;
  encoder = new TextEncoder();
  /** Non-shared staging buffer: TextEncoder refuses to write into a shared view. */
  scratch = new Uint8Array(STDIN_CAPACITY);
  constructor(options = {}) {
    this.indexURL = options.indexURL;
    this.isatty = options.isatty === true;
  }
  /** Version of Python that will be used, once loaded. */
  version = null;
  /**
   * Boot the interpreter. Idempotent: concurrent and repeated calls share one
   * boot, and calling it when already warm resolves immediately. Every caller
   * gets the progress messages of whichever boot is in flight, including the
   * silent respawn started by `kill()`.
   */
  async load(onProgress) {
    this.progressListeners.add(onProgress);
    if (this.booting && this.lastProgress) onProgress(this.lastProgress);
    const boot = this.booting ?? (this.booting = this.spawn());
    try {
      await boot;
    } catch (error) {
      if (this.booting === boot) this.booting = null;
      throw error;
    } finally {
      this.progressListeners.delete(onProgress);
    }
  }
  async run(files, entryPath, io2) {
    if (this.active && !this.active.ended) {
      throw new Error("A Python program is already running; kill() it before running another.");
    }
    const entry = normalizePath(entryPath);
    const payload = {};
    for (const file of files) payload[normalizePath(file.path)] = file.content;
    if (!(entry in payload)) {
      throw new Error(`Entry file ${entryPath} is not in the file set.`);
    }
    await this.load(() => {
    });
    const worker = this.worker;
    const ctrl = this.ctrl;
    if (!worker || !ctrl) throw new Error("Python runtime is not ready.");
    const active = { io: io2, ended: false, awaitingStdin: false };
    this.active = active;
    Atomics.store(ctrl, 0, STATE_EMPTY);
    worker.postMessage({ type: "run", files: payload, entry });
    const session2 = {
      kill: () => this.killSession(active),
      writeStdin: (line) => this.writeStdin(active, line),
      writeEof: () => this.writeEof(active)
    };
    return session2;
  }
  /** Terminate the worker without any run in flight (e.g. leaving the page). */
  dispose() {
    if (this.active && !this.active.ended) this.killSession(this.active);
    else this.teardown();
  }
  // --- worker lifecycle -----------------------------------------------------
  spawn() {
    if (typeof SharedArrayBuffer !== "function" || self.crossOriginIsolated !== true) {
      this.booting = null;
      return Promise.reject(new Error(NOT_ISOLATED));
    }
    if (!this.sab) {
      this.sab = new SharedArrayBuffer(HEADER_BYTES + STDIN_CAPACITY);
      this.ctrl = new Int32Array(this.sab, 0, 2);
      this.data = new Uint8Array(this.sab, HEADER_BYTES);
    }
    this.lastProgress = null;
    const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    this.worker = worker;
    worker.onmessage = (ev) => {
      if (this.worker === worker) this.onMessage(ev.data);
    };
    worker.onerror = (ev) => {
      if (this.worker !== worker) return;
      const text = ev.message || "worker failed to start (no message; check the console)";
      this.failBoot(new Error(text));
      this.finish(1, text);
    };
    const promise = new Promise((resolve, reject) => {
      this.bootSettle = { resolve, reject };
    });
    worker.postMessage({ type: "init", sab: this.sab, indexURL: this.indexURL, isatty: this.isatty });
    return promise;
  }
  onMessage(msg) {
    switch (msg.type) {
      case "progress":
        this.lastProgress = msg.text;
        for (const listener of this.progressListeners) listener(msg.text);
        return;
      case "ready":
        this.version = msg.version;
        this.lastProgress = null;
        this.bootSettle?.resolve();
        this.bootSettle = null;
        return;
      case "stdout":
        this.active?.io.onStdout(msg.text);
        return;
      case "stderr":
        this.active?.io.onStderr(msg.text);
        return;
      case "stdin-request":
        if (this.active && !this.active.ended) {
          this.active.awaitingStdin = true;
          this.active.io.onStdinRequest();
        }
        return;
      case "done":
        this.finish(msg.code);
        return;
      case "fatal":
        if (msg.duringBoot) {
          this.failBoot(new Error(msg.text));
          this.finish(1, msg.text);
          return;
        }
        this.finish(1, `
[python runtime error] ${msg.text}
`);
        return;
    }
  }
  failBoot(error) {
    const settle2 = this.bootSettle;
    this.bootSettle = null;
    this.booting = null;
    this.worker?.terminate();
    this.worker = null;
    settle2?.reject(error);
  }
  teardown() {
    this.worker?.terminate();
    this.worker = null;
    this.booting = null;
    this.bootSettle = null;
    this.active = null;
  }
  /** End the current session exactly once. `code` null means killed. */
  finish(code, stderrNote) {
    const active = this.active;
    if (!active || active.ended) return;
    active.ended = true;
    active.awaitingStdin = false;
    this.active = null;
    if (stderrNote) active.io.onStderr(stderrNote);
    active.io.onExit(code);
  }
  // --- session operations ---------------------------------------------------
  killSession(active) {
    if (active.ended) return;
    this.worker?.terminate();
    this.worker = null;
    this.booting = null;
    this.bootSettle = null;
    this.finish(null);
    this.booting = this.spawn();
    this.booting.catch(() => {
    });
  }
  writeStdin(active, line) {
    if (active.ended || !active.awaitingStdin) return;
    const ctrl = this.ctrl;
    const data = this.data;
    if (!ctrl || !data) return;
    const text = line.replace(/\r?\n$/, "");
    const { read, written } = this.encoder.encodeInto(text, this.scratch);
    const length = written ?? 0;
    if (read < text.length) {
      active.io.onStderr(`
[Warsha: input truncated to ${STDIN_CAPACITY >> 10} KiB]
`);
    }
    data.set(this.scratch.subarray(0, length), 0);
    active.awaitingStdin = false;
    Atomics.store(ctrl, 1, length);
    Atomics.store(ctrl, 0, STATE_LINE);
    Atomics.notify(ctrl, 0);
  }
  writeEof(active) {
    if (active.ended || !active.awaitingStdin) return;
    const ctrl = this.ctrl;
    if (!ctrl) return;
    active.awaitingStdin = false;
    Atomics.store(ctrl, 1, 0);
    Atomics.store(ctrl, 0, STATE_EOF);
    Atomics.notify(ctrl, 0);
  }
};
function normalizePath(path) {
  const parts = path.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === "..")) throw new Error(`Unsupported file path: ${path}`);
  return parts.join("/");
}

// harness/programs.js
var PROGRAMS = {
  "input-twice": {
    label: "input() twice",
    entry: "main.py",
    files: [
      {
        path: "main.py",
        content: `a = int(input("first number: "))
b = int(input("second number: "))
print(f"{a} + {b} = {a + b}")
`
      }
    ]
  },
  "partial-prompt": {
    label: "partial-line prompts",
    entry: "main.py",
    files: [
      {
        path: "main.py",
        content: `import sys

print("Each case must show its text BEFORE the input box appears.")
print("None of these call flush().")

a = input("A) input('prompt: ') -> ")
print("   got", repr(a))

print("B) print(end='') then bare input() -> ", end="")
b = input()
print("   got", repr(b))

sys.stdout.write("C) sys.stdout.write() then bare input() -> ")
c = input()
print("   got", repr(c))

print("D) partials:", end="")
print(" one", end="")
print(" two", end="")
d = input(" -> ")
print("   got", repr(d))

print("all reads completed, no EOFError")
`
      }
    ]
  },
  traceback: {
    label: "uncaught exception",
    entry: "main.py",
    files: [
      {
        path: "main.py",
        content: `from helpers.boom import explode

print("about to fail")
explode(0)
print("never reached")
`
      },
      {
        path: "helpers/boom.py",
        content: `def explode(factor):
    if factor <= 0:
        raise ValueError(f"factor must be positive, got {factor}")
    return factor
`
      }
    ]
  },
  "infinite-loop": {
    label: "infinite loop",
    entry: "main.py",
    files: [
      {
        path: "main.py",
        content: `print("spinning forever -- press Stop to kill me")
n = 0
while True:
    n += 1
    if n % 2_000_000 == 0:
        print("still alive, iteration", n)
`
      }
    ]
  }
};

// harness/template.generated.js
var TEMPLATE = {
  label: "python-starter template",
  entry: "main.py",
  files: [
    {
      "path": "main.py",
      "content": '"""Warsha starter: a program that uses classes from another folder."""\n\nfrom helpers.shapes import Circle, Rectangle\n\n\ndef main():\n    # One list can hold different kinds of objects.\n    shapes = [Circle(2), Rectangle(3, 4)]\n\n    print("=== Warsha starter ===")\n    for shape in shapes:\n        print(shape.describe())  # each class answers in its own way\n\n    total = sum(shape.area() for shape in shapes)\n    print(f"Total area = {total:.2f}")\n\n    # input() waits for you to type one line into the console.\n    name = input("Your name: ")\n    print(f"Hello, {name}! Now open helpers/shapes.py and add a Square.")\n\n\n# Runs main() only when you run this file directly.\nif __name__ == "__main__":\n    main()\n'
    },
    {
      "path": "helpers/shapes.py",
      "content": '"""A very small shapes library: one base class and two shapes."""\n\nimport math\n\n\nclass Shape:\n    """Base class. Every shape has a name and can report its area."""\n\n    def __init__(self, name):\n        self.name = name\n\n    def area(self):\n        # Each subclass gives its own answer.\n        return 0.0\n\n    def describe(self):\n        return f"{self.name}: area = {self.area():.2f}"\n\n\nclass Circle(Shape):\n    def __init__(self, radius):\n        super().__init__("Circle")  # let Shape store the name\n        self.radius = radius\n\n    def area(self):\n        return math.pi * self.radius**2\n\n\nclass Rectangle(Shape):\n    def __init__(self, width, height):\n        super().__init__("Rectangle")\n        self.width = width\n        self.height = height\n\n    def area(self):\n        return self.width * self.height\n'
    }
  ]
};

// harness/harness.js
var SCENARIOS = { template: TEMPLATE, ...PROGRAMS };
var runtime = new PythonRuntime();
var el = (id) => document.getElementById(id);
var state = {
  scenario: "template",
  loaded: false,
  running: false,
  awaitingStdin: false,
  exitCode: void 0,
  output: "",
  // plain-text mirror of the console, for assertions
  progress: []
};
var session = null;
var waiters = { stdin: [], exit: [], output: [] };
function settle(kind, value) {
  const list = waiters[kind];
  waiters[kind] = [];
  for (const w of list) {
    clearTimeout(w.timer);
    w.resolve(value);
  }
}
function waitFor(kind, ms, label) {
  return new Promise((resolve, reject) => {
    const w = { resolve };
    w.timer = setTimeout(() => {
      waiters[kind] = waiters[kind].filter((x) => x !== w);
      reject(new Error(`timed out after ${ms}ms waiting for ${label || kind}`));
    }, ms);
    waiters[kind].push(w);
  });
}
function waitForOutput(needle, ms) {
  if (state.output.includes(needle)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const w = { needle, resolve };
    w.timer = setTimeout(() => {
      waiters.output = waiters.output.filter((x) => x !== w);
      reject(new Error(`timed out after ${ms}ms waiting for output ${JSON.stringify(needle)}`));
    }, ms);
    waiters.output.push(w);
  });
}
function checkOutputWaiters() {
  const hits = waiters.output.filter((w) => state.output.includes(w.needle));
  if (!hits.length) return;
  waiters.output = waiters.output.filter((w) => !hits.includes(w));
  for (const w of hits) {
    clearTimeout(w.timer);
    w.resolve();
  }
}
function log(text, cls) {
  state.output += text;
  const out = el("out");
  const atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 40;
  if (cls) {
    const span = document.createElement("span");
    span.className = cls;
    span.textContent = text;
    out.appendChild(span);
  } else {
    out.appendChild(document.createTextNode(text));
  }
  if (atBottom) out.scrollTop = out.scrollHeight;
  checkOutputWaiters();
}
function setStatus(text) {
  el("stat").textContent = text;
}
function syncButtons() {
  el("run").disabled = state.running;
  el("stop").disabled = !state.running;
  el("selftest").disabled = state.running;
  el("inrow").hidden = !state.awaitingStdin;
}
var io = {
  onStdout(text) {
    log(text);
  },
  onStderr(text) {
    log(text, "err");
  },
  onStdinRequest() {
    state.awaitingStdin = true;
    syncButtons();
    el("stdin").value = "";
    el("stdin").focus();
    settle("stdin");
  },
  onExit(code) {
    state.running = false;
    state.awaitingStdin = false;
    state.exitCode = code;
    session = null;
    log(`
[exit ${code === null ? "null (killed)" : code}]
`, "sys");
    setStatus(`exit ${code === null ? "null (killed)" : code}`);
    syncButtons();
    settle("exit", code);
  }
};
async function load() {
  setStatus("loading...");
  await runtime.load((msg) => {
    state.progress.push(msg);
    el("prog").textContent = msg;
    log(`[${msg}]
`, "sys");
  });
  state.loaded = true;
  el("prog").textContent = `Python ${runtime.version} ready`;
  setStatus("ready");
}
async function run(name = state.scenario) {
  const scenario = SCENARIOS[name];
  if (!scenario) throw new Error(`unknown scenario ${name}`);
  state.scenario = name;
  renderScenarios();
  state.running = true;
  state.exitCode = void 0;
  syncButtons();
  setStatus(`running ${name}...`);
  log(`
[run ${name} -> ${scenario.entry}]
`, "sys");
  await load();
  session = await runtime.run(scenario.files, scenario.entry, io);
  return session;
}
function stop() {
  if (session) session.kill();
}
function send(line) {
  if (!session || !state.awaitingStdin) return false;
  log(line + "\n", "in");
  state.awaitingStdin = false;
  session.writeStdin(line);
  syncButtons();
  return true;
}
function renderScenarios() {
  const box = el("scenarios");
  box.textContent = "";
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    const b = document.createElement("button");
    b.className = "tab";
    b.id = "s-" + name;
    b.textContent = scenario.label;
    b.setAttribute("aria-selected", String(name === state.scenario));
    b.onclick = () => {
      state.scenario = name;
      renderScenarios();
      renderFiles();
    };
    box.appendChild(b);
  }
}
function renderFiles() {
  const scenario = SCENARIOS[state.scenario];
  const box = el("files");
  box.textContent = "";
  for (const file of scenario.files) {
    const h = document.createElement("div");
    h.className = "fname";
    h.textContent = file.path + (file.path === scenario.entry ? "  (entry)" : "");
    const pre = document.createElement("pre");
    pre.className = "fbody";
    pre.textContent = file.content;
    box.append(h, pre);
  }
}
var report = [];
function check(name, ok, detail = "") {
  report.push({ name, ok, detail });
  renderReport();
  return ok;
}
function renderReport() {
  const box = el("report");
  box.textContent = "";
  for (const r of report) {
    const row = document.createElement("div");
    row.className = "row " + (r.ok ? "pass" : "fail");
    row.textContent = `${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  -- " + r.detail : ""}`;
    box.appendChild(row);
  }
  const failed = report.filter((r) => !r.ok).length;
  el("summary").textContent = report.length ? `${report.length - failed}/${report.length} checks passed` : "";
  el("summary").className = failed ? "bad" : "ok";
}
function lastLine() {
  const lines = state.output.split("\n");
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.length ? lines[lines.length - 1] : "";
}
async function selfTest() {
  report.length = 0;
  renderReport();
  try {
    el("out").textContent = "";
    state.output = "";
    await run("template");
    await waitFor("stdin", 9e4, "template input()");
    const beforeRead = state.output;
    check(
      "1a template: multi-file import ran (helpers.shapes)",
      beforeRead.includes("Circle: area = 12.57") && beforeRead.includes("Rectangle: area = 12.00"),
      JSON.stringify(beforeRead.slice(0, 60))
    );
    check("1b template: computed total", beforeRead.includes("Total area = 24.57"));
    check(
      "1c template: prompt visible while blocked (no flush)",
      lastLine() === "Your name: ",
      JSON.stringify(lastLine())
    );
    send("Warsha");
    let code = await waitFor("exit", 3e4, "template exit");
    check("1d template: exit code 0", code === 0, `got ${code}`);
    check("1e template: used the line we wrote", state.output.includes("Hello, Warsha!"));
    await run("input-twice");
    await waitFor("stdin", 3e4, "first input()");
    check("2a first prompt shown while blocked", lastLine() === "first number: ", JSON.stringify(lastLine()));
    send("3");
    await waitFor("stdin", 3e4, "second input()");
    check("2b second prompt shown while blocked", lastLine() === "second number: ", JSON.stringify(lastLine()));
    send("4");
    code = await waitFor("exit", 3e4, "input-twice exit");
    check("2c both lines reached Python", state.output.includes("3 + 4 = 7"));
    check("2d exit code 0", code === 0, `got ${code}`);
    await run("partial-prompt");
    const cases = [
      ["A) input('prompt: ') -> ", "alpha"],
      ["B) print(end='') then bare input() -> ", "beta"],
      ["C) sys.stdout.write() then bare input() -> ", "gamma"],
      ["D) partials: one two -> ", "delta"]
    ];
    for (const [expected, answer] of cases) {
      await waitFor("stdin", 3e4, `prompt ${expected}`);
      check(`3 partial line before read: ${expected.slice(0, 2)}`, lastLine() === expected, JSON.stringify(lastLine()));
      send(answer);
    }
    code = await waitFor("exit", 3e4, "partial-prompt exit");
    check("3e all reads completed, no EOFError", state.output.includes("all reads completed, no EOFError"));
    check("3f exit code 0", code === 0, `got ${code}`);
    await run("traceback");
    code = await waitFor("exit", 3e4, "traceback exit");
    check("4a student file + line in traceback", /File "main\.py", line 4/.test(state.output), firstMatch(/File "main\.py"[^\n]*/));
    check("4b helper file + line in traceback", /File "helpers\/boom\.py", line 3/.test(state.output), firstMatch(/File "helpers\/boom\.py"[^\n]*/));
    check("4c no absolute FS paths leaked", !state.output.includes("/home/pyodide"));
    check("4d exit code non-null and non-zero", code !== null && code !== 0, `got ${code}`);
    await run("infinite-loop");
    await waitForOutput("still alive", 3e4);
    const killed = waitFor("exit", 1e4, "kill exit");
    const t0 = performance.now();
    stop();
    code = await killed;
    check("5a kill() ends the session with exit null", code === null, `got ${code}`);
    check("5b kill() is fast", performance.now() - t0 < 1e3, `${Math.round(performance.now() - t0)}ms`);
    const t1 = performance.now();
    await run("input-twice");
    await waitFor("stdin", 6e4, "input() after kill");
    const rewarm = Math.round(performance.now() - t1);
    send("10");
    await waitFor("stdin", 3e4, "second input() after kill");
    send("32");
    code = await waitFor("exit", 3e4, "exit after kill");
    check("5c run() works after kill()", code === 0 && state.output.includes("10 + 32 = 42"), `re-warm ${rewarm}ms`);
  } catch (error) {
    check("self-test completed without error", false, String(error && error.message ? error.message : error));
  }
  const failed = report.filter((r) => !r.ok).length;
  setStatus(failed ? `SELF-TEST FAILED (${failed})` : "SELF-TEST PASSED");
  return { passed: report.length - failed, failed, report };
}
function firstMatch(re) {
  const m = state.output.match(re);
  return m ? m[0] : "(not found)";
}
el("run").onclick = () => {
  run().catch((e) => log(`
[harness error] ${e}
`, "err"));
};
el("stop").onclick = stop;
el("clear").onclick = () => {
  el("out").textContent = "";
  state.output = "";
};
el("selftest").onclick = () => selfTest();
el("send").onclick = () => send(el("stdin").value);
el("stdin").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    send(el("stdin").value);
  }
});
var isolated = self.crossOriginIsolated === true && typeof SharedArrayBuffer === "function";
el("iso").textContent = isolated ? "crossOriginIsolated: true - SharedArrayBuffer: ok" : `crossOriginIsolated: ${self.crossOriginIsolated} - SAB: ${typeof SharedArrayBuffer}`;
el("iso").className = isolated ? "ok" : "bad";
renderScenarios();
renderFiles();
syncButtons();
setStatus(isolated ? "idle" : "not cross-origin isolated -- reload the page");
window.harness = { state, report, run, stop, send, selfTest, load, waitFor, waitForOutput, runtime };
