"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { resolveReport } from "@/lib/moderation/reportService";
import type { Report, ModeratorAction } from "@/lib/moderation/types";
import {
  REPORT_REASON_LABELS,
  MODERATOR_ACTIONS,
  MODERATOR_ACTION_LABELS,
} from "@/lib/moderation/types";
import { useParams, useRouter } from "next/navigation";
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
  meet_greet: "Sesión en vivo",
  exclusive_session: "Sesión exclusiva",
};

const ACTION_COLOR: Record<ModeratorAction, { bg: string; text: string; border: string }> = {
  dismiss: { bg: "#1a1a1a", text: "#9ca3af", border: "#2a2a2a" },
  warn_user: { bg: "#1c1500", text: "#fbbf24", border: "#3d2f00" },
  remove_content: { bg: "#1c0a0a", text: "#f87171", border: "#3d1515" },
  block_user: { bg: "#1f0505", text: "#ef4444", border: "#5c1a1a" },
  report_to_authorities: { bg: "#150a1f", text: "#c084fc", border: "#3d1f5c" },
};

type FireReport = Omit<Report, "createdAt" | "claimedAt" | "resolvedAt"> & {
  createdAt: Timestamp;
  claimedAt: Timestamp | null;
  resolvedAt: Timestamp | null;
};

async function fetchContentPreview(report: Report): Promise<string | null> {
  try {
    if (report.targetType === "post" || report.targetType === "live") {
      const snap = await getDoc(doc(db, "posts", report.targetId));
      if (!snap.exists()) return null;
      const d = snap.data();
      return d?.content ?? d?.text ?? d?.caption ?? d?.description ?? null;
    }
    if (report.targetType === "comment" || report.targetType === "comment_reply") {
      if (!report.parentId) return null;
      const snap = await getDoc(
        doc(db, "posts", report.parentId, "comments", report.targetId),
      );
      if (!snap.exists()) return null;
      const d = snap.data();
      return d?.content ?? d?.text ?? null;
    }
    if (report.targetType === "live_chat_message") {
      return "(Mensaje de chat — acceso directo no disponible)";
    }
    if (report.targetType === "greeting") {
      const snap = await getDoc(doc(db, "greetingRequests", report.targetId));
      if (!snap.exists()) return null;
      const d = snap.data();
      return [d?.toName && `Para: ${d.toName}`, d?.instructions]
        .filter(Boolean)
        .join(" · ");
    }
    if (report.targetType === "user") {
      const snap = await getDoc(doc(db, "users", report.targetId));
      if (!snap.exists()) return null;
      const d = snap.data();
      return [d?.handle && `@${d.handle}`, d?.displayName, d?.email]
        .filter(Boolean)
        .join(" · ");
    }
    if (report.targetType === "community") {
      const snap = await getDoc(doc(db, "groups", report.targetId));
      if (!snap.exists()) return null;
      const d = snap.data();
      return [d?.name, d?.description].filter(Boolean).join(" — ");
    }
    return null;
  } catch {
    return null;
  }
}

