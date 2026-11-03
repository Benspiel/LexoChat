#!/usr/bin/env bash
# Builds LexiChat.msi for the configured server and publishes it to /downloads
# (served by Caddy at https://<admin domain>/download/). Runs on every start of
# the "windows-app" container, skips the build if nothing has changed.
#
#   /downloads/LexiChat.msi         the installer
#   /downloads/windows-app.json     status for the admin web app
set -euo pipefail

DOMAIN="${LEXICHAT_DOMAIN:-chat.localhost}"
SERVER="${LEXICHAT_SERVER:-https://${DOMAIN}}"
PRAXIS="${LEXICHAT_PRAXIS_NAME:-LexiChat}"
PUBKEY="${LEXICHAT_UPDATER_PUBKEY:-}"
OUT=/downloads
CACHE=/cache
APP=/src/apps/desktop
TARGET=x86_64-pc-windows-gnu
STATUS="$OUT/windows-app.json"

log() { echo "[windows-app] $*"; }

# status file for the admin web app (keeps the info about the last good MSI)
status() { # status <building|ready|failed> <message>
  STATUS_STATE="$1" STATUS_MESSAGE="$2" STATUS_FILE="$STATUS" node -e '
    const fs = require("fs");
    const f = process.env.STATUS_FILE;
    let old = {};
    try { old = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
    let msi = old.msi ?? null;
    if (process.env.MSI_INFO) msi = JSON.parse(process.env.MSI_INFO);
    const s = { status: process.env.STATUS_STATE, message: process.env.STATUS_MESSAGE, updated: new Date().toISOString(), msi };
    fs.writeFileSync(f + ".tmp", JSON.stringify(s, null, 2));
    fs.renameSync(f + ".tmp", f);
  '
}

fail() {
  log "FEHLER: $1"
  status failed "$1"
  exit 1
}
trap 'fail "Build abgebrochen (Zeile $LINENO). Details: docker compose logs windows-app"' ERR

if ! [[ "$SERVER" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then
  fail "Ungültige Serveradresse: $SERVER (erwartet https://<domain>)"
fi

# skip if sources, server address and settings are unchanged
FINGERPRINT=$(
  {
    echo "v1 $SERVER|$PRAXIS|$PUBKEY"
    sha256sum /usr/local/bin/build-msi.sh
    cd /src && find apps/desktop packages pnpm-lock.yaml -path '*/node_modules' -prune -o -path apps/desktop/dist -prune -o -type f -print0 \
      | sort -z | xargs -0 sha256sum
  } | sha256sum | cut -d' ' -f1
)
if [[ -f "$OUT/LexiChat.msi" && "$(cat "$CACHE/fingerprint" 2>/dev/null)" == "$FINGERPRINT" ]]; then
  log "LexiChat.msi ist aktuell ($SERVER) – nichts zu tun."
  status ready "Aktuell."
  exit 0
fi

log "Baue LexiChat.msi für $SERVER …"
status building "Die Windows-App wird gebaut (dauert beim ersten Mal 5–20 Minuten) …"

VERSION=$(node -p 'require("/src/apps/desktop/src-tauri/tauri.conf.json").version')

# 1. frontend (server url is compiled in)
log "1/3 Oberfläche"
cd "$APP"
VITE_LEXICHAT_SERVER="$SERVER" pnpm exec vite build --logLevel warn

# 2. Windows exe (cross compiled). Same overrides as scripts/build-windows.mjs:
#    server url in the CSP, updater endpoint/pubkey, publisher.
log "2/3 Windows-Programm (Rust, MinGW)"
TAURI_CONFIG=$(SERVER="$SERVER" PUBKEY="$PUBKEY" PRAXIS="$PRAXIS" node -e '
  const base = require("/src/apps/desktop/src-tauri/tauri.conf.json");
  const s = process.env.SERVER;
  const csp = { ...base.app.security.csp, "img-src": `'"'"'self'"'"' blob: data: ${s}`, "connect-src": `ipc: http://ipc.localhost ${s}` };
  const updater = { endpoints: [`${s}/updates/latest.json`] };
  if (process.env.PUBKEY) updater.pubkey = process.env.PUBKEY;
  process.stdout.write(JSON.stringify({
    app: { security: { csp } },
    bundle: { publisher: process.env.PRAXIS, copyright: process.env.PRAXIS },
    plugins: { updater },
  }));
')
export TAURI_CONFIG
cd "$APP/src-tauri"
cargo build --release --frozen --offline --target "$TARGET" --features tauri/custom-protocol
REL="$CARGO_TARGET_DIR/$TARGET/release"

# 3. MSI
log "3/3 MSI-Paket"
WORK="$CACHE/msi"
rm -rf "$WORK" && mkdir -p "$WORK"
cp "$REL/lexichat-desktop.exe" "$WORK/LexiChat.exe"
cp "$REL/WebView2Loader.dll" "$WORK/WebView2Loader.dll"
cp "$APP/src-tauri/icons/icon.ico" "$WORK/icon.ico"
xml_escape() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'; }
PRAXIS_XML=$(printf '%s' "$PRAXIS" | xml_escape)
# fixed GUIDs: UpgradeCode = same product across builds (new MSI replaces the old one)
cat > "$WORK/LexiChat.wxs" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product Id="*" Name="LexiChat" Language="1031" Codepage="1252" Version="$VERSION" Manufacturer="$PRAXIS_XML" UpgradeCode="6F1A0C2E-4B7D-4E59-9C3A-2D8E5B1F7A40">
    <Package InstallerVersion="500" Compressed="yes" InstallScope="perMachine" Description="LexiChat - interner Praxis-Messenger" Comments="$SERVER" />
    <MajorUpgrade AllowSameVersionUpgrades="yes" DowngradeErrorMessage="Es ist bereits eine neuere Version von LexiChat installiert." />
    <Media Id="1" Cabinet="lexichat.cab" EmbedCab="yes" />
    <Icon Id="LexiChatIcon" SourceFile="icon.ico" />
    <Property Id="ARPPRODUCTICON" Value="LexiChatIcon" />
    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="ProgramFiles64Folder">
        <Directory Id="INSTALLDIR" Name="LexiChat">
          <Component Id="MainExe" Guid="3B9E2F14-8C6A-4D21-A7E5-91C4D0B6F2A1" Win64="yes">
            <File Id="LexiChatExe" Name="LexiChat.exe" Source="LexiChat.exe" KeyPath="yes" />
          </Component>
          <Component Id="WebView2Loader" Guid="C47D1A93-2E5B-4F8C-B6A0-5D3E9F17C2B8" Win64="yes">
            <File Id="WebView2LoaderDll" Name="WebView2Loader.dll" Source="WebView2Loader.dll" KeyPath="yes" />
          </Component>
        </Directory>
      </Directory>
      <Directory Id="ProgramMenuFolder">
        <Component Id="StartMenuShortcut" Guid="8E2C5B71-D94F-4A36-B1E8-6F0A3C7D9E52" Win64="yes">
          <Shortcut Id="LexiChatStartMenu" Name="LexiChat" Description="Interner Praxis-Messenger" Target="[INSTALLDIR]LexiChat.exe" WorkingDirectory="INSTALLDIR" Icon="LexiChatIcon" />
          <RegistryValue Root="HKLM" Key="Software\\LexiChat" Name="StartMenuShortcut" Type="integer" Value="1" KeyPath="yes" />
        </Component>
      </Directory>
    </Directory>
    <Feature Id="Main" Level="1">
      <ComponentRef Id="MainExe" />
      <ComponentRef Id="WebView2Loader" />
      <ComponentRef Id="StartMenuShortcut" />
    </Feature>
  </Product>
</Wix>
EOF
(cd "$WORK" && wixl -a x64 -o LexiChat.msi LexiChat.wxs 2>&1 | grep -v "has no property named 'Platform'" || true)
[[ -s "$WORK/LexiChat.msi" ]] || fail "wixl hat keine MSI erzeugt."

# publish atomically
cp "$WORK/LexiChat.msi" "$OUT/.LexiChat.msi.tmp"
mv "$OUT/.LexiChat.msi.tmp" "$OUT/LexiChat.msi"
SHA=$(sha256sum "$OUT/LexiChat.msi" | cut -d' ' -f1)
echo "$SHA  LexiChat.msi" > "$OUT/LexiChat.msi.sha256"
SIZE=$(stat -c %s "$OUT/LexiChat.msi")
export MSI_INFO
MSI_INFO=$(printf '{"file":"LexiChat.msi","version":"%s","built":"%s","server":"%s","sha256":"%s","size":%s,"signed":false}' \
  "$VERSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SERVER" "$SHA" "$SIZE")
echo "$FINGERPRINT" > "$CACHE/fingerprint"
status ready "Fertig."
log "Fertig: LexiChat.msi $VERSION ($SIZE Bytes, SHA-256 $SHA)"
