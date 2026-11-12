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
    const PRECACHE = self.__WARSHA_PRECACHE__ || [];
    const SHELL_CACHE = `warsha-shell-${VERSION}`;
    const RUNTIME_CACHE = `warsha-runtime-${VERSION}`;
    // Under `vite dev` neither global is injected, so VERSION stays 'dev'. In that
    // mode we MUST NOT cache: every module Vite serves is same-origin, so cache-first
    // would pin the first build and silently swallow every later edit (HMR included).
    // Isolation still holds — isolate() stamps COOP/COEP on the live network response.
    const DEV = VERSION === 'dev';

    // The app shell: the build-hashed JS/CSS (injected above) plus the stable
    // entry and icon set from public/. `./` and `./index.html` are both listed
    // because a navigation to the origin root and one to /index.html are cached
    // under different keys, and the navigation fallback below tries both.
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
        ...PRECACHE,
    ];

    // Cross-origin origins we cache-first: the two runtime CDNs, and nothing
    // else. Pyodide (jsdelivr) and CheerpJ (leaningtech) are what a student
    // downloads once and must keep working with offline.
    const RUNTIME_HOSTS = [
        'https://cdn.jsdelivr.net/pyodide/',
        'https://cjrtnc.leaningtech.com/',
    ];
    const isRuntimeHost = (url) => RUNTIME_HOSTS.some((h) => url.startsWith(h));

    // What we are willing to store: GET only, and either same-origin or a
    // runtime CDN. `storable` below decides which RESPONSES get kept.
    const cacheable = (request) => {
        if (request.method !== 'GET') return false;
        const url = request.url;
        return new URL(url).origin === self.location.origin || isRuntimeHost(url);
    };

    // Which cached copies may be served without asking the network first. Only
    // a URL whose bytes can never change: Vite's content-hashed /assets/ (a new
    // build is a new name) and the runtime CDNs, whose URLs pin a version
    // (pyodide/v0.x/…, leaningtech/4.3/…). Every other same-origin file keeps its
    // name across deploys — the public/ runtime files (warsha-jvm.worker.js,
    // warsha-dotnet/**, warsha-esbuild.wasm, the framework JSON…), the icons, the
    // pages — and is revalidated instead; see `revalidate`.
    //
    // This split is the fix for a live bug. Everything same-origin used to be
    // cache-first, so an unhashed worker cached under one build was served, as
    // is, to the next build's bundle: an old Java worker driving a new jar, a
    // .NET boot manifest whose files no longer matched. And because the cache
    // name only changes when a HASHED file does, a deploy that touched only a
    // runtime file never reached returning students at all.
    const isImmutable = (url) =>
        isRuntimeHost(url) || new URL(url).pathname.startsWith('/assets/');

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

    // Awaited by callers so the copy is taken (and the write under way) before
    // the response goes back to the page; the write itself is not awaited, so a
    // 37 MB runtime is not held back until it is on disk.
    const store = async (request, response) => {
        if (!storable(request, response)) return;
        const cache = await caches.open(isRuntimeHost(request.url) ? RUNTIME_CACHE : SHELL_CACHE);
        cache.put(request, response.clone()).catch(() => {});
    };

    // Cache-first, for immutable URLs only. Once a student has run a language
    // online its engine is served from Cache Storage — which
    // requestPersistence() (app/src/fs/health.ts) keeps from being evicted — so
    // it works offline and is never re-downloaded.
    const cacheFirst = async (r, request) => {
        const cached = await caches.match(r);
        if (cached) return isolate(cached);
        const net = await fetch(request);
        await store(r, net);
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
            await store(r, net);
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
            return isolate(cached);
        } finally {
            clearTimeout(timer);
        }
        // 304: still current. 5xx: the server is having a moment, and the copy we
        // have beats an error page. Anything else (200, 404) is the deploy's
        // answer and wins over the cache.
        if (net.status === 304 || net.status >= 500) return isolate(cached);
        await store(r, net);
        return isolate(net);
    };

    self.addEventListener("install", (event) => {
        self.skipWaiting();
        // Best-effort, per item: a single 404 (an icon renamed between builds,
        // say) must not abort the whole precache the way `cache.addAll` would.
        // `cache: 'reload'` skips the HTTP cache so a fresh deploy is precached,
        // not a stale copy.
        event.waitUntil((async () => {
            const cache = await caches.open(SHELL_CACHE);
            await Promise.all(
                SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})),
            );
        })());
    });

    self.addEventListener("activate", (event) => {
        event.waitUntil((async () => {
            // Drop caches from older builds — their names carry the old VERSION.
            // In dev, keep nothing: a stale dev cache is exactly what we must purge.
            const keep = DEV ? new Set() : new Set([SHELL_CACHE, RUNTIME_CACHE]);
            const names = await caches.keys();
            await Promise.all(
                names.map((n) => (n.startsWith('warsha-') && !keep.has(n) ? caches.delete(n) : undefined)),
            );
            await self.clients.claim();
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
