using System.Collections.Immutable;
using System.Globalization;
using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

/// <summary>
/// Rewrites a student's syntax tree for a debug run (only then — plain runs
/// compile the untouched trees). Every statement in a method, constructor,
/// local function, block lambda or the top-level program gets a probe in front
/// of it, ON THE SAME LINE (the original statement's leading trivia moves to
/// the probe), so line numbers never shift:
///
///   if (__wdbg::__Warsha.Dbg.H(file, line)) __wdbg::__Warsha.Dbg.S(names, values, this);
///
/// Locals are the in-scope locals/parameters of the enclosing function that
/// are definitely assigned on entry to the statement (Roslyn data flow), minus
/// what cannot be boxed (ref structs, pointers). Each such body is wrapped as
///
///   { try { Dbg.E(name, this); …body… }
///     catch (Exception __wx) when (Dbg.T(__wx, params, this, isEntry)) { throw; }
///     finally { Dbg.X(); } }
///
/// for the call stack and the uncaught-exception stop. Iterators and async
/// bodies are left alone (their frames would not nest), as are property /
/// operator bodies (stepped over, as VS Code does by default).
/// </summary>
internal sealed class Instrumenter : CSharpSyntaxRewriter
{
    private const string D = "__wdbg::__Warsha.Dbg";
    internal const string Alias = "__wdbg";

    private readonly SemanticModel _m;
    private readonly int _file;
    private readonly IMethodSymbol? _entry;
    private readonly Dictionary<SyntaxNode, bool> _framed = new();
    public int Probes;

    private Instrumenter(SemanticModel model, int file, IMethodSymbol? entry)
    {
        _m = model;
        _file = file;
        _entry = entry;
    }

    public static SyntaxTree Rewrite(SyntaxTree tree, SemanticModel model, int fileId, IMethodSymbol? entry, CSharpParseOptions parse)
    {
        var rw = new Instrumenter(model, fileId, entry);
        var root = (CompilationUnitSyntax)rw.Visit(tree.GetRoot())!;
        if (rw.Probes == 0) return tree;
        // `extern alias __wdbg;` keeps the harness's public types out of the
        // student's global namespace. It goes on the first token's line, after
        // that token's leading trivia (so #define / comments stay first).
        var first = root.GetFirstToken(includeZeroWidth: true);
        var lead = first.LeadingTrivia;
        root = root.ReplaceToken(first, first.WithLeadingTrivia(SyntaxFactory.Space));
        var ext = SyntaxFactory.ParseCompilationUnit("extern alias " + Alias + ";").Externs[0]
            .WithLeadingTrivia(lead)
            .WithTrailingTrivia(SyntaxFactory.Space);
        root = root.WithExterns(root.Externs.Insert(0, ext));
        return CSharpSyntaxTree.Create(root, parse, tree.FilePath, Encoding.UTF8);
    }

    // --- which code is instrumented -----------------------------------------

    /// <summary>The function-like node that owns `n` (method, lambda, local function, accessor, compilation unit for top-level code), or a non-function member.</summary>
    private static SyntaxNode? OwnerOf(SyntaxNode n)
    {
        for (var p = n.Parent; p != null; p = p.Parent)
        {
            switch (p)
            {
                case AnonymousFunctionExpressionSyntax:
                case LocalFunctionStatementSyntax:
                case BaseMethodDeclarationSyntax:
                case AccessorDeclarationSyntax:
                    return p;
                case GlobalStatementSyntax:
                    return p.Parent;
                case MemberDeclarationSyntax:
                    return p;
            }
        }
        return null;
    }

    private bool IsFramed(SyntaxNode? owner)
    {
        if (owner is null) return false;
        if (_framed.TryGetValue(owner, out var known)) return known;
        var result = owner switch
        {
            MethodDeclarationSyntax md => md.Body != null && !IsAsync(md.Modifiers) && !IsIterator(md.Body),
            ConstructorDeclarationSyntax cd => cd.Body != null,
            LocalFunctionStatementSyntax lf => lf.Body != null && !IsAsync(lf.Modifiers) && !IsIterator(lf.Body),
            AnonymousFunctionExpressionSyntax af => af.Block != null && af.AsyncKeyword.IsKind(SyntaxKind.None),
            CompilationUnitSyntax cu => cu.Members.OfType<GlobalStatementSyntax>().Any() && !TopLevelAwaits(cu),
            _ => false,
        };
        _framed[owner] = result;
        return result;
    }

