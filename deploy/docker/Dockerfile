# Two stages: node builds the static site, nginx serves it.
# Build context: the repository root (see compose.yaml).

# ---------- build stage ----------
FROM node:22-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/devices/package.json packages/devices/
COPY packages/web-ble/package.json packages/web-ble/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build \
	&& npm run check:privacy \
	&& node deploy/docker/csp-header.mjs apps/web/build > /csp.conf

# ---------- runtime stage ----------
FROM nginx:1.27-alpine AS runtime

COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /csp.conf /etc/nginx/snippets/csp.conf
COPY --from=build /repo/apps/web/build /usr/share/nginx/html

EXPOSE 80