export default function ReportDetailPage() {
  const params = useParams();
  const router = useRouter();
  const reportId = params?.reportId as string;

  const [report, setReport] = useState<Report | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<ModeratorAction | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!reportId) return;
    getDoc(doc(db, "reports", reportId)).then((snap) => {
      if (!snap.exists()) {
        setLoading(false);
        return;
      }
      const d = snap.data() as FireReport;
      setReport({
        ...d,
        id: snap.id,
        createdAt: d.createdAt.toDate(),
        claimedAt: d.claimedAt?.toDate() ?? null,
        resolvedAt: d.resolvedAt?.toDate() ?? null,
      });
      setLoading(false);
    });
  }, [reportId]);

  useEffect(() => {
    if (!report) return;
    setPreviewLoading(true);
    fetchContentPreview(report)
      .then(setPreview)
      .finally(() => setPreviewLoading(false));
  }, [report]);

  async function handleSubmit() {
    if (!action) return;
    setSubmitting(true);
    setError(null);
    try {
      await resolveReport(reportId, action, notes.trim() || undefined);
      router.push("/admin/reports");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al resolver el reporte");
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div style={{ color: "#555", fontSize: 14 }}>Cargando reporte...</div>;
  }

  if (!report) {
    return (
      <div>
        <div style={{ color: "#f87171", fontSize: 14, marginBottom: 16 }}>
          Reporte no encontrado.
        </div>
        <Link href="/admin/reports" style={{ color: "#a855ff", fontSize: 13 }}>
          ← Volver
        </Link>
      </div>
    );
  }

  const isResolved = report.status === "resolved" || report.status === "dismissed";

  return (
    <div style={{ maxWidth: 680 }}>
      <Link
        href="/admin/reports"
        style={{ color: "#666", fontSize: 13, textDecoration: "none", display: "inline-block", marginBottom: 20 }}
      >
        ← Volver a reportes
      </Link>

      <h1 style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 24 }}>
        Detalle del reporte
      </h1>

      {/* Metadata */}
      <div
        style={{
          background: "#111",
          border: "1px solid #1e1e1e",
          borderRadius: 12,
          padding: 20,
          marginBottom: 16,
        }}
      >
        <Row label="Tipo" value={TARGET_LABELS[report.targetType] ?? report.targetType} />
        <Row label="Razón" value={REPORT_REASON_LABELS[report.reason]} />
        <Row label="Estado" value={report.status} />
        <Row label="ID del contenido" value={report.targetId} mono />
        {report.parentId && <Row label="ID del padre" value={report.parentId} mono />}
        <Row label="ID del propietario" value={report.targetOwnerId} mono />
        <Row
          label="Reportado"
          value={report.createdAt.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
        />
        {report.description && (
          <Row label="Descripción del reporte" value={report.description} />
        )}
      </div>

      {/* Content preview */}
      <div
        style={{
          background: "#0d0d0d",
          border: "1px solid #1e1e1e",
          borderRadius: 12,
          padding: 20,
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
          Vista previa del contenido
        </div>
        {previewLoading ? (
          <div style={{ color: "#444", fontSize: 13 }}>Cargando...</div>
        ) : preview ? (
          <div style={{ color: "#ccc", fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {preview}
          </div>
        ) : (
          <div style={{ color: "#444", fontSize: 13 }}>
            Vista previa no disponible para este tipo de contenido.
          </div>
        )}
      </div>

      {/* Actions */}
      {isResolved ? (
        <div
          style={{
            background: "#111",
            border: "1px solid #1e1e1e",
            borderRadius: 12,
            padding: 20,
          }}
        >
          <div style={{ fontSize: 13, color: "#888" }}>
            Este reporte ya fue{" "}
            <strong style={{ color: "#fff" }}>
              {report.status === "resolved" ? "resuelto" : "descartado"}
            </strong>
            {report.resolution && (
              <>
                {" "}con la acción:{" "}
                <strong style={{ color: "#d8b4fe" }}>
                  {MODERATOR_ACTION_LABELS[report.resolution]}
                </strong>
              </>
            )}
            {report.resolutionNotes && (
              <div style={{ marginTop: 8, color: "#666" }}>
                Notas: {report.resolutionNotes}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div
          style={{
            background: "#111",
            border: "1px solid #1e1e1e",
            borderRadius: 12,
            padding: 20,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 14 }}>
            Acción moderadora
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {MODERATOR_ACTIONS.map((a) => {
              const c = ACTION_COLOR[a];
              const selected = action === a;
              return (
                <button
                  key={a}
                  onClick={() => setAction(a)}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: `1px solid ${selected ? c.border : "#2a2a2a"}`,
                    background: selected ? c.bg : "transparent",
                    color: selected ? c.text : "#666",
                    fontSize: 13,
                    fontWeight: 600,
                    textAlign: "left",
                    cursor: "pointer",
                    transition: "all 120ms ease",
                  }}
                >
                  {MODERATOR_ACTION_LABELS[a]}
                </button>
              );
            })}
          </div>

          <textarea
            placeholder="Notas internas (opcional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={1000}
            rows={3}
            style={{
              width: "100%",
              background: "#0d0d0d",
              border: "1px solid #2a2a2a",
              borderRadius: 8,
              color: "#ccc",
              fontSize: 13,
              padding: "10px 12px",
              resize: "vertical",
              outline: "none",
              marginBottom: 14,
              boxSizing: "border-box",
            }}
          />

          {error && (
            <div
              style={{
                padding: "8px 12px",
                background: "#1f0a0a",
                border: "1px solid #7f1d1d",
                borderRadius: 8,
                color: "#f87171",
                fontSize: 13,
                marginBottom: 12,
              }}
            >
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={!action || submitting}
            style={{
              width: "100%",
              padding: "11px 14px",
              borderRadius: 8,
              border: "none",
              background: action ? "#7c3aed" : "#1a1a1a",
              color: action ? "#fff" : "#444",
              fontSize: 14,
              fontWeight: 700,
              cursor: !action || submitting ? "not-allowed" : "pointer",
              transition: "background 150ms ease",
            }}
          >
            {submitting ? "Procesando..." : "Confirmar acción"}
          </button>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 8, alignItems: "flex-start" }}>
      <span style={{ fontSize: 12, color: "#555", flexShrink: 0, width: 140, paddingTop: 1 }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 13,
          color: "#ccc",
          fontFamily: mono ? "monospace" : "inherit",
          wordBreak: "break-all",
        }}
      >
        {value}
      </span>
    </div>
  );
}
