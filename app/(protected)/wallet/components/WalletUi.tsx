"use client";

import { useEffect, useRef, useState } from "react";
import {
  formatWalletMoney,
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

import ScheduleDateTimeSelector, {
  getSchedulePartsFromDate,
  schedulePartsToIso,
  type ScheduleParts,
} from "./ScheduleDateTimeSelector";
import ScheduleCalendarOverlay from "./ScheduleCalendarOverlay";

function getServiceEmoji(row: WalletServiceItem): string {
  if (row.status === "rejected" || row.status === "cancelled") {
    return "❌";
  }

  if (row.status === "refund_requested" || row.status === "refund_review") {
    return "💸";
  }

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
  if (row.status === "rejected" || row.status === "cancelled") {
    return "danger";
  }

  if (row.status === "refund_requested" || row.status === "refund_review") {
    return "warning";
  }

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

function getNoShowMessage(row: WalletServiceItem): string | null {
  if (!row.rejectionReason) return null;

  const lower = row.rejectionReason.toLowerCase();

  if (lower.includes("comprador") || lower.includes("buyer")) {
    return "El comprador no se conectó dentro de los 15 minutos de tolerancia.";
  }

  if (lower.includes("creador") || lower.includes("creator")) {
    return "El creador no se conectó dentro de los 15 minutos de tolerancia.";
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

export function WalletCard({
  title,
  description,
  headerRight,
  children,
}: {
  title: string;
  description?: string;
  headerRight?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <>
      <style jsx>{`
        .card {
          border-radius: 22px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.05) 0%,
            rgba(255, 255, 255, 0.025) 100%
          );
          padding: 18px;
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.16);
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
        <div className="cardHeader">
          <div className="cardHeaderMain">
            <h2 className="cardTitle">{title}</h2>
            {description ? <p className="cardDescription">{description}</p> : null}
          </div>

          {headerRight ? <div className="cardHeaderRight">{headerRight}</div> : null}
        </div>

        {children ? <div className="cardBody">{children}</div> : null}
      </div>
    </>
  );
}

export function WalletErrorBox({
  message,
}: {
  message: string;
}) {
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

function buildRowSubtitle(row: WalletServiceItem): string {
  const chunks: string[] = [];

  if (row.groupName) {
    chunks.push(row.groupName);
  }

  chunks.push(row.statusLabel);

  if (row.targetName) {
    chunks.push(`Para ${row.targetName}`);
  }

  if (row.buyerDisplayName) {
    chunks.push(`Comprador: ${row.buyerDisplayName}`);
  }

  if (row.priceSnapshot != null) {
    chunks.push(formatWalletMoney(row.priceSnapshot));
  }

  const noShowMessage = getNoShowMessage(row);

  if (noShowMessage) {
    chunks.push(`Motivo: ${noShowMessage}`);
  } else if (row.rejectionReason) {
    chunks.push(`Motivo: ${row.rejectionReason}`);
  }

  if (row.refundReason) {
    chunks.push(`Devolución: ${row.refundReason}`);
  }

  return chunks.join(" · ");
}

export function WalletServiceRow({
  row,
  open,
  onToggle,
  calendarItems = [],
}: {
  row: WalletServiceItem;
  open: boolean;
  onToggle: () => void;
  calendarItems?: WalletServiceItem[];
}) {


  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [preparationOpen, setPreparationOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [scheduleNote, setScheduleNote] = useState(row.creatorScheduleNote ?? "");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [scheduleParts, setScheduleParts] = useState<ScheduleParts>(
    getSchedulePartsFromDate(row.scheduledAt)
  );

    useEffect(() => {
    setScheduleParts(getSchedulePartsFromDate(row.scheduledAt));
    setScheduleNote(row.creatorScheduleNote ?? "");
  }, [row.scheduledAt, row.creatorScheduleNote]);

  const statusTone = getStatusTone(row);
  const subtitle = buildRowSubtitle(row);
  const meta = getWalletServiceRowMeta(row);
  const emoji = getServiceEmoji(row);

  const isGreeting = row.source === "greeting";
  const isMeetGreet = row.source === "meet_greet";
  const isExclusiveSession = row.source === "exclusive_session";
  const isScheduledService = isMeetGreet || isExclusiveSession;
  const noShowExpired =
    isScheduledService &&
    !row.preparingCreatorAt &&
    isNoShowExpired(row.scheduledAt);
  const noShowMessage = getNoShowMessage(row);

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
    setError(null);
    setSuccess(null);

    try {
      await respondGreetingRequest({
        requestId: row.id,
        action,
      });

      setSuccess(
        action === "accept"
          ? "✅ Solicitud aceptada."
          : "✅ Solicitud rechazada."
      );
    } catch (e: any) {
      setError(e?.message ?? "No se pudo actualizar la solicitud.");
    } finally {
      setBusy(false);
    }
  }

  async function handleScheduledServiceAccept() {
    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      if (isExclusiveSession) {
        await acceptExclusiveSessionRequest({ requestId: row.id });
        setSuccess("✅ Sesión exclusiva aceptada. Ahora puedes poner fecha.");
      } else {
        await acceptMeetGreetRequest({ requestId: row.id });
        setSuccess("✅ Meet & Greet aceptado. Ahora puedes poner fecha.");
      }

      setScheduleOpen(true);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo aceptar la solicitud.");
    } finally {
      setBusy(false);
    }
  }

  async function handleScheduledServiceReject() {
    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      if (isExclusiveSession) {
        await rejectExclusiveSessionRequest({
          requestId: row.id,
          rejectionReason: rejectReason || null,
        });
        setSuccess("✅ Sesión exclusiva rechazada.");
      } else {
        await rejectMeetGreetRequest({
          requestId: row.id,
          rejectionReason: rejectReason || null,
        });
        setSuccess("✅ Meet & Greet rechazado.");
      }

      setRejectOpen(false);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo rechazar la solicitud.");
    } finally {
      setBusy(false);
    }
  }

  async function handleScheduledServiceSchedule() {
  const scheduledAt = schedulePartsToIso(scheduleParts);

  if (!scheduledAt) {
    setError("Selecciona día, mes, año, hora y minuto.");
    return;
  }

  setBusy(true);
  setError(null);
  setSuccess(null);

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

    setSuccess("✅ Fecha guardada correctamente.");
    setScheduleOpen(false);
    setCalendarOpen(false);
  } catch (e: any) {
    setError(e?.message ?? "No se pudo guardar la fecha.");
  } finally {
    setBusy(false);
  }
}

  async function handlePrepare() {
    setBusy(true);
    setError(null);
    setSuccess(null);

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
      setSuccess(null);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo abrir la preparación.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <style jsx>{`
        .walletServiceCard {
          border-radius: 18px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.03);
          overflow: hidden;
          transition:
            border-color 0.18s ease,
            background 0.18s ease,
            box-shadow 0.18s ease;
        }

        .walletServiceCardOpen {
          border-color: rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.045);
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.14);
        }

        .walletServiceHeader {
          width: 100%;
          background: transparent;
          border: none;
          padding: 14px 15px;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          text-align: left;
          cursor: pointer;
        }

        .walletServiceMain {
          min-width: 0;
          flex: 1;
          display: grid;
          gap: 6px;
        }

        .walletServiceTopRow {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          flex-wrap: wrap;
        }

        .walletServiceEmoji {
          font-size: 16px;
          line-height: 1;
          flex-shrink: 0;
        }

        .walletServiceTitle {
          font-size: 14px;
          font-weight: 700;
          line-height: 1.3;
          letter-spacing: -0.01em;
          color: #fff;
        }

        .walletServiceSubline {
          color: rgba(255, 255, 255, 0.68);
          font-size: 12px;
          line-height: 1.5;
          white-space: pre-wrap;
        }

        .walletServiceSublineDanger {
          color: #fca5a5;
          font-size: 12px;
          line-height: 1.5;
          white-space: pre-wrap;
        }

        .walletServiceSublineWarning {
          color: #fde68a;
          font-size: 12px;
          line-height: 1.5;
          white-space: pre-wrap;
        }

        .walletServiceRight {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }

        .walletServiceMeta {
          border-radius: 999px;
          padding: 7px 10px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.10);
          color: rgba(255, 255, 255, 0.82);
          font-size: 11px;
          font-weight: 500;
          line-height: 1;
        }

        .walletChevron {
          color: rgba(255, 255, 255, 0.64);
          font-size: 14px;
          line-height: 1;
        }

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
          border: 1px solid rgba(255, 255, 255, 0.10);
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
          border: 1px solid rgba(255, 255, 255, 0.10);
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

        @media (max-width: 900px) {
          .walletServiceHeader {
            flex-direction: column;
            align-items: flex-start;
          }

          .walletServiceRight {
            width: 100%;
            justify-content: space-between;
          }
        }
      `}</style>

      <div className={`walletServiceCard ${open ? "walletServiceCardOpen" : ""}`}>
        <button type="button" className="walletServiceHeader" onClick={onToggle}>
          <div className="walletServiceMain">
            <div className="walletServiceTopRow">
              <span className="walletServiceEmoji">{emoji}</span>
              <div className="walletServiceTitle">{row.title}</div>
            </div>

            <div
              className={
                statusTone === "danger"
                  ? "walletServiceSublineDanger"
                  : statusTone === "warning"
                    ? "walletServiceSublineWarning"
                    : "walletServiceSubline"
              }
            >
              {subtitle}
            </div>
          </div>

          <div className="walletServiceRight">
            <div className="walletServiceMeta">{meta}</div>
            <div className="walletChevron">{open ? "▴" : "▾"}</div>
          </div>
        </button>

        {open ? (
          <div className="walletServiceBody">
            <div className="walletServiceBodyInner">
              <div className="walletServiceChip">{row.statusLabel}</div>

              {row.priceSnapshot != null ? (
                <div className="walletMiniMeta">
                  Precio: {formatWalletMoney(row.priceSnapshot)}
                </div>
              ) : null}

              {row.durationMinutes != null ? (
                <div className="walletMiniMeta">
                  Duración: {row.durationMinutes} min
                </div>
              ) : null}

              {isScheduledService &&
              isStartingSoon(row.scheduledAt) &&
              !isNoShowExpired(row.scheduledAt) ? (
                <div className="walletServiceWarningBox">
                  ⚠️ Este servicio está próximo a iniciar.
                </div>
              ) : null}

              {isScheduledService &&
              row.status !== "rejected" &&
              noShowExpired ? (
                <div className="walletServiceErrorBox">
                  Este servicio ya superó los 15 minutos de tolerancia. Se actualizará como rechazado automáticamente.
                </div>
              ) : null}

              {isScheduledService && row.status === "rejected" && noShowMessage ? (
                <div className="walletServiceErrorBox">{noShowMessage}</div>
              ) : null}

              {row.targetName ? (
                <div className="walletMiniMeta">Para: {row.targetName}</div>
              ) : null}

              {row.buyerDisplayName ? (
                <div className="walletMiniMeta">
                  Comprador: {row.buyerDisplayName}
                </div>
              ) : null}

              {row.requestText ? (
  <div className="walletServiceInfoBox">{row.requestText}</div>
) : row.description ? (
  <div className="walletServiceInfoBox">{row.description}</div>
) : null}

{row.creatorScheduleNote ? (
  <div className="walletServiceInfoBox">
    <strong>Instrucciones del creador:</strong> {row.creatorScheduleNote}
  </div>
) : null}

              {row.rejectionReason && !noShowMessage ? (
                <div className="walletServiceErrorBox">
                  Motivo: {row.rejectionReason}
                </div>
              ) : null}

              {row.refundReason ? (
                <div className="walletServiceWarningBox">
                  Devolución: {row.refundReason}
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
                      {busy ? "Procesando..." : "Aceptar"}
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
                      Rechazar
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
      ? "Poner fecha"
      : "Proponer nueva fecha"}
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
                      {busy ? "Procesando..." : "Prepararse"}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {rejectOpen ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Explica por qué rechazas la solicitud."
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
                      {busy ? "Procesando..." : "Confirmar rechazo"}
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
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : null}

                                         {scheduleOpen ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <ScheduleDateTimeSelector
  value={scheduleParts}
  onChange={setScheduleParts}
  disabled={busy}
/>

<textarea
  value={scheduleNote}
  onChange={(e) => setScheduleNote(e.target.value)}
  placeholder="Mensaje o instrucciones para el comprador sobre esta fecha."
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
    disabled={busy}
    style={{
      opacity: busy ? 0.8 : 1,
      cursor: busy ? "not-allowed" : "pointer",
    }}
  >
    {busy ? "Procesando..." : "Guardar fecha"}
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
    Cancelar
  </button>
</div>
                </div>
              ) : null}

              {error ? <div className="walletServiceErrorBox">{error}</div> : null}
              {success ? (
                <div className="walletServiceSuccessBox">{success}</div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {isScheduledService ? (
        <MeetGreetPreparationFullscreen
          open={preparationOpen}
          onClose={() => setPreparationOpen(false)}
          role="creator"
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
}: {
  items: WalletServiceItem[];
  calendarItems?: WalletServiceItem[];
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
}: {
  label?: string;
  menuLabel: string;
  value: T;
  options: Array<{ value: T; label: string; emoji?: string }>;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <>
      <style jsx>{`
        .filterWrapper {
          position: relative;
        }

        .filterButton {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.05);
          padding: 9px 12px;
          color: rgba(255, 255, 255, 0.88);
          font-size: 13px;
          font-weight: 600;
          line-height: 1;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.16);
          transition:
            background 0.18s ease,
            border-color 0.18s ease;
        }

        .filterButton:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.2);
        }

        .filterMenu {
          position: absolute;
          right: 0;
          top: calc(100% + 8px);
          z-index: 30;
          width: 240px;
          overflow: hidden;
          border-radius: 18px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: #121212;
          box-shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
        }

        .filterMenuHeader {
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          padding: 11px 12px;
          color: rgba(255, 255, 255, 0.52);
          font-size: 11px;
          font-weight: 700;
          line-height: 1;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .filterMenuBody {
          padding: 8px;
        }

        .filterMenuItem {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          border: none;
          background: transparent;
          border-radius: 12px;
          padding: 10px 12px;
          color: rgba(255, 255, 255, 0.82);
          font-size: 13px;
          font-weight: 500;
          text-align: left;
          transition: background 0.18s ease, color 0.18s ease;
        }

        .filterMenuItem:hover {
          background: rgba(255, 255, 255, 0.06);
          color: #fff;
        }

        .filterMenuItemActive {
          background: #ffffff;
          color: #000000;
        }

        .filterMenuItemActive:hover {
          background: #ffffff;
          color: #000000;
        }

        .filterMenuItemLeft {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .filterMenuEmoji {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          flex-shrink: 0;
          font-size: 14px;
          line-height: 1;
        }

        .filterMenuStatus {
          font-size: 11px;
          font-weight: 700;
          line-height: 1;
          opacity: 0.72;
        }
      `}</style>

      <div ref={wrapperRef} className="filterWrapper">
        <button
          type="button"
          className="filterButton"
          onClick={() => setOpen((prev) => !prev)}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <FilterIcon />
          <span>{label}</span>
        </button>

        {open ? (
          <div className="filterMenu" role="menu">
            <div className="filterMenuHeader">{menuLabel}</div>

            <div className="filterMenuBody">
              {options.map((option) => {
                const isActive = option.value === value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className={`filterMenuItem ${isActive ? "filterMenuItemActive" : ""}`}
                  >
                    <span className="filterMenuItemLeft">
                      {option.emoji ? (
                        <span className="filterMenuEmoji">{option.emoji}</span>
                      ) : null}
                      <span>{option.label}</span>
                    </span>

                    {isActive ? (
                      <span className="filterMenuStatus">Activo</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
