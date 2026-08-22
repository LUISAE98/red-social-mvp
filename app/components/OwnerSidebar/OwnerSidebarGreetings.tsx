"use client";

import Image from "next/image";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { useCfError } from "@/lib/i18n/cfError";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { WALLET_NET_RATE } from "@/lib/wallet/walletFinances";
import {
  acceptMeetGreetRequest,
  proposeMeetGreetSchedule,
  rejectMeetGreetRequest,
  requestMeetGreetRefund,
  requestMeetGreetReschedule,
  declineMeetGreetReschedule,
  setMeetGreetPreparing,
} from "@/lib/meetGreet/meetGreetRequests";
import {
  acceptExclusiveSessionRequest,
  proposeExclusiveSessionSchedule,
  rejectExclusiveSessionRequest,
  requestExclusiveSessionRefund,
  requestExclusiveSessionReschedule,
  declineExclusiveSessionReschedule,
  setExclusiveSessionPreparing,
} from "@/lib/exclusiveSession/exclusiveSessionRequests";
import { requestGreetingRefund } from "@/lib/greetings/greetingRequests";
import { type Timestamp } from "firebase/firestore";
import { callGetRecordingDownloadUrl } from "@/lib/liveKit/sessionLifecycle";
import type {
  GroupDocLite,
  GreetingRequestDoc,
  MeetGreetRequestDoc,
  ExclusiveSessionRequestDoc,
  UserMini,
} from "./OwnerSidebar";
import { Chevron } from "./OwnerSidebar";
import PaymentSuccessCard from "@/components/payments/PaymentSuccessCard";
import BuyerGreetingRequestOverlay from "./BuyerGreetingRequestOverlay";
import BuyerSessionRequestOverlay from "./BuyerSessionRequestOverlay";
import SessionRequestOverlay from "./SessionRequestOverlay";
import GreetingReviewOverlay from "./GreetingReviewOverlay";
import MeetGreetPreparationFullscreen from "@/app/components/meetGreet/MeetGreetPreparationFullscreen";
import ScheduleDateTimeSelector, {
  getSchedulePartsFromDate,
  schedulePartsToIso,
  type ScheduleParts,
} from "@/app/(protected)/wallet/components/ScheduleDateTimeSelector";
import ScheduleCalendarOverlay from "@/app/(protected)/wallet/components/ScheduleCalendarOverlay";
import { WalletServiceRow } from "@/app/(protected)/wallet/components/WalletUi";
import {
  getWalletScheduleConflictResult,
  type WalletServiceItem,
} from "@/lib/wallet/ownerWallet";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import {
  ScheduledRow, SectionBlock,
  cardButtonColumnStyle, cardButtonStyle,
  displayRowStatus, fmtScheduledSplit, getCreatorScheduleNote,
  getMeetGreetStatusLabel, getRelativeTime, getSectionForMeetGreetStatus,
  GREETING_RESPONSE_DAYS, SESSION_RESPONSE_DAYS, responseDaysLeft,
  getServiceCardColors, greetingBgImage, isNoShowExpired, isPrepareWindowOpen,
  isProfileRequest, isRefundStatus, isReturnedRow, remainingReschedules, serviceCardBackground,
  serviceCardBackgroundStyle, sortDisplayRows, sortResolvedDesc, toDateSafe,
  type BusyMap, type DisplayRow, type Props, type ScheduledServiceKind,
  type ServiceSectionKey, type TextMap, type ToggleMap,
} from "./OwnerSidebarGreetings.parts";

/**
 * Estados de pago en los que el dinero YA volvió al comprador, por la vía que sea.
 *
 *  · `canceled` — se liberó la retención: nunca se llegó a cobrar (flujo del hold vivo).
 *  · `refunded` — se cobró y luego se devolvió como saldo a favor.
 *
 * ⚠️ En ninguno de los dos debe ofrecerse «pedir devolución». Solo se miraba `refunded`,
 * así que tras liberar una retención el botón seguía ahí: el comprador pedía la devolución
 * de un dinero que ya tenía, y con eso movía la experiencia a «En devolución» sin motivo,
 * perdiendo de paso el «intentar de nuevo».
 */
