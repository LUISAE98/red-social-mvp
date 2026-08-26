"use client";

import { useMemo, useState, useEffect, useLayoutEffect, useRef } from "react";
import { intlLocale } from "@/i18n/locales";
import { useTranslations, useLocale } from "next-intl";
import { useAuth } from "@/app/providers";
import { TextButton, IconButton } from "@/components/ui";
import WalletSectionShell from "../components/WalletSectionShell";
import { WalletCard } from "../components/WalletUi";
import WalletTransactions from "../components/WalletTransactions";
import {
  useWalletFinances,
  selectFinanceView,
} from "@/lib/wallet/walletFinances";
import { useWalletLedger } from "@/lib/wallet/walletLedger";
import { useWalletMoney } from "@/lib/wallet/useWalletMoney";
import { PAYOUT_MIN_USD } from "@/lib/currency/catalog";
import { useBalanceHidden, toggleBalanceHidden } from "@/lib/wallet/useBalanceHidden";
import MaskedAmount from "@/app/components/MaskedAmount";
import WalletFigureSkeleton from "../components/WalletFigureSkeleton";
import WalletCurrencyToggle from "../components/WalletCurrencyToggle";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import WithdrawFiscalPanel from "../components/WithdrawFiscalPanel";
import CreatorPayoutSetupPanel from "../components/CreatorPayoutSetupPanel";
import { useCreatorTaxProfile } from "@/lib/facturacion/creatorFiscal";



function formatMonthLabel(year: number, month: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), {
      month: "short",
      year: "numeric",
    }).format(new Date(year, month, 1));
  } catch {
    return "";
  }
}

function formatMonthName(date: Date, locale: string): string {
  try {
    const name = new Intl.DateTimeFormat(locale, { month: "long" }).format(date);
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return "";
  }
}

/**
 * Anima un importe desde 0 hasta su valor, como un contador.
 *
 * Se usa en el saldo de la wallet: aparecer de golpe hace que el creador no registre la
 * cifra, y verla subir la convierte en el foco de la pantalla — que es lo que es.
 *
 * ⚠️ Respeta `prefers-reduced-motion`: a quien pide menos movimiento se le entrega el valor
 * final de una vez, sin animación.
 */
/** Tamaño máximo de la cifra principal, y hasta dónde puede encoger. */
const CIFRA_MAX_PX = 40;
const CIFRA_MIN_PX = 19;

/**
 * Encoge la cifra principal lo justo para que NUNCA parta en dos renglones.
 *
 * Un tamaño fijo solo funciona con monedas cortas. `$589.50 USD` cabe de sobra, pero la
 * misma cantidad en rupias o en pesos colombianos trae millones y separadores de miles, y
 * a 40 px se desborda; con `nowrap` se saldría de la tarjeta y sin él caería a dos
 * renglones, que es justo lo que hay que evitar.
 *
 * Mide sobre un clon oculto con el texto FINAL, no sobre lo que hay en pantalla: la cifra
 * está animándose desde cero y medir el valor en curso daría un tamaño que deja de valer
 * en cuanto termina la cuenta.
 *
 * Escribe el `fontSize` directo en el nodo en vez de guardarlo en estado: así el ajuste
 * ocurre en el mismo cuadro que la medición, sin un render intermedio con el tamaño viejo.
 */
