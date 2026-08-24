"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { Timestamp } from "firebase/firestore";
import { useAuth } from "@/app/providers";
import {
  type WalletServiceItem,
  isSafePendingStatus,
  isExpiredScheduledService,
} from "@/lib/wallet/ownerWallet";
import { useWalletMoney } from "@/lib/wallet/useWalletMoney";
import { WALLET_NET_RATE } from "@/lib/wallet/walletFinances";
import { useWalletData } from "../components/WalletDataContext";
import WalletSectionShell from "../components/WalletSectionShell";
import {
  WalletCard,
  WalletFilterMenu,
  WalletList,
} from "../components/WalletUi";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import WalletFigureSkeleton from "../components/WalletFigureSkeleton";
import { WalletCardsSkeleton } from "../components/WalletListSkeleton";
import GreetingReviewOverlay from "@/app/components/OwnerSidebar/GreetingReviewOverlay";
import SessionRequestOverlay from "@/app/components/OwnerSidebar/SessionRequestOverlay";
import type {
  GreetingRequestDoc,
  MeetGreetRequestDoc,
  UserMini,
} from "@/app/components/OwnerSidebar/OwnerSidebar";
import {
  acceptMeetGreetRequest,
  rejectMeetGreetRequest,
  proposeMeetGreetSchedule,
  setMeetGreetPreparing,
} from "@/lib/meetGreet/meetGreetRequests";
import {
  acceptExclusiveSessionRequest,
  rejectExclusiveSessionRequest,
  proposeExclusiveSessionSchedule,
  setExclusiveSessionPreparing,
} from "@/lib/exclusiveSession/exclusiveSessionRequests";

type PendingFilter =
  | "all"
  | "meet_greet"
  | "exclusive_session"
  | "saludo"
  | "consejo";


function rowToGreetingDoc(row: WalletServiceItem, creatorId: string): GreetingRequestDoc {
  return {
    buyerId: row.buyerId,
    creatorId,
    groupId: row.groupId ?? null,
    profileUserId: row.profileUserId ?? null,
    profileDisplayName: row.profileDisplayName ?? null,
    profileUsername: row.profileUsername ?? null,
    type: row.kind as "saludo" | "consejo",
    toName: row.targetName ?? "",
    instructions: row.requestText ?? "",
    source: (row.requestSource ?? "group") as "group" | "profile",
    status: row.status as "pending" | "accepted" | "rejected" | "delivered",
    createdAt: row.createdAt
      ? ({ toDate: () => row.createdAt as Date } as unknown as Timestamp)
      : undefined,
  };
}

function rowToFakeRequest(row: WalletServiceItem): MeetGreetRequestDoc {
  return {
    buyerId: row.buyerId,
    buyerDisplayName: row.buyerDisplayName ?? null,
    buyerAvatarUrl: row.buyerAvatarUrl ?? null,
    buyerUsername: row.buyerUsername ?? null,
    creatorId: "",
    status: row.status,
    buyerMessage: row.requestText ?? null,
    priceSnapshot: row.priceSnapshot ?? null,
    durationMinutes: row.durationMinutes ?? null,
    scheduledAt: row.scheduledAt,
    createdAt: row.createdAt,
    creatorScheduleNote: row.creatorScheduleNote ?? null,
    scheduleHistory: row.scheduleHistory,
    rescheduleHistory: row.rescheduleHistory,
    rescheduleRequestsUsed: 0,
    rejectionReason: row.rejectionReason ?? null,
    refundReason: null,
  } as unknown as MeetGreetRequestDoc;
}

