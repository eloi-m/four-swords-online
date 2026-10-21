# Deploying Four Swords Online

The site is static files, the game files the pages load, and one small WebSocket server, the lobby (`tools/signal`:
rooms, WebRTC signaling and a datagram relay). All of it fits on the smallest VPS. The build contains only our code;
the game files are a separate folder served at the site's `data/` (see "Game files" below), downloadable by anyone
who can open the site.

```
                  https://fso.example.org
browser ──────────────────────────────────────▶ Caddy (TLS, automatic certificates)
  │  /, /battle/, /online/, /adventure/               ├─ static files: apps/site/dist
  │  wss://fso.example.org/signal ────────────────────┴─ reverse proxy ─▶ lobby (node tools/signal, port 5185)
  └─ WebRTC data channels, player to player (STUN: Google's public server; the lobby relays when WebRTC fails)
```

The pages reach the lobby at `signal` under the site's base on their own origin by default (`/signal`, or
`/fso/signal` for a build with `BASE=/fso/`), so a single domain needs no configuration.

## Under a sub-path of an existing nginx

If a server already runs nginx (possibly behind a CDN such as Cloudflare), the whole thing can live under `/fso/` of
its existing server block, with the lobby in a container or a systemd service on localhost:

| URL | served from | by |
|---|---|---|
| `/fso/` | `/srv/www/fso/` (`BASE=/fso/ pnpm build:site`, then `apps/site/dist`) | nginx |
| `/fso/data/*` | `/srv/fso-data/` (`out/fso-data/` from `pnpm bundle`: the game files and `manifest.json`) | nginx |
| `/fso/signal` | the lobby (`deploy/signal.Dockerfile`, or `node tools/signal/src/main.ts`) on `127.0.0.1:5185` | nginx proxy; the lobby checks the Origin |

- **nginx:** `deploy/nginx-fso.conf`, included inside the server block (e.g. as `/etc/nginx/default.d/fso.conf`;
  change its paths to yours). Every response says `Cache-Control: private` (hashed assets and game files
  `private, max-age=31536000, immutable`; pages and the manifest `private, no-cache`; errors and the lobby
  `private, no-store`), so a CDN in front never caches the game files. A cache-bypass rule for `/fso/*` at the CDN
  makes sure of it.
