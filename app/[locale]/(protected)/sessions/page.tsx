"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useTranslations, useLocale } from "next-intl";
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
import { setMeetGreetPreparing } from "@/lib/meetGreet/meetGreetRequests";
import { setExclusiveSessionPreparing } from "@/lib/exclusiveSession/exclusiveSessionRequests";
import { callGetRecordingDownloadUrl } from "@/lib/liveKit/sessionLifecycle";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { formatScheduledAt } from "@/lib/utils/timezoneDisplay";
import { formatDateTime } from "@/lib/i18n/dateTime";
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

function getRecordingExpiry(expiresAt: string | null, locale: string): {
  expired: boolean;
  diffDays: number | null;
  dateLabel: string | null;
} {
  if (!expiresAt) return { expired: false, diffDays: null, dateLabel: null };
  const exp = new Date(expiresAt);
  if (isNaN(exp.getTime())) return { expired: false, diffDays: null, dateLabel: null };
  const now = Date.now();
  if (now > exp.getTime()) return { expired: true, diffDays: null, dateLabel: null };
  const diffDays = Math.ceil((exp.getTime() - now) / (1000 * 60 * 60 * 24));
  const dateLabel = formatDateTime(exp, locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return { expired: false, diffDays, dateLabel };
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

function formatDate(d: Date | null, locale: string): string {
  return (
    formatDateTime(d, locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }) ?? "—"
  );
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
  // Nota: refund_requested / refund_review NO son activos — caen en "rechazados"
  // (sección historial), consistente con el panel lateral de saludos/consejos.
  return [
    "pending_creator_response",
    "accepted_pending_schedule",
    "scheduled",
    "reschedule_requested",
    "ready_to_prepare",
    "in_preparation",
  ].includes(status);
}

function getStatusColor(status: string): string {
  if (status === "completed") return "#86efac";
  if (status === "rejected" || status === "cancelled") return "#fca5a5";
  if (status === "refund_requested" || status === "refund_review") return "#fde68a";
  if (status === "in_preparation" || status === "ready_to_prepare") return "#a78bfa";
  return "rgba(255,255,255,0.60)";
}

const SESSION_STATUS_KEY_MAP: Record<string, string> = {
  pending_creator_response: "statusPendingResponse",
  accepted_pending_schedule: "statusAcceptedPendingSchedule",
  scheduled: "statusScheduled",
  reschedule_requested: "statusRescheduleRequested",
  rejected: "statusRejected",
  refund_requested: "statusRefundRequested",
  refund_review: "statusRefundReview",
  ready_to_prepare: "statusReadyToPrepare",
  in_preparation: "statusInPreparation",
  completed: "statusCompleted",
  cancelled: "statusCancelled",
};

// ─── Componente de tarjeta ────────────────────────────────────────────────────

function SessionCard({ session }: { session: BuyerSession }) {
  const tSessions = useTranslations("sessions");
  const locale = useLocale();
  const { format: formatMoney } = usePriceFormat();
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
        err instanceof Error ? err.message : tSessions("joinError")
      );
      setJoiningBusy(false);
    }
  }

  const creatorLabel = session.creatorDisplayName ?? session.creatorUsername ?? tSessions("creatorFallback");
  const sourceLabel =
    session.source === "profile"
      ? session.profileDisplayName ?? tSessions("profileFallback")
      : session.groupName ?? tSessions("communityFallback");

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
              {session.kind === "meet_greet" ? tSessions("meetGreetTitle") : tSessions("exclusiveSessionTitle")}
            </span>
            <span
              style={{
                ...statusBadge,
                color: getStatusColor(session.status),
              }}
            >
              {tSessions(SESSION_STATUS_KEY_MAP[session.status] ?? "statusUnknown")}
            </span>
          </div>
          <div style={cardSubline}>
            {sourceLabel
              ? tSessions("withCreatorAndSource", { name: creatorLabel, source: sourceLabel })
              : tSessions("withCreator", { name: creatorLabel })}
          </div>
          {session.scheduledAtDate ? (
            <div style={cardMeta}>
              {formatDate(session.scheduledAtDate, locale)}
              {(() => {
                const tzd = formatScheduledAt(session.scheduledAtDate, session.creatorTimezone, locale);
                if (!tzd?.showBoth) return null;
                return (
                  <span style={{ display: "block", fontSize: 11, color: "rgba(255,255,255,0.38)", marginTop: 2 }}>
                    {tSessions("creatorTimeNote", { time: tzd.creatorTime ?? "", label: tzd.creatorLabel ?? "" })}
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
              {joiningBusy ? tSessions("joining") : tSessions("joinCall")}
            </button>
          ) : null}

          {hasRecording ? (
            <>
              {session.recordingStatus === "processing" ||
              session.recordingStatus === "recording" ? (
                <div style={processingBadge}>{tSessions("processingRecording")}</div>
              ) : recordingReady ? (
                (() => {
                  const { expired, diffDays, dateLabel } = getRecordingExpiry(session.recordingExpiresAt, locale);
                  const expiryLabelStr = diffDays !== null && dateLabel
                    ? tSessions(diffDays <= 7 ? "recordingAvailableUrgent" : "recordingAvailable", { date: dateLabel, days: diffDays })
                    : null;
                  return expired ? (
                    <div style={failedBadge}>
                      {tSessions("recordingExpired")}
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
                            setDownloadError(tSessions("downloadError"));
                          } finally {
                            setDownloadBusy(false);
                          }
                        }}
                      >
                        {downloadBusy ? tSessions("fetchingLink") : tSessions("downloadRecording")}
                        {!downloadBusy && session.recordingDurationSeconds
                          ? ` (${formatDuration(session.recordingDurationSeconds)})`
                          : ""}
                      </button>
                      {expiryLabelStr ? <span style={expiryLabel}>{expiryLabelStr}</span> : null}
                      {downloadError ? (
                        <span style={{ ...expiryLabel, color: "#fca5a5" }}>
                          {downloadError}
                        </span>
                      ) : null}
                    </div>
                  );
                })()
              ) : session.recordingStatus === "failed" ? (
                <div style={failedBadge}>{tSessions("recordingFailed")}</div>
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
              <span style={detailLabel}>{tSessions("durationLabel")}</span>
              <span style={detailValue}>{tSessions("durationValue", { minutes: session.durationMinutes })}</span>
            </div>
          ) : null}

          {session.priceSnapshot != null ? (
            <div style={detailRow}>
              <span style={detailLabel}>{tSessions("priceLabel")}</span>
              <span style={detailValue}>
                {formatMoney(session.priceSnapshot, { baseCurrency: session.currency ?? "MXN" })}
              </span>
            </div>
          ) : null}

          {session.buyerMessage ? (
            <div style={infoBox}>{session.buyerMessage}</div>
          ) : null}

          {session.creatorScheduleNote ? (
            <div style={infoBox}>
              <strong>{tSessions("creatorNote")}</strong> {session.creatorScheduleNote}
            </div>
          ) : null}

          {session.rejectionReason ? (
            <div style={errorBox}>{tSessions("rejectionReason")} {session.rejectionReason}</div>
          ) : null}

          {session.refundReason ? (
            <div style={warningBox}>{tSessions("refundReason")} {session.refundReason}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function SessionsPage() {
  const tSessions = useTranslations("sessions");
  const { user } = useAuth();
  const [sessions, setSessions] = useState<BuyerSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
        <p style={emptyMsg}>{tSessions("loginRequired")}</p>
      </div>
    );
  }

  return (
    <div style={pageWrapper}>
      <h1 style={pageTitle}>{tSessions("pageTitle")}</h1>

      {loading ? (
        <p style={emptyMsg}>{tSessions("loading")}</p>
      ) : sessions.length === 0 ? (
        <p style={emptyMsg}>{tSessions("empty")}</p>
      ) : (
        <>
          {active.length > 0 ? (
            <section style={section}>
              <h2 style={sectionTitle}>{tSessions("sectionUpcoming")}</h2>
              {active.map((s) => (
                <SessionCard key={s.id} session={s} />
              ))}
            </section>
          ) : null}

          {delivered.length > 0 ? (
            <section style={section}>
              <h2 style={sectionTitle}>{tSessions("sectionDelivered")}</h2>
              {delivered.map((s) => (
                <SessionCard key={s.id} session={s} />
              ))}
            </section>
          ) : null}

          {history.length > 0 ? (
            <section style={section}>
              <h2 style={sectionTitle}>{tSessions("sectionHistory")}</h2>
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
  padding: "28px 16px max(24px, var(--vb-safe-bottom, 0px))",
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
  textAlign: "start",
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
  paddingInlineStart: 2,
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
