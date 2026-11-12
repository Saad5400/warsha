/*! coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed under MIT
 *
 * MODIFIED for Warsha. Three changes, all additive; the original logic is intact:
 *
 *   1. An offline caching layer wraps the fetch handler: cache-first only for
 *      URLs whose bytes cannot change (content-hashed /assets/, version-pinned
 *      CDNs), revalidated with the server for everything else, so a deploy
 *      reaches a returning student instead of being shadowed by the cache (see
 *      `isImmutable`). The COOP/COEP header transform below (now `isolate()`)
 *      still runs on every response we serve — from the network OR the cache —
 *      so cross-origin isolation holds offline exactly as it does online.
 *   2. The window-side script now registers even when the origin already sends
 *      the isolation headers (production nginx). Upstream returned early there
 *      because header injection was its only job; Warsha also needs the worker
 *      present to serve the app and its runtimes with no network. The isolation
 *      *reloads* stay gated on `!crossOriginIsolated`, so an already-isolated
 *      page registers with zero reloads and a header-less host still reloads
 *      exactly once — the invariant tools/qa/verify.mjs pins.
 *   3. `isolate()` drops the body on a null-body status — see the note there.
 *
 * See app/ARCHITECTURE.md §2.5 and docs/legal/THIRD-PARTY.md.
 */
