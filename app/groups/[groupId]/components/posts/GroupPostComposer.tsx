"use client";

import Link from "next/link";
import { MAX_POST_IMAGES } from "@/lib/posts/types";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
type CSSProperties,
type PointerEvent as ReactPointerEvent,
type TextareaHTMLAttributes,
} from "react";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import { normalizeImageFile } from "@/lib/uploads/image-normalizer";

type GroupPostComposerSubmitPayload = {
  text: string;
  imageFiles?: File[];
  videoFile?: File | null;
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
  const [selectedVideo, setSelectedVideo] = useState<File | null>(null);
  const [selectedVideoPreview, setSelectedVideoPreview] = useState<string | null>(null);
const [localError, setLocalError] = useState<string | null>(null);
const [processingImageSlots, setProcessingImageSlots] = useState(0);
const [draggingPreviewIndex, setDraggingPreviewIndex] = useState<number | null>(null);
const [dragOverPreviewIndex, setDragOverPreviewIndex] = useState<number | null>(null);
const [isReorderingPreview, setIsReorderingPreview] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const previewScrollerRef = useRef<HTMLDivElement | null>(null);
const dragStartIndexRef = useRef<number | null>(null);
const dragPointerIdRef = useRef<number | null>(null);
const dragPressTimerRef = useRef<number | null>(null);
const dragStartPointRef = useRef<{ x: number; y: number } | null>(null);
const previewDragActiveRef = useRef(false);
const dragLastPointRef = useRef<{ x: number; y: number } | null>(null);
const dragDidScrollRef = useRef(false);

  const currentUser = auth.currentUser;
  const currentUserName = currentUser?.displayName?.trim() || "Tú";
  const [currentUserAvatar, setCurrentUserAvatar] = useState<string | null>(
    currentUser?.photoURL || null
  );

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

            const avatarUrl =
  typeof data.avatarUrl === "string" && data.avatarUrl.trim().length > 0
    ? data.avatarUrl.trim()
    : typeof data.photoURL === "string" && data.photoURL.trim().length > 0
      ? data.photoURL.trim()
      : currentUser?.photoURL || null;

if (!cancelled) {
  setCurrentUserHandle(handle);
  setCurrentUserAvatar(avatarUrl);
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
  if (!selectedVideo) {
    setSelectedVideoPreview(null);
    return;
  }

  const objectUrl = URL.createObjectURL(selectedVideo);
  setSelectedVideoPreview(objectUrl);

  return () => {
    URL.revokeObjectURL(objectUrl);
  };
}, [selectedVideo]);

  const currentUserHref = currentUserHandle ? `/u/${currentUserHandle}` : "#";
const hasContent =
  text.trim().length > 0 || selectedImages.length > 0 || Boolean(selectedVideo);
const isPreparingImages = processingImageSlots > 0;

  function handleOpenImagePicker() {
    if (creating || isPreparingImages) return;
    fileInputRef.current?.click();
  }

  function handleOpenVideoPicker() {
    if (creating || isPreparingImages) return;
    videoInputRef.current?.click();
  }

function clearDragPressTimer() {
  if (dragPressTimerRef.current !== null) {
    window.clearTimeout(dragPressTimerRef.current);
    dragPressTimerRef.current = null;
  }
}

function startPreviewReorder(
  index: number,
  event: ReactPointerEvent<HTMLDivElement>
) {
  previewDragActiveRef.current = true;
  dragStartIndexRef.current = index;
  dragPointerIdRef.current = event.pointerId;

  setDraggingPreviewIndex(index);
  setDragOverPreviewIndex(index);
  setIsReorderingPreview(true);

  if (event.pointerType !== "mouse") {
    document.body.style.overflow = "hidden";

    if (navigator.vibrate) {
      navigator.vibrate(18);
    }
  }

  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {}
}

