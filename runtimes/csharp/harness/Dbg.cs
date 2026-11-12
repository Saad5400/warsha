using System.Collections;
using System.Globalization;
using System.Reflection;
using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;
using System.Text;

namespace __Warsha;

/// <summary>
/// The debugger's runtime half. A debug run compiles the student's code with a
/// probe before every statement (see Instrumenter.cs); the probes call these
/// methods. The hot path (H) is a few field reads: frame line update, a
/// breakpoint bit, a step-mode check, and a shared-memory poll every
/// <see cref="PollEvery"/> lines (pause flag + breakpoint generation). Only an
/// actual stop allocates: it serialises the frames to JSON, hands them to the
/// worker (which posts them and parks the thread on Atomics.wait), and serves
/// variables(ref) requests until a resume command arrives.
///
/// User code reaches this class through the extern alias `__wdbg`, so nothing
/// here leaks into the student's global namespace. Members are public because
/// the student's assembly calls them; the names are short because every probe
/// spells them.
/// </summary>
[SupportedOSPlatform("browser")]
public static partial class Dbg
{
    // --- JS interop (worker: setModuleImports('runner') → warsha.dbg*) ---------

    /// <summary>bit 1 = pause requested, bit 2 = breakpoint set changed.</summary>
    [JSImport("warsha.dbgPoll", "runner")]
    internal static partial int JsPoll();

    /// <summary>The current breakpoint set as "path\tline" lines.</summary>
    [JSImport("warsha.dbgBreakpoints", "runner")]
    internal static partial string JsBreakpoints();

    /// <summary>Post the stop, then block until a command arrives; returns it.</summary>
    [JSImport("warsha.dbgStop", "runner")]
    internal static partial string JsStop(string json);

    /// <summary>Block until the next command arrives (after answering one).</summary>
    [JSImport("warsha.dbgWait", "runner")]
    internal static partial string JsWait();

    /// <summary>Post a variables(ref) answer to the main thread.</summary>
    [JSImport("warsha.dbgReply", "runner")]
    internal static partial void JsReply(string json);

    // --- state ---------------------------------------------------------------

    private sealed class Frame
    {
        public string Name = "";
        public int File = -1;
        public int Line;
        /// <summary>Locals snapshot taken at the current line (null = none valid).</summary>
        public string[]? N;
        public object?[]? V;
        public object? Self;
        /// <summary>Parameters captured by the exception filter (first pass, before unwinding).</summary>
        public string[]? XN;
        public object?[]? XV;
    }

    private const int PollEvery = 2048;
    private const int ChildCap = 200;

    private static Frame[] _frames = NewFrames(64);
    private static int _depth;
    private static string[] _paths = Array.Empty<string>();
    private static Dictionary<string, int> _fileIds = new(StringComparer.Ordinal);
    private static bool[]?[] _bps = Array.Empty<bool[]?>();
    private static int _countdown;
    /// <summary>0 run, 1 step into, 2 step over, 3 step out.</summary>
    private static int _mode;
    private static int _stepDepth;
    private static bool _entryPending;
    private static bool _pausePending;
    private static bool _inStop;
    private static string _reason = "step";
    private static Assembly? _userAssembly;
    private static readonly List<object> _refs = new();
    private static object? _xObj;
    private static int _xIdx;

    private static Frame[] NewFrames(int n)
    {
        var a = new Frame[n];
        for (var i = 0; i < n; i++) a[i] = new Frame();
        return a;
    }

    internal static void Reset(string[] paths, bool stopOnEntry)
    {
        _paths = paths;
        _fileIds = new Dictionary<string, int>(StringComparer.Ordinal);
        for (var i = 0; i < paths.Length; i++) _fileIds[paths[i]] = i;
        _bps = new bool[]?[paths.Length];
        _depth = 0;
        _mode = stopOnEntry ? 1 : 0;
        _entryPending = stopOnEntry;
        _pausePending = false;
        _inStop = false;
        _refs.Clear();
        _xObj = null;
        _userAssembly = null;
        LoadBreakpoints();
        _countdown = PollEvery;
    }