let coepCredentialless = false;
if (typeof window === 'undefined') {
    // ---- Warsha offline caching layer -----------------------------------
    // These two globals are injected at build time by the plugin in
    // app/vite.config.ts, which PREPENDS them to dist/coi-serviceworker.js. In
    // dev the file is served straight from public/ with neither defined, so
    // both fall back: precaching is skipped and runtime caching does the rest —
    // dev is never run offline, so that is fine.
    const VERSION = self.__WARSHA_VERSION__ || 'dev';
    // Every file this build emitted under /assets/ (content-hashed, so a name is
    // a version). The JS/CSS among them is precached; the whole list is what
    // says which /assets/ entries a deploy has retired (see `prune`).
    const ASSETS = self.__WARSHA_ASSETS__ || [];
    const ASSET_PATHS = new Set(ASSETS.map((a) => new URL(a, self.location.href).pathname));
    // Under `vite dev` neither global is injected, so VERSION stays 'dev'. In that
    // mode we MUST NOT cache: every module Vite serves is same-origin, so cache-first
    // would pin the first build and silently swallow every later edit (HMR included).
    // Isolation still holds — isolate() stamps COOP/COEP on the live network response.
    const DEV = VERSION === 'dev';

    // Two caches, split by how long their contents stay true.
    //
    // SHELL_CACHE is per build: the documents and boot files a navigation needs
    // offline. A deploy replaces it whole, which is right — it is small, and it
    // is the shell OF that build.
    //
    // KEEP_CACHE is NOT per build, and that is the point of it. It holds the
    // downloads: the hashed /assets/ chunks, the language runtimes from their
    // version-pinned CDN URLs, and the public/ runtime files (the .NET bundle,
    // the esbuild wasm…). These used to live in per-build caches too, so every
    // deploy threw them away — each language re-downloaded after every release
    // (the C toolchain alone is ~47 MB over the wire), and a student who went
    // offline before re-running a language online found it gone. Keyed by URL
    // instead, an entry is either still exactly right (an immutable URL), or is
    // revalidated before use (`revalidate`), so nothing about a deploy makes it
    // wrong. It is pruned by reference and by size (`prune`), never wholesale.
    const SHELL_CACHE = `warsha-shell-${VERSION}`;
    const KEEP_CACHE = 'warsha-keep';
    // Last-use time and size per KEEP_CACHE entry, for the LRU cap. Its own tiny
    // cache so it is never mistaken for a download.
    const KEEP_INDEX_CACHE = 'warsha-keep-index';
    const KEEP_INDEX_KEY = new URL('/__warsha-keep-index', self.location.href).href;
    // Everything Warsha runs today is ~200 MB decoded (the C toolchain image is
    // ~110 MB of it). The cap leaves room for one generation of runtime version
    // bumps beside the current one; past it, the least recently used entries go.
    const KEEP_CAP_BYTES = 500 * 1024 * 1024;

    // The app shell: the stable entry and icon set from public/, plus this
    // build's hashed JS/CSS (which goes to KEEP_CACHE, see install). `./` and
    // `./index.html` are both listed because a navigation to the origin root and
    // one to /index.html are cached under different keys, and the navigation
    // fallback below tries both.
    const SHELL = [
        './',
        './index.html',
        // The per-locale entry points (app/ARCHITECTURE.md §7). Precached so a
        // student who installed from an /ar/ link still opens offline on the
        // document they bookmarked. They do not exist under `vite dev`, where
        // only the build emits them — cache.add's per-URL .catch below covers
        // that without failing the whole install.
        './ar/',
        './en/',
        // This very file, as the page's first <script>: an offline reload asks
        // for it before anything else. It used to be served offline only by
        // luck, from a heuristically-fresh HTTP cache entry; with the server's
        // `no-cache` and our `no-store` revalidation that door is shut, so it
        // has to be in the shell like every other boot file.
        './coi-serviceworker.js',
        './manifest.webmanifest',
        './favicon.svg',
        './favicon.ico',
        './apple-touch-icon.png',
        './icon-192.png',
        './icon-512.png',
        // Both UI font subsets, not just the one this visit needs: the shell
        // has to be complete offline in either language, and a student who
        // switches to Arabic on a plane would otherwise fall back to a system
        // face mid-session.
        './fonts/readex-pro-latin-wght-normal.woff2',
        './fonts/readex-pro-arabic-wght-normal.woff2',
    ];
    const PRECACHE = ASSETS.filter((a) => /\.(js|css)$/.test(a));

    // Cross-origin URLs we cache, all of them immutable by construction — the
    // version (or the content hash) is IN the URL, so a cached copy can never
    // be out of date and is served without asking. A runtime a student has
    // downloaded once keeps working offline and is never re-downloaded.
    //   - Pyodide: cdn.jsdelivr.net/pyodide/v<version>/…
    //   - CheerpJ: cjrtnc.leaningtech.com/<version>/…
    //   - the C engine's JS: unpkg.com/<pkg>@<exact x.y.z>/… — only an exact
    //     version; a bare or ranged one is a redirect to whatever is latest
    //   - the C toolchain image: cdn.wasmer.io/webcimages/<sha256>.webc,
    //     content-addressed. (Its registry lookup is a POST and cannot be
    //     cached, which is why C still needs the network to start.)
    const PINNED = [
        /^https:\/\/cdn\.jsdelivr\.net\/pyodide\/v\d[^/]*\//,
        /^https:\/\/cjrtnc\.leaningtech\.com\/\d[^/]*\//,
        /^https:\/\/unpkg\.com\/(@[^/]+\/)?[^/@]+@\d+\.\d+\.\d+[^/]*\//,
        /^https:\/\/cdn\.wasmer\.io\/webcimages\/[0-9a-f]{64}\.webc$/,
    ];
    const isPinned = (url) => PINNED.some((re) => re.test(url));
    const isSameOrigin = (url) => new URL(url).origin === self.location.origin;

    // What we are willing to store: GET only, and either same-origin or pinned.
    // `storable` below decides which RESPONSES get kept.
    const cacheable = (request) =>
        request.method === 'GET' && (isSameOrigin(request.url) || isPinned(request.url));

    // Which cached copies may be served without asking the network first. Only
    // a URL whose bytes can never change: Vite's content-hashed /assets/ (a new
    // build is a new name) and the pinned CDN URLs above. Every other
    // same-origin file keeps its name across deploys — the public/ runtime files
    // (warsha-jvm.worker.js, warsha-dotnet/**, warsha-esbuild.wasm, the
    // framework JSON…), the icons, the pages — and is revalidated instead; see
    // `revalidate`.
    //
    // This split is the fix for a live bug. Everything same-origin used to be
    // cache-first, so an unhashed worker cached under one build was served, as
    // is, to the next build's bundle: an old Java worker driving a new jar, a
    // .NET boot manifest whose files no longer matched. And because the cache
    // name only changes when a HASHED file does, a deploy that touched only a
    // runtime file never reached returning students at all.
    const isImmutable = (url) =>
        isPinned(url) || (isSameOrigin(url) && new URL(url).pathname.startsWith('/assets/'));

    // Past this, a revalidation that has not even answered with headers is given
    // up on and the cached copy served: on a connection that is technically up
    // but carrying nothing, a student who has the file must not wait on it.
    const REVALIDATE_TIMEOUT_MS = 6000;

    // Fetch-spec null-body statuses: `new Response(body, {status})` throws for
    // these, and CheerpJ's conditional Range reads come back 304 — the crash that
    // surfaced as "Warsha could not start Java".
    const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

    // Whether a network response may go into Cache Storage. Only a complete,
    // readable, real answer:
    //   - `ok` and not partial. Range requests never reach here (see the fetch
    //     handler), but a `206`/`Content-Range` must never be stored and later
    //     replayed as if it were the whole resource.
    //   - not opaque. An opaque response cannot carry the CORP that isolate()
    //     needs, and Chrome PADS an opaque entry to a large phantom size for
    //     quota accounting — a handful would blow the origin quota and evict the
    //     student's OPFS files. (So CheerpJ, whose loader arrives via a no-cors
    //     `importScripts()`, is only partially cached and not guaranteed
    //     offline. See tools/qa/offline-check.mjs and ARCHITECTURE §2.5.)
    //   - not an HTML page answering for a script, wasm or dll. That is a host's
    //     SPA fallback covering a missing file (a chunk an old page still asks
    //     for after a deploy deleted it); stored, it would be replayed as that
    //     file for the life of the cache. Pages themselves end in `/` or `.html`.
    const storable = (request, response) => {
        if (!response || !response.ok || response.status === 206 || response.type === 'opaque') return false;
        if (response.headers.has('content-range')) return false;
        const path = new URL(request.url).pathname;
        const isPage = path.endsWith('/') || path.endsWith('.html');
        return isPage || !/text\/html/i.test(response.headers.get('content-type') || '');
    };

    // ---- the KEEP_CACHE index (LRU) --------------------------------------
    // url -> [lastUsedMs, bytes]. Held in memory, written back after a quiet
    // second: a worker killed before the write loses only some recency, which
    // makes the cap slightly less fair, never wrong.
    let index = null;
    const loadIndex = () => (index ??= (async () => {
        try {
            const res = await (await caches.open(KEEP_INDEX_CACHE)).match(KEEP_INDEX_KEY);
            return res ? await res.json() : {};
        } catch {
            return {};
        }
    })());
    let persistTimer = 0;
    const persistIndex = () => {
        clearTimeout(persistTimer);
        persistTimer = setTimeout(async () => {
            const body = JSON.stringify(await loadIndex());
            const cache = await caches.open(KEEP_INDEX_CACHE);
            await cache.put(KEEP_INDEX_KEY, new Response(body, { headers: { 'content-type': 'application/json' } }));
        }, 1000);
    };
    // Entries this worker has served: the cap never evicts what is in use.
    const usedNow = new Set();
    const touch = async (url, bytes) => {
        const idx = await loadIndex();
        usedNow.add(url);
        idx[url] = [Date.now(), bytes ?? idx[url]?.[1] ?? 0];
        persistIndex();
    };

    // Store into KEEP_CACHE, counting the bytes as they stream into the cache
    // (the decoded size, which is what quota sees — Content-Length is the
    // compressed one, and reading a 110 MB body twice to measure it is not on).
    // Awaited by callers so the copy is taken before the response goes back to
    // the page; the write itself is not awaited, so a large runtime is not held
    // back until it is on disk.
    const keep = async (request, response) => {
        if (!storable(request, response)) return;
        const cache = await caches.open(KEEP_CACHE);
        let bytes = 0;
        const counted = response.clone().body.pipeThrough(new TransformStream({
            transform(chunk, ctl) {
                bytes += chunk.byteLength;
                ctl.enqueue(chunk);
            },
        }));
        const copy = new Response(counted, { status: response.status, statusText: response.statusText, headers: response.headers });
        cache.put(request, copy)
            .then(() => touch(request.url, bytes))
            .then(() => schedulePrune())
            .catch(() => {});
    };

    // Retire what no build uses any more, then hold KEEP_CACHE under its cap.
    //   1. A /assets/ entry this build did not emit is a chunk of an older build
    //      (content-hashed names are never reused); nothing current asks for it.
    //   2. Past KEEP_CAP_BYTES, least recently used first — the only way a
    //      pinned CDN version a runtime has moved on from ever leaves (the worker
    //      cannot know which versions the runtimes pin; recency tells it).
    // Serialized, and debounced after stores, so a burst of downloads is one pass.
    let pruning = Promise.resolve();
    let pruneTimer = 0;
    const schedulePrune = () => {
        clearTimeout(pruneTimer);
        pruneTimer = setTimeout(() => { pruning = pruning.then(prune, prune); }, 5000);
    };
    const prune = async () => {
        if (DEV) return;
        const cache = await caches.open(KEEP_CACHE);
        const idx = await loadIndex();
        const present = new Set();
        for (const req of await cache.keys()) {
            const u = new URL(req.url);
            if (ASSET_PATHS.size && u.origin === self.location.origin && u.pathname.startsWith('/assets/')
                && !ASSET_PATHS.has(u.pathname)) {
                await cache.delete(req);
                continue;
            }
            present.add(req.url);
        }
        for (const url of Object.keys(idx)) if (!present.has(url)) delete idx[url];
        // Entries with no record (moved over from an older worker's caches):
        // oldest possible use, size read once from the stored body.
        for (const url of present) {
            if (idx[url]) continue;
            const res = await cache.match(url);
            idx[url] = [0, res ? (await res.blob()).size : 0];
        }
        let total = 0;
        for (const url of present) total += idx[url][1];
        const byAge = [...present].sort((a, b) => idx[a][0] - idx[b][0]);
        for (const url of byAge) {
            if (total <= KEEP_CAP_BYTES) break;
            if (usedNow.has(url)) continue;
            await cache.delete(url);
            total -= idx[url][1];
            delete idx[url];
        }
        persistIndex();
    };

    // Cache-first, for immutable URLs only. Once a student has run a language
    // online its engine is served from Cache Storage — which
    // requestPersistence() (app/src/fs/health.ts) keeps from being evicted — so
    // it works offline and is never re-downloaded.
    const cacheFirst = async (r, request) => {
        const cached = await caches.match(r);
        if (cached) {
            touch(r.url);
            return isolate(cached);
        }
        const net = await fetch(request);
        await keep(r, net);
        return isolate(net);
    };

    // For a URL that keeps its name across deploys: ask the server whether the
    // cached copy is still the deployed one — a conditional request, so an
    // unchanged file costs a 304 and no body — and serve the cache only when it
    // says yes, or when it cannot be asked (offline, which is what keeps the
    // installed app working with no network).
    //
    // `cache: 'no-store'` on both requests: the HTTP cache must not answer for
    // the server. It is exactly what used to hand back a heuristically "fresh"
    // file from the previous deploy, and it would hold a second copy of a 37 MB
    // runtime we already keep here.
    const revalidate = async (r, request) => {
        const cached = await caches.match(r);
        if (!cached) {
            const net = await fetch(request, { cache: 'no-store' });
            await keep(r, net);
            return isolate(net);
        }
        const headers = new Headers();
        const etag = cached.headers.get('etag');
        const modified = cached.headers.get('last-modified');
        if (etag) headers.set('if-none-match', etag);
        if (modified) headers.set('if-modified-since', modified);
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), REVALIDATE_TIMEOUT_MS);
        let net;
        try {
            // By URL, not by cloning `request`: a no-cors request (a classic
            // <script>, an <img>) would silently drop the conditional headers.
            net = await fetch(r.url, { headers, cache: 'no-store', credentials: 'same-origin', signal: abort.signal });
        } catch {
            touch(r.url);
            return isolate(cached);
        } finally {
            clearTimeout(timer);
        }
        // 304: still current. 5xx: the server is having a moment, and the copy we
        // have beats an error page. Anything else (200, 404) is the deploy's
        // answer and wins over the cache.
        if (net.status === 304 || net.status >= 500) {
            touch(r.url);
            return isolate(cached);
        }
        await keep(r, net);
        return isolate(net);
    };

    self.addEventListener("install", (event) => {
        self.skipWaiting();
        // Best-effort, per item: a single 404 (an icon renamed between builds,
        // say) must not abort the whole precache the way `cache.addAll` would.
        // `cache: 'reload'` skips the HTTP cache so a fresh deploy is precached,
        // not a stale copy.
        event.waitUntil((async () => {
            const shell = await caches.open(SHELL_CACHE);
            const kept = await caches.open(KEEP_CACHE);
            await Promise.all([
                ...SHELL.map((url) => shell.add(new Request(url, { cache: 'reload' })).catch(() => {})),
                // A chunk an earlier build already brought is the same bytes under
                // the same name: only what this deploy actually changed downloads.
                ...PRECACHE.map(async (url) => {
                    const req = new Request(url, { cache: 'reload' });
                    if (await kept.match(req)) return;
                    await keep(req, await fetch(req)).catch(() => {});
                }),
            ]);
        })());
    });

    self.addEventListener("activate", (event) => {
        event.waitUntil((async () => {
            await self.clients.claim();
            if (DEV) {
                // In dev, keep nothing: a stale dev cache is exactly what we must purge.
                await Promise.all((await caches.keys())
                    .filter((n) => n.startsWith('warsha-'))
                    .map((n) => caches.delete(n)));
                return;
            }
            // Older builds' caches go — but anything immutable in them moves to
            // KEEP_CACHE first. That covers the caches of workers from before
            // KEEP_CACHE existed (warsha-runtime-<v> held Pyodide and CheerpJ), so
            // the deploy that introduces it costs no student a re-download either.
            const kept = await caches.open(KEEP_CACHE);
            const live = new Set([SHELL_CACHE, KEEP_CACHE, KEEP_INDEX_CACHE]);
            for (const name of await caches.keys()) {
                if (!name.startsWith('warsha-') || live.has(name)) continue;
                const old = await caches.open(name);
                for (const req of await old.keys()) {
                    if (!isImmutable(req.url) || (await kept.match(req))) continue;
                    const res = await old.match(req);
                    if (res) await kept.put(req, res).catch(() => {});
                }
                await caches.delete(name);
            }
            await (pruning = pruning.then(prune, prune));
        })());
    });

    self.addEventListener("message", (ev) => {
        if (!ev.data) {
            return;
        } else if (ev.data.type === "deregister") {
            self.registration
                .unregister()
                .then(() => {
                    return self.clients.matchAll();
                })
                .then(clients => {
                    clients.forEach((client) => client.navigate(client.url));
                });
        } else if (ev.data.type === "coepCredentialless") {
            coepCredentialless = ev.data.value;
        }
    });

    // The upstream coi transform: rewrites a response so it can live in a
    // cross-origin-isolated page. Opaque responses (status 0) pass through as
    // they must — their headers cannot be rewritten. Called on EVERY response we
    // return, network or cache, which is what keeps isolation intact offline.
    const isolate = (response) => {
        if (response.status === 0) {
            return response;
        }

        const newHeaders = new Headers(response.headers);
        newHeaders.set("Cross-Origin-Embedder-Policy",
            coepCredentialless ? "credentialless" : "require-corp"
        );
        if (!coepCredentialless) {
            newHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");
        }
        newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");

        return new Response(NULL_BODY_STATUS.has(response.status) ? null : response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
        });
    };

    self.addEventListener("fetch", function (event) {
        const r = event.request;
        if (r.cache === "only-if-cached" && r.mode !== "same-origin") {
            return;
        }

        const request = (coepCredentialless && r.mode === "no-cors")
            ? new Request(r, {
                credentials: "omit",
            })
            : r;

        // Range requests bypass the cache ENTIRELY — straight to the network,
        // never read from cache, never stored. CheerpJ reads /app/ecj.jar and
        // /app/warsha-boot.jar (same-origin GETs, so otherwise `cacheable`) in
        // many HTTP Range requests
        // and REQUIRES a `206 Partial Content` + `Content-Range` on every one;
        // the moment it sees a `200` with the whole body it decides the host has
        // no Range support and refuses to run — which surfaces to the student as
        // "Warsha could not start Java" (the engine fails to start). The Cache
        // API cannot satisfy a range: `caches.match()` ignores the Range header
        // and replays the full stored `200`, so a SINGLE full-body ecj.jar in the
        // cache (one non-range probe, or a server that answers `bytes=0-` with
        // `200`) poisons every subsequent range read for the life of that cache.
        // Passing range requests through untouched keeps CheerpJ on the exact
        // byte-range path it had before this caching layer existed. This does not
        // cost offline support: a range read could never be served from Cache
        // Storage anyway, and neither the app shell nor Pyodide uses Range.
        // See runtimes/java/INTEGRATION.md ("The host must support HTTP Range").
        if (r.headers.has("range")) {
            event.respondWith(
                fetch(request)
                    .then((response) => isolate(response))
                    .catch((e) => console.error(e))
            );
            return;
        }

        // Navigations: network-first, so a fresh deploy is picked up the moment
        // the student is online, falling back to the cached shell when they are
        // not. This is the line that makes the installed app open with no
        // network at all.
        if (r.mode === "navigate") {
            event.respondWith((async () => {
                // Keyed by the path actually navigated to, NOT by a fixed
                // "./index.html". While `/` was the only document that
                // distinction did not exist; with the per-locale entry points
                // (/ar/, /en/ — app/ARCHITECTURE.md §7) it does, and caching
                // every navigation under the one key would hand the Arabic
                // document to a later offline navigation to `/`.
                const path = new URL(request.url).pathname;
                try {
                    // `no-cache`: always ask the server, never take the HTTP
                    // cache's word for it. A document that host sent without
                    // Cache-Control is heuristically "fresh" for days, and an
                    // old document after a deploy is the root of the whole
                    // stale-build failure: it asks for hashed chunks that no
                    // longer exist. (`fetch(navigateRequest, init)` downgrades
                    // the mode to same-origin; redirects stay manual, so a 3xx
                    // still reaches the browser as an opaqueredirect it follows.)
                    const net = await fetch(request, { cache: 'no-cache' });
                    if (net && net.status === 200) {
                        const cache = await caches.open(SHELL_CACHE);
                        cache.put(path, net.clone()).catch(() => {});
                    }
                    return isolate(net);
                } catch (err) {
                    // Own path first, then the root shell. The fallbacks still
                    // boot a working app either way — locale.ts reads the live
                    // location, not the served document — so the worst case of
                    // landing on the root copy is a <head> nobody reads offline.
                    const cached =
                        (await caches.match(path)) ||
                        (await caches.match("./index.html")) ||
                        (await caches.match("./"));
                    if (cached) return isolate(cached);
                    throw err;
                }
            })());
            return;
        }

        // The shell and the runtime CDNs: cache-first where the URL pins its
        // bytes, revalidated where it does not — see `isImmutable`.
        if (!DEV && cacheable(r)) {
            event.respondWith(isImmutable(r.url) ? cacheFirst(r, request) : revalidate(r, request));
            return;
        }

        // Everything else: the upstream pass-through, network only.
        event.respondWith(
            fetch(request)
                .then((response) => isolate(response))
                .catch((e) => console.error(e))
        );
    });

} else {
    (() => {
        const reloadedBySelf = window.sessionStorage.getItem("coiReloadedBySelf");
        window.sessionStorage.removeItem("coiReloadedBySelf");
        const coepDegrading = (reloadedBySelf == "coepdegrade");

        // You can customize the behavior of this script through a global `coi` variable.
        const coi = {
            shouldRegister: () => !reloadedBySelf,
            shouldDeregister: () => false,
            coepCredentialless: () => true,
            coepDegrade: () => true,
            doReload: () => window.location.reload(),
            quiet: false,
            ...window.coi
        };

        const n = navigator;
        const controlling = n.serviceWorker && n.serviceWorker.controller;

        // Record the failure if the page is served by serviceWorker.
        if (controlling && !window.crossOriginIsolated) {
            window.sessionStorage.setItem("coiCoepHasFailed", "true");
        }
        const coepHasFailed = window.sessionStorage.getItem("coiCoepHasFailed");

        if (controlling) {
            // Reload only on the first failure.
            const reloadToDegrade = coi.coepDegrade() && !(
                coepDegrading || window.crossOriginIsolated
            );
            n.serviceWorker.controller.postMessage({
                type: "coepCredentialless",
                value: (reloadToDegrade || coepHasFailed && coi.coepDegrade())
                    ? false
                    : coi.coepCredentialless(),
            });
            if (reloadToDegrade) {
                !coi.quiet && console.log("Reloading page to degrade COEP.");
                window.sessionStorage.setItem("coiReloadedBySelf", "coepdegrade");
                coi.doReload("coepdegrade");
            }

            if (coi.shouldDeregister()) {
                n.serviceWorker.controller.postMessage({ type: "deregister" });
            }
        }

        // Warsha: register even when the page is ALREADY cross-origin isolated
        // (production, where nginx sends the headers). Upstream returned here —
        // `if (window.crossOriginIsolated !== false || ...) return` — because
        // injecting headers was its whole purpose; Warsha also needs the worker
        // installed so the app and its runtimes are cached and available
        // offline. The only guard kept is the reload-loop one. Also bail if the
        // browser has no notion of crossOriginIsolated (nothing to register for)
        // OR give up if a secure context / serviceWorker is unavailable, below.
        if (typeof window.crossOriginIsolated === "undefined" || !coi.shouldRegister()) return;

        if (!window.isSecureContext) {
            !coi.quiet && console.log("COOP/COEP Service Worker not registered, a secure context is required.");
            return;
        }

        // In some environments (e.g. Firefox private mode) this won't be available
        if (!n.serviceWorker) {
            !coi.quiet && console.error("COOP/COEP Service Worker not registered, perhaps due to private mode.");
            return;
        }

        // Warsha: reload once when the worker FIRST takes control of this page,
        // so the navigation is re-served with the isolation headers. Upstream
        // checked `registration.active && !controller` at register()-time, but
        // Warsha's `install` now precaches the shell in `waitUntil`, so at that
        // moment the worker is usually still *installing* (`registration.active`
        // is null) and that check silently no-ops — the bug that left the page
        // controlled but never isolated. `controllerchange` fires exactly when
        // `clients.claim()` lands, regardless of install/activate timing, which
        // makes the reload reliable. Gated on `!crossOriginIsolated` so an
        // already-isolated page (production, server sends the headers) never
        // reloads, and the sessionStorage guard keeps it to a single reload.
        if (!n.serviceWorker.controller) {
            n.serviceWorker.addEventListener("controllerchange", () => {
                if (window.crossOriginIsolated) return;
                !coi.quiet && console.log("Reloading page to make use of COOP/COEP Service Worker.");
                window.sessionStorage.setItem("coiReloadedBySelf", "controllerchange");
                coi.doReload();
            });
        }

        n.serviceWorker.register(window.document.currentScript.src).then(
            (registration) => {
                !coi.quiet && console.log("COOP/COEP Service Worker registered", registration.scope);
            },
            (err) => {
                !coi.quiet && console.error("COOP/COEP Service Worker failed to register:", err);
            }
        );
    })();
}
