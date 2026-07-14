"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { collection, doc, getCountFromServer, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { useWalletLedger, ledgerTypeLabelKey } from "@/lib/wallet/walletLedger";
import type { Post } from "@/lib/posts/types";
import LiveCreatorPanel from "@/app/components/LiveChat/LiveCreatorPanel";
import { WalletFilterMenu } from "./WalletUi";

// Ventana amplia del ledger para agregar por live (mismo criterio que Suscriptores).
const LEDGER_WINDOW = 1000;
const PAGE = 10;

// Tipos de ganancia atribuibles a un live (para el filtro por servicio).
type LiveServiceType = "live_ticket" | "vod_ticket" | "supercomment" | "live_donation";
const LIVE_SERVICE_ORDER: Array<{ value: LiveServiceType; emoji: string }> = [
  { value: "live_ticket", emoji: "🎟️" },
  { value: "vod_ticket", emoji: "🎬" },
  { value: "supercomment", emoji: "💬" },
  { value: "live_donation", emoji: "🎁" },
];

type SortKey = "money" | "duration" | "views";

type LiveRow = {
  liveId: string;
  post: Post;
  title: string;
  date: Date | null;
  amount: number;
  /** Portada del live; si el creador no puso, cae en /live.png. */
  cover: string;
  /** Duración en minutos (endedAt − startedAt); null si no se puede calcular. */
  durationMin: number | null;
  /** Visualizaciones totales (espectadores únicos del live). */
  views: number;
};

