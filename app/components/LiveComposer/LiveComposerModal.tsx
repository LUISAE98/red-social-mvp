"use client";

import Image from "next/image";
import { intlLocale } from "@/i18n/locales";
import { useState, useEffect, useMemo, useRef, type CSSProperties } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useTranslations, useLocale } from "next-intl";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { WALLET_NET_RATE } from "@/lib/wallet/walletFinances";
import { FIXED_SERVICE_FEE_MXN, LIVE_TICKET_MIN_PRICE_MXN } from "@/lib/currency/catalog";
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
import WheelPanel from "@/components/ui/WheelPanel";
import { PANEL_CLOSE_THRESHOLD, fontStack,
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
  // Fecha y hora en paneles SEPARADOS: seis tambores a la vez son un muro, y
  // casi siempre se cambia una cosa o la otra, no las dos.
  const [wheelOpen, setWheelOpen] = useState<"date" | "time" | null>(null);
  const tLive = useTranslations("live");
  const locale = useLocale();
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
  // De cinco en cinco: programar un live al minuto exacto no aporta nada.
  const LIVE_MINUTES = [
    "00", "05", "10", "15", "20", "25",
    "30", "35", "40", "45", "50", "55",
  ];

  // Los seis campos que se ven fuera. Cada uno enseña su valor o, si aún no
  // hay, el rótulo de lo que se espera.
  const scheduleFields = [
    { key: "day", texto: day, vacio: tLive("composerDay") },
    {
      key: "month",
      texto: month ? (MONTHS[Number(month) - 1] ?? month) : "",
      vacio: tLive("composerMonth"),
    },
    { key: "year", texto: year, vacio: tLive("composerYear") },
    { key: "hour", texto: hour, vacio: tLive("composerHour") },
    { key: "minute", texto: minute, vacio: tLive("composerMin") },
    { key: "period", texto: period, vacio: period },
  ];
  const [saving, setSaving] = useState(false);
  const { toast: liveComposerToast, showToast: showLiveComposerToast } = useVibraToast();
  const [accessType, setAccessType] = useState<"free" | "paid">("free");
  const [ticketPrice, setTicketPrice] = useState("");
  const { format: formatMoney, toDisplayForInput, currency: displayCurrency } =
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
    const res = getWalletScheduleConflictResult(locale, { id: editPost?.id, source: "live", scheduledAt: built.date, durationMinutes: 60 },
      sessions
    );
    const conflict = res.conflictItem;
    if (!res.hasConflict || !conflict || !conflict.scheduledAt) return null;
    const label = conflict.source === "exclusive_session" ? tLive("conflictExclusiveSession") : tLive("conflictMeetGreet");
    const time = new Intl.DateTimeFormat(intlLocale(locale), { hour: "2-digit", minute: "2-digit" }).format(
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
    if (accessType === "paid" && priceNum < LIVE_TICKET_MIN_PRICE_MXN) {
      showLiveComposerToast(tCommon("priceMin", { min: LIVE_TICKET_MIN_PRICE_MXN }), "error");
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
      // Mexico-only: el creador teclea en MXN y se guarda TAL CUAL en MXN (sin
      // conversión a USD). Es la base — el backend cobra base + $3 + IVA.
      const finalTicketPrice = accessType === "paid" ? priceNum : null;
      const finalCurrency = accessType === "paid" ? "MXN" : null;
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
          // ⚠️ El `&& !isHiddenGroup` NO es opcional: es el mismo guard que aplican las
          // otras dos rutas que escriben este campo (post-service.create.ts:480 y
          // post-service.ts:671). Sin él, EDITAR un live de comunidad oculta lo dejaba
          // abierto a invitados aunque al crearlo hubiera quedado bien.
          // Una comunidad oculta NUNCA expone contenido, sea cual sea el alcance elegido.
          allowLoggedOutViewers: effectiveMode === "everyone" && !isHiddenGroup,
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
      showLiveComposerToast(e instanceof Error ? e.message : isEditMode ? tLive("saveLiveError") : tLive("saveLiveError"), "error");
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

  // Mismo estilo canónico de campo que los inputs (vibra_style.md): fondo sutil sin
  // borde, radio 12, texto 13. Se conserva el padding derecho para la flecha del
  // SelectWrapper y appearance:none.
  const selectStyle: CSSProperties = {
    width: "100%",
    borderRadius: 12,
    border: "none",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    padding: "10px 30px 10px 12px",
    fontSize: 13,
    lineHeight: 1.5,
    fontFamily: fontStack,
    outline: "none",
    boxSizing: "border-box",
    appearance: "none",
    WebkitAppearance: "none",
    cursor: saving ? "not-allowed" : "pointer",
    colorScheme: "dark",
  };

  // Estilo canónico de campo (vibra_style.md): fondo sutil sin borde, radio 12,
  // padding 10/12, texto 13, sin outline. El color del placeholder queda en el
  // default del navegador (no se sobreescribe).
  const inputStyle: CSSProperties = {
    width: "100%",
    borderRadius: 12,
    border: "none",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    padding: "10px 12px",
    fontSize: 13,
    lineHeight: 1.5,
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

  // Precio del ticket (MXN base). Mismo sistema que experiencias/premium:
  // mínimo en rojo, cuánto ganas (75%), leyenda del $3 — todos con colapso suave.
  const ticketPriceNum = parseFloat(ticketPrice.replace(",", "."));
  const ticketHasValidPrice =
    ticketPrice.trim() !== "" && Number.isFinite(ticketPriceNum) && ticketPriceNum > 0;
  const ticketBelowMin = ticketHasValidPrice && ticketPriceNum < LIVE_TICKET_MIN_PRICE_MXN;
  const ticketEarnings = ticketHasValidPrice ? ticketPriceNum * WALLET_NET_RATE : null;
  const ticketEarningsVisible = ticketEarnings != null && ticketEarnings > 0 && !ticketBelowMin;

  const scrollContent = (
    <div className="vibra-live-scroll" style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "18px 20px 8px" }}>

      {/* Ticket */}
      <label style={{ ...labelStyle, marginTop: 2 }}>Ticket de entrada</label>
      <div style={{ marginBottom: 8 }}>
        {(["free", "paid"] as const).map((type, idx) => {
          const active = accessType === type;
          return (
            <div
              key={type}
              className="vibra-live-radio"
              onClick={() => !saving && setAccessType(type)}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "13px 2px", cursor: saving ? "not-allowed" : "pointer",
                borderBottom: idx === 0 ? "1px solid rgba(255,255,255,0.08)" : "none",
                userSelect: "none",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", fontFamily: fontStack }}>
                  {type === "free" ? tLive("ticketFree") : tLive("ticketPaid")}
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: fontStack, marginTop: 2 }}>
                  {type === "free" ? tLive("ticketFreeDesc") : tLive("ticketPaidDesc")}
                </div>
              </div>
              <span style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${active ? "#a855f7" : "rgba(255,255,255,0.25)"}`, display: "grid", placeItems: "center", flexShrink: 0 }}>
                {active && <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#a855f7" }} />}
              </span>
            </div>
          );
        })}
      </div>

      {/* El bloque de pago se DESLIZA suave hacia abajo al activar el ticket de pago,
          y se colapsa suave al cambiar a gratis (no aparece/desaparece de golpe). */}
      <div
        style={{
          maxHeight: accessType === "paid" ? 600 : 0,
          opacity: accessType === "paid" ? 1 : 0,
          overflow: "hidden",
          transition: "max-height 300ms ease, opacity 240ms ease",
        }}
      >
          {/* Presentación IGUAL a experiencias/premium: el campo es un input autónomo
              (estilo canónico vibra_style.md); el "+ $3" y la moneda van FUERA, como
              hermanos en la fila (no dentro del placeholder). */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <input
              type="number"
              min="1"
              step="any"
              value={ticketPrice}
              onChange={(e) => setTicketPrice(e.target.value)}
              placeholder="0.00"
              disabled={saving}
              style={{ ...inputStyle, flex: "1 1 180px", width: "auto", minWidth: 0, marginBottom: 0 }}
            />

            <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
              + $3
            </span>

            <span style={{ color: "#a855f7", fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
              {displayCurrency}
            </span>
          </div>

          {/* Avisos que COLAPSAN suave (como en experiencias): mínimo en rojo,
              cuánto ganas (75%), y la leyenda del cargo fijo de Stripe. */}
          <div style={{ marginBottom: 8 }}>
            <div
              style={{
                maxHeight: ticketBelowMin ? 24 : 0,
                opacity: ticketBelowMin ? 1 : 0,
                transform: ticketBelowMin ? "translateY(0)" : "translateY(4px)",
                overflow: "hidden",
                transition: "max-height 220ms ease, opacity 220ms ease, transform 220ms ease",
              }}
            >
              <span style={{ display: "block", color: "#f87171", fontSize: 12, lineHeight: 1.45, fontFamily: fontStack }}>
                {tCommon("priceMin", { min: LIVE_TICKET_MIN_PRICE_MXN })}
              </span>
            </div>

            <div
              style={{
                maxHeight: ticketEarningsVisible ? 24 : 0,
                opacity: ticketEarningsVisible ? 1 : 0,
                transform: ticketEarningsVisible ? "translateY(0)" : "translateY(4px)",
                overflow: "hidden",
                transition: "max-height 220ms ease, opacity 220ms ease, transform 220ms ease",
              }}
            >
              <span style={{ display: "block", color: "rgba(255,255,255,0.55)", fontSize: 12, lineHeight: 1.45, fontFamily: fontStack }}>
                Ganas{" "}
                <strong style={{ color: "#a855f7", fontWeight: 700 }}>
                  {formatMoney(ticketEarnings ?? 0, { baseCurrency: "MXN", code: true })}
                </strong>{" "}
                por cada entrada
              </span>
            </div>

            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, lineHeight: 1.4, fontFamily: fontStack, marginTop: 3 }}>
              Se suman ${FIXED_SERVICE_FEE_MXN} MXN por el cargo de procesamiento de Stripe.
            </div>
          </div>

          {/* "Quién paga": aparece de inmediato al elegir entrada de pago en una comunidad
              privada, INDEPENDIENTE de la visibilidad (que se elige más abajo). Si al final
              la visibilidad queda en "solo miembros", el guardado normaliza a everyone_pays
              (no hay no-miembros a quién eximir). Mismo estilo que "Ticket de entrada". */}
          {contextType === "group" && groupVisibility === "private" && (
            <>
              <label style={labelStyle}>{tLive("whoPays")}</label>
              <div style={{ marginBottom: 8 }}>
                {([
                  { value: "everyone_pays", label: tLive("payAllPay"), desc: tLive("payAllPayDesc") },
                  { value: "members_free_non_members_pay", label: tLive("payMembersFree"), desc: tLive("payMembersFreeDesc") },
                ] as const).map(({ value, label, desc }, idx) => {
                  const active = paidAccessMode === value;
                  return (
                    <div
                      key={value}
                      className="vibra-live-radio"
                      onClick={() => !saving && setPaidAccessMode(value)}
                      style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "13px 2px", cursor: saving ? "not-allowed" : "pointer",
                        borderBottom: idx === 0 ? "1px solid rgba(255,255,255,0.08)" : "none",
                        userSelect: "none",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", fontFamily: fontStack }}>{label}</div>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: fontStack, marginTop: 2, lineHeight: 1.4 }}>{desc}</div>
                      </div>
                      <span style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${active ? "#a855f7" : "rgba(255,255,255,0.25)"}`, display: "grid", placeItems: "center", flexShrink: 0 }}>
                        {active && <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#a855f7" }} />}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
      </div>

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
          border: "none",
          background: coverPreviewUrl
            ? "transparent"
            : "linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0.6)), url('/live.webp') center / cover no-repeat",
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
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, pointerEvents: "none", padding: "0 12px" }}>
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
              <circle cx="18" cy="18" r="16" stroke="#ef4444" strokeWidth="1.8" fill="none" />
              <circle cx="18" cy="18" r="9" fill="#ef4444" />
            </svg>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#a855f7", fontFamily: fontStack, textAlign: "center", lineHeight: 1.3 }}>
              Da clic aquí para elegir una portada
            </span>
          </div>
        )}
      </button>

      {/* Título */}
      <label style={labelStyle}>{tLive("composerTitleLabel")}</label>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder=""
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
        placeholder=""
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
        <div style={{ marginBottom: 8 }}>
          {visibilityOptions.map((opt, idx) => {
            const active = visibilityMode === opt.mode;
            const isLast = idx === visibilityOptions.length - 1;
            return (
              <div
                key={opt.mode}
                className="vibra-live-radio"
                onClick={() => !saving && setVisibilityMode(opt.mode)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "13px 2px", cursor: saving ? "not-allowed" : "pointer",
                  borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.08)",
                  userSelect: "none",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", fontFamily: fontStack }}>{opt.title}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: fontStack, marginTop: 2, lineHeight: 1.4 }}>{opt.description}</div>
                </div>
                <span style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${active ? "#a855f7" : "rgba(255,255,255,0.25)"}`, display: "grid", placeItems: "center", flexShrink: 0 }}>
                  {active && <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#a855f7" }} />}
                </span>
              </div>
            );
          })}
        </div>
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
      {/* Los campos siguen separados, como antes: de un vistazo se ve que
          falta por llenar. Lo que cambia es que ninguno es ya una lista del
          sistema — cualquiera de los seis abre los mismos tambores. */}
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        {scheduleFields.slice(0, 3).map((campo) => (
          <button
            key={campo.key}
            type="button"
            onClick={() => setWheelOpen("date")}
            disabled={saving}
            style={{
              ...selectStyle,
              flex: 1,
              minWidth: 0,
              textAlign: "start",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              cursor: saving ? "not-allowed" : "pointer",
              color: campo.texto ? "#fff" : "rgba(255,255,255,0.45)",
            }}
          >
            {campo.texto || campo.vacio}
          </button>
        ))}
      </div>

      <label style={labelStyle}>{tLive("composerStartTimeLabel")}</label>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        {scheduleFields.slice(3).map((campo) => (
          <button
            key={campo.key}
            type="button"
            onClick={() => setWheelOpen("time")}
            disabled={saving}
            style={{
              ...selectStyle,
              flex: 1,
              minWidth: 0,
              textAlign: "start",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              cursor: saving ? "not-allowed" : "pointer",
              color: campo.texto ? "#fff" : "rgba(255,255,255,0.45)",
            }}
          >
            {campo.texto || campo.vacio}
          </button>
        ))}
      </div>

      <WheelPanel
        open={wheelOpen === "date"}
        onClose={() => setWheelOpen(null)}
        onConfirm={() => setWheelOpen(null)}
        title={tCommon("date")}
        confirmLabel={tCommon("save")}
        closeAriaLabel={tCommon("closeAriaLabel")}
        /* El compositor vive en 999999; sin subir esto, el panel se dibuja
           DETRAS y parece que no abre. */
        zIndexBase={1000010}
        columns={[
          {
            key: "day",
            label: tLive("composerDay"),
            items: Array.from({ length: daysInMonth }, (_, i) => ({
              value: String(i + 1),
              label: String(i + 1),
            })),
            value: day || "1",
            onChange: setDay,
          },
          {
            key: "month",
            label: tLive("composerMonth"),
            items: MONTHS.map((name, i) => ({ value: String(i + 1), label: name })),
            value: month || "1",
            onChange: (m) => {
              setMonth(m);
              // El dia se cae si deja de existir en el mes nuevo.
              if (day && parseInt(day) > getDaysInMonth(m, year)) setDay("");
            },
            loop: true,
            flex: 1.6,
          },
          {
            key: "year",
            label: tLive("composerYear"),
            items: years.map((y) => ({ value: String(y), label: String(y) })),
            value: year || String(years[0] ?? ""),
            onChange: setYear,
          },
        ]}
      />

      <WheelPanel
        open={wheelOpen === "time"}
        onClose={() => setWheelOpen(null)}
        onConfirm={() => setWheelOpen(null)}
        title={tCommon("time")}
        confirmLabel={tCommon("save")}
        closeAriaLabel={tCommon("closeAriaLabel")}
        zIndexBase={1000010}
        columns={[
          {
            key: "hour",
            label: tLive("composerHour"),
            items: Array.from({ length: 12 }, (_, i) => ({
              value: String(i + 1),
              label: String(i + 1),
            })),
            value: hour || "12",
            onChange: setHour,
          },
          {
            key: "minute",
            label: tLive("composerMin"),
            items: LIVE_MINUTES.map((m) => ({ value: m, label: m })),
            value: minute || "00",
            onChange: setMinute,
          },
          {
            key: "period",
            label: tLive("composerStartTimeLabel"),
            items: [
              { value: "AM", label: "AM" },
              { value: "PM", label: "PM" },
            ],
            value: period,
            onChange: (p) => setPeriod(p as "AM" | "PM"),
          },
        ]}
      />

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
                        position: "absolute", top: 3, insetInlineStart: isSelected ? 18 : 3,
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
      paddingInlineEnd: 20,
      paddingBottom: isDesktop ? 18 : "calc(14px + var(--vb-safe-bottom, 0px))" as CSSProperties["paddingBottom"],
      paddingInlineStart: 20,
      borderTop: `1px solid rgba(255,255,255,${isDesktop ? "0.12" : "0.07"})`,
      flexShrink: 0,
    }}>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={saving}
        style={{
          width: "100%", height: 42, borderRadius: 5, border: "none",
          background: saving ? "rgba(255,255,255,0.1)" : "#a855f7",
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
        .vibra-live-radio { transition: transform 160ms ease; }
        @media (hover: hover) {
          .vibra-live-radio:hover { transform: scale(1.02); }
        }
        @media (prefers-reduced-motion: reduce) {
          .vibra-live-radio { transition: none; }
          .vibra-live-radio:hover { transform: none; }
        }
      `}</style>

      {/* Backdrop */}
      <div
        onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}
        style={{
          position: "fixed",
          inset: 0,
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
