"use client";

// Tipos, helpers y sub-componente Avatar de PostComposerDesktopOverlay.

import Image from "next/image";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { createPortal } from "react-dom";

import { VibraNavigationIcon } from "@/app/components/VibraServiceIcons/VibraNavigationIcons";
import ComposerPremiumPanel from "./ComposerPremiumPanel";
import type { useComposerPremium } from "./useComposerPremium";
import { useTranslations } from "next-intl";

export type SelectedMediaItem = {
  id: string;
  type: "image" | "video";
  file: File;
  previewUrl: string;
  durationSeconds: number | null;
  coverFile?: File | null;
  coverPreviewUrl?: string | null;
  autoCoverUrl?: string | null;
  autoCoverFile?: File | null;
  coverStatus?: "loading" | "ready" | "error";
  locked?: boolean;
};

export type PostComposerDesktopOverlayProps = {
  open: boolean;
  onClose: () => void;

  text: string;
  setText: Dispatch<SetStateAction<string>>;

  contextType?: "group" | "profile";
  currentUserName: string;
  currentUserAvatar: string | null;
  currentUserHref: string;

  creating: boolean;
  isPreparingImages: boolean;
  hasContent: boolean;
  localError: string | null;
  hasVideos: boolean;
  premiumComposer: ReturnType<typeof useComposerPremium>;

  selectedMediaItems: SelectedMediaItem[];
  processingImageSlots: number;
  processingVideoSlots: number;
  canAddMoreMedia: boolean;

  previewScrollerRef: RefObject<HTMLDivElement | null>;
  draggingPreviewIndex: number | null;
  dragOverPreviewIndex: number | null;
  isReorderingPreview: boolean;

  isEditMode?: boolean;

  onSubmit: () => void | Promise<void>;
  onOpenMediaPicker: () => void;
  onLiveClick?: () => void;
  onRemoveMedia: (index: number) => void;
  onChooseVideoCover: (videoId: string) => void;

  onPreviewPointerDown: (
    index: number,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void;
  onPreviewPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPreviewPointerUp: () => void;
};

export const fontStack =
  'inherit';

export function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "U";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

export function formatVideoDuration(durationSeconds: number | null) {
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

export function Avatar({
  name,
  avatarUrl,
  size = 44,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt={name}
        width={size} height={size}
        style={{
          borderRadius: "50%",
          objectFit: "cover",
          display: "block",
          border: "1px solid rgba(255,255,255,0.1)",
          background: "rgba(255,255,255,0.05)",
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
        border: "1px solid rgba(255,255,255,0.1)",
        color: "#fff",
        fontSize: Math.max(12, Math.floor(size * 0.32)),
        fontWeight: 700,
        letterSpacing: "-0.03em",
        flexShrink: 0,
      }}
    >
      {getInitials(name)}
    </div>
  );
}

