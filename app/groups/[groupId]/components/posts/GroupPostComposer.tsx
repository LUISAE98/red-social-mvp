"use client";

import Link from "next/link";
import {
  MAX_POST_IMAGES,
  type GroupVisibility,
  type Post,
  type PostMedia,
  type PostPremium,
} from "@/lib/posts/types";
import {
  MAX_VIDEO_DURATION_FREE_SECONDS,
  MAX_VIDEO_DURATION_PREMIUM_SECONDS,
} from "@/lib/posts/premium";
import { VibraNavigationIcon } from "@/app/components/VibraServiceIcons/VibraNavigationIcons";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import { normalizeImageFile } from "@/lib/uploads/image-normalizer";
import PostComposerDesktopOverlay from "./PostComposerDesktopOverlay";
import PostComposerMobileOverlay from "./PostComposerMobileOverlay";
import { useComposerPremium } from "./useComposerPremium";

type ComposerMediaItem = {
  type: "image" | "video";
  file: File;
  coverFile?: File | null;
  existingPostMedia?: PostMedia;
};

type ComposerContextType = "group" | "profile";

type GroupPostComposerSubmitPayload = {
  text: string;
  contextType: ComposerContextType;
  imageFiles?: File[];
  videoFiles?: File[];
  mediaItems?: ComposerMediaItem[];
  premium?: PostPremium | null;
};

export type { GroupPostComposerSubmitPayload };

type GroupPostComposerProps = {
  onSubmit: (payload: GroupPostComposerSubmitPayload) => Promise<void>;
  contextType?: ComposerContextType;
  groupVisibility?: GroupVisibility | null;
  isOwner?: boolean;
  editPost?: Post | null;
  onEditClose?: () => void;
};

