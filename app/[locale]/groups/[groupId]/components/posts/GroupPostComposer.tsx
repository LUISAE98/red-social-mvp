"use client";

import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
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
import VibraSendIcon from "@/app/components/VibraServiceIcons/VibraSendIcon";
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
import {
  Avatar, MAX_POST_VIDEOS, fontStack,
  captureFirstVideoFrame, createLocalMediaId, readVideoDurationFromUrl,
  type ComposerMediaItem, type GroupPostComposerProps, type SelectedMediaItem,
} from "./GroupPostComposer.parts";
export type { GroupPostComposerSubmitPayload } from "./GroupPostComposer.parts";

export default function GroupPostComposer({
  onSubmit,
  onLiveClick,
  contextType = "group",
  groupVisibility = null,
  isOwner = false,
  editPost,
  onEditClose,
  autoOpenPremium = false,
}: GroupPostComposerProps) {
  const tGroups = useTranslations("groups");
  const tCommon = useTranslations("common");
  const tPosts = useTranslations("posts");
  const tLive = useTranslations("live");
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
  const { toast: composerToast, showToast: showComposerToast } = useVibraToast();
  const processingImageSlots = 0;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* El aviso sale por VibraToast. Antes se pintaba como caja roja aquí Y otra
     vez dentro de cada overlay, con el estilo que el catálogo retiró. */
  useEffect(() => {
    if (!localError) return;
    showComposerToast(localError, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Respaldo del precio: hay posts que lo tienen solo aquí y no en `premium.price`.
    initialOneTimePrice: editPost?.oneTimePrice ?? null,
  });

  function handleOpenComposerOverlay() {
    if (creating) return;
    setIsComposerOverlayOpen(true);
  }

  // Deep-link "Crea tu primera publicación premium": abre el overlay y deja el
  // toggle de monetización (premium) activado para que el creador solo suba su
  // video y ponga precio. Solo una vez al montar.
  const autoPremiumDone = useRef(false);
  useEffect(() => {
    if (!autoOpenPremium || autoPremiumDone.current) return;
    autoPremiumDone.current = true;
    setIsComposerOverlayOpen(true);
    composerPremium.setPremiumEnabled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenPremium]);

  function handleOpenMediaPicker() {
    if (creating || isPreparingImages) return;
    fileInputRef.current?.click();
  }

  function updatePostType() {
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
        tGroups("tooManyImages", { max: MAX_POST_IMAGES }),
      );
      return;
    }

    const filesToAdd = files.slice(0, availableSlots);

    if (files.length > availableSlots) {
      setLocalError(
        tGroups("onlySomeImagesAdded", { added: availableSlots, max: MAX_POST_IMAGES }),
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
      updatePostType();
      return mergedItems;
    });
  }

  function handleVideoSelected(files: File[]) {
    setLocalError(null);

    if (files.length === 0) return;

    const validVideos = files.filter((file) => file.type.startsWith("video/"));

    if (validVideos.length !== files.length) {
      setLocalError(tGroups("invalidVideoFiles"));
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
      updatePostType();
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
              ? tGroups("videoTooLongPremium", { minutes: maxMin })
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
      setLocalError(tGroups("invalidMediaFiles"));
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
      updatePostType();
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
      setLocalError(tGroups("pickValidCover"));
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
      setLocalError(tGroups("coverPrepareFailed"));
    } finally {
      if (coverInputRef.current) {
        coverInputRef.current.value = "";
      }
    }
  }

  function handleLiveClickFromOverlay() {
    setIsComposerOverlayOpen(false);
    onLiveClick?.();
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
            tGroups("checkPremiumSettings"),
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
    } catch (error: unknown) {
      setLocalError((error instanceof Error ? error.message : null) ?? tGroups("couldNotPublish"));
    } finally {
      setCreating(false);
    }
  }

  const cardStyle: CSSProperties = {
    borderRadius: 12,
    border: "transparent",
    // Sin caja: el compositor se apoya directamente sobre el fondo. Llevaba un
    // velo blanco al 2.2% con desenfoque detrás; el desenfoque se va con él,
    // porque sin nada que tintar era trabajo de pintado a cambio de nada.
    background: "transparent",
    color: "#fff",
    padding: 12,
    boxSizing: "border-box",
  };

