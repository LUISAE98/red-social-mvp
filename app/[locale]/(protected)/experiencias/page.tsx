"use client";

// Página "Mis experiencias" (lado COMPRADOR). Se llega desde la estrella junto a
// notificaciones. Subnav de 3 pestañas (Pendientes / Rechazados / Entregados) con
// los íconos reloj / tache / paloma. Reusa OwnerSidebarGreetings (con activeSection)
// alimentado por el hook autocontenido useMyExperiences. Ver docs de experiencias.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";
import OwnerSidebarGreetings from "@/app/components/OwnerSidebar/OwnerSidebarGreetings";
import { buildDisplayName, fmtDate } from "@/app/components/OwnerSidebar/OwnerSidebar.utils";
import { getSectionForMeetGreetStatus, isRefundStatus } from "@/app/components/OwnerSidebar/OwnerSidebarGreetings.parts";
import { WalletFilterMenu } from "@/app/(protected)/wallet/components/WalletUi";
import PurchasesTodoList from "./PurchasesTodoList";
import { useAllPurchases } from "@/lib/experiences/useAllPurchases";
import { useBuyerExperiencesSeen } from "@/lib/experiences/useBuyerExperiencesSeen";
import { useBuyerExperienceActivity } from "@/lib/experiences/useBuyerExperienceActivity";
import { computeCategoryLatest, isCategoryNew } from "@/lib/experiences/experienceActivity";
import { useMyExperiences } from "@/lib/experiences/useMyExperiences";
import { useBuyerCredit } from "@/lib/wallet/useBuyerCredit";
import { useBuyerCashout } from "@/lib/wallet/useBuyerCashout";
import { requestCashout } from "@/lib/wallet/cashout";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";

type Tab = "requested" | "rejected" | "delivered";

const TAB_ORDER: Tab[] = ["requested", "rejected", "delivered"];

// Segundo subnav dentro de Entregados: "Experiencias" | "Todo" ("Todo" vacío por ahora).
type DeliveredSub = "experiencias" | "todo";
const DELIVERED_SUB_ORDER: DeliveredSub[] = ["experiencias", "todo"];

// Valores del filtro por tipo de experiencia (Pendientes y Rechazados).
type ExpTypeFilter = "all" | "exclusive_session" | "saludo" | "consejo" | "meet_greet";
// Valores del filtro combinado de Rechazados: tipo de experiencia + estatus
// (en devolución / rechazado) en un solo menú.
type RejFilter = "all" | "exclusive_session" | "saludo" | "consejo" | "meet_greet" | "refund" | "rejected";