- **Lobby:** `ALLOWED_ORIGINS=https://example.org,https://www.example.org` (the site's origins) and `TRUST_PROXY=1`.
  Without a `LOBBY_TOKEN` (`data/lobby-token` answers 404), the pages connect without one; the built-in rate limits
  apply either way.
- **Game data** never enters git or a Docker image: run the bundle tool on your local `extracted/` folder and send
  `out/fso-data/` to the server (`rsync -a --delete`), only when `manifest.json`'s hash changed. Vite's build is
  deterministic, so the site likewise needs sending only when its files' hash changed. Swap each tree in whole.

Steps:

1. **Game files:** extract the disc into the checkout (`pnpm --filter @fso/extract extract <disc.rvz> extracted`)
   and check that `pnpm bundle` writes `out/fso-data/manifest.json`.
2. **Build:** `BASE=/fso/ pnpm build:site`; the lobby image with
   `docker build -t fso-signal -f deploy/signal.Dockerfile .` (add `--platform linux/arm64` for an ARM server).
3. **Ship and configure:** copy `apps/site/dist/` to `/srv/www/fso/` and `out/fso-data/` to `/srv/fso-data/`, run the
   lobby on `127.0.0.1:5185`, install `deploy/nginx-fso.conf` and reload nginx.
4. **Check from outside:** `node tools/e2e/src/site.ts all --url=https://example.org/fso/` (every page, the game
   files, online over WebRTC and the relay), `curl -sI https://example.org/fso/data/manifest.json` (`private`, and
   behind Cloudflare no `cf-cache-status: HIT`), and on the server `free -m` and `docker stats --no-stream` (the lobby
   takes ~40–60 MB).
5. **Real devices:** open the site on an iPhone (Safari) and an Android phone (Chrome) and play an online match
   between them, one on cellular data; if one can't reach the lobby, look at the lobby's log.

Restarting the lobby drops its open rooms.
To test the same nginx setup locally, run `nginx:alpine` with `deploy/nginx-fso.conf` included in a `server { listen
80; absolute_redirect off; … }` block, sharing the network namespace of a lobby container
(`docker run --network container:<lobby>`), and the files mounted at the paths above.

## What you need

- A Linux VPS with a public IPv4 (and/or IPv6) address. 1 vCPU and 512 MB–1 GB of RAM are plenty: the lobby keeps
  rooms in memory and relays about 3 KB/s per player whose WebRTC connection fails.
- A domain (or subdomain) whose DNS `A` (and `AAAA`) record points at the VPS.
- Ports 80 and 443 open (TCP, plus UDP 443 for HTTP/3). The lobby's port stays private.
- HTTPS is required, not optional: browsers only allow the AudioWorklet (sound) and other powerful features on secure
  origins (`https://` or `localhost`).

## Option A: Docker Compose (recommended)

`deploy/docker-compose.yml` runs two containers: `site` (Caddy with the built site, `deploy/site.Dockerfile`) and
`signal` (the lobby on Node 22, `deploy/signal.Dockerfile`), which is only reachable through Caddy.

1. **Install Docker** with the Compose plugin (e.g. `curl -fsSL https://get.docker.com | sh` on Debian/Ubuntu).
2. **Point the domain** at the server and wait until `dig +short fso.example.org` shows its address.
3. **Get the code and configure it:**

   ```sh
   git clone <this repository> four-swords-online && cd four-swords-online
   cp deploy/.env.example deploy/.env
   $EDITOR deploy/.env            # SITE_ADDRESS=fso.example.org, optionally CADDY_OPTIONS=email you@example.org
   ```

4. **Build and start:**

   ```sh
   docker compose -f deploy/docker-compose.yml up -d --build
   docker compose -f deploy/docker-compose.yml logs -f        # Caddy obtains the certificate within seconds
   ```

5. **Check it:**

   ```sh
   curl -sI https://fso.example.org/ | head -n 1                # HTTP/2 200
   curl -s https://fso.example.org/signal                       # {"service":"four-swords-online signaling","rooms":0,…}
   ```

   Then open the site (its home page says whether it finds the game files) and try **Shadow Battle online** in two
   browsers (or two machines): create a room in one, open the invite link in the other.

The build context is limited by the root `.dockerignore` (an allowlist of the source folders), so a disc image, an
`extracted/` folder or `out/fso-data/` in your checkout can never end up in an image. The compose setup serves no game
files by itself: add them as in "Game files" below.

**Updating:** `git pull && docker compose -f deploy/docker-compose.yml up -d --build`. Restarting the lobby drops
the open rooms (they live in memory); a running match goes on between players connected over WebRTC ("Lost the lobby
server" banner, no rematch), while players who went through the relay drop out. Players on an old and a new build can't play together: a changed simulation shows the
desync warning, a changed match format is refused. Deploy at a quiet time.

## Option B: without Docker

On the server: Node 22, pnpm (`corepack enable`), and Caddy (`apt install caddy`, or any web server with WebSocket
proxying).

1. **Build the site** (anywhere; only `apps/site/dist/` is needed on the server):

   ```sh
   corepack enable && pnpm install --frozen-lockfile
   pnpm build:site                          # → apps/site/dist (static files, ~930 KB, ~250 KB gzipped)
   ```

2. **Run the lobby** as a service, on localhost only. It needs the checkout's `tools/signal` and `packages/net`
   (no dependencies to install):

   ```ini
   # /etc/systemd/system/fso-signal.service
   [Unit]
   Description=Four Swords Online lobby
   After=network.target

   [Service]
   WorkingDirectory=/srv/four-swords-online
   ExecStart=/usr/bin/node tools/signal/src/main.ts 5185 127.0.0.1
   Environment=ALLOWED_ORIGINS=https://fso.example.org TRUST_PROXY=1
   Restart=always
   User=fso
   NoNewPrivileges=true

   [Install]
   WantedBy=multi-user.target
   ```

   `systemctl enable --now fso-signal`, then `curl -s http://127.0.0.1:5185/` answers the status JSON.
   (`pnpm install` isn't even needed for the lobby: the `@fso/net` link can be made by hand, as
   `deploy/signal.Dockerfile` does.)

3. **Serve the site and proxy `/signal`** with `deploy/Caddyfile` and environment variables, e.g. in a systemd
   drop-in for Caddy (`systemctl edit caddy`):

   ```ini
   [Service]
   Environment=SITE_ADDRESS=fso.example.org SITE_ROOT=/srv/four-swords-online/apps/site/dist SIGNAL_UPSTREAM=127.0.0.1:5185
   ```

   and `cp deploy/Caddyfile /etc/caddy/Caddyfile && systemctl reload caddy`. With nginx instead, see "Other web
   servers" below.

## Option C: static hosting plus a separate lobby

The site can live on any static host (GitHub Pages, Netlify, Cloudflare Pages, an S3 bucket…) as long as it serves
HTTPS; the lobby then runs on a VPS under its own name (Option A or B, e.g. `lobby.example.org`).

- Build with the lobby's address and, for a sub-path, the base: `VITE_SIGNAL_URL=wss://lobby.example.org BASE=/fso/ pnpm build:site`.
- Run the lobby with `ALLOWED_ORIGINS=https://you.github.io` (the site's origin, no path).
- A lobby behind Caddy on its own domain: a site block with just `reverse_proxy 127.0.0.1:5185` (no rewrite needed
  when the pages connect to the root).
- Set the caching headers below if the host lets you (Netlify/Cloudflare `_headers`: `/assets/*` immutable).

## Game files

The pages fetch `<base>data/manifest.json` (always revalidated: `fetch(…, { cache: "no-cache" })`), then each file they
need as `<base>data/<disc path>?v=<content hash>`. Make the folder on the machine that holds the extracted disc:

```sh
pnpm --filter @fso/extract extract <disc.rvz> extracted    # once
pnpm bundle                                                 # → out/fso-data/: 135 files, 40.9 MB, plus manifest.json
```

`out/fso-data/` mirrors the manifest exactly (a re-run rewrites only what changed and deletes the rest), so it can be
synced to the server as is (`rsync -a --delete`, or a tar when `manifest.json` changed). The manifest has no dates:
the same files give the same bytes, so its hash says whether anything needs shipping. Serve the folder read-only at
the site's `data/` with:

| what | value |
|---|---|
| `data/manifest.json` | `Cache-Control: private, no-cache` (the pages revalidate it anyway) |
| `data/*` | `Cache-Control: private, max-age=31536000, immutable`: the `?v=` query changes with the content |
| compression (optional) | gzip for `application/octet-stream` saves about a quarter (41 → 31 MB) |

`pnpm bundle --decompress` stores the Yaz0 archives decompressed: 86 MB instead of 41 for about 16 ms less decoding
when a battle loads (measured on an M1 Pro; a phone is a few times slower), so it isn't worth it. During development
nothing is needed: every dev server and `vite preview` serve `extracted/` at the same URLs (`tools/bundle/src/vite.ts`;
`FSO_DATA=out/fso-data` serves a bundle instead).

## Headers, MIME types, caching

| what | value | why |
|---|---|---|
| `/assets/*` | `Cache-Control: public, max-age=31536000, immutable` | every file name there carries a content hash |
| pages (`/`, `/battle/`, …) and the icon | `Cache-Control: no-cache` | a deploy shows at once; the pages then fetch the new hashed assets |
| `*.js` (pages, both AudioWorklets) | `text/javascript` | module workers and worklets refuse other types; any static server gets this right by extension |
| compression | gzip or zstd for `.js`, `.css`, `.html`, `.svg` | the three.js chunk goes from 560 KB to ~140 KB |
| `Content-Security-Policy` | see `deploy/Caddyfile` | optional hardening; the pages need `worker-src 'self' blob:` (the 60 Hz ticker is a blob: worker), `connect-src 'self' wss:` (the lobby), `style-src 'self' 'unsafe-inline'` (inline style attributes), `img-src data: blob:` |
| `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` | **not needed** | nothing uses `SharedArrayBuffer`: the synth runs in an AudioWorklet and talks over its message port, and none of these require cross-origin isolation |

The lobby's WebSocket must not be cached or buffered, and idle connections need a timeout above the lobby's 20 s
ping (Caddy's defaults are fine; nginx needs `proxy_read_timeout`).

## Other web servers

nginx, inside the site's `server { listen 443 ssl; … }` block (certificates from certbot):

```nginx
root /srv/four-swords-online/apps/site/dist;
location / { try_files $uri $uri/ =404; add_header Cache-Control "no-cache"; }
location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
location = /signal {
  proxy_pass http://127.0.0.1:5185/;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_read_timeout 120s;
}
gzip on; gzip_types text/javascript application/javascript text/css image/svg+xml;
```

## The lobby's settings

Environment variables of `tools/signal` (details and defaults in `docs/netcode.md`, "Lobby and signaling server"):

| variable | use |
|---|---|
| `ALLOWED_ORIGINS` | comma-separated origins allowed to connect (`https://fso.example.org`); set it, or any site can use your relay |
| `TRUST_PROXY=1` | take the client address from `X-Forwarded-For` (only when the proxy is the only way in: the compose file and the systemd unit above keep the lobby private) |
| `LOBBY_TOKEN` | a shared secret every WebSocket handshake must carry as `?token=` (unset = an open lobby, as in dev); the pages read it from `<base>data/lobby-token` |
| `MAX_ROOMS`, `MAX_CONNECTIONS`, `MAX_CONNECTIONS_PER_ADDRESS` | bound memory and abuse (defaults 10 000 / 5 000 / 32) |
| `PORT`, `HOST` | listen address (5185; the container listens on 0.0.0.0, the systemd unit on 127.0.0.1) |

Rate limits (lobby messages, relayed datagrams and bytes, failed joins) are built in. There is no TURN server: players
behind symmetric NATs play through the lobby's relay (the stats overlay, `` ` `` in a match, shows the route).

## Testing a deployment locally

Before going live, the real `deploy/Caddyfile` can serve a local build over HTTPS with Caddy's internal CA:

```sh
pnpm build:site
PORT=5198 HOST=127.0.0.1 ALLOWED_ORIGINS=https://localhost:8443 TRUST_PROXY=1 node tools/signal/src/main.ts &
SITE_ADDRESS=https://localhost:8443 SITE_ROOT=$PWD/apps/site/dist SIGNAL_UPSTREAM=127.0.0.1:5198 \
  CADDY_OPTIONS="skip_install_trust
  http_port 8081" caddy run --config deploy/Caddyfile --adapter caddyfile
node tools/e2e/src/site.ts all --url=https://localhost:8443/   # Chrome and Firefox, certificate accepted (needs data/ served)
```

The same `--url=` runs the whole browser check (home, every page, online over WebRTC and over the relay, a
Chrome–Firefox match) against the live site.

## Operator checklist (legal)

- The only game files on the server are `pnpm bundle`'s folder, from the operator's own disc, served publicly with the
  pages. They never go into git or a Docker build context, and disc images, extracted folders or screenshots of game
  assets go nowhere else.
- Keep the home page's disclaimer (its About dialog: fan project, not affiliated with Nintendo). The pages draw some of
  the game's own art (the title logo and sky, menu plates, Link icons) from the served game files at runtime.
- The site keeps no accounts and stores nothing about players. The lobby logs to stdout: rooms created (with the creator's IP
  address), matches started, rooms closed, refused origins. Caddy keeps no access log unless you add a `log` directive. Keep them as your privacy policy says.
