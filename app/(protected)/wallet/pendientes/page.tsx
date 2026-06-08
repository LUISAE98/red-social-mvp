"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@/app/providers";
import { useOwnerWalletData, type WalletServiceItem } from "@/lib/wallet/ownerWallet";
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

type PendingFilter =
  | "all"
  | "meet_greet"
  | "exclusive_session"
  | "saludo"
  | "consejo"
  | "mensaje";

const FILTER_OPTIONS: Array<{
  value: PendingFilter;
  label: string;
  emoji?: string;
}> = [
  { value: "all", label: "Todos", emoji: "📋" },
  { value: "meet_greet", label: "Meet & Greet", emoji: "🤝" },
  { value: "exclusive_session", label: "Sesión exclusiva", emoji: "👑" },
  { value: "saludo", label: "Saludos", emoji: "👋" },
  { value: "consejo", label: "Consejos", emoji: "💡" },
  { value: "mensaje", label: "Mensajes", emoji: "💬" },
];

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
      ? ({ toDate: () => row.createdAt as Date } as any)
      : undefined,
  };
}

export default function WalletPendientesPage() {
  const { user } = useAuth();
  const walletData = useOwnerWalletData(user?.uid);
  const [filter, setFilter] = useState<PendingFilter>("all");
  const [recordRow, setRecordRow] = useState<WalletServiceItem | null>(null);
  const [greetingBusyId, setGreetingBusyId] = useState<string | null>(null);

  const safePendingItems = useMemo(() => {
  return walletData.pendingCurrent.filter((item) => {
    if (!isSafePendingStatus(item.status)) return false;
    if (isExpiredScheduledService(item)) return false;

    return true;
  });
}, [walletData.pendingCurrent]);

  const totalPendingCount = safePendingItems.length;

  const filteredItems = useMemo(() => {
    if (filter === "all") return safePendingItems;
    return safePendingItems.filter((item) => item.kind === filter);
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

  return (
    <WalletSectionShell activeTab="pending">
      {walletData.error ? <WalletErrorBox message={walletData.error} /> : null}

      <WalletCard
        title={`Pendientes (${totalPendingCount})`}
        headerRight={
          <WalletFilterMenu
            label="Filtro"
            menuLabel="Filtrar pendientes"
            value={filter}
            options={FILTER_OPTIONS}
            onChange={setFilter}
          />
        }
      >
        {walletData.loading ? (
          <EmptyRows
            title="Cargando pendientes"
            subtitle="Estamos leyendo tus servicios y solicitudes activas."
          />
        ) : filteredCount > 0 ? (
          <WalletList
            items={filteredItems}
            calendarItems={walletData.calendar}
            onRecord={setRecordRow}
          />
        ) : (
          <EmptyRows
            title={
              totalPendingCount > 0
                ? "No hay resultados para este filtro"
                : "Sin pendientes actuales"
            }
            subtitle={
              totalPendingCount > 0
                ? "Cambia el filtro para ver otros pendientes activos."
                : "No tienes servicios pendientes por atender en este momento."
            }
          />
        )}
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
          typeLabel={(t) => t === "consejo" ? "Consejo" : t === "mensaje" ? "Mensaje" : "Saludo"}
        />
      )}
    </WalletSectionShell>
  );
}