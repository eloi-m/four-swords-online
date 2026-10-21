# The static site (apps/site: every page, no game data) built and served by Caddy, which also terminates TLS and
# forwards the lobby's WebSocket (/signal) to the signaling server (deploy/Caddyfile). Build from the repo root:
#   docker build -f deploy/site.Dockerfile -t fso-site .
# Build arguments: VITE_SIGNAL_URL (a lobby on another host; default: wss://<the site's host>/signal),
# VITE_SOURCE_URL (a "Source code" link on the home page), BASE (serve under a sub-path, e.g. /fso/).
FROM node:22-alpine AS build
WORKDIR /src
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
# .dockerignore keeps the context to source files: no disc images or extracted game files can end up in here.
COPY . .
ARG VITE_SIGNAL_URL=""
ARG VITE_SOURCE_URL=""
ARG BASE="/"
RUN pnpm install --frozen-lockfile --filter "@fso/site..." \
  && VITE_SIGNAL_URL="$VITE_SIGNAL_URL" VITE_SOURCE_URL="$VITE_SOURCE_URL" BASE="$BASE" pnpm build:site

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/apps/site/dist /srv/site