function moveSelectedImage(fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex) return;

  setSelectedImages((current) => {
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= current.length ||
      toIndex >= current.length
    ) {
      return current;
    }

    const nextImages = [...current];
    const [movedImage] = nextImages.splice(fromIndex, 1);
    nextImages.splice(toIndex, 0, movedImage);

    return nextImages;
  });
}

function getPreviewIndexFromPoint(clientX: number) {
  const scroller = previewScrollerRef.current;
  if (!scroller) return null;

  const items = Array.from(
    scroller.querySelectorAll<HTMLElement>("[data-preview-index]")
  );

  if (items.length === 0) return null;

  let closestIndex: number | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  items.forEach((item) => {
    const rect = item.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const distance = Math.abs(clientX - centerX);
    const index = Number(item.dataset.previewIndex);

    if (Number.isInteger(index) && distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });

  return closestIndex;
}

function handlePreviewPointerDown(
  index: number,
  event: ReactPointerEvent<HTMLDivElement>
) {
  if (creating) return;

  clearDragPressTimer();

  dragStartPointRef.current = {
    x: event.clientX,
    y: event.clientY,
  };

  dragLastPointRef.current = {
    x: event.clientX,
    y: event.clientY,
  };

  dragDidScrollRef.current = false;

  if (event.pointerType === "mouse") {
    startPreviewReorder(index, event);
    return;
  }

  dragPressTimerRef.current = window.setTimeout(() => {
    if (!dragDidScrollRef.current) {
      startPreviewReorder(index, event);
    }
  }, 260);
}

function handlePreviewPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
  const scroller = previewScrollerRef.current;
  const startPoint = dragStartPointRef.current;
  const lastPoint = dragLastPointRef.current;

  if (!scroller || !startPoint) return;

  if (!previewDragActiveRef.current) {
    if (event.pointerType !== "mouse" && lastPoint) {
      const moveX = event.clientX - lastPoint.x;
      const moveY = event.clientY - lastPoint.y;
      const totalX = event.clientX - startPoint.x;
      const totalY = event.clientY - startPoint.y;

      if (Math.abs(totalX) > 7 && Math.abs(totalX) > Math.abs(totalY)) {
        clearDragPressTimer();
        dragDidScrollRef.current = true;
        scroller.scrollLeft -= moveX;
      }

      dragLastPointRef.current = {
        x: event.clientX,
        y: event.clientY,
      };

      return;
    }

    return;
  }

  event.preventDefault();

  const fromIndex = dragStartIndexRef.current;
  const nextIndex = getPreviewIndexFromPoint(event.clientX);

  if (fromIndex !== null && nextIndex !== null && fromIndex !== nextIndex) {
    moveSelectedImage(fromIndex, nextIndex);
    dragStartIndexRef.current = nextIndex;
    setDraggingPreviewIndex(nextIndex);
    setDragOverPreviewIndex(nextIndex);
  }

  const rect = scroller.getBoundingClientRect();
  const edgeSize = event.pointerType === "mouse" ? 110 : 58;
  const scrollSpeed = event.pointerType === "mouse" ? 36 : 14;

  if (event.clientX < rect.left + edgeSize) {
    scroller.scrollLeft -= scrollSpeed;
  }

  if (event.clientX > rect.right - edgeSize) {
    scroller.scrollLeft += scrollSpeed;
  }
}

function handlePreviewPointerUp() {
  clearDragPressTimer();

  document.body.style.overflow = "";

  previewDragActiveRef.current = false;
  dragStartIndexRef.current = null;
  dragPointerIdRef.current = null;
  dragStartPointRef.current = null;
  dragLastPointRef.current = null;
  dragDidScrollRef.current = false;

  setDraggingPreviewIndex(null);
  setDragOverPreviewIndex(null);
  setIsReorderingPreview(false);
}