    internal static void SetUserAssembly(Assembly a) => _userAssembly = a;

    internal static void End()
    {
        for (var i = 0; i < _depth; i++) Clear(_frames[i]);
        _depth = 0;
        _refs.Clear();
        _userAssembly = null;
        _xObj = null;
    }

    private static void Clear(Frame f)
    {
        f.N = null; f.V = null; f.Self = null; f.XN = null; f.XV = null;
    }

    private static void LoadBreakpoints()
    {
        string text;
        try { text = JsBreakpoints(); } catch { return; }
        var next = new bool[]?[_paths.Length];
        foreach (var row in text.Split('\n'))
        {
            var tab = row.LastIndexOf('\t');
            if (tab <= 0) continue;
            if (!_fileIds.TryGetValue(row.Substring(0, tab), out var id)) continue;
            if (!int.TryParse(row.AsSpan(tab + 1), NumberStyles.Integer, CultureInfo.InvariantCulture, out var line) || line <= 0) continue;
            var arr = next[id];
            if (arr is null || arr.Length <= line) Array.Resize(ref arr, Math.Max(line + 1, (arr?.Length ?? 0) * 2));
            arr[line] = true;
            next[id] = arr;
        }
        _bps = next;
    }

    private static void Poll()
    {
        _countdown = PollEvery;
        var r = JsPoll();
        if ((r & 1) != 0) _pausePending = true;
        if ((r & 2) != 0) LoadBreakpoints();
    }

    // --- probes (called by instrumented user code) ----------------------------

    /// <summary>Enter a method/lambda/local function frame.</summary>
    public static void E(string name, object? self)
    {
        if (_depth == _frames.Length)
        {
            var grown = NewFrames(_frames.Length * 2);
            Array.Copy(_frames, grown, _frames.Length);
            _frames = grown;
        }
        var f = _frames[_depth++];
        f.Name = name;
        f.File = -1;
        f.Line = 0;
        Clear(f);
        f.Self = self;
    }

    /// <summary>Leave the innermost frame (finally — also on unwinding).</summary>
    public static void X()
    {
        if (_depth == 0) return;
        Clear(_frames[--_depth]);
        _xObj = null;
    }

    /// <summary>
    /// The per-statement probe. `line` &lt; 0 marks a statement nested on the
    /// same line as its parent (`if (x) return;`): it only counts as a new stop
    /// location when the frame arrives on that line from somewhere else.
    /// Returns true when the program must stop here (the caller then invokes
    /// S/S0 with the locals).
    /// </summary>
    public static bool H(int file, int line)
    {
        if (_inStop || _depth == 0) return false;
        var secondary = line < 0;
        if (secondary) line = -line;
        var f = _frames[_depth - 1];
        var changed = f.Line != line || f.File != file;
        if (changed)
        {
            f.File = file;
            f.Line = line;
            f.N = null;
            f.V = null;
        }
        _xObj = null;
        if (--_countdown <= 0) Poll();
        if (secondary && !changed) return false;
        var b = _bps[file];
        if (b != null && line < b.Length && b[line]) { _reason = "breakpoint"; return true; }
        if (_mode == 0 && !_pausePending) return false;
        if (_pausePending) { _reason = "pause"; return true; }
        switch (_mode)
        {
            case 1:
                _reason = _entryPending ? "entry" : "step";
                return true;
            case 2:
                if (_depth > _stepDepth) return false;
                _reason = "step";
                return true;
            case 3:
                if (_depth >= _stepDepth) return false;
                _reason = "step";
                return true;
        }
        return false;
    }

