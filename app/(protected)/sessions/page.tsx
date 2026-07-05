"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  type Timestamp,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import { getMeetGreetStatusLabel } from "@/lib/meetGreet/types";
import { getExclusiveSessionStatusLabel } from "@/lib/exclusiveSession/types";
import { setMeetGreetPreparing } from "@/lib/meetGreet/meetGreetRequests";
import { setExclusiveSessionPreparing } from "@/lib/exclusiveSession/exclusiveSessionRequests";
import { callGetRecordingDownloadUrl } from "@/lib/liveKit/sessionLifecycle";
import { formatWalletMoney } from "@/lib/wallet/ownerWallet";
import { formatScheduledAt } from "@/lib/utils/timezoneDisplay";
import type { LiveKitSessionRecordingStatus } from "@/types/livekit";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type FirestoreDateLike =
  | Timestamp
  | { toDate: () => Date }
  | string
  | number
  | Date
  | null
  | undefined;

type BuyerSessionDoc = {
  kind: "meet_greet" | "exclusive_session";
  creatorId: string;
  creatorDisplayName: string | null;
  creatorUsername: string | null;
  creatorAvatarUrl: string | null;
  status: string;
  scheduledAt: FirestoreDateLike;
  durationMinutes: number | null;
  priceSnapshot: number | null;
  currency: "MXN" | "USD" | null;
  buyerMessage: string | null;
  creatorScheduleNote: string | null;
  rejectionReason: string | null;
  refundReason: string | null;
  groupId: string | null;
  groupName: string | null;
  source: "group" | "profile" | null;
  profileDisplayName: string | null;
  profileUsername: string | null;
  recordingStatus: LiveKitSessionRecordingStatus | null;
  recordingUrl: string | null;
  recordingDurationSeconds: number | null;
  recordingExpiresAt: string | null;
  preparingBuyerAt: FirestoreDateLike;
  updatedAt: FirestoreDateLike;
  creatorTimezone: string | null;
};

type BuyerSession = BuyerSessionDoc & {
  id: string;
  scheduledAtDate: Date | null;
  updatedAtDate: Date | null;
  preparingBuyerAtDate: Date | null;
};

