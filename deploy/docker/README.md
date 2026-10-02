# Hosting opentoys yourself

opentoys is a static site: any web server can serve `apps/web/build/`. This folder builds it and serves it with
nginx and the security headers the app is designed around. You need Docker with Compose.

```sh
docker compose -f deploy/docker/compose.yaml up -d --build   # from the repository root
```

- **What it builds:** node 22 builds the site and runs the privacy check, then nginx 1.27 serves it on
  `127.0.0.1:8003`. The container is read-only, with a health check on `/healthz`.
- **HTTPS is required.** Browsers only allow Web Bluetooth on HTTPS (or on localhost). Put a reverse proxy or a
  tunnel in front of port 8003.
- **Headers** (`nginx.conf`, `security-headers.conf`): a Content-Security-Policy generated at build time from the
  pages' own policy (`csp-header.mjs`), a Permissions-Policy that allows Bluetooth and the screen wake lock on the site itself and switches off the other
  features it lists,
  no referrer, no framing, HSTS. Hashed files under `/_app/immutable/` are cached for a year, everything else is
  revalidated so updates arrive.
- **Search engines:** `X-Robots-Tag: noindex` is set in `security-headers.conf`. Remove that line if you want your
  copy indexed.
- **Updating a server:** `deploy/docker/deploy.sh user@host [public-url]`, run from your checkout. The server needs
  SSH access, Git, Docker with Compose and curl. The script clones this checkout's origin into `~/opentoys` on the
  server if needed, **resets that copy to `origin/main`** (local changes there are discarded), rebuilds the
  container and waits until it is healthy.
