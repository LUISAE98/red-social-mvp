"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import {
  acceptConversationRequest,
  blockConversation,
  createConversationWithFirstMessage,
  deleteMessageForEveryone,
  editMessage,
  hideMessageForMe,
  rejectConversationRequest,
  reportConversation,
  unblockConversation,
  type MessageWithId,
} from "@/lib/chat/chatService";
import { useConversation } from "@/lib/chat/useConversation";
import { useConversationDoc } from "@/lib/chat/useConversationDoc";
import { useDmImageUrls } from "@/lib/chat/useDmImageUrls";
import {
  MESSAGE_EDIT_WINDOW_MS,
  MESSAGE_MAX_LENGTH,
  type ChatImage,
} from "@/lib/chat/types";
import { uploadDirectMessageImage } from "@/lib/posts/image-upload";
import {
  VibraNavigationIcon,
  VibraNavigationIconsStyles,
} from "@/app/components/VibraServiceIcons/VibraNavigationIcons";
import { REPORT_REASONS, type ReportReason } from "@/lib/moderation/types";
import type { ProfileMini } from "./ConversationList";
import { ChatReveal, MessageThreadSkeleton } from "./ChatSkeletons";

/**
 * Hilo de conversación SIN chrome: solo el área de mensajes y el pie de acción.
 *
 * Se monta en dos sitios con presentaciones distintas — el dock anclado de
 * laptop y la página a pantalla completa de celular — así que no impone ni
 * cabecera ni contenedor: el que lo usa decide el marco.
 *
 * Funciona en dos situaciones: con un hilo existente y en BORRADOR, cuando aún
 * no hay conversación (al escribir desde un perfil). En borrador, el primer
 * envío crea el hilo y el mensaje en un solo lote atómico.
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

const INPUT_MAX_HEIGHT = 120;
function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_HEIGHT)}px`;
}

export default function ConversationThread({
  conversationId,
  otherUid,
  profile,
  selfUid,
  active = true,
  safeAreaBottom = false,
  onConversationCreated,
}: {
  /** ID determinista del hilo. Puede no existir todavía (modo borrador). */
  conversationId: string | null;
  /** Necesario para crear el hilo en el primer envío. */
  otherUid: string | null;
  profile: ProfileMini | undefined;
  selfUid: string | null;
  /** false cuando el hilo está minimizado: corta las suscripciones. */
  active?: boolean;
  /**
   * Reserva el safe-area inferior bajo el compositor. Solo lo quiere la pantalla
   * completa de celular; en la pestaña anclada de laptop no hay barra de sistema
   * debajo y esos 20px quedarían como hueco muerto.
   */
  safeAreaBottom?: boolean;
  onConversationCreated?: (conversationId: string) => void;
}) {
  const tChat = useTranslations("chat");
  const tCommon = useTranslations("common");
  const locale = useLocale();

  const { conversation } = useConversationDoc(active ? conversationId : null);
  const exists = conversation != null;

  const { messages, loading, loadingOlder, hasMore, loadOlder, send } = useConversation(
    active && exists ? conversationId : null,
    selfUid
  );

  const [draft, setDraft] = useState("");
  /** Imagen elegida y ya subida, esperando a enviarse. Una como mucho. */
  const [pendingImage, setPendingImage] = useState<ChatImage | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  /** Imagen abierta a tamaño completo. */
  const [lightbox, setLightbox] = useState<string | null>(null);
  /** Mensaje con el detalle (hora + acciones) desplegado. Solo uno a la vez. */
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null);
  /** Mensaje que se está editando; el compositor pasa a guardar en vez de enviar. */
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  function toggleExpanded(messageId: string) {
    setExpandedMessageId((prev) => (prev === messageId ? null : messageId));
  }

  async function runMessageAction(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
      setExpandedMessageId(null);
    } catch {
      setError(tChat("messageActionError"));
    }
  }

  const messageActionStyle = {
    border: "none",
    background: "transparent",
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    fontFamily: "inherit",
    cursor: "pointer",
    padding: 0,
  } as const;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportSent, setReportSent] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);

  // Rutas de todas las imágenes cargadas (miniaturas para el globo, originales
  // para el visor). Se firman de una sola vez.
  const imagePaths = useMemo(() => {
    const paths: string[] = [];
    for (const message of messages) {
      if (message.isDeleted || !message.image) continue;
      // Las de los primeros mensajes ya traen URL permanente y no se firman.
      if (message.image.thumbnailUrl || message.image.url) continue;
      paths.push(message.image.thumbnailPath, message.image.path);
    }
    if (pendingImage && !pendingImage.thumbnailUrl) {
      paths.push(pendingImage.thumbnailPath);
    }
    return paths;
  }, [messages, pendingImage]);

  const signedUrls = useDmImageUrls(conversationId, imagePaths);

  /** URL para pintar: la firmada, o la permanente si es un mensaje antiguo. */
  function imageUrl(image: ChatImage, variant: "thumb" | "full"): string | null {
    if (variant === "thumb") {
      return image.thumbnailUrl ?? signedUrls[image.thumbnailPath] ?? null;
    }
    return image.url ?? signedUrls[image.path] ?? null;
  }

  const status = conversation?.status ?? null;
  const isBlocked = status === "blocked";
  const iBlocked = isBlocked && conversation?.blockedBy === selfUid;
  const isPendingRequest = status === "request";
  const iSentRequest = isPendingRequest && conversation?.createdBy === selfUid;
  const iReceivedRequest = isPendingRequest && conversation?.createdBy !== selfUid;
  const displayName = profile?.displayName || tCommon("user");

  const canWrite = !isBlocked && !iSentRequest && !iReceivedRequest;

  // Historial al asomar el centinela superior.
  useEffect(() => {
    const node = topSentinelRef.current;
    if (!node || !hasMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadOlder();
      },
      { root: scrollRef.current, threshold: 0.1 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, loadOlder]);

  // Bajar al final cuando llega un mensaje nuevo (no al paginar hacia atrás).
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
    setDraft("");
    setError(null);
    setReporting(false);
    setReportSent(false);
    lastMessageIdRef.current = null;
  }, [conversationId]);

  async function handleSend() {
    const body = draft.trim();

    // En modo edición el compositor GUARDA en vez de enviar.
    if (editing) {
      if (!body || sending || !conversationId) return;
      setSending(true);
      setError(null);
      try {
        await editMessage(conversationId, editing.id, body);
        setEditing(null);
        setDraft("");
        if (inputRef.current) inputRef.current.style.height = "auto";
      } catch {
        setError(tChat("messageActionError"));
      } finally {
        setSending(false);
      }
      return;
    }

    // Con imagen el texto es opcional: la imagen sola ya es un mensaje.
    if ((!body && !pendingImage) || sending || uploadingImage || !canWrite || !selfUid) return;

    setSending(true);
    setError(null);
    try {
      if (exists) {
        await send(body, pendingImage);
      } else {
        if (!otherUid) throw new Error("missing-other");
        const createdId = await createConversationWithFirstMessage(
          selfUid,
          otherUid,
          body,
          pendingImage
        );
        onConversationCreated?.(createdId);
      }
      setDraft("");
      setPendingImage(null);
      if (inputRef.current) inputRef.current.style.height = "auto";
    } catch {
      setError(tChat("sendError"));
    } finally {
      setSending(false);
    }
  }

  /**
   * Sube la imagen al elegirla, no al enviar: así el envío es instantáneo y los
   * fallos de subida se ven en el momento, con el mensaje todavía sin mandar.
   *
   * El hilo puede no existir aún (modo borrador). El path de Storage usa el ID
   * determinista de la conversación, que ya se conoce antes de crearla.
   */
  async function handlePickImage(file: File | null | undefined) {
    if (!file || !conversationId || uploadingImage) return;

    setUploadingImage(true);
    setError(null);
    try {
      const uploaded = await uploadDirectMessageImage({ conversationId, file });
      setPendingImage(uploaded);
    } catch {
      setError(tChat("imageUploadError"));
    } finally {
      setUploadingImage(false);
      // Permite volver a elegir el MISMO fichero tras quitarlo.
      if (fileInputRef.current) fileInputRef.current.value = "";
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
      await reportConversation({ conversationId, reportedUid: otherUid, reason });
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

    const expanded = expandedMessageId === message.id;
    // Editar y retirar caducan a los 10 minutos. Si el mensaje aún no tiene
    // `createdAt` del servidor (escritura optimista), se considera reciente.
    const withinWindow = !date || Date.now() - date.getTime() < MESSAGE_EDIT_WINDOW_MS;

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
          {/* Todo el globo es el disparador del detalle. No es un <button> para
              no anidarlo con el de la imagen; se le da rol y teclado a mano. */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => toggleExpanded(message.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleExpanded(message.id);
              }
            }}
            style={{
              cursor: "pointer",
              maxWidth: "78%",
              padding: "8px 11px",
              // La esquina "pegada" al lado del emisor da la direccionalidad del
              // globo sin necesidad de una cola.
              borderRadius: mine ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
              background: mine ? "rgba(168,85,247,0.30)" : "rgba(255,255,255,0.07)",
              boxShadow: mine ? "inset 0 1px 0 rgba(255,255,255,0.06)" : "none",
              minWidth: 0,
            }}
          >
            {!message.isDeleted && message.image && imageUrl(message.image, "thumb") ? (
              <button
                type="button"
                onClick={(e) => {
                  // No debe desplegar también el detalle del mensaje.
                  e.stopPropagation();
                  setLightbox(message.image ? imageUrl(message.image, "full") : null);
                }}
                aria-label={tChat("openImage")}
                style={{
                  display: "block",
                  padding: 0,
                  border: "none",
                  background: "none",
                  cursor: "zoom-in",
                  borderRadius: 10,
                  overflow: "hidden",
                  marginBottom: message.text ? 6 : 0,
                  lineHeight: 0,
                }}
              >
                {/* <img> y no next/image: la URL de Storage lleva token y las
                    dimensiones las decide el propio archivo. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl(message.image, "thumb") ?? undefined}
                  alt=""
                  style={{
                    display: "block",
                    maxWidth: "100%",
                    maxHeight: 260,
                    width: "auto",
                    height: "auto",
                    borderRadius: 10,
                  }}
                />
              </button>
            ) : null}

            {message.isDeleted || message.text ? (
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
            ) : null}

            {message.editedAt && !message.isDeleted ? (
              <span
                style={{
                  fontSize: 10,
                  color: "rgba(255,255,255,0.42)",
                  marginLeft: 6,
                }}
              >
                {tChat("edited")}
              </span>
            ) : null}
          </div>
        </div>

        {/* Detalle desplegado FUERA del globo: hora y acciones. */}
        {expanded ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: mine ? "flex-end" : "flex-start",
              gap: 4,
              marginTop: 4,
              paddingBottom: 2,
            }}
          >
            <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.45)" }}>
              {time}
            </span>

            {!message.isDeleted ? (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 10,
                  justifyContent: mine ? "flex-end" : "flex-start",
                }}
              >
                <button
                  type="button"
                  onClick={() => runMessageAction(() => hideMessageForMe(conversationId!, message.id, selfUid!))}
                  style={messageActionStyle}
                >
                  {tChat("deleteForMe")}
                </button>

                {/* Retirar y editar solo el autor, y solo dentro de la ventana
                    de 10 minutos: pasado ese punto las rules lo rechazan, así
                    que ni se ofrecen. */}
                {mine && withinWindow ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        runMessageAction(() =>
                          deleteMessageForEveryone(conversationId!, message.id)
                        )
                      }
                      style={messageActionStyle}
                    >
                      {tChat("deleteForEveryone")}
                    </button>

                    {message.text ? (
                      <button
                        type="button"
                        onClick={() => {
                          setEditing({ id: message.id, text: message.text });
                          setDraft(message.text);
                          setExpandedMessageId(null);
                          inputRef.current?.focus();
                        }}
                        style={messageActionStyle}
                      >
                        {tChat("editMessage")}
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  const canSend =
    (draft.trim().length > 0 || !!pendingImage) && !sending && !uploadingImage && canWrite;

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
              style={{ ...secondaryButtonStyle, background: "#a855f7", fontWeight: 600 }}
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

    // Mismo compositor que el chat de los lives: campo sin borde con la flecha
    // morada rellena DENTRO, a la derecha, sin contenedor propio. A la
    // izquierda, el clip verde de adjuntar del compositor de publicaciones.
    return (
      <div style={{ display: "grid", gap: 8 }}>
        <VibraNavigationIconsStyles />

        {/* Barra de edición: deja claro que lo que escribes reemplaza a un
            mensaje ya enviado, en vez de mandar uno nuevo. */}
        {editing ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11.5,
              color: "rgba(255,255,255,0.6)",
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>{tChat("editingMessage")}</span>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setDraft("");
                if (inputRef.current) inputRef.current.style.height = "auto";
              }}
              style={{ ...messageActionStyle, color: "#a855f7", fontWeight: 600 }}
            >
              {tCommon("cancel")}
            </button>
          </div>
        ) : null}

        {/* Previsualización de la imagen elegida, con su X para quitarla. */}
        {pendingImage || uploadingImage ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {pendingImage ? (
              <div style={{ position: "relative", lineHeight: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl(pendingImage, "thumb") ?? undefined}
                  alt=""
                  style={{
                    width: 54,
                    height: 54,
                    objectFit: "cover",
                    borderRadius: 10,
                    display: "block",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setPendingImage(null)}
                  aria-label={tChat("removeImage")}
                  style={{
                    position: "absolute",
                    top: -6,
                    right: -6,
                    width: 20,
                    height: 20,
                    borderRadius: 999,
                    border: "none",
                    background: "rgba(0,0,0,0.78)",
                    color: "#fff",
                    cursor: "pointer",
                    display: "grid",
                    placeItems: "center",
                    padding: 0,
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden>
                    <path
                      d="M6 6L18 18M18 6L6 18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            ) : (
              <div
                style={{
                  fontSize: 11.5,
                  color: "rgba(255,255,255,0.5)",
                }}
              >
                {tChat("uploadingImage")}
              </div>
            )}
          </div>
        ) : null}

        <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.heic,.heif"
            hidden
            onChange={(e) => handlePickImage(e.target.files?.[0])}
          />

          <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
        <textarea
          ref={inputRef}
          className="vibra-chat-ph"
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
            width: "100%",
            boxSizing: "border-box",
            minHeight: 40,
            maxHeight: INPUT_MAX_HEIGHT,
            // El padding derecho deja el hueco de la flecha.
            padding: "10px 42px 10px 12px",
            borderRadius: 12,
            border: "none",
            background: "rgba(255,255,255,0.06)",
            color: "#fff",
            fontSize: 13,
            fontFamily: "inherit",
            lineHeight: 1.5,
            resize: "none",
            outline: "none",
            display: "block",
          }}
        />

        {/* Anclada abajo, no centrada: al crecer el campo la flecha se queda
            junto a la última línea, que es donde está el cursor. */}
        <div style={{ position: "absolute", right: 6, bottom: 8 }}>
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label={tChat("send")}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: canSend ? "pointer" : "default",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "opacity 0.15s ease",
            }}
          >
            <svg
              width="23"
              height="23"
              viewBox="0 0 24 24"
              fill="#a855f7"
              stroke="#a855f7"
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              style={{ transform: "rotate(-20deg)" }}
              aria-hidden="true"
            >
              <path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
            </svg>
          </button>
            </div>
          </div>

          {/* A la derecha del campo, como los botones extra del chat de lives. */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            // Una imagen por mensaje: con una elegida, el botón se apaga.
            disabled={!!pendingImage || uploadingImage || sending}
            aria-label={tChat("attachImage")}
            style={{
              flexShrink: 0,
              width: 34,
              height: 40,
              border: "none",
              background: "none",
              padding: 0,
              display: "grid",
              placeItems: "center",
              cursor: pendingImage || uploadingImage ? "not-allowed" : "pointer",
              opacity: pendingImage || uploadingImage ? 0.4 : 1,
            }}
          >
            <VibraNavigationIcon type="attachMedia" size={24} />
          </button>
        </div>
      </div>
    );
  }

  function renderBody() {
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

        {loading && exists ? (
          <MessageThreadSkeleton />
        ) : !exists || messages.length === 0 ? (
          <div
            style={{
              fontSize: 12.5,
              color: "rgba(255,255,255,0.52)",
              textAlign: "center",
              padding: "28px 12px",
              lineHeight: 1.5,
            }}
          >
            {tChat("emptyThread", { name: displayName })}
          </div>
        ) : (
          <ChatReveal show>
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
          </ChatReveal>
        )}
      </>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        // Ancla del visor de imagen, que se posiciona sobre el hilo.
        position: "relative",
      }}
    >
      {/* Global, igual que en el chat de los lives: esa regla solo existe
          mientras hay una transmisión abierta, así que aquí hace falta la
          propia. El valor es el mismo para que el placeholder se vea idéntico. */}
      <style jsx global>{`
        .vibra-chat-ph::placeholder {
          color: rgba(255, 255, 255, 0.32);
        }
      `}</style>

      <div
        ref={scrollRef}
        style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "10px 14px" }}
      >
        {renderBody()}
      </div>

      <div
        style={{
          flexShrink: 0,
          // Sin divisor ni fondo propio: el compositor no es una barra aparte,
          // parece flotar sobre la conversación. El único elemento con relleno
          // visible es el campo de texto.
          background: "transparent",
          padding: safeAreaBottom
            ? "12px 14px calc(12px + var(--vb-safe-bottom, 0px))"
            : "12px 14px",
          display: "grid",
          gap: 8,
        }}
      >
        {error ? <div style={{ fontSize: 11.5, color: "#fca5a5" }}>{error}</div> : null}
        {renderFooter()}
      </div>

      {/* Visor a tamaño completo. Cubre el hilo entero (no la app), así sirve
          igual en la pestaña de laptop que en la página de celular. */}
      {lightbox ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setLightbox(null)}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 5,
            background: "rgba(0,0,0,0.92)",
            display: "grid",
            placeItems: "center",
            padding: 12,
            cursor: "zoom-out",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt=""
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
          />
        </div>
      ) : null}
    </div>
  );
}
