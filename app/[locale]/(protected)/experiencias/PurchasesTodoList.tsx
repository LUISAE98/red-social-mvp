"use client";

// Pestaña "Todo" dentro de Entregados: lista completa de TODAS las compras del
// usuario (los 11 servicios), más reciente arriba. Datos: useAllPurchases (espejo
// users/{uid}/purchases). Tarjeta genérica por tipo (etiqueta i18n + creador/
// comunidad + monto + fecha + estado).

import Image from "next/image";
import { SETTLEMENT_CURRENCY, FIXED_SERVICE_FEE_USD } from "@/lib/currency/catalog";
import { TextButton } from "@/components/ui";
import { useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { descargarDocumentoFiscal } from "@/lib/facturacion/descargarDocumento";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { formatCurrency } from "@/lib/currency/format";
import {
  ledgerStatusColor,
  ledgerStatusLabelKey,
  ledgerTypeLabelKey,
  type LedgerServiceType,
  type LedgerStatus,
} from "@/lib/wallet/walletLedger";
import { WalletFilterMenu } from "@/app/(protected)/wallet/components/WalletUi";
import { getRelativeTime } from "@/app/components/OwnerSidebar/OwnerSidebarGreetings.parts";
import { useAllPurchases } from "@/lib/experiences/useAllPurchases";
import BuyerInvoicePanel, { type InvoiceConcept } from "./BuyerInvoicePanel";
import { CardsSkeleton } from "@/components/ui/ListSkeleton";

type TodoTypeFilter = LedgerServiceType | "all";

export default function PurchasesTodoList({ uid }: { uid: string | null | undefined }) {
  const tCommon = useTranslations("common");
  const tWallet = useTranslations("wallet");
  const locale = useLocale();
  const pf = usePriceFormat();
  const formatMoney = pf.format;
  const { purchases, userMiniMap, groupMetaMap, loading } = useAllPurchases(uid);

  // Filtro por servicio: solo se ofrecen los tipos presentes (sin filtros vacíos).
  const [typeFilter, setTypeFilter] = useState<TodoTypeFilter[]>(["all"]);
  const presentTypes = useMemo(() => {
    const set = new Set<LedgerServiceType>();
    purchases.forEach((r) => set.add(r.data.type));
    return Array.from(set);
  }, [purchases]);
  const typeOptions = useMemo(
    () => [
      { value: "all" as TodoTypeFilter, label: tWallet("filterTypeAllValue") },
      ...presentTypes.map((t) => ({ value: t as TodoTypeFilter, label: tWallet(ledgerTypeLabelKey(t)) })),
    ],
    [presentTypes, tWallet]
  );
  const typeSelLabel = typeFilter.includes("all")
    ? tWallet("filterTypeAllValue")
    : typeOptions.filter((o) => o.value !== "all" && typeFilter.includes(o.value)).map((o) => o.label).join(", ");
  const filterActive = !typeFilter.includes("all");
  const visible = filterActive ? purchases.filter((r) => typeFilter.includes(r.data.type)) : purchases;

  // ── Modo selección para facturar ──────────────────────────────────────────
  // Al dar "Da clic aquí para facturar" se entra en selección: cada card se puede
  // marcar (aro morado en el avatar) y "Listo" abre el panel de facturación con
  // los movimientos elegidos.
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [panelOpen, setPanelOpen] = useState(false);

  /*
   * Facturables: pagadas, no facturadas y YA ENTREGADAS.
   *
   * 🚨 Lo de la entrega no es cosmético. El servidor rechaza igualmente lo que está por
   *    entregarse, así que sin este filtro el comprador podría seleccionar cosas y llevarse un
   *    error sin entender por qué. La guarda de verdad está en `compraLibre`, del backend.
   */
  const selectableIds = useMemo(
    () =>
      visible
        .filter(
          (r) =>
            r.data.status === "paid" &&
            r.data.invoiced !== true &&
            r.data.pendienteEntrega !== true
        )
        .map((r) => r.id),
    [visible]
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  function enterSelection() {
    setSelecting(true);
    setSelectedIds(new Set());
  }
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelectedIds((prev) => (selectableIds.every((id) => prev.has(id)) ? new Set() : new Set(selectableIds)));
  }
  function handleListo() {
    if (selectedIds.size > 0) setPanelOpen(true);
    else setSelecting(false); // sin selección, "Listo" solo sale del modo selección
  }
  // Al facturar con éxito: salir del modo selección y limpiar la selección, para
  // volver a "Da clic aquí para facturar". Las compras facturadas se actualizan
  // solas por el snapshot (quedan marcadas invoiced=true y muestran "· Facturado").
  function handleGenerate() {
    setSelecting(false);
    setSelectedIds(new Set());
  }

  // Conceptos seleccionados → panel de facturación (base + IVA por compra).
  const selectedConcepts: InvoiceConcept[] = useMemo(
    () =>
      purchases
        .filter((r) => selectedIds.has(r.id))
        .map((r) => {
          const d = r.data;
          const isGroup = d.channelType === "group" && !!d.channelId;
          const group = isGroup ? groupMetaMap[d.channelId as string] ?? null : null;
          const creator = userMiniMap[d.creatorId] ?? null;
          const name = isGroup ? (group?.name ?? tCommon("community")) : (creator?.displayName ?? tCommon("creator"));
          return {
            id: r.id,
            name,
            typeLabel: tWallet(ledgerTypeLabelKey(d.type)),
            base: d.grossAmount || 0,
            tax: d.taxAmount || 0,
            currency: d.currency,
            // Quién EMITE la factura de esta compra. Bajo intermediación el vendedor es el
            // creador, así que la selección se parte en una factura por cada uno.
            creatorId: d.creatorId,
          };
        }),
    [purchases, selectedIds, groupMetaMap, userMiniMap, tCommon, tWallet]
  );

  if (loading) {
    return <CardsSkeleton count={4} height={72} gap={8} />;
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
      {/* Renglón de filtros: filtro (izq) + contador (der). */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0, overflow: "hidden" }}>
          <WalletFilterMenu
            label={typeSelLabel}
            menuLabel={tWallet("filterTypeMenu")}
            value={typeFilter}
            options={typeOptions}
            onChange={setTypeFilter}
            allValue="all"
            transparent
          />
        </div>
        <span style={{ color: "#ffffff", fontSize: 15, fontWeight: 700, lineHeight: 1, paddingInlineEnd: 4, flexShrink: 0 }}>
          {purchases.length}
        </span>
      </div>

      {/* Botón para facturar: en su propio renglón, DEBAJO de los filtros, para
          que no se salga del margen derecho en celular. */}
      {!selecting && (
        <TextButton tone="brand" size="sm" style={{ justifySelf: "start", margin: 0, fontFamily: "inherit", textAlign: "start" }} onClick={enterSelection}>
          {tWallet("invoiceCta")}
        </TextButton>
      )}

      {/* Modo selección: instrucción morada + fila "Seleccionar todo" / "Listo". */}
      {selecting && (
        <div style={{ display: "grid", gap: 8, marginTop: -2 }}>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12.5, fontWeight: 500, lineHeight: 1.4 }}>
            {tWallet("invoiceSelectInstruction")}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <TextButton
              tone="brand"
              size="sm"
              onClick={toggleSelectAll}
              disabled={selectableIds.length === 0}
              style={{ margin: 0, whiteSpace: "nowrap" }}
            >
              {allSelected ? tWallet("invoiceSelectNone") : tWallet("invoiceSelectAll")}
            </TextButton>
            {/* "Listo" con el estilo del botón "Entrar" del login: píldora con
                gradiente rosa→morado→azul, para que resalte como acción. */}
            <button
              type="button"
              onClick={handleListo}
              style={{
                border: "none", padding: "7px 20px", borderRadius: 6,
                backgroundImage: "linear-gradient(100deg, #ff2fb3 0%, #a855f7 35%, #4f46ff 70%, #ff2fb3 100%)",
                backgroundSize: "280% 280%", backgroundPosition: "0% 50%",
                color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600,
                letterSpacing: "-0.01em", fontFamily: "inherit", lineHeight: 1.2,
                whiteSpace: "nowrap", boxShadow: "0 10px 28px rgba(168,85,255,0.22)",
              }}
            >
              {tWallet("invoiceDone")}
            </button>
          </div>
        </div>
      )}
      {visible.map((r) => {
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
        const invoiced = d.invoiced === true;
        /*
         * 🧾 El comprador de FUERA tiene recibo, no CFDI.
         *
         * El CFDI es un documento mexicano y a él no le aplica. Sin este enlace se quedaba sin
         * ningún papel de lo que pagó. Al mexicano no se le enseña: su venta la ampara un CFDI
         * y darle además algo que se le parece lo invitaría a presentarlo en su declaración.
         */
        const pais = String(d.taxCountry ?? "").toUpperCase();
        const tieneRecibo = !refunded && pais !== "" && pais !== "MX";
        /*
         * 🧾 El PDF de su CFDI, que lo genera Facturapi. Puede haber varias notas de crédito:
         *    una devolución parcial no agota la compra.
         */
        const notas = d.notasCredito?.emitidas ?? [];
        // Devuelto: a crédito (saldo a favor) o a la tarjeta (rechazo antes de cobrar).
        const returnedToCredit = d.refundDestination === "credit";
        const returnedToCard = d.refundDestination === "card";
        const isReturn = returnedToCredit || returnedToCard;
        // ⚠️ Si se guardó lo que DE VERDAD se cobró —importe y moneda del cargo— se usa tal
        // cual, sin reconvertir. `refundedAmount` va en la moneda de liquidación y pasarlo
        // otra vez por la fórmula del comprador le suma el 2% y lo redondea al paso: una
        // devolución de 810.99 MXN se enseñaba como 825.
        const cobroReal =
          typeof d.presentmentAmount === "number" && d.presentmentAmount > 0 && d.presentmentCurrency
            ? { monto: d.presentmentAmount, moneda: d.presentmentCurrency }
            : null;
        const returnAmount = typeof d.refundedAmount === "number" ? d.refundedAmount : d.grossAmount;
        // Facturable/seleccionable solo si está pagada y NO facturada aún.
        const selectable = selecting && !refunded && !invoiced;
        const selected = selectedIds.has(r.id);

        return (
          <div
            key={r.id}
            role={selectable ? "button" : undefined}
            aria-pressed={selectable ? selected : undefined}
            onClick={selectable ? () => toggleSelect(r.id) : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: 10,
              borderRadius: 12,
              background: "transparent",
              border: "none",
              cursor: selectable ? "pointer" : "default",
              opacity: selecting && (refunded || invoiced) ? 0.45 : 1,
              WebkitTapHighlightColor: "transparent",
              transition: "opacity 160ms ease",
            }}
          >
            {/* Avatar con aro de selección (aparece/desaparece con animación). */}
            <div style={{ position: "relative", width: 36, height: 36, flexShrink: 0 }}>
              {avatar ? (
                <Image
                  src={avatar}
                  alt={name}
                  width={36}
                  height={36}
                  style={{ borderRadius: 999, objectFit: "cover", border: "1px solid rgba(255,255,255,0.10)" }}
                />
              ) : (
                <div style={{
                  width: 36, height: 36, borderRadius: 999,
                  background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.10)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 700, fontSize: 14, color: "#fff",
                }}>
                  {initial}
                </div>
              )}
              <span
                aria-hidden="true"
                style={{
                  position: "absolute", inset: -3, borderRadius: 999,
                  border: "2px solid #a855f7", boxShadow: "0 0 0 2px rgba(168,85,247,0.22)",
                  opacity: selected ? 1 : 0,
                  transform: selected ? "scale(1)" : "scale(0.6)",
                  transition: "opacity 160ms ease, transform 220ms cubic-bezier(0.34,1.56,0.64,1)",
                  pointerEvents: "none",
                }}
              />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                <span style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                  {name}
                </span>
                {invoiced && (
                  <span style={{ color: "#a855f7", fontWeight: 600, fontSize: 12, lineHeight: 1.2, whiteSpace: "nowrap", flexShrink: 0 }}>
                    · Facturado
                  </span>
                )}
              </div>
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {isReturn
                  ? <>{typeLabel} · {returnedToCredit ? "Devuelto en crédito usable para la plataforma" : "Devuelto a tu tarjeta"}</>
                  : <>{typeLabel}{relTime ? ` · ${relTime}` : ""}</>}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
              {isReturn ? (
                // Devuelto: cifra en verde con "+" (lo que volvió al saldo/tarjeta). No tachado.
                <span style={{ color: "#4ade80", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
                  +
                  {cobroReal
                    ? formatCurrency(cobroReal.monto, cobroReal.moneda, pf.locale)
                    : formatMoney(returnAmount, { baseCurrency: d.currency ?? SETTLEMENT_CURRENCY })}
                </span>
              ) : (
                <>
                  <span style={{ color: "#fff", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", textDecoration: refunded ? "line-through" : "none", opacity: refunded ? 0.6 : 1 }}>
                    {/* ⚠️ Lo que el comprador PAGÓ, no la base del creador. `grossAmount` es
                        la base: sin el cargo fijo, sin el impuesto y sin el redondeo
                        comercial. Convertirla a secas enseñaba 690 MXN por una compra de
                        810.99. Si se guardó el cobro real se usa tal cual; si no, se
                        recompone con el mismo cálculo de la pasarela. */}
                    {cobroReal
                      ? formatCurrency(cobroReal.monto, cobroReal.moneda, pf.locale)
                      : pf.formatWithTax(d.grossAmount + FIXED_SERVICE_FEE_USD, {
                          baseCurrency: SETTLEMENT_CURRENCY,
                        }).total}
                  </span>
                  {refunded && (
                    <span style={{ fontSize: 10, fontWeight: 600, color: ledgerStatusColor(d.status as LedgerStatus) }}>
                      {tWallet(ledgerStatusLabelKey(d.status as LedgerStatus))}
                    </span>
                  )}
                  {tieneRecibo && (
                    <a
                      href={`/${locale}/comprobante/recibo/${r.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 10, fontWeight: 600, color: "#a855f7", textDecoration: "none" }}
                    >
                      {tWallet("receiptsPayment")}
                    </a>
                  )}
                  {invoiced && d.invoiceId && uid && (
                    <Bajar
                      texto={tWallet("receiptsInvoicePdf")}
                      onBajar={() =>
                        descargarDocumentoFiscal({
                          tipo: "factura",
                          referencia: d.invoiceId as string,
                          buyerId: uid,
                        })
                      }
                    />
                  )}
                  {uid &&
                    notas.map((nc) =>
                      nc.facturapiId ? (
                        <Bajar
                          key={nc.facturapiId}
                          texto={tWallet("receiptsCreditNotePdf")}
                          onBajar={() =>
                            descargarDocumentoFiscal({
                              tipo: "notaCredito",
                              referencia: nc.facturapiId as string,
                              buyerId: uid,
                            })
                          }
                        />
                      ) : null
                    )}
                </>
              )}
            </div>
          </div>
        );
      })}

      <BuyerInvoicePanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        uid={uid}
        concepts={selectedConcepts}
        formatMoney={formatMoney}
        onConfirm={handleGenerate}
      />
    </div>
  );
}


/**
 * Botón de descarga de un CFDI.
 *
 * 🚨 Con estado propio y con el error a la vista. Bajar un PDF pasa por un callable, la red y
 *    Facturapi: puede tardar segundos y puede fallar. Un botón mudo deja al comprador dándole
 *    clic sin saber si pasó algo.
 */
function Bajar({ texto, onBajar }: { texto: string; onBajar: () => Promise<void> }) {
  const [estado, setEstado] = useState<"listo" | "bajando" | "error">("listo");
  return (
    <button
      type="button"
      disabled={estado === "bajando"}
      onClick={async () => {
        setEstado("bajando");
        try {
          await onBajar();
          setEstado("listo");
        } catch {
          setEstado("error");
        }
      }}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        cursor: estado === "bajando" ? "default" : "pointer",
        fontSize: 10,
        fontWeight: 600,
        color: estado === "error" ? "#f87171" : "#a855f7",
        opacity: estado === "bajando" ? 0.5 : 1,
      }}
    >
      {texto}
    </button>
  );
}