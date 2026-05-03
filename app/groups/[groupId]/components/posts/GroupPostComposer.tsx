"use client";

import Link from "next/link";
import { MAX_POST_IMAGES } from "@/lib/posts/types";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type TextareaHTMLAttributes,
} from "react";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import { normalizeImageFile } from "@/lib/uploads/image-normalizer";

type GroupPostComposerSubmitPayload = {
  text: string;
  imageFiles?: File[];
};

type GroupPostComposerProps = {
  onSubmit: (payload: GroupPostComposerSubmitPayload) => Promise<void>;
};

type ComposerPostType = "text" | "image" | "video" | "live" | "scheduled_event";

const fontStack =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "U";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function AutoGrowTextarea({
  value,
  maxRows = 3,
  style,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "style"> & {
  maxRows?: number;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    el.style.height = "0px";

    const computed = window.getComputedStyle(el);
    const lineHeight = Number.parseFloat(computed.lineHeight || "20") || 20;
    const borderTop = Number.parseFloat(computed.borderTopWidth || "0") || 0;
    const borderBottom = Number.parseFloat(computed.borderBottomWidth || "0") || 0;
    const paddingTop = Number.parseFloat(computed.paddingTop || "0") || 0;
    const paddingBottom = Number.parseFloat(computed.paddingBottom || "0") || 0;

    const maxHeight =
      lineHeight * maxRows + paddingTop + paddingBottom + borderTop + borderBottom;

    const nextHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [maxRows]);

  useEffect(() => {
    resize();
  }, [value, resize]);

  return (
    <textarea
      {...props}
      ref={ref}
      value={value}
      rows={1}
      onInput={(event) => {
        resize();
        props.onInput?.(event);
      }}
      style={style}
    />
  );
}

function Avatar({
  name,
  avatarUrl,
  size = 36,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          display: "block",
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.04)",
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.08)",
        color: "#fff",
        fontSize: Math.max(11, Math.floor(size * 0.32)),
        fontWeight: 500,
        letterSpacing: "-0.02em",
        flexShrink: 0,
      }}
    >
      {getInitials(name)}
    </div>
  );
}

export default function GroupPostComposer({
  onSubmit,
}: GroupPostComposerProps) {
  const [text, setText] = useState("");
  const [creating, setCreating] = useState(false);
  const [postType, setPostType] = useState<ComposerPostType>("text");
  const [currentUserHandle, setCurrentUserHandle] = useState<string | null>(null);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [selectedImagePreviews, setSelectedImagePreviews] = useState<string[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentUser = auth.currentUser;
  const currentUserName = currentUser?.displayName?.trim() || "Tú";
  const currentUserAvatar = currentUser?.photoURL || null;

  useEffect(() => {
    let cancelled = false;

    async function loadCurrentUserHandle() {
      const uid = auth.currentUser?.uid;

      if (!uid) {
        setCurrentUserHandle(null);
        return;
      }

      try {
        const userRef = doc(db, "users", uid);
        const snap = await getDoc(userRef);

        if (!snap.exists()) {
          if (!cancelled) setCurrentUserHandle(null);
          return;
        }

        const data = snap.data();
        const handle =
          typeof data.handle === "string" && data.handle.trim().length > 0
            ? data.handle.trim()
            : null;

        if (!cancelled) {
          setCurrentUserHandle(handle);
        }
      } catch {
        if (!cancelled) {
          setCurrentUserHandle(null);
        }
      }
    }

    loadCurrentUserHandle();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!localError) return;

    const timer = window.setTimeout(() => {
      setLocalError(null);
    }, 4500);

    return () => window.clearTimeout(timer);
  }, [localError]);

 useEffect(() => {
  if (selectedImages.length === 0) {
    setSelectedImagePreviews([]);
    return;
  }

  const objectUrls = selectedImages.map((file) => URL.createObjectURL(file));
  setSelectedImagePreviews(objectUrls);

  return () => {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
  };
}, [selectedImages]);

  const currentUserHref = currentUserHandle ? `/u/${currentUserHandle}` : "#";
 const hasContent = text.trim().length > 0 || selectedImages.length > 0;

  function handleOpenImagePicker() {
    if (creating) return;
    fileInputRef.current?.click();
  }


async function handleImagesSelected(files: File[]) {
  setLocalError(null);

  if (files.length === 0) return;

  const availableSlots = MAX_POST_IMAGES - selectedImages.length;

  if (availableSlots <= 0) {
    setLocalError(`Solo puedes subir hasta ${MAX_POST_IMAGES} imágenes por publicación.`);
    return;
  }

  const filesToProcess = files.slice(0, availableSlots);

  if (files.length > availableSlots) {
    setLocalError(`Solo se agregaron ${availableSlots} imágenes. El máximo es ${MAX_POST_IMAGES}.`);
  }

  try {
    const normalizedFiles: File[] = [];

    for (const file of filesToProcess) {
      const normalized = await normalizeImageFile(file, {
        maxSizeBytes: 150 * 1024 * 1024,
      });

      normalizedFiles.push(normalized.file);
    }

    setSelectedImages((current) => [...current, ...normalizedFiles]);
    setPostType("image");
  } catch (e: any) {
    setLocalError(e?.message ?? "No se pudieron preparar las imágenes.");
  }
}

function handleRemoveImage(indexToRemove: number) {
  setSelectedImages((current) => {
    const nextImages = current.filter((_, index) => index !== indexToRemove);

    if (nextImages.length === 0) {
      setPostType("text");
    }

    return nextImages;
  });

  if (fileInputRef.current) {
    fileInputRef.current.value = "";
  }
}

  async function handleSubmit() {
    if (creating || !hasContent) return;

    try {
      setCreating(true);
      setLocalError(null);

await onSubmit({
  text: text.trim(),
  imageFiles: selectedImages,
});

      setText("");
setSelectedImages([]);
setSelectedImagePreviews([]);
      setPostType("text");

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error: any) {
      setLocalError(error?.message ?? "No se pudo publicar.");
    } finally {
      setCreating(false);
    }
  }

  const cardStyle: CSSProperties = {
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.022)",
    color: "#fff",
    padding: 12,
    boxSizing: "border-box",
    backdropFilter: "blur(10px)",
  };

  const labelStyle: CSSProperties = {
    fontSize: 10.5,
    color: "rgba(255,255,255,0.56)",
    lineHeight: 1.2,
    letterSpacing: "-0.01em",
  };

  const nameStyle: CSSProperties = {
    fontSize: 12.5,
    fontWeight: 500,
    color: "#fff",
    lineHeight: 1.15,
    letterSpacing: "-0.02em",
    textDecoration: "none",
  };

  const textareaStyle: CSSProperties = {
    width: "100%",
    minHeight: 42,
    maxHeight: 96,
    padding: "10px 0 0 0",
    border: "none",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
    background: "transparent",
    color: "#fff",
    outline: "none",
    resize: "none",
    overflowY: "hidden",
    fontSize: 13,
    fontWeight: 300,
    lineHeight: "21px",
    fontFamily: fontStack,
    boxSizing: "border-box",
    WebkitAppearance: "none",
  };

