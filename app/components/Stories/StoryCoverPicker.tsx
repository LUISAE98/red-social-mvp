"use client";

import Image from "next/image";
import { AvatarRing, medidaAroEnCaja } from "@/components/ui/AvatarRing";
import { useEffect, useRef, useState } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";
import {
  addStoryFromGreeting,
  deleteStory,
  setStoryHiddenFromReel,
} from "@/lib/stories/storyService";
import { refreshReelFeed } from "@/lib/reels/reelFeedRefresh";
import { useDragScroll } from "@/lib/hooks/useDragScroll";
import {
  usePublishableGreetings,
  type PublishableGreeting,
} from "@/lib/stories/usePublishableGreetings";
import type { StoryDoc, StoryType } from "@/lib/stories/types";
import { IMAGE_CACHE_CONTROL } from "@/lib/storage/cacheControl";

const fontStack =
  'inherit';

type Props = {
  stories: StoryDoc[];
  type: StoryType;
  entityId: string;
  entityType: "profile" | "group";
  /** Uid de quien está usando el panel. En perfil coincide con `entityId`. */
  currentUserId: string;
  /**
   * Qué se lista. "creator" = lo que grabaste; "buyer" = lo que compraste;
   * "both" = todo lo publicable, que es como entra desde el círculo con `+`.
   */
  role?: "creator" | "buyer" | "both";
  currentCoverStoryId: string | null;
  currentCustomPhotoUrl: string | null;
  uploadStoragePath: string;
  onSelectStory: (storyId: string | null) => Promise<void>;
  onUploadPhoto: (url: string) => Promise<void>;
  onClose: () => void;
};

function storyThumb(story: StoryDoc): string | null {
  if (story.muxPlaybackId)
    return `https://image.mux.com/${story.muxPlaybackId}/thumbnail.jpg?time=0`;
  return story.thumbnailUrl ?? null;
}

const CIRCLE_SIZE = 60;
const RING_SIZE = CIRCLE_SIZE + 5; // 2.5px ring padding each side

/** La foto, una vez descontado lo que ocupa el aro. */
const FOTO = medidaAroEnCaja(RING_SIZE).foto;

