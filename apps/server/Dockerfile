# LexiChat server (PocketBase + LexiChat extensions)
# Images are pinned by digest; Renovate/Dependabot keeps them up to date.

FROM golang:1.27.4-alpine3.24@sha256:0a5f7fe796599ff487605987432e7619ae45beeb2fba4c2ce0b907879932aebf AS build
WORKDIR /src
ENV CGO_ENABLED=0 GOFLAGS=-trimpath GOTOOLCHAIN=local
COPY go.mod go.sum ./
RUN go mod download && go mod verify
COPY . .
RUN go build -ldflags="-s -w -buildid=" -o /out/lexichat . \
    && mkdir -p /out/pb_data

# distroless: no shell, no package manager, runs as uid 65532
FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
COPY --from=build /out/lexichat /app/lexichat
# pre-created so that a new named volume inherits the non-root ownership
COPY --from=build --chown=65532:65532 /out/pb_data /pb_data
USER 65532:65532
WORKDIR /app
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD ["/app/lexichat", "healthcheck"]
ENTRYPOINT ["/app/lexichat"]
CMD ["serve", "--http=0.0.0.0:8090", "--dir=/pb_data"]
