"use client";

import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
  limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { claimReport } from "@/lib/moderation/reportService";
import type { Report, ReportStatus } from "@/lib/moderation/types";
import { REPORT_REASON_LABELS } from "@/lib/moderation/types";
import Link from "next/link";

const TARGET_LABELS: Record<string, string> = {
  post: "Publicación",
  comment: "Comentario",
  comment_reply: "Respuesta",
  live: "Live",
  live_chat_message: "Chat del live",
  greeting: "Saludo/Consejo",
  user: "Usuario",
  community: "Comunidad",
  meet_greet: "Meet & Greet",
  exclusive_session: "Sesión exclusiva",
};

const STATUS_LABELS: Record<ReportStatus, string> = {
  pending: "Pendiente",
  reviewing: "En revisión",
  resolved: "Resuelto",
  dismissed: "Descartado",
};

const STATUS_COLOR: Record<ReportStatus, string> = {
  pending: "#f59e0b",
  reviewing: "#3b82f6",
  resolved: "#22c55e",
  dismissed: "#6b7280",
};

type FireReport = Omit<Report, "createdAt" | "claimedAt" | "resolvedAt"> & {
  createdAt: Timestamp;
  claimedAt: Timestamp | null;
  resolvedAt: Timestamp | null;
};

type Tab = "active" | "resolved" | "dismissed";

function toReport(id: string, d: FireReport): Report {
  return {
    ...d,
    id,
    createdAt: d.createdAt.toDate(),
    claimedAt: d.claimedAt?.toDate() ?? null,
    resolvedAt: d.resolvedAt?.toDate() ?? null,
  };
}

function rel(date: Date): string {
  const m = Math.floor((Date.now() - date.getTime()) / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
}

export default function AdminReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("active");
  const [claiming, setClaiming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const statusIn: ReportStatus[] =
      tab === "active"
        ? ["pending", "reviewing"]
        : tab === "resolved"
        ? ["resolved"]
        : ["dismissed"];

    const q = query(
      collection(db, "reports"),
      where("status", "in", statusIn),
      orderBy("createdAt", "desc"),
      limit(100),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setReports(snap.docs.map((d) => toReport(d.id, d.data() as FireReport)));
        setLoading(false);
      },
      () => setLoading(false),
    );

    return () => unsub();
  }, [tab]);

  async function handleClaim(id: string) {
    setClaiming(id);
    setError(null);
    try {
      await claimReport(id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al tomar el reporte");
    } finally {
      setClaiming(null);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20, color: "#fff" }}>
        Cola de reportes
      </h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {(["active", "resolved", "dismissed"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: `1px solid ${tab === t ? "#a855ff" : "#2a2a2a"}`,
              background: tab === t ? "#1a0a2a" : "transparent",
              color: tab === t ? "#d8b4fe" : "#666",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t === "active" ? "Activos" : t === "resolved" ? "Resueltos" : "Descartados"}
          </button>
        ))}
      </div>

      {error && (
        <div
          style={{
            padding: "10px 14px",
            background: "#1f0a0a",
            border: "1px solid #7f1d1d",
            borderRadius: 8,
            color: "#f87171",
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#555", fontSize: 14 }}>Cargando reportes...</div>
      ) : reports.length === 0 ? (
        <div style={{ color: "#555", fontSize: 14 }}>No hay reportes en esta categoría.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {reports.map((r) => (
            <div
              key={r.id}
              style={{
                background: "#111",
                border: "1px solid #1e1e1e",
                borderRadius: 10,
                padding: "12px 16px",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: STATUS_COLOR[r.status],
                  flexShrink: 0,
                }}
              />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>
                    {TARGET_LABELS[r.targetType] ?? r.targetType}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: "#999",
                      background: "#1a1a1a",
                      padding: "2px 7px",
                      borderRadius: 4,
                    }}
                  >
                    {REPORT_REASON_LABELS[r.reason]}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: STATUS_COLOR[r.status],
                      background: "#1a1a1a",
                      padding: "2px 7px",
                      borderRadius: 4,
                    }}
                  >
                    {STATUS_LABELS[r.status]}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#555", marginTop: 3 }}>
                  {rel(r.createdAt)}
                  {r.description && (
                    <span style={{ color: "#444", marginLeft: 8 }}>
                      — {r.description.slice(0, 80)}{r.description.length > 80 ? "…" : ""}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                {r.status === "pending" && (
                  <button
                    onClick={() => handleClaim(r.id)}
                    disabled={claiming === r.id}
                    style={{
                      padding: "5px 11px",
                      borderRadius: 6,
                      border: "none",
                      background: "#7c3aed",
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: claiming === r.id ? "not-allowed" : "pointer",
                      opacity: claiming === r.id ? 0.6 : 1,
                    }}
                  >
                    {claiming === r.id ? "..." : "Tomar"}
                  </button>
                )}
                <Link
                  href={`/admin/reports/${r.id}`}
                  style={{
                    padding: "5px 11px",
                    borderRadius: 6,
                    border: "1px solid #2a2a2a",
                    color: "#aaa",
                    fontSize: 12,
                    fontWeight: 600,
                    textDecoration: "none",
                    display: "inline-block",
                  }}
                >
                  Ver →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
