/* Warsha Python runtime -- the notebook kernel (Python side).
 *
 * Imported by worker.js and run once at boot, only in a worker started with
 * `kernel: true` (PythonRuntime's notebook instance). It defines, in the same
 * Pyodide globals as RUNNER and DEBUGGER:
 *
 *   _warsha_run_cell(nb, cell_path, code, source, magic, debug)
 *        run one cell in notebook `nb`'s namespace; returns a status string
 *   _warsha_kernel_restart(nb)     drop that notebook's namespace
 *   _warsha_pip_prepare(json)      async: install what a cell's pip lines name
 *
 * It is deliberately NOT _warsha_run: that one runs one entry file fresh as
 * __main__ (clearing user modules and linecache every time), which is the
 * opposite of a kernel. Here one namespace per notebook lives until restart.
 *
 * The cell's code arrives already rewritten from IPython syntax by the app
 * (app/src/notebook/magics.ts): every %magic / !shell line became a call into
 * this file's `_warsha_k` helper ON THE SAME LINE, so line N of `code` is line
 * N of `source`. The code is compiled under the cell's path
 * ("nb.ipynb#cell=<id>") and the ORIGINAL source is registered in linecache
 * under that path, so tracebacks quote what the student typed and the
 * debugger's frames, breakpoints and stop arrow all speak cell-local lines.
 *
 * Same String.raw rule as RUNNER: no backtick and no dollar-brace pair
 * anywhere below (chr(96) / chr(36) stand in where Python needs them).
 */