const imagePreviewWrapStyle: CSSProperties = {
  width: "100%",
  aspectRatio: "1 / 1",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.08)",
  overflow: "hidden",
  background: "rgba(255,255,255,0.04)",
  position: "relative",
};

const imagePreviewStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
};

  const removeImageButtonStyle: CSSProperties = {
    position: "absolute",
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.72)",
    color: "#fff",
    cursor: "pointer",
    fontSize: 16,
    lineHeight: 1,
  };

  const actionsRowStyle: CSSProperties = {
    marginTop: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  };

  const secondaryButtonStyle: CSSProperties = {
    minHeight: 34,
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    color: "rgba(255,255,255,0.86)",
    fontSize: 12,
    fontWeight: 600,
    fontFamily: fontStack,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const primaryButtonStyle: CSSProperties = {
    minHeight: 34,
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "#fff",
    color: "#000",
    fontSize: 12,
    fontWeight: 600,
    fontFamily: fontStack,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const disabledButtonStyle: CSSProperties = {
    ...primaryButtonStyle,
    background: "rgba(255,255,255,0.10)",
    color: "rgba(255,255,255,0.50)",
    cursor: "not-allowed",
  };

  const localErrorStyle: CSSProperties = {
    marginTop: 10,
    borderRadius: 10,
    border: "1px solid rgba(255,90,90,0.24)",
    background: "rgba(120,18,18,0.28)",
    color: "#ffdada",
    padding: "9px 10px",
    fontSize: 12,
    lineHeight: 1.4,
  };

  return (
    <section style={cardStyle}>
<input
  ref={fileInputRef}
  type="file"
  accept="image/*,.heic,.heif"
  multiple
  style={{ display: "none" }}
  onChange={async (event) => {
    const files = Array.from(event.currentTarget.files ?? []);
    await handleImagesSelected(files);
    event.currentTarget.value = "";
  }}
/>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
        }}
      >
        <Link
          href={currentUserHref}
          style={{
            display: "inline-flex",
            flexShrink: 0,
          }}
        >
          <Avatar
            name={currentUserName}
            avatarUrl={currentUserAvatar}
            size={36}
          />
        </Link>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "grid", gap: 2 }}>
            <Link href={currentUserHref} style={nameStyle}>
              {currentUserName}
            </Link>

            <div style={labelStyle}>
              {postType === "image"
                ? "Crear publicación con imagen"
                : "Crear publicación"}
            </div>
          </div>

          <AutoGrowTextarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Escribe algo..."
            maxRows={3}
            style={textareaStyle}
          />

{selectedImagePreviews.length > 0 && (
  <div
    style={{
      marginTop: 10,
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
      gap: 8,
      maxWidth: 520,
    }}
  >
    {selectedImagePreviews.map((previewUrl, index) => (
      <div key={previewUrl} style={imagePreviewWrapStyle}>
        <img
          src={previewUrl}
          alt={`Vista previa de imagen ${index + 1}`}
          style={imagePreviewStyle}
        />

        <button
          type="button"
          onClick={() => handleRemoveImage(index)}
          style={removeImageButtonStyle}
          aria-label={`Quitar imagen ${index + 1}`}
          disabled={creating}
        >
          ×
        </button>
      </div>
    ))}
  </div>
)}

          {localError && <div style={localErrorStyle}>{localError}</div>}

          <div style={actionsRowStyle}>
            <button
              type="button"
              onClick={handleOpenImagePicker}
              disabled={creating}
              style={
                creating
                  ? {
                      ...secondaryButtonStyle,
                      opacity: 0.5,
                      cursor: "not-allowed",
                    }
                  : secondaryButtonStyle
              }
            >
              Imagen
            </button>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={creating || !hasContent}
              style={
                creating || !hasContent
                  ? disabledButtonStyle
                  : primaryButtonStyle
              }
            >
              {creating ? "Publicando..." : "Publicar"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}