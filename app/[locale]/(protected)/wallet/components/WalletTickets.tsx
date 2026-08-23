"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Link } from "@/i18n/navigation";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { useWalletLedger } from "@/lib/wallet/walletLedger";
import { useWalletPosts } from "@/lib/wallet/walletPostCache";
import type { Post } from "@/lib/posts/types";
import { WalletFilterMenu } from "./WalletUi";
import WalletFigureSkeleton from "./WalletFigureSkeleton";
import { WalletCardsSkeleton } from "./WalletListSkeleton";

const LEDGER_WINDOW = 1000;
const PAGE = 10;

type TicketType = "premium_post" | "vod_ticket";
type SortKey = "money" | "tickets";

type TicketRow = {
  postId: string;
  post: Post;
  title: string;
  date: Date | null;
  /** Miniatura/portada de la publicación; null → gradiente por defecto. */
  cover: string | null;
  amount: number;
  /** Tickets vendidos (número de compras). */
  count: number;
  isVod: boolean;
};

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

function firstStr(...vals: Array<string | null | undefined>): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

function ticketCover(post: Post): string | null {
  return firstStr(
    post.liveData?.coverUrl,
    post.playback?.thumbnailUrl,
    post.media?.[0]?.thumbnailUrl,
    post.videoData?.thumbnailUrl
  );
}

