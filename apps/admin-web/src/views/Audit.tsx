import { useCallback, useEffect, useState } from "react";
import { AUDIT_REASONS, auditLabel, type ListResult } from "@lexichat/shared";
import { Button, EmptyState, Notice, Segmented, Spinner } from "@lexichat/ui";
import { client } from "../lib/client";
import { errorText, formatDate } from "../lib/format";

interface AuditRecord {
  id: string;
  action: string;
  actor_username: string;
  target_type: string;
  target_label: string;
  details: Record<string, unknown> | null;
  created: string;
}

const CATEGORIES = [
  { value: "", label: "Alle" },
  { value: "auth.", label: "Anmeldung" },
  { value: "admin.", label: "Verwaltung" },
  { value: "system.", label: "System" },
];

const PER_PAGE = 50;

function detailText(r: AuditRecord): string {
  const d = r.details ?? {};
  const parts: string[] = [];
  if (typeof d["reason"] === "string") parts.push(AUDIT_REASONS[d["reason"]] ?? d["reason"]);
  if (typeof d["failures"] === "number") parts.push(d["failures"] === 1 ? "1 Fehlversuch" : `${d["failures"]} Fehlversuche`);
  if (typeof d["locked_minutes"] === "number") parts.push(`gesperrt für ${d["locked_minutes"]} min`);
  if (typeof d["from"] === "string" && typeof d["to"] === "string") parts.push(`${d["from"]} → ${d["to"]}`);
  if (Array.isArray(d["fields"])) parts.push(`Felder: ${(d["fields"] as string[]).join(", ")}`);
  if (typeof d["client"] === "string") parts.push(d["client"] === "admin_web" ? "Verwaltung" : "Windows-App");
  if (r.action === "system.retention_cleanup") {
    parts.push(`${String(d["messages"] ?? 0)} Nachrichten, ${String(d["sessions"] ?? 0)} Sitzungen, ${String(d["auditLogs"] ?? 0)} Audit-Einträge`);
  }
  if (r.action === "admin.settings_changed") {
    parts.push(Object.entries(d).map(([k, v]) => `${k} = ${String(v)}`).join(", "));
  }
  return parts.join(" · ");
}

export function AuditView() {
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResult<AuditRecord> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(null);
    try {
      const filter = category ? `action ~ "${category}%"` : undefined;
      setData(await client.list<AuditRecord>("audit_logs", { page, perPage: PER_PAGE, sort: "-created", filter }));
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, [category, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-labelledby="audit-title">
      <div className="lx-spread page-head">
        <div className="lx-stack-sm">
          <h1 id="audit-title">Audit-Log.</h1>
          <p className="lx-muted">
            Unveränderliches Protokoll der Verwaltungs- und Sicherheitsereignisse (ohne Chatinhalte, IP-Adressen nur pseudonymisiert).
          </p>
        </div>
        <Segmented
          label="Kategorie"
          options={CATEGORIES}
          value={category}
          onChange={(v) => {
            setCategory(v);
            setPage(1);
          }}
        />
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {data === null && !error ? (
        <Spinner />
      ) : data && data.items.length === 0 ? (
        <EmptyState title="Keine Einträge." />
      ) : data ? (
        <>
          <div className="lx-table-wrap">
            <table className="lx-table">
              <caption className="lx-sr-only">Audit-Einträge, neueste zuerst</caption>
              <thead>
                <tr>
                  <th scope="col">Zeitpunkt</th>
                  <th scope="col">Ereignis</th>
                  <th scope="col">Durch</th>
                  <th scope="col">Betrifft</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td className="lx-small" style={{ whiteSpace: "nowrap" }}>
                      {formatDate(r.created)}
                    </td>
                    <td>{auditLabel(r.action)}</td>
                    <td>{r.actor_username || <span className="lx-muted">System</span>}</td>
                    <td>{r.target_label || <span className="lx-muted">–</span>}</td>
                    <td className="lx-small">{detailText(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span className="lx-small lx-muted">
              Seite {data.page} von {Math.max(1, data.totalPages)} · {data.totalItems} Einträge
            </span>
            <span className="lx-row">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Neuere
              </Button>
              <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
                Ältere
              </Button>
            </span>
          </div>
          <p className="lx-small lx-muted" style={{ marginTop: 16 }}>
            Die Integrität (Hash-Kette) prüft der Betrieb mit <code className="lx-mono">lexichat verify-audit</code> (siehe Betriebshandbuch).
          </p>
        </>
      ) : null}
    </section>
  );
}