function useAjusteAUnRenglon(
  cajaRef: React.RefObject<HTMLDivElement | null>,
  cifraRef: React.RefObject<HTMLDivElement | null>,
  medidaRef: React.RefObject<HTMLSpanElement | null>,
  textoFinal: string
): void {
  useLayoutEffect(() => {
    const caja = cajaRef.current;
    const cifra = cifraRef.current;
    const medida = medidaRef.current;
    if (!caja || !cifra || !medida) return;

    const ajustar = () => {
      // `clientWidth` incluye el relleno; el ancho útil es el de la caja de contenido,
      // que es donde vive la cifra (el relleno lo ocupa el ojito).
      const cs = window.getComputedStyle(caja);
      const disponible =
        caja.clientWidth - parseFloat(cs.paddingInlineStart || "0") - parseFloat(cs.paddingInlineEnd || "0");
      const anchoTexto = medida.offsetWidth;
      if (disponible <= 0 || anchoTexto <= 0) return;
      const escala = Math.min(1, disponible / anchoTexto);
      cifra.style.fontSize = `${Math.max(CIFRA_MIN_PX, Math.floor(CIFRA_MAX_PX * escala))}px`;
    };

    ajustar();
    // Rotar el teléfono o abrir el rail cambia el ancho sin cambiar el texto.
    const ro = new ResizeObserver(ajustar);
    ro.observe(caja);
    // Y si aún no cargó la tipografía, la primera medida es con la de reserva —más
    // estrecha— y la cifra acabaría más grande de lo que cabe.
    let vivo = true;
    void document.fonts?.ready.then(() => {
      if (vivo) ajustar();
    });
    return () => {
      vivo = false;
      ro.disconnect();
    };
  }, [cajaRef, cifraRef, medidaRef, textoFinal]);
}
function useContador(valor: number, activo: boolean, duracionMs = 1100): number {
  const [mostrado, setMostrado] = useState(0);
  const previo = useRef(0);
  useEffect(() => {
    if (!activo) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !Number.isFinite(valor)) {
      // En el siguiente cuadro, no en el cuerpo del efecto: escribir el estado de forma
      // síncrona aquí encadena renders.
      const t = requestAnimationFrame(() => {
        setMostrado(valor);
        previo.current = valor;
      });
      return () => cancelAnimationFrame(t);
    }
    const desde = previo.current;
    const inicio = performance.now();
    let raf = 0;
    const paso = (t: number) => {
      const p = Math.min(1, (t - inicio) / duracionMs);
      // Desaceleración suave: arranca rápido y frena al final, como un marcador.
      const e = 1 - Math.pow(1 - p, 3);
      setMostrado(desde + (valor - desde) * e);
      if (p < 1) raf = requestAnimationFrame(paso);
      else previo.current = valor;
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [valor, activo, duracionMs]);
  return mostrado;
}
export default function WalletFinanzasPage() {
  const tWallet = useTranslations("wallet");
  const tNav = useTranslations("nav");
  const locale = useLocale();
  // Dinero del CREADOR. El modo (USD o su moneda) es compartido por toda la wallet;
  // ver `useWalletMoney` para por qué ninguna de las dos lecturas usa `pf.format`.
  const { formatMoney, refLocal, showingLocal, localCurrency, formatSettlement } = useWalletMoney();
  // Ocultar saldo: mismo estado compartido y persistente que el rail derecho.
  const balanceHidden = useBalanceHidden();
  const { user } = useAuth();
  const { summary, loading: summaryLoading } = useWalletFinances(user?.uid);
  const [mode, setMode] = useState<"net" | "gross">("net");
  const [withdrawPanelOpen, setWithdrawPanelOpen] = useState(false);
  const { toast: walletToast, showToast: showWalletToast } = useVibraToast();



  // Último día del mes en curso (fecha de disponibilidad del retiro).

  const view = selectFinanceView(summary, mode);

  /**
   * Lo retirable NO depende del interruptor neto/bruto.
   *
   * Ese interruptor solo cambia la LECTURA (ver el dinero antes o después de la comisión);
   * lo que el creador puede sacar es siempre el neto. Medir la barra contra `view.available`
   * la llenaba de más al mirar en bruto, prometiendo un retiro que no existe.
   */
  const disponibleNeto = selectFinanceView(summary, "net").available;

  // Skeleton de las cifras variables mientras cargan. Incluye `!user?.uid` para
  // cubrir también la ventana en la que el auth aún no resuelve el usuario.
  const loadingAmounts = summaryLoading || !user?.uid;

  /**
   * El retiro se habilita al alcanzar el MÍNIMO, no en una fecha.
   *
   * Antes dependía del fin de mes y se anunciaba con «Disponible para retirar el X de Y».
   * Ahora el creador ve una barra que se llena y, al llegar, el botón. El motivo del mínimo
   * es el coste del retiro, que por debajo se come un porcentaje enorme (ver `PAYOUT_MIN_USD`).
   */
  const canWithdrawNow = disponibleNeto >= PAYOUT_MIN_USD;
  /**
   * ¿El creador puede retirar?
   *
   * Lo decide su perfil fiscal, no una bandera suelta: el mexicano necesita identidad **y**
   * sello digital; el extranjero, solo identidad. Ver `useCreatorTaxProfile`.
   *
   * 🚧 La verificación de identidad sigue en false hasta que exista el alta de cuenta de
   * Stripe, así que hoy nadie pasa el gate. Es el comportamiento seguro: al llegar al mínimo
   * desaparece la barra y queda el aviso del alta, sin botón de retirar.
   */
  const { payoutReady: altaStripeCompleta } = useCreatorTaxProfile(user?.uid);
  const [setupPanelOpen, setSetupPanelOpen] = useState(false);

  // El saldo sube desde cero al entrar. La barra y el resto de cifras usan el valor real:
  // animar todo a la vez sería ruido.
  const disponibleAnimado = useContador(view.available, !loadingAmounts);

  // La cifra principal no puede partirse en dos renglones en ninguna moneda: se mide el
  // texto final y se encoge la fuente lo necesario. Ver `useAjusteAUnRenglon`.
  const cajaCifraRef = useRef<HTMLDivElement>(null);
  const cifraRef = useRef<HTMLDivElement>(null);
  const medidaCifraRef = useRef<HTMLSpanElement>(null);
  const textoCifraFinal = formatMoney(view.available, { code: true });
  useAjusteAUnRenglon(cajaCifraRef, cifraRef, medidaCifraRef, textoCifraFinal);

  /** Cuánto le falta, y qué porción de la barra lleva. */
  const faltaParaRetirar = Math.max(0, PAYOUT_MIN_USD - disponibleNeto);
  const progresoRetiro = Math.min(1, Math.max(0, disponibleNeto / PAYOUT_MIN_USD));

  function handleWithdrawClick() {
    if (!canWithdrawNow) return;
    setWithdrawPanelOpen(true);
  }

  // La opción de registrar KYC solo aparece cuando ya hay saldo por retirar
  // (al menos una compra). Si el creador ya inició el flujo, mostramos su estado.

  // Mejor mes: mes calendario con más ganancias (entradas "earned").
  const { entries, loading: ledgerLoading } = useWalletLedger(user?.uid, 365);
  const loadingBestMonth = ledgerLoading || !user?.uid;
  const bestMonth = useMemo(() => {
    const byMonth = new Map<string, { year: number; month: number; amount: number }>();
    for (const e of entries) {
      if (e.status !== "earned" || !e.createdAt) continue;
      const year = e.createdAt.getFullYear();
      const month = e.createdAt.getMonth();
      const key = `${year}-${month}`;
      const amount = mode === "gross" ? e.grossAmount : e.netAmount;
      const current = byMonth.get(key) ?? { year, month, amount: 0 };
      current.amount += amount;
      byMonth.set(key, current);
    }
    let best: { year: number; month: number; amount: number } | null = null;
    for (const v of byMonth.values()) {
      if (!best || v.amount > best.amount) best = v;
    }
    return best;
  }, [entries, mode]);

  const toggle = (
    <div
      role="tablist"
      aria-label={tWallet("financesAmountMode")}
      style={{
        display: "inline-flex",
        padding: 3,
        borderRadius: 11,
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.08)",
        gap: 2,
      }}
    >
      {(["net", "gross"] as const).map((key) => {
        const active = mode === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setMode(key)}
            style={{
              border: "none",
              cursor: "pointer",
              borderRadius: 8,
              padding: "6px 14px",
              fontSize: 12.5,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: active ? "#fff" : "rgba(255,255,255,0.6)",
              background: active
                ? "linear-gradient(135deg, #4f46ff, #a855f7)"
                : "transparent",
              transition: "color 150ms ease, background 150ms ease",
            }}
          >
            {key === "net" ? tWallet("financesNet") : tWallet("financesGross")}
          </button>
        );
      })}
    </div>
  );

  return (
    <WalletSectionShell activeTab="finances">
      <WalletCard transparent>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 22,
            paddingTop: 4,
          }}
        >
          {/* Controles: switch neto/bruto (izq) + moneda (centro) + Retirar (der).
              La moneda va centrada (flex:1 a los lados) y se mantiene en medio
              aunque el botón Retirar no esté presente. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "flex-start" }}>
              {toggle}
            </div>

            <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "flex-end" }}>
              {/* En qué moneda lee el creador SU dinero. Antes aquí estaba el switch global
                  de la plataforma, que cambiaba la moneda de todo el sitio desde dentro de la
                  wallet: demasiado alcance para el sitio que ocupa.

                  Un switch a cada extremo: a la izquierda cómo se lee el dinero (neto o bruto),
                  a la derecha en qué moneda. */}
              <WalletCurrencyToggle />

              {/* 🚧 BOTÓN DE RETIRO OCULTO A PROPÓSITO.
                  Antes se mostraba solo con `kyc.approved` (Didit). Al eliminar Didit el
                  2026-08-13 nadie queda aprobado, y **quitar el proveedor del gate no debe
                  quitar el gate**: abrir el retiro a cualquiera sería un retroceso de
                  seguridad, no una limpieza. Vuelve a mostrarse cuando el alta de cuenta
                  Stripe (que trae su propio KYC) esté conectada y podamos preguntarle. */}
            </div>
          </div>

          {/* Disponible para retirar */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              alignItems: "center",
              textAlign: "center",
            }}
          >
            {/* La cifra se centra respecto al bloque, NO respecto al par cifra+ojito:
                el ojito es un control, no parte del monto, y si cuenta para el centrado
                empuja el saldo a la izquierda. Por eso sale del flujo y cuelga del borde
                derecho de la cifra, acompañándola sin desplazarla. */}
            <div
              ref={cajaCifraRef}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                // Ancho completo + relleno simétrico: la cifra queda centrada y el ojito,
                // que cuelga fuera de ella, cae dentro del relleno en vez de desbordar la
                // tarjeta en pantallas angostas.
                alignSelf: "stretch",
                paddingInline: 40,
              }}
            >
              {/* Clon oculto con el texto final: es lo que se mide para decidir el tamaño.
                  Fuera del flujo para que no ocupe sitio ni lo lea un lector de pantalla. */}
              <span
                ref={medidaCifraRef}
                aria-hidden="true"
                style={{
                  position: "absolute",
                  visibility: "hidden",
                  pointerEvents: "none",
                  whiteSpace: "nowrap",
                  fontSize: CIFRA_MAX_PX,
                  fontWeight: 700,
                  letterSpacing: "-0.03em",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {textoCifraFinal}
              </span>
              <div
                ref={cifraRef}
                style={{
                  fontSize: CIFRA_MAX_PX,
                  fontWeight: 700,
                  letterSpacing: "-0.03em",
                  lineHeight: 1.05,
                  color: "#4ade80",
                  fontVariantNumeric: "tabular-nums",
                  position: "relative",
                  whiteSpace: "nowrap",
                }}
              >
                {loadingAmounts ? (
                  <WalletFigureSkeleton width={170} height={32} />
                ) : balanceHidden ? (
                  <MaskedAmount formatted={formatMoney(view.available, { code: true })} />
                ) : (
                  formatMoney(disponibleAnimado, { code: true })
                )}
                <span style={{ position: "absolute", insetInlineStart: "100%", marginInlineStart: 10, top: "50%", transform: "translateY(-50%)", display: "inline-flex" }}>
                  <IconButton label={balanceHidden ? tNav("showAmount") : tNav("hideAmount")} size="sm" tone="bare" shape="square" onClick={toggleBalanceHidden} aria-pressed={balanceHidden}>
                    {balanceHidden ? (
                      <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </IconButton>
                </span>
              </div>
            </div>
            {/* Referencia en la moneda del creador, bajo el saldo. Deliberadamente más
                pequeña: la cifra que manda es la de arriba, que es la que va a cobrar al
                retirar. Esta solo lo ayuda a ubicarse, y convierte al cambio de HOY. */}
            {!balanceHidden && !loadingAmounts && refLocal(view.available) && (
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>
                {tWallet("approxAmountLong", { amount: refLocal(view.available) ?? "" })}
              </div>
            )}

            {/* Progreso hacia el mínimo de retiro. Desaparece al alcanzarlo: a partir de ahí
                lo que corresponde es el botón, no seguir midiendo. */}
            {!loadingAmounts && !canWithdrawNow && (
              <div style={{ width: "100%", maxWidth: 260, marginTop: 12 }}>
                <div
                  style={{
                    height: 6, borderRadius: 999, overflow: "hidden",
                    background: "rgba(255,255,255,0.08)",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.round(progresoRetiro * 100)}%`,
                      borderRadius: 999,
                      background: "linear-gradient(90deg, #a855f7, #4ade80)",
                      // Se llena con una animación suave en cuanto entra el saldo real.
                      transition: "width 900ms cubic-bezier(0.2, 0.8, 0.2, 1)",
                    }}
                  />
                </div>
                <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.5)", marginTop: 6, lineHeight: 1.4 }}>
                  {tWallet("payoutProgressLabel", {
                    amount: formatMoney(faltaParaRetirar, { code: true }),
                  })}
                </div>
              </div>
            )}

            {/* Mismo hueco que la barra: al alcanzar el mínimo, una desaparece y aparece el
                otro. Nunca los dos. Si el alta de Stripe no está hecha, no hay botón — queda
                a la vista el aviso morado del registro, que es lo que toca resolver primero. */}
            {!loadingAmounts && canWithdrawNow && altaStripeCompleta && (
              <div style={{ width: "100%", maxWidth: 260, marginTop: 12, animation: "vbPayoutIn 420ms cubic-bezier(0.2,0.8,0.2,1) both" }}>
                <TextButton tone="brand" size="sm" onClick={handleWithdrawClick} style={{ width: "100%" }}>
                  {tWallet("withdrawButton")}
                </TextButton>
              </div>
            )}
          </div>

          {/* Alta de cobro: abre el panel que bifurca por residencia fiscal. Al mexicano le
              pide identidad y sello; al extranjero, solo identidad. */}
          <TextButton
            tone="brand"
            size="sm"
            onClick={() => setSetupPanelOpen(true)}
            style={{
              width: "100%",
              marginTop: -14,
              lineHeight: 1.35,
              textAlign: "center",
              justifyContent: "center",
            }}
          >
            {tWallet("stripeAccountCta")}
          </TextButton>

          <VibraToast toast={walletToast} />

          {/* Fila de 3 columnas: por liberar · mejor mes · ganado histórico */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 10,
            }}
          >
            {/* Monto por liberar (izquierda) */}
            <div
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "rgba(255,255,255,0.6)",
                  letterSpacing: "-0.01em",
                }}
              >
                {tWallet("financesPendingAmount")}
              </div>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 640,
                  letterSpacing: "-0.02em",
                  color: "rgba(255,255,255,0.9)",
                }}
              >
                {loadingAmounts ? (
                  <WalletFigureSkeleton width={66} height={17} />
                ) : balanceHidden ? (
                  <MaskedAmount formatted={formatMoney(view.pending)} />
                ) : (
                  formatMoney(view.pending)
                )}
              </div>
            </div>

            {/* Mejor mes (centro) */}
            <div
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "rgba(255,255,255,0.6)",
                  letterSpacing: "-0.01em",
                }}
              >
                {tWallet("financesBestMonth")}
              </div>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 640,
                  letterSpacing: "-0.02em",
                  color: "rgba(255,255,255,0.9)",
                }}
              >
                {loadingBestMonth ? (
                  <WalletFigureSkeleton width={66} height={17} />
                ) : balanceHidden ? (
                  <MaskedAmount formatted={formatMoney(bestMonth?.amount ?? 0)} />
                ) : (
                  formatMoney(bestMonth?.amount ?? 0)
                )}
              </div>
              {loadingBestMonth ? (
                <div style={{ textAlign: "center" }}>
                  <WalletFigureSkeleton width={44} height={9} />
                </div>
              ) : bestMonth ? (
                <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)" }}>
                  {formatMonthLabel(bestMonth.year, bestMonth.month, locale)}
                </div>
              ) : null}
            </div>

            {/* Ganado histórico (derecha) */}
            <div
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "rgba(255,255,255,0.6)",
                  letterSpacing: "-0.01em",
                }}
              >
                {tWallet("financesLifetime")}
              </div>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 640,
                  letterSpacing: "-0.02em",
                  color: "rgba(255,255,255,0.9)",
                }}
              >
                {loadingAmounts ? (
                  <WalletFigureSkeleton width={66} height={17} />
                ) : balanceHidden ? (
                  <MaskedAmount formatted={formatMoney(view.lifetime)} />
                ) : (
                  formatMoney(view.lifetime)
                )}
              </div>
            </div>
          </div>

          {/* Aviso de comisión según el modo (neto ya descontado / bruto sin descontar). */}
          <div
            style={{
              fontSize: 11.5,
              lineHeight: 1.45,
              color: "rgba(255,255,255,0.42)",
              textAlign: "center",
              marginTop: -12,
            }}
          >
            {mode === "net"
              ? tWallet("financesCommissionNet")
              : tWallet("financesCommissionGross")}
          </div>

          {/* Al leer en su moneda, las cifras dejan de ser exactas: lo que se liquida está
              en USD y esto es una conversión al cambio de hoy, que mañana será otro. Sin
              este aviso el creador podría reclamar una diferencia que no es tal. */}
          {showingLocal ? (
            <div
              style={{
                fontSize: 11.5,
                lineHeight: 1.45,
                color: "rgba(255,255,255,0.42)",
                textAlign: "center",
                marginTop: -12,
              }}
            >
              {tWallet("financesLocalApproxNote", { currency: localCurrency })}
            </div>
          ) : null}

          {/* 🧾 Lo recaudado en impuestos. NO es del creador: Vibra lo entera a la autoridad
              del país de cada comprador. Va justo bajo la nota de comisión porque las dos
              explican lo mismo — qué parte de lo cobrado NO es suya— y juntas se leen de
              corrido. Solo aparece si hubo ventas con impuesto. */}
          {summary.taxCollected > 0 ? (
            <div
              title={tWallet("financesTaxCollectedHint")}
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.52)",
                textAlign: "center",
                marginTop: -12,
              }}
            >
              {tWallet("financesTaxCollected")}:{" "}
              <strong style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>
                {formatMoney(summary.taxCollected, { code: true })}
              </strong>
            </div>
          ) : null}

          {/* Devuelto (solo si hay) */}
          {view.refunded > 0 ? (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "4px 18px",
                fontSize: 12,
                color: "rgba(255,255,255,0.52)",
                paddingTop: 2,
              }}
            >
              <span>
                {tWallet("financesRefunded")}:{" "}
                <strong style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>
                  {formatMoney(view.refunded, { code: true })}
                </strong>
              </span>
            </div>
          ) : null}

        </div>
      </WalletCard>

      <WalletTransactions uid={user?.uid} mode={mode} />

      {/* Panel fiscal del retiro (creador mexicano). 🔁 El creador EXTRANJERO pasará
          directo a pago sin este panel cuando se determine su país fiscal. */}
      {/* Alta de cobro. Desde aquí se llega al panel fiscal, que es donde vive la subida
          del sello: uno lleva al otro en vez de duplicar el formulario. */}
      <CreatorPayoutSetupPanel
        open={setupPanelOpen}
        onClose={() => setSetupPanelOpen(false)}
        onOpenSello={() => setWithdrawPanelOpen(true)}
      />

      <WithdrawFiscalPanel
        open={withdrawPanelOpen}
        onClose={() => setWithdrawPanelOpen(false)}
        uid={user?.uid}
        // ⚠️ En la moneda de liquidación SIEMPRE, aunque el creador esté leyendo en la suya:
        // de aquí salen el subtotal, el IVA y el «total a facturar» que copia a su CFDI, y
        // una conversión al cambio de hoy no puede acabar en un comprobante fiscal.
        availableLabel={formatSettlement(disponibleNeto, { code: true })}
        // IVA 16% (creador mexicano). Las retenciones se agregarán cuando se defina
        // el modelo fiscal con la API de pagos elegida.
        ivaLabel={formatSettlement(disponibleNeto * 0.16, { code: true })}
        totalLabel={formatSettlement(disponibleNeto * 1.16, { code: true })}
      />
    </WalletSectionShell>
  );
}