// Campo de entrada al compositor. Sigue el estilo canónico de Vibra
// (vibra_style.md → "Textarea") en medidas y tipografía, pero SIN el relleno:
// aquí no es una caja donde se escribe, es el pie que abre el editor completo.
// El texto tecleado va en #fff; el placeholder queda atenuado.
const launcherButtonStyle: CSSProperties = {
  width: "100%",
  minHeight: 42,
  padding: "10px 12px",
  borderRadius: 12,
  border: "none",
  background: "transparent",
  color: text.trim().length > 0 ? "#fff" : "rgba(255,255,255,0.42)",
  outline: "none",
  fontSize: 13,
  fontWeight: 300,
  lineHeight: 1.5,
  fontFamily: fontStack,
  boxSizing: "border-box",
  textAlign: "start",
  cursor: creating ? "not-allowed" : "text",
  overflow: "hidden",
  display: "block",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
};

  /* Misma caja que los otros dos. Llegó a tener 32 para compensar que el avión
     dibujaba más ancho que sus vecinos; ahora dibuja lo mismo y esa
     compensación sobra. */
  const primaryButtonStyle: CSSProperties = {
    width: 30,
    height: 44,
    minHeight: 44,
    padding: 0,
    borderRadius: 0,
    border: "none",
    background: "transparent",
    color: "#a855f7",
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
    color: "#a855f7",
    fontSize: 20,
    fontWeight: 600,
    fontFamily: fontStack,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
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

        {/* Centrado, no anclado arriba. Con `flex-start` el avatar se pegaba al
            techo de la fila mientras el campo y los botones se centraban en sus
            44px de alto: quedaba visiblemente más alto que todo lo demás. La
            fila es de una sola línea —el campo recorta con puntos suspensivos y
            nunca crece—, así que centrar es seguro. */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link
            href={currentUserHref}
            style={{
              display: "inline-flex",
              flexShrink: 0,
            }}
          >
            {/* Al tamaño de los iconos del final del compositor (30), no al de
                un avatar de cabecera: aquí solo dice de quién sale lo que se
                escriba, no es el sujeto de la fila. */}
            <Avatar
              name={currentUserName}
              avatarUrl={currentUserAvatar}
              size={30}
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
                aria-label={tPosts("openEditorLabel")}
                title={tPosts("openEditorLabel")}
              >
                {text.trim().length > 0
                  ? text.trim()
                  : contextType === "profile"
                    ? tPosts("shareOnProfilePlaceholder")
                    : tPosts("shareInCommunityPlaceholder")}
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
                    ? tCommon("uploading")
                    : creating
                      ? tCommon("publishing")
                      : tCommon("publish")
                }
                title={
                  isPreparingImages
                    ? tCommon("uploading")
                    : creating
                      ? tCommon("publishing")
                      : tCommon("publish")
                }
              >
                {/* El MISMO avión que envía un mensaje directo, no el de
                    "publicar" de la familia de navegación. Eran dos dibujos
                    distintos para el mismo gesto y el del chat sienta mejor.

                    A 24, para que DIBUJE 20.3px de ancho: exactamente lo mismo
                    que el clip y el círculo. Poner el mismo número en los tres
                    no sirve, porque cada dibujo llena una parte distinta de su
                    lienzo: el círculo el 97%, el avión el 85% de ancho y el
                    clip el 68%.

                    Su ALTO queda en 18.4 y no en 20.3, y no es un descuido: el
                    avión es un 11% más ancho que alto, así que igualar las dos
                    medidas obligaría a estirarlo y se notaría. Se iguala el
                    ancho, que es la medida que lo hacía verse mayor. Además va
                    relleno, y una forma rellena pesa más a la vista que un
                    contorno del mismo tamaño: quedarse un pelo por debajo es
                    lo que lo empareja de verdad.

                    RECTO, no inclinado. El icono trae de fábrica un giro de -20
                    grados —así va en el chat— y aquí no funciona: al girar, la
                    diagonal del avión ocupa más alto y más ancho que su propia
                    caja, y al lado de un clip y un círculo rectos se leía como
                    el icono más grande de la fila aunque midiera menos.

                    Derecho tampoco hace falta subirlo: ese apaño existía porque
                    la inclinación hundía su masa hacia abajo. Sin giro, el
                    centro geométrico y el óptico coinciden. */}
                <VibraSendIcon size={24} style={{ transform: "none" }} />
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
                aria-label={tPosts("addMedia")}
                title={tPosts("addMedia")}
              >
                <VibraNavigationIcon
                  type="attachMedia"
                  size={30}
                  strokeWidth={2.1}
                />
              </button>

              {onLiveClick && !isEditMode && (
                <button
                  type="button"
                  onClick={onLiveClick}
                  disabled={creating}
                  style={
                    creating
                      ? { ...secondaryButtonStyle, opacity: 0.5, cursor: "not-allowed" }
                      : secondaryButtonStyle
                  }
                  aria-label={tLive("scheduleLive")}
                  title={tLive("scheduleLive")}
                >
                  {/* 21 y no 22: su círculo llena el 97% del lienzo, mientras
                      que el avión llena el 77% y el clip el 68%. Con estos tres
                      números los tres dibujos miden unos 20px de alto REAL, que
                      es lo que se ve. Igualar el atributo `size` los dejaba de
                      alturas distintas. */}
                  <svg
                    width="21"
                    height="21"
                    viewBox="0 0 22 22"
                    fill="none"
                  >
                    {/* Círculo exterior delgado */}
                    <circle cx="11" cy="11" r="10" stroke="#ef4444" strokeWidth="1.4" fill="none" />
                    {/* Círculo relleno interior */}
                    <circle cx="11" cy="11" r="6" fill="#ef4444" />
                  </svg>
                </button>
              )}
            </div>

          </div>
        </div>
      </section>

      {isMobileComposer ? (
        <PostComposerMobileOverlay
          localError={localError}
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
          onLiveClick={onLiveClick ? handleLiveClickFromOverlay : undefined}
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
          onLiveClick={onLiveClick ? handleLiveClickFromOverlay : undefined}
          onRemoveMedia={handleRemoveMedia}
          onChooseVideoCover={handleChooseVideoCover}
          onPreviewPointerDown={handlePreviewPointerDown}
          onPreviewPointerMove={handlePreviewPointerMove}
          onPreviewPointerUp={handlePreviewPointerUp}
        />
      )}
      <VibraToast toast={composerToast} />
    </>
  );
}