const PAGO_YA_DEVUELTO = ["canceled", "refunded"];
export default function OwnerSidebarGreetings({
  buyerPending,
  buyerDelivered,
  buyerRejectedGreetings,
  buyerMeetGreets,
  buyerExclusiveSessions,
  meetGreetsByGroup,
  exclusiveSessionsByGroup,
  groupMetaMap,
  userMiniMap,
  styles,
  fmtDate,
  renderUserLink,
  router,
  activeSection,
}: Props) {
  const tCommon = useTranslations("common");
  const cfError = useCfError();
  const tServices = useTranslations("services");
  const tGroups = useTranslations("groups");
  const tSessions = useTranslations("sessions");
  const tWallet = useTranslations("wallet");
  const locale = useLocale();
  const pf = usePriceFormat();
  const formatMoney = pf.format;
  const [busyMap, setBusyMap] = useState<BusyMap>({});
  const [errorMap, setErrorMap] = useState<TextMap>({});
  const [successMap, setSuccessMap] = useState<TextMap>({});
  const { toast: greetingsToast, showToast: showGreetingsToast } = useVibraToast();
  const [viewItem, setViewItem] = useState<{ item: { id: string; data: GreetingRequestDoc }; sourceName: string; sourceAvatar: string | null } | null>(null);
  const [viewDeliveredItem, setViewDeliveredItem] = useState<{ item: { id: string; data: GreetingRequestDoc }; sourceName: string; sourceAvatar: string | null } | null>(null);
  const [viewSessionItem, setViewSessionItem] = useState<{ row: ScheduledRow; creatorName: string; creatorAvatar: string | null } | null>(null);
  // Panel de éxito (mismo diseño que el de pago) tras pedir devolución.
  const [refundDone, setRefundDone] = useState<{ credited: number; name: string | null; avatar: string | null } | null>(null);
  const [incomingSessionOverlayData, setIncomingSessionOverlayData] = useState<{
    id: string;
    req: MeetGreetRequestDoc | ExclusiveSessionRequestDoc;
    serviceKind: ScheduledServiceKind;
  } | null>(null);
  const [incomingSessionOverlayOpen, setIncomingSessionOverlayOpen] = useState(false);
  const [openSectionKey, setOpenSectionKey] = useState<ServiceSectionKey | null>(null);
  const [deliveredSectionOpen, setDeliveredSectionOpen] = useState(false);
  // Submenú de entregados abierto: solo uno a la vez ("sessions" | "greetings" | null).
  const [deliveredSubOpen, setDeliveredSubOpen] = useState<"sessions" | "greetings" | null>(null);
  // Submenú de rechazados abierto: solo uno a la vez ("rejected" | "refund" | null).
  const [rejectedSubOpen, setRejectedSubOpen] = useState<"rejected" | "refund" | null>(null);
  const [openItemKey, setOpenItemKey] = useState<string | null>(null);
  const [rejectOpenMap, setRejectOpenMap] = useState<ToggleMap>({});
  const [scheduleOpenMap, setScheduleOpenMap] = useState<ToggleMap>({});
  const [refundOpenMap, setRefundOpenMap] = useState<ToggleMap>({});
  const [rescheduleOpenMap, setRescheduleOpenMap] = useState<ToggleMap>({});
  const [preparationOpenMap, setPreparationOpenMap] = useState<ToggleMap>({});
  const [preparationRoleMap, setPreparationRoleMap] = useState<TextMap>({});
  const [rejectReasonMap, setRejectReasonMap] = useState<TextMap>({});
  const [refundReasonMap, setRefundReasonMap] = useState<TextMap>({});
  const [rescheduleReasonMap, setRescheduleReasonMap] = useState<TextMap>({});
  const [scheduleNoteMap, setScheduleNoteMap] = useState<TextMap>({});
  const [calendarOpenMap, setCalendarOpenMap] = useState<ToggleMap>({});
  const [schedulePartsMap, setSchedulePartsMap] = useState<Record<string, ScheduleParts>>({});
  const [deliveredScheduledSectionOpen, setDeliveredScheduledSectionOpen] = useState(false);
  const [downloadBusyMap, setDownloadBusyMap] = useState<Record<string, boolean>>({});
  const [downloadErrorMap, setDownloadErrorMap] = useState<Record<string, string | null>>({});

  // Los mapas de aviso por solicitud se reflejan en el toast. Se compara contra
  // el valor anterior para avisar solo de lo que acaba de cambiar, y no de lo
  // que ya estaba puesto en otra solicitud.
  const prevErrorMapRef = useRef<TextMap>({});
  const prevSuccessMapRef = useRef<TextMap>({});
  const prevDownloadErrorMapRef = useRef<Record<string, string | null>>({});

  useEffect(() => {
    for (const [id, text] of Object.entries(errorMap)) {
      if (text && text !== prevErrorMapRef.current[id]) {
        showGreetingsToast(text, "error");
        break;
      }
    }
    prevErrorMapRef.current = errorMap;
  }, [errorMap]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    for (const [id, text] of Object.entries(successMap)) {
      if (text && text !== prevSuccessMapRef.current[id]) {
        showGreetingsToast(text, "success");
        break;
      }
    }
    prevSuccessMapRef.current = successMap;
  }, [successMap]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    for (const [id, text] of Object.entries(downloadErrorMap)) {
      if (text && text !== prevDownloadErrorMapRef.current[id]) {
        showGreetingsToast(text, "error");
        break;
      }
    }
    prevDownloadErrorMapRef.current = downloadErrorMap;
  }, [downloadErrorMap]); // eslint-disable-line react-hooks/exhaustive-deps


  const incomingMeetGreets = useMemo<ScheduledRow[]>(
    () =>
      Object.entries(meetGreetsByGroup).flatMap(([groupId, rows]) =>
        rows.map((row) => ({ ...row, groupId, serviceKind: "meet_greet" as const }))
      ),
    [meetGreetsByGroup]
  );

  const incomingExclusiveSessions = useMemo<ScheduledRow[]>(
    () =>
      Object.entries(exclusiveSessionsByGroup).flatMap(([groupId, rows]) =>
        rows.map((row) => ({ ...row, groupId, serviceKind: "exclusive_session" as const }))
      ),
    [exclusiveSessionsByGroup]
  );

  const buyerScheduledServices: ScheduledRow[] = useMemo(
    () => [
      ...buyerMeetGreets.map((row) => ({ ...row, serviceKind: "meet_greet" as const })),
      ...buyerExclusiveSessions.map((row) => ({ ...row, serviceKind: "exclusive_session" as const })),
    ],
    [buyerMeetGreets, buyerExclusiveSessions]
  );

  const incomingScheduledServices = useMemo(
    () => [...incomingMeetGreets, ...incomingExclusiveSessions],
    [incomingMeetGreets, incomingExclusiveSessions]
  );



  const completedBuyerScheduledRows = useMemo<ScheduledRow[]>(() => {
    return buyerScheduledServices.filter((row) => row.data.status === "completed");
  }, [buyerScheduledServices]);

  // Sesiones/encuentros entregados, del más nuevo al más viejo.
  const deliveredSessions = useMemo(() => {
    const ts = (r: ScheduledRow) =>
      (toDateSafe(r.data.updatedAt) ??
        toDateSafe(r.data.scheduledAt) ??
        toDateSafe(r.data.createdAt))?.getTime() ?? 0;
    return [...completedBuyerScheduledRows].sort((a, b) => ts(b) - ts(a));
  }, [completedBuyerScheduledRows]);

  // Saludos/consejos entregados, del más nuevo al más viejo.
  const deliveredGreetings = useMemo(() => {
    const ts = (r: { data: GreetingRequestDoc }) =>
      (toDateSafe(r.data.deliveredAt) ??
        toDateSafe(r.data.updatedAt) ??
        toDateSafe(r.data.createdAt))?.getTime() ?? 0;
    return [...buyerDelivered].sort((a, b) => ts(b) - ts(a));
  }, [buyerDelivered]);

  // Todos los entregados en una sola lista, del más nuevo al más viejo,
  // intercalando sesiones y saludos/consejos. Se usa en la página de experiencias
  // (sin acordeones).
  const deliveredAll = useMemo(() => {
    type DeliveredItem =
      | { kind: "session"; row: ScheduledRow; ts: number }
      | { kind: "greeting"; row: { id: string; data: GreetingRequestDoc }; ts: number };
    const items: DeliveredItem[] = [];
    deliveredSessions.forEach((row) => {
      const ts = (toDateSafe(row.data.updatedAt) ?? toDateSafe(row.data.scheduledAt) ?? toDateSafe(row.data.createdAt))?.getTime() ?? 0;
      items.push({ kind: "session", row, ts });
    });
    deliveredGreetings.forEach((row) => {
      const ts = (toDateSafe(row.data.deliveredAt) ?? toDateSafe(row.data.updatedAt) ?? toDateSafe(row.data.createdAt))?.getTime() ?? 0;
      items.push({ kind: "greeting", row, ts });
    });
    return items.sort((a, b) => b.ts - a.ts);
  }, [deliveredSessions, deliveredGreetings]);

  // Estilo del encabezado de cada submenú de entregados.
  const submenuHeaderStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 40,
    border: "none",
    background: "rgba(255,255,255,0.04)",
    borderRadius: 10,
    color: "#fff",
    cursor: "pointer",
    padding: "0 12px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    textAlign: "start",
  };

  const requestedRows = useMemo<DisplayRow[]>(() => {
    const rows: DisplayRow[] = [
      ...buyerPending.map((row) => ({ rowType: "buyer_greeting" as const, id: `buyer-greeting-${row.id}`, row })),
      ...buyerScheduledServices
        .filter((row) => row.data.status !== "completed" && getSectionForMeetGreetStatus(row.data.status) === "requested")
        .map((row) => ({ rowType: "buyer_scheduled" as const, id: `buyer-${row.serviceKind}-${row.id}`, row })),
      ...incomingScheduledServices
        .filter((row) => getSectionForMeetGreetStatus(row.data.status) === "requested")
        .map((row) => ({ rowType: "incoming_scheduled" as const, id: `incoming-${row.serviceKind}-${row.id}`, row })),
    ];

    return rows.sort(sortDisplayRows);
  }, [buyerPending, buyerScheduledServices, incomingScheduledServices]);

  const rejectedRows = useMemo<DisplayRow[]>(() => {
    const rows: DisplayRow[] = [
      ...buyerRejectedGreetings.map((row) => ({ rowType: "buyer_greeting" as const, id: `buyer-greeting-rejected-${row.id}`, row })),
      ...buyerScheduledServices
        .filter((row) => getSectionForMeetGreetStatus(row.data.status) === "rejected")
        .map((row) => ({ rowType: "buyer_scheduled" as const, id: `buyer-${row.serviceKind}-${row.id}`, row })),
      ...incomingScheduledServices
        .filter((row) => getSectionForMeetGreetStatus(row.data.status) === "rejected")
        .map((row) => ({ rowType: "incoming_scheduled" as const, id: `incoming-${row.serviceKind}-${row.id}`, row })),
    ];

    // Las DEVUELTAS (a crédito o a tarjeta) salen de "Rechazados": viven en Entregados →
    // "Todo" (para el comprador). Solo quedan aquí las rechazadas AÚN accionables (cobradas,
    // que pueden pedir devolución o reintentar) y las entrantes del creador.
    return rows.filter((r) => r.rowType === "incoming_scheduled" || !isReturnedRow(r)).sort(sortResolvedDesc);
  }, [buyerRejectedGreetings, buyerScheduledServices, incomingScheduledServices]);

  // Submenús de rechazados: rechazados "puros" y los que están en devolución.
  const rejectedOnlyRows = useMemo(
    () => rejectedRows.filter((r) => !isRefundStatus(displayRowStatus(r))),
    [rejectedRows]
  );
  const refundOnlyRows = useMemo(
    () => rejectedRows.filter((r) => isRefundStatus(displayRowStatus(r))),
    [rejectedRows]
  );

  const refundRows = useMemo<DisplayRow[]>(() => {
    const rows: DisplayRow[] = [
      ...buyerScheduledServices
        .filter((row) => getSectionForMeetGreetStatus(row.data.status) === "refund")
        .map((row) => ({ rowType: "buyer_scheduled" as const, id: `buyer-${row.serviceKind}-${row.id}`, row })),
      ...incomingScheduledServices
        .filter((row) => getSectionForMeetGreetStatus(row.data.status) === "refund")
        .map((row) => ({ rowType: "incoming_scheduled" as const, id: `incoming-${row.serviceKind}-${row.id}`, row })),
    ];

    return rows.sort(sortDisplayRows);
  }, [buyerScheduledServices, incomingScheduledServices]);

  function closeInlinePanels(requestId: string, except?: "reject" | "schedule" | "refund" | "reschedule") {
    if (except !== "reject") setRejectOpenMap((prev) => ({ ...prev, [requestId]: false }));
    if (except !== "schedule") setScheduleOpenMap((prev) => ({ ...prev, [requestId]: false }));
    if (except !== "refund") setRefundOpenMap((prev) => ({ ...prev, [requestId]: false }));
    if (except !== "reschedule") setRescheduleOpenMap((prev) => ({ ...prev, [requestId]: false }));
  }

  function toggleSection(sectionKey: ServiceSectionKey) {
    setOpenSectionKey((prev) => (prev === sectionKey ? null : sectionKey));
    setDeliveredSectionOpen(false);
    setOpenItemKey(null);
  }

  function toggleItem(itemKey: string) {
    setOpenItemKey((prev) => (prev === itemKey ? null : itemKey));
  }

  function setBusy(requestId: string, value: boolean) {
    setBusyMap((prev) => ({ ...prev, [requestId]: value }));
  }

  function setError(requestId: string, value: string | null) {
    setErrorMap((prev) => ({ ...prev, [requestId]: value ?? "" }));
  }

  function setSuccess(requestId: string, value: string | null) {
    setSuccessMap((prev) => ({ ...prev, [requestId]: value ?? "" }));
  }

  async function handleCreatorAccept(requestId: string, kind: ScheduledServiceKind) {
    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);

    try {
      if (kind === "exclusive_session") {
        await acceptExclusiveSessionRequest({ requestId });
      } else {
        await acceptMeetGreetRequest({ requestId });
      }
      showGreetingsToast(tServices("successRequestAccepted"));
      closeInlinePanels(requestId, "schedule");
      setScheduleOpenMap((prev) => ({ ...prev, [requestId]: true }));
      setOpenItemKey(`incoming-${kind}-${requestId}`);
    } catch (e: unknown) {
      showGreetingsToast((e instanceof Error ? cfError(e) : null) ?? tServices("errorAcceptRequest"), "error");
    } finally {
      setBusy(requestId, false);
    }
  }

  async function handleCreatorReject(requestId: string, kind: ScheduledServiceKind) {
    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);

    try {
      const payload = {
        requestId,
        rejectionReason: rejectReasonMap[requestId] ?? null,
      };

      if (kind === "exclusive_session") {
        await rejectExclusiveSessionRequest(payload);
      } else {
        await rejectMeetGreetRequest(payload);
      }

      showGreetingsToast(tServices("successRequestRejected"));
      setRejectOpenMap((prev) => ({ ...prev, [requestId]: false }));
    } catch (e: unknown) {
      showGreetingsToast((e instanceof Error ? cfError(e) : null) ?? tServices("errorRejectRequest"), "error");
    } finally {
      setBusy(requestId, false);
    }
  }

  async function handleCreatorRejectDirect(requestId: string, kind: ScheduledServiceKind, reason: string | null) {
    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);
    try {
      if (kind === "exclusive_session") {
        await rejectExclusiveSessionRequest({ requestId, rejectionReason: reason });
      } else {
        await rejectMeetGreetRequest({ requestId, rejectionReason: reason });
      }
      showGreetingsToast(tServices("successRequestRejected"));
    } catch (e: unknown) {
      showGreetingsToast((e instanceof Error ? cfError(e) : null) ?? tServices("errorRejectRequest"), "error");
      throw e;
    } finally {
      setBusy(requestId, false);
    }
  }

  async function handleCreatorScheduleDirect(requestId: string, kind: ScheduledServiceKind, scheduledAtIso: string | null, note: string | null) {
    if (!scheduledAtIso) {
      setError(requestId, tServices("selectDateTimeError"));
      return;
    }
    const selectedDate = new Date(scheduledAtIso);
    const conflict = getWalletScheduleConflictResult(locale, { id: requestId, source: kind, scheduledAt: selectedDate, durationMinutes: kind === "exclusive_session" ? 60 : 30 },
      buildCalendarItems
    );
    if (conflict.hasConflict) {
      setError(requestId, conflict.message ?? tServices("scheduleConflictError"));
      return;
    }
    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);
    try {
      const creatorTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const payload = { requestId, scheduledAt: scheduledAtIso, note, creatorTimezone };
      if (kind === "exclusive_session") {
        await proposeExclusiveSessionSchedule(payload);
      } else {
        await proposeMeetGreetSchedule(payload);
      }
      showGreetingsToast(tServices("successDateProposed"));
    } catch (e: unknown) {
      showGreetingsToast((e instanceof Error ? cfError(e) : null) ?? tServices("errorSaveDate"), "error");
      throw e;
    } finally {
      setBusy(requestId, false);
    }
  }

  async function handleCreatorAcceptAndSchedule(requestId: string, kind: ScheduledServiceKind, scheduledAtIso: string | null, note: string | null) {
    if (!scheduledAtIso) {
      setError(requestId, tServices("selectDateTimeError"));
      return;
    }
    const selectedDate = new Date(scheduledAtIso);
    const conflict = getWalletScheduleConflictResult(locale, { id: requestId, source: kind, scheduledAt: selectedDate, durationMinutes: kind === "exclusive_session" ? 60 : 30 },
      buildCalendarItems
    );
    if (conflict.hasConflict) {
      setError(requestId, conflict.message ?? tServices("scheduleConflictError"));
      return;
    }
    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);
    try {
      const creatorTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (kind === "exclusive_session") {
        await acceptExclusiveSessionRequest({ requestId });
        await proposeExclusiveSessionSchedule({ requestId, scheduledAt: scheduledAtIso, note, creatorTimezone });
      } else {
        await acceptMeetGreetRequest({ requestId });
        await proposeMeetGreetSchedule({ requestId, scheduledAt: scheduledAtIso, note, creatorTimezone });
      }
      showGreetingsToast(tServices("successSessionAcceptedAndScheduled"));
      setIncomingSessionOverlayOpen(false);
      setTimeout(() => setIncomingSessionOverlayData(null), 300);
    } catch (e: unknown) {
      showGreetingsToast((e instanceof Error ? cfError(e) : null) ?? tServices("errorScheduleSession"), "error");
    } finally {
      setBusy(requestId, false);
    }
  }

