"use client";

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
import {
  SelectWrapper, PANEL_CLOSE_THRESHOLD, fontStack,
  buildCurrentYears, buildScheduledDate, deriveDefaultVisibility,
  getDaysInMonth, getVisibilityOptions, parseScheduledTimestamp, uploadLiveCover,
  type GroupForBroadcast, type LiveComposerModalProps, type MonthNames,
  type VisibilityTranslations,
} from "./LiveComposerModal.parts";

export default function LiveComposerModal({
  open,
  onClose,
  onSuccess,
  editPost,
  onEdited,
  contextType,
  groupId,
  profileId,
  groupVisibility,
}: LiveComposerModalProps) {
  const tCommon = useTranslations("common");
  const tLive = useTranslations("live");
  const isEditMode = !!editPost;

  const MONTHS: MonthNames = [
    tLive("monthJan"), tLive("monthFeb"), tLive("monthMar"), tLive("monthApr"),
    tLive("monthMay"), tLive("monthJun"), tLive("monthJul"), tLive("monthAug"),
    tLive("monthSep"), tLive("monthOct"), tLive("monthNov"), tLive("monthDec"),
  ];

  const visibilityTranslations: VisibilityTranslations = {
    everyoneTitle: tLive("privacyEveryoneTitle"),
    everyoneDesc: tLive("privacyEveryoneDesc"),
    loggedInTitle: tLive("privacyLoggedInTitle"),
    loggedInDesc: tLive("privacyLoggedInDesc"),
    anyVibraUser: tLive("privacyAnyVibraUser"),
    anyVibraUserDesc: tLive("privacyAnyVibraUserDesc"),
    membersTitle: tLive("privacyMembersTitle"),
    membersDesc: tLive("privacyMembersDesc"),
  };

  const [mounted, setMounted] = useState(false);
  const [shouldRender, setShouldRender] = useState(open);
  const [isDesktop, setIsDesktop] = useState(false);

  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [existingCoverUrl, setExistingCoverUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [hour, setHour] = useState("");
  const [minute, setMinute] = useState("");
  const [period, setPeriod] = useState<"AM" | "PM">("AM");
  const [saving, setSaving] = useState(false);
  const { toast: liveComposerToast, showToast: showLiveComposerToast } = useVibraToast();
  const [accessType, setAccessType] = useState<"free" | "paid">("free");
  const [ticketPrice, setTicketPrice] = useState("");
  const { resolveStoredPrice, toDisplayForInput, currency: displayCurrency, formatAnchor } =
    usePriceFormat();
  const [paidAccessMode, setPaidAccessMode] = useState<"everyone_pays" | "members_free_non_members_pay">("everyone_pays");
  const [calendarOpen, setCalendarOpen] = useState(false);

  const { user } = useAuth();
  // Calendario del creador (solo mientras el composer está abierto). Se usa para
  // avisar (guía, no bloqueo) si el live con hora choca con una sesión agendada.
  const walletCalendar = useOwnerWalletData(open ? (user?.uid ?? null) : null).calendar;
  const scheduleConflictMsg = useMemo(() => {
    if (!(day && month && year && hour && minute)) return null;
    let built: { date: Date; hasTime: boolean } | null = null;
    try {
      built = buildScheduledDate(day, month, year, hour, minute, period, "");
    } catch {
      return null;
    }
    if (!built || !built.hasTime) return null;
    const sessions = walletCalendar.filter((i) => i.source !== "live");
    const res = getWalletScheduleConflictResult(
      { id: editPost?.id, source: "live", scheduledAt: built.date, durationMinutes: 60 },
      sessions
    );
    const conflict = res.conflictItem;
    if (!res.hasConflict || !conflict || !conflict.scheduledAt) return null;
    const label = conflict.source === "exclusive_session" ? tLive("conflictExclusiveSession") : tLive("conflictMeetGreet");
    const time = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" }).format(
      conflict.scheduledAt
    );
    return tLive("composerScheduleConflict", { item: label, time });
  }, [day, month, year, hour, minute, period, walletCalendar, editPost?.id]);

  const isHiddenGroup = contextType === "group" && groupVisibility === "hidden";
  const visibilityOptions = getVisibilityOptions(contextType, groupVisibility ?? null, visibilityTranslations);
  const [visibilityMode, setVisibilityMode] = useState<LiveVisibilityMode>(
    deriveDefaultVisibility(contextType, groupVisibility ?? null)
  );

  // Broadcast to other communities
  const [userGroups, setUserGroups] = useState<GroupForBroadcast[]>([]);
  const [broadcastGroupIds, setBroadcastGroupIds] = useState<string[]>([]);
  const isPrivateGroupOrigin = contextType === "group" && groupVisibility === "private";

  // Mobile swipe-to-close
  const [panelOffsetY, setPanelOffsetY] = useState(0);
  const [isPanelDragging, setIsPanelDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartOffset = useRef(0);

  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 768);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      if (!isDesktop) {
        setIsPanelDragging(false);
        const h = typeof window !== "undefined" ? window.innerHeight : 900;
        setPanelOffsetY(h);
        const f = window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => setPanelOffsetY(0));
        });
        return () => window.cancelAnimationFrame(f);
      }
      return;
    }
    if (!isDesktop) {
      const h = typeof window !== "undefined" ? window.innerHeight : 900;
      setPanelOffsetY(h);
      const t = window.setTimeout(() => setShouldRender(false), 260);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setShouldRender(false), 180);
    return () => window.clearTimeout(t);
  }, [open, isDesktop]);

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onCloseRef.current(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    return () => {
      if (coverPreviewUrl && coverFile) URL.revokeObjectURL(coverPreviewUrl);
    };
  }, [coverPreviewUrl, coverFile]);

  useEffect(() => {
    if (!open || !editPost?.liveData) return;
    const ld = editPost.liveData;
    setTitle(ld.title ?? "");
    setDescription(ld.description ?? "");
    setExistingCoverUrl(ld.coverUrl ?? null);
    setCoverPreviewUrl(ld.coverUrl ?? null);
    setCoverFile(null);
    setVisibilityMode(ld.visibilityMode ?? deriveDefaultVisibility(contextType, groupVisibility ?? null));
    setAccessType(ld.accessType ?? "free");
    setTicketPrice(
      ld.ticketPrice != null
        ? String(Math.round(toDisplayForInput(ld.ticketPrice, ld.currency ?? "MXN") * 100) / 100)
        : ""
    );
    setPaidAccessMode(ld.paidAccessMode ?? "everyone_pays");
    setBroadcastGroupIds(ld.broadcastGroupIds ?? []);
    const parsed = parseScheduledTimestamp(ld.scheduledStartAt);
    setDay(parsed.day);
    setMonth(parsed.month);
    setYear(parsed.year);
    setHour(parsed.hour);
    setMinute(parsed.minute);
    setPeriod(parsed.period);
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editPost?.id]);

  // Fetch user's group memberships for the broadcast selector
  useEffect(() => {
    if (!open || isHiddenGroup) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    getDocs(query(
      collection(db, "groups"),
      where("ownerId", "==", uid),
    )).then((snap) => {
      const groups: GroupForBroadcast[] = snap.docs
        .map((d) => {
          const data = d.data() as Record<string, unknown>;
          if (data.isDeleted === true) return null;
          const vis = typeof data.visibility === "string" ? data.visibility : null;
          if (vis === "hidden") return null;
          if (d.id === groupId) return null; // exclude current group
          return {
            id: d.id,
            name: typeof data.name === "string" ? data.name : null,
            visibility: (vis === "public" || vis === "private") ? vis : null,
            avatarUrl: typeof data.avatarUrl === "string" ? data.avatarUrl : null,
          } as GroupForBroadcast;
        })
        .filter((g): g is GroupForBroadcast => g !== null);
      setUserGroups(groups);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isHiddenGroup, groupId]);

  // Auto-force visibility to "everyone" when broadcasting to a public destination from a private group
  useEffect(() => {
    if (!isPrivateGroupOrigin) return;
    const hasPublicDest = broadcastGroupIds.some((id) => {
      if (id === "__profile__") return true;
      return userGroups.find((g) => g.id === id)?.visibility === "public";
    });
    if (hasPublicDest) setVisibilityMode("everyone");
  }, [broadcastGroupIds, isPrivateGroupOrigin, userGroups]);

  const daysInMonth = getDaysInMonth(month, year);
  const years = buildCurrentYears();

  function resetForm() {
    setCoverFile(null);
    setCoverPreviewUrl(null);
    setExistingCoverUrl(null);
    setTitle(""); setDescription("");
    setDay(""); setMonth(""); setYear("");
    setHour(""); setMinute(""); setPeriod("AM");
    setVisibilityMode(deriveDefaultVisibility(contextType, groupVisibility ?? null));
    setAccessType("free");
    setTicketPrice("");
    setPaidAccessMode("everyone_pays");
    setBroadcastGroupIds([]);
      }

  function handleClose() {
    if (saving) return;
    resetForm();
    onClose();
  }

  function handleCoverClick() {
    if (saving) return;
    coverInputRef.current?.click();
  }

  function handleCoverFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0] ?? null;
    e.currentTarget.value = "";
    if (!file) return;
    if (coverFile && coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    setCoverFile(file);
    setExistingCoverUrl(null);
    setCoverPreviewUrl(URL.createObjectURL(file));
  }

  async function handleSubmit() {
    if (saving) return;
    if (!title.trim()) { showLiveComposerToast(tLive("titleRequired"), "error"); return; }

    let scheduledDate: Date | null = null;
    let scheduleHasTime = false;
    try {
      const built = buildScheduledDate(day, month, year, hour, minute, period, tLive("invalidDateTime"));
      if (built) {
        scheduledDate = built.date;
        scheduleHasTime = built.hasTime;
      }
    } catch (e) {
      showLiveComposerToast(e instanceof Error ? e.message : tLive("invalidDateTime"), "error");
      return;
    }

    const priceNum = parseFloat(ticketPrice.replace(",", "."));
    if (accessType === "paid" && (isNaN(priceNum) || priceNum <= 0)) {
      showLiveComposerToast(tLive("ticketPriceRequired"), "error");
      return;
    }

        setSaving(true);

    try {
      let finalCoverUrl: string | null = existingCoverUrl;
      if (coverFile) finalCoverUrl = await uploadLiveCover(coverFile, tLive("uploadCoverSignIn"));

      const effectiveMode: LiveVisibilityMode = isHiddenGroup ? "members_only" : visibilityMode;
      const cleanTitle = title.trim();
      const cleanDescription = description.trim() || null;

      const canHaveMemberExemption =
        contextType === "group" &&
        groupVisibility === "private" &&
        effectiveMode !== "members_only";
      const effectivePaidAccessMode = canHaveMemberExemption ? paidAccessMode : "everyone_pays";
      // El creador teclea en su moneda; se guarda en MXN (ancla).
      const storedTicket = accessType === "paid" ? resolveStoredPrice(priceNum) : null;
      const finalTicketPrice = storedTicket ? storedTicket.price : null;
      const finalCurrency = storedTicket ? storedTicket.currency : null;
      const finalPaidAccessMode = accessType === "paid" ? effectivePaidAccessMode : null;

      // Strip "__profile__" from community IDs before saving; it's stored separately as broadcast sentinel
      const finalBroadcastGroupIds = broadcastGroupIds.filter((id) => id !== "__profile__");

      if (isEditMode && editPost) {
        await updateLivePost({
          postId: editPost.id,
          title: cleanTitle,
          description: cleanDescription,
          coverUrl: finalCoverUrl,
          scheduledStartAt: scheduledDate,
          scheduleHasTime: scheduledDate ? scheduleHasTime : null,
          visibilityMode: effectiveMode,
          accessType,
          ticketPrice: finalTicketPrice,
          currency: finalCurrency,
          paidAccessMode: finalPaidAccessMode,
          broadcastGroupIds: finalBroadcastGroupIds,
        });
        const newLiveData: PostLiveData = {
          ...editPost.liveData,
          title: cleanTitle,
          description: cleanDescription,
          coverUrl: finalCoverUrl,
          scheduledStartAt: scheduledDate ? Timestamp.fromDate(scheduledDate) : null,
          scheduleHasTime: scheduledDate ? scheduleHasTime : null,
          visibilityMode: effectiveMode,
          allowLoggedOutViewers: effectiveMode === "everyone",
          accessType,
          ticketPrice: finalTicketPrice,
          currency: finalCurrency,
          paidAccessMode: finalPaidAccessMode,
          broadcastGroupIds: finalBroadcastGroupIds.length > 0 ? finalBroadcastGroupIds : null,
        };
        onEdited?.(newLiveData);
        resetForm();
        onClose();
        return;
      }

      if (contextType === "profile" && profileId) {
        await createLivePost({
          contextType: "profile",
          profileId,
          title: cleanTitle,
          description: cleanDescription,
          coverUrl: finalCoverUrl,
          scheduledStartAt: scheduledDate,
          scheduleHasTime: scheduledDate ? scheduleHasTime : null,
          visibilityMode: effectiveMode,
          accessType,
          ticketPrice: finalTicketPrice,
          currency: finalCurrency,
          paidAccessMode: finalPaidAccessMode,
          broadcastGroupIds: finalBroadcastGroupIds,
        });
      } else if (groupId) {
        await createLivePost({
          groupId,
          title: cleanTitle,
          description: cleanDescription,
          coverUrl: finalCoverUrl,
          scheduledStartAt: scheduledDate,
          scheduleHasTime: scheduledDate ? scheduleHasTime : null,
          visibilityMode: effectiveMode,
          accessType,
          ticketPrice: finalTicketPrice,
          currency: finalCurrency,
          paidAccessMode: finalPaidAccessMode,
          broadcastGroupIds: finalBroadcastGroupIds,
        });
      } else {
        throw new Error(tLive("invalidContext"));
      }

      resetForm();
      onSuccess?.();
      onClose();
    } catch (e) {
      showLiveComposerToast(e instanceof Error ? e.message : isEditMode ? tLive("saveLiveError") : tLive("createLiveError"), "error");
    } finally {
      setSaving(false);
    }
  }

  // Mobile drag handlers
  function handleDragStart(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    setIsPanelDragging(true);
    dragStartY.current = e.clientY;
    dragStartOffset.current = panelOffsetY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handleDragMove(e: React.PointerEvent) {
    if (!isPanelDragging) return;
    const raw = dragStartOffset.current + (e.clientY - dragStartY.current);
    const h = typeof window !== "undefined" ? window.innerHeight : 900;
    setPanelOffsetY(raw >= 0 ? Math.min(h, raw) : raw * 0.2);
  }

  function handleDragEnd() {
    if (!isPanelDragging) return;
    setIsPanelDragging(false);
    if (panelOffsetY >= PANEL_CLOSE_THRESHOLD) {
      if (saving) { setPanelOffsetY(0); return; }
      const h = typeof window !== "undefined" ? window.innerHeight : 900;
      setPanelOffsetY(h);
      setTimeout(() => { resetForm(); onCloseRef.current(); setPanelOffsetY(0); }, 260);
    } else {
      setPanelOffsetY(0);
    }
  }

  if (!shouldRender || !mounted) return null;

  const selectStyle: CSSProperties = {
    width: "100%",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "#1a0f2e",
    color: "#fff",
    padding: "8px 30px 8px 12px",
    fontSize: 14,
    fontFamily: fontStack,
    outline: "none",
    boxSizing: "border-box",
    appearance: "none",
    WebkitAppearance: "none",
    cursor: saving ? "not-allowed" : "pointer",
    colorScheme: "dark",
  };

  const inputStyle: CSSProperties = {
    width: "100%",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    padding: "8px 12px",
    fontSize: 14,
    fontFamily: fontStack,
    outline: "none",
    boxSizing: "border-box",
    marginBottom: 8,
  };

  const labelStyle: CSSProperties = {
    fontSize: 11,
    fontWeight: 500,
    color: "rgba(255,255,255,0.5)",
    letterSpacing: "0.03em",
    textTransform: "uppercase",
    marginBottom: 3,
    display: "block",
  };

  const scrollContent = (
    <div className="vibra-live-scroll" style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "18px 20px 8px" }}>

      {/* Portada */}
      <input
        ref={coverInputRef}
        type="file"
        accept="image/*,.heic,.heif"
        style={{ display: "none" }}
        onChange={handleCoverFileChange}
      />
      <label style={labelStyle}>{tLive("composerCoverLabel")}</label>
      <button
        type="button"
        onClick={handleCoverClick}
        disabled={saving}
        aria-label={coverPreviewUrl ? tLive("changeCover") : tLive("addCover")}
        style={{
          width: "100%", aspectRatio: "16/7", borderRadius: 12,
          border: coverPreviewUrl ? "none" : "1.5px dashed rgba(255,255,255,0.18)",
          background: coverPreviewUrl
            ? "transparent"
            : "radial-gradient(ellipse at center, rgba(180,180,200,0.22) 0%, rgba(120,120,150,0.10) 60%, rgba(80,80,110,0.06) 100%)",
          cursor: saving ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 8, overflow: "hidden", padding: 0, position: "relative",
        }}
      >
        {coverPreviewUrl ? (
          <>
            <Image src={coverPreviewUrl} alt={tLive("coverAlt")} fill style={{ objectFit: "cover", display: "block" }} />
            <div
              style={{
                position: "absolute", inset: 0, display: "flex",
                alignItems: "center", justifyContent: "center",
                background: "rgba(0,0,0,0.45)", opacity: 0, transition: "opacity 150ms ease",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = "1"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = "0"; }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: "#fff", fontFamily: fontStack }}>{tLive("changeCover")}</span>
            </div>
          </>
        ) : (
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none" style={{ pointerEvents: "none" }}>
            <circle cx="18" cy="18" r="16" stroke="#ef4444" strokeWidth="1.8" fill="none" />
            <circle cx="18" cy="18" r="9" fill="#ef4444" />
          </svg>
        )}
      </button>

      {/* Título */}
      <label style={labelStyle}>{tLive("composerTitleLabel")}</label>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={tLive("composerTitlePlaceholder")}
        disabled={saving}
        maxLength={120}
        style={inputStyle}
        autoFocus={isDesktop}
      />

      {/* Descripción */}
      <label style={labelStyle}>{tLive("composerDescriptionLabel")}</label>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={tLive("descriptionPlaceholder")}
        disabled={saving}
        maxLength={500}
        rows={3}
        style={{ ...inputStyle, resize: "none", minHeight: 44 }}
      />

      {/* Visibilidad */}
      <label style={{ ...labelStyle, marginTop: 2 }}>{tLive("composerVisibilityLabel")}</label>
      {isHiddenGroup ? (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 12px", borderRadius: 10,
          background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", marginBottom: 8,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.6)", fontFamily: fontStack }}>
              {tLive("composerMembersOnly")}
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: fontStack, marginTop: 1 }}>
              {tLive("composerHiddenNoPublic")}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 8, borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
          {visibilityOptions.map((opt, idx) => {
            const active = visibilityMode === opt.mode;
            const isLast = idx === visibilityOptions.length - 1;
            return (
              <div
                key={opt.mode}
                className="vibra-live-radio"
                onClick={() => !saving && setVisibilityMode(opt.mode)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", cursor: saving ? "not-allowed" : "pointer",
                  borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.06)",
                  background: active ? "rgba(168,85,255,0.10)" : "transparent",
                  userSelect: "none",
                }}
              >
                <div style={{
                  width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                  border: active ? "5px solid #a855f7" : "2px solid rgba(255,255,255,0.25)",
                  boxSizing: "border-box", transition: "border 120ms ease",
                }} />
                <div style={{ flexShrink: 0, color: active ? "#c084fc" : "rgba(255,255,255,0.35)" }}>
                  {opt.icon === "globe" && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="2" y1="12" x2="22" y2="12" />
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                  )}
                  {opt.icon === "user" && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  )}
                  {opt.icon === "lock" && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: active ? "#e9d5ff" : "#fff", fontFamily: fontStack }}>{opt.title}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: fontStack, marginTop: 2, lineHeight: 1.4 }}>{opt.description}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Ticket */}
      <label style={{ ...labelStyle, marginTop: 2 }}>Ticket de entrada</label>
      <div style={{ marginBottom: 8, borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
        {(["free", "paid"] as const).map((type, idx) => {
          const active = accessType === type;
          return (
            <div
              key={type}
              onClick={() => !saving && setAccessType(type)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", cursor: saving ? "not-allowed" : "pointer",
                borderBottom: idx === 0 ? "1px solid rgba(255,255,255,0.06)" : "none",
                background: active ? "rgba(168,85,255,0.10)" : "transparent",
                userSelect: "none",
              }}
            >
              <div style={{
                width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                border: active ? "5px solid #a855f7" : "2px solid rgba(255,255,255,0.25)",
                boxSizing: "border-box" as const, transition: "border 120ms ease",
              }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: active ? "#e9d5ff" : "#fff", fontFamily: fontStack }}>
                  {type === "free" ? tLive("ticketFree") : tLive("ticketPaid")}
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: fontStack, marginTop: 2 }}>
                  {type === "free" ? tLive("ticketFreeDesc") : tLive("ticketPaidDesc")}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {accessType === "paid" && (
        <>
          <label style={labelStyle}>{tLive("composerTicketPriceLabel")}</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1, position: "relative" as const }}>
              <input
                type="number"
                min="1"
                step="any"
                value={ticketPrice}
                onChange={(e) => setTicketPrice(e.target.value)}
                placeholder="0.00"
                disabled={saving}
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const }}
              />
            </div>
            <div style={{
              width: 90, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(255,255,255,0.06)", borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: fontStack,
            }}>
              {displayCurrency}
            </div>
          </div>
          {displayCurrency !== "USD" && ticketPrice && Number(ticketPrice) > 0 ? (
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: -4, marginBottom: 8, fontFamily: fontStack }}>
              = {formatAnchor(resolveStoredPrice(Number(ticketPrice)).price)}
            </div>
          ) : null}

          {contextType === "group" && groupVisibility === "private" && visibilityMode !== "members_only" && (
            <>
              <label style={labelStyle}>{tLive("whoPays")}</label>
              <div style={{ marginBottom: 8, borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
                {([
                  { value: "everyone_pays", label: tLive("payAllPay"), desc: tLive("payAllPayDesc") },
                  { value: "members_free_non_members_pay", label: tLive("payMembersFree"), desc: tLive("payMembersFreeDesc") },
                ] as const).map(({ value, label, desc }, idx) => {
                  const active = paidAccessMode === value;
                  return (
                    <div
                      key={value}
                      onClick={() => !saving && setPaidAccessMode(value)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "10px 12px", cursor: saving ? "not-allowed" : "pointer",
                        borderBottom: idx === 0 ? "1px solid rgba(255,255,255,0.06)" : "none",
                        background: active ? "rgba(168,85,255,0.10)" : "transparent",
                        userSelect: "none",
                      }}
                    >
                      <div style={{
                        width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                        border: active ? "5px solid #a855f7" : "2px solid rgba(255,255,255,0.25)",
                        boxSizing: "border-box" as const, transition: "border 120ms ease",
                      }} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: active ? "#e9d5ff" : "#fff", fontFamily: fontStack }}>{label}</div>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: fontStack, marginTop: 2, lineHeight: 1.4 }}>{desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* Fecha */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <label style={labelStyle}>{tLive("composerStartDateLabel")}</label>
        <button
          type="button"
          onClick={() => setCalendarOpen(true)}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 12,
            fontWeight: 600,
            color: "#c084fc",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {tLive("composerViewCalendar")}
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <SelectWrapper>
          <select value={day} onChange={(e) => setDay(e.target.value)} disabled={saving} style={selectStyle} className="vibra-live-select">
            <option value="">{tLive("composerDay")}</option>
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
              <option key={d} value={String(d)}>{d}</option>
            ))}
          </select>
        </SelectWrapper>
        <SelectWrapper>
          <select
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              if (day && parseInt(day) > getDaysInMonth(e.target.value, year)) setDay("");
            }}
            disabled={saving}
            style={selectStyle}
            className="vibra-live-select"
          >
            <option value="">{tLive("composerMonth")}</option>
            {MONTHS.map((name, i) => (
              <option key={i + 1} value={String(i + 1)}>{name}</option>
            ))}
          </select>
        </SelectWrapper>
        <SelectWrapper>
          <select value={year} onChange={(e) => setYear(e.target.value)} disabled={saving} style={selectStyle} className="vibra-live-select">
            <option value="">{tLive("composerYear")}</option>
            {years.map((y) => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </select>
        </SelectWrapper>
      </div>

      {/* Hora */}
      <label style={labelStyle}>{tLive("composerStartTimeLabel")}</label>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <SelectWrapper>
          <select value={hour} onChange={(e) => setHour(e.target.value)} disabled={saving} style={selectStyle} className="vibra-live-select">
            <option value="">{tLive("composerHour")}</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
              <option key={h} value={String(h)}>{h}</option>
            ))}
          </select>
        </SelectWrapper>
        <SelectWrapper>
          <select value={minute} onChange={(e) => setMinute(e.target.value)} disabled={saving} style={selectStyle} className="vibra-live-select">
            <option value="">{tLive("composerMin")}</option>
            {["00","05","10","15","20","25","30","35","40","45","50","55"].map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </SelectWrapper>
        <SelectWrapper>
          <select value={period} onChange={(e) => setPeriod(e.target.value as "AM" | "PM")} disabled={saving} style={selectStyle} className="vibra-live-select">
            <option value="AM">AM</option>
            <option value="PM">PM</option>
          </select>
        </SelectWrapper>
      </div>

      {scheduleConflictMsg && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
            padding: "10px 12px",
            borderRadius: 12,
            marginBottom: 10,
            background: "rgba(250, 204, 21, 0.10)",
            border: "1px solid rgba(250, 204, 21, 0.28)",
            color: "#fde68a",
            fontSize: 12.5,
            lineHeight: 1.4,
          }}
        >
          <span aria-hidden="true">⚠️</span>
          <span>{scheduleConflictMsg}</span>
        </div>
      )}

      <ScheduleCalendarOverlay
        open={calendarOpen}
        title={tLive("composerYourCalendar")}
        items={walletCalendar}
        excludeId={editPost?.id}
        selectedVariant="pink"
        selectedDate={
          day && month && year
            ? new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
            : null
        }
        onSelectDate={(date) => {
          setDay(String(date.getDate()));
          setMonth(String(date.getMonth() + 1));
          setYear(String(date.getFullYear()));
        }}
        onClose={() => setCalendarOpen(false)}
      />

      {/* Broadcast a otras comunidades */}
      {!isHiddenGroup && (() => {
        // Build the list of destinations to show
        const destinations: Array<{ id: string; name: string; visibility: "public" | "private" | null; avatarUrl: string | null; isProfile: boolean }> = [];

        // When creating from a community: offer the creator's profile + other communities
        if (contextType === "group") {
          destinations.push({ id: "__profile__", name: tLive("yourProfile"), visibility: "public", avatarUrl: null, isProfile: true });
        }

        // Non-hidden communities (excluding origin group)
        userGroups.forEach((g) => {
          if (g.visibility !== "hidden") {
            destinations.push({ id: g.id, name: g.name ?? tLive("communityFallback"), visibility: g.visibility ?? null, avatarUrl: g.avatarUrl, isProfile: false });
          }
        });

        if (destinations.length === 0) return null;

        const broadcastHasPublicDest = isPrivateGroupOrigin && broadcastGroupIds.some((id) => {
          if (id === "__profile__") return true;
          return userGroups.find((g) => g.id === id)?.visibility === "public";
        });

        return (
          <>
            <div style={{ height: 1, background: "rgba(255,255,255,0.07)", margin: "14px 0 14px" }} />
            <label style={labelStyle}>{tLive("composerAlsoBroadcastOn")}</label>

            {broadcastHasPublicDest && (
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 9,
                padding: "9px 12px", borderRadius: 10, marginBottom: 10,
                background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.22)",
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span style={{ fontSize: 11, color: "#eab308", lineHeight: 1.5, fontFamily: fontStack }}>
                  {tLive("composerPublicNotice")}
                </span>
              </div>
            )}

            <div style={{ borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden", marginBottom: 10 }}>
              {destinations.map((dest, idx) => {
                const isSelected = broadcastGroupIds.includes(dest.id);
                const visLabel = dest.visibility === "public" ? tLive("visPublic") : dest.visibility === "private" ? tLive("visPrivate") : "";
                const isLast = idx === destinations.length - 1;
                return (
                  <div
                    key={dest.id}
                    onClick={() => {
                      if (saving) return;
                      setBroadcastGroupIds((prev) =>
                        prev.includes(dest.id) ? prev.filter((x) => x !== dest.id) : [...prev, dest.id]
                      );
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "9px 12px",
                      borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.06)",
                      cursor: saving ? "not-allowed" : "pointer",
                      userSelect: "none",
                    }}
                    className="vibra-live-radio"
                  >
                    {/* Avatar */}
                    <div style={{
                      width: 30, height: 30, borderRadius: "50%", flexShrink: 0, overflow: "hidden",
                      background: "linear-gradient(135deg, #ec4899 0%, #9333ea 100%)",
                      display: "grid", placeItems: "center", position: "relative",
                    }}>
                      {dest.isProfile ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                          <circle cx="12" cy="7" r="4" />
                        </svg>
                      ) : dest.avatarUrl ? (
                        <img src={dest.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", fontFamily: fontStack }}>
                          {(dest.name ?? "C").charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>

                    {/* Name + visibility */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#fff", fontFamily: fontStack, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {dest.name}
                      </span>
                      {visLabel && (
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: fontStack }}>
                          {visLabel}
                        </span>
                      )}
                    </div>

                    {/* Toggle */}
                    <div
                      style={{
                        width: 38, height: 22, borderRadius: 11, flexShrink: 0,
                        background: isSelected ? "#a855f7" : "rgba(255,255,255,0.12)",
                        position: "relative", transition: "background 0.18s ease",
                      }}
                    >
                      <div style={{
                        position: "absolute", top: 3, left: isSelected ? 18 : 3,
                        width: 16, height: 16, borderRadius: "50%",
                        background: "#fff",
                        transition: "left 0.18s ease",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}

    </div>
  );

  const footerContent = (
    <div style={{
      paddingTop: isDesktop ? 14 : 10,
      paddingRight: 20,
      paddingBottom: isDesktop ? 18 : "calc(14px + env(safe-area-inset-bottom))" as CSSProperties["paddingBottom"],
      paddingLeft: 20,
      borderTop: `1px solid rgba(255,255,255,${isDesktop ? "0.12" : "0.07"})`,
      flexShrink: 0,
    }}>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={saving}
        style={{
          width: "100%", height: 42, borderRadius: 5, border: "none",
          background: saving ? "rgba(255,255,255,0.1)" : "#a855ff",
          color: saving ? "rgba(255,255,255,0.36)" : "rgba(255,255,255,0.98)",
          fontSize: 17, fontWeight: 500, fontFamily: fontStack,
          cursor: saving ? "not-allowed" : "pointer",
          letterSpacing: "-0.02em", display: "grid", placeItems: "center",
        }}
      >
        {saving
          ? (isEditMode ? tCommon("saving") : tLive("creatingLive"))
          : (isEditMode ? tCommon("saveChanges") : tLive("scheduleLive"))
        }
      </button>
    </div>
  );

  return createPortal(
    <>
      <VibraToast toast={liveComposerToast} />
      <style>{`
        @keyframes vibraLiveModalIn {
          from { opacity: 0; transform: scale(0.94) translateY(10px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes vibraLiveModalOut {
          from { opacity: 1; transform: scale(1) translateY(0); }
          to   { opacity: 0; transform: scale(0.94) translateY(10px); }
        }
        .vibra-live-scroll::-webkit-scrollbar { width: 7px; height: 7px; }
        .vibra-live-scroll::-webkit-scrollbar-track { background: transparent; }
        .vibra-live-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); border-radius: 999px; }
        .vibra-live-select option { background: #1a0f2e; color: #fff; }
        .vibra-live-radio:hover { background: rgba(255,255,255,0.06); }
      `}</style>

      {/* Backdrop */}
      <div
        onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}
        style={{
          position: "fixed",
          inset: 0,
          width: "100vw",
          height: "100dvh",
          zIndex: 999999,
          display: "flex",
          alignItems: isDesktop ? "center" : "flex-end",
          justifyContent: "center",
          padding: isDesktop ? 24 : 0,
          background: isDesktop ? "rgba(0,0,0,0.88)" : "rgba(0,0,0,0.52)",
          backdropFilter: isDesktop ? undefined : "blur(10px)",
          WebkitBackdropFilter: isDesktop ? undefined : "blur(10px)",
          fontFamily: "inherit",
        }}
      >
        {isDesktop ? (
          /* Desktop: panel centrado */
          <section
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={isEditMode ? tLive("editLive") : tLive("scheduledLive")}
            style={{
              width: "min(100%, 540px)",
              maxHeight: "min(88vh, 680px)",
              display: "flex",
              flexDirection: "column",
              borderRadius: 18,
              background: "#0a0a0a",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
              color: "#fff",
              overflow: "hidden",
              animation: open
                ? "vibraLiveModalIn 180ms ease-out"
                : "vibraLiveModalOut 180ms ease-in forwards",
            }}
          >
            <header style={{
              height: 56,
              display: "grid",
              gridTemplateColumns: "48px 1fr 48px",
              alignItems: "center",
              padding: "0 12px",
              borderBottom: "1px solid rgba(255,255,255,0.12)",
              flexShrink: 0,
            } as CSSProperties}>
              <div />
              <span style={{ fontSize: 17, fontWeight: 500, color: "#fff", lineHeight: 1.2, textAlign: "center", letterSpacing: "-0.02em" }}>
                {isEditMode ? tLive("editLive") : tLive("scheduledLive")}
              </span>
              <button
                type="button"
                onClick={handleClose}
                disabled={saving}
                aria-label={tCommon("closeAriaLabel")}
                style={{
                  border: "none", background: "none", color: "#fff",
                  cursor: saving ? "not-allowed" : "pointer",
                  display: "grid", placeItems: "center", justifySelf: "end", padding: 4,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </header>
            {scrollContent}
            {footerContent}
          </section>
        ) : (
          /* Mobile: bottom sheet 3 capas */
          <div
            role="dialog"
            aria-modal="true"
            aria-label={isEditMode ? tLive("editLive") : tLive("scheduledLive")}
            style={{
              width: "100%",
              maxHeight: "calc(100dvh - 72px)",
              display: "flex",
              flexDirection: "column",
              background: "rgba(8,9,11,0.96)",
              transform: open
                ? `translateY(${Math.max(0, panelOffsetY)}px)`
                : "translateY(100%)",
              transition: isPanelDragging ? "none" : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
              willChange: "transform",
            }}
          >
            {/* section-wrapper: rubber band hacia arriba */}
            <div style={{
              transform: `translateY(${Math.min(0, panelOffsetY)}px)`,
              transition: isPanelDragging ? "none" : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}>
              <section style={{
                maxHeight: "calc(100dvh - 140px)",
                borderRadius: "22px 22px 0 0",
                background: "rgba(8,9,11,0.96)",
                boxShadow: "0 -24px 80px rgba(0,0,0,0.56)",
                color: "#fff",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}>
                <header
                  onPointerDown={handleDragStart}
                  onPointerMove={handleDragMove}
                  onPointerUp={handleDragEnd}
                  onPointerCancel={handleDragEnd}
                  style={{
                    height: 56,
                    display: "grid",
                    gridTemplateColumns: "72px 1fr 72px",
                    alignItems: "center",
                    padding: "0 12px",
                    borderBottom: "1px solid rgba(255,255,255,0.07)",
                    flexShrink: 0,
                    touchAction: "none",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                  } as CSSProperties}
                >
                  <div aria-hidden="true" />
                  <h3 style={{ margin: 0, textAlign: "center", fontSize: 17, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1.2, color: "#fff" }}>
                    {isEditMode ? tLive("editLive") : tLive("scheduledLive")}
                  </h3>
                  <button
                    type="button"
                    onClick={handleClose}
                    style={{
                      width: 40, height: 40, border: "none", background: "transparent",
                      color: "rgba(255,255,255,0.86)", cursor: "pointer",
                      display: "grid", placeItems: "center",
                      fontSize: 32, fontWeight: 300, lineHeight: 1, justifySelf: "end",
                    }}
                  >
                    ×
                  </button>
                </header>
                {scrollContent}
              </section>
            </div>
            {/* Footer anclado fuera del rubber band */}
            {footerContent}
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
