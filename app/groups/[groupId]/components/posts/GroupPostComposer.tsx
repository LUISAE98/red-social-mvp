"use client";

import Link from "next/link";
import { MAX_POST_IMAGES } from "@/lib/posts/types";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type TextareaHTMLAttributes,
} from "react";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import { normalizeImageFile } from "@/lib/uploads/image-normalizer";

type ComposerMediaItem = {
  type: "image" | "video";
  file: File;
  coverFile?: File | null;
};

type ComposerContextType = "group" | "profile";

type GroupPostComposerSubmitPayload = {
  text: string;
  contextType: ComposerContextType;
  imageFiles?: File[];
  videoFiles?: File[];
  mediaItems?: ComposerMediaItem[];
};

type GroupPostComposerProps = {
  onSubmit: (payload: GroupPostComposerSubmitPayload) => Promise<void>;
  contextType?: ComposerContextType;
};

type ComposerPostType = "text" | "image" | "video" | "live" | "scheduled_event";
type SelectedMediaItem = ComposerMediaItem & {
  id: string;
  previewUrl: string;
  durationSeconds: number | null;
  coverPreviewUrl?: string | null;
  autoCoverUrl?: string | null;
  autoCoverFile?: File | null;
  coverStatus?: "loading" | "ready" | "error";
};

const MAX_POST_VIDEOS = 3;

const fontStack =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "U";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function createLocalMediaId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatVideoDuration(durationSeconds: number | null) {
  if (
    !Number.isFinite(durationSeconds ?? Number.NaN) ||
    durationSeconds === null
  ) {
    return "0:00";
  }

  const totalSeconds = Math.max(0, Math.floor(durationSeconds));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function readVideoDurationFromUrl(previewUrl: string): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");

    video.preload = "metadata";

    video.onloadedmetadata = () => {
      resolve(Number.isFinite(video.duration) ? video.duration : null);
    };

    video.onerror = () => {
      resolve(null);
    };

    video.src = previewUrl;
  });
}

