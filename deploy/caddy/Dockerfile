# Caddy with the rate_limit module (github.com/mholt/caddy-ratelimit) and the
# built admin web app. Build context is the repository root (see docker-compose.yml),
# so no separate Node/pnpm installation is needed on the host (also on Windows).
# Build verified locally with: xcaddy build v2.11.7 --with github.com/mholt/caddy-ratelimit@v0.1.0
FROM caddy:2.11.9-builder-alpine@sha256:646fee578e680989ca5c7fd1ce6f1de574d19fd71ef2221810cc0510a9f40c86 AS build
RUN xcaddy build v2.11.7 --with github.com/mholt/caddy-ratelimit@v0.1.0

FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS admin-web
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/admin-web ./apps/admin-web
RUN pnpm install --frozen-lockfile --filter @lexichat/admin-web... \
    && pnpm --filter @lexichat/admin-web build

FROM caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0
COPY --from=build /usr/bin/caddy /usr/bin/caddy
COPY deploy/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=admin-web /src/apps/admin-web/dist /srv/admin-web
