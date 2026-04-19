"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@/app/providers";
import { useOwnerWalletData } from "@/lib/wallet/ownerWallet";
import WalletSectionShell from "../components/WalletSectionShell";
import {
  EmptyRows,
  WalletCard,
  WalletErrorBox,
  WalletFilterMenu,
  WalletList,
} from "../components/WalletUi";

type PendingFilter = "all" | "meet_greet" | "saludo" | "consejo" | "mensaje";

const FILTER_OPTIONS: Array<{
  value: PendingFilter;
  label: string;
  emoji?: string;
}> = [
  { value: "all", label: "Todos", emoji: "📋" },
  { value: "meet_greet", label: "Meet & Greet", emoji: "🤝" },
  { value: "saludo", label: "Saludos", emoji: "👋" },
  { value: "consejo", label: "Consejos", emoji: "💡" },
  { value: "mensaje", label: "Mensajes", emoji: "💬" },
];

export default function WalletPendientesPage() {
  const { user } = useAuth();
  const walletData = useOwnerWalletData(user?.uid);
  const [filter, setFilter] = useState<PendingFilter>("all");

  const totalPendingCount = walletData.pendingCurrent.length;

  const filteredItems = useMemo(() => {
    if (filter === "all") return walletData.pendingCurrent;
    return walletData.pendingCurrent.filter((item) => item.kind === filter);
  }, [filter, walletData.pendingCurrent]);

  const filteredCount = filteredItems.length;

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
          <WalletList items={filteredItems} />
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
    </WalletSectionShell>
  );
}