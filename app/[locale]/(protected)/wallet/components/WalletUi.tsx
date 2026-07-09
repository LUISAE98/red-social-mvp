"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { createPortal } from "react-dom";
import {
  formatWalletMoney,
  getWalletScheduleConflictResult,
  getWalletServiceDurationMinutes,
  getWalletServiceRowMeta,
  type WalletServiceItem,
} from "@/lib/wallet/ownerWallet";

import { respondGreetingRequest } from "@/lib/greetings/greetingRequests";
import {
  acceptMeetGreetRequest,
  proposeMeetGreetSchedule,
  rejectMeetGreetRequest,
  setMeetGreetPreparing,
} from "@/lib/meetGreet/meetGreetRequests";
import {
  acceptExclusiveSessionRequest,
  proposeExclusiveSessionSchedule,
  rejectExclusiveSessionRequest,
  setExclusiveSessionPreparing,
} from "@/lib/exclusiveSession/exclusiveSessionRequests";
import MeetGreetPreparationFullscreen from "@/app/components/meetGreet/MeetGreetPreparationFullscreen";
import { callGetRecordingDownloadUrl } from "@/lib/liveKit/sessionLifecycle";

import ScheduleDateTimeSelector, {
  getSchedulePartsFromDate,
  schedulePartsToIso,
  type ScheduleParts,
} from "./ScheduleDateTimeSelector";
import ScheduleCalendarOverlay from "./ScheduleCalendarOverlay";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import VibraToast from "@/app/components/VibraToast/VibraToast";

type ServiceCardTheme = { bgImage: string | null; btnBg: string; btnColor: string };
function getServiceCardTheme(kind: string): ServiceCardTheme {
  switch (kind) {
    case "saludo":      return { bgImage: "/saludo.png",        btnBg: "rgba(168,85,247,0.22)",  btnColor: "#d8b4fe" };
    case "consejo":     return { bgImage: "/consejo.png",       btnBg: "rgba(250,204,21,0.20)",  btnColor: "#fde047" };
    case "mensaje":     return { bgImage: null,                 btnBg: "rgba(168,85,247,0.22)",  btnColor: "#d8b4fe" };
    case "meet_greet":  return { bgImage: "/encuentroenvivo.png", btnBg: "rgba(29,78,216,0.28)", btnColor: "#93c5fd" };
    case "exclusive_session": return { bgImage: "/sesionexclusiva.png", btnBg: "rgba(190,24,93,0.28)", btnColor: "#f9a8d4" };
    default:            return { bgImage: null,                 btnBg: "rgba(168,85,247,0.22)",  btnColor: "#d8b4fe" };
  }
}

function getServiceEmoji(row: WalletServiceItem): string {
  if (row.status === "rejected" || row.status === "cancelled") return "❌";
  if (row.status === "refund_requested" || row.status === "refund_review") return "💸";

  switch (row.kind) {
    case "saludo":
      return "👋";
    case "consejo":
      return "💡";
    case "meet_greet":
      return "🤝";
    case "mensaje":
      return "💬";
    default:
      return "👑";
  }
}

function getStatusTone(
  row: WalletServiceItem
): "default" | "danger" | "warning" {
  if (row.status === "rejected" || row.status === "cancelled") return "danger";
  if (row.status === "refund_requested" || row.status === "refund_review") return "warning";
  return "default";
}

function isPrepareWindowOpen(value: Date | null): boolean {
  if (!value) return false;

  const now = Date.now();
  const startsAt = value.getTime();
  const prepareFrom = startsAt - 10 * 60 * 1000;

  return now >= prepareFrom;
}

function isNoShowExpired(value: Date | null): boolean {
  if (!value) return false;

  const rejectAt = value.getTime() + 15 * 60 * 1000;
  return Date.now() >= rejectAt;
}

function isStartingSoon(value: Date | null): boolean {
  if (!value) return false;

  const now = Date.now();
  const diff = value.getTime() - now;

  return diff > 0 && diff <= 24 * 60 * 60 * 1000;
}

function isClosedStatus(status: string): boolean {
  return [
    "rejected",
    "refund_requested",
    "refund_review",
    "cancelled",
    "completed",
  ].includes(status);
}

function getNoShowMessage(row: WalletServiceItem, buyerMsg: string, creatorMsg: string): string | null {
  if (!row.rejectionReason) return null;

  const lower = row.rejectionReason.toLowerCase();

  if (lower.includes("comprador") || lower.includes("buyer")) {
    return buyerMsg;
  }

  if (lower.includes("creador") || lower.includes("creator")) {
    return creatorMsg;
  }

  return row.rejectionReason;
}

function getScheduledServiceActionFlags(row: WalletServiceItem) {
  const noShowExpired =
    !row.preparingCreatorAt && isNoShowExpired(row.scheduledAt);

  if (isClosedStatus(row.status) || noShowExpired) {
    return {
      canAccept: false,
      canReject: false,
      canSchedule: false,
      canPrepare: false,
    };
  }

  const canAccept = row.status === "pending_creator_response";

  const canReject =
    row.status === "pending_creator_response" ||
    row.status === "accepted_pending_schedule" ||
    row.status === "reschedule_requested";

  const canSchedule =
    row.status === "accepted_pending_schedule" ||
    row.status === "reschedule_requested" ||
    row.status === "scheduled" ||
    row.status === "ready_to_prepare";

  const canPrepare =
    (row.status === "scheduled" ||
      row.status === "ready_to_prepare" ||
      row.status === "in_preparation") &&
    isPrepareWindowOpen(row.scheduledAt);

  return { canAccept, canReject, canSchedule, canPrepare };
}

function buildSourceLabel(row: WalletServiceItem, labels: {
  profileFull: string; profileName: string; profileUsername: string; profileDefault: string; community: string;
}): string | null {
  if (row.requestSource === "profile") {
    if (row.profileDisplayName && row.profileUsername) return labels.profileFull;
    if (row.profileDisplayName) return labels.profileName;
    if (row.profileUsername) return labels.profileUsername;
    return labels.profileDefault;
  }
  if (row.groupName) return labels.community;
  return null;
}

function formatRecordingDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

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
  const dateLabel = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(exp);
  return { expired: false, diffDays, dateLabel };
}


const walletFontStack = 'inherit';