export const KERNEL = String.raw`
import ast as _wast, base64 as _wb64, builtins as _wbuiltins, io as _wio, re as _wre, shlex as _wshlex, time as _wtime
import json as _wkjson
import _warsha_kernel_js

_WARSHA_HOME = "/home/pyodide/.warsha"
os.makedirs(_WARSHA_HOME, exist_ok=True)
if _WARSHA_HOME not in sys.path:
    sys.path.append(_WARSHA_HOME)

# matplotlib's default backend in Pyodide draws into the page's DOM, which a
# worker does not have. This one is Agg plus a show() that hands every open
# figure to the notebook as a PNG -- what matplotlib-inline does in Jupyter.
# It lives outside the project dir so it never shows up as a student's file.
_WARSHA_BACKEND = "\n".join([
    "from matplotlib.backends.backend_agg import FigureCanvasAgg as FigureCanvas",
    "from matplotlib.backend_bases import FigureManagerBase as FigureManager",
    "def show(*args, **kwargs):",
    "    import __main__",
    "    __main__._warsha_flush_figures()",
    "",
])
with open(_WARSHA_HOME + "/_warsha_inline.py", "w") as _f:
    _f.write(_WARSHA_BACKEND)
os.environ["MPLBACKEND"] = "module://_warsha_inline"

_WARSHA_BT = chr(96)
_WARSHA_DISPLAY_LIMIT = 8 * 1024 * 1024


class _WarshaUsageError(Exception):
    """A misused magic. Shown as one line, like IPython's UsageError -- no traceback."""


class _WarshaSList(list):
    """What !cmd captures: a list of lines with IPython's .n/.s/.l views."""

    @property
    def n(self):
        return "\n".join(self)

    @property
    def s(self):
        return " ".join(self)

    @property
    def l(self):
        return list(self)


# --- display ----------------------------------------------------------------

_WARSHA_REPRS = (
    ("text/html", "_repr_html_"),
    ("text/markdown", "_repr_markdown_"),
    ("image/svg+xml", "_repr_svg_"),
    ("image/png", "_repr_png_"),
    ("image/jpeg", "_repr_jpeg_"),
    ("text/latex", "_repr_latex_"),
    ("application/json", "_repr_json_"),
)


def _warsha_plain(obj):
    import pprint
    try:
        if isinstance(obj, (dict, list, tuple, set, frozenset)):
            return pprint.pformat(obj, width=79, sort_dicts=False)
        return repr(obj)
    except Exception as e:
        return "<" + type(obj).__name__ + " object (repr failed: " + type(e).__name__ + ")>"


def _warsha_mimebundle(obj):
    """The rich representations an object offers, Jupyter's way: _repr_mimebundle_
    first, then each _repr_*_ method, then text/plain from repr()."""
    data, meta = {}, {}
    if not isinstance(obj, type):
        m = getattr(obj, "_repr_mimebundle_", None)
        if callable(m):
            try:
                r = m(include=None, exclude=None)
                if isinstance(r, tuple):
                    r, md = r
                    if isinstance(md, dict):
                        meta.update(md)
                if isinstance(r, dict):
                    data.update(r)
            except Exception:
                pass
        for mime, attr in _WARSHA_REPRS:
            if mime in data:
                continue
            f = getattr(obj, attr, None)
            if not callable(f):
                continue
            try:
                v = f()
            except Exception:
                continue
            if isinstance(v, tuple) and len(v) == 2:
                v, md = v
                if isinstance(md, dict):
                    meta[mime] = md
            if v is None:
                continue
            if mime in ("image/png", "image/jpeg"):
                if isinstance(v, (bytes, bytearray)):
                    v = _wb64.b64encode(bytes(v)).decode("ascii")
                if not isinstance(v, str):
                    continue
            elif mime != "application/json" and not isinstance(v, str):
                continue
            data[mime] = v
    if "text/plain" not in data:
        data["text/plain"] = _warsha_plain(obj)
    for mime, v in list(data.items()):
        if isinstance(v, (bytes, bytearray)):
            data[mime] = _wb64.b64encode(bytes(v)).decode("ascii")
    return data, meta


def _warsha_publish(kind, output):
    sys.stdout.flush()
    sys.stderr.flush()
    try:
        text = _wkjson.dumps(output, default=str)
    except Exception:
        text = _wkjson.dumps({"output_type": "stream", "name": "stderr", "text": "[Warsha: an output could not be shown]\n"})
        kind = "display"
    if len(text) > _WARSHA_DISPLAY_LIMIT:
        text = _wkjson.dumps({"output_type": "stream", "name": "stderr",
                              "text": "[Warsha: an output of " + str(len(text) >> 20) + " MB is too large to show]\n"})
        kind = "display"
    _warsha_kernel_js.publish(kind, text)


_warsha_display_seq = [0]


class _WarshaDisplayHandle:
    def __init__(self, display_id=None):
        if display_id is None:
            _warsha_display_seq[0] += 1
            display_id = "warsha-" + str(_warsha_display_seq[0])
        self.display_id = display_id

    def __repr__(self):
        return "<DisplayHandle display_id=" + str(self.display_id) + ">"

    def display(self, obj, **kwargs):
        display(obj, display_id=self.display_id, **kwargs)

    def update(self, obj, **kwargs):
        display(obj, display_id=self.display_id, update=True, **kwargs)


def display(*objs, include=None, exclude=None, metadata=None, transient=None, display_id=None, raw=False, clear=False, update=False, **kwargs):
    """IPython's display(): publish each object's richest representations as an output."""
    if clear:
        clear_output(wait=True)
    handle = None
    if display_id is True:
        handle = _WarshaDisplayHandle()
    elif display_id:
        handle = _WarshaDisplayHandle(display_id)
    for obj in objs:
        if raw and isinstance(obj, dict):
            data, meta = dict(obj), {}
        else:
            data, meta = _warsha_mimebundle(obj)
        if include:
            data = {k: v for k, v in data.items() if k in include}
        if exclude:
            data = {k: v for k, v in data.items() if k not in exclude}
        if metadata:
            meta.update(metadata)
        out = {"output_type": "display_data", "data": data, "metadata": meta}
        tr = dict(transient or {})
        if handle is not None:
            tr["display_id"] = handle.display_id
        if tr:
            out["transient"] = tr
        _warsha_publish("update" if update else "display", out)
    return handle


def clear_output(wait=False):
    sys.stdout.flush()
    sys.stderr.flush()
    _warsha_kernel_js.clearOutput(bool(wait))


def update_display(obj, *, display_id, **kwargs):
    display(obj, display_id=display_id, update=True, **kwargs)


_wbuiltins.display = display


def _warsha_flush_figures():
    """Every open matplotlib figure becomes a PNG output, then closes -- the inline backend."""
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is None:
        return
    try:
        nums = plt.get_fignums()
    except Exception:
        return
    fmt = _warsha_inline_format[0]
    for num in nums:
        fig = plt.figure(num)
        try:
            buf = _wio.BytesIO()
            if fmt == "svg":
                fig.savefig(buf, format="svg", bbox_inches="tight")
                data = {"image/svg+xml": buf.getvalue().decode("utf-8"), "text/plain": "<" + repr(fig)[1:]}
                display(data, raw=True)
                continue
            # 2x pixels, drawn at 1x CSS size: crisp on a phone's dense screen.
            dpi = fig.dpi * 2
            fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight")
            png = buf.getvalue()
            w = h = None
            if png[:8] == b"\x89PNG\r\n\x1a\n":
                w = int.from_bytes(png[16:20], "big") // 2
                h = int.from_bytes(png[20:24], "big") // 2
            data = {"image/png": _wb64.b64encode(png).decode("ascii"), "text/plain": repr(fig)}
            meta = {"image/png": {"width": w, "height": h}} if w else {}
            display(data, raw=True, metadata=meta)
        except Exception as e:
            sys.stderr.write("[Warsha: could not draw a figure: " + type(e).__name__ + ": " + str(e) + "]\n")
    try:
        plt.close("all")
    except Exception:
        pass


_warsha_inline_format = ["png"]


# --- IPython.display shims --------------------------------------------------

class _WarshaDisplayObject:
    _mime = "text/plain"

    def __init__(self, data=None, url=None, filename=None, metadata=None):
        if filename is not None and data is None:
            with open(filename, "rb" if self._binary else "r") as f:
                data = f.read()
        self.data = data
        self.url = url
        self.filename = filename
        self.metadata = metadata

    _binary = False

    def _repr_mimebundle_(self, include=None, exclude=None):
        return {self._mime: self._value(), "text/plain": "<IPython.core.display." + type(self).__name__ + " object>"}

    def _value(self):
        return self.data if self.data is not None else ""


class HTML(_WarshaDisplayObject):
    _mime = "text/html"


class Markdown(_WarshaDisplayObject):
    _mime = "text/markdown"


class Latex(_WarshaDisplayObject):
    _mime = "text/latex"


class Math(_WarshaDisplayObject):
    _mime = "text/latex"

    def _value(self):
        s = (self.data or "").strip()
        return s if s.startswith("$") else "$$" + s + "$$"


class SVG(_WarshaDisplayObject):
    _mime = "image/svg+xml"

    def _value(self):
        d = self.data
        return d.decode("utf-8") if isinstance(d, bytes) else (d or "")


class JSON(_WarshaDisplayObject):
    _mime = "application/json"


class Pretty(_WarshaDisplayObject):
    def _repr_mimebundle_(self, include=None, exclude=None):
        return {"text/plain": str(self.data)}


class Code(Pretty):
    def __init__(self, data=None, url=None, filename=None, language=None):
        super().__init__(data, url, filename)


class Javascript(_WarshaDisplayObject):
    def _repr_mimebundle_(self, include=None, exclude=None):
        return {"text/plain": "[Warsha does not run JavaScript from a notebook]"}


class IFrame:
    def __init__(self, src, width=600, height=400, **kwargs):
        self.src, self.width, self.height = src, width, height

    def _repr_html_(self):
        return '<iframe src="' + str(self.src) + '" width="' + str(self.width) + '" height="' + str(self.height) + '"></iframe>'


class Image(_WarshaDisplayObject):
    _binary = True

    def __init__(self, data=None, url=None, filename=None, format=None, embed=None, width=None, height=None, **kwargs):
        if isinstance(data, str) and data and not data.startswith("<") and os.path.exists(data):
            filename, data = data, None
        super().__init__(data, url, filename)
        name = (filename or url or "").lower()
        self.format = format or ("jpeg" if name.endswith((".jpg", ".jpeg")) else "png")
        self.width, self.height = width, height

    def _repr_mimebundle_(self, include=None, exclude=None):
        if self.data is None and self.url:
            size = (' width="' + str(self.width) + '"') if self.width else ""
            return {"text/html": '<img src="' + str(self.url) + '"' + size + ">", "text/plain": "<IPython.core.display.Image object>"}
        mime = "image/jpeg" if self.format == "jpeg" else "image/png"
        md = {}
        if self.width:
            md["width"] = self.width
        if self.height:
            md["height"] = self.height
        raw = self.data if isinstance(self.data, (bytes, bytearray)) else b""
        return ({mime: _wb64.b64encode(bytes(raw)).decode("ascii"), "text/plain": "<IPython.core.display.Image object>"},
                {mime: md} if md else {})


def display_html(*objs, raw=False, **kw):
    display(*[HTML(o) if raw else o for o in objs])


def display_markdown(*objs, raw=False, **kw):
    display(*[Markdown(o) if raw else o for o in objs])


def _warsha_install_ipython_shim():
    """from IPython.display import display, HTML -- the import notebooks start with.
    IPython.get_ipython() deliberately answers None, so libraries that probe for
    a real IPython (matplotlib, tqdm) take their plain path instead of reaching
    for event hooks this kernel does not have. The builtin get_ipython() in a
    cell's namespace is the kernel's own small shim."""
    if "IPython" in sys.modules:
        return
    disp = _wtypes.ModuleType("IPython.display")
    for name in ("display", "clear_output", "update_display", "HTML", "Markdown", "Latex", "Math", "SVG", "JSON",
                 "Image", "IFrame", "Javascript", "Pretty", "Code", "display_html", "display_markdown"):
        setattr(disp, name, globals()[name if name != "display" else "display"])
    disp.DisplayHandle = _WarshaDisplayHandle
    core = _wtypes.ModuleType("IPython.core")
    core.display = disp
    ip = _wtypes.ModuleType("IPython")
    ip.display = disp
    ip.core = core
    ip.get_ipython = lambda: None
    ip.version_info = (8, 0, 0, "warsha")
    ip.__version__ = "8.0.0"
    sys.modules["IPython"] = ip
    sys.modules["IPython.display"] = disp
    sys.modules["IPython.core"] = core
    sys.modules["IPython.core.display"] = disp


_warsha_install_ipython_shim()


# --- input(): Interrupt while parked in input() -------------------------------

_warsha_real_input = _wbuiltins.input


def _warsha_input(prompt=""):
    try:
        return _warsha_real_input(prompt)
    except EOFError:
        # The worker answers EOF when Interrupt arrives during the read.
        if _warsha_kernel_js.stdinInterrupted():
            raise KeyboardInterrupt from None
        raise


_wbuiltins.input = _warsha_input


# --- time formatting (IPython's) ----------------------------------------------

def _warsha_fmt_time(t):
    if t >= 60:
        m, s = divmod(t, 60)
        return str(int(m)) + "min " + str(round(s, 1)) + "s"
    units = ("s", "ms", "µs", "ns")
    scale = (1.0, 1e3, 1e6, 1e9)
    i = 0
    if t > 0:
        import math
        i = min(max(-int(math.floor(math.log10(t)) // 3), 0), 3)
    return ("%.3g" % (t * scale[i])) + " " + units[i]


# --- pip --------------------------------------------------------------------

_WARSHA_PIP_NOTE = ("Warsha runs Python inside your browser (Pyodide), so it can install pure-Python "
                    "packages and the ones Pyodide provides -- not packages that need native code "
                    "(e.g. torch, tensorflow).")


def _warsha_pip_parse(args):
    try:
        words = _wshlex.split(args)
    except ValueError as e:
        return {"cmd": "error", "error": str(e)}
    if not words:
        return {"cmd": "help"}
    cmd, rest = words[0], words[1:]
    out = {"cmd": cmd, "packages": [], "quiet": False, "deps": True, "pre": False, "files": []}
    i = 0
    while i < len(rest):
        w = rest[i]
        if w in ("-q", "--quiet", "-qq", "-qqq"):
            out["quiet"] = True
        elif w == "--no-deps":
            out["deps"] = False
        elif w == "--pre":
            out["pre"] = True
        elif w in ("-r", "--requirement") and i + 1 < len(rest):
            i += 1
            out["files"].append(rest[i])
        elif w in ("-y", "--yes", "-U", "--upgrade", "--user", "--no-cache-dir", "--force-reinstall", "--quiet"):
            pass
        elif w.startswith("-"):
            pass
        else:
            out["packages"].append(w)
        i += 1
    for path in out["files"]:
        try:
            with open(path) as f:
                for line in f:
                    line = line.split("#", 1)[0].strip()
                    if line and not line.startswith("-"):
                        out["packages"].append(line)
        except OSError as e:
            out.setdefault("errors", []).append("ERROR: Could not open requirements file: " + str(e))
    return out


def _warsha_dist_name(spec):
    return _wre.split(r"[<>=!~\[ ;]", spec, maxsplit=1)[0].strip()


def _warsha_installed_version(name):
    from importlib import metadata
    try:
        return metadata.version(name)
    except Exception:
        return None


async def _warsha_pip_prepare(payload):
    """Run before the cell: every pip install the cell names (installing is async; the cell is not).
    Results are kept for the pip line itself to print when the cell reaches it."""
    plans = [_warsha_pip_parse(a) for a in _wkjson.loads(payload)]
    _warsha_pip_results.clear()
    micropip = None
    for plan in plans:
        lines, ok = list(plan.get("errors", [])), True
        if plan["cmd"] == "install":
            if micropip is None:
                import micropip
            for spec in plan["packages"]:
                name = _warsha_dist_name(spec)
                before = _warsha_installed_version(name)
                if before is not None and not _wre.search(r"[<>=!~]", spec):
                    lines.append("Requirement already satisfied: " + name + " (" + before + ")")
                    continue
                _warsha_kernel_js.progress("Installing " + name + " (one-time)...")
                try:
                    await micropip.install(spec, deps=plan["deps"], pre=plan["pre"])
                    after = _warsha_installed_version(name)
                    lines.append("Successfully installed " + name + ("-" + after if after else ""))
                except Exception as e:
                    ok = False
                    msg = str(e).strip().splitlines()
                    lines.append("ERROR: Could not install " + spec + ": " + (msg[-1] if msg else type(e).__name__))
                    lines.append(_WARSHA_PIP_NOTE)
        _warsha_pip_results.append({"ok": ok, "lines": lines, "quiet": plan.get("quiet", False), "plan": plan})


_warsha_pip_results = []


# --- the mini shell ----------------------------------------------------------

class _WarshaShell:
    """Just enough of a shell over the project's files for the commands
    notebooks actually use: ls, cat, head, tail, wc, grep, echo, pwd, mkdir,
    rm, mv, cp, touch, find, unzip, wget/curl, python file.py. Pipes and
    > / >> work. Anything else says plainly that it is not available."""

    def __init__(self, kernel):
        self.k = kernel
        # Like a real ls: columns for a person, one name per line into a pipe or a capture.
        self.tty = True

    def run(self, line):
        status = 0
        for part in _wre.split(r"\s*(?:&&|;)\s*", line):
            if part.strip():
                out, status = self.pipeline(part)
                if out:
                    yield out
                if status != 0 and "&&" in line:
                    break

    def pipeline(self, line):
        target, mode = None, "w"
        m = _wre.match(r"^(.*?)\s*(>>?)\s*(\S+)\s*$", line)
        if m and "'" not in m.group(3) and '"' not in m.group(3):
            line, mode, target = m.group(1), "a" if m.group(2) == ">>" else "w", m.group(3)
        data, status = None, 0
        stages = line.split("|")
        for i, stage in enumerate(stages):
            self.piped = i < len(stages) - 1 or target is not None or not self.tty
            try:
                words = _wshlex.split(stage)
            except ValueError as e:
                return ("sh: " + str(e) + "\n", 2)
            if not words:
                continue
            fn = getattr(self, "c_" + words[0].replace("-", "_").replace(".", "_"), None)
            if fn is None:
                sys.stderr.write("sh: " + words[0] + ": command not available in Warsha's notebook shell"
                                 " (it has ls, cat, head, tail, wc, grep, echo, pwd, mkdir, rm, mv, cp, touch,"
                                 " find, unzip, wget, curl and python)\n")
                return ("", 127)
            try:
                data = fn(words[1:], data)
            except _WarshaShellError as e:
                sys.stderr.write(words[0] + ": " + str(e) + "\n")
                return ("", 1)
        data = data or ""
        if target is not None:
            with open(target, mode) as f:
                f.write(data)
            return ("", status)
        return (data, status)

    @staticmethod
    def _flags(args):
        flags, rest = set(), []
        for a in args:
            if a.startswith("-") and len(a) > 1 and not a[1:].isdigit():
                flags.update(a.lstrip("-") if not a.startswith("--") else [a[2:]])
            else:
                rest.append(a)
        return flags, rest

    def _read(self, path):
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                return f.read()
        except FileNotFoundError:
            raise _WarshaShellError(path + ": No such file or directory")
        except IsADirectoryError:
            raise _WarshaShellError(path + ": Is a directory")

    def c_pwd(self, args, data):
        return os.getcwd() + "\n"

    def c_echo(self, args, data):
        return " ".join(args) + "\n"

    def c_ls(self, args, data):
        flags, paths = self._flags(args)
        out = []
        for p in paths or ["."]:
            if not os.path.exists(p):
                raise _WarshaShellError("cannot access '" + p + "': No such file or directory")
            names = sorted(os.listdir(p)) if os.path.isdir(p) else [p]
            if "a" not in flags:
                names = [n for n in names if not n.startswith(".") and n != "__pycache__"]
            if len(paths) > 1:
                out.append(p + ":")
            if "l" in flags:
                for n in names:
                    full = os.path.join(p, n) if os.path.isdir(p) else n
                    st = os.stat(full)
                    kind = "d" if os.path.isdir(full) else "-"
                    out.append(kind + "rw-r--r-- " + str(st.st_size).rjust(8) + " " + n + ("/" if kind == "d" else ""))
            else:
                shown = [n + ("/" if os.path.isdir(os.path.join(p, n)) else "") for n in names]
                if shown:
                    out.append(("\n" if self.piped else "  ").join(shown))
        text = "\n".join(x for x in out if x is not None)
        return text + "\n" if text else ""

    def c_cat(self, args, data):
        _, paths = self._flags(args)
        return "".join(self._read(p) for p in paths) if paths else (data or "")

    def _lines_of(self, args, data):
        n = 10
        flags, rest = [], []
        i = 0
        while i < len(args):
            a = args[i]
            if a == "-n" and i + 1 < len(args):
                n = int(args[i + 1].lstrip("+-") or 10)
                i += 1
            elif a.startswith("-") and a[1:].isdigit():
                n = int(a[1:])
            else:
                rest.append(a)
            i += 1
        text = "".join(self._read(p) for p in rest) if rest else (data or "")
        return n, text.splitlines(True)

    def c_head(self, args, data):
        n, lines = self._lines_of(args, data)
        return "".join(lines[:n])

    def c_tail(self, args, data):
        n, lines = self._lines_of(args, data)
        return "".join(lines[-n:] if n else [])

    def c_wc(self, args, data):
        flags, paths = self._flags(args)
        rows = []
        for p, text in ([(p, self._read(p)) for p in paths] if paths else [("", data or "")]):
            counts = {"l": text.count("\n"), "w": len(text.split()), "c": len(text.encode())}
            keys = [k for k in "lwc" if k in flags] or ["l", "w", "c"]
            rows.append(" ".join(str(counts[k]).rjust(7) for k in keys) + (" " + p if p else ""))
        return "\n".join(rows) + "\n"

    def c_grep(self, args, data):
        flags, rest = self._flags(args)
        if not rest:
            raise _WarshaShellError("usage: grep [-inv] PATTERN [FILE...]")
        pat = _wre.compile(rest[0], _wre.I if "i" in flags else 0)
        sources = [(p, self._read(p)) for p in rest[1:]] if rest[1:] else [("", data or "")]
        out = []
        for p, text in sources:
            for no, line in enumerate(text.splitlines(), 1):
                if bool(pat.search(line)) != ("v" in flags):
                    prefix = (p + ":" if len(sources) > 1 else "") + (str(no) + ":" if "n" in flags else "")
                    out.append(prefix + line)
        return "\n".join(out) + ("\n" if out else "")

    def c_mkdir(self, args, data):
        _, paths = self._flags(args)
        for p in paths:
            os.makedirs(p, exist_ok=True)
        return ""

    def c_touch(self, args, data):
        for p in self._flags(args)[1]:
            with open(p, "a"):
                pass
        return ""

    def c_rm(self, args, data):
        flags, paths = self._flags(args)
        for p in paths:
            if os.path.isdir(p):
                if "r" not in flags and "R" not in flags:
                    raise _WarshaShellError("cannot remove '" + p + "': Is a directory")
                shutil.rmtree(p)
            elif os.path.exists(p):
                os.remove(p)
            elif "f" not in flags:
                raise _WarshaShellError("cannot remove '" + p + "': No such file or directory")
        return ""

    def c_mv(self, args, data):
        _, paths = self._flags(args)
        if len(paths) < 2:
            raise _WarshaShellError("missing destination file operand")
        for p in paths[:-1]:
            shutil.move(p, paths[-1])
        return ""

    def c_cp(self, args, data):
        flags, paths = self._flags(args)
        if len(paths) < 2:
            raise _WarshaShellError("missing destination file operand")
        for p in paths[:-1]:
            if os.path.isdir(p):
                shutil.copytree(p, os.path.join(paths[-1], os.path.basename(p)) if os.path.isdir(paths[-1]) else paths[-1])
            else:
                shutil.copy(p, paths[-1])
        return ""

    def c_find(self, args, data):
        root = args[0] if args and not args[0].startswith("-") else "."
        pattern = args[args.index("-name") + 1] if "-name" in args and args.index("-name") + 1 < len(args) else None
        import fnmatch
        out = []
        for d, dirs, files in os.walk(root):
            dirs[:] = [x for x in dirs if x != "__pycache__"]
            for n in sorted(dirs + files):
                if pattern is None or fnmatch.fnmatch(n, pattern):
                    out.append(os.path.join(d, n))
        return "\n".join(out) + ("\n" if out else "")

    def c_unzip(self, args, data):
        import zipfile
        flags, rest = self._flags([a for a in args if a != "-d"])
        dest = args[args.index("-d") + 1] if "-d" in args else "."
        rest = [r for r in rest if r != dest]
        if not rest:
            raise _WarshaShellError("usage: unzip FILE [-d DIR]")
        with zipfile.ZipFile(rest[0]) as z:
            z.extractall(dest)
            return "" if "q" in flags else "Archive:  " + rest[0] + "\n" + "".join("  inflating: " + n + "\n" for n in z.namelist())

    def _fetch(self, url):
        from js import XMLHttpRequest
        req = XMLHttpRequest.new()
        req.open("GET", url, False)
        req.overrideMimeType("text/plain; charset=x-user-defined")
        try:
            req.send(None)
        except Exception as e:
            raise _WarshaShellError("could not download " + url + " (the site must allow downloads from other sites, CORS)")
        if req.status >= 400 or req.status == 0:
            raise _WarshaShellError(url + ": HTTP " + str(req.status))
        return bytes(ord(c) & 0xFF for c in req.responseText)

    def c_wget(self, args, data):
        flags, rest = [], []
        out_name = None
        i = 0
        while i < len(args):
            if args[i] in ("-O", "-o", "--output-document") and i + 1 < len(args):
                out_name = args[i + 1]
                i += 1
            elif not args[i].startswith("-"):
                rest.append(args[i])
            i += 1
        if not rest:
            raise _WarshaShellError("missing URL")
        url = rest[0]
        body = self._fetch(url)
        name = out_name or (url.split("?", 1)[0].rstrip("/").rsplit("/", 1)[-1] or "index.html")
        if name == "-":
            return body.decode("utf-8", errors="replace")
        with open(name, "wb") as f:
            f.write(body)
        return "Saved " + name + " (" + str(len(body)) + " bytes)\n"

    def c_curl(self, args, data):
        if "-o" in args or "-O" in args:
            if "-O" in args and "-o" not in args:
                return self.c_wget([a for a in args if a not in ("-O", "-L", "-s", "-sL", "-Ls")], data)
            return self.c_wget(args, data)
        urls = [a for a in args if not a.startswith("-")]
        if not urls:
            raise _WarshaShellError("no URL specified")
        return self._fetch(urls[0]).decode("utf-8", errors="replace")

    def c_python(self, args, data):
        if not args or args[0] in ("-V", "--version"):
            return "Python " + sys.version.split()[0] + "\n"
        if args[0] == "-c" and len(args) > 1:
            exec(compile(args[1], "<string>", "exec"), {"__name__": "__main__"})
            return ""
        if args[0] == "-m" and len(args) > 1 and args[1] == "pip":
            raise _WarshaShellError("use %pip install NAME in a cell")
        self.k.run_file(args[0], args[1:], interactive=False)
        return ""

    c_python3 = c_python

    def c_which(self, args, data):
        return "".join("/usr/bin/" + a + "\n" for a in args if hasattr(self, "c_" + a))


class _WarshaShellError(Exception):
    pass


# --- the kernel ----------------------------------------------------------------

class _WarshaKernel:
    """One notebook's interpreter state: its namespace, its execution counter,
    and the source of every cell it has run (for linecache)."""

    def __init__(self, path):
        self.path = path
        self.count = 0
        self.labels = {}
        self.sources = {}
        self.current = None
        self.shell = _WarshaShell(self)
        self.ns = {}
        self.reset()

    def reset(self):
        ns = self.ns
        ns.clear()
        inputs = [""]
        outputs = {}
        ns.update({
            "__name__": "__main__", "__doc__": None, "__builtins__": _wbuiltins,
            "In": inputs, "Out": outputs, "_ih": inputs, "_oh": outputs,
            "_": "", "__": "", "___": "",
            "_warsha_k": self, "get_ipython": self.get_ipython,
            "exit": self.exit_hint, "quit": self.exit_hint,
        })
        self.hidden = set(ns)
        _warsha_hidden_names.update(self.hidden)

    def get_ipython(self):
        return self

    @property
    def user_ns(self):
        return self.ns

    def exit_hint(self, *a):
        print("To stop this notebook's Python, use Restart in the notebook toolbar.")

    def run_line_magic(self, name, line):
        return self.line_magic(name, line, 1)

    def run_cell_magic(self, name, line, cell):
        return self.cell_magic({"name": name, "args": line, "body": cell, "python": name in ("time", "timeit", "capture")},
                               cell, self.current or "<cell>", None)

    # --- running ------------------------------------------------------------

    def register_sources(self):
        # linecache outlives nothing here (a fresh worker per kernel), but the
        # runner of a plain Run can clear it; re-register every cell each time.
        for path, src in self.sources.items():
            linecache.cache[path] = (len(src), None, src.splitlines(True), path)

    def run(self, cell_path, code, source, magic, debug):
        proj = _WARSHA_PROJ
        if proj not in sys.path:
            sys.path.insert(0, proj)
        if not os.getcwd().startswith(proj):
            os.chdir(proj)
        self.count += 1
        n = self.count
        self.labels[cell_path] = n
        self.sources[cell_path] = source
        self.register_sources()
        self.ns["In"].append(source)
        self.ns["_i" + str(n)] = source
        self.ns["_i"] = source
        self.current = cell_path
        _warsha_kernel_js.executeInput(n)
        dbg = None
        if debug is not None:
            dbg = _WarshaDebugger(proj, bool(_wkjson.loads(debug).get("stopOnEntry")))
        try:
            if magic is not None:
                ok = self.cell_magic(_wkjson.loads(magic), code, cell_path, dbg)
            else:
                ok = self.run_code(code, cell_path, dbg, True)
        except _WarshaUsageError as e:
            self.usage_error(e)
            ok = False
        _warsha_flush_figures()
        sys.stdout.flush()
        sys.stderr.flush()
        _warsha_close_open_files(proj, close=False)
        return "ok" if ok is not False else "error"

    def compile_cell(self, code, filename, interactive):
        """(body, last expression or None), or raises SyntaxError. IPython's
        rule: the cell's last statement, if it is an expression and the cell
        does not end with a semicolon, is evaluated for display."""
        tree = compile(code, filename, "exec", _wast.PyCF_ONLY_AST)
        last = None
        if interactive and tree.body and isinstance(tree.body[-1], _wast.Expr) and not self.ends_with_semicolon(code):
            last = _wast.Expression(tree.body.pop().value)
        body = compile(tree, filename, "exec")
        return body, (compile(last, filename, "eval") if last is not None else None)

    @staticmethod
    def ends_with_semicolon(code):
        for line in reversed(code.splitlines()):
            s = line.split("#", 1)[0].rstrip()
            if s:
                return s.endswith(";")
        return False

    def run_code(self, code, filename, dbg, interactive):
        try:
            body, last = self.compile_cell(code, filename, interactive)
        except SyntaxError as e:
            self.error_output(e, syntax=True)
            return False

        def go():
            exec(body, self.ns)
            if last is not None:
                self.displayhook(eval(last, self.ns))
        return self.guarded(go, dbg)

    def guarded(self, fn, dbg):
        try:
            if dbg is not None:
                sys.settrace(dbg.trace_call)
            try:
                fn()
            finally:
                if dbg is not None:
                    sys.settrace(None)
            return True
        except _WarshaUsageError:
            raise
        except SystemExit as e:
            if e.code not in (None, 0):
                self.error_output(e)
                return False
            return True
        except BaseException as e:
            if dbg is not None:
                try:
                    dbg.stop_exception(e)
                except Exception:
                    pass
            self.error_output(e)
            return False

    def displayhook(self, value):
        if value is None:
            return
        n = self.count
        ns = self.ns
        ns["Out"][n] = value
        ns["___"], ns["__"], ns["_"] = ns["__"], ns["_"], value
        ns["_" + str(n)] = value
        data, meta = _warsha_mimebundle(value)
        _warsha_publish("result", {"output_type": "execute_result", "execution_count": n, "data": data, "metadata": meta})

    # --- errors ---------------------------------------------------------------

    def label(self, match):
        path, line, func = match.group(1), match.group(2), match.group(3)
        n = self.labels.get(path)
        head = "Cell In[" + (str(n) if n is not None else " ") + "], line " + line
        return head + (", in " + func if func and func != "<module>" else "")

    def relabel(self, text):
        text = text.replace(_WARSHA_PROJ + "/", "")
        return _wre.sub(r'File "([^"]*#cell=[^"]*)", line (\d+)(?:, in (.+))?', self.label, text)

    def error_output(self, e, syntax=False):
        if syntax or isinstance(e, SyntaxError) and not e.__traceback__:
            text = "".join(traceback.format_exception_only(type(e), e))
        else:
            tb = e.__traceback__
            # Drop the kernel's own frames from the top: the student sees their cell first.
            while tb is not None and tb.tb_frame.f_code.co_filename == "<exec>":
                tb = tb.tb_next
            text = _warsha_format(e, tb)
        text = self.relabel(text)
        msg = e.msg if isinstance(e, SyntaxError) and isinstance(e.msg, str) else str(e)
        _warsha_publish("error", {"output_type": "error", "ename": type(e).__name__, "evalue": msg,
                                  "traceback": text.rstrip("\n").split("\n")})

    def usage_error(self, e):
        _warsha_publish("error", {"output_type": "error", "ename": "UsageError", "evalue": str(e),
                                  "traceback": ["UsageError: " + str(e)]})

    # --- magics ---------------------------------------------------------------

    def line_magic(self, name, args, line):
        fn = getattr(self, "m_" + name, None) if _wre.match(r"^[A-Za-z_]\w*$", name or "") else None
        if fn is None:
            hint = _WARSHA_MAGIC_HINTS.get(name)
            raise _WarshaUsageError("Line magic function " + _WARSHA_BT + "%" + name + _WARSHA_BT + " not found."
                                    + (" " + hint if hint else ""))
        return fn(args, line)

    def cell_magic(self, magic, code, cell_path, dbg):
        name, args, body = magic["name"], magic["args"], magic["body"]
        fn = getattr(self, "cm_" + name, None) if _wre.match(r"^[A-Za-z_]\w*$", name or "") else None
        if fn is None:
            hint = _WARSHA_MAGIC_HINTS.get(name)
            raise _WarshaUsageError("Cell magic " + _WARSHA_BT + "%%" + name + _WARSHA_BT + " not found."
                                    + (" " + hint if hint else ""))
        return fn(args, body, code, cell_path, dbg)

    def compile_at(self, src, line, mode):
        """Code typed after a magic on line N, compiled so its frames name the cell and line N."""
        return compile("\n" * (line - 1) + src.strip(), self.current or "<magic>", mode)

    def m_time(self, args, line):
        if not args.strip():
            raise _WarshaUsageError("%time needs a statement: %time total = sum(values)")
        try:
            code, mode = self.compile_at(args, line, "eval"), "eval"
        except SyntaxError:
            code, mode = self.compile_at(args, line, "exec"), "exec"
        c0, w0 = _wtime.process_time(), _wtime.perf_counter()
        try:
            value = eval(code, self.ns) if mode == "eval" else exec(code, self.ns)
        finally:
            c, w = _wtime.process_time() - c0, _wtime.perf_counter() - w0
            print("CPU times: user " + _warsha_fmt_time(c) + ", sys: 0 ns, total: " + _warsha_fmt_time(c))
            print("Wall time: " + _warsha_fmt_time(w))
        return value

    def _timeit_args(self, args):
        number, repeat, quiet, ret, rest = None, 7, False, False, []
        words = args.split()
        i = 0
        while i < len(words):
            w = words[i]
            if w == "-n" and i + 1 < len(words):
                number = int(words[i + 1]); i += 2; continue
            if w == "-r" and i + 1 < len(words):
                repeat = int(words[i + 1]); i += 2; continue
            if w == "-q":
                quiet = True; i += 1; continue
            if w == "-o":
                ret = True; i += 1; continue
            rest = words[i:]
            break
        stmt = args[args.find(rest[0]):] if rest else ""
        return number, repeat, quiet, ret, stmt

    def _timeit(self, stmt, number, repeat, quiet, ret, setup="pass"):
        import timeit, statistics
        timer = timeit.Timer(stmt, setup, globals=self.ns)
        if number is None:
            number = 1
            for _ in range(10):
                if timer.timeit(number) >= 0.2:
                    break
                number *= 10
        runs = [t / number for t in timer.repeat(repeat, number)]
        mean = statistics.mean(runs)
        std = statistics.pstdev(runs) if len(runs) > 1 else 0.0
        if not quiet:
            print(_warsha_fmt_time(mean) + " ± " + _warsha_fmt_time(std) + " per loop (mean ± std. dev. of "
                  + str(repeat) + " run" + ("s" if repeat != 1 else "") + ", " + format(number, ",") + " loop"
                  + ("s" if number != 1 else "") + " each)")
        if ret:
            return {"average": mean, "stdev": std, "loops": number, "repeat": repeat, "all_runs": runs}

    def m_timeit(self, args, line):
        number, repeat, quiet, ret, stmt = self._timeit_args(args)
        if not stmt.strip():
            raise _WarshaUsageError("%timeit needs a statement: %timeit sorted(values)")
        return self._timeit(stmt, number, repeat, quiet, ret)

    def m_matplotlib(self, args, line):
        mode = args.strip() or "inline"
        if mode not in ("inline", "agg"):
            print("Warsha draws plots inline; %matplotlib " + mode + " is shown inline instead.")

    def m_config(self, args, line):
        m = _wre.match(r"^InlineBackend\.figure_formats?\s*=\s*\{?\s*['\"](\w+)['\"]", args.strip())
        if m:
            _warsha_inline_format[0] = "svg" if m.group(1) == "svg" else "png"
            return
        print("%config: only InlineBackend.figure_format is supported here; ignored.")

    def user_names(self):
        out = []
        for k, v in self.ns.items():
            if k in self.hidden or k.startswith("_") or isinstance(v, _wtypes.ModuleType):
                continue
            out.append(k)
        return out

    def m_who_ls(self, args, line):
        kinds = args.split()
        return sorted(k for k in self.user_names() if not kinds or type(self.ns[k]).__name__ in kinds)

    def m_who(self, args, line):
        names = self.m_who_ls(args, line)
        print("\t".join(names) if names else "Interactive namespace is empty.")

    def m_whos(self, args, line):
        names = self.m_who_ls(args, line)
        if not names:
            print("Interactive namespace is empty.")
            return
        rows = [(k, type(self.ns[k]).__name__, _warsha_safe_repr(self.ns[k]).replace("\n", " ")[:60]) for k in names]
        w1 = max(8, max(len(r[0]) for r in rows))
        w2 = max(4, max(len(r[1]) for r in rows))
        print("Variable".ljust(w1) + "   " + "Type".ljust(w2) + "   Data/Info")
        print("-" * (w1 + w2 + 16))
        for a, b, c in rows:
            print(a.ljust(w1) + "   " + b.ljust(w2) + "   " + c)

    def m_reset(self, args, line):
        if "-f" not in args.split():
            ans = input("Once deleted, variables cannot be recovered. Proceed (y/[n])? ")
            if ans.strip().lower() not in ("y", "yes"):
                print("Nothing done.")
                return
        for k in self.user_names():
            del self.ns[k]
        self.ns["Out"].clear()

    def run_file(self, path, argv, interactive):
        if path.endswith(".ipynb"):
            raise _WarshaUsageError("%run of a notebook is not supported yet; open it and use Run all.")
        try:
            with open(path) as f:
                src = f.read()
        except FileNotFoundError:
            raise _WarshaUsageError("File " + _WARSHA_BT + path + _WARSHA_BT + " not found.")
        rel = os.path.relpath(os.path.abspath(path), _WARSHA_PROJ)
        g = self.ns if interactive else {"__name__": "__main__", "__file__": rel, "__builtins__": _wbuiltins}
        old_argv = sys.argv
        sys.argv = [path] + list(argv)
        try:
            try:
                exec(compile(src, rel, "exec"), g)
            except SystemExit as e:
                if e.code not in (None, 0):
                    raise
        finally:
            sys.argv = old_argv
            if not interactive:
                for k, v in g.items():
                    if not (k.startswith("__") and k.endswith("__")):
                        self.ns[k] = v

    def m_run(self, args, line):
        words = _wshlex.split(args)
        interactive = "-i" in words
        words = [w for w in words if w not in ("-i", "-n", "-t")]
        if not words:
            raise _WarshaUsageError("%run needs a file: %run helpers.py")
        self.run_file(words[0], words[1:], interactive)

    def m_pwd(self, args, line):
        return os.getcwd()

    def m_cd(self, args, line):
        target = os.path.abspath(os.path.expanduser(args.strip()) if args.strip() else _WARSHA_PROJ)
        if not target.startswith(_WARSHA_PROJ):
            raise _WarshaUsageError("%cd stays inside the project folder.")
        os.chdir(target)
        print(target)

    def m_ls(self, args, line):
        self.system("ls " + args)

    def m_env(self, args, line):
        a = args.strip()
        if not a:
            return dict(os.environ)
        if "=" in a:
            k, v = a.split("=", 1)
            os.environ[k.strip()] = v.strip()
            print("env: " + k.strip() + "=" + v.strip())
            return
        return os.environ.get(a)

    def m_pinfo(self, args, line):
        self.pinfo(args.strip(), False)

    def m_pinfo2(self, args, line):
        self.pinfo(args.strip(), True)

    def m_history(self, args, line):
        for i, src in enumerate(self.ns["In"][1:], 1):
            print(src)

    def m_lsmagic(self, args, line):
        lines = sorted("%" + n[2:] for n in dir(self) if n.startswith("m_"))
        cells = sorted("%%" + n[3:] for n in dir(self) if n.startswith("cm_"))
        print("Available line magics:\n" + "  ".join(lines) + "  %pip\n\nAvailable cell magics:\n" + "  ".join(cells))

    def m_load_ext(self, args, line):
        raise _WarshaUsageError("Extensions are not available in Warsha (" + args.strip() + ").")

    # cell magics: (args, raw body, transformed code, cell path, debugger)

    def cm_time(self, args, body, code, path, dbg):
        c0, w0 = _wtime.process_time(), _wtime.perf_counter()
        try:
            return self.run_code(code, path, dbg, True)
        finally:
            c, w = _wtime.process_time() - c0, _wtime.perf_counter() - w0
            print("CPU times: user " + _warsha_fmt_time(c) + ", sys: 0 ns, total: " + _warsha_fmt_time(c))
            print("Wall time: " + _warsha_fmt_time(w))

    def cm_timeit(self, args, body, code, path, dbg):
        number, repeat, quiet, ret, setup = self._timeit_args(args)
        try:
            compiled = compile(code, path, "exec")
        except SyntaxError as e:
            self.error_output(e, syntax=True)
            return False
        if setup.strip():
            exec(setup, self.ns)
        return self.guarded(lambda: self._timeit(lambda: exec(compiled, self.ns), number, repeat, quiet, ret), None)

    def cm_capture(self, args, body, code, path, dbg):
        import contextlib
        out, err = _wio.StringIO(), _wio.StringIO()
        captured = []
        # Displays are captured too: swap the bridge _warsha_publish talks to.
        class _Sink:
            @staticmethod
            def publish(kind, text):
                captured.append(_wkjson.loads(text))

            @staticmethod
            def clearOutput(wait):
                captured.clear()
        try:
            globals()["_warsha_kernel_js"] = _Sink
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                ok = self.run_code(code, path, dbg, True)
        finally:
            globals()["_warsha_kernel_js"] = sys.modules["_warsha_kernel_js"]
        name = args.split()[0] if args.split() and not args.split()[0].startswith("-") else None
        if name:
            self.ns[name] = _WarshaCaptured(out.getvalue(), err.getvalue(), captured)
        return ok

    def cm_writefile(self, args, body, code, path, dbg):
        words = _wshlex.split(args)
        append = "-a" in words or "--append" in words
        words = [w for w in words if w not in ("-a", "--append")]
        if not words:
            raise _WarshaUsageError("%%writefile needs a file name: %%writefile helpers.py")
        target = words[0]
        exists = os.path.exists(target)
        d = os.path.dirname(target)
        if d:
            os.makedirs(d, exist_ok=True)
        with open(target, "a" if append else "w") as f:
            f.write(body if body.endswith("\n") or not body else body + "\n")
        print(("Appending to " if append else "Overwriting " if exists else "Writing ") + target)
        return True

    def _display_body(self, cls, body):
        display(cls(body))
        return True

    def cm_html(self, args, body, code, path, dbg):
        return self._display_body(HTML, body)

    def cm_markdown(self, args, body, code, path, dbg):
        return self._display_body(Markdown, body)

    def cm_latex(self, args, body, code, path, dbg):
        return self._display_body(Latex, body)

    def cm_svg(self, args, body, code, path, dbg):
        return self._display_body(SVG, body)

    def cm_python(self, args, body, code, path, dbg):
        return self.run_code(code, path, dbg, True)

    cm_python3 = cm_python

    def cm_bash(self, args, body, code, path, dbg):
        for line in body.splitlines():
            if line.strip() and not line.strip().startswith("#"):
                self.system(line)
        return True

    cm_sh = cm_bash
    cm_script = cm_bash

    # --- shell, pip, help -----------------------------------------------------

    def expand(self, cmd):
        """IPython's variable expansion in shell lines: {expr} and $name."""
        def brace(m):
            try:
                return str(eval(m.group(1), self.ns))
            except Exception:
                return m.group(0)
        cmd = _wre.sub(r"(?<!\{)\{([^{}]+)\}(?!\})", brace, cmd)
        dollar = chr(36)
        def var(m):
            name = m.group(1)
            return str(self.ns[name]) if name in self.ns else m.group(0)
        cmd = _wre.sub(_wre.escape(dollar) + r"([A-Za-z_]\w*)", var, cmd)
        return cmd.replace("{{", "{").replace("}}", "}")

    def system(self, cmd, capture=False):
        cmd = self.expand(cmd)
        if capture:
            buf = _wio.StringIO()
            import contextlib
            self.shell.tty = False
            try:
                with contextlib.redirect_stdout(buf):
                    for out in self.shell.run(cmd):
                        sys.stdout.write(out)
            finally:
                self.shell.tty = True
            return _WarshaSList(buf.getvalue().splitlines())
        for out in self.shell.run(cmd):
            sys.stdout.write(out)

    def pip(self, index):
        res = _warsha_pip_results[index] if index < len(_warsha_pip_results) else None
        if res is None:
            return
        plan = res["plan"]
        cmd = plan["cmd"]
        if cmd == "install":
            for l in res["lines"]:
                if not res["quiet"] or l.startswith("ERROR"):
                    (sys.stdout if not l.startswith("ERROR") and l != _WARSHA_PIP_NOTE else sys.stderr).write(l + "\n")
            return
        if cmd in ("list", "freeze"):
            import micropip
            pkgs = micropip.list()
            names = sorted(pkgs.keys(), key=str.lower)
            if cmd == "freeze":
                for n in names:
                    print(n + "==" + pkgs[n].version)
                return
            w = max([7] + [len(n) for n in names])
            print("Package".ljust(w) + " Version")
            print("-" * w + " " + "-" * 10)
            for n in names:
                print(n.ljust(w) + " " + pkgs[n].version)
            return
        if cmd == "show":
            for spec in plan["packages"]:
                v = _warsha_installed_version(spec)
                print(("Name: " + spec + "\nVersion: " + v) if v else "WARNING: Package(s) not found: " + spec)
            return
        if cmd == "uninstall":
            import micropip
            for spec in plan["packages"]:
                try:
                    micropip.uninstall(spec)
                    print("Successfully uninstalled " + spec)
                except Exception as e:
                    sys.stderr.write("WARNING: Skipping " + spec + " as it is not installed.\n")
            return
        if cmd == "error":
            raise _WarshaUsageError("pip: " + plan["error"])
        print("Usage: %pip install NAME  |  %pip list  |  %pip show NAME  |  %pip uninstall NAME")

    def pinfo(self, name, detail):
        import inspect
        try:
            obj = eval(name, self.ns)
        except Exception:
            print("Object " + _WARSHA_BT + name + _WARSHA_BT + " not found.")
            return
        rows = []
        try:
            rows.append(("Signature", name.rsplit(".", 1)[-1] + str(inspect.signature(obj))))
        except (TypeError, ValueError):
            pass
        if not callable(obj) or isinstance(obj, type):
            rows.append(("Type", type(obj).__name__))
        if not callable(obj):
            rows.append(("String form", _warsha_safe_repr(obj)))
        doc = inspect.getdoc(obj)
        if detail:
            try:
                rows.append(("Source", "\n" + inspect.getsource(obj)))
            except (TypeError, OSError):
                pass
        if doc and not (detail and any(r[0] == "Source" for r in rows)):
            rows.append(("Docstring", doc))
        elif not doc:
            rows.append(("Docstring", "<no docstring>"))
        try:
            f = inspect.getsourcefile(obj)
            if f:
                rows.append(("File", f.replace(_WARSHA_PROJ + "/", "")))
        except TypeError:
            pass
        if callable(obj):
            rows.append(("Type", type(obj).__name__))
        print("\n".join((k + ":").ljust(12) + " " + v.replace("\n", "\n" + " " * 13) for k, v in rows))


class _WarshaCaptured:
    def __init__(self, stdout, stderr, outputs):
        self.stdout, self.stderr, self.outputs = stdout, stderr, outputs

    def show(self):
        sys.stdout.write(self.stdout)
        sys.stderr.write(self.stderr)
        for o in self.outputs:
            _warsha_publish("display", o)

    def __call__(self):
        self.show()


_WARSHA_MAGIC_HINTS = {
    "debug": "Use the cell's Debug button to step through a cell in Warsha.",
    "javascript": "Warsha does not run JavaScript from a notebook.",
    "js": "Warsha does not run JavaScript from a notebook.",
    "autoreload": "Not needed in Warsha: Restart the kernel to reload edited .py files.",
    "tensorflow_version": "TensorFlow is not available in the browser.",
}

_warsha_kernels = {}


def _warsha_kernel(nb):
    k = _warsha_kernels.get(nb)
    if k is None:
        k = _warsha_kernels[nb] = _WarshaKernel(nb)
    return k


def _warsha_run_cell(nb, cell_path, code, source, magic=None, debug=None):
    return _warsha_kernel(nb).run(cell_path, code, source, magic, debug)


def _warsha_kernel_restart(nb):
    _warsha_kernels.pop(nb, None)
    # Edited helper files should take effect after a restart, as they would in a new process.
    proj = _WARSHA_PROJ
    for name in [n for n, m in list(sys.modules.items())
                 if getattr(m, "__file__", None) and str(m.__file__).startswith(proj)]:
        del sys.modules[name]
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is not None:
        try:
            plt.close("all")
        except Exception:
            pass
    import gc
    gc.collect()
`
