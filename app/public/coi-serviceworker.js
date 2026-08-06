/*! coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed under MIT
 *
 * MODIFIED for Warsha. Two changes, both additive; the original code is intact:
 *
 *   1. An offline caching layer wraps the fetch handler. The COOP/COEP header
 *      transform below (now `isolate()`) is byte-for-byte the upstream one and
 *      still runs on every response we serve — from the network OR the cache —
 *      so cross-origin isolation holds offline exactly as it does online.
 *   2. The window-side script now registers even when the origin already sends
 *      the isolation headers (production nginx). Upstream returned early there
 *      because header injection was its only job; Warsha also needs the worker
 *      present to serve the app and its runtimes with no network. The isolation
 *      *reloads* stay gated on `!crossOriginIsolated`, so an already-isolated
 *      page registers with zero reloads and a header-less host still reloads
 *      exactly once — the invariant tools/qa/verify.mjs pins.
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
    // runtime CDN. The fetch handler additionally refuses to store an opaque
    // response — see there for why.
    const cacheable = (request) => {
        if (request.method !== 'GET') return false;
        const url = request.url;
        return new URL(url).origin === self.location.origin || isRuntimeHost(url);
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
            const keep = new Set([SHELL_CACHE, RUNTIME_CACHE]);
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

    // The upstream coi transform, unchanged: rewrites a response so it can live
    // in a cross-origin-isolated page. Opaque responses (status 0) pass through
    // as they must — their headers cannot be rewritten. Called on EVERY response
    // we return, network or cache, which is what keeps isolation intact offline.
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

        return new Response(response.body, {
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
                    const net = await fetch(request);
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

        // Cache-first for the shell and the runtime CDNs. Once a student has run
        // a language online its engine is served from Cache Storage — which
        // requestPersistence() (app/src/fs/health.ts) keeps from being evicted —
        // so it works offline and is never re-downloaded.
        //
        // We store only `ok`, non-opaque responses. Two reasons an opaque
        // response is refused: it cannot carry the CORP that isolate() needs, and
        // Chrome PADS an opaque entry to a large phantom size for quota
        // accounting — a handful would blow the origin quota and evict the
        // student's OPFS files. This means Pyodide (fetched CORS from jsdelivr)
        // caches fully and works offline, while CheerpJ — which pulls its loader
        // via a no-cors `importScripts()` and lazily fetches runtime pieces it
        // did not touch on the first run — is only partially cached and is not
        // guaranteed offline. See tools/qa/offline-check.mjs and ARCHITECTURE §2.5.
        if (cacheable(r)) {
            event.respondWith((async () => {
                const cached = await caches.match(r);
                if (cached) return isolate(cached);

                const net = await fetch(request);
                // Never store a partial response. Range requests are handled
                // above and never reach here; this is belt-and-suspenders so a
                // `206`/`Content-Range` can never be cached and later replayed as
                // if it were the whole resource. (`cache.put` already rejects a
                // 206, but the guard makes the intent explicit and covers a 200
                // that still carries Content-Range.)
                if (net && net.ok && net.status !== 206 && net.type !== "opaque"
                    && !net.headers.has("content-range")) {
                    const cache = await caches.open(isRuntimeHost(r.url) ? RUNTIME_CACHE : SHELL_CACHE);
                    cache.put(r, net.clone()).catch(() => {});
                }
                return isolate(net);
            })());
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
