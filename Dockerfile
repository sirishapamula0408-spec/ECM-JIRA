# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# JL-97 — Deployment artifact for the ECM JIRA Clone.
# Multi-stage build: stage 1 compiles the Vite frontend, stage 2 runs the
# Express API which also serves the built /dist (see server/serveStatic.js).
# ─────────────────────────────────────────────────────────────────────────────

# ---- Stage 1: build the frontend -------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

# Install deps against the lockfile for reproducible builds.
COPY package*.json ./
RUN npm ci

# Copy source and build the production bundle into /app/dist.
COPY . .
RUN npm run build

# ---- Stage 2: runtime (API + static /dist) ---------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000 \
    SERVE_STATIC=1

# Only production dependencies are needed at runtime.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Server source + the compiled frontend from the build stage.
COPY server ./server
COPY --from=build /app/dist ./dist

# Uploads dir for attachments (JL-33); mount a volume here to persist.
RUN mkdir -p server/uploads

EXPOSE 4000

# Environment expected at runtime (provide via `docker run -e` / compose):
#   DATABASE_URL   PostgreSQL connection string (required)
#   JWT_SECRET     token signing secret (required in prod)
#   JWT_EXPIRES_IN token lifetime (default 7d)
#   APP_URL        public URL of the app (used in emails/links)
#   CORS_ORIGIN    allowed origin(s) for the API
#   SMTP_*         optional email delivery settings
# NODE_ENV=production enables serving the built /dist with an SPA fallback.

CMD ["node", "server/index.js"]