// La caja que ancla al aro. El aro en sí lo pinta <AvatarRing>.
const ringWrap: React.CSSProperties = {
  width: RING_SIZE,
  height: RING_SIZE,
  borderRadius: "50%",
  position: "relative",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

// Inner button — the actual circle content
const innerBtn: React.CSSProperties = {
  width: FOTO,
  height: FOTO,
  borderRadius: "50%",
  overflow: "hidden",
  background: "#111118",
  cursor: "pointer",
  padding: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexDirection: "column",
  boxSizing: "border-box",
};

const actionBtnStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: "5px 10px",
  borderRadius: 8,
  fontSize: 12,
  fontFamily: fontStack,
  fontWeight: 500,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export default function StoryCoverPicker({
  stories,
  type,
  entityId,
  entityType,
  currentUserId,
  role = "creator",
  currentCoverStoryId,
  currentCustomPhotoUrl,
  uploadStoragePath,
  onSelectStory,
  onUploadPhoto,
  onClose,
}: Props) {
  const tCommon = useTranslations("common");
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  // Historias quitadas en esta sesión del panel, por `greetingRequestId`. Se
  // conservan para poder volver a publicarlas sin salir y volver a entrar.
  const [removed, setRemoved] = useState<Map<string, StoryDoc>>(new Map());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragScroll = useDragScroll(scrollRef);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { setMounted(true); }, []);

  const {
    items: publishable,
    loading: publishableLoading,
    stats,
  } = usePublishableGreetings({
    uid: currentUserId,
    type,
    scope: entityType === "group" ? { kind: "group", groupId: entityId } : { kind: "profile" },
  });

  // El panel puede abrirse acotado a un lado (desde "editar" de un círculo de
  // enviados o de recibidos) o completo (desde el círculo con `+`).
  const greetingList: PublishableGreeting[] =
    role === "both" ? publishable : publishable.filter((g) => g.role === role);

  // Lo YA PUBLICADO entra siempre, aunque su encargo ya no sea publicable.
  //
  // Antes la lista salía solo de los encargos publicables, así que una historia
  // viva cuyo encargo dejó de calificar —le borraron el video en Mux, cambió de
  // estado, o el permiso ya no aplica— desaparecía de aquí. Se veía la historia
  // activa en el rail y el panel decía que no había nada, y encima no había forma
  // de quitarla. La lista es la UNIÓN de las dos cosas.
  type Row = {
    id: string;
    toName: string;
    instructions: string;
    muxPlaybackId: string | null;
    greeting: PublishableGreeting | null;
    publishedStory: StoryDoc | null;
    /** Se quitó en esta sesión; se guarda para poder rehacerla. */
    removed: StoryDoc | null;
  };

  const rows: Row[] = (() => {
    const byGreeting = new Map<string, Row>();

    for (const g of greetingList) {
      byGreeting.set(g.id, {
        id: g.id,
        toName: g.toName,
        instructions: g.instructions,
        muxPlaybackId: g.muxPlaybackId,
        greeting: g,
        publishedStory: null,
        removed: null,
      });
    }

    for (const s of stories) {
      if (!s.greetingRequestId) continue;
      const existing = byGreeting.get(s.greetingRequestId);
      if (existing) {
        existing.publishedStory = s;
        continue;
      }
      byGreeting.set(s.greetingRequestId, {
        id: s.greetingRequestId,
        toName: "",
        instructions: s.instructions ?? "",
        muxPlaybackId: s.muxPlaybackId,
        greeting: null,
        publishedStory: s,
        removed: null,
      });
    }

    // Lo quitado en esta sesión sigue en la lista, con el botón de compartir.
    for (const [greetingId, story] of removed) {
      const existing = byGreeting.get(greetingId);
      if (existing) {
        // Si volvió a publicarse, ya no cuenta como quitada.
        if (!existing.publishedStory) existing.removed = story;
        continue;
      }
      byGreeting.set(greetingId, {
        id: greetingId,
        toName: "",
        instructions: story.instructions ?? "",
        muxPlaybackId: story.muxPlaybackId,
        greeting: null,
        publishedStory: null,
        removed: story,
      });
    }

    return [...byGreeting.values()];
  })();

  /** Motivo real de que no haya nada, en vez de suponer uno. */
  const emptyReason = (() => {
    if (stats.noPermission > 0) return tCommon("storyNeedsBuyerPermission");
    if (stats.hiddenGroup > 0) return tCommon("storyFromHiddenCommunity");
    if (stats.noVideo > 0 || stats.notDelivered > 0) return tCommon("storyNotReadyYet");
    return tCommon("storyNothingToPublish");
  })();

  const handleClose = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => onClose(), 180);
  };

  const emoji = type === "saludo" ? "👋" : "💡";
  const typeLabel = type === "saludo" ? "saludos" : "consejos";
  // El panel ya no es solo la portada: también publica, retira y decide qué
  // circula en el feed. El título lo dice.
  //
  // Abierto desde el círculo con `+` no hay un lado concreto —conviven lo que
  // grabaste y lo que compraste—, así que no se nombra ninguno.
  const dirLabel = role === "both" ? "" : role === "buyer" ? " recibidos" : " enviados";
  const title = `Configuración de ${typeLabel}${dirLabel}`;

  const isCustomSelected = !!currentCustomPhotoUrl && !currentCoverStoryId;

  const handleSelectStory = async (storyId: string | null) => {
    if (saving || uploading) return;
    setSaving(true);
    try { await onSelectStory(storyId); }
    finally { setSaving(false); }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // file.type can be empty on iOS/Android — guess from extension so Storage rules pass
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const extMap: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
      webp: "image/webp", gif: "image/gif", heic: "image/heic", heif: "image/heif",
    };
    const contentType = file.type || extMap[ext] || "image/jpeg";
    setUploading(true);
    try {
      const storageRef = ref(storage, uploadStoragePath);
      await uploadBytes(storageRef, file, { contentType, cacheControl: IMAGE_CACHE_CONTROL });
      const url = await getDownloadURL(storageRef);
      await onUploadPhoto(url);
    } catch (err) {
      console.error("[StoryCoverPicker upload]", err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  /**
   * Publica la historia, sea un encargo publicable o una que acabas de quitar.
   *
   * Los dos casos traen los mismos datos, solo que uno viene del encargo y el
   * otro del documento borrado, así que se normalizan antes de crear.
   */
  const handleShare = async (row: Row) => {
    const item = row.greeting ?? {
      id: row.id,
      creatorId: row.removed?.greetingCreatorId ?? row.removed?.creatorId ?? currentUserId,
      instructions: row.instructions,
      muxPlaybackId: row.muxPlaybackId,
      videoDuration: row.removed?.videoDuration ?? null,
    };

    setProcessingId(row.id);
    try {
      await addStoryFromGreeting({
        // Publica SIEMPRE quien está usando el panel. Cuando lo grabó otro (lo
        // compraste tú), `greetingCreatorId` guarda a su autor y de ahí sale
        // `byCreator: false`, que es lo que mantiene esa copia fuera del reel
        // para no repetir el mismo video con dos caras.
        //
        // El lado se decide POR ITEM y no por el panel: desde el círculo con `+`
        // conviven en una sola lista lo que grabaste y lo que compraste.
        creatorId: entityType === "group" ? entityId : currentUserId,
        greetingCreatorId: item.creatorId,
        instructions: item.instructions || undefined,
        type,
        muxPlaybackId: item.muxPlaybackId,
        thumbnailUrl: item.muxPlaybackId
          ? `https://image.mux.com/${item.muxPlaybackId}/thumbnail.jpg?time=0`
          : null,
        videoDuration: item.videoDuration,
        greetingRequestId: item.id,
        source: entityType === "profile" ? "profile" : "group",
        groupId: entityType === "group" ? entityId : null,
      });
      // Deja de estar "quitada": el listener del padre traerá la nueva.
      setRemoved((prev) => {
        if (!prev.has(row.id)) return prev;
        const next = new Map(prev);
        next.delete(row.id);
        return next;
      });
      refreshReelFeed();
    } finally {
      setProcessingId(null);
    }
  };

  /**
   * Quita la historia, pero recuerda de qué estaba hecha.
   *
   * ⚠️ Sin esto, quitar era irreversible en la práctica. La fila salía de la
   * lista y no volvía, porque solo reaparece si su encargo sigue siendo
   * publicable — y hay historias vivas cuyo encargo ya no lo es: se pidió el
   * reembolso, cambió de estado, o se publicó desde el panel de grabación, que
   * no comprueba el permiso del comprador. Para esas, quitar equivalía a borrar
   * para siempre sin avisar.
   *
   * Guardando el documento en memoria, el botón de compartir puede reconstruir
   * la historia con los mismos datos.
   */
  const handleRemove = async (story: StoryDoc, greetingId: string) => {
    setProcessingId(greetingId);
    try {
      await deleteStory(story.id);
      setRemoved((prev) => new Map(prev).set(greetingId, story));
      refreshReelFeed();
    } finally {
      setProcessingId(null);
    }
  };

  /**
   * Enciende o apaga la circulación en el feed de Historias.
   *
   * Publicar manda la historia a DOS sitios, el perfil o la comunidad y el
   * descubrimiento. Este interruptor apaga solo el segundo, así que sigue estando
   * para quien entre al perfil pero deja de aparecerle a desconocidos. Nace
   * encendido; la regla de Firestore exige que se cree en `false`.
   */
  const handleToggleReel = async (storyId: string, greetingId: string, show: boolean) => {
    setProcessingId(greetingId);
    try {
      await setStoryHiddenFromReel(storyId, !show);
      refreshReelFeed();
    } catch (err) {
      console.error("[setStoryHiddenFromReel]", err);
    } finally {
      setProcessingId(null);
    }
  };

  useBodyScrollLock(true);

  if (!mounted) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        height: "var(--vb-alto-pantalla)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 20px",
      }}
    >
      <style>{`
        @keyframes vibraCoverPickerIn {
          from { opacity: 0; transform: scale(0.94) translateY(10px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);    }
        }
        @keyframes vibraCoverPickerOut {
          from { opacity: 1; transform: scale(1)    translateY(0);    }
          to   { opacity: 0; transform: scale(0.94) translateY(10px); }
        }
        @keyframes vibraCoverBackdropIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes vibraCoverBackdropOut {
          from { opacity: 1; }
          to   { opacity: 0; }
        }
      `}</style>

      {/* Backdrop */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.72)",
          animation: closing
            ? "vibraCoverBackdropOut 180ms ease-in forwards"
            : "vibraCoverBackdropIn 160ms ease-out",
        }}
        onClick={handleClose}
      />

      {/* Panel */}
      <div
        style={{
          position: "relative",
          background: "rgba(8,9,11,0.985)",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.1)",
          width: "100%",
          maxWidth: 400,
          maxHeight: "82vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 30px 90px rgba(0,0,0,0.56), 0 0 0 1px rgba(255,255,255,0.035)",
          overflow: "hidden",
          animation: closing
            ? "vibraCoverPickerOut 180ms ease-in forwards"
            : "vibraCoverPickerIn 180ms ease-out",
        }}
      >
        {/* Header */}
        <header
          style={{
            height: 56,
            display: "grid",
            gridTemplateColumns: "48px 1fr 48px",
            alignItems: "center",
            padding: "0 12px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            flexShrink: 0,
          }}
        >
          <div />
          <h2
            style={{
              margin: 0,
              textAlign: "center",
              fontSize: 17,
              fontWeight: 500,
              letterSpacing: "-0.02em",
              color: "#fff",
              fontFamily: fontStack,
            }}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label={tCommon("closeAriaLabel")}
            style={{
              width: 40,
              height: 40,
              border: "none",
              background: "transparent",
              color: "rgba(255,255,255,0.86)",
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              fontSize: 32,
              fontWeight: 300,
              lineHeight: 1,
              WebkitTapHighlightColor: "transparent",
            }}
          >
            ×
          </button>
        </header>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 20 }}>
          {/* La barra de scroll se oculta y el cursor de mano solo aparece con
              ratón, que es donde el arrastre existe. En táctil no se toca nada. */}
          <style>{`
            .coverStrip::-webkit-scrollbar { display: none; }
            .coverStrip img { -webkit-user-drag: none; user-drag: none; }
            @media (hover: hover) and (pointer: fine) {
              .coverStrip { cursor: grab; }
              .coverStrip:active { cursor: grabbing; }
            }
          `}</style>

          {/* Tira de portadas. Se recorre con el dedo en celular y arrastrando
              con el ratón en escritorio; sin flechas. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "0 16px 4px",
            }}
          >
            <div
              ref={scrollRef}
              {...dragScroll}
              className="coverStrip"
              style={{
                flex: 1,
                display: "flex",
                gap: 10,
                overflowX: "auto",
                scrollbarWidth: "none",
                WebkitOverflowScrolling:
                  "touch" as React.CSSProperties["WebkitOverflowScrolling"],
                padding: "4px 2px",
                alignItems: "flex-start",
                // Sin esto, arrastrar selecciona los nombres de debajo de cada
                // círculo y el gesto se siente roto.
                userSelect: "none",
                WebkitUserSelect: "none",
              }}
            >
              {/* Slot: Subir foto */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  flexShrink: 0,
                }}
              >
                <div style={ringWrap}>
                  <AvatarRing foto={FOTO} variante={isCustomSelected ? "vibra" : "apagado"} />
                  <button className="vibra-pop"
                    type="button"
                    disabled={uploading || saving}
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      ...innerBtn,
                      cursor: uploading ? "default" : "pointer",
                      opacity: uploading ? 0.7 : 1,
                      position: "relative",
                    }}
                  >
                    {currentCustomPhotoUrl ? (
                      <Image
                        src={currentCustomPhotoUrl}
                        alt=""
                        fill
                        style={{ objectFit: "cover" }}
                      />
                    ) : (
                      <CameraIcon />
                    )}
                    {uploading && (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          background: "rgba(0,0,0,0.55)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <span style={{ color: "#fff", fontSize: 10 }}>...</span>
                      </div>
                    )}
                  </button>
                </div>
                <span
                  style={{
                    color: "rgba(255,255,255,0.45)",
                    fontSize: 9,
                    fontFamily: fontStack,
                    textAlign: "center",
                  }}
                >
                  {currentCustomPhotoUrl ? "Cambiar" : "Subir foto"}
                </span>
              </div>

              {/* Slot: Más reciente */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  flexShrink: 0,
                }}
              >
                <div style={ringWrap}>
                  <AvatarRing
                    foto={FOTO}
                    variante={!currentCoverStoryId && !currentCustomPhotoUrl ? "vibra" : "apagado"}
                  />
                  <button
                    type="button"
                    disabled={saving || uploading}
                    onClick={() => handleSelectStory(null)}
                    style={innerBtn}
                  >
                    <span style={{ fontSize: 22 }}>{emoji}</span>
                  </button>
                </div>
                <span
                  style={{
                    color: "rgba(255,255,255,0.45)",
                    fontSize: 9,
                    fontFamily: fontStack,
                  }}
                >
                  Reciente
                </span>
              </div>

              {/* Published story circles */}
              {stories.map((story) => {
                const thumb = storyThumb(story);
                const isSelected = story.id === currentCoverStoryId;
                return (
                  <div
                    key={story.id}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 4,
                      flexShrink: 0,
                    }}
                  >
                    <div style={ringWrap}>
                      <AvatarRing foto={FOTO} variante={isSelected ? "vibra" : "apagado"} />
                      <button
                        type="button"
                        disabled={saving || uploading}
                        onClick={() => handleSelectStory(story.id)}
                        style={innerBtn}
                      >
                        {thumb ? (
                          <Image
                            src={thumb}
                            alt=""
                            width={60}
                            height={60}
                            style={{ objectFit: "cover", width: "100%", height: "100%" }}
                          />
                        ) : (
                          <span style={{ fontSize: 22 }}>{emoji}</span>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

          </div>

          {/* Antes, con la lista vacía no se pintaba NADA: ni título ni aviso. El
              bloque entero desaparecía y se leía como que la función de publicar
              ya no existía. Ahora dice por qué no hay nada. */}
          {!publishableLoading && rows.length === 0 && (
            <div
              style={{
                margin: "4px 16px 12px",
                padding: "12px 14px",
                borderRadius: 10,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.5)",
                fontSize: 12,
                lineHeight: 1.5,
                fontFamily: fontStack,
              }}
            >
              {emptyReason}
            </div>
          )}

          {/* Greeting list */}
          {rows.length > 0 && (
            <>
              {rows.map((item) => {
                const publishedStory = item.publishedStory;
                const isProcessing = processingId === item.id;
                const thumb = item.muxPlaybackId
                  ? `https://image.mux.com/${item.muxPlaybackId}/thumbnail.jpg?time=0`
                  : null;

                return (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      margin: "0 16px 4px",
                      padding: "7px 0",
                    }}
                  >
                    {/* Thumbnail */}
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: "50%",
                        overflow: "hidden",
                        flexShrink: 0,
                        background: "#0e0e14",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }}
                    >
                      {thumb ? (
                        <Image
                          src={thumb}
                          alt=""
                          width={40}
                          height={40}
                          style={{ objectFit: "cover", width: "100%", height: "100%" }}
                        />
                      ) : (
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <span style={{ fontSize: 18 }}>{emoji}</span>
                        </div>
                      )}
                    </div>

                    {/* Empuja las acciones al borde derecho. */}
                    <div style={{ flex: 1, minWidth: 0 }} />

                    {/* Circulación en el feed, a la izquierda del botón. Solo
                        tiene sentido sobre lo que YA está publicado. */}
                    {publishedStory ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                        <span
                          style={{
                            fontSize: 10.5,
                            color: "rgba(255,255,255,0.42)",
                            fontFamily: fontStack,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {tCommon("storyShowInReel")}
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={!publishedStory.hiddenFromReel}
                          aria-label={tCommon("storyShowInReel")}
                          disabled={isProcessing}
                          onClick={() =>
                            handleToggleReel(
                              publishedStory.id,
                              item.id,
                              !!publishedStory.hiddenFromReel,
                            )
                          }
                          style={{
                            position: "relative",
                            flexShrink: 0,
                            width: 36,
                            height: 20,
                            borderRadius: 999,
                            padding: 0,
                            border: "1px solid rgba(255,255,255,0.18)",
                            // Morado de marca por token, no degradado. El
                            // degradado es de las piezas de contenido (aros,
                            // portadas); un control se lee mejor plano.
                            background: publishedStory.hiddenFromReel
                              ? "rgba(255,255,255,0.10)"
                              : "var(--brand)",
                            cursor: isProcessing ? "not-allowed" : "pointer",
                            transition: "all 0.2s ease",
                            opacity: isProcessing ? 0.5 : 1,
                          }}
                        >
                          <span
                            style={{
                              position: "absolute",
                              top: 2,
                              insetInlineStart: publishedStory.hiddenFromReel ? 2 : 18,
                              width: 14,
                              height: 14,
                              borderRadius: "50%",
                              background: "#fff",
                              transition: "all 0.2s ease",
                              display: "block",
                            }}
                          />
                        </button>
                      </div>
                    ) : null}

                    {/* El botón, siempre el último de la fila. */}
                    {publishedStory ? (
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleRemove(publishedStory, item.id)}
                        style={{
                          ...actionBtnStyle,
                          background: "rgba(239,68,68,0.10)",
                          border: "1px solid rgba(239,68,68,0.22)",
                          color: "#fca5a5",
                          fontWeight: 600,
                          letterSpacing: "-0.01em",
                          opacity: isProcessing ? 0.5 : 1,
                          WebkitTapHighlightColor: "transparent",
                        }}
                      >
                        {isProcessing ? "..." : "Quitar"}
                      </button>
                    ) : item.greeting || item.removed ? (
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleShare(item)}
                        style={{
                          ...actionBtnStyle,
                          background: "rgba(168,85,247,0.14)",
                          border: "1px solid rgba(168,85,247,0.28)",
                          color: "#c4b5fd",
                          fontWeight: 600,
                          letterSpacing: "-0.01em",
                          opacity: isProcessing ? 0.5 : 1,
                          WebkitTapHighlightColor: "transparent",
                        }}
                      >
                        {isProcessing ? "..." : "Compartir"}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
    </div>,
    document.body,
  );
}

function CameraIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="rgba(255,255,255,0.45)"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
