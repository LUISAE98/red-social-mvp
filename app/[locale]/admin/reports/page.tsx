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
import { useTranslations } from "next-intl";
import { db } from "@/lib/firebase";
import { claimReport } from "@/lib/moderation/reportService";
import type { Report } from "@/lib/moderation/types";
import { REPORT_REASON_LABELS } from "@/lib/moderation/types";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import { Link } from "@/i18n/navigation";

type FireReport = Omit<Report, "createdAt" | "claimedAt" | "resolvedAt"> & {
  createdAt: Timestamp;
  claimedAt: Timestamp | null;
  resolvedAt: Timestamp | null;
};

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
  const tAdmin = useTranslations("admin");

  const TARGET_LABELS: Record<string, string> = {
    post: tAdmin("targetPost"),
    comment: tAdmin("targetComment"),
    comment_reply: tAdmin("targetReply"),
    live: tAdmin("targetLive"),
    live_chat_message: tAdmin("targetLiveChat"),
    greeting: tAdmin("targetGreeting"),
    user: tAdmin("targetUser"),
    community: tAdmin("targetCommunity"),
    meet_greet: tAdmin("targetLiveSession"),
    exclusive_session: tAdmin("targetExclusiveSession"),
  };

  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast, showToast } = useVibraToast();
  useEffect(() => { if (error) showToast(error, "error"); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const q = query(
      collection(db, "reports"),
      where("status", "==", "pending"),
      orderBy("createdAt", "asc"),
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
  }, []);

  async function handleClaim(id: string) {
    setClaiming(id);
    setError(null);
    try {
      await claimReport(id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tAdmin("attendReportError"));
    } finally {
      setClaiming(null);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#fff", margin: 0 }}>
          Reportes generales
        </h1>
        <p style={{ fontSize: 13, color: "#555", margin: "6px 0 0" }}>
          {tAdmin("pendingReportsNote")}
        </p>
      </div>

      {loading ? (
        <div style={{ color: "#555", fontSize: 14 }}>{tAdmin("reportsLoading")}</div>
      ) : reports.length === 0 ? (
        <div style={{ color: "#555", fontSize: 14 }}>{tAdmin("noReportsPending")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {reports.map((r) => (
            <div
              key={r.id}
              style={{
                background: "#111",
                border: "1px solid #1e1e1e",
                borderRadius: 10,
                padding: "14px 16px",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b", flexShrink: 0 }} />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>
                    {TARGET_LABELS[r.targetType] ?? r.targetType}
                  </span>
                  <span style={{ fontSize: 11, color: "#999", background: "#1a1a1a", padding: "2px 7px", borderRadius: 4 }}>
                    {REPORT_REASON_LABELS[r.reason]}
                  </span>
                </div>
                {r.description && (
                  <div style={{ fontSize: 12, color: "#555", marginTop: 3 }}>
                    {r.description.slice(0, 100)}{r.description.length > 100 ? "…" : ""}
                  </div>
                )}
                <div style={{ fontSize: 11, color: "#444", marginTop: 3 }}>{rel(r.createdAt)}</div>
              </div>

              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button
                  onClick={() => handleClaim(r.id)}
                  disabled={claiming === r.id}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: "none",
                    background: "#7c3aed",
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: claiming === r.id ? "not-allowed" : "pointer",
                    opacity: claiming === r.id ? 0.6 : 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  {claiming === r.id ? "..." : "Atender reporte"}
                </button>
                <Link
                  href={`/admin/reports/${r.id}`}
                  style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #2a2a2a", color: "#aaa", fontSize: 12, fontWeight: 600, textDecoration: "none" }}
                >
                  Ver →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      <VibraToast toast={toast} />
    </div>
  );
}