async function handleImagesSelected(files: File[]) {
  setLocalError(null);

  if (files.length === 0) return;

  const availableSlots =
    MAX_POST_IMAGES - selectedImages.length - processingImageSlots;

  if (availableSlots <= 0) {
    setLocalError(`Solo puedes subir hasta ${MAX_POST_IMAGES} imágenes por publicación.`);
    return;
  }

  const filesToProcess = files.slice(0, availableSlots);

  if (files.length > availableSlots) {
    setLocalError(`Solo se agregaron ${availableSlots} imágenes. El máximo es ${MAX_POST_IMAGES}.`);
  }

  setSelectedVideo(null);
  setSelectedVideoPreview(null);

  if (videoInputRef.current) {
    videoInputRef.current.value = "";
  }

  setPostType("image");
  setProcessingImageSlots((current) => current + filesToProcess.length);

  let failedCount = 0;

  for (const file of filesToProcess) {
    try {
      const normalized = await normalizeImageFile(file, {
        maxSizeBytes: 150 * 1024 * 1024,
      });

      setSelectedImages((current) => [...current, normalized.file]);
    } catch {
      failedCount += 1;
    } finally {
      setProcessingImageSlots((current) => Math.max(0, current - 1));
    }
  }

  if (failedCount > 0) {
    setLocalError(
      failedCount === 1
        ? "No se pudo preparar una imagen."
        : `No se pudieron preparar ${failedCount} imágenes.`
    );
  }

  if (failedCount === filesToProcess.length && selectedImages.length === 0) {
    setPostType("text");
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

function handleVideoSelected(file: File | null) {
  setLocalError(null);

  if (!file) return;

  if (!file.type.startsWith("video/")) {
    setLocalError("Selecciona un archivo de video válido.");
    return;
  }

  setSelectedImages([]);
  setSelectedImagePreviews([]);
  setSelectedVideo(file);
  setPostType("video");

  if (fileInputRef.current) {
    fileInputRef.current.value = "";
  }
}

function handleRemoveVideo() {
  setSelectedVideo(null);
  setSelectedVideoPreview(null);

  if (videoInputRef.current) {
    videoInputRef.current.value = "";
  }

  if (text.trim().length === 0) {
    setPostType("text");
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
  videoFile: selectedVideo,
});

      setText("");
setSelectedImages([]);
setSelectedImagePreviews([]);
setSelectedVideo(null);
setSelectedVideoPreview(null);
      setPostType("text");

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      if (videoInputRef.current) {
        videoInputRef.current.value = "";
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
  width: "clamp(76px, 22vw, 104px)",
  height: "clamp(76px, 22vw, 104px)",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.08)",
  overflow: "hidden",
  background: "rgba(255,255,255,0.04)",
  position: "relative",
  flex: "0 0 auto",
};

const imagePreviewStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
  userSelect: "none",
  WebkitUserSelect: "none",
};

const removeImageButtonStyle: CSSProperties = {
  position: "absolute",
  top: 6,
  right: 6,
  width: 24,
  height: 24,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.68)",
  color: "#fff",
  cursor: "pointer",
  fontSize: 13,
  lineHeight: 1,
};

const imageNumberBadgeStyle: CSSProperties = {
  position: "absolute",
  left: 6,
  top: 6,
  minWidth: 22,
  height: 22,
  borderRadius: 999,
  background: "rgba(0,0,0,0.62)",
  color: "#fff",
  display: "grid",
  placeItems: "center",
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1,
};

