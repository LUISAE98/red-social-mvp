"use client";

// Pestaña "Todo" dentro de Entregados: lista completa de TODAS las compras del
// usuario (los 11 servicios), más reciente arriba. Datos: useAllPurchases (espejo
// users/{uid}/purchases). Tarjeta genérica por tipo (etiqueta i18n + creador/
// comunidad + monto + fecha + estado).

import Image from "next/image";
import { useTranslations } from "next-intl";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import {
  ledgerStatusColor,
  ledgerStatusLabelKey,
  ledgerTypeLabelKey,
  type LedgerStatus,
} from "@/lib/wallet/walletLedger";
import { getRelativeTime } from "@/app/components/OwnerSidebar/OwnerSidebarGreetings.parts";
import { useAllPurchases } from "@/lib/experiences/useAllPurchases";

export default function PurchasesTodoList({ uid }: { uid: string | null | undefined }) {
  const tCommon = useTranslations("common");
  const tWallet = useTranslations("wallet");
  const { format: formatMoney } = usePriceFormat();
  const { purchases, userMiniMap, groupMetaMap, loading } = useAllPurchases(uid);

  if (loading) {
    return (
      <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, textAlign: "center", padding: "24px 0" }}>
        {tCommon("loading")}
      </p>
    );
  }

  if (purchases.length === 0) {
    return (
      <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, textAlign: "center", padding: "24px 0" }}>
        {tCommon("noPurchasesYet")}
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {purchases.map((r) => {
        const d = r.data;
        const isGroup = d.channelType === "group" && !!d.channelId;
        const group = isGroup ? groupMetaMap[d.channelId as string] ?? null : null;
        const creator = userMiniMap[d.creatorId] ?? null;
        const name = isGroup ? (group?.name ?? tCommon("community")) : (creator?.displayName ?? tCommon("creator"));
        const avatar = isGroup ? (group?.avatarUrl ?? null) : (creator?.photoURL ?? null);
        const initial = name.charAt(0).toUpperCase();
        const tsForRel = d.occurredAt?.toDate ? d.occurredAt : d.createdAt?.toDate ? d.createdAt : null;
        const relTime = tsForRel ? getRelativeTime(tsForRel as { toDate: () => Date }, tCommon) : null;
        const typeLabel = tWallet(ledgerTypeLabelKey(d.type));
        const refunded = d.status !== "paid";

        return (
          <div
            key={r.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: 10,
              borderRadius: 12,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {avatar ? (
              <Image
                src={avatar}
                alt={name}
                width={36}
                height={36}
                style={{ borderRadius: 999, objectFit: "cover", flexShrink: 0, border: "1px solid rgba(255,255,255,0.10)" }}
              />
            ) : (
              <div style={{
                width: 36, height: 36, borderRadius: 999, flexShrink: 0,
                background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.10)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, fontSize: 14, color: "#fff",
              }}>
                {initial}
              </div>
            )}

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {name}
              </div>
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {typeLabel}{relTime ? ` · ${relTime}` : ""}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
              <span style={{ color: "#fff", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", textDecoration: refunded ? "line-through" : "none", opacity: refunded ? 0.6 : 1 }}>
                {formatMoney(d.grossAmount)}
              </span>
              {refunded && (
                <span style={{ fontSize: 10, fontWeight: 600, color: ledgerStatusColor(d.status as LedgerStatus) }}>
                  {tWallet(ledgerStatusLabelKey(d.status as LedgerStatus))}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
