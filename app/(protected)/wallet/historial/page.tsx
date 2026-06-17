"use client";

import { useMemo, useState } from "react";
import type { Timestamp } from "firebase/firestore";
import { useAuth } from "@/app/providers";
import { useOwnerWalletData } from "@/lib/wallet/ownerWallet";
import type { WalletServiceItem } from "@/lib/wallet/ownerWallet";
import WalletSectionShell from "../components/WalletSectionShell";
import {
  EmptyRows,
  WalletCard,
  WalletErrorBox,
  WalletFilterMenu,
  WalletList,
} from "../components/WalletUi";
import GreetingReviewOverlay from "@/app/components/OwnerSidebar/GreetingReviewOverlay";
import type { GreetingRequestDoc, UserMini } from "@/app/components/OwnerSidebar/OwnerSidebar";

type HistoryFilter =
  | "all"
  | "refund_in_progress"
  | "rejected"
  | "meet_greet"
  | "exclusive_session"
  | "saludo"
  | "consejo"
  | "mensaje";

const FILTER_OPTIONS: Array<{ value: HistoryFilter; label: string; emoji?: string }> = [
  { value: "all", label: "Todo", emoji: "📋" },
  { value: "rejected", label: "Rechazados", emoji: "❌" },
  { value: "refund_in_progress", label: "En devolución", emoji: "💸" },
  { value: "meet_greet", label: "Meet & Greet", emoji: "🤝" },
  { value: "exclusive_session", label: "Sesión exclusiva", emoji: "👑" },
  { value: "saludo", label: "Saludos", emoji: "👋" },
  { value: "consejo", label: "Consejos", emoji: "💡" },
  { value: "mensaje", label: "Mensajes", emoji: "💬" },
];

function getInitials(name?: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function typeLabel(t: string): string {
  if (t === "consejo") return "Consejo";
  if (t === "mensaje") return "Mensaje";
  return "Saludo";
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

function filterHistoryItems(
  rows: WalletServiceItem[],
  filter: HistoryFilter
): WalletServiceItem[] {
  switch (filter) {
    case "all":
      return rows;

    case "rejected":
      return rows.filter((row) => {
        if (isScheduledService(row)) {
          return row.status === "rejected" || row.status === "cancelled";
        }

        return row.status === "rejected";
      });

    case "refund_in_progress":
      return rows.filter((row) => {
        if (!isScheduledService(row)) return false;

        return (
          row.status === "refund_requested" ||
          row.status === "refund_review"
        );
      });

    case "meet_greet":
    case "exclusive_session":
    case "saludo":
    case "consejo":
    case "mensaje":
      return rows.filter((row) => row.kind === filter);

    default:
      return rows;
  }
}

export default function WalletHistorialPage() {
  const { user } = useAuth();
  const walletData = useOwnerWalletData(user?.uid);
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [viewRow, setViewRow] = useState<WalletServiceItem | null>(null);

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

  const historyItems = useMemo(() => {
  const expiredItems = walletData.pendingCurrent
    .filter(isExpiredScheduledService)
    .map((row) => ({
      ...row,
      status: "rejected",
      statusLabel: "Rechazado",
      rejectionReason:
        row.rejectionReason ||
        "No se conectó dentro de los 15 minutos de tolerancia.",
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

      <WalletCard
        title="Historial"
        headerRight={
          <WalletFilterMenu
            label="Filtro"
            menuLabel="Filtrar historial"
            value={filter}
            options={FILTER_OPTIONS}
            onChange={setFilter}
          />
        }
      >
        {walletData.loading ? (
          <EmptyRows
            title="Cargando historial"
            subtitle="Estamos leyendo tus servicios procesados."
          />
        ) : filteredItems.length > 0 ? (
          <WalletList items={filteredItems} mode="history" onView={setViewRow} />
        ) : (
          <EmptyRows
            title="Sin historial"
            subtitle="No hay movimientos para el filtro seleccionado."
          />
        )}
      </WalletCard>
    </WalletSectionShell>

    {viewRow && overlayItems.length > 0 && (
      <GreetingReviewOverlay
        viewMode
        items={overlayItems}
        buyers={overlayBuyers}
        greetingBusyId={null}
        onReject={() => {}}
        onClose={() => setViewRow(null)}
        getInitials={getInitials}
        typeLabel={typeLabel}
      />
    )}
  </>
  );
}