function AvatarImg({ src, alt, initial }: { src: string; alt: string; initial: string }) {
  const [error, setError] = useState(false);
  const fallbackStyle: React.CSSProperties = {
    width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
    background: "rgba(255,255,255,0.09)", border: "1px solid rgba(255,255,255,0.14)",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontWeight: 700, fontSize: 14, color: "#fff",
  };
  if (error || !src) return <div style={fallbackStyle}>{initial}</div>;
  return (
    <Image
      src={src}
      alt={alt}
      width={40}
      height={40}
      onError={() => setError(true)}
      style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "1px solid rgba(255,255,255,0.14)" }}
    />
  );
}

export function WalletCard({
  title,
  description,
  headerRight,
  children,
  transparent = false,
}: {
  title?: string;
  description?: string;
  headerRight?: React.ReactNode;
  children?: React.ReactNode;
  transparent?: boolean;
}) {
  return (
    <>
      <style jsx>{`
        .card {
          border-radius: 22px;
          border: none;
          background: ${transparent ? "transparent" : "rgba(90, 41, 174, 0.14)"};
          padding: 18px;
          box-shadow: none;
        }

        .cardHeader {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
        }

        .cardHeaderMain {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .cardHeaderRight {
          flex-shrink: 0;
          display: flex;
          align-items: center;
        }

        .cardTitle {
          margin: 0;
          font-size: 18px;
          line-height: 1.15;
          letter-spacing: -0.02em;
          font-weight: 600;
          color: #fff;
        }

        .cardDescription {
          margin: 0;
          color: rgba(255, 255, 255, 0.68);
          font-size: 13px;
          line-height: 1.55;
          font-weight: 400;
        }

        .cardBody {
          margin-top: 16px;
        }

        @media (max-width: 900px) {
          .card {
            border-radius: 18px;
            padding: 15px;
          }

          .cardTitle {
            font-size: 17px;
          }

          .cardHeader {
            align-items: flex-start;
          }
        }
      `}</style>

      <div className="card">
        {(title || description || headerRight) ? (
          <div className="cardHeader">
            {(title || description) ? (
              <div className="cardHeaderMain">
                {title ? <h2 className="cardTitle">{title}</h2> : null}
                {description ? <p className="cardDescription">{description}</p> : null}
              </div>
            ) : null}
            {headerRight ? <div className="cardHeaderRight">{headerRight}</div> : null}
          </div>
        ) : null}

        {children ? <div className="cardBody">{children}</div> : null}
      </div>
    </>
  );
}

export function WalletErrorBox({ message }: { message: string }) {
  return (
    <>
      <style jsx>{`
        .errorBox {
          margin-bottom: 14px;
          padding: 12px 14px;
          border-radius: 16px;
          border: 1px solid rgba(248, 113, 113, 0.24);
          background: rgba(248, 113, 113, 0.09);
          color: #fca5a5;
          font-size: 13px;
          line-height: 1.5;
        }
      `}</style>

      <div className="errorBox">{message}</div>
    </>
  );
}

export function PlaceholderRow({
  title,
  subtitle,
  meta,
  emoji,
  statusTone = "default",
}: {
  title: string;
  subtitle: string;
  meta?: string;
  emoji?: string;
  statusTone?: "default" | "danger" | "warning";
}) {
  const subtitleClass =
    statusTone === "danger"
      ? "placeholderSubtitleDanger"
      : statusTone === "warning"
        ? "placeholderSubtitleWarning"
        : "placeholderSubtitle";

  return (
    <>
      <style jsx>{`
        .placeholderRow {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          padding: 13px 14px;
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.09);
          background: rgba(255, 255, 255, 0.028);
        }

        .placeholderMain {
          min-width: 0;
          flex: 1;
        }

        .titleRow {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .placeholderTitle {
          font-size: 14px;
          font-weight: 600;
          line-height: 1.3;
          letter-spacing: -0.01em;
          color: #fff;
        }

        .desktopEmoji {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 15px;
          line-height: 1;
          flex-shrink: 0;
        }

        .mobileEmoji {
          display: none;
          flex-shrink: 0;
          font-size: 18px;
          line-height: 1;
          margin-left: auto;
        }

        .placeholderSubtitle {
          margin-top: 4px;
          color: rgba(255, 255, 255, 0.64);
          font-size: 12px;
          line-height: 1.52;
          font-weight: 400;
        }

        .placeholderSubtitleDanger {
          margin-top: 4px;
          color: #f87171;
          font-size: 12px;
          line-height: 1.52;
          font-weight: 500;
        }

        .placeholderSubtitleWarning {
          margin-top: 4px;
          color: #facc15;
          font-size: 12px;
          line-height: 1.52;
          font-weight: 500;
        }

        .placeholderMeta {
          flex-shrink: 0;
          border-radius: 999px;
          padding: 7px 10px;
          background: rgba(255, 255, 255, 0.07);
          border: 1px solid rgba(255, 255, 255, 0.11);
          color: rgba(255, 255, 255, 0.82);
          font-size: 11px;
          font-weight: 500;
          line-height: 1;
        }

        @media (max-width: 900px) {
          .placeholderRow {
            flex-direction: column;
            align-items: flex-start;
          }

          .placeholderMeta {
            margin-top: 2px;
          }

          .desktopEmoji {
            display: none;
          }

          .mobileEmoji {
            display: inline-flex;
          }

          .titleRow {
            width: 100%;
          }
        }
      `}</style>

      <div className="placeholderRow">
        <div className="placeholderMain">
          <div className="titleRow">
            <div className="placeholderTitle">{title}</div>
            {emoji ? <span className="desktopEmoji">{emoji}</span> : null}
            {emoji ? <span className="mobileEmoji">{emoji}</span> : null}
          </div>

          <div className={subtitleClass}>{subtitle}</div>
        </div>

        {meta ? <div className="placeholderMeta">{meta}</div> : null}
      </div>
    </>
  );
}

export function EmptyRows({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <PlaceholderRow title={title} subtitle={subtitle} meta="Vacío" />
    </div>
  );
}
function buildRowSubtitle(row: WalletServiceItem, labels: {
  sourceLabel: string | null;
  forTarget: string;
  buyerLabel: string;
  motiveLabel: string;
  refundLabel: string;
}): string {
  const chunks: string[] = [];

  if (labels.sourceLabel) {
    chunks.push(labels.sourceLabel);
  }

  chunks.push(row.statusLabel);

  if (row.targetName) {
    chunks.push(labels.forTarget);
  }

  if (row.buyerDisplayName) {
    chunks.push(labels.buyerLabel);
  }

  if (row.priceSnapshot != null) {
    chunks.push(formatWalletMoney(row.priceSnapshot));
  }

  if (labels.motiveLabel) {
    chunks.push(labels.motiveLabel);
  }

  if (row.refundReason) {
    chunks.push(labels.refundLabel);
  }

  return chunks.join(" · ");
}