    private static bool IsAsync(SyntaxTokenList mods) => mods.Any(SyntaxKind.AsyncKeyword);

    private static bool NotNested(SyntaxNode n) => n is not AnonymousFunctionExpressionSyntax && n is not LocalFunctionStatementSyntax;

    private static bool IsIterator(SyntaxNode body) =>
        body.DescendantNodes(NotNested).OfType<YieldStatementSyntax>().Any();

    private static bool TopLevelAwaits(CompilationUnitSyntax cu) =>
        cu.Members.OfType<GlobalStatementSyntax>().Any(g =>
            g.DescendantNodesAndSelf(NotNested).Any(n => n switch
            {
                AwaitExpressionSyntax => true,
                ForEachStatementSyntax fe => !fe.AwaitKeyword.IsKind(SyntaxKind.None),
                UsingStatementSyntax us => !us.AwaitKeyword.IsKind(SyntaxKind.None),
                LocalDeclarationStatementSyntax ld => !ld.AwaitKeyword.IsKind(SyntaxKind.None),
                _ => false,
            }));

    private bool ShouldProbe(StatementSyntax s) =>
        s is not BlockSyntax && s is not EmptyStatementSyntax && s is not LocalFunctionStatementSyntax
        && IsFramed(OwnerOf(s));

    // --- rewriting -------------------------------------------------------------

    public override SyntaxNode? Visit(SyntaxNode? node)
    {
        // An embedded statement (`if (x) y();`, a loop body, `else …`) has no
        // sibling slot for a probe: wrap it in a block with its probe.
        if (node is StatementSyntax s && node.Parent is not BlockSyntax && node.Parent is not SwitchSectionSyntax
            && node.Parent is not GlobalStatementSyntax && ShouldProbe(s))
        {
            var inner = (StatementSyntax)base.Visit(node)!;
            var (probe, stmt) = WithProbe(s, inner);
            return SyntaxFactory.Block(
                SyntaxFactory.Token(SyntaxKind.OpenBraceToken).WithLeadingTrivia(probe.GetLeadingTrivia()),
                SyntaxFactory.List(new[] { probe.WithLeadingTrivia(), stmt.WithTrailingTrivia() }),
                SyntaxFactory.Token(SyntaxKind.CloseBraceToken).WithLeadingTrivia(SyntaxFactory.Space).WithTrailingTrivia(stmt.GetTrailingTrivia()));
        }
        return base.Visit(node);
    }

    public override SyntaxNode? VisitBlock(BlockSyntax node)
    {
        var block = node.WithStatements(Interleave(node.Statements));
        return IsFramedBody(node, out var owner) ? WrapBody(node, block, owner!) : block;
    }

    public override SyntaxNode? VisitSwitchSection(SwitchSectionSyntax node) =>
        node.WithLabels(VisitList(node.Labels)).WithStatements(Interleave(node.Statements));