export default function WalletPendientesPage() {
  const tWallet = useTranslations("wallet");
  const tServices = useTranslations("services");
  // Dinero del CREADOR, en USD o en su moneda según el switch de la wallet.
  // Formateador único: ver `useWalletMoney`.
  const { formatMoney } = useWalletMoney();
  const { user } = useAuth();

  const FILTER_OPTIONS: Array<{ value: PendingFilter; label: string; emoji?: string }> = [
    { value: "all", label: tWallet("filterAllPlural"), emoji: "📋" },
    { value: "meet_greet", label: tWallet("filterLiveSession"), emoji: "🤝" },
    { value: "exclusive_session", label: tWallet("filterExclusiveSession"), emoji: "👑" },
    { value: "saludo", label: tWallet("filterGreetings"), emoji: "👋" },
    { value: "consejo", label: tWallet("filterAdvice"), emoji: "💡" },
  ];

  function translatedTypeLabel(kind: string): string {
    if (kind === "consejo") return tWallet("typeLabelAdvice");
    return tWallet("typeLabelGreeting");
  }
  const walletData = useWalletData();
  const { toast, showToast } = useVibraToast();
  useEffect(() => { if (walletData.error) showToast(walletData.error, "error"); }, [walletData.error]); // eslint-disable-line react-hooks/exhaustive-deps
  const [filter, setFilter] = useState<PendingFilter[]>(["all"]);
  const [recordRow, setRecordRow] = useState<WalletServiceItem | null>(null);
  const [greetingBusyId, setGreetingBusyId] = useState<string | null>(null);

  const [viewItem, setViewItem] = useState<WalletServiceItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);
  useEffect(() => { if (feedbackError) showToast(feedbackError, "error"); }, [feedbackError]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (feedbackSuccess) showToast(feedbackSuccess, "success"); }, [feedbackSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  const safePendingItems = useMemo(() => {
    return walletData.pendingCurrent.filter((item) => {
      if (!isSafePendingStatus(item.status)) return false;
      if (isExpiredScheduledService(item)) return false;
      return true;
    });
  }, [walletData.pendingCurrent]);

  const totalPendingCount = safePendingItems.length;

  const totalPendingAmount = useMemo(() => {
    const sum = safePendingItems.reduce((acc, item) => {
      if (item.priceSnapshot == null) return acc;
      return acc + Math.round(item.priceSnapshot * WALLET_NET_RATE * 100) / 100;
    }, 0);
    return sum > 0 ? sum : null;
  }, [safePendingItems]);

  const filteredItems = useMemo(() => {
    if (filter.includes("all")) return safePendingItems;
    return safePendingItems.filter((item) => filter.includes(item.kind as PendingFilter));
  }, [filter, safePendingItems]);

  const filteredCount = filteredItems.length;

  const overlayBuyers: Record<string, UserMini | null> = useMemo(() => {
    if (!recordRow) return {};
    return {
      [recordRow.buyerId]: {
        uid: recordRow.buyerId,
        displayName: recordRow.buyerDisplayName ?? "Usuario",
        photoURL: recordRow.buyerAvatarUrl ?? null,
        handle: recordRow.buyerUsername ?? null,
      },
    };
  }, [recordRow]);

  const overlayItems = useMemo(() => {
    if (!recordRow || !user?.uid) return [];
    return [{ id: recordRow.id, data: rowToGreetingDoc(recordRow, user.uid) }];
  }, [recordRow, user?.uid]);

  const fakeRequest = useMemo(
    () => viewItem ? rowToFakeRequest(viewItem) : null,
    [viewItem]
  );

  const viewItemEarning = useMemo(() => {
    if (!viewItem?.priceSnapshot || viewItem.priceSnapshot <= 0) return null;
    return formatMoney(viewItem.priceSnapshot * WALLET_NET_RATE);
  }, [viewItem, formatMoney]);

  function closeViewItem() {
    setViewItem(null);
    setFeedbackError(null);
    setFeedbackSuccess(null);
    setBusy(false);
  }

  async function handleAccept() {
    if (!viewItem) return;
    setBusy(true);
    setFeedbackError(null);
    try {
      if (viewItem.source === "exclusive_session") {
        await acceptExclusiveSessionRequest({ requestId: viewItem.id });
      } else {
        await acceptMeetGreetRequest({ requestId: viewItem.id });
      }
    } catch (e) {
      setFeedbackError((e instanceof Error ? e.message : null) ?? tServices("errorAcceptRequest"));
    } finally {
      setBusy(false);
    }
  }

  async function handleReject(reason: string | null) {
    if (!viewItem) return;
    setBusy(true);
    setFeedbackError(null);
    try {
      if (viewItem.source === "exclusive_session") {
        await rejectExclusiveSessionRequest({ requestId: viewItem.id, rejectionReason: reason ?? undefined });
      } else {
        await rejectMeetGreetRequest({ requestId: viewItem.id, rejectionReason: reason ?? undefined });
      }
      closeViewItem();
    } catch (e) {
      setFeedbackError((e instanceof Error ? e.message : null) ?? tServices("errorRejectRequest"));
    } finally {
      setBusy(false);
    }
  }

  async function handleSchedule(scheduledAtIso: string | null, _note: string | null) {
    if (!viewItem || !scheduledAtIso) return;
    setBusy(true);
    setFeedbackError(null);
    try {
      const creatorTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (viewItem.source === "exclusive_session") {
        await proposeExclusiveSessionSchedule({ requestId: viewItem.id, scheduledAt: scheduledAtIso, creatorTimezone });
      } else {
        await proposeMeetGreetSchedule({ requestId: viewItem.id, scheduledAt: scheduledAtIso, creatorTimezone });
      }
      setFeedbackSuccess(tServices("successDateProposed"));
      setTimeout(closeViewItem, 900);
    } catch (e) {
      setFeedbackError((e instanceof Error ? e.message : null) ?? tServices("errorScheduleSession"));
    } finally {
      setBusy(false);
    }
  }

  async function handleAcceptAndSchedule(scheduledAtIso: string | null, note: string | null) {
    if (!viewItem) return;
    setBusy(true);
    setFeedbackError(null);
    try {
      const creatorTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (viewItem.source === "exclusive_session") {
        await acceptExclusiveSessionRequest({ requestId: viewItem.id });
        if (scheduledAtIso) await proposeExclusiveSessionSchedule({ requestId: viewItem.id, scheduledAt: scheduledAtIso, creatorTimezone });
      } else {
        await acceptMeetGreetRequest({ requestId: viewItem.id });
        if (scheduledAtIso) await proposeMeetGreetSchedule({ requestId: viewItem.id, scheduledAt: scheduledAtIso, creatorTimezone });
      }
      setFeedbackSuccess(tServices("successSessionAcceptedAndScheduled"));
      setTimeout(closeViewItem, 900);
    } catch (e) {
      setFeedbackError((e instanceof Error ? e.message : null) ?? tServices("errorScheduleSession"));
    } finally {
      setBusy(false);
    }
  }

  async function handlePrepare() {
    if (!viewItem) return;
    setBusy(true);
    setFeedbackError(null);
    try {
      if (viewItem.source === "exclusive_session") {
        await setExclusiveSessionPreparing({ requestId: viewItem.id, role: "creator" });
      } else {
        await setMeetGreetPreparing({ requestId: viewItem.id, role: "creator" });
      }
    } catch (e) {
      setFeedbackError((e instanceof Error ? e.message : null) ?? tServices("errorOpenPreparation"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <WalletSectionShell activeTab="pending">
      {/* Cifra "Total a liberar" — arriba de la card (como WalletMonthlyStats en
          historial), para que el título quede DEBAJO de la cifra. */}
      {walletData.loading ? (
        <div
          style={{
            marginTop: 14,
            marginBottom: 2,
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}
        >
          {/* Etiqueta estática inmediata; skeleton solo en las cifras. */}
          <span style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.5)" }}>
            {tWallet("totalToRelease")}
          </span>
          <WalletFigureSkeleton width={170} height={28} />
          <WalletFigureSkeleton width={110} height={13} />
        </div>
      ) : totalPendingCount === 0 ? (
        <div style={{ marginTop: 14, marginBottom: 2, textAlign: "center" }}>
          <p style={{ margin: "0 0 4px", fontSize: 12, color: "rgba(255,255,255,0.50)", fontFamily: "inherit", fontWeight: 500 }}>
            {tWallet("totalToRelease")}
          </p>
          <p style={{ margin: 0, fontSize: 28, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.03em", color: "rgba(255,255,255,0.25)", fontFamily: "inherit" }}>
            {formatMoney(0)}
          </p>
        </div>
      ) : totalPendingAmount != null ? (
        <div style={{ marginTop: 14, marginBottom: 2, textAlign: "center" }}>
          <p style={{ margin: "0 0 4px", fontSize: 12, color: "rgba(255,255,255,0.50)", fontFamily: "inherit", fontWeight: 500 }}>
            {tWallet("totalToRelease")}
          </p>
          <p style={{ margin: "0 0 8px", fontSize: 28, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.03em", color: "#86efac", fontFamily: "inherit" }}>
            {formatMoney(Math.round(totalPendingAmount * 100) / 100, { code: true })}
          </p>
          <p style={{ margin: 0, fontSize: 13, color: "#fff", fontFamily: "inherit", fontWeight: 500 }}>
            {tWallet("pendingCount", { count: totalPendingCount })}
          </p>
        </div>
      ) : null}

      <WalletCard
        title={tWallet("pendientesTitle")}
        transparent
        headerRight={
          !walletData.loading && totalPendingCount > 0 ? (
            <WalletFilterMenu
              label={tWallet("filterLabel")}
              menuLabel={tWallet("filterPendingMenu")}
              value={filter}
              options={FILTER_OPTIONS}
              onChange={setFilter}
              allValue="all"
            />
          ) : undefined
        }
      >
        <>
          {walletData.loading ? (
            <WalletCardsSkeleton count={3} />
          ) : totalPendingCount === 0 ? (
            <div style={{ textAlign: "center", color: "rgba(255,255,255,0.5)", fontSize: 13, padding: "18px 0" }}>
              {tWallet("noPending")}
            </div>
          ) : filteredCount > 0 ? (
            <WalletList
              items={filteredItems}
              calendarItems={walletData.calendar}
              onRecord={setRecordRow}
              onView={(row) => {
                setViewItem(row);
                setFeedbackError(null);
                setFeedbackSuccess(null);
                setBusy(false);
              }}
            />
          ) : (
            <div style={{ textAlign: "center", color: "rgba(255,255,255,0.5)", fontSize: 13, padding: "18px 0" }}>
              {tWallet("noFilterResults")}
            </div>
          )}
        </>
      </WalletCard>

      {recordRow && overlayItems.length > 0 && (
        <GreetingReviewOverlay
          items={overlayItems}
          buyers={overlayBuyers}
          startIndex={0}
          greetingBusyId={greetingBusyId}
          onAccept={async (id) => {
            setGreetingBusyId(id);
            try {
              const { respondGreetingRequest } = await import("@/lib/greetings/greetingRequests");
              await respondGreetingRequest({ requestId: id, action: "accept" });
            } finally {
              setGreetingBusyId(null);
            }
          }}
          onReject={async (id) => {
            setGreetingBusyId(id);
            try {
              const { respondGreetingRequest } = await import("@/lib/greetings/greetingRequests");
              await respondGreetingRequest({ requestId: id, action: "reject" });
            } finally {
              setGreetingBusyId(null);
              setRecordRow(null);
            }
          }}
          onClose={() => setRecordRow(null)}
          getInitials={(name) => (name ?? "U").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
          typeLabel={translatedTypeLabel}
        />
      )}

      {viewItem && fakeRequest && (
        <SessionRequestOverlay
          open={viewItem !== null}
          onClose={closeViewItem}
          request={fakeRequest}
          requestId={viewItem.id}
          serviceKind={viewItem.source as "meet_greet" | "exclusive_session"}
          busy={busy}
          earning={viewItemEarning}
          ownerCalendarItems={walletData.calendar}
          getInitials={(name) => name?.charAt(0).toUpperCase() ?? "?"}
          onAccept={handleAccept}
          onReject={handleReject}
          onSchedule={handleSchedule}
          onAcceptAndSchedule={handleAcceptAndSchedule}
          onPrepare={handlePrepare}
          onKeepSchedule={async () => closeViewItem()}
        />
      )}

      <VibraToast toast={toast} />
    </WalletSectionShell>
  );
}
