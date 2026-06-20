"use client";

import Image from "next/image";
import { createPortal } from "react-dom";
import {
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";

import { uploadPostImage } from "@/lib/posts/image-upload";
import { updatePost } from "@/lib/posts/post-service";
import type { Post, PostMedia } from "@/lib/posts/types";

type PostEditModalProps = {
  post: Post;
  isMobile?: boolean;
  onClose: () => void;
  onSaved: (newText: string, newMedia: PostMedia[]) => void;
};

const fontStack =
  'inherit';

const isPremiumPost = (post: Post) => post.premium?.enabled === true;

function isVideoMedia(item: PostMedia) {
  return item.type === "video";
}

export default function PostEditModal({
  post,
  isMobile = false,
  onClose,
  onSaved,
}: PostEditModalProps) {
  const isPremium = isPremiumPost(post);

  const [text, setText] = useState(post.text ?? "");
  const [mediaItems, setMediaItems] = useState<PostMedia[]>(
    Array.isArray(post.media) ? post.media : [],
  );
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const groupIdForUpload =
    (post.groupId as string | null | undefined) ??
    (post.profileId as string | null | undefined) ??
    post.authorId;

  function removeMedia(url: string) {
    setMediaItems((prev) => prev.filter((item) => item.url !== url));
  }

  async function handleAddImages(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    if (!groupIdForUpload) {
      setError("No se puede subir imágenes sin contexto de grupo o perfil.");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const uploaded = await Promise.all(
        files.slice(0, 10).map((file) =>
          uploadPostImage({ groupId: groupIdForUpload, file }),
        ),
      );
      setMediaItems((prev) => [...prev, ...uploaded]);
    } catch {
      setError("No se pudieron subir las imágenes. Intenta de nuevo.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (saving || uploading) return;

    setSaving(true);
    setError(null);

    try {
      await updatePost({
        postId: post.id,
        text,
        media: mediaItems,
      });
      onSaved(text, mediaItems);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo guardar la edición.",
      );
    } finally {
      setSaving(false);
    }
  }

  const busy = saving || uploading;

  const overlayStyle: CSSProperties = isMobile
    ? {
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.72)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }
    : {
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      };

  const sheetStyle: CSSProperties = isMobile
    ? {
        width: "100%",
        maxWidth: 520,
        maxHeight: "90dvh",
        borderRadius: "18px 18px 0 0",
        background: "#111",
        border: "1px solid rgba(255,255,255,0.09)",
        borderBottom: "none",
        display: "flex",
        flexDirection: "column",
        fontFamily: fontStack,
        animation: "vibraEditSlideUp 280ms cubic-bezier(0.32,0.72,0,1)",
      }
    : {
        width: "100%",
        maxWidth: 520,
        maxHeight: "85dvh",
        borderRadius: 16,
        background: "#111",
        border: "1px solid rgba(255,255,255,0.09)",
        display: "flex",
        flexDirection: "column",
        fontFamily: fontStack,
        animation: "vibraEditFadeIn 200ms cubic-bezier(0.2,0,0,1)",
      };

  const images = mediaItems.filter((m) => !isVideoMedia(m));
  const videos = mediaItems.filter((m) => isVideoMedia(m));

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <style>{`
        @keyframes vibraEditSlideUp {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
        @keyframes vibraEditFadeIn {
          from { opacity: 0; transform: scale(0.97) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .vibra-edit-sheet { animation: none !important; }
        }
      `}</style>

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Editar publicación"
        style={overlayStyle}
        onClick={(e) => {
          if (e.target === e.currentTarget && !busy) onClose();
        }}
      >
        <div className="vibra-edit-sheet" style={sheetStyle}>
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "16px 20px",
              borderBottom: "1px solid rgba(255,255,255,0.07)",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: "#fff",
                letterSpacing: "-0.01em",
              }}
            >
              Editar publicación
            </span>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="Cerrar"
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.06)",
                color: "rgba(255,255,255,0.7)",
                display: "grid",
                placeItems: "center",
                cursor: busy ? "not-allowed" : "pointer",
                fontSize: 15,
                opacity: busy ? 0.5 : 1,
              }}
            >
              ✕
            </button>
          </div>

          {/* Scrollable body */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "16px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            {/* Textarea */}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy}
              placeholder="¿Qué quieres compartir?"
              rows={5}
              style={{
                width: "100%",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 10,
                padding: "12px 14px",
                color: "#fff",
                fontSize: 14,
                fontFamily: fontStack,
                lineHeight: 1.55,
                resize: "vertical",
                outline: "none",
                boxSizing: "border-box",
                opacity: busy ? 0.7 : 1,
              }}
            />

            {/* Videos — bloqueados si es premium */}
            {videos.length > 0 && (
              <div>
                <p
                  style={{
                    fontSize: 11.5,
                    color: "rgba(255,255,255,0.45)",
                    margin: "0 0 8px",
                    fontWeight: 500,
                  }}
                >
                  {isPremium
                    ? "Videos (no se pueden cambiar en posts premium)"
                    : "Videos"}
                </p>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  {videos.map((item) => (
                    <div
                      key={item.url}
                      style={{
                        position: "relative",
                        width: 88,
                        height: 88,
                        borderRadius: 8,
                        overflow: "hidden",
                        background: "#1a1a1a",
                        border: "1px solid rgba(255,255,255,0.08)",
                        flexShrink: 0,
                      }}
                    >
                      {item.thumbnailUrl ? (
                        <Image
                          src={item.thumbnailUrl}
                          alt="Video"
                          fill
                          style={{ objectFit: "cover", opacity: isPremium ? 0.5 : 0.85 }}
                        />
                      ) : (
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "grid",
                            placeItems: "center",
                            fontSize: 24,
                            opacity: 0.5,
                          }}
                        >
                          🎬
                        </div>
                      )}

                      {isPremium ? (
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            display: "grid",
                            placeItems: "center",
                            background: "rgba(0,0,0,0.45)",
                          }}
                        >
                          <span style={{ fontSize: 18 }}>🔒</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => removeMedia(item.url)}
                          disabled={busy}
                          aria-label="Quitar video"
                          style={{
                            position: "absolute",
                            top: 4,
                            right: 4,
                            width: 22,
                            height: 22,
                            borderRadius: 999,
                            border: "none",
                            background: "rgba(0,0,0,0.7)",
                            color: "#fff",
                            fontSize: 12,
                            display: "grid",
                            placeItems: "center",
                            cursor: "pointer",
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Images */}
            {(images.length > 0 || !busy) && (
              <div>
                {images.length > 0 && (
                  <>
                    <p
                      style={{
                        fontSize: 11.5,
                        color: "rgba(255,255,255,0.45)",
                        margin: "0 0 8px",
                        fontWeight: 500,
                      }}
                    >
                      Imágenes
                    </p>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 8,
                        marginBottom: 10,
                      }}
                    >
                      {images.map((item) => (
                        <div
                          key={item.url}
                          style={{
                            position: "relative",
                            width: 88,
                            height: 88,
                            borderRadius: 8,
                            overflow: "hidden",
                            background: "#1a1a1a",
                            border: "1px solid rgba(255,255,255,0.08)",
                            flexShrink: 0,
                          }}
                        >
                          <Image
                            src={item.thumbnailUrl ?? item.url}
                            alt="Imagen"
                            fill
                            style={{ objectFit: "cover" }}
                          />
                          <button
                            type="button"
                            onClick={() => removeMedia(item.url)}
                            disabled={busy}
                            aria-label="Quitar imagen"
                            style={{
                              position: "absolute",
                              top: 4,
                              right: 4,
                              width: 22,
                              height: 22,
                              borderRadius: 999,
                              border: "none",
                              background: "rgba(0,0,0,0.7)",
                              color: "#fff",
                              fontSize: 12,
                              display: "grid",
                              placeItems: "center",
                              cursor: busy ? "not-allowed" : "pointer",
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Add images button */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                  style={{
                    height: 34,
                    border: "1px solid rgba(255,255,255,0.14)",
                    borderRadius: 8,
                    padding: "0 14px",
                    background: "rgba(255,255,255,0.05)",
                    color: "rgba(255,255,255,0.7)",
                    fontSize: 13,
                    fontFamily: fontStack,
                    fontWeight: 500,
                    cursor: busy ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    opacity: busy ? 0.5 : 1,
                  }}
                >
                  <span>+</span>
                  {uploading ? "Subiendo..." : "Agregar imágenes"}
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.heic,.heif"
                  multiple
                  style={{ display: "none" }}
                  onChange={handleAddImages}
                />
              </div>
            )}

            {/* Error */}
            {error && (
              <div
                style={{
                  borderRadius: 8,
                  border: "1px solid rgba(239,68,68,0.3)",
                  background: "rgba(239,68,68,0.08)",
                  padding: "10px 12px",
                  fontSize: 12.5,
                  color: "rgba(255,150,150,0.9)",
                  lineHeight: 1.5,
                }}
              >
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              display: "flex",
              gap: 10,
              padding: "14px 20px",
              borderTop: "1px solid rgba(255,255,255,0.07)",
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              style={{
                flex: 1,
                height: 42,
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 10,
                background: "transparent",
                color: "rgba(255,255,255,0.7)",
                fontSize: 14,
                fontFamily: fontStack,
                fontWeight: 500,
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.5 : 1,
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy}
              style={{
                flex: 2,
                height: 42,
                border: "none",
                borderRadius: 10,
                background: busy
                  ? "rgba(168,85,247,0.4)"
                  : "linear-gradient(135deg, #4f46ff, #a855ff, #ff2fb3)",
                color: "#fff",
                fontSize: 14,
                fontFamily: fontStack,
                fontWeight: 700,
                cursor: busy ? "not-allowed" : "pointer",
                letterSpacing: "-0.01em",
              }}
            >
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