type SelectedMediaItem = ComposerMediaItem & {
  id: string;
  previewUrl: string;
  durationSeconds: number | null;
  coverPreviewUrl?: string | null;
  autoCoverUrl?: string | null;
  autoCoverFile?: File | null;
  coverStatus?: "loading" | "ready" | "error";
  locked?: boolean;
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
  groupVisibility = null,
  isOwner = false,
  editPost,
  onEditClose,
}: GroupPostComposerProps) {
  const isEditMode = !!editPost;
  const [text, setText] = useState(() => editPost?.text ?? "");
  const [creating, setCreating] = useState(false);
  const [isComposerOverlayOpen, setIsComposerOverlayOpen] = useState(() => isEditMode);
  const [isMobileComposer, setIsMobileComposer] = useState(false);
  const [currentUserHandle, setCurrentUserHandle] = useState<string | null>(
    null,
  );
  const [selectedMediaItems, setSelectedMediaItems] = useState<
    SelectedMediaItem[]
  >(() => {
    if (!editPost || !Array.isArray(editPost.media)) return [];
    return editPost.media
      .filter((item) => typeof item.url === "string" && item.url.trim().length > 0)
      .map((item) => ({
        id: item.id ?? item.url,
        type: item.type,
        file: new File([], item.id ?? "media", {
          type: item.mimeType ?? (item.type === "video" ? "video/mp4" : "image/jpeg"),
        }),
        previewUrl: item.type === "video" ? (item.thumbnailUrl ?? item.url) : item.url,
        durationSeconds: item.duration ?? null,
        coverFile: null,
        coverPreviewUrl: null,
        autoCoverUrl: item.type === "video" ? (item.thumbnailUrl ?? null) : null,
        autoCoverFile: null,
        coverStatus: "ready" as const,
        existingPostMedia: item,
        locked: editPost.premium?.enabled === true && item.type === "video",
      }));
  });
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
        existingPostMedia: item.existingPostMedia,
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

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)");

    function syncComposerMode() {
      setIsMobileComposer(mediaQuery.matches);
    }

    syncComposerMode();

    mediaQuery.addEventListener("change", syncComposerMode);

    return () => {
      mediaQuery.removeEventListener("change", syncComposerMode);
    };
  }, []);

  const currentUserHref = currentUserHandle ? `/u/${currentUserHandle}` : "#";
  const hasContent = text.trim().length > 0 || selectedMediaItems.length > 0;
  const isPreparingImages =
    processingImageSlots > 0 || processingVideoSlots > 0;
  const canAddMoreMedia =
    selectedImages.length + processingImageSlots < MAX_POST_IMAGES ||
    selectedVideos.length + processingVideoSlots < MAX_POST_VIDEOS;

      const hasVideos = selectedVideos.length > 0;

  const composerPremium = useComposerPremium({
    hasVideos,
    contextType,
    groupVisibility,
    viewerIsOwner: isOwner,
    initialPremium: editPost?.premium,
  });

  function handleOpenComposerOverlay() {
    if (creating) return;
    setIsComposerOverlayOpen(true);
  }

  function handleOpenMediaPicker() {
    if (creating || isPreparingImages) return;
    fileInputRef.current?.click();
  }

  function updatePostType(_nextItems: SelectedMediaItem[]) {
    return;
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

    nextItems.forEach((item) => {
      void readVideoDurationFromUrl(item.previewUrl).then((durationSeconds) => {
        const isPremium = composerPremium.premiumEnabled;
        const maxDuration = isPremium
          ? MAX_VIDEO_DURATION_PREMIUM_SECONDS
          : MAX_VIDEO_DURATION_FREE_SECONDS;

        if (durationSeconds !== null && durationSeconds > maxDuration) {
          URL.revokeObjectURL(item.previewUrl);
          setSelectedMediaItems((current) =>
            current.filter((i) => i.id !== item.id),
          );
          const maxMin = Math.round(maxDuration / 60);
          setLocalError(
            isPremium
              ? `Tu video excede el límite de ${maxMin} minutos para posts premium.`
              : `Tu video excede los ${maxMin} minutos permitidos. Activa "Monetizar Video" antes de subirlo para poder subir videos de hasta 3 horas.`,
          );
          return;
        }

        setSelectedMediaItems((current) =>
          current.map((currentItem) =>
            currentItem.id === item.id
              ? { ...currentItem, durationSeconds }
              : currentItem,
          ),
        );
      });

      void captureFirstVideoFrame(item.previewUrl, item.file.name).then(
        (cover) => {
          setSelectedMediaItems((current) =>
            current.map((currentItem) => {
              if (currentItem.id !== item.id) return currentItem;

              if (!cover) {
                return { ...currentItem, coverStatus: "error" };
              }

              if (
                currentItem.autoCoverUrl &&
                currentItem.autoCoverUrl !== cover.previewUrl
              ) {
                URL.revokeObjectURL(currentItem.autoCoverUrl);
              }

              return {
                ...currentItem,
                autoCoverFile: cover.file,
                autoCoverUrl: cover.previewUrl,
                coverStatus: "ready",
              };
            }),
          );
        },
      );
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

      if (itemToRemove?.locked) return current;

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

            if (
        composerPremium.premiumEnabled &&
        !composerPremium.validation.valid
      ) {
        setLocalError(
          composerPremium.validation.errors[0]?.message ??
            "Revisa la configuración premium.",
        );
        setCreating(false);
        return;
      }

      await onSubmit({
        text: text.trim(),
        contextType,
        imageFiles: selectedImages,
        videoFiles: selectedVideos,
        mediaItems: orderedSubmitMediaItems,
        premium: composerPremium.premium,
      });

      if (isEditMode) {
        setIsComposerOverlayOpen(false);
        onEditClose?.();
      } else {
        setText("");
        clearSelectedMedia();
        composerPremium.resetPremium();
        setIsComposerOverlayOpen(false);
      }

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
    border: "transparent",
    background: "rgba(255,255,255,0.022)",
    color: "#fff",
    padding: 12,
    boxSizing: "border-box",
    backdropFilter: "blur(10px)",
  };

const launcherButtonStyle: CSSProperties = {
  width: "100%",
  minHeight: 42,
  padding: "10px 16px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.035)",
  color: text.trim().length > 0 ? "#fff" : "rgba(255,255,255,0.42)",
  outline: "none",
  fontSize: 13,
  fontWeight: 300,
  lineHeight: "20px",
  fontFamily: fontStack,
  boxSizing: "border-box",
  textAlign: "left",
  cursor: creating ? "not-allowed" : "text",
  overflow: "hidden",
  display: "block",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
};

  const primaryButtonStyle: CSSProperties = {
    width: 44,
    height: 44,
    minHeight: 44,
    padding: 0,
    borderRadius: 0,
    border: "none",
    background: "transparent",
    color: "#a855ff",
    fontSize: 20,
    fontWeight: 600,
    fontFamily: fontStack,
    cursor: "pointer",
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  };

  const disabledButtonStyle: CSSProperties = {
    ...primaryButtonStyle,
    background: "transparent",
    border: "none",
    color: "rgba(168,85,255,0.36)",
    cursor: "not-allowed",
  };

  const secondaryButtonStyle: CSSProperties = {
    width: 30,
    height: 44,
    minHeight: 44,
    padding: 0,
    borderRadius: 0,
    border: "none",
    background: "transparent",
    color: "#a855ff",
    fontSize: 20,
    fontWeight: 600,
    fontFamily: fontStack,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
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
    <>
      <section style={cardStyle}>
        <input
          ref={fileInputRef}
          type="file"
          accept={isEditMode && composerPremium.premiumEnabled ? "image/*,.heic,.heif" : "image/*,.heic,.heif,video/*"}
          multiple
          style={{ display: "none" }}
          onChange={async (event) => {
            const input = event.currentTarget;
            const files = Array.from(input.files ?? []);

            if (files.length > 0) {
              await handleMediaSelected(files);
              setIsComposerOverlayOpen(true);
            }

            input.value = "";
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

        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <Link
            href={currentUserHref}
            style={{
              display: "inline-flex",
              flexShrink: 0,
              marginTop: 2,
            }}
          >
            <Avatar
              name={currentUserName}
              avatarUrl={currentUserAvatar}
              size={48}
            />
          </Link>

          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                width: "100%",
              }}
            >
              <button
                type="button"
                onClick={handleOpenComposerOverlay}
                disabled={creating}
                style={launcherButtonStyle}
                aria-label="Abrir editor de publicación"
                title="Abrir editor de publicación"
              >
                {text.trim().length > 0
                  ? text.trim()
                  : contextType === "profile"
                    ? "Comparte algo en tu perfil..."
                    : "Comparte algo en esta comunidad..."}
              </button>

              <button
                type="button"
                onClick={handleOpenComposerOverlay}
                disabled={creating || isPreparingImages}
                style={
                  creating || isPreparingImages
                    ? disabledButtonStyle
                    : primaryButtonStyle
                }
                aria-label={
                  isPreparingImages
                    ? "Preparando publicación"
                    : creating
                      ? "Publicando"
                      : "Abrir editor para publicar"
                }
                title={
                  isPreparingImages
                    ? "Preparando..."
                    : creating
                      ? "Publicando..."
                      : "Publicar"
                }
              >
                <VibraNavigationIcon
                  type="publish"
                  size={30}
                  strokeWidth={2.1}
                />
              </button>

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
                <VibraNavigationIcon
                  type="attachMedia"
                  size={30}
                  strokeWidth={2.1}
                />
              </button>
            </div>

            {localError && <div style={localErrorStyle}>{localError}</div>}
          </div>
        </div>
      </section>

      {isMobileComposer ? (
        <PostComposerMobileOverlay
          open={isComposerOverlayOpen}
          isEditMode={isEditMode}
          onClose={() => {
            setIsComposerOverlayOpen(false);
            if (isEditMode) onEditClose?.();
          }}
          text={text}
          setText={setText}
          contextType={contextType}
          currentUserName={currentUserName}
          currentUserAvatar={currentUserAvatar}
          currentUserHref={currentUserHref}
          creating={creating}
          isPreparingImages={isPreparingImages}
          hasContent={hasContent}
          hasVideos={hasVideos}
          premiumComposer={composerPremium}
          localError={localError}
          selectedMediaItems={selectedMediaItems}
          processingImageSlots={processingImageSlots}
          processingVideoSlots={processingVideoSlots}
          canAddMoreMedia={canAddMoreMedia}
          previewScrollerRef={previewScrollerRef}
          draggingPreviewIndex={draggingPreviewIndex}
          dragOverPreviewIndex={dragOverPreviewIndex}
          isReorderingPreview={isReorderingPreview}
          onSubmit={handleSubmit}
          onOpenMediaPicker={handleOpenMediaPicker}
          onRemoveMedia={handleRemoveMedia}
          onChooseVideoCover={handleChooseVideoCover}
          onPreviewPointerDown={handlePreviewPointerDown}
          onPreviewPointerMove={handlePreviewPointerMove}
          onPreviewPointerUp={handlePreviewPointerUp}
        />
      ) : (
        <PostComposerDesktopOverlay
          open={isComposerOverlayOpen}
          isEditMode={isEditMode}
          onClose={() => {
            setIsComposerOverlayOpen(false);
            if (isEditMode) onEditClose?.();
          }}
          text={text}
          setText={setText}
          contextType={contextType}
          currentUserName={currentUserName}
          currentUserAvatar={currentUserAvatar}
          currentUserHref={currentUserHref}
          creating={creating}
          isPreparingImages={isPreparingImages}
          hasContent={hasContent}
          hasVideos={hasVideos}
          premiumComposer={composerPremium}
          localError={localError}
          selectedMediaItems={selectedMediaItems}
          processingImageSlots={processingImageSlots}
          processingVideoSlots={processingVideoSlots}
          canAddMoreMedia={canAddMoreMedia}
          previewScrollerRef={previewScrollerRef}
          draggingPreviewIndex={draggingPreviewIndex}
          dragOverPreviewIndex={dragOverPreviewIndex}
          isReorderingPreview={isReorderingPreview}
          onSubmit={handleSubmit}
          onOpenMediaPicker={handleOpenMediaPicker}
          onRemoveMedia={handleRemoveMedia}
          onChooseVideoCover={handleChooseVideoCover}
          onPreviewPointerDown={handlePreviewPointerDown}
          onPreviewPointerMove={handlePreviewPointerMove}
          onPreviewPointerUp={handlePreviewPointerUp}
        />
      )}
    </>
  );
}
