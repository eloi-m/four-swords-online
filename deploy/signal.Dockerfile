# The lobby / signaling server (tools/signal): plain Node 22, no dependencies to install. Build from the repo root:
#   docker build -f deploy/signal.Dockerfile -t fso-signal .
#   docker run -p 5185:5185 -e ALLOWED_ORIGINS=https://fso.example.org fso-signal
# Environment (tools/signal/src/main.ts, docs/netcode.md "Lobby and signaling server"):
#   PORT (5185), HOST (0.0.0.0 here), ALLOWED_ORIGINS, TRUST_PROXY=1 (behind your own proxy only),
#   LOBBY_TOKEN (a shared secret the pages send as ?token=), MAX_ROOMS, MAX_CONNECTIONS, MAX_CONNECTIONS_PER_ADDRESS
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=5185 HOST=0.0.0.0

# Only the server and the lobby protocol it shares with the pages (@fso/net); Node 22 runs the TypeScript directly.
COPY package.json ./
COPY packages/net/package.json packages/net/
COPY packages/net/src packages/net/src
COPY tools/signal/package.json tools/signal/
COPY tools/signal/src tools/signal/src
# The workspace link pnpm would make for `import … from "@fso/net"`.
RUN mkdir -p tools/signal/node_modules/@fso && ln -s ../../../../packages/net tools/signal/node_modules/@fso/net

USER node
EXPOSE 5185
# GET / answers a small JSON status.
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- "http://127.0.0.1:${PORT}/" > /dev/null || exit 1
CMD ["node", "tools/signal/src/main.ts"]
