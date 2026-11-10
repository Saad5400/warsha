using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Loader;
using System.Runtime.Versioning;
using System.Text;
using System.Threading.Tasks;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

// Boot marker (goes to the browser console via the runtime, not the student
// pane). Main returns; [JSExport] methods stay callable afterwards.
Console.WriteLine("[warsha-csharp] runtime booted");

/// <summary>
/// The in-browser C# engine: Roslyn compiles all project .cs files into one
/// assembly and runs its entry point. Output streams out through JS callbacks
/// (WriteOut/WriteErr) as it is produced; Console.ReadLine() blocks through the
/// JS ReadLine import, which the worker backs with Atomics.wait on a shared
/// buffer. No output is buffered here — a prompt with no newline must reach the
/// console before the program blocks on the following read.
/// </summary>
[SupportedOSPlatform("browser")]
public partial class Runner
{
    // --- JS interop (implemented by the worker's setModuleImports('runner')) ---

    [JSImport("warsha.writeOut", "runner")]
    internal static partial void WriteOut(string text);

    [JSImport("warsha.writeErr", "runner")]
    internal static partial void WriteErr(string text);

    /// <summary>Blocks until the worker supplies a line; null signals EOF.</summary>
    [JSImport("warsha.readLine", "runner")]
    internal static partial string? ReadLine();

    // --- reference assemblies, handed in from JS (bytes from _framework) --------

    private static readonly List<MetadataReference> References = new();

    [JSExport]
    internal static void AddReference(byte[] peBytes)
        => References.Add(MetadataReference.CreateFromStream(new MemoryStream(peBytes)));

    [JSExport]
    internal static int ReferenceCount() => References.Count;

    /// <summary>This harness assembly (Warsha.CSharp.dll) as a reference for
    /// debug runs only, under the extern alias the instrumented code uses — so
    /// the probes bind to __Warsha.Dbg and nothing leaks into plain runs.</summary>
    private static MetadataReference? DebugReference;

    [JSExport]
    internal static void SetDebugReference(byte[] peBytes)
        => DebugReference = MetadataReference.CreateFromStream(new MemoryStream(peBytes))
            .WithAliases(new[] { Instrumenter.Alias });

    // --- compile + run ---------------------------------------------------------