export function WalletServiceRow({
  row,
  open,
  onToggle,
  calendarItems = [],
  onRecord,
  onView,
  mode = "pending",
}: {
  row: WalletServiceItem;
  open: boolean;
  onToggle: () => void;
  calendarItems?: WalletServiceItem[];
  onRecord?: (row: WalletServiceItem) => void;
  onView?: (row: WalletServiceItem) => void;
  mode?: "pending" | "history";
}) {
  const [busy, setBusy] = useState(false);
  const { toast: walletRowToast, showToast: showWalletRowToast } = useVibraToast();
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [preparationOpen, setPreparationOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [scheduleNote, setScheduleNote] = useState(row.creatorScheduleNote ?? "");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [scheduleParts, setScheduleParts] = useState<ScheduleParts>(
    getSchedulePartsFromDate(row.scheduledAt)
  );

  const tCommon = useTranslations("common");
  const tServices = useTranslations("services");
  const tWallet = useTranslations("wallet");
  const locale = useLocale();

  useEffect(() => {
    setScheduleParts(getSchedulePartsFromDate(row.scheduledAt));
    setScheduleNote(row.creatorScheduleNote ?? "");
  }, [row.scheduledAt, row.creatorScheduleNote]);

  const noShowMessage = getNoShowMessage(row, tWallet("noShowBuyer"), tWallet("noShowCreator"));
  const sourceLabel = buildSourceLabel(row, {
    profileFull: tWallet("sourceLabelProfileFull", { displayName: row.profileDisplayName ?? "", username: row.profileUsername ?? "" }),
    profileName: tWallet("sourceLabelProfileName", { displayName: row.profileDisplayName ?? "" }),
    profileUsername: tWallet("sourceLabelProfileUsername", { username: row.profileUsername ?? "" }),
    profileDefault: tWallet("sourceLabelProfileDefault"),
    community: row.groupName ? tWallet("sourceCommunity", { groupName: row.groupName }) : "",
  });
  const motiveLabel = noShowMessage
    ? tWallet("motiveLabel", { motive: noShowMessage })
    : row.rejectionReason
    ? tWallet("motiveLabel", { motive: row.rejectionReason })
    : "";
  const relativeTime = (() => {
    const d = row.createdAt;
    if (!d) return tCommon("relativeTimeNow");
    const diffMs = Date.now() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays >= 1) return tCommon("relativeTimeDays", { count: diffDays });
    if (diffHours >= 1) return tCommon("relativeTimeHours", { count: diffHours });
    if (diffMins >= 1) return tCommon("relativeTimeMinutes", { count: diffMins });
    return tCommon("relativeTimeNow");
  })();

  const statusTone = getStatusTone(row);
  const subtitle = buildRowSubtitle(row, {
    sourceLabel,
    forTarget: row.targetName ? tWallet("forTarget", { name: row.targetName }) : "",
    buyerLabel: row.buyerDisplayName ? tWallet("buyerLabel", { name: row.buyerDisplayName }) : "",
    motiveLabel,
    refundLabel: row.refundReason ? tWallet("refundLabel", { reason: row.refundReason }) : "",
  });
  const meta = getWalletServiceRowMeta(row);

  const historyStatusLabel: string | null =
    row.status === "rejected" || row.status === "cancelled"
      ? tWallet("historyRejected")
      : row.status === "refund_requested" || row.status === "refund_review"
      ? tWallet("historyRefund")
      : null;

  const historyStatusColor: string =
    row.status === "refund_requested" || row.status === "refund_review"
      ? "#fde047"
      : "#f87171";
  const emoji = getServiceEmoji(row);

  const isGreeting = row.source === "greeting";
  const isMeetGreet = row.source === "meet_greet";
  const isExclusiveSession = row.source === "exclusive_session";
  const isScheduledService = isMeetGreet || isExclusiveSession;

  const selectedScheduledAtIso = schedulePartsToIso(scheduleParts);
  const selectedScheduledAt = selectedScheduledAtIso
    ? new Date(selectedScheduledAtIso)
    : null;

  const scheduleConflict = isScheduledService
    ? getWalletScheduleConflictResult(
        {
          id: row.id,
          source: row.source,
          scheduledAt: selectedScheduledAt,
          durationMinutes: getWalletServiceDurationMinutes(row),
        },
        calendarItems
      )
    : {
        hasConflict: false,
        conflictItem: null,
        message: null,
      };

  const noShowExpired =
    isScheduledService &&
    !row.preparingCreatorAt &&
    isNoShowExpired(row.scheduledAt);

  const { canAccept, canReject, canSchedule, canPrepare } =
    isScheduledService
      ? getScheduledServiceActionFlags(row)
      : {
          canAccept: row.status === "pending",
          canReject: row.status === "pending",
          canSchedule: false,
          canPrepare: false,
        };

  async function handleGreeting(action: "accept" | "reject") {
    setBusy(true);

    try {
      await respondGreetingRequest({
        requestId: row.id,
        action,
      });

      showWalletRowToast(action === "accept" ? tWallet("greetingAccepted") : tWallet("greetingRejected"));
    } catch (e: unknown) {
      showWalletRowToast((e instanceof Error ? e.message : null) ?? tWallet("greetingUpdateError"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleScheduledServiceAccept() {
    setBusy(true);

    try {
      if (isExclusiveSession) {
        await acceptExclusiveSessionRequest({ requestId: row.id });
        showWalletRowToast(tWallet("exclusiveAccepted"));
      } else {
        await acceptMeetGreetRequest({ requestId: row.id });
        showWalletRowToast(tWallet("liveAccepted"));
      }

      setScheduleOpen(true);
    } catch (e: unknown) {
      showWalletRowToast((e instanceof Error ? e.message : null) ?? tWallet("acceptError"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleScheduledServiceReject() {
    setBusy(true);

    try {
      if (isExclusiveSession) {
        await rejectExclusiveSessionRequest({
          requestId: row.id,
          rejectionReason: rejectReason || null,
        });
        showWalletRowToast(tWallet("exclusiveRejected"));
      } else {
        await rejectMeetGreetRequest({
          requestId: row.id,
          rejectionReason: rejectReason || null,
        });
        showWalletRowToast(tWallet("liveRejected"));
      }

      setRejectOpen(false);
    } catch (e: unknown) {
      showWalletRowToast((e instanceof Error ? e.message : null) ?? tWallet("rejectError"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleScheduledServiceSchedule() {
    const scheduledAt = schedulePartsToIso(scheduleParts);

    if (!scheduledAt) {
      showWalletRowToast(tWallet("selectDateTimeError"), "error");
      return;
    }

    if (scheduleConflict.hasConflict) {
      showWalletRowToast(
        scheduleConflict.message ?? tWallet("scheduleConflictFallback"),
        "error"
      );
      return;
    }

    setBusy(true);

    try {
      const payload = {
        requestId: row.id,
        scheduledAt,
        note: scheduleNote || null,
      };

      if (isExclusiveSession) {
        await proposeExclusiveSessionSchedule(payload);
      } else {
        await proposeMeetGreetSchedule(payload);
      }

      showWalletRowToast(tWallet("dateSaved"));
      setScheduleOpen(false);
      setCalendarOpen(false);
    } catch (e: unknown) {
      showWalletRowToast((e instanceof Error ? e.message : null) ?? tWallet("dateSaveError"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handlePrepare() {
    setBusy(true);

    try {
      if (isExclusiveSession) {
        await setExclusiveSessionPreparing({
          requestId: row.id,
          role: "creator",
        });
      } else {
        await setMeetGreetPreparing({
          requestId: row.id,
          role: "creator",
        });
      }

      setPreparationOpen(true);
    } catch (e: unknown) {
      showWalletRowToast((e instanceof Error ? e.message : null) ?? tWallet("prepareError"), "error");
    } finally {
      setBusy(false);
    }
  }
  // ── Greeting card (flat, no accordion) ──────────────────────────────────────
  if (isGreeting) {
    const initial = (row.buyerDisplayName ?? "U").charAt(0).toUpperCase();
    const isHistory = mode === "history";
    const isReadOnly = isHistory && (row.status === "rejected" || row.status === "devolucion");
    const actionLabel = isHistory
      ? (isReadOnly ? tWallet("viewRequest") : row.kind === "consejo" ? tWallet("actionViewConsejo") : row.kind === "mensaje" ? tWallet("actionViewMensaje") : tWallet("actionViewSaludo"))
      : (row.kind === "consejo" ? tWallet("actionRecordConsejo") : row.kind === "saludo" ? tWallet("actionRecordSaludo") : tWallet("actionRecord"));
    const sentLabel = isHistory && row.deliveredAt
      ? tWallet(
          row.kind === "consejo" ? "sentLabelConsejo" : row.kind === "mensaje" ? "sentLabelMensaje" : "sentLabelSaludo",
          { date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(row.deliveredAt) }
        )
      : null;
    const theme = getServiceCardTheme(row.kind);
    const handleGreetingClick = () => isHistory ? onView?.(row) : onRecord?.(row);
    return (
      <>
        <style jsx>{`
          .wGCard {
            overflow: hidden;
            border-radius: 14px;
          }
          .wGCardInner {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 13px 14px;
          }
          @media (max-width: 640px) {
            .wGCard { cursor: pointer; }
            .wGCardBtn { display: none !important; }
            .wGCardChevron { display: flex !important; }
          }
        `}</style>
        <div className="wGCard" onClick={handleGreetingClick}>
          <div
            className="wGCardInner"
            style={{
              fontFamily: walletFontStack,
              background: theme.bgImage
                ? `linear-gradient(rgba(8,8,10,0.78), rgba(8,8,10,0.78)), url(${theme.bgImage}) center / cover no-repeat`
                : "rgba(255,255,255,0.04)",
            }}
          >
            <AvatarImg src={row.buyerAvatarUrl ?? ""} alt={row.buyerDisplayName ?? ""} initial={initial} />
            <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <span style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 1 }}>
                  {row.buyerDisplayName ?? tCommon("user")}
                </span>
                {row.priceSnapshot != null ? (
                  <span style={{ color: isHistory && historyStatusLabel ? historyStatusColor : "#86efac", fontWeight: 600, fontSize: 11, lineHeight: 1.2, whiteSpace: "nowrap", flexShrink: 0 }}>
                    +{formatWalletMoney(Math.round(row.priceSnapshot * 0.77 * 100) / 100)} MXN
                  </span>
                ) : null}
              </div>
              <div style={{ color: "rgba(255,255,255,0.48)", fontSize: 11, lineHeight: 1.3, marginTop: 3 }}>
                {isHistory && historyStatusLabel
                  ? <span style={{ color: historyStatusColor }}>{historyStatusLabel}</span>
                  : (sentLabel ?? relativeTime)}
              </div>
            </div>
            <button
              className="wGCardBtn"
              type="button"
              onClick={(e) => { e.stopPropagation(); handleGreetingClick(); }}
              style={{
                flexShrink: 0, width: 148, height: 32, borderRadius: 8, border: "none",
                background: theme.btnBg, color: theme.btnColor,
                fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: walletFontStack,
                whiteSpace: "nowrap", display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              {actionLabel}
            </button>
            <span className="wGCardChevron" style={{ display: "none", flexShrink: 0, color: "#fff", alignItems: "center", justifyContent: "center" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </span>
          </div>
        </div>
      </>
    );
  }

  const theme = getServiceCardTheme(row.kind);

  if (isScheduledService && onView) {
    const actionLabel =
      mode === "history" && row.status === "completed" ? tServices("viewDetails") :
      mode === "history" && ["rejected", "cancelled", "refund_requested", "refund_review"].includes(row.status) ? tServices("viewDetails") :
      row.status === "reschedule_requested" ? tServices("reschedule") :
      ["scheduled", "ready_to_prepare", "in_preparation", "completed"].includes(row.status) ? tServices("viewDetails") :
      tServices("schedule");
    return (
      <>
        <style jsx>{`
          .wSCard {
            overflow: hidden;
            border-radius: 14px;
          }
          .wSCardInner {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 13px 14px;
          }
          @media (max-width: 640px) {
            .wSCard { cursor: pointer; }
            .wSCardBtn { display: none !important; }
            .wSCardChevron { display: flex !important; }
          }
        `}</style>
        <div className="wSCard" onClick={() => onView(row)}>
          <div className="wSCardInner" style={{ fontFamily: walletFontStack, background: theme.bgImage ? `linear-gradient(rgba(8,8,10,0.78), rgba(8,8,10,0.78)), url(${theme.bgImage}) center / cover no-repeat` : "rgba(255,255,255,0.04)" }}>
            <AvatarImg src={row.buyerAvatarUrl ?? ""} alt={row.buyerDisplayName ?? ""} initial={(row.buyerDisplayName ?? "U").charAt(0).toUpperCase()} />
            <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <span style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 1 }}>
                  {row.buyerDisplayName ?? tCommon("user")}
                </span>
                {row.priceSnapshot != null ? (
                  <span style={{ color: mode === "history" && historyStatusLabel ? historyStatusColor : "#86efac", fontWeight: 600, fontSize: 11, lineHeight: 1.2, whiteSpace: "nowrap", flexShrink: 0 }}>
                    +{formatWalletMoney(Math.round(row.priceSnapshot * 0.77 * 100) / 100)} MXN
                  </span>
                ) : null}
              </div>
              <div style={{ color: "rgba(255,255,255,0.48)", fontSize: 11, lineHeight: 1.3, marginTop: 3 }}>
                {mode === "history" && historyStatusLabel
                  ? <span style={{ color: historyStatusColor }}>{historyStatusLabel}</span>
                  : row.scheduledAt
                  ? (() => {
                      const label = new Intl.DateTimeFormat(locale, {
                        weekday: "long", day: "numeric", month: "long", year: "numeric",
                      }).format(row.scheduledAt);
                      return label.charAt(0).toUpperCase() + label.slice(1);
                    })()
                  : tWallet("pendingSchedule")}
              </div>
            </div>
            <button
              className="wSCardBtn"
              type="button"
              onClick={(e) => { e.stopPropagation(); onView(row); }}
              style={{ flexShrink: 0, width: 148, height: 32, borderRadius: 8, border: "none", background: theme.btnBg, color: theme.btnColor, fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: walletFontStack, whiteSpace: "nowrap", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              {actionLabel}
            </button>
            <span className="wSCardChevron" style={{ display: "none", flexShrink: 0, color: "#fff", alignItems: "center", justifyContent: "center" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </span>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style jsx>{`
        .walletServiceBody {
          padding: 0 15px 15px;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
        }

        .walletServiceBodyInner {
          padding-top: 12px;
          display: grid;
          gap: 10px;
        }

        .walletServiceChip {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: fit-content;
          border-radius: 999px;
          padding: 5px 9px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.05);
          color: #fff;
          font-size: 11px;
          font-weight: 700;
          line-height: 1;
        }

        .walletServiceInfoBox {
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(0, 0, 0, 0.16);
          padding: 10px;
          white-space: pre-wrap;
          font-size: 12px;
          line-height: 1.4;
          color: rgba(255, 255, 255, 0.92);
        }

        .walletServiceWarningBox {
          border-radius: 12px;
          border: 1px solid rgba(250, 204, 21, 0.18);
          background: rgba(250, 204, 21, 0.08);
          padding: 10px;
          font-size: 12px;
          line-height: 1.4;
          color: #fde68a;
        }

        .walletServiceErrorBox {
          border-radius: 12px;
          border: 1px solid rgba(248, 113, 113, 0.18);
          background: rgba(248, 113, 113, 0.08);
          padding: 10px;
          font-size: 12px;
          line-height: 1.4;
          color: #fecaca;
        }

        .walletServiceSuccessBox {
          border-radius: 12px;
          border: 1px solid rgba(34, 197, 94, 0.18);
          background: rgba(34, 197, 94, 0.08);
          padding: 10px;
          font-size: 12px;
          line-height: 1.4;
          color: #bbf7d0;
        }

        .walletServiceActions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .walletPrimaryBtn {
          padding: 8px 12px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          background: #fff;
          color: #000;
          font-size: 13px;
          font-weight: 700;
          line-height: 1.1;
          cursor: pointer;
        }

        .walletSecondaryBtn {
          padding: 8px 12px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.05);
          color: #fff;
          font-size: 13px;
          font-weight: 600;
          line-height: 1.1;
          cursor: pointer;
        }

        .walletField {
          padding: 10px 11px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.04);
          color: #fff;
          outline: none;
          font-size: 12px;
          box-sizing: border-box;
          width: 100%;
        }

        .walletMiniMeta {
          color: rgba(255, 255, 255, 0.72);
          font-size: 12px;
          line-height: 1.45;
        }

      `}</style>

      <div style={{ overflow: "hidden", borderRadius: 14 }}>
        <button
          type="button"
          onClick={onToggle}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            width: "100%",
            border: "none",
            padding: "13px 14px",
            background: theme.bgImage
              ? `linear-gradient(rgba(8,8,10,0.78), rgba(8,8,10,0.78)), url(${theme.bgImage}) center / cover no-repeat`
              : "rgba(255,255,255,0.04)",
            cursor: "pointer",
            fontFamily: walletFontStack,
          }}
        >
          <AvatarImg src={row.buyerAvatarUrl ?? ""} alt={row.buyerDisplayName ?? ""} initial={(row.buyerDisplayName ?? "U").charAt(0).toUpperCase()} />
          <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <span style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 1 }}>
                {row.buyerDisplayName ?? tCommon("user")}
              </span>
              {row.priceSnapshot != null ? (
                <span style={{ color: "#86efac", fontWeight: 600, fontSize: 11, lineHeight: 1.2, whiteSpace: "nowrap", flexShrink: 0 }}>
                  +{formatWalletMoney(Math.round(row.priceSnapshot * 0.77 * 100) / 100)} MXN
                </span>
              ) : null}
            </div>
            <div style={{ color: "rgba(255,255,255,0.48)", fontSize: 11, lineHeight: 1.3, marginTop: 3 }}>
              {subtitle}
            </div>
          </div>
          <span style={{ flexShrink: 0, height: 32, padding: "0 12px", borderRadius: 8, background: theme.btnBg, color: theme.btnColor, fontWeight: 600, fontSize: 12, display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
            {open ? tCommon("closeLabel") : tCommon("viewLabel")}&nbsp;<span style={{ fontSize: 9 }}>{open ? "▴" : "▾"}</span>
          </span>
        </button>

        {open ? (
          <div className="walletServiceBody">
            <div className="walletServiceBodyInner">
              <div className="walletServiceChip">{row.statusLabel}</div>

{row.requestSource === "profile" ? (
  <div className="walletMiniMeta">
    {tWallet("sourceProfile")}
    {row.profileDisplayName ? ` · ${row.profileDisplayName}` : ""}
    {row.profileUsername ? ` · @${row.profileUsername}` : ""}
  </div>
) : row.groupName ? (
  <div className="walletMiniMeta">{tWallet("sourceCommunity", { groupName: row.groupName })}</div>
) : null}

              {row.priceSnapshot != null ? (
                <div className="walletMiniMeta">
                  {tWallet("priceLabel", { price: formatWalletMoney(row.priceSnapshot) })}
                </div>
              ) : null}

              {row.durationMinutes != null ? (
                <div className="walletMiniMeta">
                  {tWallet("durationLabel", { minutes: row.durationMinutes })}
                </div>
              ) : null}

              {isScheduledService &&
              isStartingSoon(row.scheduledAt) &&
              !isNoShowExpired(row.scheduledAt) ? (
                <div className="walletServiceWarningBox">
                  {tWallet("soonToStart")}
                </div>
              ) : null}

              {isScheduledService && row.status !== "rejected" && noShowExpired ? (
                <div className="walletServiceErrorBox">
                  {tWallet("noShowExpiredWarning")}
                </div>
              ) : null}

              {isScheduledService && row.status === "rejected" && noShowMessage ? (
                <div className="walletServiceErrorBox">{noShowMessage}</div>
              ) : null}

              {row.targetName ? (
                <div className="walletMiniMeta">{tWallet("forTarget", { name: row.targetName })}</div>
              ) : null}

              {row.buyerDisplayName ? (
                <div className="walletMiniMeta">
                  {tWallet("buyerLabel", { name: row.buyerDisplayName })}
                </div>
              ) : null}

              {row.requestText ? (
                <div className="walletServiceInfoBox">{row.requestText}</div>
              ) : row.description ? (
                <div className="walletServiceInfoBox">{row.description}</div>
              ) : null}

              {row.creatorScheduleNote ? (
                <div className="walletServiceInfoBox">
                  <strong>{tWallet("creatorInstructions")}</strong>{" "}
                  {row.creatorScheduleNote}
                </div>
              ) : null}

              {row.rejectionReason && !noShowMessage ? (
                <div className="walletServiceErrorBox">
                  {tWallet("motiveLabel", { motive: row.rejectionReason })}
                </div>
              ) : null}

              {row.refundReason ? (
                <div className="walletServiceWarningBox">
                  {tWallet("refundLabel", { reason: row.refundReason })}
                </div>
              ) : null}

              {isScheduledService &&
              row.status === "completed" &&
              row.recordingStatus != null &&
              row.recordingStatus !== "not_started" ? (
                <div className="walletSessionRecording" style={{ display: "grid", gap: 6 }}>
                  {row.recordingStatus === "recording" ||
                  row.recordingStatus === "processing" ? (
                    <div className="walletServiceWarningBox">
                      {tWallet("recordingProcessing")}
                    </div>
                  ) : row.recordingStatus === "ready" ? (
                    (() => {
                      const { expired, diffDays, dateLabel } = getRecordingExpiry(row.recordingExpiresAt ?? null, locale);
                      const availLabel = dateLabel
                        ? `${(diffDays ?? 0) <= 7 ? "⚠️ " : ""}${tWallet("recordingAvailableUntil", { date: dateLabel, count: diffDays ?? 0 })}`
                        : null;
                      return expired ? (
                        <div className="walletServiceErrorBox">
                          {tWallet("recordingExpired")}
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="walletPrimaryBtn"
                            disabled={downloadBusy}
                            style={{ opacity: downloadBusy ? 0.6 : undefined }}
                            onClick={async (e) => {
                              e.stopPropagation();
                              setDownloadBusy(true);
                              setDownloadError(null);
                              try {
                                const url = await callGetRecordingDownloadUrl({
                                  sessionId: row.id,
                                  sessionType: row.source as "meet_greet" | "exclusive_session",
                                });
                                window.location.href = url;
                              } catch {
                                setDownloadError(tWallet("downloadError"));
                              } finally {
                                setDownloadBusy(false);
                              }
                            }}
                          >
                            {downloadBusy ? tWallet("downloadFetching") : tWallet("downloadRecording")}
                            {!downloadBusy && row.recordingDurationSeconds
                              ? ` (${formatRecordingDuration(row.recordingDurationSeconds)})`
                              : ""}
                          </button>
                          {availLabel ? (
                            <div className="walletMiniMeta" style={{ color: "rgba(253,230,138,0.85)" }}>
                              {availLabel}
                            </div>
                          ) : null}
                          {downloadError ? (
                            <div className="walletServiceErrorBox">{downloadError}</div>
                          ) : null}
                        </>
                      );
                    })()
                  ) : row.recordingStatus === "failed" ? (
                    <div className="walletServiceErrorBox">
                      {tWallet("recordingFailed")}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {canAccept || canReject || canSchedule || canPrepare ? (
                <div className="walletServiceActions">
                  {canAccept ? (
                    <button
                      type="button"
                      className="walletPrimaryBtn"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isGreeting) {
                          void handleGreeting("accept");
                        } else {
                          void handleScheduledServiceAccept();
                        }
                      }}
                      disabled={busy}
                      style={{
                        opacity: busy ? 0.8 : 1,
                        cursor: busy ? "not-allowed" : "pointer",
                      }}
                    >
                      {busy ? tCommon("processing") : tCommon("accept")}
                    </button>
                  ) : null}

                  {canReject ? (
                    <button
                      type="button"
                      className="walletSecondaryBtn"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isGreeting) {
                          void handleGreeting("reject");
                        } else {
                          setRejectOpen((prev) => !prev);
                        }
                      }}
                      disabled={busy}
                      style={{
                        opacity: busy ? 0.7 : 1,
                        cursor: busy ? "not-allowed" : "pointer",
                      }}
                    >
                      {tCommon("reject")}
                    </button>
                  ) : null}

                  {canSchedule ? (
                    <button
                      type="button"
                      className="walletSecondaryBtn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setScheduleOpen((prev) => {
                          const next = !prev;

                          if (!next) {
                            setCalendarOpen(false);
                          }

                          return next;
                        });
                      }}
                      disabled={busy}
                      style={{
                        opacity: busy ? 0.7 : 1,
                        cursor: busy ? "not-allowed" : "pointer",
                      }}
                    >
                      {row.status === "accepted_pending_schedule"
                        ? tServices("setDate")
                        : tServices("proposeNewDate")}
                    </button>
                  ) : null}

                  {canPrepare ? (
                    <button
                      type="button"
                      className="walletPrimaryBtn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handlePrepare();
                      }}
                      disabled={busy}
                      style={{
                        opacity: busy ? 0.8 : 1,
                        cursor: busy ? "not-allowed" : "pointer",
                      }}
                    >
                      {busy ? tCommon("processing") : tServices("prepare")}
                    </button>
                  ) : null}
                </div>
              ) : null}
                            {rejectOpen ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder={tWallet("rejectReasonPlaceholder")}
                    className="walletField"
                    style={{ minHeight: 92, resize: "vertical" }}
                  />

                  <div className="walletServiceActions">
                    <button
                      type="button"
                      className="walletPrimaryBtn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleScheduledServiceReject();
                      }}
                      disabled={busy}
                      style={{
                        opacity: busy ? 0.8 : 1,
                        cursor: busy ? "not-allowed" : "pointer",
                      }}
                    >
                      {busy ? tCommon("processing") : tServices("confirmReject")}
                    </button>

                    <button
                      type="button"
                      className="walletSecondaryBtn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRejectOpen(false);
                      }}
                      disabled={busy}
                      style={{
                        opacity: busy ? 0.7 : 1,
                        cursor: busy ? "not-allowed" : "pointer",
                      }}
                    >
                      {tCommon("cancel")}
                    </button>
                  </div>
                </div>
              ) : null}

              {scheduleOpen ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <button
                    type="button"
                    className="walletSecondaryBtn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCalendarOpen(true);
                    }}
                    disabled={busy}
                    style={{
                      width: "fit-content",
                      opacity: busy ? 0.7 : 1,
                      cursor: busy ? "not-allowed" : "pointer",
                    }}
                  >
                    {tWallet("viewCalendar")}
                  </button>

                  <ScheduleDateTimeSelector
                    value={scheduleParts}
                    onChange={(nextParts) => {
                      setScheduleParts(nextParts);
                    }}
                    disabled={busy}
                  />

                  {scheduleConflict.message ? (
                    <div className="walletServiceErrorBox">
                      {scheduleConflict.message}
                    </div>
                  ) : null}

                  <textarea
                    value={scheduleNote}
                    onChange={(e) => setScheduleNote(e.target.value)}
                    placeholder={tWallet("scheduleBuyerMessagePlaceholder")}
                    className="walletField"
                    style={{ minHeight: 92, resize: "vertical" }}
                  />

                  <div className="walletServiceActions">
                    <button
                      type="button"
                      className="walletPrimaryBtn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleScheduledServiceSchedule();
                      }}
                      disabled={busy || scheduleConflict.hasConflict}
                      style={{
                        opacity: busy || scheduleConflict.hasConflict ? 0.55 : 1,
                        cursor:
                          busy || scheduleConflict.hasConflict
                            ? "not-allowed"
                            : "pointer",
                      }}
                    >
                      {busy ? tCommon("processing") : tServices("saveDate")}
                    </button>

                    <button
                      type="button"
                      className="walletSecondaryBtn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setScheduleOpen(false);
                        setCalendarOpen(false);
                      }}
                      disabled={busy}
                      style={{
                        opacity: busy ? 0.7 : 1,
                        cursor: busy ? "not-allowed" : "pointer",
                      }}
                    >
                      {tCommon("cancel")}
                    </button>
                  </div>

                  <ScheduleCalendarOverlay
                    open={calendarOpen}
                    title={tWallet("calendarTitle")}
                    items={calendarItems}
                    excludeId={row.id}
                    selectedDate={selectedScheduledAt}
                    conflictMessage={scheduleConflict.message}
                    onSelectDate={(date) => {
                      setScheduleParts(getSchedulePartsFromDate(date));
                    }}
                    onClose={() => setCalendarOpen(false)}
                    renderItem={(calendarRow) => (
                      <WalletServiceRow
                        row={calendarRow}
                        open={false}
                        calendarItems={calendarItems}
                        onToggle={() => {}}
                      />
                    )}
                    footer={
                      <div style={{ display: "grid", gap: 8 }}>
                        <ScheduleDateTimeSelector
                          value={scheduleParts}
                          onChange={(nextParts) => {
                            setScheduleParts(nextParts);
                          }}
                          disabled={busy}
                        />

                        {scheduleConflict.message ? (
                          <div className="walletServiceErrorBox">
                            {scheduleConflict.message}
                          </div>
                        ) : null}

                        <textarea
                          value={scheduleNote}
                          onChange={(e) => setScheduleNote(e.target.value)}
                          placeholder={tWallet("scheduleBuyerMessagePlaceholder")}
                          className="walletField"
                          style={{ minHeight: 92, resize: "vertical" }}
                        />

                        <div className="walletServiceActions">
                          <button
                            type="button"
                            className="walletPrimaryBtn"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleScheduledServiceSchedule();
                            }}
                            disabled={busy || scheduleConflict.hasConflict}
                            style={{
                              opacity:
                                busy || scheduleConflict.hasConflict ? 0.55 : 1,
                              cursor:
                                busy || scheduleConflict.hasConflict
                                  ? "not-allowed"
                                  : "pointer",
                            }}
                          >
                            {busy ? tCommon("processing") : tServices("saveDate")}
                          </button>

                          <button
                            type="button"
                            className="walletSecondaryBtn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCalendarOpen(false);
                            }}
                            disabled={busy}
                            style={{
                              opacity: busy ? 0.7 : 1,
                              cursor: busy ? "not-allowed" : "pointer",
                            }}
                          >
                            {tWallet("closeCalendar")}
                          </button>
                        </div>
                      </div>
                    }
                  />
                </div>
              ) : null}

              <VibraToast toast={walletRowToast} />
            </div>
          </div>
        ) : null}
      </div>

      {isScheduledService ? (
        <MeetGreetPreparationFullscreen
          open={preparationOpen}
          onClose={() => setPreparationOpen(false)}
          role="creator"
          sessionId={row.id}
          sessionType={isMeetGreet ? "meet_greet" : "exclusive_session"}
          scheduledAtLabel={row.scheduledAt ? getWalletServiceRowMeta(row) : null}
          durationMinutes={row.durationMinutes ?? null}
        />
      ) : null}
    </>
  );
}

