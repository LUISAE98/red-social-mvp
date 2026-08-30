"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { intlLocale } from "@/i18n/locales";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { WalletCard, WalletFilterMenu } from "./WalletUi";
import WalletSubscriptions from "./WalletSubscriptions";
import WalletActiveSubscribers from "./WalletActiveSubscribers";
import WalletLives from "./WalletLives";
import WalletTickets from "./WalletTickets";
import WalletChannelFilter from "./WalletChannelFilter";
import WalletMovementsChart, { type ChartBucket } from "./WalletMovementsChart";
import WithdrawBreakdown, { type DesgloseRetiro } from "./WithdrawBreakdown";
import { useMediaSlideReservedHeight } from "@/app/[locale]/groups/[groupId]/components/posts/useMediaSlideReservedHeight";
import { useOwnedChannels } from "@/lib/wallet/walletSubscriptionData";
import { useWalletMoney } from "@/lib/wallet/useWalletMoney";
import {
  useWalletLedger,
  ledgerTypeLabelKey,
  ledgerStatusLabelKey,
  ledgerStatusColor,
  type LedgerEntry,
  type LedgerStatus,
  type LedgerServiceType,
} from "@/lib/wallet/walletLedger";

// Orden y emoji de las 11 experiencias para el filtro por tipo.
const TYPE_ORDER: Array<{ value: LedgerServiceType; emoji: string }> = [
  { value: "live_donation", emoji: "🎁" },
  { value: "profile_donation", emoji: "💝" },
  { value: "live_ticket", emoji: "🎟️" },
  { value: "supercomment", emoji: "💬" },
  { value: "advice", emoji: "💡" },
  { value: "greeting", emoji: "👋" },
  { value: "premium_post", emoji: "🔒" },
  { value: "live_session", emoji: "🔴" },
  { value: "exclusive_session", emoji: "⭐" },
  { value: "subscription", emoji: "🔄" },
  { value: "vod_ticket", emoji: "🎬" },
];

function formatDate(date: Date | null, locale: string): string {
  if (!date) return "";
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date);
  } catch {
    return "";
  }
}

type Filter = "all" | LedgerStatus | "withdrawal" | "subscription" | "lives" | "tickets";

const FILTERS: Filter[] = ["all", "withdrawal", "subscription", "lives", "tickets"];

// Paginación: 50 por página; se precargan los siguientes 50 al acercarse
// a 20 filas del final de la lista visible (≈ fila 30 de 50).
const PAGE_SIZE = 50;
const PREFETCH_OFFSET = 20;

// "2026-06" → "Junio 2026" (localizado, nivel módulo por la regla de pureza).
function monthLabelOf(ym: string, locale: string): string {
  const [y, m] = ym.split("-").map(Number);
  try {
    const s = new Intl.DateTimeFormat(locale, {
      month: "long",
      year: "numeric",
    }).format(new Date(y, m - 1, 1));
    return s.charAt(0).toUpperCase() + s.slice(1);
  } catch {
    return ym;
  }
}
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
// Clave de canal de un movimiento (misma convención que el filtro/ledger).
function entryChannelKey(e: LedgerEntry): string {
  return e.channelType === "group" && e.channelId ? `g:${e.channelId}` : "profile";
}
// "2026-07" → "jul 26" (etiqueta corta para el eje de la gráfica).
function monthShort(ym: string, locale: string): string {
  const [y, m] = ym.split("-").map(Number);
  try {
    const s = new Intl.DateTimeFormat(locale, { month: "short" })
      .format(new Date(y, m - 1, 1))
      .replace(".", "");
    return `${s} ${String(y).slice(2)}`;
  } catch {
    return ym;
  }
}