function captureFirstVideoFrame(
  previewUrl: string,
  fileName: string,
): Promise<{ file: File; previewUrl: string } | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");

    let settled = false;

    function finish(value: { file: File; previewUrl: string } | null) {
      if (settled) return;
      settled = true;
      video.removeAttribute("src");
      video.load();
      resolve(value);
    }

    const timeoutId = window.setTimeout(() => {
      finish(null);
    }, 8000);

    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.crossOrigin = "anonymous";

    video.onerror = () => {
      window.clearTimeout(timeoutId);
      finish(null);
    };

    video.onloadedmetadata = () => {
      const seekTime =
        Number.isFinite(video.duration) && video.duration > 0 ? 0.01 : 0;

      try {
        video.currentTime = seekTime;
      } catch {
        window.clearTimeout(timeoutId);
        finish(null);
      }
    };

    video.onseeked = () => {
      try {
        const width = video.videoWidth || 720;
        const height = video.videoHeight || 1280;

        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d");

        if (!context) {
          window.clearTimeout(timeoutId);
          finish(null);
          return;
        }

        context.drawImage(video, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            window.clearTimeout(timeoutId);

            if (!blob) {
              finish(null);
              return;
            }

            const safeBaseName =
              fileName.replace(/\.[^.]+$/, "") || "video-cover";
            const file = new File([blob], `${safeBaseName}-cover.jpg`, {
              type: "image/jpeg",
              lastModified: Date.now(),
            });

            finish({ file, previewUrl: URL.createObjectURL(file) });
          },
          "image/jpeg",
          0.86,
        );
      } catch {
        window.clearTimeout(timeoutId);
        finish(null);
      }
    };

    video.src = previewUrl;
  });
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
    const borderBottom =
      Number.parseFloat(computed.borderBottomWidth || "0") || 0;
    const paddingTop = Number.parseFloat(computed.paddingTop || "0") || 0;
    const paddingBottom = Number.parseFloat(computed.paddingBottom || "0") || 0;

    const maxHeight =
      lineHeight * maxRows +
      paddingTop +
      paddingBottom +
      borderTop +
      borderBottom;

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
  contextType = "group",
}: GroupPostComposerProps) {
  const [text, setText] = useState("");
  const [creating, setCreating] = useState(false);
  const [postType, setPostType] = useState<ComposerPostType>("text");
  const [currentUserHandle, setCurrentUserHandle] = useState<string | null>(
    null,
  );
  const [selectedMediaItems, setSelectedMediaItems] = useState<
    SelectedMediaItem[]
  >([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [processingImageSlots, setProcessingImageSlots] = useState(0);
  const [processingVideoSlots, setProcessingVideoSlots] = useState(0);
  const [draggingPreviewIndex, setDraggingPreviewIndex] = useState<
    number | null
  >(null);
  const [dragOverPreviewIndex, setDragOverPreviewIndex] = useState<
    number | null
  >(null);
  const [isReorderingPreview, setIsReorderingPreview] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const pendingCoverVideoIdRef = useRef<string | null>(null);
  const previewScrollerRef = useRef<HTMLDivElement | null>(null);
  const selectedMediaItemsRef = useRef<SelectedMediaItem[]>([]);
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
    currentUser?.photoURL || null,
  );

  const selectedImages = useMemo(
    () =>
      selectedMediaItems
        .filter((item) => item.type === "image")
        .map((item) => item.file),
    [selectedMediaItems],
  );

  const selectedVideos = useMemo(
    () =>
      selectedMediaItems
        .filter((item) => item.type === "video")
        .map((item) => item.file),
    [selectedMediaItems],
  );

  const orderedSubmitMediaItems = useMemo<ComposerMediaItem[]>(
    () =>
      selectedMediaItems.map((item) => ({
        type: item.type,
        file: item.file,
        coverFile:
          item.type === "video"
            ? (item.coverFile ?? item.autoCoverFile ?? null)
            : null,
      })),
    [selectedMediaItems],
  );

  useEffect(() => {
    selectedMediaItemsRef.current = selectedMediaItems;
  }, [selectedMediaItems]);

  useEffect(() => {
    return () => {
      selectedMediaItemsRef.current.forEach((item) => {
        URL.revokeObjectURL(item.previewUrl);
        if (item.coverPreviewUrl) URL.revokeObjectURL(item.coverPreviewUrl);
        if (item.autoCoverUrl) URL.revokeObjectURL(item.autoCoverUrl);
      });
    };
  }, []);

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
            : typeof data.photoURL === "string" &&
                data.photoURL.trim().length > 0
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

  const currentUserHref = currentUserHandle ? `/u/${currentUserHandle}` : "#";
  const hasContent = text.trim().length > 0 || selectedMediaItems.length > 0;
  const isPreparingImages = processingImageSlots > 0;
  const canAddMoreMedia =
    selectedImages.length + processingImageSlots < MAX_POST_IMAGES ||
    selectedVideos.length + processingVideoSlots < MAX_POST_VIDEOS;

      const contextLabel =
    contextType === "profile"
      ? "Crear publicación en tu perfil"
      : "Crear publicación";

  function handleOpenMediaPicker() {
    if (creating) return;
    fileInputRef.current?.click();
  }

  function updatePostType(nextItems: SelectedMediaItem[]) {
    const hasImages = nextItems.some((item) => item.type === "image");
    const hasVideos = nextItems.some((item) => item.type === "video");

    if (hasImages && hasVideos) {
      setPostType("video");
      return;
    }

    if (hasVideos) {
      setPostType("video");
      return;
    }

    if (hasImages) {
      setPostType("image");
      return;
    }

    setPostType(text.trim().length > 0 ? "text" : "text");
  }

  function clearDragPressTimer() {
    if (dragPressTimerRef.current !== null) {
      window.clearTimeout(dragPressTimerRef.current);
      dragPressTimerRef.current = null;
    }
  }

  function startPreviewReorder(
    index: number,
    event: ReactPointerEvent<HTMLDivElement>,
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

  function moveSelectedMedia(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;

    setSelectedMediaItems((current) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= current.length ||
        toIndex >= current.length
      ) {
        return current;
      }

      const nextItems = [...current];
      const [movedItem] = nextItems.splice(fromIndex, 1);
      nextItems.splice(toIndex, 0, movedItem);

      return nextItems;
    });
  }

  function getPreviewIndexFromPoint(clientX: number) {
    const scroller = previewScrollerRef.current;
    if (!scroller) return null;

    const items = Array.from(
      scroller.querySelectorAll<HTMLElement>("[data-preview-index]"),
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
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    if (creating) return;

    clearDragPressTimer();

    dragStartPointRef.current = { x: event.clientX, y: event.clientY };
    dragLastPointRef.current = { x: event.clientX, y: event.clientY };
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
        const totalX = event.clientX - startPoint.x;
        const totalY = event.clientY - startPoint.y;

        if (Math.abs(totalX) > 7 && Math.abs(totalX) > Math.abs(totalY)) {
          clearDragPressTimer();
          dragDidScrollRef.current = true;
          scroller.scrollLeft -= moveX;
        }

        dragLastPointRef.current = { x: event.clientX, y: event.clientY };
        return;
      }

      return;
    }

    event.preventDefault();

    const fromIndex = dragStartIndexRef.current;
    const nextIndex = getPreviewIndexFromPoint(event.clientX);

    if (fromIndex !== null && nextIndex !== null && fromIndex !== nextIndex) {
      moveSelectedMedia(fromIndex, nextIndex);
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
      setLocalError(
        `Solo puedes subir hasta ${MAX_POST_IMAGES} imágenes por publicación.`,
      );
      return;
    }

    const filesToAdd = files.slice(0, availableSlots);

    if (files.length > availableSlots) {
      setLocalError(
        `Solo se agregaron ${availableSlots} imágenes. El máximo es ${MAX_POST_IMAGES}.`,
      );
    }

    const nextItems: SelectedMediaItem[] = filesToAdd.map((file) => ({
      id: createLocalMediaId(),
      type: "image",
      file,
      previewUrl: URL.createObjectURL(file),
      durationSeconds: null,
    }));

    setSelectedMediaItems((current) => {
      const mergedItems = [...current, ...nextItems];
      updatePostType(mergedItems);
      return mergedItems;
    });
  }

  function handleVideoSelected(files: File[]) {
    setLocalError(null);

    if (files.length === 0) return;

    const validVideos = files.filter((file) => file.type.startsWith("video/"));

    if (validVideos.length !== files.length) {
      setLocalError("Uno o más archivos seleccionados no son videos válidos.");
    }

    if (validVideos.length === 0) return;

    const availableSlots = MAX_POST_VIDEOS - selectedVideos.length;

    if (availableSlots <= 0) {
      setLocalError("Puedes agregar máximo 3 videos por publicación.");
      return;
    }

    const videosToAdd = validVideos.slice(0, availableSlots);

    if (validVideos.length > availableSlots) {
      setLocalError("Puedes agregar máximo 3 videos por publicación.");
    }

    const nextItems = videosToAdd.map(
      (file): SelectedMediaItem => ({
        id: createLocalMediaId(),
        type: "video",
        file,
        previewUrl: URL.createObjectURL(file),
        durationSeconds: null,
        coverFile: null,
        coverPreviewUrl: null,
        autoCoverUrl: null,
        autoCoverFile: null,
        coverStatus: "loading",
      }),
    );

    setSelectedMediaItems((current) => {
      const mergedItems = [...current, ...nextItems];
      updatePostType(mergedItems);
      return mergedItems;
    });
  }

  async function handleMediaSelected(files: File[]) {
    if (files.length === 0) return;

    const imageFiles = files.filter(
      (file) =>
        file.type.startsWith("image/") ||
        file.name.toLowerCase().endsWith(".heic") ||
        file.name.toLowerCase().endsWith(".heif"),
    );

    const videoFiles = files.filter((file) => file.type.startsWith("video/"));
    const unsupportedFiles =
      files.length - imageFiles.length - videoFiles.length;

    if (unsupportedFiles > 0) {
      setLocalError("Uno o más archivos no son imágenes o videos válidos.");
    }

    const availableVideoSlots = Math.max(
      0,
      MAX_POST_VIDEOS - selectedVideos.length - processingVideoSlots,
    );
    const videosReserved = Math.min(videoFiles.length, availableVideoSlots);

    if (videosReserved > 0) {
      setProcessingVideoSlots((current) => current + videosReserved);
    }

    try {
      if (imageFiles.length > 0) {
        await handleImagesSelected(imageFiles);
      }

      if (videoFiles.length > 0) {
        handleVideoSelected(videoFiles);
      }
    } finally {
      if (videosReserved > 0) {
        setProcessingVideoSlots((current) =>
          Math.max(0, current - videosReserved),
        );
      }
    }
  }

  function handleRemoveMedia(indexToRemove: number) {
    setSelectedMediaItems((current) => {
      const itemToRemove = current[indexToRemove];

      if (itemToRemove) {
        URL.revokeObjectURL(itemToRemove.previewUrl);
        if (itemToRemove.coverPreviewUrl)
          URL.revokeObjectURL(itemToRemove.coverPreviewUrl);
        if (itemToRemove.autoCoverUrl)
          URL.revokeObjectURL(itemToRemove.autoCoverUrl);
      }

      const nextItems = current.filter((_, index) => index !== indexToRemove);
      updatePostType(nextItems);
      return nextItems;
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function clearSelectedMedia() {
    selectedMediaItemsRef.current.forEach((item) => {
      URL.revokeObjectURL(item.previewUrl);
      if (item.coverPreviewUrl) URL.revokeObjectURL(item.coverPreviewUrl);
      if (item.autoCoverUrl) URL.revokeObjectURL(item.autoCoverUrl);
    });
    selectedMediaItemsRef.current = [];
    setSelectedMediaItems([]);
  }

  function handleChooseVideoCover(videoId: string) {
    if (creating) return;
    pendingCoverVideoIdRef.current = videoId;
    coverInputRef.current?.click();
  }

  async function handleCoverSelected(file: File | null) {
    const videoId = pendingCoverVideoIdRef.current;
    pendingCoverVideoIdRef.current = null;

    if (!videoId || !file) return;

    const isSupportedImage =
      file.type.startsWith("image/") ||
      file.name.toLowerCase().endsWith(".heic") ||
      file.name.toLowerCase().endsWith(".heif");

    if (!isSupportedImage) {
      setLocalError("Selecciona una imagen válida para la portada del video.");
      return;
    }

    try {
      const normalized = await normalizeImageFile(file, {
        maxSizeBytes: 150 * 1024 * 1024,
      });

      const coverPreviewUrl = URL.createObjectURL(normalized.file);

      setSelectedMediaItems((current) =>
        current.map((item) => {
          if (item.id !== videoId) return item;

          if (item.coverPreviewUrl) URL.revokeObjectURL(item.coverPreviewUrl);

          return {
            ...item,
            coverFile: normalized.file,
            coverPreviewUrl,
          };
        }),
      );
    } catch {
      setLocalError("No se pudo preparar la portada del video.");
    } finally {
      if (coverInputRef.current) {
        coverInputRef.current.value = "";
      }
    }
  }

  async function handleSubmit() {
    if (creating || !hasContent) return;

    try {
      setCreating(true);
      setLocalError(null);

      await onSubmit({
        text: text.trim(),
        contextType,
        imageFiles: selectedImages,
        videoFiles: selectedVideos,
        mediaItems: orderedSubmitMediaItems,
      });

      setText("");
      clearSelectedMedia();
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

  const mediaPreviewWrapStyle: CSSProperties = {
    width: "clamp(76px, 22vw, 104px)",
    height: "clamp(76px, 22vw, 104px)",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.08)",
    overflow: "hidden",
    background: "rgba(255,255,255,0.04)",
    position: "relative",
    flex: "0 0 auto",
  };

  const mediaPreviewStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
    userSelect: "none",
    WebkitUserSelect: "none",
  };

  const mediaPreviewItemColumnStyle: CSSProperties = {
    width: "clamp(76px, 22vw, 104px)",
    flex: "0 0 auto",
    display: "grid",
    gap: 7,
  };

  const videoCoverButtonStyle: CSSProperties = {
    width: "100%",
    minHeight: 30,
    padding: "6px 8px",
    borderRadius: 10,
    border: "1px solid rgba(168,85,247,0.34)",
    background: "rgba(168,85,247,0.14)",
    color: "rgba(237,233,254,0.96)",
    fontSize: 10.5,
    fontWeight: 700,
    fontFamily: fontStack,
    lineHeight: 1.1,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const videoCoverLoadingStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    background:
      "linear-gradient(135deg, rgba(76,29,149,0.78), rgba(168,85,247,0.34), rgba(49,46,129,0.72))",
    backgroundSize: "220% 220%",
    animation: "post-preview-video-cover-loading 1.45s ease-in-out infinite",
    color: "rgba(255,255,255,0.92)",
    textAlign: "center",
    padding: 10,
    boxSizing: "border-box",
    zIndex: 2,
  };

  const removeMediaButtonStyle: CSSProperties = {
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
    zIndex: 4,
  };

  const mediaNumberBadgeStyle: CSSProperties = {
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
    zIndex: 3,
  };

  const videoPlayBadgeStyle: CSSProperties = {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 34,
    height: 34,
    borderRadius: 999,
    transform: "translate(-50%, -50%)",
    display: "grid",
    placeItems: "center",
    background: "rgba(0,0,0,0.58)",
    border: "1px solid rgba(255,255,255,0.24)",
    color: "#fff",
    fontSize: 15,
    lineHeight: 1,
    pointerEvents: "none",
    zIndex: 3,
  };

  const videoDurationBadgeStyle: CSSProperties = {
    position: "absolute",
    right: 6,
    bottom: 6,
    minHeight: 20,
    padding: "3px 6px",
    borderRadius: 999,
    background: "rgba(0,0,0,0.68)",
    color: "#fff",
    fontSize: 10.5,
    fontWeight: 700,
    lineHeight: 1,
    display: "inline-flex",
    alignItems: "center",
    zIndex: 3,
  };

  const addMoreMediaButtonStyle: CSSProperties = {
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
        accept="image/*,.heic,.heif,video/*"
        multiple
        style={{ display: "none" }}
        onChange={(event) => {
          const input = event.currentTarget;
          const files = Array.from(input.files ?? []);

          window.setTimeout(() => {
            void handleMediaSelected(files);
            input.value = "";
          }, 0);
        }}
      />

      <input
        ref={coverInputRef}
        type="file"
        accept="image/*,.heic,.heif"
        style={{ display: "none" }}
        onChange={async (event) => {
          const file = event.currentTarget.files?.[0] ?? null;
          await handleCoverSelected(file);
          event.currentTarget.value = "";
        }}
      />

      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <Link
          href={currentUserHref}
          style={{ display: "inline-flex", flexShrink: 0 }}
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
              {selectedImages.length > 0 && selectedVideos.length > 0
                ? contextType === "profile"
                  ? "Crear publicación con media en tu perfil"
                  : "Crear publicación con media"
                : postType === "image"
                  ? contextType === "profile"
                    ? "Crear publicación con imagen en tu perfil"
                    : "Crear publicación con imagen"
                  : postType === "video"
                    ? contextType === "profile"
                      ? "Crear publicación con video en tu perfil"
                      : "Crear publicación con video"
                    : contextLabel}
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

          {(selectedMediaItems.length > 0 || processingImageSlots > 0) && (
            <div
              style={{ marginTop: 10, position: "relative", maxWidth: "100%" }}
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
                    0% { opacity: 0.42; }
                    50% { opacity: 0.78; }
                    100% { opacity: 0.42; }
                  }

                  @keyframes post-preview-video-cover-loading {
                    0% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                    100% { background-position: 0% 50%; }
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
                {selectedMediaItems.map((item, index) => {
                  const videoCoverPreviewUrl =
                    item.type === "video"
                      ? item.coverPreviewUrl || item.autoCoverUrl || null
                      : null;
                  const isVideoCoverLoading =
                    item.type === "video" &&
                    !videoCoverPreviewUrl &&
                    item.coverStatus !== "error";
                  const hasManualCover =
                    item.type === "video" && Boolean(item.coverPreviewUrl);

                  return (
                    <div key={item.id} style={mediaPreviewItemColumnStyle}>
                      <div
                        data-preview-index={index}
                        onDragStart={(event) => event.preventDefault()}
                        onTouchMoveCapture={(event) => {
                          if (previewDragActiveRef.current) {
                            event.preventDefault();
                          }
                        }}
                        onPointerDown={(event) =>
                          handlePreviewPointerDown(index, event)
                        }
                        onPointerMove={handlePreviewPointerMove}
                        onPointerUp={handlePreviewPointerUp}
                        onPointerCancel={handlePreviewPointerUp}
                        style={{
                          ...mediaPreviewWrapStyle,
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
                          transition:
                            "transform 140ms ease, opacity 140ms ease, outline 140ms ease",
                          touchAction: "none",
                          cursor: isReorderingPreview ? "grabbing" : "grab",
                        }}
                      >
                        {item.type === "image" ? (
                          <img
                            src={item.previewUrl}
                            alt={`Vista previa de imagen ${index + 1}`}
                            style={mediaPreviewStyle}
                            draggable={false}
                            onDragStart={(event) => event.preventDefault()}
                          />
                        ) : (
                          <>
                            {videoCoverPreviewUrl ? (
                              <img
                                src={videoCoverPreviewUrl}
                                alt={`Portada del video ${index + 1}`}
                                style={mediaPreviewStyle}
                                draggable={false}
                                onDragStart={(event) => event.preventDefault()}
                              />
                            ) : (
                              <div
                                aria-hidden="true"
                                style={videoCoverLoadingStyle}
                              >
                                <div
                                  style={{
                                    display: "grid",
                                    gap: 6,
                                    justifyItems: "center",
                                  }}
                                >
                                  <span style={{ fontSize: 21, lineHeight: 1 }}>
                                    🎥
                                  </span>
                                  <span
                                    style={{
                                      fontSize: 10.5,
                                      fontWeight: 800,
                                      lineHeight: 1.15,
                                    }}
                                  >
                                    Video seleccionado
                                  </span>
                                </div>
                              </div>
                            )}

                            {isVideoCoverLoading && (
                              <div
                                aria-hidden="true"
                                style={{
                                  position: "absolute",
                                  inset: 0,
                                  background:
                                    "linear-gradient(90deg, rgba(255,255,255,0.02), rgba(255,255,255,0.14), rgba(255,255,255,0.02))",
                                  opacity: 0.52,
                                  animation:
                                    "post-preview-loading-pulse 1.2s ease-in-out infinite",
                                  zIndex: 2,
                                }}
                              />
                            )}

                            <div aria-hidden="true" style={videoPlayBadgeStyle}>
                              ▶
                            </div>

                            <div
                              aria-hidden="true"
                              style={videoDurationBadgeStyle}
                            >
                              {formatVideoDuration(item.durationSeconds)}
                            </div>
                          </>
                        )}

                        <div style={mediaNumberBadgeStyle}>{index + 1}</div>

                        <button
                          type="button"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() => handleRemoveMedia(index)}
                          style={removeMediaButtonStyle}
                          aria-label={`Quitar media ${index + 1}`}
                          disabled={creating}
                        >
                          ×
                        </button>
                      </div>

                      {item.type === "video" && (
                        <button
                          type="button"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() => handleChooseVideoCover(item.id)}
                          disabled={creating}
                          style={
                            creating
                              ? {
                                  ...videoCoverButtonStyle,
                                  opacity: 0.55,
                                  cursor: "not-allowed",
                                }
                              : videoCoverButtonStyle
                          }
                        >
                          {hasManualCover
                            ? "Cambiar portada"
                            : "Elegir portada"}
                        </button>
                      )}
                    </div>
                  );
                })}

                {Array.from({ length: processingImageSlots }).map(
                  (_, index) => (
                    <div
                      key={`processing-image-${index}`}
                      aria-label="Preparando imagen"
                      style={{
                        ...mediaPreviewWrapStyle,
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(255,255,255,0.055)",
                        animation:
                          "post-preview-loading-pulse 1.6s ease-in-out infinite",
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
                  ),
                )}

                {Array.from({ length: processingVideoSlots }).map(
                  (_, index) => (
                    <div
                      key={`processing-video-${index}`}
                      aria-label="Preparando video"
                      style={{
                        ...mediaPreviewWrapStyle,
                        border: "1px solid rgba(168,85,247,0.24)",
                        background:
                          "linear-gradient(135deg, rgba(76,29,149,0.72), rgba(168,85,247,0.22), rgba(49,46,129,0.68))",
                        backgroundSize: "220% 220%",
                        animation:
                          "post-preview-video-cover-loading 1.45s ease-in-out infinite",
                      }}
                    >
                      <div
                        aria-hidden="true"
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "grid",
                          placeItems: "center",
                          color: "rgba(255,255,255,0.92)",
                          textAlign: "center",
                          padding: 10,
                          boxSizing: "border-box",
                        }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gap: 6,
                            justifyItems: "center",
                          }}
                        >
                          <span style={{ fontSize: 21, lineHeight: 1 }}>
                            🎥
                          </span>
                          <span
                            style={{
                              fontSize: 10.5,
                              fontWeight: 800,
                              lineHeight: 1.15,
                            }}
                          >
                            Preparando video
                          </span>
                        </div>
                      </div>
                    </div>
                  ),
                )}

                {canAddMoreMedia && (
                  <button
                    type="button"
                    onClick={handleOpenMediaPicker}
                    disabled={creating}
                    style={
                      creating
                        ? {
                            ...addMoreMediaButtonStyle,
                            opacity: 0.5,
                            cursor: "not-allowed",
                          }
                        : addMoreMediaButtonStyle
                    }
                    aria-label="Agregar otra media"
                  >
                    +
                  </button>
                )}
              </div>
            </div>
          )}

          {localError && <div style={localErrorStyle}>{localError}</div>}

          <div style={actionsRowStyle}>
            <button
              type="button"
              onClick={handleOpenMediaPicker}
              disabled={creating || isPreparingImages}
              style={
                creating || isPreparingImages
                  ? {
                      ...secondaryButtonStyle,
                      opacity: 0.5,
                      cursor: "not-allowed",
                    }
                  : secondaryButtonStyle
              }
              aria-label="Agregar media"
              title="Agregar media"
            >
              <span aria-hidden="true">＋</span>
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
              {isPreparingImages
                ? "Preparando..."
                : creating
                  ? "Publicando..."
                  : "Publicar"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
