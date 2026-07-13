"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { Timestamp } from "firebase/firestore";
import { useAuth } from "@/app/providers";
import { type WalletServiceItem } from "@/lib/wallet/ownerWallet";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { useWalletData } from "../components/WalletDataContext";
import WalletSectionShell from "../components/WalletSectionShell";
import {
  EmptyRows,
  WalletCard,
  WalletErrorBox,
  WalletFilterMenu,
  WalletList,
} from "../components/WalletUi";
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


function isSafePendingStatus(status: string): boolean {
  return ![
    "rejected",
    "refund_requested",
    "refund_review",
    "cancelled",
    "completed",
  ].includes(status);
}

function isNoShowExpired(value: Date | null): boolean {
  if (!value) return false;
  const rejectAt = value.getTime() + 15 * 60 * 1000;
  return Date.now() >= rejectAt;
}

function isExpiredScheduledService(item: {
  kind: string;
  scheduledAt: Date | null;
  preparingCreatorAt?: Date | null;
  preparingBuyerAt?: Date | null;
  status?: string;
}): boolean {
  const isScheduledService =
    item.kind === "meet_greet" || item.kind === "exclusive_session";
  if (!isScheduledService) return false;
  if (
    item.status !== "scheduled" &&
    item.status !== "ready_to_prepare" &&
    item.status !== "in_preparation"
  ) {
    return false;
  }
  return isNoShowExpired(item.scheduledAt);
}

function rowToGreetingDoc(row: WalletServiceItem, creatorId: string): GreetingRequestDoc {
  return {
    buyerId: row.buyerId,
    creatorId,
    groupId: row.groupId ?? null,
    profileUserId: row.profileUserId ?? null,
    profileDisplayName: row.profileDisplayName ?? null,
    profileUsername: row.profileUsername ?? null,
    type: row.kind as "saludo" | "consejo" | "mensaje",
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
  const { format: formatMoney } = usePriceFormat();
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
    if (kind === "mensaje") return tWallet("typeLabelMessage");
    return tWallet("typeLabelGreeting");
  }
  const walletData = useWalletData();
  const [filter, setFilter] = useState<PendingFilter[]>(["all"]);
  const [recordRow, setRecordRow] = useState<WalletServiceItem | null>(null);
  const [greetingBusyId, setGreetingBusyId] = useState<string | null>(null);

  const [viewItem, setViewItem] = useState<WalletServiceItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);

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
      return acc + Math.round(item.priceSnapshot * 0.77 * 100) / 100;
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
    return formatMoney(viewItem.priceSnapshot * 0.77, { baseCurrency: viewItem.currency ?? "MXN" });
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
      setFeedbackError((e instanceof Error ? e.message : null) ?? tWallet("cannotAccept"));
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
      setFeedbackError((e instanceof Error ? e.message : null) ?? tWallet("cannotReject"));
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
      setFeedbackSuccess(tWallet("sessionScheduled"));
      setTimeout(closeViewItem, 900);
    } catch (e) {
      setFeedbackError((e instanceof Error ? e.message : null) ?? tWallet("cannotSchedule"));
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
      setFeedbackSuccess(tWallet("sessionAcceptedAndScheduled"));
      setTimeout(closeViewItem, 900);
    } catch (e) {
      setFeedbackError((e instanceof Error ? e.message : null) ?? tWallet("cannotAcceptAndSchedule"));
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
      setFeedbackError((e instanceof Error ? e.message : null) ?? tWallet("cannotPrepare"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <WalletSectionShell activeTab="pending">
      {walletData.error ? <WalletErrorBox message={walletData.error} /> : null}

      <WalletCard transparent>
        <>
          <style jsx>{`
            @keyframes skelPulse {
              0%, 100% { opacity: 0.5; }
              50%       { opacity: 1; }
            }
            .skel {
              background: rgba(255,255,255,0.10);
              border-radius: 6px;
              animation: skelPulse 1.4s ease-in-out infinite;
            }
            .skelCard {
              display: flex;
              align-items: center;
              gap: 12px;
              padding: 13px 14px;
              border-radius: 14px;
              background: rgba(255,255,255,0.04);
            }
          `}</style>

          {/* ── Loading skeletons ── */}
          {walletData.loading ? (
            <>
              <div style={{ marginTop: -8, marginBottom: 14, textAlign: "center" }}>
                <div className="skel" style={{ width: 120, height: 11, borderRadius: 5, margin: "0 auto 8px" }} />
                <div className="skel" style={{ width: 180, height: 32, borderRadius: 8, margin: "0 auto 10px" }} />
                <div className="skel" style={{ width: 100, height: 13, borderRadius: 5, margin: "0 auto" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skelCard">
                    <div className="skel" style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0 }} />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                      <div className="skel" style={{ width: "55%", height: 13, borderRadius: 5 }} />
                      <div className="skel" style={{ width: "38%", height: 11, borderRadius: 5 }} />
                    </div>
                    <div className="skel" style={{ width: 90, height: 32, borderRadius: 8, flexShrink: 0 }} />
                  </div>
                ))}
              </div>
            </>

          /* ── Sin pendientes ── */
          ) : totalPendingCount === 0 ? (
            <div style={{ marginTop: -8, marginBottom: 0, textAlign: "center" }}>
              <p style={{ margin: "0 0 4px", fontSize: 12, color: "rgba(255,255,255,0.50)", fontFamily: "inherit", fontWeight: 500 }}>
                {tWallet("totalToRelease")}
              </p>
              <p style={{ margin: "0 0 8px", fontSize: 28, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.03em", color: "rgba(255,255,255,0.25)", fontFamily: "inherit" }}>
                {formatMoney(0)}
              </p>
              <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.45)", fontFamily: "inherit", fontWeight: 400 }}>
                {tWallet("noPending")}
              </p>
            </div>

          /* ── Con pendientes ── */
          ) : (
            <>
              {totalPendingAmount != null && (
                <div style={{ marginTop: -8, marginBottom: 14, textAlign: "center" }}>
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
              )}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <WalletFilterMenu
                  label={tWallet("filterLabel")}
                  menuLabel={tWallet("filterPendingMenu")}
                  value={filter}
                  options={FILTER_OPTIONS}
                  onChange={setFilter}
                  allValue="all"
                  transparent
                />
              </div>
              {filteredCount > 0 ? (
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
                <EmptyRows
                  title={tWallet("noFilterResults")}
                  subtitle={tWallet("noFilterResultsSubtitle")}
                />
              )}
            </>
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
          feedbackError={feedbackError}
          feedbackSuccess={feedbackSuccess}
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
    </WalletSectionShell>
  );
}