const addMoreImagesButtonStyle: CSSProperties = {
  width: "clamp(76px, 22vw, 104px)",
  height: "clamp(76px, 22vw, 104px)",
  borderRadius: 12,
  border: "1px dashed rgba(255,255,255,0.24)",
  background: "rgba(255,255,255,0.045)",
  color: "rgba(255,255,255,0.78)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  fontSize: 24,
  fontWeight: 300,
  lineHeight: 1,
  flex: "0 0 auto",
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
  width: 38,
  height: 38,
  minHeight: 38,
  padding: 0,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.04)",
  color: "rgba(255,255,255,0.90)",
  fontSize: 18,
  fontWeight: 600,
  fontFamily: fontStack,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
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
    <style>
      {`
        .composer-textarea-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(255,255,255,0.18) transparent;
        }

        .composer-textarea-scroll::-webkit-scrollbar {
          width: 6px;
        }

        .composer-textarea-scroll::-webkit-scrollbar-track {
          background: transparent;
        }

        .composer-textarea-scroll::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.18);
          border-radius: 999px;
        }

        .composer-textarea-scroll::-webkit-scrollbar-button {
          display: none;
          width: 0;
          height: 0;
        }
      `}
    </style>
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

<input
  ref={videoInputRef}
  type="file"
  accept="video/*"
  style={{ display: "none" }}
  onChange={(event) => {
    handleVideoSelected(event.currentTarget.files?.[0] ?? null);
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
  : postType === "video"
    ? "Crear publicación con video"
    : "Crear publicación"}
            </div>
          </div>

<AutoGrowTextarea
  className="composer-textarea-scroll"
  value={text}
  onChange={(e) => setText(e.target.value)}
  placeholder="Escribe algo..."
  maxRows={3}
  style={textareaStyle}
/>

{(selectedImagePreviews.length > 0 || processingImageSlots > 0) && (
  <div
    style={{
      marginTop: 10,
      position: "relative",
      maxWidth: "100%",
    }}
  >
<style>
  {`
    .post-preview-scroller::-webkit-scrollbar {
      height: 6px;
    }

    .post-preview-scroller::-webkit-scrollbar-track {
      background: transparent;
    }

    .post-preview-scroller::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.18);
      border-radius: 999px;
    }

    @keyframes post-preview-loading-pulse {
      0% {
        opacity: 0.42;
      }

      50% {
        opacity: 0.78;
      }

      100% {
        opacity: 0.42;
      }
    }

    @media (max-width: 640px) {
      .post-preview-scroller::-webkit-scrollbar {
        display: none;
      }
    }
  `}
</style>

<div
  ref={previewScrollerRef}
  className="post-preview-scroller"
style={{
  display: "flex",
  gap: 8,
  maxWidth: "100%",
  overflowX: "auto",
  overflowY: "hidden",
  paddingBottom: 8,
  WebkitOverflowScrolling: "touch",
  scrollbarWidth: "thin",
  scrollbarColor: "rgba(255,255,255,0.18) transparent",
  cursor: isReorderingPreview ? "grabbing" : "grab",
}}
>
    {selectedImagePreviews.map((previewUrl, index) => (
<div
  key={previewUrl}
  data-preview-index={index}
  onDragStart={(event) => event.preventDefault()}
  onTouchMoveCapture={(event) => {
    if (previewDragActiveRef.current) {
      event.preventDefault();
    }
  }}
  onPointerDown={(event) => handlePreviewPointerDown(index, event)}
  onPointerMove={handlePreviewPointerMove}
  onPointerUp={handlePreviewPointerUp}
  onPointerCancel={handlePreviewPointerUp}
style={{
  ...imagePreviewWrapStyle,
  opacity: draggingPreviewIndex === index ? 0.62 : 1,
  transform:
    draggingPreviewIndex === index
      ? "scale(0.96)"
      : dragOverPreviewIndex === index
        ? "scale(1.035)"
        : "scale(1)",
  outline:
    dragOverPreviewIndex === index
      ? "2px solid rgba(255,255,255,0.42)"
      : "none",
  transition: "transform 140ms ease, opacity 140ms ease, outline 140ms ease",
  touchAction: "none",
  cursor: isReorderingPreview ? "grabbing" : "grab",
}}
>
<img
  src={previewUrl}
  alt={`Vista previa de imagen ${index + 1}`}
  style={imagePreviewStyle}
  draggable={false}
  onDragStart={(event) => event.preventDefault()}
/>

        <div style={imageNumberBadgeStyle}>{index + 1}</div>

<button
  type="button"
  onPointerDown={(event) => event.stopPropagation()}
  onClick={() => handleRemoveImage(index)}
          style={removeImageButtonStyle}
          aria-label={`Quitar imagen ${index + 1}`}
          disabled={creating}
        >
          ×
        </button>
      </div>
    ))}

    {Array.from({ length: processingImageSlots }).map((_, index) => (
      <div
        key={`processing-image-${index}`}
        aria-label="Preparando imagen"
        style={{
          ...imagePreviewWrapStyle,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.055)",
          animation: "post-preview-loading-pulse 1.6s ease-in-out infinite",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(90deg, rgba(255,255,255,0.035), rgba(255,255,255,0.12), rgba(255,255,255,0.035))",
          }}
        />
      </div>
    ))}

    {selectedImages.length + processingImageSlots < MAX_POST_IMAGES && (
      <button
        type="button"
        onClick={handleOpenImagePicker}
        disabled={creating}
        style={
          creating
            ? {
                ...addMoreImagesButtonStyle,
                opacity: 0.5,
                cursor: "not-allowed",
              }
            : addMoreImagesButtonStyle
        }
        aria-label="Agregar otra imagen"
      >
        +
      </button>
    )}
    </div>
  </div>
)}

