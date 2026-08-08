"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import VibraResponsivePanel from "@/components/ui/VibraResponsivePanel";
import {
  acceptConversationRequest,
  blockConversation,
  createConversationWithFirstMessage,
  rejectConversationRequest,
  reportConversation,
  unblockConversation,
  type MessageWithId,
} from "@/lib/chat/chatService";
import { useConversation } from "@/lib/chat/useConversation";
import { useConversationDoc } from "@/lib/chat/useConversationDoc";
import { MESSAGE_MAX_LENGTH } from "@/lib/chat/types";
import { REPORT_REASONS, type ReportReason } from "@/lib/moderation/types";
import type { ProfileMini } from "./ConversationList";

/**
 * Hilo de una conversación 1-a-1, sobre el panel canónico de Vibra
 * (pestaña inferior en celular, panel centrado en laptop).
 *
 * El scroll lo posee `VibraResponsivePanel`, así que aquí no se monta un
 * contenedor scrollable propio (anidar scrolls rompe el gesto de arrastre en
 * celular). En su lugar: un centinela arriba que dispara la carga del historial
 * al hacerse visible, y un ancla abajo a la que se hace `scrollIntoView`.
 *
 * Funciona en dos situaciones: con un hilo existente (desde el inbox) y en
 * BORRADOR, cuando aún no hay conversación (desde el botón de un perfil). En
 * borrador, el primer envío crea el hilo y el mensaje en un solo lote atómico.
 */

type TimestampLike = { toDate?: () => Date } | null | undefined;

