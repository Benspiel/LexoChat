# Builds the LexiChat Windows installer (MSI) directly on the Linux server.
#
# No Windows machine, no Microsoft SDK download: the app is cross compiled with
# MinGW-w64 (x86_64-pc-windows-gnu) and packaged with wixl (msitools).
# The image only contains the toolchain + sources; the actual build runs when
# the container starts (see build-msi.sh), so a failed installer build never
# blocks the chat server. Result: volume "downloads" -> admin web app /download/.
FROM node:24.22.1-bookworm-slim AS node

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates curl gcc libc6-dev \
       gcc-mingw-w64-x86-64 binutils-mingw-w64-x86-64 mingw-w64-x86-64-dev \
       wixl \
    && rm -rf /var/lib/apt/lists/*

# Node.js (same major as the rest of the project) + pnpm via corepack
COPY --from=node /usr/local/ /usr/local/
RUN rm -f /usr/local/bin/yarn /usr/local/bin/yarnpkg && corepack enable pnpm

# Rust toolchain with the Windows (GNU) target
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo PATH=/usr/local/cargo/bin:$PATH
ARG RUST_VERSION=1.97.0
RUN curl --proto '=https' --tlsv1.2 -sSfo /tmp/rustup-init https://static.rust-lang.org/rustup/dist/x86_64-unknown-linux-gnu/rustup-init \
    && chmod +x /tmp/rustup-init \
    && /tmp/rustup-init -y --no-modify-path --profile minimal --default-toolchain ${RUST_VERSION} --target x86_64-pc-windows-gnu \
    && rm /tmp/rustup-init \
    && rustc --version

# unprivileged build user; /cache and /downloads are pre-created so that new
# named volumes inherit the ownership
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin builder \
    && mkdir -p /src /cache /downloads \
    && chown -R builder:builder /src /cache /downloads /usr/local/cargo
USER builder
WORKDIR /src

# JavaScript dependencies of the desktop app (cached layer)
COPY --chown=builder:builder package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY --chown=builder:builder packages ./packages
COPY --chown=builder:builder apps/desktop/package.json ./apps/desktop/package.json
RUN pnpm install --frozen-lockfile --filter @lexichat/desktop...

# Rust dependencies (cached layer, only re-downloaded when Cargo.lock changes)
COPY --chown=builder:builder apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock ./apps/desktop/src-tauri/
RUN cd apps/desktop/src-tauri \
    && mkdir src && touch src/lib.rs && echo "fn main() {}" > src/main.rs \
    && cargo fetch --locked \
    && rm -rf src

# app sources + build script
COPY --chown=builder:builder apps/desktop ./apps/desktop
COPY --chown=builder:builder deploy/windows-app/build-msi.sh /usr/local/bin/build-msi.sh

ENV CARGO_TARGET_DIR=/cache/target
ENTRYPOINT ["/usr/local/bin/build-msi.sh"]