    public override SyntaxNode? VisitCompilationUnit(CompilationUnitSyntax node)
    {
        var visited = (CompilationUnitSyntax)base.VisitCompilationUnit(node)!;
        if (!IsFramed(node)) return visited;

        var originals = node.Members.OfType<GlobalStatementSyntax>().Select(g => g.Statement).ToList();
        var news = visited.Members.OfType<GlobalStatementSyntax>().Select(g => g.Statement).ToList();
        var items = new List<StatementSyntax>();
        for (var i = 0; i < originals.Count; i++)
        {
            if (ShouldProbe(originals[i]))
            {
                var (probe, stmt) = WithProbe(originals[i], news[i]);
                items.Add(probe);
                items.Add(stmt);
            }
            else items.Add(news[i]);
        }
        var lead = items[0].GetLeadingTrivia();
        items[0] = items[0].WithLeadingTrivia(SyntaxFactory.Space);
        var trail = items[^1].GetTrailingTrivia();
        items[^1] = items[^1].WithTrailingTrivia();

        var fn = _entry is { Name: "<Main>$" } ? _entry : null;
        var tpl = (TryStatementSyntax)SyntaxFactory.ParseStatement(
            $"try{{{D}.E(\"Program.Main\",null);}} catch(global::System.Exception __wx) when({D}.T(__wx,null,null,null,{(fn != null ? "true" : "false")})){{throw;}} finally{{{D}.X();}}");
        var tryBlock = tpl.Block
            .WithStatements(tpl.Block.Statements.AddRange(items))
            .WithCloseBraceToken(SyntaxFactory.Token(SyntaxKind.CloseBraceToken).WithLeadingTrivia(SyntaxFactory.Space));
        var tryStmt = tpl.WithBlock(tryBlock).WithLeadingTrivia(lead).WithTrailingTrivia(trail);

        var members = new List<MemberDeclarationSyntax>();
        var placed = false;
        foreach (var m in visited.Members)
        {
            if (m is GlobalStatementSyntax)
            {
                if (!placed) members.Add(SyntaxFactory.GlobalStatement(tryStmt));
                placed = true;
            }
            else members.Add(m);
        }
        return visited.WithMembers(SyntaxFactory.List(members));
    }

    private SyntaxList<StatementSyntax> Interleave(SyntaxList<StatementSyntax> originals)
    {
        var list = new List<StatementSyntax>(originals.Count * 2);
        foreach (var s in originals)
        {
            var visited = (StatementSyntax)Visit(s)!;
            if (ShouldProbe(s))
            {
                var (probe, stmt) = WithProbe(s, visited);
                list.Add(probe);
                list.Add(stmt);
            }
            else list.Add(visited);
        }
        return SyntaxFactory.List(list);
    }

    private bool IsFramedBody(BlockSyntax node, out SyntaxNode? owner)
    {
        owner = node.Parent;
        var isBody = owner switch
        {
            BaseMethodDeclarationSyntax md => md.Body == node,
            LocalFunctionStatementSyntax lf => lf.Body == node,
            AnonymousFunctionExpressionSyntax af => af.Block == node,
            _ => false,
        };
        return isBody && IsFramed(owner);
    }

    private BlockSyntax WrapBody(BlockSyntax original, BlockSyntax visited, SyntaxNode owner)
    {
        var fn = owner switch
        {
            AnonymousFunctionExpressionSyntax af => _m.GetSymbolInfo(af).Symbol as IMethodSymbol,
            _ => _m.GetDeclaredSymbol(owner) as IMethodSymbol,
        };
        var name = fn != null ? FrameName(fn) : "<unknown>";
        var self = SelfExpr(original.OpenBraceToken.Span.End);
        var ps = fn?.Parameters.Where(p => p.RefKind != RefKind.Out && !p.IsDiscard && p.Name != "" && TypeOk(p.Type)).Select(p => p.Name).ToList() ?? new List<string>();
        var isEntry = fn != null && _entry != null && SymbolEqualityComparer.Default.Equals(fn, _entry);
        var tpl = (TryStatementSyntax)SyntaxFactory.ParseStatement(
            $"try{{{D}.E({Lit(name)},{self});}} catch(global::System.Exception __wx) when({D}.T(__wx,{Names(ps)},{Values(ps)},{self},{(isEntry ? "true" : "false")})){{throw;}} finally{{{D}.X();}}");
        var enter = tpl.Block.Statements[0].WithTrailingTrivia(visited.OpenBraceToken.TrailingTrivia);
        var tryBlock = tpl.Block
            .WithStatements(SyntaxFactory.List(new[] { enter }.Concat(visited.Statements)))
            .WithCloseBraceToken(visited.CloseBraceToken.WithTrailingTrivia());
        var tryStmt = tpl.WithBlock(tryBlock).WithLeadingTrivia(SyntaxFactory.Space);
        return SyntaxFactory.Block(
            visited.OpenBraceToken.WithTrailingTrivia(SyntaxFactory.Space),
            SyntaxFactory.SingletonList<StatementSyntax>(tryStmt),
            SyntaxFactory.Token(SyntaxKind.CloseBraceToken).WithLeadingTrivia(SyntaxFactory.Space).WithTrailingTrivia(visited.CloseBraceToken.TrailingTrivia));
    }

