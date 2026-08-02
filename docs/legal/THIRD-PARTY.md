# Third-party components

Warsha's own source code is licensed under Apache-2.0 (see [`LICENSE`](../../LICENSE)).
This document lists everything else Warsha relies on, how we rely on it, and what each
dependency obliges us to do.

Two words are used precisely throughout:

- **Bundled** — the component's files are copied into this repository and/or into the
  static build we publish. We are *redistributing* it, so its redistribution terms apply
  to us.
- **CDN-loaded** — the component is fetched by the user's browser at runtime from a
  third party's servers. We never copy or serve those files, so we are *not*
  redistributing them. What remains is a use-permission question (are our users allowed
  to use it?) plus a privacy consequence (the third party sees the request).

Last reviewed: 2026-08-02.

## Summary table

| Component | Version | License | Role in Warsha | How it reaches the user | Redistribution status |
|---|---|---|---|---|---|
| [CheerpJ](https://cheerpj.com/) (Leaning Technologies) | 4.x | **Proprietary** — CheerpJ Community License (free tier) | Java runtime: runs student Java code in the browser | **CDN-loaded** from `cjrtnc.leaningtech.com` | Not redistributed by us. Self-hosting is *prohibited* on the free tier — see below |
| [Pyodide](https://pyodide.org/) | 0.27.x | [MPL-2.0](https://github.com/pyodide/pyodide/blob/main/LICENSE) | Python runtime: CPython + stdlib compiled to WebAssembly | **CDN-loaded** from `cdn.jsdelivr.net` (self-hosting permitted) | Not currently redistributed; we may bundle it later — MPL-2.0 allows this |
| [CodeMirror 6](https://codemirror.net/) | 6.x | [MIT](https://github.com/codemirror/dev/blob/main/LICENSE) | Code editor (editing, syntax highlighting, search) | **Bundled** via npm into our JS build | Redistributed — MIT notice must be preserved |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.x | [MIT](https://github.com/101arrowz/fflate/blob/master/LICENSE) | Zip/unzip for project import and export | **Bundled** via npm into our JS build | Redistributed — MIT notice must be preserved |
| [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) | 0.1.x | [MIT](https://github.com/gzuidhof/coi-serviceworker/blob/master/LICENSE) | Injects COOP/COEP headers via a service worker so cross-origin isolation (and therefore `SharedArrayBuffer`) works on static hosts like GitHub Pages | **Bundled** — copied into our static output | Redistributed — MIT notice must be preserved |
| [ECJ](https://mvnrepository.com/artifact/org.eclipse.jdt/ecj) (`org.eclipse.jdt:ecj`, Eclipse Foundation) | 3.26.0 | [EPL-2.0](https://www.eclipse.org/legal/epl-2.0/) | Java compiler: compiles student Java source, running unmodified inside the CheerpJ JVM | **Bundled** — fetched from Maven Central at build time and served as a static asset | Redistributed — see the EPL-2.0 obligations below |
| [React](https://react.dev/) | 19.x | MIT | UI layer | **Bundled** via npm into our JS build | Redistributed — MIT notice must be preserved |
| [Tailwind CSS](https://tailwindcss.com/) | 4.x | MIT | Styling; compiles to CSS at build time | **Bundled** (generated CSS) | Redistributed — MIT notice must be preserved |

MIT and MPL-2.0 are both compatible with distributing Warsha under Apache-2.0. MPL-2.0
is file-level copyleft: if we ever *modify* Pyodide's own source files and ship the
result, those modified files stay MPL-2.0. Simply loading or bundling Pyodide unmodified
alongside our Apache-2.0 code creates no such obligation.

## CheerpJ: the licensing question that actually matters

CheerpJ is **not open source**. It is proprietary software from Leaning Technologies,
offered free under a "Community License" to some users and sold commercially to others.
Because Warsha's Java support cannot exist without it, its terms are load-bearing for
this project.

### Who may use it for free

Leaning Technologies' licensing page and documentation state that CheerpJ Core Community
Edition is free for:

- **Individuals, including one-person companies** — "Any personal projects, whether they
  generate income or not", including public-facing applications such as "games,
  educational applications, etc."
- **Free and Open-Source Software (FOSS) projects**
- **Technical evaluations** — proof-of-concept work, applications not yet in production

A **Commercial License is required** for "any business use (with exception of one-person
companies)", and separately for **self-hosting** and **OEM/redistribution**. Commercial
tiers begin at £100 per developer per month (teams up to 10) and scale to custom
Enterprise pricing.

Sources:
- <https://cheerpj.com/licensing/>
- <https://cheerpj.com/docs/licensing.html>
- <https://cheerpj.com/customer-license-agreement-february-2025/>

### Does Warsha qualify?

**Yes — Warsha qualifies under the FOSS category.** Warsha is a free and open-source
project, published under Apache-2.0, with no commercial offering, no paid tier, and no
organisation monetising it. That is squarely inside the stated free-use scope, and the
documentation explicitly names "educational applications" as an acceptable kind of
public-facing free-tier deployment.

Two obligations come with that, and both are conditions we must keep meeting rather than
one-time boxes to tick:

1. **We must load CheerpJ from Leaning Technologies' CDN.** The documentation states the
   Community License requires using the `cjrtnc.leaningtech.com` domain, and that "if you
   wish to self-host CheerpJ, you will need a Commercial License." Mirroring, vendoring,
   proxying, or caching the runtime onto our own hosting would breach the free tier. This
   is why Warsha's Java runtime is CDN-loaded and cannot be made to work offline.
2. **We must give appropriate credit.** The licensing table lists "give appropriate
   credits" as the action point for both individuals and FOSS projects. Warsha satisfies
   this in the README license section, in this file, and in the app's About/attribution
   surface. Removing that credit would put us outside the free tier.

### Where the terms are ambiguous, and the safe reading

The free tier is defined by *who the user is* rather than by a crisp legal test, and the
published terms do not define "business use". Three specific gaps matter to us:

- **Schools and other organisations are not named in the free tier.** The documentation
  lists individuals, FOSS projects, and evaluations. Educational institutions appear only
  under "Academic — free or heavily discounted", which is presented as something to
  arrange with Leaning Technologies, not an automatic entitlement. *Safe reading:*
  Warsha-the-project is covered because it is FOSS. A school running the public Warsha
  site is just a visitor to a FOSS website and needs nothing. But a school or company
  that **forks Warsha into a private, non-public, or non-FOSS deployment** may no longer
  be inside the FOSS category and should get its own license or academic arrangement. We
  should say this plainly to any institution that asks about forking, and not imply our
  license covers them.
- **No revenue or headcount threshold applies to the free tier.** The 10-person figure is
  the boundary between two *paid* tiers, not a free-use limit. Do not describe CheerpJ as
  "free under X users" or "free below Y revenue" — that is not what the terms say.
- **The Customer License Agreement does not describe the Community tier.** The published
  agreement covers Evaluation and paid licenses; it contains no Community License
  definition, no CDN terms, and no telemetry clause. So the free tier's terms exist only
  as prose on a marketing/docs page, which the vendor can revise at any time without
  notifying us. *Safe reading:* treat the CheerpJ dependency as revocable and re-check
  the licensing page before each release. The same agreement reserves the vendor's right
  "to replace certain core functionality, or to end of life non-core functionality",
  and disclaims all warranties.

### What CDN-loading implies for our users

Because the browser fetches CheerpJ directly from `cjrtnc.leaningtech.com`, Leaning
Technologies' servers necessarily see each user's IP address, user-agent, approximate
time of use, and the referring page — the same metadata any website's third-party asset
request exposes. Leaning Technologies' privacy policy states their *site* "collects
certain information automatically, including your IP address, the type of browser you are
using, and certain other non-personal data" and that they "do not place cookies on your
computer or device". It contains **no specific disclosure covering the runtime CDN**, so
we cannot make promises on their behalf beyond ordinary server-log metadata. Warsha does
not send any student code, filenames, or project content to them — code is compiled and
executed locally inside the browser sandbox after the runtime loads. This is stated
honestly in [`PRIVACY.md`](./PRIVACY.md).

The same reasoning applies to Pyodide via `cdn.jsdelivr.net`, with one difference:
Pyodide is MPL-2.0, so we are free to self-host it whenever we want to remove that
dependency. We are not free to do the same for CheerpJ.

## Java class library and compiler

CheerpJ ships its own full OpenJDK-derived JRE as part of the runtime it serves from its
CDN, so Warsha does not distribute a Java class library.

Compiling Java in the browser needs a compiler that CheerpJ can run. This must be
sourced carefully:

- **Never** commit or ship an Oracle JDK `tools.jar` or any other Oracle JDK binary.
  Oracle's binary license does not permit redistribution, and doing so in a public
  open-source repository is a licensing violation regardless of intent. Any such file
  found in this repository must be removed.
- **Acceptable options:** the `tools.jar` from an OpenJDK build (for example Eclipse
  Temurin), which is GPLv2 **with Classpath Exception** — redistributable, and the
  Classpath Exception means linking it does not impose GPL terms on Warsha's own code; or
  the [Eclipse Compiler for Java (`ecj`)](https://mvnrepository.com/artifact/org.eclipse.jdt.core.compiler/ecj),
  licensed EPL-2.0, which is a standalone redistributable batch compiler.

**What Warsha chose: ECJ 3.26.0, EPL-2.0.** It is in the table above as a bundled
component. Three details matter:

- **Why 3.26.0 specifically.** It is the last ECJ release whose own class files are Java 8
  bytecode (major version 52). Every later release is Java 11 or newer and cannot run on
  CheerpJ's Java 8 JVM. This pin is a runtime constraint, not a preference.
- **It is never committed.** `*.jar` is gitignored repo-wide.
  [`runtimes/java/fetch-compiler.sh`](../../runtimes/java/fetch-compiler.sh) fetches it
  from Maven Central at build time and verifies its SHA-256 against a pinned digest; that
  script is the provenance record.
- **EPL-2.0 obligations we must keep meeting.** Preserve the license notice (the jar's own
  `about.html` travels with it, and [`NOTICE`](../../NOTICE) carries the attribution);
  state that the file is unmodified ECJ, which it is; and point to the corresponding
  source, published as `ecj-3.26.0-sources.jar` at the same Maven coordinates. EPL-2.0 is
  file-level copyleft over ECJ's own files only — shipping it unmodified alongside our
  Apache-2.0 code imposes nothing on Warsha's code.

Any future replacement is also a **bundled** component and must be added to the table
above with its license and version before it ships.

## Language icons

The file badges and welcome cards show a Java mark and a Python mark
([`app/src/components/ui/LangIcons.tsx`](../../app/src/components/ui/LangIcons.tsx)).
These are trademarks, not code, so the licence table above is the wrong instrument —
what governs them is each owner's trademark policy. The two are handled differently
on purpose.

### Python — the PSF mark, embedded unaltered

**Conclusion: permitted, no approval needed, provided we never restyle it.**

The PSF's [trademark usage policy](https://www.python.org/psf/trademarks/) (reviewed
2026-08-02) grants exactly the use Warsha is making. Verbatim:

> stating accurately that software is written in the Python programming language, that
> it is compatible with the Python programming language, or that it contains the Python
> programming language, is always allowed

and, on how that may be expressed:

> you may use the word "Python" or the unaltered logos to indicate this, without our
> prior approval. This is true both for non-commercial and commercial uses.

Warsha runs student Python via Pyodide, so "contains the Python programming language"
is a true statement and the badge asserts nothing beyond it. The policy also settles
that the snakes alone qualify: *"The 'intertwined snakes' graphic alone is an unaltered
version, whether or not accompanied by the words in PSF-provided logos."*

The load-bearing word is **unaltered**. The same policy says *"Logos that simply change
the colors or fonts require permission from the PSF Trademarks Committee"* and
*"Modifications that modify or obscure any part of the shape of the logo will not be
approved."* A version redrawn in Warsha's 1.6px house stroke, or flattened to
`currentColor` to match the rest of the icon set, is a derived logo and would need
approval we do not have. So the component embeds the real artwork with its original
paths and gradients, and only pads and uniformly scales it. **Do not recolour it.**

### Java — a generic coffee cup, drawn from scratch

**Conclusion: no Oracle mark is used, and none is imitated.**

Oracle owns the Java trademarks, including the wordmark, the steaming-cup logo and
Duke, and its policy is materially narrower than the PSF's — so unlike Python, there is
no unaltered-logo path here and we take none. Warsha's icon is an ordinary coffee cup
with a saucer and steam, drawn from scratch on our own grid: a coffee cup is not
distinctive of Oracle, it is the generic convention every editor and icon theme uses to
mean "a `.java` file", and nothing in the glyph reproduces Oracle's artwork.

The word "Java" appears only to state accurately which language a file is written in
and which language Warsha runs, which is nominative use. Warsha makes no claim of
Oracle endorsement, affiliation, or Java compatibility certification, and must not.

## Maintaining this file

Add a row before merging anything that introduces a new runtime dependency, npm package
that ships to users, or CDN origin. Build-time-only tools (Vite, TypeScript) do not reach
users and do not need rows, though they must still be OSI-licensed. Re-check the CheerpJ
licensing page at every release and update the "Last reviewed" date above.