    /// <summary>Keep a locals snapshot for this line (statements that call user code, so an outer frame can show its locals).</summary>
    public static bool K(string[]? n, object?[]? v, object? self)
    {
        if (_inStop || _depth == 0) return false;
        var f = _frames[_depth - 1];
        f.N = n ?? Array.Empty<string>();
        f.V = v ?? Array.Empty<object?>();
        f.Self = self;
        return false;
    }

    /// <summary>Stop here with these locals.</summary>
    public static void S(string[]? n, object?[]? v, object? self)
    {
        K(n, v, self);
        Stop(_reason, null);
    }

    /// <summary>Stop here with the snapshot K just kept.</summary>
    public static void S0() => Stop(_reason, null);

    /// <summary>
    /// Exception filter on every instrumented body; always false (never
    /// catches). Filters run in the FIRST pass, innermost frame outward, before
    /// any finally has popped a frame — so when the entry method's filter runs,
    /// no user code caught the exception and the frame stack is still intact.
    /// </summary>
    public static bool T(Exception e, string[]? n, object?[]? v, object? self, bool entry)
    {
        if (_inStop || _depth == 0) return false;
        if (!ReferenceEquals(e, _xObj)) { _xObj = e; _xIdx = _depth - 1; }
        else _xIdx--;
        if (_xIdx < 0) return false;
        var f = _frames[_xIdx];
        f.XN = n ?? Array.Empty<string>();
        f.XV = v ?? Array.Empty<object?>();
        if (self != null) f.Self = self;
        if (entry && _xIdx == 0)
        {
            var type = e.GetType().FullName ?? e.GetType().Name;
            Stop("exception", type + ": " + e.Message, exception: true);
        }
        return false;
    }

    // --- stopping ----------------------------------------------------------------

    private static void Stop(string reason, string? description, bool exception = false)
    {
        _inStop = true;
        _pausePending = false;
        _entryPending = false;
        try
        {
            var cmd = JsStop(StoppedJson(reason, description, exception));
            while (cmd.StartsWith("v ", StringComparison.Ordinal))
            {
                JsReply(VariablesJson(cmd));
                cmd = JsWait();
            }
            switch (cmd)
            {
                case "i": _mode = 1; break;
                case "o": _mode = 2; _stepDepth = _depth; break;
                case "u": _mode = 3; _stepDepth = _depth; break;
                default: _mode = 0; break;
            }
        }
        finally
        {
            _refs.Clear();
            _inStop = false;
            _countdown = 1; // re-read pause/breakpoints at the very next line
        }
    }

    private static string StoppedJson(string reason, string? description, bool exception)
    {
        var sb = new StringBuilder(1024);
        sb.Append("{\"reason\":");
        Str(sb, reason);
        if (description != null) { sb.Append(",\"description\":"); Str(sb, description); }
        sb.Append(",\"frames\":[");
        var first = true;
        for (var i = _depth - 1; i >= 0; i--)
        {
            var f = _frames[i];
            if (f.File < 0 || f.File >= _paths.Length) continue;
            if (!first) sb.Append(',');
            first = false;
            sb.Append("{\"name\":");
            Str(sb, f.Name);
            sb.Append(",\"path\":");
            Str(sb, _paths[f.File]);
            sb.Append(",\"line\":").Append(f.Line.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"scopes\":[{\"name\":\"Locals\",\"variables\":[");
            var n = f.N;
            var v = f.V;
            if (n is null && (exception || i == _depth - 1)) { n = f.XN; v = f.XV; }
            if (n != null && v != null)
                for (var k = 0; k < n.Length && k < v.Length; k++)
                {
                    if (k > 0) sb.Append(',');
                    Value(sb, n[k], v[k]);
                }
            sb.Append("]}");
            if (f.Self != null)
            {
                sb.Append(",{\"name\":\"this\",\"variables\":");
                Children(sb, f.Self);
                sb.Append('}');
            }
            sb.Append("]}");
        }
        sb.Append("]}");
        return sb.ToString();
    }