    // --- the probe ---------------------------------------------------------------

    /// <summary>The probe for `original` (carrying its leading trivia) + the visited statement (now led by a space).</summary>
    private (StatementSyntax probe, StatementSyntax stmt) WithProbe(StatementSyntax original, StatementSyntax visited)
    {
        Probes++;
        var line = original.GetLocation().GetLineSpan().StartLinePosition.Line + 1;
        var lineArg = IsSecondary(original, line) ? -line : line;
        var pos = original.SpanStart;
        var locals = LocalsAt(original);
        var self = SelfExpr(pos);
        var n = Names(locals);
        var v = Values(locals);
        var f = _file.ToString(CultureInfo.InvariantCulture);
        var l = lineArg.ToString(CultureInfo.InvariantCulture);
        var text = CallsUserCode(original)
            ? $"if ({D}.H({f},{l}) | {D}.K({n},{v},{self})) {D}.S0();"
            : $"if ({D}.H({f},{l})) {D}.S({n},{v},{self});";
        var probe = SyntaxFactory.ParseStatement(text)
            .WithLeadingTrivia(visited.GetLeadingTrivia())
            .WithTrailingTrivia(SyntaxFactory.Space);
        return (probe, visited.WithLeadingTrivia());
    }

    /// <summary>True when the nearest probed enclosing statement starts on the same line (`if (x) return;`).</summary>
    private static bool IsSecondary(StatementSyntax s, int line)
    {
        for (var p = s.Parent; p != null; p = p.Parent)
        {
            if (p is AnonymousFunctionExpressionSyntax || p is LocalFunctionStatementSyntax || p is MemberDeclarationSyntax) return false;
            if (p is StatementSyntax ps && p is not BlockSyntax)
                return ps.GetLocation().GetLineSpan().StartLinePosition.Line + 1 == line;
        }
        return false;
    }

    private List<string> LocalsAt(StatementSyntax s)
    {
        var pos = s.SpanStart;
        if (_m.GetEnclosingSymbol(pos) is not IMethodSymbol fn) return new List<string>();
        var result = new List<(int order, string name)>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var topLevel = fn.Name == "<Main>$";

        // Parameters of this function (an unassigned `out` is not readable).
        ImmutableArray<ISymbol> assigned = ImmutableArray<ISymbol>.Empty;
        try
        {
            var df = _m.AnalyzeDataFlow(s);
            if (df is { Succeeded: true }) assigned = df.DefinitelyAssignedOnEntry;
        }
        catch { /* params only */ }
        var assignedSet = new HashSet<ISymbol>(assigned, SymbolEqualityComparer.Default);

        if (!topLevel)
            foreach (var p in fn.Parameters)
            {
                if (p.IsDiscard || p.Name == "" || !TypeOk(p.Type)) continue;
                if (p.RefKind == RefKind.Out && !assignedSet.Contains(p)) continue;
                if (seen.Add(p.Name)) result.Add((p.Ordinal, p.Name));
            }

        // Locals: definitely assigned on entry (C#'s own rule) AND in scope here
        // (a block-local from a finished sibling block is assigned but not
        // nameable). Lookup by name keeps this cheap — an unfiltered
        // LookupSymbols returns every type in every imported namespace.
        foreach (var sym in assigned)
        {
            if (sym is not ILocalSymbol loc) continue;
            if (!SymbolEqualityComparer.Default.Equals(loc.ContainingSymbol, fn) || !TypeOk(loc.Type)) continue;
            if (seen.Contains(loc.Name)) continue;
            // Declared textually before this statement (a const is "assigned"
            // everywhere in its scope, but naming it earlier is CS0841).
            var declared = loc.Locations.FirstOrDefault();
            if (declared is null || declared.SourceTree != s.SyntaxTree || declared.SourceSpan.Start >= pos) continue;
            var visible = _m.LookupSymbols(pos, name: loc.Name);
            if (!visible.Any(v => SymbolEqualityComparer.Default.Equals(v, loc))) continue;
            seen.Add(loc.Name);
            result.Add((1_000_000 + (loc.Locations.FirstOrDefault()?.SourceSpan.Start ?? 0), loc.Name));
        }
        return result.OrderBy(r => r.order).Select(r => r.name).ToList();
    }