    /// <summary>
    /// Compile every (paths[i], contents[i]) file as one assembly and invoke its
    /// entry point. Returns 0 on a clean exit, the program's exit code if it
    /// calls Environment.Exit, or 1 on a compile error / unhandled exception.
    /// Diagnostics and exceptions stream out through WriteErr.
    /// `debugMode`: 0 plain run, 1 under the debugger, 2 debugger + stop on entry.
    /// </summary>
    [JSExport]
    internal static int Run(string[] paths, string[] contents, string entryPath, int debugMode)
    {
        // Every project file arrives (so the program can read its data files);
        // only the .cs ones are source.
        _sent = null;
        var parse = new CSharpParseOptions(LanguageVersion.Latest);
        var trees = new List<SyntaxTree>(paths.Length + 1)
        {
            // The implicit usings `dotnet new console` gives every project, so
            // File.ReadAllText / List<T> / .Where(...) work exactly as they do in
            // the textbook's project without `using System.IO;`. A student file
            // that repeats one is still fine: a duplicate is a hidden diagnostic,
            // never an error.
            CSharpSyntaxTree.ParseText(ImplicitUsings, parse, path: "__WarshaImplicitUsings.cs"),
        };
        for (var i = 0; i < paths.Length; i++)
            if (paths[i].EndsWith(".cs", StringComparison.Ordinal))
                trees.Add(CSharpSyntaxTree.ParseText(contents[i], parse, path: paths[i]));

        var options = new CSharpCompilationOptions(
            OutputKind.ConsoleApplication,
            // Mandatory on the single-threaded wasm runtime (see M0-FINDINGS).
            concurrentBuild: false,
            optimizationLevel: OptimizationLevel.Debug,
            // Let Roslyn find the entry point across files. A future refinement
            // can pin it to entryPath's declared type when several Mains exist.
            mainTypeName: null);

        var compilation = CSharpCompilation.Create("UserProgram", trees, References, options);

        using var peStream = new MemoryStream();
        var debug = debugMode != 0 && DebugReference != null;
        string[] debugPaths = Array.Empty<string>();
        if (debug)
        {
            // Errors come from the student's own trees, so every diagnostic's
            // line is theirs; only a clean program is instrumented.
            var errors = compilation.GetDiagnostics().Where(d => d.Severity == DiagnosticSeverity.Error).ToList();
            if (errors.Count > 0)
            {
                foreach (var d in errors) WriteErr(d.ToString() + "\n");
                return 1;
            }
            debug = EmitInstrumented(compilation, trees, parse, peStream, out debugPaths);
            if (!debug)
            {
                WriteErr("[Warsha: the debugger could not prepare this program, so it runs without stopping.]\n");
                peStream.SetLength(0);
            }
        }
        if (!debug)
        {
            var emit = compilation.Emit(peStream);
            if (!emit.Success)
            {
                foreach (var d in emit.Diagnostics.Where(d => d.Severity == DiagnosticSeverity.Error))
                    WriteErr(d.ToString() + "\n");
                return 1;
            }
        }

        peStream.Seek(0, SeekOrigin.Begin);

        var alc = new AssemblyLoadContext("warsha-run", isCollectible: true);
        var savedOut = Console.Out;
        var savedErr = Console.Error;
        // NB: never read Console.In — its getter calls GetOrCreateReader(), which
        // throws "Operation is not supported on this platform" on browser wasm
        // (there is no default stdin). SetIn works and is all we need; ReadLine()
        // then routes through our reader. Each run installs a fresh one, so there
        // is nothing to restore.
        try
        {
            var assembly = alc.LoadFromStream(peStream);
            var entry = assembly.EntryPoint;
            if (entry is null)
            {
                WriteErr("error: no entry point — add a Main method or top-level statements.\n");
                return 1;
            }

            PrepareWorkspace(paths, contents);
            if (debug)
            {
                __Warsha.Dbg.Reset(debugPaths, stopOnEntry: debugMode == 2);
                __Warsha.Dbg.SetUserAssembly(assembly);
            }

            Console.SetOut(new CallbackWriter(WriteOut));
            Console.SetError(new CallbackWriter(WriteErr));
            Console.SetIn(new CallbackReader());

            var args = entry.GetParameters().Length == 0
                ? null
                : new object[] { Array.Empty<string>() };
            var result = entry.Invoke(null, args);
            // A real `static async Task Main` is wrapped by a synchronous
            // entry-point thunk, so Invoke already ran it to completion; this
            // only covers a hand-rolled entry that returns a Task.
            if (result is Task task) task.GetAwaiter().GetResult();
            return result is int code ? code : 0;
        }
        catch (TargetInvocationException tie) when (tie.InnerException is not null)
        {
            // Environment.Exit surfaces here on wasm; treat it as a real exit code.
            WriteErr("\n" + tie.InnerException + "\n");
            return 1;
        }
        catch (Exception ex)
        {
            WriteErr("\n" + ex + "\n");
            return 1;
        }
        finally
        {
            if (debug) __Warsha.Dbg.End();
            Console.SetOut(savedOut);
            Console.SetError(savedErr);
            alc.Unload();
        }
    }

    /// <summary>
    /// Rewrite every student tree with probes (Instrumenter) and emit that
    /// instead. File ids index `debugPaths` (the .cs paths, as the shell names
    /// them). False — and the caller runs the plain program — if anything about
    /// instrumentation fails; the reason goes to the browser console.
    /// </summary>
    private static bool EmitInstrumented(CSharpCompilation compilation, List<SyntaxTree> trees, CSharpParseOptions parse,
        MemoryStream peStream, out string[] debugPaths)
    {
        debugPaths = Array.Empty<string>();
        try
        {
            var t0 = DateTime.UtcNow;
            var entry = compilation.GetEntryPoint(default);
            var paths = new List<string>();
            var rewritten = new List<SyntaxTree>(trees.Count);
            foreach (var tree in trees)
            {
                if (tree.FilePath == "__WarshaImplicitUsings.cs") { rewritten.Add(tree); continue; }
                var id = paths.Count;
                paths.Add(tree.FilePath);
                rewritten.Add(Instrumenter.Rewrite(tree, compilation.GetSemanticModel(tree), id, entry, parse));
            }
            var instrumented = compilation.RemoveAllSyntaxTrees().AddSyntaxTrees(rewritten).AddReferences(DebugReference!);
            var emit = instrumented.Emit(peStream);
            if (!emit.Success)
            {
                foreach (var d in emit.Diagnostics.Where(d => d.Severity == DiagnosticSeverity.Error).Take(20))
                    Console.WriteLine("[warsha-debug] instrumentation error: " + d);
                return false;
            }
            Console.WriteLine($"[warsha-debug] instrumented in {(DateTime.UtcNow - t0).TotalMilliseconds:F0} ms");
            debugPaths = paths.ToArray();
            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine("[warsha-debug] instrumentation failed: " + ex);
            return false;
        }
    }

    // --- the program's files ------------------------------------------------------
    //
    // The project is the program's working directory: before the entry point runs,
    // every project file is written into a fresh in-memory folder and that folder
    // becomes the current directory, so File.ReadAllText("data.txt") and
    // new StreamWriter("out.txt") behave as they would beside a real Program.cs.
    // Changes() diffs the folder against what went in after the run; the worker
    // posts that to the shell, which writes it back into the project.

