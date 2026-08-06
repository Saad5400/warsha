# Warsha production image.
#
# Why a root-level Dockerfile (not app/): the SPA build in app/ deliberately
# reaches OUT of app/ for two build-time inputs, so the build context must be
# the whole monorepo:
#   - app/src/index.css   @imports ../../docs/design/tokens.css
#   - app/package.json    "assets" script copies runtimes/java/src/jvm.worker.js
#                         and runs runtimes/java/fetch-compiler.sh (downloads
#                         ecj.jar from Maven Central) into app/public.
# Coolify's nixpacks build scoped the context to app/ alone, so ../runtimes and
# ../docs were absent and `npm run build` failed at the `cp ../runtimes/...` step.

# ---- build stage ----------------------------------------------------------
# node:22-bookworm-slim is >= 22.12, satisfying vite 8 / rolldown engines, and
# ships bash (fetch-compiler.sh needs it). curl + ca-certificates are added for
# the ECJ download; libicu72 is the ICU runtime the .NET SDK CLI needs on
# bookworm-slim (which ships without it); python3 (exposed as `python` via
# python-is-python3) is required by Emscripten's emcc, which `dotnet publish -c
# Release` invokes to relink the Mono wasm runtime for the C# engine bundle;
# libatomic1 provides libatomic.so.1, which Emscripten's bundled Node links
# against during that relink; default-jdk-headless (JDK 17 on bookworm) is what
# runtimes/java/build-bootstrap.sh compiles warsha-boot.jar with — the Warsha
# Java bootstrap has to ship prebuilt, because on CheerpJ's modular runtime it
# can no longer be compiled in the browser (see bootstrap/Platform.java).
FROM node:22-bookworm-slim AS build

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      curl ca-certificates libicu72 python3 python-is-python3 libatomic1 \
      default-jdk-headless \
 && rm -rf /var/lib/apt/lists/*

# .NET 9 SDK + wasm-tools workload — required by runtimes/csharp/build.sh to
# publish the C# WebAssembly engine bundle (app/public/warsha-dotnet/_framework)
# during `npm run assets`. There is no apt package for the 9.0 SDK on bookworm,
# so install user-local with the official script (matches INTEGRATION.md §3).
# This whole stage is discarded — only app/dist reaches the nginx serve stage —
# so the SDK never bloats the final image.
ENV DOTNET_ROOT=/root/.dotnet
ENV PATH=/root/.dotnet:$PATH
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
RUN curl -fsSL https://dot.net/v1/dotnet-install.sh \
      | bash -s -- --channel 9.0 --install-dir "$DOTNET_ROOT" \
 && dotnet workload install wasm-tools --skip-manifest-update \
 && dotnet nuget locals all --clear

WORKDIR /repo

# Install deps first for layer caching — only app/'s manifest changes bust it.
COPY app/package.json app/package-lock.json ./app/
RUN cd app && npm ci

# Bring in the rest of the monorepo (runtimes/, docs/, app/src, ...) then build.
# `npm run build` runs the prebuild `assets` step, which now finds ../runtimes
# and ../../docs because the context is the repo root.
COPY . .
RUN cd app && npm run build

# ---- serve stage ----------------------------------------------------------
FROM nginx:alpine AS serve

COPY --from=build /repo/app/dist /usr/share/nginx/html
COPY app/deploy/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