async function handleCreatorSchedule(
  requestId: string,
  kind: ScheduledServiceKind
) {
  const parts = schedulePartsMap[requestId];
  const scheduledAt = parts ? schedulePartsToIso(parts) : null;

  if (!scheduledAt) {
    setError(requestId, tServices("selectDateTimeError"));
    return;
  }

  const selectedScheduleDate = new Date(scheduledAt);

  const scheduleConflict = getWalletScheduleConflictResult(locale, {
      id: requestId,
      source: kind,
      scheduledAt: selectedScheduleDate,
      durationMinutes: kind === "exclusive_session" ? 60 : 30,
    },
    buildCalendarItems
  );

  if (scheduleConflict.hasConflict) {
    setError(
      requestId,
      scheduleConflict.message ?? tServices("scheduleConflictError")
    );
    return;
  }

  setBusy(requestId, true);
  setError(requestId, null);
  setSuccess(requestId, null);

  try {
    const creatorTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const payload = {
      requestId,
      scheduledAt,
      note: scheduleNoteMap[requestId] ?? null,
      creatorTimezone,
    };

    if (kind === "exclusive_session") {
      await proposeExclusiveSessionSchedule(payload);
    } else {
      await proposeMeetGreetSchedule(payload);
    }

    showGreetingsToast(tServices("successDateProposed"));
    setScheduleOpenMap((prev) => ({ ...prev, [requestId]: false }));
    setCalendarOpenMap((prev) => ({ ...prev, [requestId]: false }));
  } catch (e: unknown) {
    showGreetingsToast((e instanceof Error ? cfError(e) : null) ?? tServices("errorSaveDate"), "error");
  } finally {
    setBusy(requestId, false);
  }
}

  async function handleBuyerRefund(requestId: string, kind: ScheduledServiceKind, reasonOverride?: string) {
    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);

    try {
      const payload = {
        requestId,
        refundReason: reasonOverride !== undefined ? reasonOverride : (refundReasonMap[requestId] ?? null),
      };

      const res = kind === "exclusive_session"
        ? await requestExclusiveSessionRefund(payload)
        : await requestMeetGreetRefund(payload);

      setRefundOpenMap((prev) => ({ ...prev, [requestId]: false }));
      const sess = viewSessionItem;
      setViewSessionItem(null);
      // Panel de éxito (mismo diseño que el de pago) con el crédito acreditado.
      setRefundDone({
        credited: (res as unknown as { credited?: number })?.credited ?? 0,
        name: sess?.creatorName ?? null,
        avatar: sess?.creatorAvatar ?? null,
      });
    } catch (e: unknown) {
      showGreetingsToast((e instanceof Error ? cfError(e) : null) ?? tServices("errorRequestRefund"), "error");
    } finally {
      setBusy(requestId, false);
    }
  }

  async function handleBuyerReschedule(requestId: string, kind: ScheduledServiceKind, reason?: string | null) {
    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);

    try {
      const payload = {
        requestId,
        reason: reason ?? rescheduleReasonMap[requestId] ?? null,
      };

      if (kind === "exclusive_session") {
        await requestExclusiveSessionReschedule(payload);
      } else {
        await requestMeetGreetReschedule(payload);
      }

      showGreetingsToast(tServices("successRescheduleRequested"));
      setRescheduleOpenMap((prev) => ({ ...prev, [requestId]: false }));
    } catch (e: unknown) {
      showGreetingsToast((e instanceof Error ? cfError(e) : null) ?? tServices("errorRequestReschedule"), "error");
    } finally {
      setBusy(requestId, false);
    }
  }

  async function handleKeepSchedule(requestId: string, kind: ScheduledServiceKind) {
    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);
    try {
      if (kind === "exclusive_session") {
        await declineExclusiveSessionReschedule({ requestId });
      } else {
        await declineMeetGreetReschedule(requestId);
      }
    } catch (e: unknown) {
      showGreetingsToast((e instanceof Error ? cfError(e) : null) ?? tCommon("errorUpdateRequest"), "error");
    } finally {
      setBusy(requestId, false);
    }
  }

  async function handlePrepare(requestId: string, role: "buyer" | "creator", kind: ScheduledServiceKind) {
    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);

    try {
      if (kind === "exclusive_session") {
        await setExclusiveSessionPreparing({ requestId, role });
      } else {
        await setMeetGreetPreparing({ requestId, role });
      }

      setPreparationRoleMap((prev) => ({ ...prev, [requestId]: role }));
      setPreparationOpenMap((prev) => ({ ...prev, [requestId]: true }));
      setSuccess(requestId, tServices("successPreparationOpened"));
    } catch (e: unknown) {
      setError(requestId, (e instanceof Error ? cfError(e) : null) ?? tServices("errorOpenPreparation"));
    } finally {
      setBusy(requestId, false);
    }
  }

  function renderPreparationPanel(
    requestId: string,
    req: MeetGreetRequestDoc | ExclusiveSessionRequestDoc,
    role: "buyer" | "creator"
  ) {
    return (
      <MeetGreetPreparationFullscreen
        open={!!preparationOpenMap[requestId]}
        onClose={() =>
          setPreparationOpenMap((prev) => ({ ...prev, [requestId]: false }))
        }
        role={role}
        sessionId={requestId}
        sessionType={req.type === "digital_meet_greet" ? "meet_greet" : "exclusive_session"}
        scheduledAtLabel={req.scheduledAt ? fmtDate(req.scheduledAt) : null}
        durationMinutes={req.durationMinutes ?? null}
      />
    );
  }

  function renderContextLink(
  group: GroupDocLite | null,
  req?: {
    source?: string | null;
    requestSource?: string | null;
    profileUserId?: string | null;
    profileUsername?: string | null;
    profileDisplayName?: string | null;
    creatorUsername?: string | null;
    creatorDisplayName?: string | null;
    groupId?: string | null;
  }
) {
  const baseStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.09)",
    borderRadius: 999,
    padding: "6px 9px",
    margin: 0,
    textAlign: "start",
    cursor: "pointer",
    color: "#fff",
    fontSize: 11,
    fontWeight: 700,
    width: "fit-content",
  };

  if (group) {
    return (
      <button
        type="button"
        onClick={() => router.push(`/groups/${group.id}`)}
        style={baseStyle}
      >
        {tServices("contextCommunity", { name: group.name ?? tServices("contextCommunityDefault") })}
      </button>
    );
  }

  if (req && isProfileRequest(req)) {
    const username = req.profileUsername ?? req.creatorUsername ?? null;
    const label =
      req.profileDisplayName ??
      req.creatorDisplayName ??
      tServices("contextProfileDefault");

    if (username) {
      return (
        <button
          type="button"
          onClick={() => router.push(`/u/${username}`)}
          style={baseStyle}
        >
          {tServices("contextProfile", { name: label })}
        </button>
      );
    }

    return (
      <span
        style={{
          ...baseStyle,
          cursor: "default",
          display: "inline-flex",
        }}
      >
        {tServices("contextProfile", { name: label })}
      </span>
    );
  }

  return null;
}

  function renderTextBox(text: string, tone: "default" | "warning" | "danger" | "info" = "default") {
    const visual =
      tone === "danger"
        ? {
            border: "rgba(248,113,113,0.18)",
            background: "rgba(248,113,113,0.08)",
            color: "#fecaca",
          }
        : tone === "warning"
          ? {
              border: "rgba(250,204,21,0.18)",
              background: "rgba(250,204,21,0.08)",
              color: "#fde68a",
            }
          : tone === "info"
            ? {
                border: "rgba(96,165,250,0.18)",
                background: "rgba(96,165,250,0.08)",
                color: "#bfdbfe",
              }
            : {
                border: "rgba(255,255,255,0.10)",
                background: "rgba(0,0,0,0.18)",
                color: "rgba(255,255,255,0.92)",
              };

    return (
      <div
        style={{
          borderRadius: 10,
          border: `1px solid ${visual.border}`,
          background: visual.background,
          padding: "7px 8px",
          whiteSpace: "pre-wrap",
          fontSize: 12,
          lineHeight: 1.3,
          color: visual.color,
        }}
      >
        {text}
      </div>
    );
  }

  function renderBuyerGreetingCard(row: { id: string; data: GreetingRequestDoc }, itemKey: string) {
    const req = row.data;
    const isProfile = req.source === "profile";
    const group = req.groupId ? groupMetaMap[req.groupId] ?? null : null;
    const creator = userMiniMap[req.creatorId] ?? null;

    const sourceName = isProfile
      ? (req.profileDisplayName ?? creator?.displayName ?? tCommon("profile"))
      : (group?.name ?? tCommon("community"));
    const sourceAvatar = isProfile
      ? (creator?.photoURL ?? null)
      : (group?.avatarUrl ?? null);
    const sourceInitial = sourceName.charAt(0).toUpperCase();

    const relTime = req.createdAt ? getRelativeTime(req.createdAt as { toDate: () => Date }, tCommon) : null;
    const cardColors = getServiceCardColors(req.type);
    const bgImage = greetingBgImage(req.type);

    const gAvatar = sourceAvatar ? (
      <Image
        src={sourceAvatar}
        alt={sourceName}
        width={36} height={36}
        style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "1px solid rgba(255,255,255,0.10)" }}
      />
    ) : (
      <div style={{
        width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
        background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.10)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 700, fontSize: 14, color: "#fff",
      }}>
        {sourceInitial}
      </div>
    );

    const gViewBtn = (
      <button
        type="button"
        onClick={() => setViewItem({ item: row, sourceName, sourceAvatar })}
        style={{ ...cardButtonStyle, background: cardColors.btnBg, color: cardColors.btnColor }}
      >
        {tServices("viewRequest")}
      </button>
    );

    // Rechazado / en devolución: layout simple atenuado (sin cambios).
    if (req.status !== "pending") {
      return (
        <div
          key={itemKey}
          style={{
            ...styles.miniItem,
            ...serviceCardBackgroundStyle(bgImage, cardColors.bg, true),
            border: "none", borderRadius: 12, overflow: "hidden", padding: 10,
            display: "flex", alignItems: "center", gap: 10,
          }}
        >
          {gAvatar}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {sourceName}
            </div>
            {(req.status === "rejected" || req.status === "refund_requested" || req.status === "refund_review" || relTime) && (
              <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 2 }}>
                {req.status === "rejected" ? tSessions("statusRejected") : (req.status === "refund_requested" || req.status === "refund_review") ? tServices("statusRefundInProgress") : relTime}
              </div>
            )}
          </div>
          {gViewBtn}
        </div>
      );
    }

    // Pendiente: 3 partes centradas de altura, con línea vertical del lado del
    // avatar. En medio, los días que le quedan al creador para responder.
    const daysLeft = responseDaysLeft(req.createdAt, GREETING_RESPONSE_DAYS);
    const gDivider = (
      <span aria-hidden="true" style={{ alignSelf: "stretch", width: 1, background: "rgba(255,255,255,0.14)", flexShrink: 0, margin: "3px 0" }} />
    );

    return (
      <div
        key={itemKey}
        style={{
          ...styles.miniItem,
          ...serviceCardBackgroundStyle(bgImage, cardColors.bg, false),
          border: "none", borderRadius: 12, overflow: "hidden", padding: "12px 10px",
          display: "flex", alignItems: "center", gap: 10,
        }}
      >
        {/* 1 · Fuente + hace cuánto se compró */}
        <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", alignItems: "center", gap: 9 }}>
          {gAvatar}
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {sourceName}
            </div>
            {relTime && (
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {relTime}
              </div>
            )}
          </div>
        </div>

        {gDivider}

        {/* 2 · Días que le quedan al creador para responder */}
        <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 2, padding: "0 4px" }}>
          {daysLeft != null ? (
            <>
              <span style={{ color: "#fff", fontSize: 13, fontWeight: 700, lineHeight: 1.15, textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>
                {tServices("greetingDaysToRespond", { days: daysLeft })}
              </span>
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 10.5, fontWeight: 500, lineHeight: 1.2, textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>
                {tServices("toRespondLabel")}
              </span>
            </>
          ) : null}
        </div>

        {/* 3 · Botón (columna de ancho fijo: ver cardButtonColumnStyle) */}
        <div style={cardButtonColumnStyle}>{gViewBtn}</div>
      </div>
    );
  }

  function renderBuyerScheduledServiceCard(row: ScheduledRow, itemKey: string) {
    const req = row.data;
    const group = req.groupId ? groupMetaMap[req.groupId] ?? null : null;
    const busy = !!busyMap[row.id];
    const isExclusiveSession = row.serviceKind === "exclusive_session";
    const serviceType = isExclusiveSession ? "digital_exclusive_session" : "meet_greet_digital";
    const serviceTitle = isExclusiveSession ? tServices("exclusiveSession") : tSessions("meetGreetTitle");
    const noShowExpired = isNoShowExpired(req.scheduledAt);
    const canRequestRefund =
      req.status === "rejected" && !PAGO_YA_DEVUELTO.includes(String(req.paymentStatus ?? ""));
    const canRetry =
      req.status === "rejected" &&
      (!!group?.id || !!req.profileUsername || !!req.creatorUsername);
    const canRequestReschedule =
      (req.status === "scheduled" || req.status === "ready_to_prepare") &&
      remainingReschedules(req) > 0 &&
      !noShowExpired;
    const canPrepare =
      (req.status === "scheduled" ||
        req.status === "ready_to_prepare" ||
        req.status === "in_preparation") &&
      isPrepareWindowOpen(req.scheduledAt) &&
      !noShowExpired;
const creatorScheduleNote = getCreatorScheduleNote(req);

    if (req.status === "rejected") {
      const creator = userMiniMap[req.creatorId] ?? null;
      const creatorName = creator?.displayName ?? tCommon("creator");
      const creatorAvatar = creator?.photoURL ?? null;
      const creatorInitial = creatorName.charAt(0).toUpperCase();
      const relTime = req.createdAt ? getRelativeTime(req.createdAt as { toDate: () => Date }, tCommon) : null;
      const cardColors = getServiceCardColors(row.serviceKind);
      const bgImage = isExclusiveSession ? "/sesionexclusiva.webp" : "/encuentroenvivo.webp";

      return (
        <div
          key={itemKey}
          style={{
            ...styles.miniItem,
            ...serviceCardBackgroundStyle(bgImage, cardColors.bg, true),
            border: "none",
            borderRadius: 12,
            overflow: "hidden",
            padding: 10,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          {creatorAvatar ? (
            <Image
              src={creatorAvatar}
              alt={creatorName}
              width={36} height={36}
              style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "1px solid rgba(255,255,255,0.10)" }}
            />
          ) : (
            <div style={{
              width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
              background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.10)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 700, fontSize: 14, color: "#fff",
            }}>
              {creatorInitial}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "#fff", fontWeight: 500, fontSize: 13, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {creatorName}
            </div>
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 2 }}>
              {tSessions("statusRejected")}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setViewSessionItem({ row, creatorName, creatorAvatar })}
            style={{
              flexShrink: 0,
              height: 28,
              padding: "0 12px",
              borderRadius: 8,
              border: "none",
              background: cardColors.btnBg,
              color: cardColors.btnColor,
              fontWeight: 600,
              fontSize: 11,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {tServices("viewRequest")}
          </button>
        </div>
      );
    }

    {
      const creator2 = userMiniMap[req.creatorId] ?? null;
      const creatorName2 = creator2?.displayName ?? tCommon("creator");
      const creatorAvatar2 = creator2?.photoURL ?? null;
      const creatorInitial2 = creatorName2.charAt(0).toUpperCase();
      const relTime2 = req.createdAt ? getRelativeTime(req.createdAt as { toDate: () => Date }, tCommon) : null;
      const cardColors2 = getServiceCardColors(row.serviceKind);
      const noShowExpired2 = isNoShowExpired(req.scheduledAt);
      const canPrepareCard =
        (req.status === "scheduled" || req.status === "ready_to_prepare" || req.status === "in_preparation") &&
        isPrepareWindowOpen(req.scheduledAt) &&
        !noShowExpired2;
      const isRefundCard = getSectionForMeetGreetStatus(req.status) === "rejected";
      const bgImage2 = isExclusiveSession ? "/sesionexclusiva.webp" : "/encuentroenvivo.webp";

      const avatar2 = creatorAvatar2 ? (
        <Image src={creatorAvatar2} alt={creatorName2} width={36} height={36}
          style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "1px solid rgba(255,255,255,0.10)" }} />
      ) : (
        <div style={{
          width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
          background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.10)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 700, fontSize: 14, color: "#fff",
        }}>{creatorInitial2}</div>
      );

      const viewBtn2 = (
        <button
          type="button"
          onClick={() => setViewSessionItem({ row, creatorName: creatorName2, creatorAvatar: creatorAvatar2 })}
          style={{ ...cardButtonStyle, background: cardColors2.btnBg, color: cardColors2.btnColor }}
        >
          {canPrepareCard ? tServices("prepare") : tServices("viewDetails")}
        </button>
      );

      // Devolución / cancelado: conserva el diseño anterior (fila simple atenuada).
      if (isRefundCard) {
        return (
          <div key={itemKey} style={{
            ...styles.miniItem,
            ...serviceCardBackgroundStyle(bgImage2, cardColors2.bg, true),
            border: "none", borderRadius: 12, overflow: "hidden", padding: 10,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            {avatar2}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {creatorName2}
              </div>
              {(req.status === "refund_requested" || req.status === "refund_review" || relTime2) && (
                <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 2 }}>
                  {(req.status === "refund_requested" || req.status === "refund_review") ? tServices("statusRefundInProgress") : relTime2}
                </div>
              )}
            </div>
            {viewBtn2}
          </div>
        );
      }

      // Pendiente: 3 partes centradas de altura, separadas por línea vertical sutil:
      // (1) creador + hace cuánto se compró · (2) fecha agendada · (3) botón.
      const scheduledSplit2 = fmtScheduledSplit(req.scheduledAt, locale);
      const dateAccent2 = isExclusiveSession ? "#f9a8d4" : "#93c5fd";
      const sessionDaysLeft = responseDaysLeft(req.createdAt, SESSION_RESPONSE_DAYS);
      const divider2 = (
        <span aria-hidden="true" style={{ alignSelf: "stretch", width: 1, background: "rgba(255,255,255,0.14)", flexShrink: 0, margin: "3px 0" }} />
      );

      return (
        <div key={itemKey} style={{
          ...styles.miniItem,
          ...serviceCardBackgroundStyle(bgImage2, cardColors2.bg, false),
          border: "none", borderRadius: 12, overflow: "hidden", padding: "12px 10px",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          {/* 1 · Creador + hace cuánto se compró */}
          <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", alignItems: "center", gap: 9 }}>
            {avatar2}
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {creatorName2}
              </div>
              {relTime2 && (
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {relTime2}
                </div>
              )}
            </div>
          </div>

          {divider2}

          {/* 2 · Fecha agendada (mismo ícono y formato de antes; o estado si no hay fecha) */}
          <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>
            {scheduledSplit2 ? (
              <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", justifyContent: "center", gap: 8 }}>
                <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={dateAccent2} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
                  <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
                <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                  <span style={{ color: "#fff", fontSize: 11, fontWeight: 600, lineHeight: 1.2, textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>{tServices("scheduledDateLabel")}</span>
                  <span style={{ color: "#fff", fontSize: 12.5, fontWeight: 400, lineHeight: 1.25, textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>{scheduledSplit2.dayTime}</span>
                  <span style={{ color: "rgba(255,255,255,0.85)", fontSize: 11.5, fontWeight: 400, lineHeight: 1.25, textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>{scheduledSplit2.dateStr}</span>
                </div>
              </div>
            ) : req.status === "pending_creator_response" ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 2 }}>
                <span style={{ color: "#fff", fontSize: 13, fontWeight: 700, lineHeight: 1.15, textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>
                  {tServices("greetingDaysToRespond", { days: sessionDaysLeft ?? 0 })}
                </span>
                <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 10.5, fontWeight: 500, lineHeight: 1.2, textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>
                  {tServices("toRespondLabel")}
                </span>
              </div>
            ) : (
              <span style={{ color: dateAccent2, fontSize: 11.5, fontWeight: 600, lineHeight: 1.25, textAlign: "center" }}>
                {getMeetGreetStatusLabel(req.status, tSessions)}
              </span>
            )}
          </div>

          {/* 3 · Botón (columna de ancho fijo: ver cardButtonColumnStyle) */}
          <div style={cardButtonColumnStyle}>{viewBtn2}</div>
        </div>
      );
    }
  }

const buildCalendarItems = useMemo<WalletServiceItem[]>(() => {
  return incomingScheduledServices
    .filter((item) => !!item.data.scheduledAt)
    .map((item): WalletServiceItem => {
      const resolvedGroupId = item.groupId ?? item.data.groupId ?? "";
      const group = resolvedGroupId ? groupMetaMap[resolvedGroupId] ?? null : null;

      const scheduledAt = toDateSafe(item.data.scheduledAt);
      const createdAt = toDateSafe(item.data.createdAt);
      const updatedAt = toDateSafe(item.data.updatedAt);
      const isExclusive = item.serviceKind === "exclusive_session";

      const kind: WalletServiceItem["kind"] = isExclusive
        ? "exclusive_session"
        : "meet_greet";

      const source: WalletServiceItem["source"] = isExclusive
        ? "exclusive_session"
        : "meet_greet";

      const rawNoShowRole = item.data.noShowRole;
      const noShowRole: WalletServiceItem["noShowRole"] =
        rawNoShowRole === "buyer" ||
        rawNoShowRole === "creator" ||
        rawNoShowRole === "both"
          ? rawNoShowRole
          : null;

      return {
        id: item.id,
        kind,
        title: isExclusive ? tServices("exclusiveSession") : tSessions("meetGreetTitle"),
        groupId: resolvedGroupId,
        groupName: group?.name ?? null,
        buyerId: item.data.buyerId ?? "",
        buyerDisplayName: item.data.buyerDisplayName ?? null,
        buyerUsername: item.data.buyerUsername ?? null,
        buyerAvatarUrl: item.data.buyerAvatarUrl ?? null,
        sourceAvatarUrl: null,
        muxPlaybackId: null,
        videoDuration: null,
        deliveredAt: null,
        profileUserId: item.data.profileUserId ?? null,
        profileDisplayName: item.data.profileDisplayName ?? null,
        profileUsername: item.data.profileUsername ?? null,
        requestSource:
         (item.data.requestSource ?? item.data.source ?? null) as "group" | "profile" | null,
        noShowRole,

        targetName: null,
        requestText: item.data.buyerMessage ?? null,
        status: item.data.status,
        statusLabel: getMeetGreetStatusLabel(item.data.status, tSessions),
        description: item.data.buyerMessage ?? null,
        creatorScheduleNote: getCreatorScheduleNote(item.data),
        creatorScheduleNoteUpdatedAt: toDateSafe(
          item.data.creatorScheduleNoteUpdatedAt
        ),
        rejectionReason: item.data.rejectionReason ?? null,
        refundReason: item.data.refundReason ?? null,
        priceSnapshot:
          typeof item.data.priceSnapshot === "number"
            ? item.data.priceSnapshot
            : null,
        currency: item.data.currency === "USD" ? "USD" : "MXN",
        durationMinutes:
          typeof item.data.durationMinutes === "number"
            ? item.data.durationMinutes
            : null,
        source,
        scheduledAt,
        acceptedAt: toDateSafe(item.data.acceptedAt),
        rejectedAt: toDateSafe(item.data.rejectedAt),
        preparingBuyerAt: toDateSafe(item.data.preparingBuyerAt),
        preparingCreatorAt: toDateSafe(item.data.preparingCreatorAt),
        preparationOpenedAt: toDateSafe(item.data.preparationOpenedAt),
        noShowRejectAt: toDateSafe(item.data.noShowRejectAt),
        autoRejectedAt: toDateSafe(item.data.autoRejectedAt),
        autoRejectReason: item.data.autoRejectReason ?? null,
        createdAt,
        updatedAt,
        creatorScheduleCount: Array.isArray((item.data as { scheduleHistory?: unknown[] }).scheduleHistory) ? (item.data as { scheduleHistory: unknown[] }).scheduleHistory.length : 0,
        scheduleHistory: Array.isArray((item.data as { scheduleHistory?: unknown[] }).scheduleHistory) ? ((item.data as { scheduleHistory: unknown[] }).scheduleHistory as WalletServiceItem["scheduleHistory"]) : [],
        rescheduleHistory: Array.isArray((item.data as { rescheduleHistory?: unknown[] }).rescheduleHistory) ? ((item.data as { rescheduleHistory: unknown[] }).rescheduleHistory as WalletServiceItem["rescheduleHistory"]) : [],
        recordingStatus: null,
        recordingUrl: null,
        recordingDurationSeconds: null,
        recordingExpiresAt: null,
      };
      });
}, [incomingScheduledServices, groupMetaMap]);
  function renderIncomingScheduledServiceCard(row: ScheduledRow, itemKey: string) {
    const req = row.data;
    const isExclusiveSession = row.serviceKind === "exclusive_session";
    const serviceTitle = isExclusiveSession ? tServices("exclusiveSession") : tSessions("meetGreetTitle");
    const buyerName = req.buyerDisplayName ?? tCommon("buyer");
    const buyerAvatar = (req as MeetGreetRequestDoc).buyerAvatarUrl ?? null;
    const buyerInitial = buyerName.charAt(0).toUpperCase();
    const relTime = req.createdAt ? getRelativeTime(req.createdAt as { toDate: () => Date }, tCommon) : null;
    const cardColors = getServiceCardColors(row.serviceKind);
    const bgImage = isExclusiveSession ? "/sesionexclusiva.webp" : "/encuentroenvivo.webp";
    const muted = getSectionForMeetGreetStatus(req.status) === "rejected";

    return (
      <div
        key={itemKey}
        style={{
          ...styles.miniItem,
          ...serviceCardBackgroundStyle(bgImage, cardColors.bg, muted),
          border: "none",
          borderRadius: 12,
          overflow: "hidden",
          padding: 10,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        {buyerAvatar ? (
          <Image
            src={buyerAvatar}
            alt={buyerName}
            width={36} height={36}
            style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "1px solid rgba(255,255,255,0.10)" }}
          />
        ) : (
          <div style={{
            width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
            background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.10)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: 14, color: "#fff",
          }}>
            {buyerInitial}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {buyerName}
          </div>
          <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 2 }}>
            {serviceTitle}{relTime ? ` · ${relTime}` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setIncomingSessionOverlayData({ id: row.id, req, serviceKind: row.serviceKind });
            setIncomingSessionOverlayOpen(true);
          }}
          style={{
            flexShrink: 0,
            height: 28,
            padding: "0 12px",
            borderRadius: 8,
            border: "none",
            background: cardColors.btnBg,
            color: cardColors.btnColor,
            fontWeight: 600,
            fontSize: 11,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {req.status === "reschedule_requested" ? tServices("reschedule") : tServices("viewDetails")}
        </button>
      </div>
    );
  }

  function renderDisplayRow(row: DisplayRow) {
    if (row.rowType === "buyer_greeting") {
      return renderBuyerGreetingCard(row.row, row.id);
    }

    if (row.rowType === "buyer_scheduled") {
      return renderBuyerScheduledServiceCard(row.row, row.id);
    }

    return renderIncomingScheduledServiceCard(row.row, row.id);
  }

  // Tarjeta de sesión/tiempo contigo ENTREGADA (con descarga de grabación).
  function renderDeliveredSessionCard(row: ScheduledRow) {
    const req = row.data;
    const isExclusive = row.serviceKind === "exclusive_session";
    const sessionType = isExclusive ? "exclusive_session" : "meet_greet";
    const creator = userMiniMap[req.creatorId] ?? null;
    const group = req.groupId ? groupMetaMap[req.groupId] ?? null : null;
    const sourceName = req.profileDisplayName ?? creator?.displayName ?? (group?.name ?? tCommon("creator"));
    const sourceAvatar = creator?.photoURL ?? group?.avatarUrl ?? null;
    const sourceInitial = sourceName.charAt(0).toUpperCase();
    const completedTs = req.updatedAt as { toDate: () => Date } | undefined;
    const relTime = completedTs ? getRelativeTime(completedTs, tCommon) : null;
    const downloadBusy = !!downloadBusyMap[row.id];
    // Contador descendente 30 → 0 para descargar la grabación de la sesión.
    const dlRef = toDateSafe(req.scheduledAt);
    const dlElapsed = dlRef
      ? Math.floor((Date.now() - dlRef.getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    const daysLeft = Math.max(0, 30 - dlElapsed);
    const canDownload = daysLeft > 0;
    const bgImage = isExclusive ? "/sesionexclusiva.webp" : "/encuentroenvivo.webp";

    const avatarNode = sourceAvatar ? (
      <Image
        src={sourceAvatar}
        alt={sourceName}
        width={36} height={36}
        style={{ borderRadius: 999, objectFit: "cover", flexShrink: 0, border: "1px solid rgba(255,255,255,0.10)" }}
      />
    ) : (
      <div style={{
        width: 36, height: 36, borderRadius: 999, flexShrink: 0,
        background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.10)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 700, fontSize: 14, color: "#fff",
      }}>
        {sourceInitial}
      </div>
    );

    const downloadButton = (
      <button
        type="button"
        disabled={downloadBusy || !canDownload}
        onClick={async () => {
          setDownloadBusyMap((prev) => ({ ...prev, [row.id]: true }));
          setDownloadErrorMap((prev) => ({ ...prev, [row.id]: null }));
          try {
            const url = await callGetRecordingDownloadUrl({ sessionId: row.id, sessionType });
            window.location.href = url;
          } catch {
            setDownloadErrorMap((prev) => ({ ...prev, [row.id]: tCommon("generalError") }));
          } finally {
            setDownloadBusyMap((prev) => ({ ...prev, [row.id]: false }));
          }
        }}
        style={{
          flexShrink: 0,
          height: 28,
          padding: "0 12px",
          borderRadius: 8,
          border: "none",
          background: canDownload
            ? (isExclusive ? "rgba(244,114,182,0.18)" : "rgba(96,165,250,0.18)")
            : "rgba(255,255,255,0.08)",
          color: canDownload
            ? (isExclusive ? "#f9a8d4" : "#93c5fd")
            : "rgba(255,255,255,0.3)",
          fontWeight: 600,
          fontSize: 11,
          cursor: !canDownload || downloadBusy ? "not-allowed" : "pointer",
          opacity: downloadBusy ? 0.7 : 1,
          whiteSpace: "nowrap",
          fontFamily: "inherit",
        }}
      >
        {downloadBusy ? tCommon("loading") : tServices("downloadSession")}
      </button>
    );

    return (
      <div
        key={`completed-session-${row.id}`}
        style={{
          background: `linear-gradient(rgba(0,0,0,0.62), rgba(0,0,0,0.62)), center / cover no-repeat url("${bgImage}")`,
          border: "none",
          borderRadius: 12,
          overflow: "hidden",
          padding: "12px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {/* 3 partes centradas: creador+tiempo · descarga · botón (línea del lado del avatar). */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* 1 · Creador + hace cuánto */}
          <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", alignItems: "center", gap: 9 }}>
            {avatarNode}
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>
                {sourceName}
              </div>
              {relTime && (
                <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 11, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>
                  {relTime}
                </div>
              )}
            </div>
          </div>

          <span aria-hidden="true" style={{ alignSelf: "stretch", width: 1, background: "rgba(255,255,255,0.14)", flexShrink: 0, margin: "3px 0" }} />

          {/* 2 · Descarga: contador de días o expirado */}
          <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 0 }}>
            {canDownload ? (
              <>
                <span style={{ color: "#fff", fontSize: 10.5, fontWeight: 500, lineHeight: 1.15, textShadow: "0 1px 3px rgba(0,0,0,0.85)" }}>
                  {tServices("downloadLeftPre", { days: daysLeft })}
                </span>
                <span style={{ color: "#fff", fontSize: 22, fontWeight: 600, lineHeight: 1.1, textShadow: "0 1px 5px rgba(0,0,0,0.9)" }}>
                  {daysLeft}
                </span>
                <span style={{ color: "#fff", fontSize: 10.5, fontWeight: 500, lineHeight: 1.15, textShadow: "0 1px 3px rgba(0,0,0,0.85)" }}>
                  {tServices("downloadLeftPost", { days: daysLeft })}
                </span>
              </>
            ) : (
              <span style={{ color: "#fca5a5", fontSize: 12, fontWeight: 600, lineHeight: 1.25, textShadow: "0 1px 3px rgba(0,0,0,0.85)" }}>
                {tServices("downloadExpired")}
              </span>
            )}
          </div>

          {/* 3 · Botón */}
          {canDownload && downloadButton}
        </div>

      </div>
    );
  }

  // Tarjeta de saludo/consejo ENTREGADO.
  function renderDeliveredGreetingCard(row: { id: string; data: GreetingRequestDoc }) {
    const req = row.data;
    const itemKey = `delivered-${row.id}`;
    const isProfile = req.source === "profile";
    const group = req.groupId ? groupMetaMap[req.groupId] ?? null : null;
    const creator = userMiniMap[req.creatorId] ?? null;

    const sourceName = isProfile
      ? (req.profileDisplayName ?? creator?.displayName ?? tCommon("profile"))
      : (group?.name ?? tCommon("community"));
    const sourceAvatar = isProfile
      ? (creator?.photoURL ?? null)
      : (group?.avatarUrl ?? null);
    const sourceInitial = sourceName.charAt(0).toUpperCase();

    const deliveredTs = req.deliveredAt as { toDate: () => Date } | undefined;
    const relTime = deliveredTs ? getRelativeTime(deliveredTs, tCommon) : null;

    const btnLabel = req.type === "consejo" ? tServices("viewAdvice") : tServices("viewGreeting");
    const bgImage = greetingBgImage(req.type);
    const cardColors = getServiceCardColors(req.type);

    return (
      <div
        key={itemKey}
        style={{
          ...styles.miniItem,
          background: serviceCardBackground(bgImage, "rgba(90,41,174,0.14)"),
          border: "none",
          borderRadius: 12,
          overflow: "hidden",
          padding: 10,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        {sourceAvatar ? (
          <Image
            src={sourceAvatar}
            alt={sourceName}
            width={36} height={36}
            style={{ borderRadius: 999, objectFit: "cover", flexShrink: 0, border: "1px solid rgba(255,255,255,0.10)" }}
          />
        ) : (
          <div style={{
            width: 36, height: 36, borderRadius: 999, flexShrink: 0,
            background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.10)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: 14, color: "#fff",
          }}>
            {sourceInitial}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {sourceName}
          </div>
          {relTime && (
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 2 }}>
              {relTime}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setViewDeliveredItem({ item: row, sourceName, sourceAvatar })}
          style={{
            flexShrink: 0,
            width: 112,
            height: 28,
            padding: "0 12px",
            borderRadius: 8,
            border: "none",
            background: cardColors.btnBg,
            color: cardColors.btnColor,
            fontWeight: 600,
            fontSize: 11,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {btnLabel}
        </button>
      </div>
    );
  }

  return (
    <>
    <div style={{ display: "grid", gap: 8 }}>
      {(!activeSection || activeSection === "requested") && (
      <SectionBlock
        sectionKey="requested"
        count={requestedRows.length}
        open={!!activeSection || openSectionKey === "requested"}
        onToggle={() => toggleSection("requested")}
        styles={styles}
        hideHeader={!!activeSection}
      >
        <div className="mini-vertical-scroll" style={{ display: "grid", gap: 8, overflow: "hidden", minWidth: 0 }}>
          {/* Se cargan todos los pendientes de una vez (sin paginar): rara vez
              alguien tiene muchos. */}
          {requestedRows.map(renderDisplayRow)}
        </div>
      </SectionBlock>
      )}

      {(!activeSection || activeSection === "rejected") && (
      <SectionBlock
        sectionKey="rejected"
        count={rejectedRows.length}
        open={!!activeSection || openSectionKey === "rejected"}
        onToggle={() => toggleSection("rejected")}
        styles={styles}
        hideHeader={!!activeSection}
      >
        <div className="mini-vertical-scroll" style={{ display: "grid", gap: 8, overflow: "hidden", minWidth: 0 }}>
          {activeSection ? (
            <>
              {/* En devolución (arriba): siempre visible, sin acordeón. */}
              {refundOnlyRows.length > 0 && (
                <div>
                  <div style={{ ...submenuHeaderStyle, cursor: "default", background: "transparent" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{tServices("refundGroup")}</span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: "#ffffff" }}>{refundOnlyRows.length}</span>
                  </div>
                  <div style={{ display: "grid", gap: 8, paddingTop: 8 }}>
                    {refundOnlyRows.map(renderDisplayRow)}
                  </div>
                </div>
              )}
              {/* Rechazados (abajo): siempre visible, sin acordeón. */}
              {rejectedOnlyRows.length > 0 && (
                <div>
                  <div style={{ ...submenuHeaderStyle, cursor: "default", background: "transparent" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{tServices("rejectedGroup")}</span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: "#ffffff" }}>{rejectedOnlyRows.length}</span>
                  </div>
                  <div style={{ display: "grid", gap: 8, paddingTop: 8 }}>
                    {rejectedOnlyRows.map(renderDisplayRow)}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Submenú: Rechazados */}
              {rejectedOnlyRows.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setRejectedSubOpen((v) => (v === "rejected" ? null : "rejected"))}
                  aria-expanded={rejectedSubOpen === "rejected"}
                  style={submenuHeaderStyle}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{tServices("rejectedGroup")}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>{rejectedOnlyRows.length}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "transform 0.25s ease", transform: rejectedSubOpen === "rejected" ? "rotate(180deg)" : "none" }} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                  </span>
                </button>
                <div style={{ display: "grid", gridTemplateRows: rejectedSubOpen === "rejected" ? "1fr" : "0fr", opacity: rejectedSubOpen === "rejected" ? 1 : 0, transition: "grid-template-rows 320ms cubic-bezier(0.4,0,0.2,1), opacity 200ms ease" }}>
                  <div style={{ overflow: "hidden", minHeight: 0 }}>
                    <div style={{ display: "grid", gap: 8, paddingTop: 8 }}>
                      {rejectedOnlyRows.map(renderDisplayRow)}
                    </div>
                  </div>
                </div>
              </div>
              )}

              {/* Submenú: En devolución */}
              {refundOnlyRows.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setRejectedSubOpen((v) => (v === "refund" ? null : "refund"))}
                  aria-expanded={rejectedSubOpen === "refund"}
                  style={submenuHeaderStyle}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{tServices("refundGroup")}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>{refundOnlyRows.length}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "transform 0.25s ease", transform: rejectedSubOpen === "refund" ? "rotate(180deg)" : "none" }} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                  </span>
                </button>
                <div style={{ display: "grid", gridTemplateRows: rejectedSubOpen === "refund" ? "1fr" : "0fr", opacity: rejectedSubOpen === "refund" ? 1 : 0, transition: "grid-template-rows 320ms cubic-bezier(0.4,0,0.2,1), opacity 200ms ease" }}>
                  <div style={{ overflow: "hidden", minHeight: 0 }}>
                    <div style={{ display: "grid", gap: 8, paddingTop: 8 }}>
                      {refundOnlyRows.map(renderDisplayRow)}
                    </div>
                  </div>
                </div>
              </div>
              )}
            </>
          )}
        </div>
      </SectionBlock>
      )}

      {(!activeSection || activeSection === "rejected") && (
      <SectionBlock
        sectionKey="refund"
        count={refundRows.length}
        open={!!activeSection || openSectionKey === "refund"}
        onToggle={() => toggleSection("refund")}
        styles={styles}
        hideHeader={!!activeSection}
      >
        <div className="mini-vertical-scroll" style={{ display: "grid", gap: 8, overflow: "hidden", minWidth: 0 }}>
          {refundRows.map(renderDisplayRow)}
        </div>
      </SectionBlock>
      )}

      {(!activeSection || activeSection === "delivered") && (buyerDelivered.length > 0 || completedBuyerScheduledRows.length > 0) && (
        <div
          style={{
            ...styles.card,
            margin: 0,
            padding: "7px 10px",
            borderRadius: 14,
            background: "transparent",
            border: "none",
            boxShadow: "none",
            transition: "background 0.25s ease, box-shadow 0.25s ease",
          }}
        >
          {!activeSection && (
          <button
            type="button"
            onClick={() => {
              setDeliveredSectionOpen((v) => !v);
              setOpenSectionKey(null);
              setOpenItemKey(null);
            }}
            aria-expanded={deliveredSectionOpen}
            style={{
              width: "100%",
              minHeight: 34,
              border: "none",
              background: "transparent",
              color: "#fff",
              cursor: "pointer",
              padding: "0 6px 0 0",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              textAlign: "start",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: "#22c55e",
                  border: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12L10 17L19 8" />
                </svg>
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", lineHeight: 1.2, minWidth: 0 }}>
                {tCommon("delivered")}
              </span>
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>{buyerDelivered.length + completedBuyerScheduledRows.length}</span>
          </button>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateRows: activeSection || deliveredSectionOpen ? "1fr" : "0fr",
              opacity: activeSection || deliveredSectionOpen ? 1 : 0,
              transition: "grid-template-rows 360ms cubic-bezier(0.4,0,0.2,1), opacity 220ms ease",
            }}
          >
            <div style={{ overflow: "hidden", minHeight: 0 }}>
            <div
              style={{
                marginTop: activeSection ? 0 : 9,
                paddingTop: activeSection ? 0 : 9,
                borderTop: activeSection ? "none" : "1px solid rgba(255,255,255,0.06)",
                display: "grid",
                gap: 8,
              }}
            >
              {activeSection ? (
                <>
                  {deliveredAll.map((it) =>
                    it.kind === "session"
                      ? renderDeliveredSessionCard(it.row)
                      : renderDeliveredGreetingCard(it.row)
                  )}
                </>
              ) : (
              <>
              {/* Submenú: Sesiones */}
              {deliveredSessions.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setDeliveredSubOpen((v) => (v === "sessions" ? null : "sessions"))}
                  aria-expanded={deliveredSubOpen === "sessions"}
                  style={submenuHeaderStyle}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{tServices("sessionsGroup")}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>{deliveredSessions.length}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "transform 0.25s ease", transform: deliveredSubOpen === "sessions" ? "rotate(180deg)" : "none" }} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                  </span>
                </button>
                <div style={{ display: "grid", gridTemplateRows: deliveredSubOpen === "sessions" ? "1fr" : "0fr", opacity: deliveredSubOpen === "sessions" ? 1 : 0, transition: "grid-template-rows 320ms cubic-bezier(0.4,0,0.2,1), opacity 200ms ease" }}>
                  <div style={{ overflow: "hidden", minHeight: 0 }}>
                    <div style={{ display: "grid", gap: 8, paddingTop: 8 }}>
              {deliveredSessions.map(renderDeliveredSessionCard)}
                    </div>
                  </div>
                </div>
              </div>
              )}

              {/* Submenú: Saludos y consejos */}
              {deliveredGreetings.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setDeliveredSubOpen((v) => (v === "greetings" ? null : "greetings"))}
                  aria-expanded={deliveredSubOpen === "greetings"}
                  style={submenuHeaderStyle}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{tServices("greetingsGroup")}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>{deliveredGreetings.length}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "transform 0.25s ease", transform: deliveredSubOpen === "greetings" ? "rotate(180deg)" : "none" }} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                  </span>
                </button>
                <div style={{ display: "grid", gridTemplateRows: deliveredSubOpen === "greetings" ? "1fr" : "0fr", opacity: deliveredSubOpen === "greetings" ? 1 : 0, transition: "grid-template-rows 320ms cubic-bezier(0.4,0,0.2,1), opacity 200ms ease" }}>
                  <div style={{ overflow: "hidden", minHeight: 0 }}>
                    <div style={{ display: "grid", gap: 8, paddingTop: 8 }}>
              {deliveredGreetings.map(renderDeliveredGreetingCard)}
                    </div>
                  </div>
                </div>
              </div>
              )}
              </>
              )}
            </div>
            </div>
          </div>
        </div>
      )}
    </div>
    {viewItem && (() => {
      const req = viewItem.item.data;
      const group = req.groupId ? groupMetaMap[req.groupId] ?? null : null;
      return (
        <BuyerGreetingRequestOverlay
          item={viewItem.item}
          sourceName={viewItem.sourceName}
          sourceAvatar={viewItem.sourceAvatar}
          onClose={() => setViewItem(null)}
          onRefund={async () => {
            try {
              const res = await requestGreetingRefund({ requestId: viewItem.item.id, refundReason: null });
              const nm = viewItem.sourceName; const av = viewItem.sourceAvatar;
              setViewItem(null);
              setRefundDone({ credited: (res as unknown as { credited?: number })?.credited ?? 0, name: nm, avatar: av });
            } catch (e) {
              showGreetingsToast((e instanceof Error ? cfError(e) : null) ?? tServices("errorRequestRefund"), "error");
            }
          }}
          onRetry={() => {
            setViewItem(null);
            const params = new URLSearchParams();
            params.set("service", req.type);
            params.set("retry", "true");
            if (req.toName) params.set("toName", req.toName);
            if (req.instructions) params.set("instructions", req.instructions);
            if (group?.id) { router.push(`/groups/${group.id}?${params.toString()}`); return; }
            const greetCreatorMini = userMiniMap[req.creatorId] ?? null;
            const username = req.profileUsername ?? greetCreatorMini?.handle ?? null;
            if (username) { router.push(`/u/${username}?${params.toString()}`); }
          }}
        />
      );
    })()}
    {refundDone && (
      <div
        onClick={() => setRefundDone(null)}
        style={{ position: "fixed", inset: 0, zIndex: 2147483647, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "rgba(0,0,0,0.55)" }}
      >
        <div onClick={(e) => e.stopPropagation()} style={{ width: "min(100%, 440px)", maxHeight: "92vh", overflow: "hidden", borderRadius: 16, boxShadow: "0 24px 72px rgba(0,0,0,0.4)", background: "#fff" }}>
          <PaymentSuccessCard
            avatarUrl={refundDone.avatar}
            providerName={refundDone.name ?? undefined}
            productType="Devolución aplicada"
            successMessage={
              refundDone.credited > 0
                ? `Se agregaron ${pf.formatPlain(refundDone.credited, { baseCurrency: SETTLEMENT_CURRENCY, code: true })} a tu crédito disponible. Úsalo para pagar otras experiencias dentro de la plataforma, o solicita el efectivo desde Experiencias.`
                : "Tu solicitud de devolución se procesó. Revisa tu crédito disponible en Experiencias."
            }
            onClose={() => setRefundDone(null)}
            stacked
          />
        </div>
      </div>
    )}
    {viewDeliveredItem && (
      <GreetingReviewOverlay
        viewMode
        buyerViewMode
        buyerSourceName={viewDeliveredItem.sourceName}
        buyerSourceAvatar={viewDeliveredItem.sourceAvatar}
        items={[viewDeliveredItem.item]}
        buyers={{}}
        greetingBusyId={null}
        onReject={() => {}}
        onClose={() => setViewDeliveredItem(null)}
        getInitials={(name) => (name ?? "?").charAt(0).toUpperCase()}
        typeLabel={(t) => t === "consejo" ? tWallet("typeLabelAdvice") : tWallet("typeLabelGreeting")}
      />
    )}
    {viewSessionItem && (() => {
      const { row, creatorName, creatorAvatar } = viewSessionItem;
      const req = row.data;
      const group = req.groupId ? groupMetaMap[req.groupId] ?? null : null;
      const canRequestRefund =
        req.status === "rejected" && !PAGO_YA_DEVUELTO.includes(String(req.paymentStatus ?? ""));
      const creatorMini = userMiniMap[req.creatorId] ?? null;
      const canRetry =
        req.status === "rejected" &&
        (!!group?.id || !!req.profileUsername || !!req.creatorUsername || !!creatorMini?.handle);
      const noShowExpired = isNoShowExpired(req.scheduledAt);
      const canRequestRescheduleOverlay =
        (req.status === "scheduled" || req.status === "ready_to_prepare") &&
        remainingReschedules(req) > 0 &&
        !noShowExpired;
      const canPrepareOverlay =
        (req.status === "scheduled" || req.status === "ready_to_prepare" || req.status === "in_preparation") &&
        isPrepareWindowOpen(req.scheduledAt) &&
        !noShowExpired;
      return (
        <BuyerSessionRequestOverlay
          item={row}
          creatorName={creatorName}
          creatorAvatar={creatorAvatar}
          canRefund={canRequestRefund}
          canRetry={canRetry}
          canReschedule={canRequestRescheduleOverlay}
          canPrepare={canPrepareOverlay}
          busy={!!busyMap[row.id]}
          onClose={() => setViewSessionItem(null)}
          onPrepare={() => {
            handlePrepare(row.id, "buyer", row.serviceKind);
            setViewSessionItem(null);
          }}
          onRefund={(reason) => {
            setViewSessionItem(null);
            handleBuyerRefund(row.id, row.serviceKind, reason);
          }}
          onRetry={() => {
            setViewSessionItem(null);
            const serviceParam = row.serviceKind === "exclusive_session" ? "clase_personalizada" : "meet_greet_digital";
            const params = new URLSearchParams();
            params.set("service", serviceParam);
            params.set("retry", "true");
            if (req.buyerMessage) params.set("message", req.buyerMessage);
            if (group?.id) { router.push(`/groups/${group.id}?${params.toString()}`); return; }
            const username = req.profileUsername ?? req.creatorUsername ?? creatorMini?.handle ?? null;
            if (username) { router.push(`/u/${username}?${params.toString()}`); }
          }}
          onReschedule={(reason) => {
            setRescheduleReasonMap((prev) => ({ ...prev, [row.id]: reason }));
            handleBuyerReschedule(row.id, row.serviceKind, reason);
            setViewSessionItem(null);
          }}
        />
      );
    })()}
    {incomingSessionOverlayData && (
      <SessionRequestOverlay
        open={incomingSessionOverlayOpen}
        onClose={() => {
          setIncomingSessionOverlayOpen(false);
          setTimeout(() => setIncomingSessionOverlayData(null), 300);
        }}
        request={incomingSessionOverlayData.req}
        requestId={incomingSessionOverlayData.id}
        serviceKind={incomingSessionOverlayData.serviceKind}
        earning={
          incomingSessionOverlayData.req.priceSnapshot != null && incomingSessionOverlayData.req.priceSnapshot > 0
            ? formatMoney(incomingSessionOverlayData.req.priceSnapshot * WALLET_NET_RATE, { baseCurrency: incomingSessionOverlayData.req.currency ?? SETTLEMENT_CURRENCY, code: true })
            : null
        }
        busy={!!busyMap[incomingSessionOverlayData.id]}
        ownerCalendarItems={buildCalendarItems}
        getInitials={(name) => name?.charAt(0).toUpperCase() ?? "?"}
        onAccept={() => handleCreatorAccept(incomingSessionOverlayData.id, incomingSessionOverlayData.serviceKind)}
        onReject={(reason) => handleCreatorRejectDirect(incomingSessionOverlayData.id, incomingSessionOverlayData.serviceKind, reason)}
        onSchedule={(scheduledAtIso, note) => handleCreatorScheduleDirect(incomingSessionOverlayData.id, incomingSessionOverlayData.serviceKind, scheduledAtIso, note)}
        onAcceptAndSchedule={(scheduledAtIso, note) => handleCreatorAcceptAndSchedule(incomingSessionOverlayData.id, incomingSessionOverlayData.serviceKind, scheduledAtIso, note)}
        onPrepare={() => handlePrepare(incomingSessionOverlayData.id, "creator", incomingSessionOverlayData.serviceKind)}
        preparationNode={renderPreparationPanel(incomingSessionOverlayData.id, incomingSessionOverlayData.req, "creator")}
        onKeepSchedule={() => handleKeepSchedule(incomingSessionOverlayData.id, incomingSessionOverlayData.serviceKind)}
      />
    )}
    <VibraToast toast={greetingsToast} />
    </>
  );
}