// Íconos del subnav = los mismos "chips" que eran el título interno de cada
// sección (círculo de color + ícono blanco): reloj/morado, tache/rojo, paloma/verde.
function IconChip({ bg, children }: { bg: string; children: ReactNode }) {
  return (
    <span
      style={{
        width: 26,
        height: 26,
        borderRadius: "50%",
        background: bg,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
}

const CLOCK_ICON = (
  <IconChip bg="#7c3aed">
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.2" /><path d="M12 7.5V12.5" /><path d="M12 12.5L15.2 14.3" />
    </svg>
  </IconChip>
);
const X_ICON = (
  <IconChip bg="#ef4444">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
      <path d="M8 8L16 16" /><path d="M16 8L8 16" />
    </svg>
  </IconChip>
);
const CHECK_ICON = (
  <IconChip bg="#22c55e">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12L10 17L19 8" />
    </svg>
  </IconChip>
);

// Subset de `styles` que consume OwnerSidebarGreetings (replicado del sidebar, sin
// dependencia de isMobile). El data-layer es autocontenido (useMyExperiences).
const fontStack = "inherit";
const styles: Record<string, CSSProperties> = {
  input: { padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.04)", color: "#fff", outline: "none", fontSize: 12, fontFamily: fontStack, boxSizing: "border-box", height: 42 },
  buttonSecondary: { padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.05)", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 13, fontFamily: fontStack, lineHeight: 1.1 },
  buttonPrimary: { padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "#fff", color: "#000", fontSize: 13, fontWeight: 700, lineHeight: 1.1, cursor: "pointer", fontFamily: fontStack },
  message: { padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", color: "#fff", fontSize: 12, lineHeight: 1.35 },
  sectionTitle: { fontSize: 11, fontWeight: 550, color: "rgba(254,254,254,0.22)", textTransform: "none", letterSpacing: 0.65 },
  sectionHeaderRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "4px 2px 2px" },
  createInlineButton: { minHeight: 24, padding: "0 9px", borderRadius: 9, border: "2.5px solid rgba(168,85,247,0.75)", background: "transparent", color: "rgba(168,85,247,0.92)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 11, fontWeight: 700, fontFamily: fontStack, lineHeight: 1, cursor: "pointer", opacity: 0.85 },
  card: { padding: "10px 12px", borderRadius: 12, background: "#000", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 18px 44px rgba(0,0,0,0.34)" },
  subtle: { fontSize: 11, color: "rgba(255,255,255,0.56)", lineHeight: 1.3 },
  sectionPanel: { padding: "10px", borderRadius: 12, border: "none", background: "rgba(90,41,174,0.14)", boxShadow: "none", display: "grid", gap: 8 },
  miniItem: { borderRadius: 12, border: "none", background: "transparent", boxShadow: "none", padding: 9, display: "grid", gap: 7, width: "100%", boxSizing: "border-box", minWidth: 0 },
};

export default function ExperienciasPage() {
  const tCommon = useTranslations("common");
  const tNav = useTranslations("nav");
  const locale = useLocale();
  const tWallet = useTranslations("wallet");
  const tServices = useTranslations("services");
  const tSessions = useTranslations("sessions");
  const router = useRouter();
  const { user } = useAuth();
  const exp = useMyExperiences(user?.uid);
  const credit = useBuyerCredit(user?.uid); // Saldo a favor (crédito por devoluciones)
  const cashout = useBuyerCashout(user?.uid); // Solicitud de efectivo pendiente (B7)
  const [cashoutBusy, setCashoutBusy] = useState(false);
  const [cashoutError, setCashoutError] = useState<string | null>(null);
  const pf = usePriceFormat();
  const [tab, setTab] = useState<Tab>("requested");

  // El comprador pide TODO su saldo a favor en efectivo (reembolso a la tarjeta original).
  // Modelo B: todo el saldo restante es reembolsable. El superadmin lo revisa en "Devoluciones".
  async function handleRequestCashout() {
    if (cashoutBusy) return;
    const ok = window.confirm(
      `¿Solicitar ${pf.format(credit.balance, { baseCurrency: "MXN", code: true })} de reembolso a tu tarjeta original? Un administrador lo revisará. Mientras tanto, ese saldo queda apartado.`
    );
    if (!ok) return;
    setCashoutBusy(true);
    setCashoutError(null);
    try {
      await requestCashout();
    } catch (e: unknown) {
      setCashoutError(e instanceof Error ? e.message : "No se pudo solicitar el efectivo.");
    } finally {
      setCashoutBusy(false);
    }
  }

  const navRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const contentRef = useRef<HTMLDivElement | null>(null);
  const interactedRef = useRef(false);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  const [slideDir, setSlideDir] = useState<"left" | "right">("right");

  // Deslizamiento del contenido al cambiar de pestaña (mismo efecto que el subnav
  // de wallet): reutiliza las keyframes globales `[data-nav-enter]` y quita el
  // atributo en `animationend` para no dejar un transform residual.
  useEffect(() => {
    const el = contentRef.current;
    if (!el || !interactedRef.current) return;
    el.removeAttribute("data-nav-enter");
    void el.offsetWidth; // reflow: reinicia la animación en cambios rápidos
    el.setAttribute("data-nav-enter", slideDir);
    const onEnd = () => el.removeAttribute("data-nav-enter");
    el.addEventListener("animationend", onEnd, { once: true });
    return () => el.removeEventListener("animationend", onEnd);
  }, [tab, slideDir]);

  function goTab(next: Tab) {
    if (next === tab) return;
    interactedRef.current = true;
    setSlideDir(TAB_ORDER.indexOf(next) > TAB_ORDER.indexOf(tab) ? "right" : "left");
    setTab(next);
    markExpSeen(next, catLatest[next]); // ver una pestaña apaga su badge
    setFrozenIsNew((prev) => (prev ? { ...prev, [next]: false } : prev));
  }

  // ── Segundo subnav (dentro de Entregados): misma animación que el principal. ──
  const [deliveredSub, setDeliveredSub] = useState<DeliveredSub>("experiencias");
  const subNavRef = useRef<HTMLDivElement | null>(null);
  const subTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const subContentRef = useRef<HTMLDivElement | null>(null);
  const subInteractedRef = useRef(false);
  const [subIndicator, setSubIndicator] = useState<{ left: number; width: number } | null>(null);
  const [subSlideDir, setSubSlideDir] = useState<"left" | "right">("right");

  // Barra indicadora del segundo subnav (solo mide cuando Entregados está activo).
  useEffect(() => {
    if (tab !== "delivered") return;
    function measure() {
      const i = DELIVERED_SUB_ORDER.indexOf(deliveredSub);
      const el = subTabRefs.current[i];
      const nav = subNavRef.current;
      if (!el || !nav) return;
      const r = el.getBoundingClientRect();
      const nr = nav.getBoundingClientRect();
      const w = Math.min(80, r.width - 16);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSubIndicator({ left: r.left - nr.left + (r.width - w) / 2, width: w });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [tab, deliveredSub]);

  // Deslizamiento del contenido del segundo subnav al cambiar entre Experiencias/Todo.
  useEffect(() => {
    const el = subContentRef.current;
    if (!el || !subInteractedRef.current) return;
    el.removeAttribute("data-nav-enter");
    void el.offsetWidth;
    el.setAttribute("data-nav-enter", subSlideDir);
    const onEnd = () => el.removeAttribute("data-nav-enter");
    el.addEventListener("animationend", onEnd, { once: true });
    return () => el.removeEventListener("animationend", onEnd);
  }, [deliveredSub, subSlideDir]);

  function goDeliveredSub(next: DeliveredSub) {
    if (next === deliveredSub) return;
    subInteractedRef.current = true;
    setSubSlideDir(DELIVERED_SUB_ORDER.indexOf(next) > DELIVERED_SUB_ORDER.indexOf(deliveredSub) ? "right" : "left");
    setDeliveredSub(next);
  }

  function renderUserLink(uid: string): ReactNode {
    const u = exp.userMiniMap[uid];
    const label = u?.displayName ?? buildDisplayName(null, uid, tCommon("user"));
    const href = u?.handle ? `/u/${u.handle}` : null;
    if (!href) {
      return <span style={{ color: "#fff", fontWeight: 600, fontSize: 12, lineHeight: 1.2 }}>{label}</span>;
    }
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); router.push(href); }}
        style={{ background: "transparent", border: "none", padding: 0, margin: 0, color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 12, lineHeight: 1.2 }}
      >
        {label}
      </button>
    );
  }

  const typeLabel = (type: string) => {
    if (type === "saludo") return tWallet("typeLabelGreeting");
    if (type === "consejo") return tWallet("typeLabelAdvice");
    if (type === "meet_greet_digital") return tSessions("meetGreetTitle");
    if (type === "exclusive_session" || type === "clase_personalizada" || type === "digital_exclusive_session") return tServices("exclusiveSession");
    return type;
  };

  const tabs: Array<{ key: Tab; label: string; icon: ReactNode; color: string }> = [
    { key: "requested", label: tWallet("sectionPending"), icon: CLOCK_ICON, color: "#a855f7" },
    { key: "rejected", label: tWallet("sectionRejected"), icon: X_ICON, color: "#ef4444" },
    { key: "delivered", label: tCommon("delivered"), icon: CHECK_ICON, color: "#22c55e" },
  ];

  // ── Filtros (mismo componente/estilo que el feed de Movimientos: WalletFilterMenu) ──
  // Pendientes: por tipo. Rechazados: por tipo + por estatus (devolución / rechazado).
  const [typeFilter, setTypeFilter] = useState<ExpTypeFilter[]>(["all"]);
  // Rechazados: un solo filtro que combina tipo de experiencia y estatus.
  const [rejFilter, setRejFilter] = useState<RejFilter[]>(["all"]);
  // Entregados · sub "Experiencias": por tipo (los 4).
  const [delExpFilter, setDelExpFilter] = useState<ExpTypeFilter[]>(["all"]);

  const typeOptions: Array<{ value: ExpTypeFilter; label: string }> = [
    { value: "all", label: tWallet("filterTypeAllValue") },
    { value: "exclusive_session", label: tServices("exclusiveSession") },
    { value: "saludo", label: tWallet("typeLabelGreeting") },
    { value: "consejo", label: tWallet("typeLabelAdvice") },
    { value: "meet_greet", label: tSessions("meetGreetTitle") },
  ];
  const rejOptions: Array<{ value: RejFilter; label: string }> = [
    { value: "all", label: tWallet("filterTypeAllValue") },
    { value: "exclusive_session", label: tServices("exclusiveSession") },
    { value: "saludo", label: tWallet("typeLabelGreeting") },
    { value: "consejo", label: tWallet("typeLabelAdvice") },
    { value: "meet_greet", label: tSessions("meetGreetTitle") },
    { value: "refund", label: tServices("refundGroup") },
    { value: "rejected", label: tServices("rejectedGroup") },
  ];

  // Etiqueta resumen del botón del filtro (todos, o la lista seleccionada).
  function selLabelOf<T extends string>(value: T[], options: Array<{ value: T; label: string }>): string {
    if (value.includes("all" as T)) return tWallet("filterTypeAllValue");
    return options.filter((o) => o.value !== "all" && value.includes(o.value)).map((o) => o.label).join(", ");
  }
  const typeSelLabel = selLabelOf(typeFilter, typeOptions);
  const rejSelLabel = selLabelOf(rejFilter, rejOptions);
  const delExpSelLabel = selLabelOf(delExpFilter, typeOptions);

  // Un saludo/consejo pasa el filtro de tipo si su tipo está seleccionado.
  const greetingPassesType = (t: string | undefined, filter: ExpTypeFilter[]) =>
    (t === "saludo" && filter.includes("saludo")) || (t === "consejo" && filter.includes("consejo"));

  // ── Pendientes ──
  const applyTypeFilter = tab === "requested" && !typeFilter.includes("all");
  const filteredPending = applyTypeFilter
    ? exp.buyerPending.filter((r) => greetingPassesType((r.data as { type?: string }).type, typeFilter))
    : exp.buyerPending;
  const pendingMeet = applyTypeFilter && !typeFilter.includes("meet_greet") ? [] : exp.buyerMeetGreets;
  const pendingExclusive = applyTypeFilter && !typeFilter.includes("exclusive_session") ? [] : exp.buyerExclusiveSessions;

  // ── Rechazados: un filtro combinado. Las selecciones de tipo se aplican entre sí
  // como OR y las de estatus como OR, y entre ambas dimensiones como AND. ──
  const rejActive = tab === "rejected" && !rejFilter.includes("all");
  const rejTypes = rejFilter.filter(
    (v) => v === "exclusive_session" || v === "saludo" || v === "consejo" || v === "meet_greet"
  );
  const rejStatuses = rejFilter.filter((v) => v === "refund" || v === "rejected");
  const passesRejStatus = (status: string) =>
    !rejActive || rejStatuses.length === 0 ||
    (isRefundStatus(status) ? rejStatuses.includes("refund") : rejStatuses.includes("rejected"));
  const passesRejGreetingType = (t: string | undefined) =>
    !rejActive || rejTypes.length === 0 ||
    (t === "saludo" && rejTypes.includes("saludo")) || (t === "consejo" && rejTypes.includes("consejo"));
  const passesRejSessionType = (kind: "meet_greet" | "exclusive_session") =>
    !rejActive || rejTypes.length === 0 || rejTypes.includes(kind);

  const filteredRejGreetings = exp.buyerRejectedGreetings.filter(
    (r) => passesRejGreetingType((r.data as { type?: string }).type) && passesRejStatus(r.data.status)
  );
  const rejMeet = exp.buyerMeetGreets.filter(
    (r) => passesRejSessionType("meet_greet") && passesRejStatus(r.data.status)
  );
  const rejExclusive = exp.buyerExclusiveSessions.filter(
    (r) => passesRejSessionType("exclusive_session") && passesRejStatus(r.data.status)
  );

  // ── Entregados · sub "Experiencias": por tipo (los 4). ──
  const delActive = tab === "delivered" && deliveredSub === "experiencias" && !delExpFilter.includes("all");
  const outBuyerDelivered = delActive
    ? exp.buyerDelivered.filter((r) => greetingPassesType((r.data as { type?: string }).type, delExpFilter))
    : exp.buyerDelivered;
  const delMeet = delActive && !delExpFilter.includes("meet_greet") ? [] : exp.buyerMeetGreets;
  const delExclusive = delActive && !delExpFilter.includes("exclusive_session") ? [] : exp.buyerExclusiveSessions;

  // Arrays finales según la pestaña activa.
  const outPending = tab === "requested" ? filteredPending : exp.buyerPending;
  const outRejGreetings = tab === "rejected" ? filteredRejGreetings : exp.buyerRejectedGreetings;
  const outMeet = tab === "requested" ? pendingMeet : tab === "rejected" ? rejMeet : tab === "delivered" ? delMeet : exp.buyerMeetGreets;
  const outExclusive = tab === "requested" ? pendingExclusive : tab === "rejected" ? rejExclusive : tab === "delivered" ? delExclusive : exp.buyerExclusiveSessions;

  // Cantidad total de pendientes de la persona (no depende del filtro): saludos/
  // consejos + sesiones/tiempo contigo que estén "por atender".
  const pendingCount =
    exp.buyerPending.length +
    [...exp.buyerMeetGreets, ...exp.buyerExclusiveSessions].filter(
      (r) => r.data.status !== "completed" && getSectionForMeetGreetStatus(r.data.status) === "requested"
    ).length;

  // Cantidad total de entregados (saludos/consejos entregados + sesiones completadas).
  const deliveredCount =
    exp.buyerDelivered.length +
    [...exp.buyerMeetGreets, ...exp.buyerExclusiveSessions].filter(
      (r) => r.data.status === "completed"
    ).length;

  // Compras completas (Todo) — solo el conteo/loading aquí, para decidir el subnav.
  const allPurchases = useAllPurchases(user?.uid);

  // Rechazados: SOLO las accionables (rechazadas y cobradas, que aún pueden pedir
  // devolución o reintentar). Las ya DEVUELTAS (a crédito = refund_requested/refund_review,
  // o a la tarjeta = rechazada sin cobrar) viven en Entregados → "Todo", no aquí. Debe
  // coincidir con `isReturnedRow` de OwnerSidebarGreetings para que la pestaña desaparezca
  // cuando queda vacía.
  const isReturnedExp = (status: string, paymentStatus?: string) =>
    status === "refund_requested" ||
    status === "refund_review" ||
    (status === "rejected" && paymentStatus !== "paid");
  const rejectedCount =
    exp.buyerRejectedGreetings.filter(
      (r) => !isReturnedExp(r.data.status, (r.data as { paymentStatus?: string }).paymentStatus)
    ).length +
    [...exp.buyerMeetGreets, ...exp.buyerExclusiveSessions].filter(
      (r) =>
        getSectionForMeetGreetStatus(r.data.status) === "rejected" &&
        !isReturnedExp(r.data.status, (r.data as { paymentStatus?: string }).paymentStatus)
    ).length;

  // ── Disponibilidad de las pestañas del subnav principal ────────────────────
  const dataLoading = exp.loading || allPurchases.loading;
  const hasPending = pendingCount > 0;
  const hasRejected = rejectedCount > 0;
  const hasDeliveredExp = deliveredCount > 0; // experiencias entregadas (las 4)
  // "Entregados" existe si hay experiencias entregadas O cualquier compra en Todo.
  const hasDelivered = hasDeliveredExp || allPurchases.purchases.length > 0;
  const availableTabs = TAB_ORDER.filter((t) =>
    t === "requested" ? hasPending : t === "rejected" ? hasRejected : hasDelivered
  );
  // Default: pendientes; si no hay, entregados; luego rechazados.
  const defaultTab: Tab = hasPending ? "requested" : hasDelivered ? "delivered" : hasRejected ? "rejected" : "requested";
  const visibleTabs = tabs.filter((t) => availableTabs.includes(t.key));

  // ── Notificaciones: "nuevo" por categoría (última actividad vs. "visto") ─────
  const { seen: expSeen, markSeen: markExpSeen, markAllSeen: markAllExpSeen } =
    useBuyerExperiencesSeen(user?.uid);
  const pageLatest = computeCategoryLatest({
    pendingGreetings: exp.buyerPending,
    deliveredGreetings: exp.buyerDelivered,
    rejectedGreetings: exp.buyerRejectedGreetings,
    sessions: [...exp.buyerMeetGreets, ...exp.buyerExclusiveSessions],
  });
  // El punto de la ESTRELLA lo enciende `useBuyerExperienceActivity` (layout), que
  // consulta las mismas colecciones pero clasifica por su cuenta. Si aquí marcamos
  // "visto" con un timestamp menor que el suyo, el punto queda encendido para
  // siempre. Marcamos contra el mayor de los dos para que siempre se apague.
  const starLatest = useBuyerExperienceActivity(user?.uid);
  const catLatest: Record<Tab, number> = {
    requested: Math.max(pageLatest.requested, starLatest.requested),
    rejected: Math.max(pageLatest.rejected, starLatest.rejected),
    delivered: Math.max(pageLatest.delivered, starLatest.delivered),
  };
  const isNew: Record<Tab, boolean> = {
    requested: isCategoryNew(catLatest.requested, expSeen.requested),
    rejected: isCategoryNew(catLatest.rejected, expSeen.rejected),
    delivered: isCategoryNew(catLatest.delivered, expSeen.delivered),
  };
  // Categoría a abrir: la NUEVA más reciente (entre las disponibles); si ninguna es
  // nueva, el default por contenido.
  const newestNewTab = availableTabs
    .filter((t) => isNew[t])
    .reduce<Tab | null>((best, t) => (best === null || catLatest[t] >= catLatest[best] ? t : best), null);
  const openTarget: Tab = newestNewTab ?? defaultTab;
  const didAutoOpenRef = useRef(false);

  // Puntos del subnav congelados al entrar. Entrar a la pantalla marca visto TODO
  // lo que había (si no, la categoría que no abrieras conservaba su punto para
  // siempre y volvía en cada sesión), pero el usuario todavía necesita ver dónde
  // hubo novedad: sin congelar, los puntos se apagarían antes del primer paint.
  // Cada punto se apaga al visitar su pestaña.
  const [frozenIsNew, setFrozenIsNew] = useState<Record<Tab, boolean> | null>(null);
  const displayIsNew = frozenIsNew ?? isNew;

  // Si la pestaña activa dejó de existir (o arranca vacía), caer al default válido.
  useEffect(() => {
    if (dataLoading) return;
    if (!availableTabs.includes(tab)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab(defaultTab);
      markExpSeen(defaultTab, catLatest[defaultTab]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoading, hasPending, hasRejected, hasDelivered, tab]);

  // Auto-apertura (una sola vez, al cargar): caer en la categoría NUEVA más
  // reciente; si ninguna es nueva, en el default. Marca visto TODO lo que había
  // —no solo la categoría abierta— y congela los puntos para que se sigan viendo
  // durante la visita.
  useEffect(() => {
    if (dataLoading || didAutoOpenRef.current) return;
    didAutoOpenRef.current = true;
    const landing = availableTabs.includes(openTarget) ? openTarget : tab;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (landing !== tab) setTab(landing);
    setFrozenIsNew({ ...isNew, [landing]: false }); // la que se abre ya se vio
    markAllExpSeen(catLatest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoading]);

  // Barra indicadora blanca: mide la pestaña activa. Se re-mide también cuando el
  // subnav aparece/cambia de composición (al cargar datos o cambiar disponibilidad).
  useEffect(() => {
    function measure() {
      const el = tabRefs.current[tab];
      const nav = navRef.current;
      if (!el || !nav) return;
      const r = el.getBoundingClientRect();
      const nr = nav.getBoundingClientRect();
      const w = Math.min(64, r.width - 16);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIndicator({ left: r.left - nr.left + (r.width - w) / 2, width: w });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, dataLoading, availableTabs.length]);

  const greetingsNode = (
    <OwnerSidebarGreetings
      activeSection={tab}
      buyerPending={outPending}
      buyerDelivered={outBuyerDelivered}
      buyerRejectedGreetings={outRejGreetings}
      buyerMeetGreets={outMeet}
      buyerExclusiveSessions={outExclusive}
      exclusiveSessionsByGroup={{}}
      meetGreetsByGroup={{}}
      groupMetaMap={exp.groupMetaMap}
      userMiniMap={exp.userMiniMap}
      styles={styles}
      typeLabel={typeLabel}
      fmtDate={(ts) => fmtDate(ts, locale)}
      renderUserLink={renderUserLink}
      router={router}
    />
  );

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "16px 12px 48px", width: "100%", boxSizing: "border-box" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "#fff", margin: "4px 2px 14px", letterSpacing: "-0.02em" }}>
        {tNav("tabExperiences")}
      </h1>

      {/* SALDO A FAVOR (crédito por devoluciones): arriba del subnav, como en la wallet.
          Solo aparece cuando hay saldo (>0). Gastable en próximas experiencias. */}
      {credit.balance > 0 ? (
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
            padding: "12px 14px", borderRadius: 14, marginBottom: 16, boxSizing: "border-box",
            background: "linear-gradient(135deg, rgba(34,197,94,0.14), rgba(90,41,174,0.14))",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={{ width: 30, height: 30, borderRadius: "50%", background: "#22c55e", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </span>
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.62)", fontWeight: 600, lineHeight: 1.2 }}>Crédito disponible</span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", lineHeight: 1.3 }}>Úsalo en tus próximas experiencias</span>
            </div>
          </div>
          <span style={{ fontSize: 18, fontWeight: 700, color: "#22c55e", whiteSpace: "nowrap", flexShrink: 0 }}>
            {pf.format(credit.balance, { baseCurrency: "MXN", code: true })}
          </span>
        </div>
      ) : null}

      {/* DEVOLUCIÓN EN EFECTIVO (B7): todo el saldo restante es reembolsable a la tarjeta
          original. Si ya hay una solicitud en revisión, se muestra ese estado. Si el saldo
          es menor al mínimo (o 0), no aparece nada. */}
      {cashout.pending ? (
        <div style={{ marginTop: -13, marginBottom: 16, padding: "0 2px", fontSize: 12, color: "rgba(255,255,255,0.4)", textAlign: "right" }}>
          Tienes {pf.format(cashout.pending.amount, { baseCurrency: "MXN", code: true })} en revisión
          para reembolso a tu tarjeta.
        </div>
      ) : credit.balance > 0 ? (
        <div style={{ marginTop: -13, marginBottom: 16, padding: "0 2px", textAlign: "right" }}>
          <button
            type="button"
            onClick={handleRequestCashout}
            disabled={cashoutBusy}
            style={{
              background: "transparent", border: "none", padding: 0,
              fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.4)",
              cursor: cashoutBusy ? "wait" : "pointer", textAlign: "right",
              opacity: cashoutBusy ? 0.6 : 1,
            }}
          >
            {cashoutBusy
              ? "Enviando solicitud…"
              : `Puedes pedir ${pf.format(credit.balance, { baseCurrency: "MXN", code: true })} en efectivo de reembolso`}
          </button>
          {cashoutError && (
            <div style={{ fontSize: 11.5, color: "#f87171", marginTop: 4 }}>{cashoutError}</div>
          )}
        </div>
      ) : null}

      {/* Subnav: sin contenedor (ni fondo ni contorno) + barra blanca deslizante. */}
      <style jsx>{`
        .expSubnav {
          position: relative;
          display: flex;
          margin-bottom: 16px;
        }
        .expTab {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          padding: 2px 6px 12px;
          background: transparent;
          border: none;
          cursor: pointer;
          font-family: inherit;
          -webkit-tap-highlight-color: transparent;
        }
        .expTabLabel {
          font-size: 12px;
          font-weight: 600;
          line-height: 1;
          transition: color 150ms ease;
        }
        .expIndicator {
          position: absolute;
          bottom: 0;
          height: 2.5px;
          border-radius: 999px;
          background: #ffffff;
          transition: left 0.28s cubic-bezier(0.4, 0, 0.2, 1),
                      width 0.28s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .expSlideClip {
          overflow-x: clip;
        }
      `}</style>

      {/* Subnav principal: solo pestañas con contenido. Si queda una sola, no se
          muestra (se ve directo esa sección). */}
      {!dataLoading && availableTabs.length >= 2 ? (
      <div role="tablist" ref={navRef} className="expSubnav">
        {visibleTabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              ref={(el) => { tabRefs.current[t.key] = el; }}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => goTab(t.key)}
              className="expTab"
            >
              <span style={{ display: "inline-flex", position: "relative" }}>
                {t.icon}
                {displayIsNew[t.key] ? (
                  <span aria-hidden="true" style={{ position: "absolute", top: -2, right: -2, width: 9, height: 9, borderRadius: 999, background: "#ff3b30", border: "2px solid #000" }} />
                ) : null}
              </span>
              <span className="expTabLabel" style={{ color: active ? "#fff" : "rgba(255,255,255,0.55)" }}>
                {t.label}
              </span>
            </button>
          );
        })}
        {indicator ? (
          <span className="expIndicator" style={{ left: indicator.left, width: indicator.width }} />
        ) : null}
      </div>
      ) : null}

      {/* Filtro por tipo (solo en Pendientes), idéntico al del feed de Movimientos.
          A la derecha, el número de pendientes de la persona. */}
      {tab === "requested" && !dataLoading && hasPending ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
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
          <span style={{ flexShrink: 0, color: "#ffffff", fontSize: 15, fontWeight: 700, lineHeight: 1, paddingRight: 4 }}>
            {pendingCount}
          </span>
        </div>
      ) : null}

      {/* Filtro único en Rechazados: combina tipo de experiencia y estatus. */}
      {tab === "rejected" && !dataLoading && hasRejected ? (
        <div style={{ maxWidth: "100%", minWidth: 0, overflow: "hidden", marginBottom: 6 }}>
          <WalletFilterMenu
            label={rejSelLabel}
            menuLabel={tWallet("filterTypeMenu")}
            value={rejFilter}
            options={rejOptions}
            onChange={setRejFilter}
            allValue="all"
            transparent
          />
        </div>
      ) : null}

      {dataLoading ? (
        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, textAlign: "center", padding: "24px 0" }}>{tCommon("loading")}</p>
      ) : availableTabs.length === 0 ? (
        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, textAlign: "center", padding: "24px 0" }}>{tCommon("noPurchasesYet")}</p>
      ) : (
        <div className="expSlideClip">
          <div ref={contentRef}>
            {tab === "delivered" ? (
              hasDeliveredExp ? (
              <>
                {/* Segundo subnav dentro de Entregados: Experiencias | Todo. */}
                <div role="tablist" ref={subNavRef} className="expSubnav" style={{ marginBottom: 12 }}>
                  {DELIVERED_SUB_ORDER.map((k, i) => {
                    const active = deliveredSub === k;
                    const label = k === "experiencias" ? tNav("tabExperiences") : tNav("tabAll");
                    return (
                      <button
                        key={k}
                        ref={(el) => { subTabRefs.current[i] = el; }}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => goDeliveredSub(k)}
                        className="expTab"
                      >
                        <span className="expTabLabel" style={{ color: active ? "#fff" : "rgba(255,255,255,0.55)" }}>
                          {label}
                        </span>
                      </button>
                    );
                  })}
                  {subIndicator ? (
                    <span className="expIndicator" style={{ left: subIndicator.left, width: subIndicator.width }} />
                  ) : null}
                </div>

                <div className="expSlideClip">
                  <div ref={subContentRef}>
                    {deliveredSub === "experiencias" ? (
                      <>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                          <div style={{ minWidth: 0, overflow: "hidden" }}>
                            <WalletFilterMenu
                              label={delExpSelLabel}
                              menuLabel={tWallet("filterTypeMenu")}
                              value={delExpFilter}
                              options={typeOptions}
                              onChange={setDelExpFilter}
                              allValue="all"
                              transparent
                            />
                          </div>
                          <span style={{ flexShrink: 0, color: "#ffffff", fontSize: 15, fontWeight: 700, lineHeight: 1, paddingRight: 4 }}>
                            {deliveredCount}
                          </span>
                        </div>
                        {greetingsNode}
                      </>
                    ) : (
                      <PurchasesTodoList uid={user?.uid} />
                    )}
                  </div>
                </div>
              </>
              ) : (
                <PurchasesTodoList uid={user?.uid} />
              )
            ) : (
              greetingsNode
            )}
          </div>
        </div>
      )}
    </div>
  );
}
