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

    // --- compile + run ---------------------------------------------------------

    /// <summary>
    /// Compile every (paths[i], contents[i]) file as one assembly and invoke its
    /// entry point. Returns 0 on a clean exit, the program's exit code if it
    /// calls Environment.Exit, or 1 on a compile error / unhandled exception.
    /// Diagnostics and exceptions stream out through WriteErr.
    /// </summary>
    [JSExport]
    internal static int Run(string[] paths, string[] contents, string entryPath)
    {
        var parse = new CSharpParseOptions(LanguageVersion.Latest);
        var trees = new List<SyntaxTree>(paths.Length);
        for (var i = 0; i < paths.Length; i++)
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
        var emit = compilation.Emit(peStream);
        if (!emit.Success)
        {
            foreach (var d in emit.Diagnostics.Where(d => d.Severity == DiagnosticSeverity.Error))
                WriteErr(d.ToString() + "\n");
            return 1;
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
            Console.SetOut(savedOut);
            Console.SetError(savedErr);
            alc.Unload();
        }
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
