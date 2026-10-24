# LexiChat auf Windows (Docker Desktop) - Einrichten, Starten, Stoppen.
#
# Am einfachsten per Doppelklick auf eine der .bat-Dateien in diesem Ordner:
#   LexiChat-Starten.bat   richtet beim ersten Mal alles ein und startet LexiChat
#   LexiChat-Stoppen.bat   stoppt LexiChat (Daten bleiben erhalten)
#
# Oder in PowerShell:  .\LexiChat.ps1 [start|stop|status|logs|admin|update|zertifikat]
#
# Hinweis: Diese Datei ist absichtlich nur ASCII (Windows PowerShell 5.1 liest
# Skripte ohne BOM nicht als UTF-8).

param(
    [ValidateSet("start", "stop", "status", "logs", "admin", "update", "zertifikat")]
    [string]$Befehl = "start"
)

$ErrorActionPreference = "Stop"
$DeployDir = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $DeployDir ".env"
Set-Location $DeployDir

function Info($text) { Write-Host $text -ForegroundColor Cyan }
function Ok($text) { Write-Host $text -ForegroundColor Green }
function Warn($text) { Write-Host $text -ForegroundColor Yellow }

function Fail($text) {
    Write-Host ""
    Write-Host $text -ForegroundColor Red
    Write-Host ""
    exit 1
}

function Compose {
    & docker compose @args
    if ($LASTEXITCODE -ne 0) { Fail "Fehler bei: docker compose $($args -join ' ')" }
}

function Test-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Fail "Docker ist nicht installiert. Bitte Docker Desktop installieren: https://www.docker.com/products/docker-desktop/ (WSL 2 Backend), danach dieses Skript erneut starten."
    }
    & docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        Fail "Docker Desktop laeuft nicht. Bitte Docker Desktop starten, warten bis 'Engine running' angezeigt wird, und dieses Skript erneut starten."
    }
}

function Read-Default($question, $default) {
    $answer = Read-Host "$question [$default]"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $default }
    return $answer.Trim()
}

function New-Secret {
    $bytes = New-Object byte[] 48
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    return [Convert]::ToBase64String($bytes)
}

function Get-EnvValue($name) {
    if (-not (Test-Path $EnvFile)) { return "" }
    foreach ($line in Get-Content $EnvFile) {
        if ($line -match "^\s*$name=(.*)$") { return $Matches[1].Trim() }
    }
    return ""
}

# Erstellt deploy\.env mit wenigen Fragen. Ohne Eingabe: nur dieser PC (chat.localhost).
function New-EnvFile {
    Info ""
    Info "=== LexiChat einrichten ==="
    Write-Host "Unter welchem Namen sollen die Windows-Apps den Server erreichen?"
    Write-Host "  - Einfach Enter druecken = nur auf diesem PC testen (https://chat.localhost)"
    Write-Host "  - Oder einen Namen eingeben, z. B. chat.praxis-mueller.de"
    $domain = (Read-Host "Server-Name").Trim().ToLower()

    if ([string]::IsNullOrWhiteSpace($domain)) {
        $domain = "chat.localhost"
        $adminDomain = "admin.localhost"
        $tls = "internal"
        $email = "it@praxis.invalid"
    }
    else {
        $adminDomain = Read-Default "Name fuer die Admin-Web-App" ("admin." + $domain)
        $public = Read-Host "Ist der Name oeffentlich im Internet erreichbar (Let's Encrypt-Zertifikat)? [j/N]"
        if ($public -match "^[jJyY]") {
            $tls = ""
            $email = Read-Default "E-Mail fuer Let's Encrypt" "it@$domain"
        }
        else {
            $tls = "internal"
            $email = "it@praxis.invalid"
            Warn "Interne Zertifikate: Die Namen muessen im Praxisnetz (DNS/Router oder hosts-Datei) auf diesen PC zeigen."
        }
    }

    $content = @"
# Erstellt von deploy\windows\LexiChat.ps1 am $(Get-Date -Format "yyyy-MM-dd HH:mm")
# Diese Datei enthaelt ein Geheimnis - nicht weitergeben, nicht ins Git.
LEXICHAT_DOMAIN=$domain
LEXICHAT_ADMIN_DOMAIN=$adminDomain
ACME_EMAIL=$email
LEXICHAT_TLS=$tls
LEXICHAT_APP_URL=https://$domain
LEXICHAT_ADMIN_ORIGIN=https://$adminDomain
LEXICHAT_ALLOWED_ORIGINS=https://$adminDomain,http://tauri.localhost
LEXICHAT_SERVER_SECRET=$(New-Secret)
LEXICHAT_SUPERUSER_IPS=127.0.0.1/32,::1/128,172.16.0.0/12
"@
    # UTF-8 ohne BOM und mit LF, sonst liest Docker den ersten Eintrag falsch
    [System.IO.File]::WriteAllText($EnvFile, ($content -replace "`r`n", "`n") + "`n", (New-Object System.Text.UTF8Encoding($false)))
    Ok "Konfiguration gespeichert: $EnvFile"
}