function ticketDate(post: Post): Date | null {
  return tsToDate(post.liveData?.startedAt) ?? tsToDate(post.createdAt);
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

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

export default function WalletTickets({
  uid,
  mode,
}: {
  uid: string | null | undefined;
  mode: "net" | "gross";
}) {
  const tWallet = useTranslations("wallet");
  const locale = useLocale();
  const pf = usePriceFormat();
  /**
   * Dinero del CREADOR: en la moneda de liquidación, SIN convertir.
   *
   * ⚠️ `pf.format` es el precio del COMPRADOR —convierte, suma el 2% y redondea al
   * escalón—, así que inflaba el saldo del creador: sobre 500 USD, 170 pesos de más.
   */
  const formatMoney = (amount: number, opts: { code?: boolean } = {}) =>
    pf.formatAnchor(amount, { code: opts.code ?? false });
  const { entries, loading } = useWalletLedger(uid, LEDGER_WINDOW);

  const [visibleCount, setVisibleCount] = useState(PAGE);

  const [monthFilter, setMonthFilter] = useState<string[]>(["all"]);
  const [sortBy, setSortBy] = useState<SortKey>("money");
  const [typeFilter, setTypeFilter] = useState<Array<"all" | TicketType>>(["all"]);

  const resetPaging = () => setVisibleCount(PAGE);

  // Todas las publicaciones con ventas por ticket (sin filtrar): para traer los
  // posts y armar las opciones de mes (estables aunque cambie el filtro de tipo).
  const allPostIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) {
      if (!e.postId || e.status !== "earned") continue;
      if (e.type !== "premium_post" && e.type !== "vod_ticket") continue;
      s.add(e.postId);
    }
    return Array.from(s);
  }, [entries]);

  const { posts } = useWalletPosts(allPostIds);

  // Suma + tickets vendidos por publicación, acotado por el filtro de tipo.
  const totals = useMemo(() => {
    const allow = typeFilter.includes("all") ? null : new Set<string>(typeFilter);
    const m = new Map<string, { amount: number; count: number }>();
    for (const e of entries) {
      if (!e.postId || e.status !== "earned") continue;
      if (e.type !== "premium_post" && e.type !== "vod_ticket") continue;
      if (allow && !allow.has(e.type)) continue;
      const amt = mode === "gross" ? e.grossAmount : e.netAmount;
      const cur = m.get(e.postId) ?? { amount: 0, count: 0 };
      cur.amount += amt;
      cur.count += 1;
      m.set(e.postId, cur);
    }
    return m;
  }, [entries, mode, typeFilter]);

  const rows = useMemo<TicketRow[]>(() => {
    const allowMonths = monthFilter.includes("all") ? null : new Set(monthFilter);
    const list: TicketRow[] = [];
    for (const [postId, { amount, count }] of totals) {
      const post = posts.get(postId);
      if (!post) continue;
      const date = ticketDate(post);
      if (allowMonths && (!date || !allowMonths.has(monthKey(date)))) continue;
      const isVod = post.liveData != null;
      const title =
        firstStr(post.liveData?.title, post.text) ||
        (isVod ? tWallet("ticketsUntitledVod") : tWallet("ticketsUntitledPremium"));
      list.push({ postId, post, title, date, cover: ticketCover(post), amount, count, isVod });
    }
    list.sort((a, b) => (sortBy === "tickets" ? b.count - a.count : b.amount - a.amount));
    return list;
  }, [totals, posts, monthFilter, sortBy, tWallet]);

  const totalMoney = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);
  const totalTickets = useMemo(() => rows.reduce((s, r) => s + r.count, 0), [rows]);

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const id of allPostIds) {
      const post = posts.get(id);
      if (!post) continue;
      const d = ticketDate(post);
      if (d) set.add(monthKey(d));
    }
    const months = [...set].sort().reverse();
    return [
      { value: "all", label: tWallet("filterMonthAllValue"), emoji: "📅" },
      ...months.map((ym) => ({ value: ym, label: monthLabelOf(ym, locale) })),
    ];
  }, [allPostIds, posts, locale, tWallet]);

  const postsResolved = allPostIds.every((id) => posts.has(id));
  const isLoading = loading || (allPostIds.length > 0 && !postsResolved);

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

  // Sin publicaciones con ticket (ya cargado): mensaje simple, sin filtros.
  // Mientras carga sí mostramos filtros + skeletons (abajo).
  if (!isLoading && allPostIds.length === 0) {
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
        {tWallet("ticketsEmpty")}
      </div>
    );
  }

  const monthSelLabel = monthFilter.includes("all")
    ? tWallet("filterMonthAllValue")
    : monthFilter.map((ym) => monthLabelOf(ym, locale)).join(", ");

  const sortLabelKey: Record<SortKey, string> = {
    money: "ticketsSortMoney",
    tickets: "ticketsSortCount",
  };
  const sortOptions: Array<{ value: SortKey; label: string; emoji?: string }> = [
    { value: "money", label: tWallet("ticketsSortMoney"), emoji: "💰" },
    { value: "tickets", label: tWallet("ticketsSortCount"), emoji: "🎟️" },
  ];

  const typeLabel = (t: TicketType) =>
    t === "vod_ticket" ? tWallet("ticketsTypeVod") : tWallet("ticketsTypePremium");
  const typeSelLabel = typeFilter.includes("all")
    ? tWallet("ticketsTypeAll")
    : typeFilter.filter((t): t is TicketType => t !== "all").map(typeLabel).join(", ");
  const typeOptions: Array<{ value: "all" | TicketType; label: string; emoji?: string }> = [
    { value: "all", label: tWallet("ticketsTypeAll"), emoji: "🎫" },
    { value: "vod_ticket", label: tWallet("ticketsTypeVod"), emoji: "🎬" },
    { value: "premium_post", label: tWallet("ticketsTypePremium"), emoji: "🔒" },
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
      {/* Filtros — apilados, estilo pestaña "Todos": mes · ordenar por · tipo. */}
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
            menuLabel={tWallet("ticketsSortMenu")}
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
            label={typeSelLabel}
            menuLabel={tWallet("ticketsTypeMenu")}
            value={typeFilter}
            options={typeOptions}
            onChange={(v) => {
              setTypeFilter(v);
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
          <span style={statLabelStyle}>{tWallet("ticketsGeneratedLabel")}</span>
          <span style={{ ...statValueStyle, color: "#4ade80" }}>
            {isLoading ? (
              <WalletFigureSkeleton width={72} height={16} />
            ) : (
              formatMoney(totalMoney, { code: true })
            )}
          </span>
        </div>
        <div style={statColStyle}>
          <span style={statLabelStyle}>{tWallet("ticketsPostsLabel")}</span>
          <span style={{ ...statValueStyle, color: "rgba(255,255,255,0.9)" }}>
            {isLoading ? (
              <WalletFigureSkeleton width={50} height={16} />
            ) : (
              rows.length.toLocaleString(locale)
            )}
          </span>
        </div>
        <div style={statColStyle}>
          <span style={statLabelStyle}>{tWallet("ticketsSoldLabel")}</span>
          <span style={{ ...statValueStyle, color: "rgba(255,255,255,0.9)" }}>
            {isLoading ? (
              <WalletFigureSkeleton width={50} height={16} />
            ) : (
              totalTickets.toLocaleString(locale)
            )}
          </span>
        </div>
      </div>

      {isLoading ? (
        <WalletCardsSkeleton count={4} />
      ) : rows.length === 0 ? (
        <div style={emptyStyle}>{tWallet("livesFilteredEmpty")}</div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {visible.map((row) => (
              <Link
                key={row.postId}
                href={`/post/${row.postId}`}
                style={{ textDecoration: "none", color: "inherit", display: "block" }}
              >
              <motion.div
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
                  overflow: "hidden",
                  cursor: "pointer",
                  background: row.cover
                    ? `linear-gradient(90deg, rgba(0,0,0,0.90), rgba(0,0,0,0.66)), center / cover no-repeat url("${row.cover}")`
                    : "linear-gradient(120deg, #2a1a4a, #10101a)",
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
                    {row.isVod ? tWallet("ticketsTypeVod") : tWallet("ticketsTypePremium")} · {fmtDate(row.date)}
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
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                      color: "#fff",
                      textShadow: "0 1px 3px rgba(0,0,0,0.75)",
                    }}
                  >
                    {tWallet("ticketsSoldCount", { count: row.count })}
                  </span>
                </div>
              </motion.div>
              </Link>
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
    </div>
  );
}
