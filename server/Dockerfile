# syntax=docker/dockerfile:1

# ---- build stage: compile TypeScript to dist/ ----
FROM node:22-slim AS build
WORKDIR /app
# Install all deps (incl. dev) for the TypeScript build.
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage: slim, prod deps only ----
FROM node:22-slim AS runtime
# Baked into the image so fail-closed prod behavior never depends on the operator
# remembering to set it (dev bearer off, sensitive env required, generic 5xx).
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled server + migration runner, and the SQL migrations they apply.
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle

EXPOSE 8787
USER node

# Apply migrations, then start. If migrations fail the container exits non-zero
# and never serves traffic against an out-of-date schema.
CMD ["sh", "-c", "node dist/migrate.js && node dist/index.js"]