function getRecordingExpiry(expiresAt: string | null): {
  expired: boolean;
  label: string | null;
} {
  if (!expiresAt) return { expired: false, label: null };
  const exp = new Date(expiresAt);
  if (isNaN(exp.getTime())) return { expired: false, label: null };
  const now = Date.now();
  if (now > exp.getTime()) return { expired: true, label: null };
  const diffDays = Math.ceil((exp.getTime() - now) / (1000 * 60 * 60 * 24));
  const dateLabel = new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(exp);
  const urgency = diffDays <= 7 ? "⚠️ " : "";
  return {
    expired: false,
    label: `${urgency}Disponible hasta el ${dateLabel} (${diffDays} ${diffDays === 1 ? "día" : "días"})`,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toDate(v: FirestoreDateLike): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object" && "toDate" in v) return v.toDate();
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function canJoin(session: BuyerSession): boolean {
  const { status, scheduledAtDate } = session;
  const joinable = new Set(["scheduled", "ready_to_prepare", "in_preparation"]);
  if (!joinable.has(status)) return false;
  if (!scheduledAtDate) return false;
  const now = Date.now();
  const prepareFrom = scheduledAtDate.getTime() - 10 * 60 * 1000;
  const lateTolerance = scheduledAtDate.getTime() + 40 * 60 * 1000;
  return now >= prepareFrom && now <= lateTolerance;
}

function isActiveStatus(status: string): boolean {
  return [
    "pending_creator_response",
    "accepted_pending_schedule",
    "scheduled",
    "reschedule_requested",
    "ready_to_prepare",
    "in_preparation",
    "refund_requested",
    "refund_review",
  ].includes(status);
}

function getStatusColor(status: string): string {
  if (status === "completed") return "#86efac";
  if (status === "rejected" || status === "cancelled") return "#fca5a5";
  if (status === "refund_requested" || status === "refund_review") return "#fde68a";
  if (status === "in_preparation" || status === "ready_to_prepare") return "#a78bfa";
  return "rgba(255,255,255,0.60)";
}

function getStatusLabel(session: BuyerSession): string {
  if (session.kind === "meet_greet") {
    return getMeetGreetStatusLabel(session.status as Parameters<typeof getMeetGreetStatusLabel>[0]);
  }
  return getExclusiveSessionStatusLabel(
    session.status as Parameters<typeof getExclusiveSessionStatusLabel>[0]
  );
}

// ─── Componente de tarjeta ────────────────────────────────────────────────────

function SessionCard({ session }: { session: BuyerSession }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [joiningBusy, setJoiningBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const joinable = canJoin(session);
  const isCompleted = session.status === "completed";
  const hasRecording =
    isCompleted &&
    session.recordingStatus != null &&
    session.recordingStatus !== "not_started";
  const recordingReady = session.recordingStatus === "ready";

  const callHref =
    `/sessions/${session.id}/call` +
    `?type=${session.kind}&role=buyer`;

  async function handleJoin() {
    setJoiningBusy(true);
    setJoinError(null);
    try {
      if (session.kind === "meet_greet") {
        await setMeetGreetPreparing({ requestId: session.id, role: "buyer" });
      } else {
        await setExclusiveSessionPreparing({ requestId: session.id, role: "buyer" });
      }
      router.push(callHref);
    } catch (err: unknown) {
      setJoinError(
        err instanceof Error ? err.message : "No se pudo unir a la sesión."
      );
      setJoiningBusy(false);
    }
  }

  const creatorLabel = session.creatorDisplayName ?? session.creatorUsername ?? "Creador";
  const sourceLabel =
    session.source === "profile"
      ? session.profileDisplayName ?? "Perfil"
      : session.groupName ?? "Comunidad";

  return (
    <div style={cardStyle}>
      {/* Header — siempre visible */}
      <button
        type="button"
        style={cardHeaderBtn}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {/* Avatar creador */}
        {session.creatorAvatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={session.creatorAvatarUrl}
            alt={creatorLabel}
            width={38}
            height={38}
            style={avatarStyle}
          />
        ) : (
          <div style={avatarFallback}>
            {creatorLabel.charAt(0).toUpperCase()}
          </div>
        )}

        <div style={cardHeaderMain}>
          <div style={cardTitleRow}>
            <span style={cardTitle}>
              {session.kind === "meet_greet" ? "Meet & Greet" : "Sesión Exclusiva"}
            </span>
            <span
              style={{
                ...statusBadge,
                color: getStatusColor(session.status),
              }}
            >
              {getStatusLabel(session)}
            </span>
          </div>
          <div style={cardSubline}>
            Con {creatorLabel}
            {sourceLabel ? ` · ${sourceLabel}` : ""}
          </div>
          {session.scheduledAtDate ? (
            <div style={cardMeta}>
              {formatDate(session.scheduledAtDate)}
              {(() => {
                const tzd = formatScheduledAt(session.scheduledAtDate, session.creatorTimezone);
                if (!tzd?.showBoth) return null;
                return (
                  <span style={{ display: "block", fontSize: 11, color: "rgba(255,255,255,0.38)", marginTop: 2 }}>
                    {tzd.creatorTime} hrs para el creador ({tzd.creatorLabel})
                  </span>
                );
              })()}
            </div>
          ) : null}
        </div>

        <span style={chevron}>{open ? "▲" : "▼"}</span>
      </button>

      {/* Acciones principales (siempre visibles si aplica) */}
      {joinable || hasRecording ? (
        <div style={actionsRow}>
          {joinable ? (
            <button
              type="button"
              style={joinBtn}
              onClick={() => void handleJoin()}
              disabled={joiningBusy}
            >
              {joiningBusy ? "Conectando…" : "Unirse a la llamada"}
            </button>
          ) : null}

          {hasRecording ? (
            <>
              {session.recordingStatus === "processing" ||
              session.recordingStatus === "recording" ? (
                <div style={processingBadge}>⏳ Procesando grabación…</div>
              ) : recordingReady ? (
                (() => {
                  const { expired, label } = getRecordingExpiry(session.recordingExpiresAt);
                  return expired ? (
                    <div style={failedBadge}>
                      La grabación ya no está disponible (expiró).
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <button
                        type="button"
                        style={{
                          ...downloadBtn,
                          opacity: downloadBusy ? 0.6 : 1,
                          cursor: downloadBusy ? "default" : "pointer",
                        }}
                        disabled={downloadBusy}
                        onClick={async (e) => {
                          e.stopPropagation();
                          setDownloadBusy(true);
                          setDownloadError(null);
                          try {
                            const url = await callGetRecordingDownloadUrl({
                              sessionId: session.id,
                              sessionType: session.kind,
                            });
                            window.open(url, "_blank", "noopener,noreferrer");
                          } catch {
                            setDownloadError("No se pudo obtener el enlace de descarga.");
                          } finally {
                            setDownloadBusy(false);
                          }
                        }}
                      >
                        {downloadBusy ? "Obteniendo enlace…" : "↓ Descargar grabación"}
                        {!downloadBusy && session.recordingDurationSeconds
                          ? ` (${formatDuration(session.recordingDurationSeconds)})`
                          : ""}
                      </button>
                      {label ? <span style={expiryLabel}>{label}</span> : null}
                      {downloadError ? (
                        <span style={{ ...expiryLabel, color: "#fca5a5" }}>
                          {downloadError}
                        </span>
                      ) : null}
                    </div>
                  );
                })()
              ) : session.recordingStatus === "failed" ? (
                <div style={failedBadge}>La grabación no está disponible.</div>
              ) : null}
            </>
          ) : null}

          {joinError ? (
            <div style={errorBox}>{joinError}</div>
          ) : null}
        </div>
      ) : null}

      {/* Detalle expandible */}
      {open ? (
        <div style={expandedPanel}>
          {session.durationMinutes ? (
            <div style={detailRow}>
              <span style={detailLabel}>Duración</span>
              <span style={detailValue}>{session.durationMinutes} min</span>
            </div>
          ) : null}

          {session.priceSnapshot != null ? (
            <div style={detailRow}>
              <span style={detailLabel}>Precio</span>
              <span style={detailValue}>
                {formatWalletMoney(session.priceSnapshot)}{" "}
                {session.currency ?? "MXN"}
              </span>
            </div>
          ) : null}

          {session.buyerMessage ? (
            <div style={infoBox}>{session.buyerMessage}</div>
          ) : null}

          {session.creatorScheduleNote ? (
            <div style={infoBox}>
              <strong>Nota del creador:</strong> {session.creatorScheduleNote}
            </div>
          ) : null}

          {session.rejectionReason ? (
            <div style={errorBox}>Motivo: {session.rejectionReason}</div>
          ) : null}

          {session.refundReason ? (
            <div style={warningBox}>Devolución: {session.refundReason}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function SessionsPage() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<BuyerSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    const uid = user.uid;
    const meetQ = query(
      collection(db, "meetGreetRequests"),
      where("buyerId", "==", uid),
      orderBy("updatedAt", "desc")
    );
    const exclusiveQ = query(
      collection(db, "exclusiveSessionRequests"),
      where("buyerId", "==", uid),
      orderBy("updatedAt", "desc")
    );

    const meetGreetSessions: BuyerSession[] = [];
    const exclusiveSessions: BuyerSession[] = [];
    let meetLoaded = false;
    let exclusiveLoaded = false;

    function merge() {
      const all = [...meetGreetSessions, ...exclusiveSessions].sort(
        (a, b) =>
          (b.updatedAtDate?.getTime() ?? 0) - (a.updatedAtDate?.getTime() ?? 0)
      );
      setSessions(all);
      if (meetLoaded && exclusiveLoaded) setLoading(false);
    }

    function buildSession(
      id: string,
      data: Partial<BuyerSessionDoc>,
      kind: "meet_greet" | "exclusive_session"
    ): BuyerSession {
      return {
        id,
        kind,
        creatorId: (data.creatorId as string) ?? "",
        creatorDisplayName: data.creatorDisplayName ?? null,
        creatorUsername: data.creatorUsername ?? null,
        creatorAvatarUrl: data.creatorAvatarUrl ?? null,
        status: (data.status as string) ?? "pending_creator_response",
        scheduledAt: data.scheduledAt ?? null,
        scheduledAtDate: toDate(data.scheduledAt),
        durationMinutes: typeof data.durationMinutes === "number" ? data.durationMinutes : null,
        priceSnapshot: typeof data.priceSnapshot === "number" ? data.priceSnapshot : null,
        currency:
          data.currency === "USD" ? "USD" : data.currency === "MXN" ? "MXN" : null,
        buyerMessage: data.buyerMessage ?? null,
        creatorScheduleNote: data.creatorScheduleNote ?? null,
        rejectionReason: data.rejectionReason ?? null,
        refundReason: data.refundReason ?? null,
        groupId: data.groupId ?? null,
        groupName: data.groupName ?? null,
        source:
          data.source === "profile" ? "profile" : data.source === "group" ? "group" : null,
        profileDisplayName: data.profileDisplayName ?? null,
        profileUsername: data.profileUsername ?? null,
        recordingStatus: data.recordingStatus ?? null,
        recordingUrl: data.recordingUrl ?? null,
        recordingDurationSeconds:
          typeof data.recordingDurationSeconds === "number"
            ? data.recordingDurationSeconds
            : null,
        recordingExpiresAt: data.recordingExpiresAt ?? null,
        preparingBuyerAt: data.preparingBuyerAt ?? null,
        preparingBuyerAtDate: toDate(data.preparingBuyerAt),
        updatedAt: data.updatedAt ?? null,
        updatedAtDate: toDate(data.updatedAt),
        creatorTimezone: data.creatorTimezone ?? null,
      };
    }

    const unsubMeet = onSnapshot(meetQ, (snap) => {
      meetGreetSessions.length = 0;
      snap.docs.forEach((d) => {
        meetGreetSessions.push(
          buildSession(d.id, d.data() as Partial<BuyerSessionDoc>, "meet_greet")
        );
      });
      meetLoaded = true;
      merge();
    });

    const unsubExclusive = onSnapshot(exclusiveQ, (snap) => {
      exclusiveSessions.length = 0;
      snap.docs.forEach((d) => {
        exclusiveSessions.push(
          buildSession(
            d.id,
            d.data() as Partial<BuyerSessionDoc>,
            "exclusive_session"
          )
        );
      });
      exclusiveLoaded = true;
      merge();
    });

    return () => {
      unsubMeet();
      unsubExclusive();
    };
  }, [user?.uid]);

  const active = sessions.filter((s) => isActiveStatus(s.status));
  const delivered = sessions.filter((s) => s.status === "completed");
  const history = sessions.filter(
    (s) => !isActiveStatus(s.status) && s.status !== "completed"
  );

  if (!user) {
    return (
      <div style={pageWrapper}>
        <p style={emptyMsg}>Debes iniciar sesión para ver tus sesiones.</p>
      </div>
    );
  }

  return (
    <div style={pageWrapper}>
      <h1 style={pageTitle}>Mis Sesiones</h1>

      {loading ? (
        <p style={emptyMsg}>Cargando…</p>
      ) : sessions.length === 0 ? (
        <p style={emptyMsg}>No tienes sesiones registradas aún.</p>
      ) : (
        <>
          {active.length > 0 ? (
            <section style={section}>
              <h2 style={sectionTitle}>Próximas y activas</h2>
              {active.map((s) => (
                <SessionCard key={s.id} session={s} />
              ))}
            </section>
          ) : null}

          {delivered.length > 0 ? (
            <section style={section}>
              <h2 style={sectionTitle}>Entregados</h2>
              {delivered.map((s) => (
                <SessionCard key={s.id} session={s} />
              ))}
            </section>
          ) : null}

          {history.length > 0 ? (
            <section style={section}>
              <h2 style={sectionTitle}>Historial</h2>
              {history.map((s) => (
                <SessionCard key={s.id} session={s} />
              ))}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const fontStack =
  'inherit';

const pageWrapper: CSSProperties = {
  maxWidth: 640,
  margin: "0 auto",
  padding: "28px 16px max(24px, env(safe-area-inset-bottom))",
  fontFamily: fontStack,
  color: "#fff",
  minHeight: "100dvh",
  boxSizing: "border-box",
};

const pageTitle: CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  letterSpacing: "-0.03em",
  margin: "0 0 24px",
};

const section: CSSProperties = {
  marginBottom: 32,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const sectionTitle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "rgba(255,255,255,0.40)",
  margin: "0 0 8px",
};

const cardStyle: CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
  overflow: "hidden",
};

const cardHeaderBtn: CSSProperties = {
  width: "100%",
  background: "transparent",
  border: "none",
  padding: "13px 14px",
  display: "flex",
  alignItems: "center",
  gap: 12,
  textAlign: "left",
  cursor: "pointer",
  color: "inherit",
  fontFamily: fontStack,
};

const avatarStyle: CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: "50%",
  objectFit: "cover",
  flexShrink: 0,
  border: "1px solid rgba(255,255,255,0.12)",
};

const avatarFallback: CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: "50%",
  flexShrink: 0,
  background: "rgba(255,255,255,0.07)",
  border: "1px solid rgba(255,255,255,0.12)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 700,
  fontSize: 14,
  color: "#fff",
};

const cardHeaderMain: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 3,
};

const cardTitleRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const cardTitle: CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: "#fff",
  lineHeight: 1.2,
};

const statusBadge: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  lineHeight: 1.2,
};

const cardSubline: CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.60)",
  lineHeight: 1.4,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const cardMeta: CSSProperties = {
  fontSize: 11,
  color: "rgba(255,255,255,0.40)",
  lineHeight: 1.4,
};

const chevron: CSSProperties = {
  fontSize: 11,
  color: "rgba(255,255,255,0.35)",
  flexShrink: 0,
};

const actionsRow: CSSProperties = {
  padding: "0 14px 13px",
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};

const joinBtn: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 10,
  border: "none",
  background: "#fff",
  color: "#000",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-block",
  lineHeight: 1.1,
};

const downloadBtn: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 10,
  border: "1px solid rgba(134,239,172,0.30)",
  background: "rgba(134,239,172,0.08)",
  color: "#86efac",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  lineHeight: 1.1,
};

const processingBadge: CSSProperties = {
  padding: "7px 12px",
  borderRadius: 10,
  border: "1px solid rgba(253,230,138,0.20)",
  background: "rgba(253,230,138,0.07)",
  color: "#fde68a",
  fontSize: 12,
  fontWeight: 500,
  lineHeight: 1.3,
};

const failedBadge: CSSProperties = {
  padding: "7px 12px",
  borderRadius: 10,
  border: "1px solid rgba(252,165,165,0.20)",
  background: "rgba(252,165,165,0.07)",
  color: "#fca5a5",
  fontSize: 12,
  fontWeight: 500,
  lineHeight: 1.3,
};

const expiryLabel: CSSProperties = {
  fontSize: 11,
  color: "rgba(253,230,138,0.80)",
  lineHeight: 1.4,
  paddingLeft: 2,
};

const expandedPanel: CSSProperties = {
  padding: "0 14px 13px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  borderTop: "1px solid rgba(255,255,255,0.06)",
  paddingTop: 12,
  marginTop: 2,
};

const detailRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
};

const detailLabel: CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.45)",
};

const detailValue: CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.80)",
  fontWeight: 500,
};

const infoBox: CSSProperties = {
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.07)",
  background: "rgba(0,0,0,0.14)",
  padding: "9px 10px",
  fontSize: 12,
  lineHeight: 1.45,
  color: "rgba(255,255,255,0.90)",
  whiteSpace: "pre-wrap",
};

const errorBox: CSSProperties = {
  borderRadius: 10,
  border: "1px solid rgba(252,165,165,0.18)",
  background: "rgba(252,165,165,0.07)",
  padding: "9px 10px",
  fontSize: 12,
  lineHeight: 1.45,
  color: "#fca5a5",
};

const warningBox: CSSProperties = {
  borderRadius: 10,
  border: "1px solid rgba(253,230,138,0.18)",
  background: "rgba(253,230,138,0.07)",
  padding: "9px 10px",
  fontSize: 12,
  lineHeight: 1.45,
  color: "#fde68a",
};

const emptyMsg: CSSProperties = {
  color: "rgba(255,255,255,0.45)",
  fontSize: 14,
  textAlign: "center",
  marginTop: 48,
};
