"use client";

import { useMemo, useState } from "react";
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

type HistoryFilter =
  | "all"
  | "rejected"
  | "refund_in_progress"
  | "meet_greet"
  | "saludo"
  | "consejo"
  | "mensaje";

const FILTER_OPTIONS: Array<{ value: HistoryFilter; label: string; emoji?: string }> = [
  { value: "all", label: "Todo", emoji: "📋" },
  { value: "rejected", label: "Rechazados", emoji: "❌" },
  { value: "refund_in_progress", label: "En devolución", emoji: "💸" },
  { value: "meet_greet", label: "Meet & Greet", emoji: "🤝" },
  { value: "saludo", label: "Saludos", emoji: "👋" },
  { value: "consejo", label: "Consejos", emoji: "💡" },
  { value: "mensaje", label: "Mensajes", emoji: "💬" },
];

function filterHistoryItems(
  rows: WalletServiceItem[],
  filter: HistoryFilter
): WalletServiceItem[] {
  switch (filter) {
    case "all":
      return rows;

    case "rejected":
      return rows.filter((row) => {
        if (row.source === "meet_greet") {
          return row.status === "rejected" || row.status === "cancelled";
        }

        return row.status === "rejected";
      });

    case "refund_in_progress":
      return rows.filter((row) => {
        if (row.source !== "meet_greet") return false;

        return (
          row.status === "refund_requested" ||
          row.status === "refund_review"
        );
      });

    case "meet_greet":
case "saludo":
case "consejo":
case "mensaje":
  return rows.filter((row) => {
    if (row.kind !== filter) return false;

    if (row.source === "meet_greet") {
      return (
        row.status !== "rejected" &&
        row.status !== "cancelled" &&
        row.status !== "refund_requested" &&
        row.status !== "refund_review"
      );
    }

    return row.status !== "rejected";
  });

    default:
      return rows;
  }
}

export default function WalletHistorialPage() {
  const { user } = useAuth();
  const walletData = useOwnerWalletData(user?.uid);
  const [filter, setFilter] = useState<HistoryFilter>("all");

  const filteredItems = useMemo(() => {
    return filterHistoryItems(walletData.history, filter);
  }, [filter, walletData.history]);

  return (
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
          <WalletList items={filteredItems} />
        ) : (
          <EmptyRows
            title="Sin historial"
            subtitle="No hay movimientos para el filtro seleccionado."
          />
        )}
      </WalletCard>
    </WalletSectionShell>
  );
}