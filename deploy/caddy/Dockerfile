# Caddy with the rate_limit module (github.com/mholt/caddy-ratelimit) and the
# built admin web app. Build context is the repository root (see docker-compose.yml),
# so no separate Node/pnpm installation is needed on the host (also on Windows).
# Build verified locally with: xcaddy build v2.11.7 --with github.com/mholt/caddy-ratelimit@v0.1.0
FROM caddy:2.11.7-builder-alpine@sha256:d6161a2c82fd58b3205048958fb6246d0c5d892beee8a47e90944610c4efd100 AS build
RUN xcaddy build v2.11.7 --with github.com/mholt/caddy-ratelimit@v0.1.0

FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS admin-web
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/admin-web ./apps/admin-web
RUN pnpm install --frozen-lockfile --filter @lexichat/admin-web... \
    && pnpm --filter @lexichat/admin-web build

FROM caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f
COPY --from=build /usr/bin/caddy /usr/bin/caddy
COPY deploy/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=admin-web /src/apps/admin-web/dist /srv/admin-web
