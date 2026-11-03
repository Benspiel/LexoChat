import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Notice, Spinner } from "@lexichat/ui";
import { useInterval } from "../lib/hooks";
import { formatDate } from "../lib/format";

/** Written by the windows-app service (deploy/windows-app/build-msi.sh). */
export interface WindowsAppStatus {
  status: "building" | "ready" | "failed";
  message: string;
  updated: string;
  msi: {
    file: string;
    version: string;
    built: string;
    server: string;
    sha256: string;
    size: number;
    signed: boolean;
  } | null;
}

const STATUS_URL = "/download/windows-app.json";
const MSI_URL = "/download/LexiChat.msi";

export function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`;
}

export function WindowsAppView() {
  const [info, setInfo] = useState<WindowsAppStatus | null | undefined>(undefined);

  const load = useCallback(() => {
    fetch(STATUS_URL, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<WindowsAppStatus>) : null))
      .then((s) => setInfo(s && typeof s === "object" && "status" in s ? s : null))
      .catch(() => setInfo(null));
  }, []);

  useEffect(load, [load]);
  // while the server builds the installer: refresh the status every 15 seconds
  useInterval(0.25, () => {
    if (info?.status === "building") load();
  });

  return (
    <section aria-labelledby="winapp-title" className="lx-stack">
      <div className="lx-stack-sm page-head">
        <h1 id="winapp-title">Windows-App.</h1>
        <p className="lx-muted">
          Der Installer wird automatisch auf diesem Server gebaut – bei jedem Update von LexiChat und wenn sich die Serveradresse ändert.
        </p>
      </div>

      {info === undefined ? (
        <Spinner />
      ) : info === null ? (
        <Notice kind="info">
          Noch kein Installer vorhanden. Er wird beim nächsten Start des Servers gebaut (<span className="lx-mono">docker compose up -d --build</span>).
        </Notice>
      ) : (
        <>
          {info.status === "building" && (
            <Notice kind="info">
              <Spinner label={info.message} />
            </Notice>
          )}
          {info.status === "failed" && (
            <Notice kind="error">
              Der letzte Build ist fehlgeschlagen: {info.message}
              {info.msi ? " Zum Download steht weiterhin der letzte funktionierende Installer bereit." : ""}
            </Notice>
          )}

          {info.msi ? (
            <Card>
              <div className="lx-stack">
                <div className="lx-spread">
                  <h2>LexiChat für Windows.</h2>
                  <Badge variant="outline">Version {info.msi.version}</Badge>
                </div>
                <dl className="lx-stack-sm">
                  <div>
                    <dt className="lx-muted">Verbindet sich mit</dt>
                    <dd className="lx-mono">{info.msi.server}</dd>
                  </div>
                  <div>
                    <dt className="lx-muted">Gebaut am</dt>
                    <dd>{formatDate(info.msi.built)}</dd>
                  </div>
                  <div>
                    <dt className="lx-muted">Größe</dt>
                    <dd>{formatSize(info.msi.size)}</dd>
                  </div>
                  <div>
                    <dt className="lx-muted">SHA-256</dt>
                    <dd className="lx-mono hash">
                      {info.msi.sha256}
                    </dd>
                  </div>
                </dl>
                <div className="lx-row">
                  <a className="lx-btn lx-btn--primary" href={MSI_URL} download="LexiChat.msi">
                    LexiChat.msi herunterladen
                  </a>
                  <Button variant="soft" onClick={load}>
                    Status aktualisieren
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}

          <Card>
            <div className="lx-stack-sm">
              <h2>Installation.</h2>
              <ul className="lx-stack-sm">
                <li>Doppelklick auf die MSI installiert LexiChat für alle Benutzer:innen des PCs (Startmenü → „LexiChat“).</li>
                <li>
                  Verteilung per Softwareverteilung/GPO: <span className="lx-mono">msiexec /i LexiChat.msi /qn</span>
                </li>
                <li>Neue Version: einfach die neue MSI darüber installieren – die alte wird ersetzt, die Anmeldung bleibt erhalten.</li>
                {info.msi && !info.msi.signed && (
                  <li>
                    Der Installer ist nicht code-signiert. Windows SmartScreen zeigt deshalb eventuell „Der Computer wurde geschützt“ →
                    „Weitere Informationen“ → „Trotzdem ausführen“.
                  </li>
                )}
                <li>Voraussetzung: Windows 10/11 (64 Bit) mit Microsoft Edge WebView2 – auf aktuellen Windows-Versionen vorinstalliert.</li>
              </ul>
            </div>
          </Card>
        </>
      )}
    </section>
  );
}