{selectedVideoPreview && (
  <div
    style={{
      marginTop: 10,
      borderRadius: 14,
      border: "1px solid rgba(255,255,255,0.1)",
      background: "rgba(0,0,0,0.28)",
      padding: 10,
    }}
  >
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10,
        marginBottom: 8,
      }}
    >
      <div
        style={{
          minWidth: 0,
          color: "rgba(255,255,255,0.82)",
          fontSize: 12,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {selectedVideo?.name || "Video seleccionado"}
      </div>

      <button
        type="button"
        onClick={handleRemoveVideo}
        disabled={creating}
        style={{
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.06)",
          color: "rgba(255,255,255,0.78)",
          borderRadius: 999,
          padding: "5px 10px",
          fontSize: 12,
          cursor: creating ? "not-allowed" : "pointer",
          opacity: creating ? 0.5 : 1,
        }}
      >
        Quitar
      </button>
    </div>

    <video
      src={selectedVideoPreview}
      controls
      preload="metadata"
      style={{
        display: "block",
        width: "100%",
        maxHeight: 320,
        borderRadius: 12,
        background: "#000",
        objectFit: "contain",
      }}
    />
  </div>
)}

          {localError && <div style={localErrorStyle}>{localError}</div>}

          <div style={actionsRowStyle}>
<button
  type="button"
  onClick={handleOpenImagePicker}
  disabled={creating || Boolean(selectedVideo)}
  style={
    creating || Boolean(selectedVideo)
      ? {
          ...secondaryButtonStyle,
          opacity: 0.5,
          cursor: "not-allowed",
        }
      : secondaryButtonStyle
  }
  aria-label="Agregar imágenes"
>
  <span aria-hidden="true">🖼️</span>
</button>

<button
  type="button"
  onClick={handleOpenVideoPicker}
  disabled={creating || isPreparingImages || selectedImages.length > 0}
  style={
    creating || isPreparingImages || selectedImages.length > 0
      ? {
          ...secondaryButtonStyle,
          opacity: 0.5,
          cursor: "not-allowed",
        }
      : secondaryButtonStyle
  }
  aria-label="Agregar video"
>
  <span aria-hidden="true">🎥</span>
</button>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={creating || isPreparingImages || !hasContent}
              style={
              creating || isPreparingImages || !hasContent
                  ? disabledButtonStyle
                  : primaryButtonStyle
              }
            >
              {isPreparingImages ? "Preparando..." : creating ? "Publicando..." : "Publicar"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}