// "22 min", "1 h", "1 h 5 min".
function fmtDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function tsToDate(v: unknown): Date | null {
  if (v && typeof (v as { toDate?: unknown }).toDate === "function") {
    try {
      return (v as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  return null;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// "2026-07" → "Julio 2026".
function monthLabelOf(ym: string, locale: string): string {
  const [y, m] = ym.split("-").map(Number);
  try {
    const s = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
      new Date(y, m - 1, 1)
    );
    return s.charAt(0).toUpperCase() + s.slice(1);
  } catch {
    return ym;
  }
}

// Fecha real del live: cuándo se transmitió (no la programada).
function liveDate(post: Post): Date | null {
  const ld = post.liveData;
  return tsToDate(ld?.startedAt) ?? tsToDate(ld?.endedAt) ?? tsToDate(post.createdAt);
}

export default function WalletLives({
  uid,
  mode,
}: {
  uid: string | null | undefined;
  mode: "net" | "gross";
}) {
  const tWallet = useTranslations("wallet");
  const locale = useLocale();
  const { format: formatMoney } = usePriceFormat();
  const { entries, loading } = useWalletLedger(uid, LEDGER_WINDOW);

  const [posts, setPosts] = useState<Map<string, Post | null>>(new Map());
  const [views, setViews] = useState<Map<string, number>>(new Map());
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const [openPost, setOpenPost] = useState<Post | null>(null);

  // Filtros (estilo pestaña "Todos").
  const [monthFilter, setMonthFilter] = useState<string[]>(["all"]);
  const [sortBy, setSortBy] = useState<SortKey>("money");
  const [serviceFilter, setServiceFilter] = useState<Array<"all" | LiveServiceType>>(["all"]);

  const resetPaging = () => setVisibleCount(PAGE);

  // Todos los lives monetizados (sin filtrar): para traer posts/vistas y armar
  // las opciones de mes (estables aunque cambie el filtro de servicio).
  const allLiveIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) {
      if (e.liveId && e.status === "earned") s.add(e.liveId);
    }
    return Array.from(s);
  }, [entries]);

  // Suma monetizada por live, acotada por el filtro de servicio.
  const totals = useMemo(() => {
    const allow = serviceFilter.includes("all") ? null : new Set<string>(serviceFilter);
    const m = new Map<string, number>();
    for (const e of entries) {
      if (!e.liveId || e.status !== "earned") continue;
      if (allow && !allow.has(e.type)) continue;
      const amt = mode === "gross" ? e.grossAmount : e.netAmount;
      m.set(e.liveId, (m.get(e.liveId) ?? 0) + amt);
    }
    return m;
  }, [entries, mode, serviceFilter]);

  // Trae los posts y las vistas de todos los lives monetizados (una vez por id).
  useEffect(() => {
    let active = true;
    const missing = allLiveIds.filter((id) => !posts.has(id));
    if (missing.length === 0) return;
    Promise.all(
      missing.map(async (id) => {
        try {
          const [postSnap, countSnap] = await Promise.all([
            getDoc(doc(db, "posts", id)),
            getCountFromServer(collection(db, "posts", id, "liveUniqueViewers")),
          ]);
          const post = postSnap.exists() ? ({ id: postSnap.id, ...postSnap.data() } as Post) : null;
          return [id, post, countSnap.data().count] as const;
        } catch {
          return [id, null, 0] as const;
        }
      })
    ).then((triples) => {
      if (!active) return;
      setPosts((prev) => {
        const next = new Map(prev);
        for (const [id, p] of triples) next.set(id, p);
        return next;
      });
      setViews((prev) => {
        const next = new Map(prev);
        for (const [id, , v] of triples) next.set(id, v);
        return next;
      });
    });
    return () => {
      active = false;
    };
  }, [allLiveIds, posts]);

  const rows = useMemo<LiveRow[]>(() => {
    const allowMonths = monthFilter.includes("all") ? null : new Set(monthFilter);
    const list: LiveRow[] = [];
    for (const [liveId, amount] of totals) {
      const post = posts.get(liveId);
      if (!post || post.liveData == null) continue;
      const ld = post.liveData;
      const date = liveDate(post);
      if (allowMonths && (!date || !allowMonths.has(monthKey(date)))) continue;
      const title =
        (ld.title && ld.title.trim()) ||
        (post.text && post.text.trim()) ||
        tWallet("livesUntitled");
      const started = tsToDate(ld.startedAt);
      const ended = tsToDate(ld.endedAt);
      const durationMin =
        started && ended
          ? Math.max(0, Math.round((ended.getTime() - started.getTime()) / 60000))
          : null;
      const cover = (ld.coverUrl && ld.coverUrl.trim()) || "/live.png";
      list.push({
        liveId,
        post,
        title,
        date,
        amount,
        cover,
        durationMin,
        views: views.get(liveId) ?? 0,
      });
    }
    list.sort((a, b) => {
      if (sortBy === "duration") return (b.durationMin ?? -1) - (a.durationMin ?? -1);
      if (sortBy === "views") return b.views - a.views;
      return b.amount - a.amount;
    });
    return list;
  }, [totals, posts, views, monthFilter, sortBy, tWallet]);

  const totalMoney = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);
  const totalViews = useMemo(() => rows.reduce((s, r) => s + r.views, 0), [rows]);

  // Opciones de mes: de todos los lives monetizados (no dependen del filtro).
  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const id of allLiveIds) {
      const post = posts.get(id);
      if (!post) continue;
      const d = liveDate(post);
      if (d) set.add(monthKey(d));
    }
    const months = [...set].sort().reverse();
    return [
      { value: "all", label: tWallet("filterMonthAllValue"), emoji: "📅" },
      ...months.map((ym) => ({ value: ym, label: monthLabelOf(ym, locale) })),
    ];
  }, [allLiveIds, posts, locale, tWallet]);

  const postsResolved = allLiveIds.every((id) => posts.has(id));
  const isLoading = loading || (allLiveIds.length > 0 && !postsResolved);

  const fmtDate = (d: Date | null): string => {
    if (!d) return "";
    try {
      const s = new Intl.DateTimeFormat(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(d);
      return s.charAt(0).toUpperCase() + s.slice(1);
    } catch {
      return "";
    }
  };

  const visible = rows.slice(0, visibleCount);
  const hasMore = visibleCount < rows.length;

  if (isLoading) {
    return (
      <div style={{ marginTop: 22, display: "flex", justifyContent: "center", padding: "24px 0" }}>
        <div className="vibraPullRefreshSpinner refreshing" style={{ width: 30, height: 30 }} />
      </div>
    );
  }

  // Sin ningún live monetizado: mensaje simple, sin filtros.
  if (allLiveIds.length === 0) {
    return (
      <div
        style={{
          marginTop: 22,
          color: "rgba(255,255,255,0.5)",
          fontSize: 13,
          textAlign: "center",
          padding: "18px 0",
        }}
      >
        {tWallet("livesEmpty")}
      </div>
    );
  }

  // Etiquetas y opciones de los filtros.
  const monthSelLabel = monthFilter.includes("all")
    ? tWallet("filterMonthAllValue")
    : monthFilter.map((ym) => monthLabelOf(ym, locale)).join(", ");

  const sortLabelKey: Record<SortKey, string> = {
    money: "livesSortMoney",
    duration: "livesSortDuration",
    views: "livesSortViews",
  };
  const sortOptions: Array<{ value: SortKey; label: string; emoji?: string }> = [
    { value: "money", label: tWallet("livesSortMoney"), emoji: "💰" },
    { value: "duration", label: tWallet("livesSortDuration"), emoji: "⏱️" },
    { value: "views", label: tWallet("livesSortViews"), emoji: "📊" },
  ];

  const serviceSelLabel = serviceFilter.includes("all")
    ? tWallet("livesServiceAll")
    : serviceFilter
        .filter((t): t is LiveServiceType => t !== "all")
        .map((t) => tWallet(ledgerTypeLabelKey(t)))
        .join(", ");
  const serviceOptions: Array<{ value: "all" | LiveServiceType; label: string; emoji?: string }> = [
    { value: "all", label: tWallet("livesServiceAll"), emoji: "🎬" },
    ...LIVE_SERVICE_ORDER.map((s) => ({
      value: s.value,
      label: tWallet(ledgerTypeLabelKey(s.value)),
      emoji: s.emoji,
    })),
  ];

  const headerStyle: CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 16,
    marginBottom: 20,
  };
  const statColStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 3,
  };
  const statLabelStyle: CSSProperties = {
    fontSize: 12,
    fontWeight: 500,
    color: "rgba(255,255,255,0.6)",
    letterSpacing: "-0.01em",
  };
  const statValueStyle: CSSProperties = {
    fontSize: 17,
    fontWeight: 640,
    letterSpacing: "-0.02em",
    lineHeight: 1.1,
  };
  const filterWrapStyle: CSSProperties = { maxWidth: "100%", minWidth: 0, overflow: "hidden" };
  const emptyStyle: CSSProperties = {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    textAlign: "center",
    padding: "18px 0",
  };

  return (
    <div style={{ marginTop: 6 }}>
      {/* Filtros — apilados, estilo pestaña "Todos": mes · ordenar por · servicio. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 2,
          minWidth: 0,
        }}
      >
        <div style={filterWrapStyle}>
          <WalletFilterMenu
            label={monthSelLabel}
            menuLabel={tWallet("filterMonthMenu")}
            value={monthFilter}
            options={monthOptions}
            onChange={(v) => {
              setMonthFilter(v);
              resetPaging();
            }}
            allValue="all"
            transparent
          />
        </div>
        <div style={filterWrapStyle}>
          <WalletFilterMenu
            label={tWallet(sortLabelKey[sortBy])}
            menuLabel={tWallet("livesSortMenu")}
            value={[sortBy]}
            options={sortOptions}
            onChange={(v) => {
              setSortBy((v[0] as SortKey) ?? "money");
              resetPaging();
            }}
            allValue="money"
            transparent
            singleSelect
          />
        </div>
        <div style={filterWrapStyle}>
          <WalletFilterMenu
            label={serviceSelLabel}
            menuLabel={tWallet("livesServiceMenu")}
            value={serviceFilter}
            options={serviceOptions}
            onChange={(v) => {
              setServiceFilter(v);
              resetPaging();
            }}
            allValue="all"
            transparent
          />
        </div>
      </div>

      {/* Encabezado: tres estadísticas centradas, estilo card de finanzas. */}
      <div style={headerStyle}>
        <div style={statColStyle}>
          <span style={statLabelStyle}>{tWallet("livesGeneratedLabel")}</span>
          <span style={{ ...statValueStyle, color: "#4ade80" }}>
            {formatMoney(totalMoney, { code: true })}
          </span>
        </div>
        <div style={statColStyle}>
          <span style={statLabelStyle}>{tWallet("livesBroadcastLabel")}</span>
          <span style={{ ...statValueStyle, color: "rgba(255,255,255,0.9)" }}>
            {tWallet("livesTimesCount", { count: rows.length })}
          </span>
        </div>
        <div style={statColStyle}>
          <span style={statLabelStyle}>{tWallet("livesViewsLabel")}</span>
          <span style={{ ...statValueStyle, color: "rgba(255,255,255,0.9)" }}>
            {totalViews.toLocaleString(locale)}
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div style={emptyStyle}>{tWallet("livesFilteredEmpty")}</div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {visible.map((row) => (
              <motion.button
                key={row.liveId}
                type="button"
                onClick={() => setOpenPost(row.post)}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "16px 14px",
                  borderRadius: 14,
                  border: "none",
                  overflow: "hidden",
                  // Portada del live de fondo (o /live.png) con degradado para legibilidad.
                  background: `linear-gradient(90deg, rgba(0,0,0,0.90), rgba(0,0,0,0.66)), center / cover no-repeat url("${row.cover}")`,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                  <span
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: "#fff",
                      letterSpacing: "-0.01em",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      textShadow: "0 1px 3px rgba(0,0,0,0.75)",
                    }}
                  >
                    {row.title}
                  </span>
                  <span
                    style={{
                      fontSize: 11.5,
                      color: "rgba(255,255,255,0.72)",
                      textShadow: "0 1px 3px rgba(0,0,0,0.75)",
                    }}
                  >
                    {fmtDate(row.date)}
                  </span>
                </div>
                <div
                  style={{
                    flexShrink: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 2,
                  }}
                >
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                      color: "#4ade80",
                      textShadow: "0 1px 3px rgba(0,0,0,0.75)",
                    }}
                  >
                    {formatMoney(row.amount)}
                  </span>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      fontSize: 14,
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                      color: "#fff",
                      textShadow: "0 1px 3px rgba(0,0,0,0.75)",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#fff"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.75))", flexShrink: 0 }}
                      >
                        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      {row.views.toLocaleString(locale)}
                    </span>
                    {row.durationMin != null ? (
                      <>
                        <span style={{ fontWeight: 400, opacity: 0.5 }}>│</span>
                        <span>{fmtDuration(row.durationMin)}</span>
                      </>
                    ) : null}
                  </div>
                </div>
              </motion.button>
            ))}
          </div>

          {hasMore ? (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + PAGE)}
                style={{
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.04)",
                  color: "#fff",
                  borderRadius: 999,
                  padding: "8px 18px",
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {tWallet("livesSeeMore")}
              </button>
            </div>
          ) : null}
        </>
      )}

      {openPost ? (
        <LiveCreatorPanel open onClose={() => setOpenPost(null)} post={openPost} portrait={false} />
      ) : null}
    </div>
  );
}
