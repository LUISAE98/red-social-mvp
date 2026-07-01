"use client";

import { useEffect, useState } from "react";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  Timestamp,
  limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { AuditLogEntry, ModeratorAction } from "@/lib/moderation/types";
import { MODERATOR_ACTION_LABELS } from "@/lib/moderation/types";
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

const ACTION_COLOR: Record<string, string> = {
  claim_report: "#3b82f6",
  dismiss: "#6b7280",
  warn_user: "#f59e0b",
  remove_content: "#ef4444",
  block_user: "#dc2626",
  report_to_authorities: "#c084fc",
};

function actionLabel(action: string): string {
  if (action === "claim_report") return "Tomó el reporte";
  return MODERATOR_ACTION_LABELS[action as ModeratorAction] ?? action;
}

type FireEntry = Omit<AuditLogEntry, "createdAt"> & { createdAt: Timestamp };

function toEntry(id: string, d: FireEntry): AuditLogEntry {
  return { ...d, id, createdAt: d.createdAt.toDate() };
}

function rel(date: Date): string {
  const m = Math.floor((Date.now() - date.getTime()) / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  return date.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
}

export default function AdminAuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, "adminAuditLog"),
      orderBy("createdAt", "desc"),
      limit(200),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setEntries(snap.docs.map((d) => toEntry(d.id, d.data() as FireEntry)));
        setLoading(false);
      },
      () => setLoading(false),
    );

    return () => unsub();
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20, color: "#fff" }}>
        Historial de acciones
      </h1>

      {loading ? (
        <div style={{ color: "#555", fontSize: 14 }}>Cargando historial...</div>
      ) : entries.length === 0 ? (
        <div style={{ color: "#555", fontSize: 14 }}>No hay acciones registradas aún.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {entries.map((e) => (
            <div
              key={e.id}
              style={{
                background: "#111",
                border: "1px solid #1e1e1e",
                borderRadius: 10,
                padding: "12px 16px",
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              {/* Colored dot */}
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: ACTION_COLOR[e.action] ?? "#555",
                  flexShrink: 0,
                  marginTop: 5,
                }}
              />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: ACTION_COLOR[e.action] ?? "#ccc",
                    }}
                  >
                    {actionLabel(e.action)}
                  </span>
                  {e.targetType && (
                    <span
                      style={{
                        fontSize: 11,
                        color: "#888",
                        background: "#1a1a1a",
                        padding: "2px 7px",
                        borderRadius: 4,
                      }}
                    >
                      {TARGET_LABELS[e.targetType] ?? e.targetType}
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", gap: 16, marginTop: 4, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: "#555", fontFamily: "monospace" }}>
                    Mod: {e.actorUid.slice(0, 12)}…
                  </span>
                  {e.targetId && (
                    <span style={{ fontSize: 11, color: "#555", fontFamily: "monospace" }}>
                      Target: {e.targetId.slice(0, 12)}…
                    </span>
                  )}
                  {e.reportId && (
                    <Link
                      href={`/admin/reports/${e.reportId}`}
                      style={{ fontSize: 11, color: "#7c3aed", textDecoration: "none" }}
                    >
                      Ver reporte →
                    </Link>
                  )}
                </div>

                {e.notes && (
                  <div style={{ fontSize: 12, color: "#666", marginTop: 4, fontStyle: "italic" }}>
                    "{e.notes}"
                  </div>
                )}
              </div>

              <div style={{ fontSize: 11, color: "#444", flexShrink: 0, marginTop: 2 }}>
                {rel(e.createdAt)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