    /// <summary>"v &lt;id&gt; &lt;ref&gt;" → {"id":..,"vars":[..]} (or "error").</summary>
    private static string VariablesJson(string cmd)
    {
        var parts = cmd.Split(' ');
        var id = parts.Length > 1 ? parts[1] : "0";
        var sb = new StringBuilder(512);
        sb.Append("{\"id\":").Append(int.TryParse(id, out var idn) ? idn : 0);
        if (parts.Length < 3 || !int.TryParse(parts[2], out var r) || r < 1 || r > _refs.Count)
        {
            sb.Append(",\"error\":\"That value is no longer available.\"}");
            return sb.ToString();
        }
        sb.Append(",\"vars\":");
        try { Children(sb, _refs[r - 1]); }
        catch (Exception ex)
        {
            sb.Clear();
            sb.Append("{\"id\":").Append(idn).Append(",\"error\":");
            Str(sb, ex.Message);
        }
        sb.Append('}');
        return sb.ToString();
    }

    // --- values -----------------------------------------------------------------

    private static void Value(StringBuilder sb, string name, object? value)
    {
        sb.Append("{\"name\":");
        Str(sb, name);
        sb.Append(",\"value\":");
        string display;
        try { display = Display(value); }
        catch (Exception ex) { display = "{" + ex.GetType().Name + "}"; }
        Str(sb, display);
        if (value != null)
        {
            sb.Append(",\"type\":");
            Str(sb, Friendly(value.GetType()));
            bool expandable;
            try { expandable = Expandable(value); } catch { expandable = false; }
            if (expandable)
            {
                _refs.Add(value);
                sb.Append(",\"ref\":").Append(_refs.Count.ToString(CultureInfo.InvariantCulture));
            }
        }
        sb.Append('}');
    }

    private static bool IsLeaf(Type t) =>
        t.IsPrimitive || t.IsEnum || t == typeof(string) || t == typeof(decimal) || t.IsPointer
        || typeof(Delegate).IsAssignableFrom(t) || typeof(MemberInfo).IsAssignableFrom(t);

    private static bool IsUserType(Type t) => _userAssembly != null && t.Assembly == _userAssembly;

    private static bool Expandable(object value)
    {
        var t = value.GetType();
        if (IsLeaf(t)) return false;
        if (value is Array a) return a.Length > 0;
        if (CountOf(value) is int c) return c > 0;
        if (IsUserType(t)) return true;
        if (t.IsValueType) return IsTupleLike(t);
        return true;
    }

    private static bool IsTupleLike(Type t)
    {
        if (!t.IsGenericType) return false;
        var g = t.GetGenericTypeDefinition().FullName ?? "";
        return g.StartsWith("System.ValueTuple`", StringComparison.Ordinal)
            || g.StartsWith("System.Tuple`", StringComparison.Ordinal)
            || g.StartsWith("System.Collections.Generic.KeyValuePair`", StringComparison.Ordinal);
    }

    /// <summary>Count of a collection (List, Dictionary, HashSet, Queue, Stack…); null if not one.</summary>
    private static int? CountOf(object value)
    {
        if (value is string || value is not IEnumerable) return null;
        if (value is ICollection c) return c.Count;
        var p = value.GetType().GetProperty("Count", BindingFlags.Public | BindingFlags.Instance, null, typeof(int), Type.EmptyTypes, null);
        if (p is null) return null;
        return (int?)p.GetValue(value);
    }