    private const string ImplicitUsings =
        "global using System;\n" +
        "global using System.Collections.Generic;\n" +
        "global using System.IO;\n" +
        "global using System.Linq;\n" +
        "global using System.Threading;\n" +
        "global using System.Threading.Tasks;\n";

    private const string ProjectRoot = "/warsha-project";
    private const int WriteBackLimitBytes = 1024 * 1024;
    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    /// <summary>What the run started with (project path -> content); null until a run got that far.</summary>
    private static Dictionary<string, string>? _sent;

    private static void PrepareWorkspace(string[] paths, string[] contents)
    {
        Directory.SetCurrentDirectory("/");
        if (Directory.Exists(ProjectRoot)) Directory.Delete(ProjectRoot, recursive: true);
        Directory.CreateDirectory(ProjectRoot);
        var sent = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var i = 0; i < paths.Length; i++)
        {
            var full = Path.Combine(ProjectRoot, paths[i]);
            var dir = Path.GetDirectoryName(full);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            File.WriteAllText(full, contents[i], new UTF8Encoding(false));
            sent[paths[i]] = contents[i];
        }
        Directory.SetCurrentDirectory(ProjectRoot);
        _sent = sent;
    }

    /// <summary>
    /// The last run's effect on its working directory, flattened for JS interop
    /// as [kind, path, content] triples: "w" written (new or changed text file),
    /// "d" deleted, "s" skipped (binary or over 1 MB — the project holds text).
    /// Empty when the run never reached its entry point (a compile error).
    /// </summary>
    [JSExport]
    internal static string[] Changes()
    {
        var sent = _sent;
        _sent = null;
        if (sent is null || !Directory.Exists(ProjectRoot)) return Array.Empty<string>();
        var result = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var full in Directory.EnumerateFiles(ProjectRoot, "*", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(ProjectRoot, full).Replace('\\', '/');
            seen.Add(rel);
            string? text = null;
            try
            {
                var bytes = File.ReadAllBytes(full);
                if (bytes.Length <= WriteBackLimitBytes)
                {
                    text = StrictUtf8.GetString(bytes);
                    if (text.Length > 0 && text[0] == '\uFEFF') text = text.Substring(1);
                    if (text.Contains('\0')) text = null;
                }
            }
            catch (Exception)
            {
                text = null;
            }
            if (text is null) result.AddRange(new[] { "s", rel, "" });
            else if (!sent.TryGetValue(rel, out var before) || before != text) result.AddRange(new[] { "w", rel, text });
        }
        foreach (var path in sent.Keys)
            if (!seen.Contains(path)) result.AddRange(new[] { "d", path, "" });
        return result.ToArray();
    }

    /// <summary>Unbuffered writer: every write is pushed straight to JS, so a
    /// prompt appears before the program blocks on the next read.</summary>
    private sealed class CallbackWriter : TextWriter
    {
        private readonly Action<string> _sink;
        public CallbackWriter(Action<string> sink) => _sink = sink;
        public override Encoding Encoding => Encoding.UTF8;
        public override void Write(char value) => _sink(value.ToString());
        public override void Write(string? value) { if (!string.IsNullOrEmpty(value)) _sink(value); }
        public override void WriteLine(string? value) { _sink((value ?? string.Empty) + "\n"); }
    }

    /// <summary>Line-buffered reader over the blocking JS ReadLine import. Serves
    /// Console.ReadLine() directly, and Read()/Peek() (used by int.Parse pipelines
    /// and Console.Read()) from the current line, refilling as needed. Null from
    /// JS means EOF.</summary>
    private sealed class CallbackReader : TextReader
    {
        private string? _line;   // remaining chars of the current line incl. '\n'
        private int _pos;
        private bool _eof;

        private bool Fill()
        {
            if (_eof) return false;
            if (_line != null && _pos < _line.Length) return true;
            var next = Runner.ReadLine();
            if (next is null) { _eof = true; return false; }
            _line = next + "\n";
            _pos = 0;
            return true;
        }

        public override int Peek() => Fill() ? _line![_pos] : -1;

        public override int Read() => Fill() ? _line![_pos++] : -1;

        public override string? ReadLine()
        {
            // Fast path: no partially-consumed buffer, defer straight to JS.
            if ((_line is null || _pos >= _line.Length) && !_eof)
                return Runner.ReadLine();
            if (!Fill()) return null;
            var nl = _line!.IndexOf('\n', _pos);
            var end = nl < 0 ? _line.Length : nl;
            var s = _line.Substring(_pos, end - _pos);
            _pos = nl < 0 ? _line.Length : nl + 1;
            return s;
        }
    }
}