export function WalletList({
  items,
  calendarItems,
  onRecord,
  onView,
  mode = "pending",
}: {
  items: WalletServiceItem[];
  calendarItems?: WalletServiceItem[];
  onRecord?: (row: WalletServiceItem) => void;
  onView?: (row: WalletServiceItem) => void;
  mode?: "pending" | "history";
}) {
  const [openRowKey, setOpenRowKey] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((row) => {
        const rowKey = `${row.source}-${row.id}`;
        const isOpen = openRowKey === rowKey;

        return (
          <WalletServiceRow
            key={rowKey}
            row={row}
            open={isOpen}
            calendarItems={calendarItems ?? items}
            onRecord={onRecord}
            onView={onView}
            mode={mode}
            onToggle={() =>
              setOpenRowKey((prev) => (prev === rowKey ? null : rowKey))
            }
          />
        );
      })}
    </div>
  );
}
function FilterIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M4 7h16" />
      <path d="M7 12h13" />
      <path d="M10 17h10" />
    </svg>
  );
}

export function WalletFilterMenu<T extends string>({
  label = "Filtro",
  menuLabel,
  value,
  options,
  onChange,
  allValue,
  transparent = false,
}: {
  label?: string;
  menuLabel: string;
  value: T[];
  options: Array<{ value: T; label: string; emoji?: string; color?: string }>;
  onChange: (value: T[]) => void;
  allValue: T;
  transparent?: boolean;
}) {
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [pending, setPending] = useState<T[]>(value);

  function openMenu() {
    setPending(value);
    setClosing(false);
    setOpen(true);
  }

  function toggleOption(opt: T) {
    if (opt === allValue) {
      setPending([allValue]);
      return;
    }
    setPending((prev) => {
      const withoutAll = prev.filter((v) => v !== allValue);
      const already = withoutAll.includes(opt);
      const next = already
        ? withoutAll.filter((v) => v !== opt)
        : [...withoutAll, opt];
      return next.length === 0 ? [allValue] : next;
    });
  }

  function closeMenu() {
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 150);
  }

  function handleAccept() {
    onChange(pending);
    closeMenu();
  }

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && open) closeMenu();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open]);

  const panel = open
    ? createPortal(
        <>
          <style jsx global>{`
            @keyframes vbFilterFadeIn {
              from { opacity: 0; }
              to   { opacity: 1; }
            }
            @keyframes vbFilterFadeOut {
              from { opacity: 1; }
              to   { opacity: 0; }
            }
            @keyframes vbFilterScaleIn {
              from { opacity: 0; transform: scale(0.88); }
              to   { opacity: 1; transform: scale(1); }
            }
            @keyframes vbFilterScaleOut {
              from { opacity: 1; transform: scale(1); }
              to   { opacity: 0; transform: scale(0.88); }
            }
            @keyframes vbFilterCirclePop {
              0%   { transform: scale(0.5); }
              65%  { transform: scale(1.3); }
              100% { transform: scale(1); }
            }
            @keyframes vbFilterCircleUnpop {
              0%   { transform: scale(1); }
              40%  { transform: scale(0.7); }
              100% { transform: scale(1); }
            }
          `}</style>

          {/* Backdrop */}
          <div
            onClick={closeMenu}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 99990,
              background: "rgba(0,0,0,0.50)",
              animation: closing
                ? "vbFilterFadeOut 0.15s ease forwards"
                : "vbFilterFadeIn 0.18s ease forwards",
            }}
          />

          {/* Panel wrapper */}
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 99991,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            {/* Panel */}
            <div
              role="menu"
              style={{
                pointerEvents: "auto",
                width: "min(300px, 88vw)",
                background: "rgba(8,9,11,0.985)",
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.10)",
                boxShadow:
                  "0 30px 90px rgba(0,0,0,0.56), 0 0 0 1px rgba(255,255,255,0.035)",
                backdropFilter: "blur(10px)",
                overflow: "hidden",
                animation: closing
                  ? "vbFilterScaleOut 0.15s ease forwards"
                  : "vbFilterScaleIn 0.18s ease forwards",
              }}
            >
              {/* Items */}
              {options.map((option, index) => {
                const isSelected = pending.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitem"
                    onClick={() => toggleOption(option.value)}
                    style={{
                      width: "100%",
                      border: "none",
                      borderTop:
                        index > 0
                          ? "1px solid rgba(255,255,255,0.06)"
                          : "none",
                      background: "transparent",
                      color: isSelected
                        ? (option.color ?? "#fff")
                        : (option.color ? option.color + "bb" : "rgba(255,255,255,0.72)"),
                      fontSize: 14,
                      fontWeight: isSelected ? 600 : 400,
                      textAlign: "left",
                      cursor: "pointer",
                      minHeight: 48,
                      padding: "11px 16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <span>{option.label}</span>

                    {/* Selection circle */}
                    <div
                      key={String(isSelected)}
                      style={{
                        flexShrink: 0,
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        border: isSelected
                          ? "none"
                          : "1.5px solid rgba(255,255,255,0.25)",
                        background: isSelected ? "#22c55e" : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        animation: isSelected
                          ? "vbFilterCirclePop 0.28s cubic-bezier(0.34,1.56,0.64,1) forwards"
                          : "vbFilterCircleUnpop 0.18s ease forwards",
                      }}
                    >
                      {isSelected ? (
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 12 12"
                          fill="none"
                        >
                          <path
                            d="M2 6L5 9L10 3"
                            stroke="#fff"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : null}
                    </div>
                  </button>
                );
              })}

              {/* Aceptar */}
              <div
                style={{
                  padding: "4px 16px 8px",
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <button
                  type="button"
                  onClick={handleAccept}
                  style={{
                    width: "100%",
                    border: "none",
                    borderRadius: 8,
                    background: "transparent",
                    color: "rgba(255,255,255,0.88)",
                    fontSize: 13,
                    fontWeight: 600,
                    padding: "7px 16px",
                    cursor: "pointer",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {tCommon("accept")}
                </button>
              </div>
            </div>
          </div>
        </>,
        document.body
      )
    : null;

  return (
    <>
      <style jsx>{`
        .filterButton {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border-radius: 12px;
          border: none;
          background: transparent;
          padding: 9px 12px;
          color: rgba(255, 255, 255, 0.88);
          font-size: 13px;
          font-weight: 600;
          line-height: 1;
          transition: background 0.18s ease;
          cursor: pointer;
        }

        .filterButton:hover {
          background: rgba(255, 255, 255, 0.06);
        }
      `}</style>

      <button
        type="button"
        className="filterButton"
        onClick={openMenu}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <FilterIcon />
        <span>{label}</span>
      </button>

      {panel}
    </>
  );
}