export default function WalletTransactions({
  uid,
  mode,
  impuestosRecaudados,
  desgloseRetiro,
}: {
  uid: string | null | undefined;
  mode: "net" | "gross";
  /**
   * Impuestos que pagaron sus compradores, ya formateado. `null` si no hay ninguno.
   *
   * Solo se enseña en la pestaña de Retiros, que es donde el creador viene a entender qué
   * pasó con su dinero. En «Todos» sería ruido, porque ahí está mirando sus ventas.
   */
  impuestosRecaudados?: string | null;
  /**
   * Qué le llega si retira hoy. Lo calcula Finanzas con `calcularRetiro`; aquí solo se
   * pinta, con el MISMO componente que usa el panel de retiro para no contradecirlo.
   */
  desgloseRetiro?: DesgloseRetiro | null;
}) {
  const tWallet = useTranslations("wallet");
  const locale = useLocale();
  // Dinero del CREADOR, en USD o en su moneda según el switch de la wallet.
  // Formateador único: ver `useWalletMoney`.
  const { formatMoney } = useWalletMoney();
  const [filter, setFilter] = useState<Filter>("all");
  // Filtro por estado dentro de "Todos" (multi-selección, mismo menú que Pendientes/Historial).
  const [statusFilter, setStatusFilter] = useState<Array<"all" | LedgerStatus>>(["all"]);
  // Filtro por mes dentro de "Todos".
  const [monthFilter, setMonthFilter] = useState<string[]>(["all"]);
  // Filtro por experiencia (tipo de servicio) dentro de "Todos".
  const [typeFilter, setTypeFilter] = useState<Array<"all" | LedgerServiceType>>(["all"]);
  const [limitCount, setLimitCount] = useState(PAGE_SIZE);
  const { entries, loading } = useWalletLedger(uid, limitCount);
  // Filtro por canal (perfil + comunidades). ["all"] = todos; aplica a "Todos" y
  // "Suscriptores", no a "Retiros". Multi-selección.
  const { channels } = useOwnedChannels(uid);
  const [channelFilter, setChannelFilter] = useState<string[]>(["all"]);

  // Movimientos acotados al canal seleccionado.
  const channelEntries = useMemo(() => {
    if (channelFilter.includes("all")) return entries;
    const allow = new Set(channelFilter);
    return entries.filter((e) => allow.has(entryChannelKey(e)));
  }, [entries, channelFilter]);

  // + acotado por experiencia (tipo). Base de lista, gráfica y resumen.
  const scopedEntries = useMemo(() => {
    if (typeFilter.includes("all")) return channelEntries;
    const allow = new Set(typeFilter);
    return channelEntries.filter((e) => allow.has(e.type));
  }, [channelEntries, typeFilter]);

  // Estado de la pestaña Suscriptores según el canal elegido.
  const subChannelState = useMemo(() => {
    if (channelFilter.includes("all")) return { mode: "all" as const };
    const selectedGroups = channelFilter
      .filter((k) => k.startsWith("g:"))
      .map((k) => k.slice(2));
    const isSub = new Map(
      channels.filter((c) => c.type === "group").map((c) => [c.id as string, c.isSubscription])
    );
    const validSubs = selectedGroups.filter((id) => isSub.get(id) === true);
    if (validSubs.length) return { mode: "filtered" as const, communityIds: validSubs };
    const onlyProfile = channelFilter.includes("profile") && selectedGroups.length === 0;
    return {
      mode: "message" as const,
      message: onlyProfile
        ? tWallet("subFilterProfileNoSub")
        : tWallet("subFilterCommunityNoSub"),
    };
  }, [channelFilter, channels, tWallet]);

  // Meses disponibles (desde el primer registro cargado).
  const MONTH_OPTIONS = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      const d = e.occurredAt ?? e.createdAt;
      if (d) set.add(monthKey(d));
    }
    const months = [...set].sort().reverse(); // más reciente primero
    return [
      { value: "all", label: tWallet("filterMonthAllValue"), emoji: "📅" },
      ...months.map((ym) => ({ value: ym, label: monthLabelOf(ym, locale) })),
    ];
  }, [entries, locale, tWallet]);

  const monthSelLabel = monthFilter.includes("all")
    ? tWallet("filterMonthAllValue")
    : monthFilter.map((ym) => monthLabelOf(ym, locale)).join(", ");

  const TYPE_OPTIONS: Array<{
    value: "all" | LedgerServiceType;
    label: string;
    emoji?: string;
  }> = [
    { value: "all", label: tWallet("filterTypeAllValue"), emoji: "🎭" },
    ...TYPE_ORDER.map((t) => ({
      value: t.value,
      label: tWallet(ledgerTypeLabelKey(t.value)),
      emoji: t.emoji,
    })),
  ];

  const typeSelLabel = typeFilter.includes("all")
    ? tWallet("filterTypeAllValue")
    : typeFilter
        .filter((t): t is LedgerServiceType => t !== "all")
        .map((t) => tWallet(ledgerTypeLabelKey(t)))
        .join(", ");

  const statusSelLabel = statusFilter.includes("all")
    ? tWallet("filterStatusAllValue")
    : statusFilter
        .filter((s): s is LedgerStatus => s !== "all")
        .map((s) => tWallet(ledgerStatusLabelKey(s)))
        .join(", ");

  const STATUS_OPTIONS: Array<{
    value: "all" | LedgerStatus;
    label: string;
    emoji?: string;
    color?: string;
  }> = [
    { value: "all", label: tWallet("filterAll"), emoji: "📋" },
    { value: "earned", label: tWallet("txStatusEarned"), emoji: "✅" },
    { value: "pending", label: tWallet("txStatusPending"), emoji: "⏳" },
    { value: "refunded", label: tWallet("txStatusRefunded"), emoji: "💸" },
    { value: "rejected", label: tWallet("txStatusRejected"), emoji: "❌", color: "#f87171" },
  ];

  const visible = useMemo(() => {
    // Retiros: aún no se registran en el libro mayor. Suscriptores y Lives: panel aparte.
    if (
      filter === "withdrawal" ||
      filter === "subscription" ||
      filter === "lives" ||
      filter === "tickets"
    )
      return [];
    let list = scopedEntries;
    // Filtro por estado (multi-selección).
    if (!statusFilter.includes("all")) {
      list = list.filter((e) => statusFilter.includes(e.status));
    }
    // Filtro por mes.
    if (!monthFilter.includes("all")) {
      list = list.filter((e) => {
        const d = e.occurredAt ?? e.createdAt;
        return d ? monthFilter.includes(monthKey(d)) : false;
      });
    }
    return list;
  }, [scopedEntries, filter, statusFilter, monthFilter]);

  // Meses a graficar: los seleccionados (o todos los disponibles), en orden.
  const chartMonths = useMemo(() => {
    const present = new Set<string>();
    for (const e of scopedEntries) {
      const d = e.occurredAt ?? e.createdAt;
      if (d) present.add(monthKey(d));
    }
    const all = [...present].sort();
    return monthFilter.includes("all") ? all : monthFilter.filter((m) => present.has(m)).sort();
  }, [scopedEntries, monthFilter]);

  // Tramos de la gráfica: 1 mes → 4 semanas; varios meses → un punto por mes.
  const chartBuckets = useMemo<ChartBucket[]>(() => {
    if (chartMonths.length === 1) {
      const [y, m] = chartMonths[0].split("-").map(Number);
      const ranges: Array<[number, number]> = [
        [1, 7],
        [8, 14],
        [15, 21],
        [22, 31],
      ];
      return ranges.map(([a, b], i) => ({
        key: `w${i}`,
        label: tWallet("weekShort", { n: i + 1 }),
        test: (d: Date) =>
          d.getFullYear() === y &&
          d.getMonth() === m - 1 &&
          d.getDate() >= a &&
          d.getDate() <= b,
      }));
    }
    return chartMonths.map((ym) => {
      const [y, m] = ym.split("-").map(Number);
      return {
        key: ym,
        label: monthShort(ym, locale),
        test: (d: Date) => d.getFullYear() === y && d.getMonth() === m - 1,
      };
    });
  }, [chartMonths, locale, tWallet]);

  // Resumen (Ganado · Rechazado · Reembolsado) del mes filtrado.
  const summary = useMemo(() => {
    const scoped = monthFilter.includes("all")
      ? scopedEntries
      : scopedEntries.filter((e) => {
          const d = e.occurredAt ?? e.createdAt;
          return d ? monthFilter.includes(monthKey(d)) : false;
        });
    let earned = 0;
    let rejected = 0;
    let refunded = 0;
    for (const e of scoped) {
      const amt = mode === "gross" ? e.grossAmount : e.netAmount;
      if (e.status === "earned") earned += amt;
      else if (e.status === "rejected") rejected += amt;
      else if (e.status === "refunded") refunded += amt;
    }
    return { earned, rejected, refunded };
  }, [scopedEntries, monthFilter, mode]);

  // Puede haber más en el servidor si la ventana llegó a su tope.
  const hasMore = filter !== "withdrawal" && entries.length >= limitCount;

  const loadMore = useCallback(() => {
    setLimitCount((c) => c + PAGE_SIZE);
  }, []);

  // Pestañas: pill deslizante + dirección del deslizamiento del contenido.
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabsNavRef = useRef<HTMLDivElement | null>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const [tabDir, setTabDir] = useState(0);

  // Reserva de altura del área de pestañas para que, al cambiar a una con poco
  // contenido, el contenedor no colapse ni "salte" durante el deslizamiento (mismo
  // sistema que el sub-subnav de medios en perfil/comunidad). "Todos" es la lista
  // paginada grande → NO infla el piso; las demás (retiros/suscriptores/lives/
  // tickets) sí. El piso se aplica a todas.
  const { contentRef: tabContentRef, minHeight: tabMinHeight } =
    useMediaSlideReservedHeight(filter !== "all");

  const selectFilter = (f: Filter) => {
    const from = FILTERS.indexOf(filter as Filter);
    const to = FILTERS.indexOf(f);
    setTabDir(to > from ? 1 : to < from ? -1 : 0);
    setFilter(f);
    setLimitCount(PAGE_SIZE);
  };

  // Mide la pestaña activa para posicionar el pill (y re-mide al redimensionar).
  useEffect(() => {
    const measure = () => {
      const idx = FILTERS.indexOf(filter as Filter);
      const el = tabRefs.current[idx];
      if (!el) return;
      setPill({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [filter, locale]);

  // Observa la fila-gatillo (20 antes del final) para precargar la próxima página.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (obs) => {
        if (obs.some((o) => o.isIntersecting)) loadMore();
      },
      { rootMargin: "300px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore, visible.length]);

  const triggerIndex = Math.max(0, visible.length - PREFETCH_OFFSET);

  const filterLabel = (f: Filter) =>
    f === "all"
      ? tWallet("txFilterAll")
      : f === "withdrawal"
        ? tWallet("txFilterWithdrawals")
        : f === "subscription"
          ? tWallet("txFilterSubscribers")
          : f === "lives"
            ? tWallet("txFilterLives")
            : f === "tickets"
              ? tWallet("txFilterTickets")
              : tWallet(ledgerStatusLabelKey(f));

  return (
    <WalletCard transparent>
      {/* Título centrado, separado del panel de arriba. */}
      <span
        style={{
          display: "block",
          textAlign: "center",
          fontSize: 18,
          fontWeight: 600,
          color: "#fff",
          letterSpacing: "-0.02em",
          marginTop: 10,
          marginBottom: 20,
        }}
      >
        {tWallet("txTitle")}
      </span>

      {/* Filtro por canal: perfil + comunidades (aplica a Todos y Suscriptores). */}
      <WalletChannelFilter
        channels={channels}
        value={channelFilter}
        onChange={setChannelFilter}
      />

      {/* Pestañas: Todos · Retiros · Suscriptores — solo la activa lleva contenedor,
          un pill que se desliza. Las demás flotan (solo texto). */}
      <div
        ref={tabsNavRef}
        style={{
          position: "relative",
          display: "inline-flex",
          gap: 4,
          marginBottom: 14,
          maxWidth: "100%",
        }}
      >
        {pill ? (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              insetInlineStart: pill.left,
              width: pill.width,
              top: 0,
              bottom: 0,
              borderRadius: 999,
              background: "linear-gradient(135deg, #4f46ff, #a855f7)",
              transition:
                "left 0.28s cubic-bezier(0.4,0,0.2,1), width 0.28s cubic-bezier(0.4,0,0.2,1)",
              pointerEvents: "none",
            }}
          />
        ) : null}
        {FILTERS.map((f, i) => {
          const active = filter === f;
          return (
            <button
              key={f}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              onClick={() => selectFilter(f)}
              style={{
                position: "relative",
                zIndex: 1,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                borderRadius: 999,
                padding: "5px 11px",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                whiteSpace: "nowrap",
                color: active ? "#fff" : "rgba(255,255,255,0.6)",
                transition: "color 220ms ease",
              }}
            >
              {filterLabel(f)}
            </button>
          );
        })}
      </div>

      {/* Contenido de la pestaña: se desliza hacia el lado correspondiente al cambiar.
          minHeight reservado para que las pestañas con poco contenido no colapsen. */}
      <div style={{ overflow: "hidden", minHeight: tabMinHeight }}>
        <motion.div
          ref={tabContentRef}
          key={filter}
          initial={{ x: tabDir > 0 ? 42 : tabDir < 0 ? -42 : 0, opacity: 0.25 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 320, damping: 32, mass: 0.9 }}
        >
      {/* Filtros — dentro de "Todos", apilados: mes · experiencia · ingresos. */}
      {filter === "all" ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 2,
            marginBottom: 6,
            minWidth: 0,
          }}
        >
          {/* Mes: se trunca con "…" si no cabe. */}
          <div style={{ maxWidth: "100%", minWidth: 0, overflow: "hidden" }}>
            <WalletFilterMenu
              label={monthSelLabel}
              menuLabel={tWallet("filterMonthMenu")}
              value={monthFilter}
              options={MONTH_OPTIONS}
              onChange={setMonthFilter}
              allValue="all"
              transparent
            />
          </div>
          {/* Experiencia (tipo de servicio). */}
          <div style={{ maxWidth: "100%", minWidth: 0, overflow: "hidden" }}>
            <WalletFilterMenu
              label={typeSelLabel}
              menuLabel={tWallet("filterTypeMenu")}
              value={typeFilter}
              options={TYPE_OPTIONS}
              onChange={setTypeFilter}
              allValue="all"
              transparent
            />
          </div>
          {/* Ingresos (estado). */}
          <div style={{ maxWidth: "100%", minWidth: 0, overflow: "hidden" }}>
            <WalletFilterMenu
              label={statusSelLabel}
              menuLabel={tWallet("filterMovementsMenu")}
              value={statusFilter}
              options={STATUS_OPTIONS}
              onChange={setStatusFilter}
              allValue="all"
              transparent
            />
          </div>
        </div>
      ) : null}

      {/* 💸 Qué le llega si retira hoy, al inicio de la pestaña.

          Es lo único que esta pestaña puede enseñar con verdad mientras no exista el
          historial: antes decía «Aún no tienes movimientos», que además de vacío era
          falso —movimientos tiene, lo que no tiene son RETIROS—.

          El desglose lo pinta el mismo componente que el panel de «Retirar», para que las
          dos pantallas no puedan decirle dos cifras distintas del mismo dinero. */}
      {filter === "withdrawal" && desgloseRetiro ? (
        <div style={{ marginTop: 20 }}>
          <WithdrawBreakdown
            desglose={desgloseRetiro}
            impuestosRecaudados={impuestosRecaudados}
          />
        </div>
      ) : null}

      {/* Gráfica: 1 mes → semanas; varios meses → comparación por mes. */}
      {filter === "all" && chartBuckets.length >= 1 ? (
        <WalletMovementsChart entries={scopedEntries} mode={mode} buckets={chartBuckets} />
      ) : null}

      {/* Resumen del mes filtrado: Ganado · Rechazado · Reembolsado. */}
      {filter === "all" ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 10,
            marginTop: 26,
            marginBottom: 26,
          }}
        >
          {[
            { key: "txStatusRefunded", amount: summary.refunded },
            { key: "txStatusEarned", amount: summary.earned },
            { key: "txStatusRejected", amount: summary.rejected },
          ].map((col) => (
            <div
              key={col.key}
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "rgba(255,255,255,0.6)",
                  letterSpacing: "-0.01em",
                }}
              >
                {tWallet(col.key)}
              </span>
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: "#fff",
                }}
              >
                {formatMoney(col.amount)}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Pestaña Tickets: publicaciones premium + VOD ordenadas por monetización. */}
      {filter === "tickets" ? (
        <WalletTickets uid={uid} mode={mode} />
      ) : filter === "lives" ? (
        <WalletLives uid={uid} mode={mode} />
      ) : filter === "subscription" ? (
        <div style={{ marginTop: 22 }}>
          {subChannelState.mode === "message" ? (
            <div
              style={{
                color: "rgba(255,255,255,0.55)",
                fontSize: 13,
                textAlign: "center",
                padding: "18px 0",
              }}
            >
              {subChannelState.message}
            </div>
          ) : (
            <>
              <WalletSubscriptions
                uid={uid}
                bare
                communityIds={subChannelState.mode === "filtered" ? subChannelState.communityIds : null}
              />
              <WalletActiveSubscribers
                uid={uid}
                communityIds={subChannelState.mode === "filtered" ? subChannelState.communityIds : null}
              />
            </>
          )}
        </div>
      ) : loading ? (
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, padding: "8px 0" }}>
          {tWallet("txLoading")}
        </div>
      ) : visible.length === 0 ? (
        <div
          style={{
            color: "rgba(255,255,255,0.5)",
            fontSize: 13,
            // En Retiros la frase va debajo del desglose y necesita despegarse de él.
            padding: filter === "withdrawal" ? "20px 0 8px" : "8px 0",
          }}
        >
          {/* En Retiros el vacío significa otra cosa. «Aún no tienes movimientos» era
              falso ahí —movimientos tiene, y muchos—: lo que no ha hecho es un retiro. */}
          {tWallet(filter === "withdrawal" ? "withdrawHistoryEmpty" : "txEmpty")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {visible.map((entry, index) => {
            const amount = mode === "gross" ? entry.grossAmount : entry.netAmount;
            const negative = entry.status === "refunded" || entry.status === "rejected";
            return (
              <div
                key={entry.id}
                ref={index === triggerIndex ? sentinelRef : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "11px 0",
                  borderTop: index === 0 ? "none" : "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                  <span
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: "#fff",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {tWallet(ledgerTypeLabelKey(entry.type))}
                  </span>
                  <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.45)" }}>
                    {formatDate(entry.createdAt, locale)}
                  </span>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 3,
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                      color: negative ? "rgba(255,255,255,0.4)" : "#fff",
                      textDecoration: negative ? "line-through" : "none",
                    }}
                  >
                    {formatMoney(amount)}
                  </span>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 600,
                      color: ledgerStatusColor(entry.status),
                    }}
                  >
                    {tWallet(ledgerStatusLabelKey(entry.status))}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
        </motion.div>
      </div>
    </WalletCard>
  );
}