function toDate(value: TimestampLike): Date | null {
  if (!value || typeof value.toDate !== "function") return null;
  const date = value.toDate();
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayKey(date: Date | null): string {
  if (!date) return "";
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Crece con el texto hasta el tope del CSS y luego scrollea. */
const INPUT_MAX_HEIGHT = 120;
function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_HEIGHT)}px`;
}

export default function ConversationPanel({
  open,
  onClose,
  conversationId,
  otherUid,
  profile,
  selfUid,
}: {
  open: boolean;
  onClose: () => void;
  /** ID determinista del hilo. Puede no existir todavía (modo borrador). */
  conversationId: string | null;
  /** Necesario para crear el hilo en el primer envío. */
  otherUid: string | null;
  profile: ProfileMini | undefined;
  selfUid: string | null;
}) {
  const tChat = useTranslations("chat");
  const tCommon = useTranslations("common");
  const locale = useLocale();

  const { conversation } = useConversationDoc(open ? conversationId : null);
  const exists = conversation != null;

  const { messages, loading, loadingOlder, hasMore, loadOlder, send } =
    useConversation(open && exists ? conversationId : null, selfUid);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportSent, setReportSent] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);

  const status = conversation?.status ?? null;
  const isBlocked = status === "blocked";
  const iBlocked = isBlocked && conversation?.blockedBy === selfUid;
  const isPendingRequest = status === "request";
  const iSentRequest = isPendingRequest && conversation?.createdBy === selfUid;
  const iReceivedRequest = isPendingRequest && conversation?.createdBy !== selfUid;
  const displayName = profile?.displayName || tCommon("user");

  // El input se muestra si puedo escribir: hilo nuevo, activo, o solicitud que
  // yo recibí pero ya acepté. Quien envió una solicitud pendiente NO puede
  // insistir — las rules lo rechazarían de todos modos.
  const canWrite = !isBlocked && !iSentRequest && !iReceivedRequest;

  useEffect(() => {
    const node = topSentinelRef.current;
    if (!node || !hasMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadOlder();
      },
      { threshold: 0.1 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, loadOlder]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.id === lastMessageIdRef.current) return;

    const isFirstPaint = lastMessageIdRef.current === null;
    lastMessageIdRef.current = last.id;
    bottomAnchorRef.current?.scrollIntoView({
      behavior: isFirstPaint ? "auto" : "smooth",
      block: "end",
    });
  }, [messages]);

  useEffect(() => {
    if (!open) {
      setDraft("");
      setError(null);
      setReporting(false);
      setReportSent(false);
      lastMessageIdRef.current = null;
    }
  }, [open]);

  async function handleSend() {
    const body = draft.trim();
    if (!body || sending || !canWrite || !selfUid) return;

    setSending(true);
    setError(null);
    try {
      if (exists) {
        await send(body);
      } else {
        if (!otherUid) throw new Error("missing-other");
        // Modo borrador: hilo + primer mensaje en un único lote.
        await createConversationWithFirstMessage(selfUid, otherUid, body);
      }
      setDraft("");
      if (inputRef.current) inputRef.current.style.height = "auto";
    } catch {
      setError(tChat("sendError"));
    } finally {
      setSending(false);
    }
  }

  async function runAction(action: () => Promise<void>, errorKey: string) {
    if (busyAction) return;
    setBusyAction(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(tChat(errorKey));
    } finally {
      setBusyAction(false);
    }
  }

  async function handleReport(reason: ReportReason) {
    if (!conversationId || !otherUid) return;
    await runAction(async () => {
      await reportConversation({
        conversationId,
        reportedUid: otherUid,
        reason,
      });
      setReportSent(true);
      setReporting(false);
    }, "reportError");
  }

  function renderMessage(message: MessageWithId, previous: MessageWithId | null) {
    const mine = message.senderId === selfUid;
    const date = toDate(message.createdAt as TimestampLike);
    const previousDate = previous ? toDate(previous.createdAt as TimestampLike) : null;
    const showDaySeparator = dayKey(date) !== dayKey(previousDate);

    const time = date
      ? new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date)
      : "";

    return (
      <div key={message.id}>
        {showDaySeparator && date ? (
          <div style={{ display: "flex", justifyContent: "center", margin: "14px 0 10px" }}>
            <span
              style={{
                fontSize: 10.5,
                color: "rgba(255,255,255,0.46)",
                background: "rgba(255,255,255,0.06)",
                padding: "3px 10px",
                borderRadius: 999,
                whiteSpace: "nowrap",
              }}
            >
              {new Intl.DateTimeFormat(locale, {
                day: "numeric",
                month: "long",
                ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
              }).format(date)}
            </span>
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            justifyContent: mine ? "flex-end" : "flex-start",
            marginTop: 4,
          }}
        >
          <div
            style={{
              maxWidth: "78%",
              padding: "8px 11px",
              // La esquina "pegada" al lado del emisor es lo que da la
              // direccionalidad del globo sin necesidad de una cola.
              borderRadius: mine ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
              background: mine ? "rgba(168,85,247,0.30)" : "rgba(255,255,255,0.07)",
              boxShadow: mine ? "inset 0 1px 0 rgba(255,255,255,0.06)" : "none",
              minWidth: 0,
            }}
          >
            <div
              style={{
                fontSize: 13.5,
                lineHeight: 1.4,
                color: message.isDeleted
                  ? "rgba(255,255,255,0.42)"
                  : "rgba(255,255,255,0.94)",
                fontStyle: message.isDeleted ? "italic" : "normal",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              {message.isDeleted ? tChat("messageDeleted") : message.text}
            </div>

            {time ? (
              <div
                style={{
                  marginTop: 3,
                  fontSize: 9.5,
                  lineHeight: 1,
                  textAlign: "right",
                  color: "rgba(255,255,255,0.42)",
                }}
              >
                {time}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const canSend = draft.trim().length > 0 && !sending && canWrite;

  const noticeStyle = {
    fontSize: 12,
    color: "rgba(255,255,255,0.62)",
    lineHeight: 1.4,
  } as const;

  const secondaryButtonStyle = {
    minHeight: 40,
    borderRadius: 8,
    border: "none",
    background: "rgba(255,255,255,0.10)",
    color: "#fff",
    fontSize: 14,
    fontWeight: 500,
    fontFamily: "inherit",
    cursor: busyAction ? "not-allowed" : "pointer",
    flex: 1,
  } as const;

  function renderFooter() {
    if (reporting) {
      return (
        <button
          type="button"
          onClick={() => setReporting(false)}
          style={{ ...secondaryButtonStyle, width: "100%" }}
        >
          {tCommon("cancel")}
        </button>
      );
    }

    if (isBlocked) {
      return (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={noticeStyle}>
            {iBlocked ? tChat("blockedByMeNotice") : tChat("blockedByThemNotice")}
          </div>
          {iBlocked ? (
            <button
              type="button"
              onClick={() => runAction(() => unblockConversation(conversationId!), "blockError")}
              disabled={busyAction}
              style={secondaryButtonStyle}
            >
              {tChat("unblock")}
            </button>
          ) : null}
        </div>
      );
    }

    if (iSentRequest) {
      return <div style={noticeStyle}>{tChat("requestPendingNotice")}</div>;
    }

    if (iReceivedRequest) {
      return (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={noticeStyle}>{tChat("requestReceivedNotice", { name: displayName })}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() =>
                runAction(() => acceptConversationRequest(conversationId!), "requestActionError")
              }
              disabled={busyAction}
              style={{
                ...secondaryButtonStyle,
                background: "#a855f7",
                fontWeight: 600,
              }}
            >
              {tChat("acceptRequest")}
            </button>
            <button
              type="button"
              onClick={() =>
                runAction(
                  () => rejectConversationRequest(conversationId!, selfUid!),
                  "requestActionError"
                )
              }
              disabled={busyAction}
              style={secondaryButtonStyle}
            >
              {tChat("rejectRequest")}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            autoGrow(e.currentTarget);
          }}
          onKeyDown={(e) => {
            // Enter envía; Shift+Enter salta de línea. En celular el teclado
            // manda su propio Enter, así que solo aplica con teclado físico.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          rows={1}
          maxLength={MESSAGE_MAX_LENGTH}
          placeholder={tChat("messagePlaceholder")}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 40,
            maxHeight: INPUT_MAX_HEIGHT,
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(255,255,255,0.05)",
            color: "#fff",
            fontSize: 14,
            fontFamily: "inherit",
            lineHeight: 1.35,
            resize: "none",
            outline: "none",
          }}
        />

        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          aria-label={tChat("send")}
          style={{
            flexShrink: 0,
            width: 40,
            height: 40,
            borderRadius: 999,
            border: "none",
            background: canSend ? "#a855f7" : "rgba(255,255,255,0.08)",
            color: canSend ? "#fff" : "rgba(255,255,255,0.34)",
            cursor: canSend ? "pointer" : "not-allowed",
            display: "grid",
            placeItems: "center",
            transition: "background 0.18s ease, color 0.18s ease",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
            <path
              d="M4 12L20 4L13.5 20L11.5 13.5L4 12Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    );
  }

  function renderContent() {
    if (reporting) {
      return (
        <div style={{ display: "grid", gap: 10, padding: "6px 0" }}>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.88)", fontWeight: 600 }}>
            {tChat("reportTitle")}
          </div>
          <div style={{ ...noticeStyle, marginBottom: 4 }}>{tChat("reportIntro")}</div>
          {REPORT_REASONS.map((reason) => (
            <button
              key={reason}
              type="button"
              onClick={() => handleReport(reason)}
              disabled={busyAction}
              style={{
                minHeight: 42,
                padding: "0 12px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.04)",
                color: "rgba(255,255,255,0.92)",
                fontSize: 13.5,
                fontFamily: "inherit",
                textAlign: "left",
                cursor: busyAction ? "not-allowed" : "pointer",
              }}
            >
              {tChat(`reportReason_${reason}`)}
            </button>
          ))}
        </div>
      );
    }

    return (
      <>
        {/* Acciones de seguridad del hilo, discretas y siempre a la vista. */}
        {exists && !isBlocked ? (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 12,
              paddingBottom: 6,
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              marginBottom: 4,
            }}
          >
            <button
              type="button"
              onClick={() =>
                runAction(() => blockConversation(conversationId!, selfUid!), "blockError")
              }
              disabled={busyAction}
              style={{
                border: "none",
                background: "transparent",
                color: "rgba(255,255,255,0.50)",
                fontSize: 11.5,
                fontFamily: "inherit",
                cursor: busyAction ? "not-allowed" : "pointer",
                padding: 0,
              }}
            >
              {tChat("block")}
            </button>
            <button
              type="button"
              onClick={() => setReporting(true)}
              disabled={busyAction || reportSent}
              style={{
                border: "none",
                background: "transparent",
                color: reportSent ? "rgba(255,255,255,0.34)" : "rgba(255,255,255,0.50)",
                fontSize: 11.5,
                fontFamily: "inherit",
                cursor: reportSent ? "default" : "pointer",
                padding: 0,
              }}
            >
              {reportSent ? tChat("reportSent") : tChat("report")}
            </button>
          </div>
        ) : null}

        {!exists || messages.length === 0 ? (
          <div
            style={{
              fontSize: 12.5,
              color: "rgba(255,255,255,0.52)",
              textAlign: "center",
              padding: "28px 12px",
              lineHeight: 1.5,
            }}
          >
            {loading && exists
              ? tChat("loadingMessages")
              : tChat("emptyThread", { name: displayName })}
          </div>
        ) : (
          <>
            <div ref={topSentinelRef} aria-hidden style={{ height: 1 }} />

            {loadingOlder ? (
              <div
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.46)",
                  textAlign: "center",
                  padding: "6px 0",
                }}
              >
                {tChat("loadingOlder")}
              </div>
            ) : null}

            {messages.map((message, index) =>
              renderMessage(message, index > 0 ? messages[index - 1] : null)
            )}

            <div ref={bottomAnchorRef} aria-hidden style={{ height: 1 }} />
          </>
        )}
      </>
    );
  }

  return (
    <VibraResponsivePanel
      open={open}
      onClose={onClose}
      title={displayName}
      subtitle={profile?.handle ? `@${profile.handle}` : undefined}
      closeAriaLabel={tCommon("close")}
      maxWidthDesktop={560}
      contentPadding="10px 14px"
      footer={
        <div style={{ display: "grid", gap: 8 }}>
          {error ? <div style={{ fontSize: 11.5, color: "#fca5a5" }}>{error}</div> : null}
          {renderFooter()}
        </div>
      }
    >
      {renderContent()}
    </VibraResponsivePanel>
  );
}