    private static bool TypeOk(ITypeSymbol t) =>
        !t.IsRefLikeType && t.TypeKind != TypeKind.Pointer && t.TypeKind != TypeKind.FunctionPointer
        && t.TypeKind != TypeKind.Error && t.SpecialType != SpecialType.System_Void;

    /// <summary>`this` where it can be boxed into an object argument, else `null`.</summary>
    private string SelfExpr(int position)
    {
        ISymbol? s = _m.GetEnclosingSymbol(position);
        var nested = false;
        while (s is IMethodSymbol ms && (ms.MethodKind == MethodKind.LambdaMethod || ms.MethodKind == MethodKind.LocalFunction))
        {
            if (ms.IsStatic) return "null";
            nested = true;
            s = ms.ContainingSymbol;
        }
        if (s is not IMethodSymbol member || member.IsStatic) return "null";
        var type = member.ContainingType;
        if (type is null || type.IsRefLikeType) return "null";
        if (type.IsValueType && nested) return "null";
        return "this";
    }

    /// <summary>Does this statement (not counting nested statements) call into student code? Then K keeps a snapshot so the frame shows locals while a callee is stopped.</summary>
    private bool CallsUserCode(StatementSyntax s)
    {
        foreach (var n in s.DescendantNodes(x => x == s || (x is not StatementSyntax && x is not AnonymousFunctionExpressionSyntax)))
        {
            switch (n)
            {
                case AnonymousFunctionExpressionSyntax:
                    return true;
                case InvocationExpressionSyntax inv:
                {
                    var sym = _m.GetSymbolInfo(inv).Symbol as IMethodSymbol;
                    if (sym is null) return true; // dynamic / unresolved: assume it might
                    if (sym.MethodKind == MethodKind.DelegateInvoke || InSource(sym)) return true;
                    break;
                }
                case BaseObjectCreationExpressionSyntax oc:
                    if (_m.GetSymbolInfo(oc).Symbol is IMethodSymbol ctor && InSource(ctor)) return true;
                    break;
                case IdentifierNameSyntax id when id.Parent is ArgumentSyntax:
                    if (_m.GetSymbolInfo(id).Symbol is IMethodSymbol mg && InSource(mg)) return true;
                    break;
            }
        }
        return false;
    }

    private static bool InSource(ISymbol s) => s.Locations.Any(l => l.IsInSource);

    private static string FrameName(IMethodSymbol fn)
    {
        if (fn.MethodKind == MethodKind.LambdaMethod)
            return ContainerName(fn.ContainingSymbol) + ".<lambda>";
        if (fn.MethodKind == MethodKind.LocalFunction)
            return ContainerName(fn.ContainingSymbol) + "." + fn.Name;
        return ContainerName(fn);
    }

    private static string ContainerName(ISymbol? s)
    {
        switch (s)
        {
            case IMethodSymbol m when m.MethodKind is MethodKind.LambdaMethod or MethodKind.LocalFunction:
                return FrameName(m);
            case IMethodSymbol m when m.Name == "<Main>$":
                return "Program.Main";
            case null:
                return "<unknown>";
        }
        var type = s.ContainingType;
        var chain = new List<string>();
        for (var t = type; t != null; t = t.ContainingType) chain.Insert(0, t.Name);
        var member = s is IMethodSymbol { MethodKind: MethodKind.Constructor } ? ".ctor"
            : s is IMethodSymbol { MethodKind: MethodKind.StaticConstructor } ? ".cctor"
            : s.Name;
        return chain.Count == 0 ? member : string.Join(".", chain) + "." + member;
    }

    private static string Names(List<string> names) =>
        names.Count == 0 ? "null" : "new string[]{" + string.Join(",", names.Select(Lit)) + "}";

    private static string Values(List<string> names) =>
        names.Count == 0 ? "null" : "new object[]{" + string.Join(",", names.Select(n => "@" + n)) + "}";

    private static string Lit(string s) =>
        SyntaxFactory.Literal(s).ToFullString();
}
