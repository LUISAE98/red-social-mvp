"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { Timestamp } from "firebase/firestore";
import { useAuth } from "@/app/providers";
import type { WalletServiceItem } from "@/lib/wallet/ownerWallet";
import { useWalletData } from "../components/WalletDataContext";
import WalletSectionShell from "../components/WalletSectionShell";
import WalletMonthlyStats from "../components/WalletMonthlyStats";
import {
  EmptyRows,
  WalletCard,
  WalletErrorBox,
  WalletFilterMenu,
  WalletList,
} from "../components/WalletUi";
import GreetingReviewOverlay from "@/app/components/OwnerSidebar/GreetingReviewOverlay";
import type { GreetingRequestDoc, UserMini } from "@/app/components/OwnerSidebar/OwnerSidebar";
import SessionRequestOverlay from "@/app/components/OwnerSidebar/SessionRequestOverlay";
import type { MeetGreetRequestDoc } from "@/app/components/OwnerSidebar/OwnerSidebar";

type HistoryFilter =
  | "all"
  | "refund_in_progress"
  | "rejected"
  | "meet_greet"
  | "exclusive_session"
  | "saludo"
  | "consejo";

function getInitials(name?: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
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
    muxPlaybackId: row.muxPlaybackId ?? undefined,
    videoDuration: row.videoDuration ?? undefined,
    deliveredAt: row.deliveredAt
      ? ({ toDate: () => row.deliveredAt as Date } as unknown as Timestamp)
      : undefined,
    allowCreatorStory: row.allowCreatorStory,
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

function isScheduledService(row: WalletServiceItem): boolean {
  return row.source === "meet_greet" || row.source === "exclusive_session";
}

function isNoShowExpired(value: Date | null): boolean {
  if (!value) return false;

  const rejectAt = value.getTime() + 15 * 60 * 1000;

  return Date.now() >= rejectAt;
}

function isExpiredScheduledService(row: WalletServiceItem): boolean {
  if (!isScheduledService(row)) return false;

  if (
    row.status !== "scheduled" &&
    row.status !== "ready_to_prepare" &&
    row.status !== "in_preparation"
  ) {
    return false;
  }

  return isNoShowExpired(row.scheduledAt);
}

function rowMatchesFilter(row: WalletServiceItem, f: HistoryFilter): boolean {
  switch (f) {
    case "all":
      return true;
    case "rejected":
      return isScheduledService(row)
        ? row.status === "rejected" || row.status === "cancelled"
        : row.status === "rejected";
    case "refund_in_progress":
      return (
        isScheduledService(row) &&
        (row.status === "refund_requested" || row.status === "refund_review")
      );
    default:
      return row.kind === f;
  }
}

function filterHistoryItems(
  rows: WalletServiceItem[],
  filters: HistoryFilter[]
): WalletServiceItem[] {
  if (filters.includes("all") || filters.length === 0) return rows;
  return rows.filter((row) => filters.some((f) => rowMatchesFilter(row, f)));
}

export default function WalletHistorialPage() {
  const tWallet = useTranslations("wallet");
  const { user } = useAuth();
  const walletData = useWalletData();
  const [filter, setFilter] = useState<HistoryFilter[]>(["all"]);
  const [viewRow, setViewRow] = useState<WalletServiceItem | null>(null);

  const FILTER_OPTIONS: Array<{ value: HistoryFilter; label: string; emoji?: string; color?: string }> = [
    { value: "all", label: tWallet("filterAll"), emoji: "📋" },
    { value: "meet_greet", label: tWallet("filterLiveSession"), emoji: "🤝" },
    { value: "exclusive_session", label: tWallet("filterExclusiveSession"), emoji: "👑" },
    { value: "saludo", label: tWallet("filterGreetings"), emoji: "👋" },
    { value: "consejo", label: tWallet("filterAdvice"), emoji: "💡" },
    { value: "refund_in_progress", label: tWallet("filterRefundInProgress"), emoji: "💸", color: "#f87171" },
    { value: "rejected", label: tWallet("filterRejected"), emoji: "❌", color: "#f87171" },
  ];

  function translatedTypeLabel(kind: string): string {
    if (kind === "consejo") return tWallet("typeLabelAdvice");
    if (kind === "mensaje") return tWallet("typeLabelMessage");
    return tWallet("typeLabelGreeting");
  }

  const overlayBuyers: Record<string, UserMini | null> = useMemo(() => {
    if (!viewRow) return {};
    return {
      [viewRow.buyerId]: {
        uid: viewRow.buyerId,
        displayName: viewRow.buyerDisplayName ?? "Usuario",
        photoURL: viewRow.buyerAvatarUrl ?? null,
        handle: viewRow.buyerUsername ?? null,
      },
    };
  }, [viewRow]);

  const overlayItems = useMemo(() => {
    if (!viewRow || !user?.uid) return [];
    return [{ id: viewRow.id, data: rowToGreetingDoc(viewRow, user.uid) }];
  }, [viewRow, user?.uid]);

  const sessionViewRow = viewRow && isScheduledService(viewRow) ? viewRow : null;
  const fakeSessionRequest = useMemo(
    () => (sessionViewRow ? rowToFakeRequest(sessionViewRow) : null),
    [sessionViewRow]
  );

  const historyItems = useMemo(() => {
  const expiredItems = walletData.pendingCurrent
    .filter(isExpiredScheduledService)
    .map((row) => ({
      ...row,
      status: "rejected",
      statusLabel: tWallet("noShowStatusLabel"),
      rejectionReason:
        row.rejectionReason ||
        tWallet("noShowRejectionReason"),
    }));

  const existingKeys = new Set(
    walletData.history.map((row) => `${row.source}-${row.id}`)
  );

  const mergedExpiredItems = expiredItems.filter(
    (row) => !existingKeys.has(`${row.source}-${row.id}`)
  );

  return [...mergedExpiredItems, ...walletData.history];
}, [walletData.history, walletData.pendingCurrent]);

const filteredItems = useMemo(() => {
  return filterHistoryItems(historyItems, filter);
}, [filter, historyItems]);

  return (
    <>
    <WalletSectionShell activeTab="history">
      {walletData.error ? <WalletErrorBox message={walletData.error} /> : null}

      <WalletMonthlyStats uid={user?.uid} />

      <WalletCard
        title={tWallet("historialTitle")}
        transparent
        headerRight={
          <WalletFilterMenu
            label={tWallet("filterLabel")}
            menuLabel={tWallet("filterHistorialMenu")}
            value={filter}
            options={FILTER_OPTIONS}
            onChange={setFilter}
            allValue="all"
          />
        }
      >
        <>
          <style jsx>{`
            @keyframes skelPulseH {
              0%, 100% { opacity: 0.5; }
              50%       { opacity: 1; }
            }
            .skelH {
              background: rgba(255,255,255,0.10);
              border-radius: 6px;
              animation: skelPulseH 1.4s ease-in-out infinite;
            }
            .skelCardH {
              display: flex;
              align-items: center;
              gap: 12px;
              padding: 13px 14px;
              border-radius: 14px;
              background: rgba(255,255,255,0.04);
            }
          `}</style>

          {walletData.loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skelCardH">
                  <div className="skelH" style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0 }} />
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                    <div className="skelH" style={{ width: "50%", height: 13, borderRadius: 5 }} />
                    <div className="skelH" style={{ width: "35%", height: 11, borderRadius: 5 }} />
                  </div>
                  <div className="skelH" style={{ width: 90, height: 32, borderRadius: 8, flexShrink: 0 }} />
                </div>
              ))}
            </div>
          ) : filteredItems.length > 0 ? (
            <WalletList items={filteredItems} mode="history" onView={setViewRow} />
          ) : (
            <EmptyRows
              title={tWallet("emptyHistorial")}
              subtitle={tWallet("emptyHistorialSubtitle")}
            />
          )}
        </>
      </WalletCard>
    </WalletSectionShell>

    {viewRow && !isScheduledService(viewRow) && overlayItems.length > 0 && (
      <GreetingReviewOverlay
        viewMode={viewRow.status !== "rejected" && viewRow.status !== "devolucion"}
        readOnly={viewRow.status === "rejected" || viewRow.status === "devolucion"}
        items={overlayItems}
        buyers={overlayBuyers}
        greetingBusyId={null}
        onReject={() => {}}
        onClose={() => setViewRow(null)}
        getInitials={getInitials}
        typeLabel={translatedTypeLabel}
      />
    )}

    {sessionViewRow && fakeSessionRequest && (
      <SessionRequestOverlay
        open={true}
        onClose={() => setViewRow(null)}
        request={fakeSessionRequest}
        requestId={sessionViewRow.id}
        serviceKind={sessionViewRow.source as "meet_greet" | "exclusive_session"}
        earning={null}
        busy={false}
        feedbackError={null}
        feedbackSuccess={null}
        ownerCalendarItems={[]}
        getInitials={(name) => (name ?? "?").charAt(0).toUpperCase()}
        onAccept={() => {}}
        onReject={async () => {}}
        onSchedule={async () => {}}
        onAcceptAndSchedule={() => {}}
        onPrepare={() => {}}
        readOnly={true}
      />
    )}
  </>
  );
}