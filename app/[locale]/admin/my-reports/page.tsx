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
import { useAuth } from "@/app/providers";
import type { Report } from "@/lib/moderation/types";
import { REPORT_REASON_LABELS } from "@/lib/moderation/types";
import Link from "next/link";
import { useTranslations } from "next-intl";

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

export default function MyReportsPage() {
  const { user } = useAuth();
  const tAdmin = useTranslations("admin");
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  function getTargetLabel(type: string): string {
    switch (type) {
      case "post": return tAdmin("targetPost");
      case "comment": return tAdmin("targetComment");
      case "comment_reply": return tAdmin("targetReply");
      case "live": return tAdmin("targetLive");
      case "live_chat_message": return tAdmin("targetLiveChat");
      case "greeting": return tAdmin("targetGreeting");
      case "user": return tAdmin("targetUser");
      case "community": return tAdmin("targetCommunity");
      case "meet_greet": return tAdmin("targetLiveSession");
      case "exclusive_session": return tAdmin("targetExclusiveSession");
      default: return type;
    }
  }

  function rel(date: Date): string {
    // eslint-disable-next-line react-hooks/purity
    const m = Math.floor((Date.now() - date.getTime()) / 60000);
    if (m < 1) return tAdmin("timeNow");
    if (m < 60) return tAdmin("timeMinutesAgo", { count: m });
    const h = Math.floor(m / 60);
    if (h < 24) return tAdmin("timeHoursAgo", { count: h });
    return `hace ${Math.floor(h / 24)}d`;
  }

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, "reports"),
      where("status", "==", "reviewing"),
      where("claimedBy", "==", user.uid),
      orderBy("claimedAt", "desc"),
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
  }, [user]);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#fff", margin: 0 }}>
          {tAdmin("myReportsTitle")}
        </h1>
        <p style={{ fontSize: 13, color: "#555", margin: "6px 0 0" }}>
          {tAdmin("myReportsDescription")}
        </p>
      </div>

      {loading ? (
        <div style={{ color: "#555", fontSize: 14 }}>{tAdmin("myReportsLoading")}</div>
      ) : reports.length === 0 ? (
        <div style={{ color: "#555", fontSize: 14 }}>{tAdmin("myReportsEmpty")}</div>
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
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#3b82f6", flexShrink: 0 }} />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>
                    {getTargetLabel(r.targetType)}
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
                <div style={{ fontSize: 11, color: "#444", marginTop: 3 }}>
                  {tAdmin("myReportsClaimed", { time: r.claimedAt ? rel(r.claimedAt) : "—" })}
                </div>
              </div>

              <Link
                href={`/admin/reports/${r.id}`}
                style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #3b82f6", color: "#3b82f6", fontSize: 12, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}
              >
                {tAdmin("myReportsResolve")}
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
