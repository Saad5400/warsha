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
# the ECJ download.
FROM node:22-bookworm-slim AS build

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

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