    private static string Display(object? value)
    {
        switch (value)
        {
            case null: return "null";
            case string s: return Quote(s, '"');
            case char ch: return Quote(ch.ToString(), '\'');
            case bool b: return b ? "true" : "false";
            case double d: return d.ToString(CultureInfo.InvariantCulture);
            case float fl: return fl.ToString(CultureInfo.InvariantCulture);
            case decimal m: return m.ToString(CultureInfo.InvariantCulture);
            case Array arr: return ArrayDisplay(arr);
        }
        var t = value.GetType();
        if (t.IsPrimitive) return Convert.ToString(value, CultureInfo.InvariantCulture) ?? "";
        if (t.IsEnum) return value.ToString() ?? "";
        if (CountOf(value) is int count) return "Count = " + count.ToString(CultureInfo.InvariantCulture);
        if (t.IsGenericType && (t.GetGenericTypeDefinition().FullName ?? "").StartsWith("System.ValueTuple`", StringComparison.Ordinal))
            return OneLine(value.ToString());
        if (t.Name.StartsWith("<>f__AnonymousType", StringComparison.Ordinal)) return OneLine(value.ToString());
        var ts = t.GetMethod("ToString", BindingFlags.Public | BindingFlags.Instance, Type.EmptyTypes);
        if (ts != null && ts.DeclaringType != typeof(object) && ts.DeclaringType != typeof(ValueType))
        {
            string? text;
            try { text = value.ToString(); } catch { text = null; }
            if (text != null) return "{" + OneLine(text) + "}";
        }
        return "{" + Friendly(t) + "}";
    }

    private static string OneLine(string? s)
    {
        if (s is null) return "";
        var nl = s.IndexOfAny(new[] { '\r', '\n' });
        if (nl >= 0) s = s.Substring(0, nl);
        return s.Length > 300 ? s.Substring(0, 300) + "…" : s;
    }

    private static string ArrayDisplay(Array a)
    {
        var elem = a.GetType().GetElementType()!;
        var suffix = new StringBuilder();
        while (elem.IsArray)
        {
            suffix.Append('[').Append(',', elem.GetArrayRank() - 1).Append(']');
            elem = elem.GetElementType()!;
        }
        var dims = new string[a.Rank];
        for (var i = 0; i < a.Rank; i++) dims[i] = a.GetLength(i).ToString(CultureInfo.InvariantCulture);
        return Friendly(elem) + "[" + string.Join(", ", dims) + "]" + suffix;
    }

    private static string Quote(string s, char q)
    {
        var sb = new StringBuilder(s.Length + 2);
        sb.Append(q);
        var n = 0;
        foreach (var c in s)
        {
            if (++n > 2000) { sb.Append('…'); break; }
            switch (c)
            {
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                case '\0': sb.Append("\\0"); break;
                default:
                    if (c == q) sb.Append('\\').Append(c);
                    else sb.Append(c);
                    break;
            }
        }
        sb.Append(q);
        return sb.ToString();
    }

    private static readonly Dictionary<Type, string> Aliases = new()
    {
        [typeof(int)] = "int", [typeof(long)] = "long", [typeof(short)] = "short", [typeof(byte)] = "byte",
        [typeof(sbyte)] = "sbyte", [typeof(uint)] = "uint", [typeof(ulong)] = "ulong", [typeof(ushort)] = "ushort",
        [typeof(double)] = "double", [typeof(float)] = "float", [typeof(decimal)] = "decimal", [typeof(bool)] = "bool",
        [typeof(char)] = "char", [typeof(string)] = "string", [typeof(object)] = "object", [typeof(void)] = "void",
        [typeof(nint)] = "nint", [typeof(nuint)] = "nuint",
    };

    internal static string Friendly(Type t)
    {
        if (Aliases.TryGetValue(t, out var a)) return a;
        if (t.IsArray) return Friendly(t.GetElementType()!) + "[" + new string(',', t.GetArrayRank() - 1) + "]";
        if (t.IsPointer) return Friendly(t.GetElementType()!) + "*";
        var name = t.Name;
        if (name.StartsWith("<>f__AnonymousType", StringComparison.Ordinal)) return "<anonymous type>";
        if (!t.IsGenericType) return name;
        var args = t.GetGenericArguments();
        var def = t.GetGenericTypeDefinition();
        if (def == typeof(Nullable<>)) return Friendly(args[0]) + "?";
        if ((def.FullName ?? "").StartsWith("System.ValueTuple`", StringComparison.Ordinal))
            return "(" + string.Join(", ", args.Select(Friendly)) + ")";
        var tick = name.IndexOf('`');
        if (tick >= 0) name = name.Substring(0, tick);
        return name + "<" + string.Join(", ", args.Select(Friendly)) + ">";
    }