function Test-Ports {
    $running = & docker compose ps -q caddy 2>$null
    if ($running) { return }
    foreach ($port in 80, 443) {
        $busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if ($busy) {
            $proc = (Get-Process -Id ($busy | Select-Object -First 1).OwningProcess -ErrorAction SilentlyContinue).ProcessName
            Fail "Port $port ist schon belegt (Programm: $proc). Bitte das Programm beenden (z. B. IIS, Skype, anderer Webserver) und erneut starten."
        }
    }
}

function Wait-Healthy {
    Info "Warte, bis der Server bereit ist ..."
    $id = (& docker compose ps -q server).Trim()
    for ($i = 0; $i -lt 90; $i++) {
        $state = (& docker inspect --format "{{.State.Health.Status}}" $id 2>$null)
        if ($state -eq "healthy") { Ok "Server laeuft."; return }
        Start-Sleep -Seconds 2
    }
    Fail "Der Server ist nach 3 Minuten nicht bereit. Details: .\LexiChat.ps1 logs"
}

function New-FirstAdmin {
    Info ""
    Info "=== Erstes Admin-Konto anlegen ==="
    $user = Read-Default "Benutzername" "praxisadmin"
    $name = Read-Default "Anzeigename" "Praxis-Administration"
    # kein -T: das Einmalpasswort erscheint nur hier im Fenster
    & docker compose exec server /app/lexichat bootstrap-admin --dir /pb_data --username $user --name $name
    if ($LASTEXITCODE -ne 0) { Warn "Admin-Konto wurde nicht angelegt (gibt es schon eines?)." }
    else { Warn "Bitte das Einmalpasswort jetzt notieren - es wird nur einmal angezeigt." }
}

# Macht das lokale Caddy-Zertifikat unter Windows vertrauenswuerdig (nur bei LEXICHAT_TLS=internal / *.localhost).
function Install-LocalCert {
    $target = Join-Path $DeployDir "lexichat-root.crt"
    for ($i = 0; $i -lt 30; $i++) {
        & docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt $target *> $null
        if ($LASTEXITCODE -eq 0 -and (Test-Path $target)) { break }
        Start-Sleep -Seconds 2
    }
    if (-not (Test-Path $target)) { Warn "Lokales Zertifikat noch nicht vorhanden. Spaeter erneut: .\LexiChat.ps1 zertifikat"; return }
    Info "Windows fragt gleich, ob Sie dem Zertifikat 'Caddy Local Authority' vertrauen - bitte mit 'Ja' bestaetigen."
    Import-Certificate -FilePath $target -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
    Ok "Zertifikat installiert. Fuer andere Praxis-PCs: $target dort per Doppelklick unter 'Vertrauenswuerdige Stammzertifizierungsstellen' installieren."
}

function Show-Urls {
    $domain = Get-EnvValue "LEXICHAT_DOMAIN"
    $admin = Get-EnvValue "LEXICHAT_ADMIN_DOMAIN"
    Ok ""
    Ok "LexiChat laeuft."
    Ok "  Admin-Web-App:        https://$admin"
    Ok "  Server fuer die App:  https://$domain"
    Write-Host "Die Windows-App wird mit dieser Server-Adresse gebaut (siehe docs\windows-docker.md)."
}

Test-Docker

switch ($Befehl) {
    "start" {
        $firstRun = -not (Test-Path $EnvFile)
        if ($firstRun) { New-EnvFile }
        Test-Ports
        Info "Baue und starte LexiChat (beim ersten Mal dauert das einige Minuten) ..."
        Compose up -d --build
        Wait-Healthy
        if ((Get-EnvValue "LEXICHAT_TLS") -eq "internal" -and $firstRun) { Install-LocalCert }
        if ($firstRun) {
            $create = Read-Host "Erstes Admin-Konto jetzt anlegen? [J/n]"
            if ($create -notmatch "^[nN]") { New-FirstAdmin }
        }
        Show-Urls
    }
    "stop" { Compose stop; Ok "LexiChat gestoppt. Die Daten bleiben erhalten." }
    "status" { Compose ps }
    "logs" { Compose logs --tail 200 }
    "admin" { New-FirstAdmin }
    "update" {
        Info "Baue LexiChat neu (aktuelle Basis-Images) und starte neu ..."
        Compose build --pull
        Compose up -d
        Wait-Healthy
        Compose exec -T server /app/lexichat verify-audit --dir /pb_data
        Show-Urls
    }
    "zertifikat" { Install-LocalCert }
}

if ($Host.Name -eq "ConsoleHost" -and $env:LEXICHAT_NO_PAUSE -ne "1") {
    Read-Host "Fertig. Enter zum Schliessen" | Out-Null
}
