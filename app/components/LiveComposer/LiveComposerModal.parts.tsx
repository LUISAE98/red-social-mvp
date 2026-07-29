"use client";

// Tipos, helpers y constantes de LiveComposerModal (aislados).

import Image from "next/image";
import { useState, useEffect, useMemo, useRef, type CSSProperties } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useTranslations } from "next-intl";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { createPortal } from "react-dom";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import { Timestamp, collection, getDocs, query, where } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { auth, db, storage } from "@/lib/firebase";
import { normalizeImageFile } from "@/lib/uploads/image-normalizer";
import { createLivePost, updateLivePost } from "@/lib/posts/post-service";
import type { LiveVisibilityMode, Post, PostLiveData } from "@/lib/posts/types";
import { useAuth } from "@/app/providers";
import { useOwnerWalletData, getWalletScheduleConflictResult } from "@/lib/wallet/ownerWallet";
import ScheduleCalendarOverlay from "@/app/(protected)/wallet/components/ScheduleCalendarOverlay";

export type GroupForBroadcast = {
  id: string;
  name: string | null;
  visibility: "public" | "private" | "hidden" | null;
  avatarUrl: string | null;
};

export type GroupVisibility = "public" | "private" | "hidden" | null;

export type LiveComposerModalProps = {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  editPost?: Post | null;
  onEdited?: (newLiveData: PostLiveData) => void;
  contextType: "group" | "profile";
  groupId?: string | null;
  profileId?: string | null;
  groupVisibility?: GroupVisibility;
};

export const fontStack = "inherit";
export const PANEL_CLOSE_THRESHOLD = 130;

export type MonthNames = [string, string, string, string, string, string, string, string, string, string, string, string];

export function getDaysInMonth(month: string, year: string): number {
  const m = parseInt(month);
  const y = parseInt(year);
  if (!m || !y) return 31;
  return new Date(y, m, 0).getDate();
}

export function buildCurrentYears(): number[] {
  const current = new Date().getFullYear();
  return [current, current + 1, current + 2, current + 3];
}

// Devuelve la fecha de inicio + si el creador fijó hora.
//  - Sin fecha (incluye "solo hora") → null: no se calendariza.
//  - Solo fecha → mediodía local (evita saltos de día por zona horaria), hasTime=false.
//  - Fecha + hora → fecha/hora exacta, hasTime=true.
export function buildScheduledDate(
  day: string, month: string, year: string,
  hour: string, minute: string, period: "AM" | "PM",
  invalidDateTimeMsg: string,
): { date: Date; hasTime: boolean } | null {
  const hasDate = Boolean(day && month && year);
  if (!hasDate) return null;

  const startedTime = Boolean(hour || minute);
  const hasTime = Boolean(hour && minute);
  // Si empezó a poner hora, deben estar hora y minuto completos.
  if (startedTime && !hasTime) throw new Error(invalidDateTimeMsg);

  let h = 12;
  let min = 0;
  if (hasTime) {
    h = parseInt(hour);
    if (period === "PM" && h !== 12) h += 12;
    if (period === "AM" && h === 12) h = 0;
    min = parseInt(minute);
  }
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), h, min, 0);
  if (isNaN(date.getTime())) throw new Error(invalidDateTimeMsg);
  return { date, hasTime };
}

export async function uploadLiveCover(file: File, signInMsg: string): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error(signInMsg);
  const normalized = await normalizeImageFile(file, { maxSizeBytes: 150 * 1024 * 1024 });
  const ext = normalized.file.type === "image/png" ? "png" : "jpg";
  const randomId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  const path = `live-covers/${uid}/${Date.now()}-${randomId}.${ext}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, normalized.file, {
    contentType: normalized.file.type,
    customMetadata: { uploadedBy: uid, usage: "live_cover" },
  });
  return getDownloadURL(storageRef);
}

export function SelectWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
      {children}
      <svg
        width="12" height="12" viewBox="0 0 24 24" fill="none"
        stroke="rgba(255,255,255,0.4)" strokeWidth="2.5"
        strokeLinecap="round" strokeLinejoin="round"
        style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  );
}

export function parseScheduledTimestamp(ts: Timestamp | null | undefined): {
  day: string; month: string; year: string;
  hour: string; minute: string; period: "AM" | "PM";
} {
  if (!ts) return { day: "", month: "", year: "", hour: "", minute: "", period: "AM" };
  const d = ts.toDate();
  const h24 = d.getHours();
  const period: "AM" | "PM" = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return {
    day: String(d.getDate()),
    month: String(d.getMonth() + 1),
    year: String(d.getFullYear()),
    hour: String(h12),
    minute: String(d.getMinutes()).padStart(2, "0"),
    period,
  };
}

export function deriveDefaultVisibility(
  contextType: "group" | "profile",
  groupVisibility: GroupVisibility,
): LiveVisibilityMode {
  if (contextType === "group" && (groupVisibility === "hidden" || groupVisibility === "private")) {
    return "members_only";
  }
  return "everyone";
}

export type VisibilityOption = {
  mode: LiveVisibilityMode;
  title: string;
  description: string;
  icon: "globe" | "user" | "lock";
};

export type VisibilityTranslations = {
  everyoneTitle: string;
  everyoneDesc: string;
  loggedInTitle: string;
  loggedInDesc: string;
  anyVibraUser: string;
  anyVibraUserDesc: string;
  membersTitle: string;
  membersDesc: string;
};

export function getVisibilityOptions(
  contextType: "group" | "profile",
  groupVisibility: GroupVisibility,
  t: VisibilityTranslations,
): VisibilityOption[] {
  if (contextType === "profile" || groupVisibility === "public") {
    return [
      { mode: "everyone", icon: "globe", title: t.everyoneTitle, description: t.everyoneDesc },
      { mode: "logged_in_only", icon: "user", title: t.loggedInTitle, description: t.loggedInDesc },
    ];
  }
  if (groupVisibility === "private") {
    return [
      { mode: "members_only", icon: "lock", title: t.membersTitle, description: t.membersDesc },
      { mode: "logged_in_only", icon: "user", title: t.anyVibraUser, description: t.anyVibraUserDesc },
      { mode: "everyone", icon: "globe", title: t.everyoneTitle, description: t.everyoneDesc },
    ];
  }
  return [];
}