    /// <summary>Children of an expandable value as a JSON array.</summary>
    private static void Children(StringBuilder sb, object value)
    {
        sb.Append('[');
        var n = 0;
        void Add(string name, object? v)
        {
            if (n++ > 0) sb.Append(',');
            Value(sb, name, v);
        }

        if (value is Array arr)
        {
            if (arr.Rank == 1)
            {
                var lo = arr.GetLowerBound(0);
                for (var i = 0; i < arr.Length && i < ChildCap; i++)
                    Add("[" + (i + lo).ToString(CultureInfo.InvariantCulture) + "]", arr.GetValue(i + lo));
            }
            else
            {
                var idx = new int[arr.Rank];
                var shown = 0;
                foreach (var item in arr)
                {
                    if (shown++ >= ChildCap) break;
                    Add("[" + string.Join(", ", idx) + "]", item);
                    for (var d = arr.Rank - 1; d >= 0; d--)
                    {
                        if (++idx[d] < arr.GetLength(d)) break;
                        idx[d] = 0;
                    }
                }
            }
        }
        else if (value is IDictionary dict)
        {
            var shown = 0;
            foreach (DictionaryEntry e in dict)
            {
                if (shown++ >= ChildCap) break;
                Add("[" + Display(e.Key) + "]", e.Value);
            }
        }
        else if (CountOf(value) is int)
        {
            var i = 0;
            foreach (var item in (IEnumerable)value)
            {
                if (i >= ChildCap) break;
                Add("[" + (i++).ToString(CultureInfo.InvariantCulture) + "]", item);
            }
        }
        else if (IsUserType(value.GetType()))
        {
            var chain = new List<Type>();
            for (var t = value.GetType(); t != null && IsUserType(t); t = t.BaseType) chain.Insert(0, t);
            foreach (var t in chain)
                foreach (var f in t.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly))
                {
                    var name = f.Name;
                    if (name.StartsWith('<'))
                    {
                        var end = name.IndexOf(">k__BackingField", StringComparison.Ordinal);
                        if (end < 0) continue;
                        name = name.Substring(1, end - 1);
                    }
                    object? v;
                    try { v = f.GetValue(value); } catch (Exception ex) { v = ex.GetType().Name; }
                    Add(name, v);
                    if (n >= ChildCap) break;
                }
        }
        else
        {
            var t = value.GetType();
            foreach (var f in t.GetFields(BindingFlags.Instance | BindingFlags.Public))
            {
                if (n >= ChildCap) break;
                Add(f.Name, f.GetValue(value));
            }
            foreach (var p in t.GetProperties(BindingFlags.Instance | BindingFlags.Public))
            {
                if (n >= 100) break;
                if (!p.CanRead || p.GetIndexParameters().Length > 0) continue;
                if (p.PropertyType.IsByRefLike || p.PropertyType.IsPointer) continue;
                object? v;
                try { v = p.GetValue(value); }
                catch (TargetInvocationException ex) { v = "{" + (ex.InnerException ?? ex).GetType().Name + "}"; }
                catch (Exception ex) { v = "{" + ex.GetType().Name + "}"; }
                Add(p.Name, v);
            }
        }
        sb.Append(']');
    }

    private static void Str(StringBuilder sb, string s)
    {
        sb.Append('"');
        foreach (var c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20 || c == (char)0x2028 || c == (char)0x2029) sb.Append("\\u").Append(((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        sb.Append('"');
    }
}
