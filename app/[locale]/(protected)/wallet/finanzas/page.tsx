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

import { useBalanceHidden, toggleBalanceHidden } from "@/lib/wallet/useBalanceHidden";
import MaskedAmount from "@/app/components/MaskedAmount";
import WalletFigureSkeleton from "../components/WalletFigureSkeleton";
import WalletCurrencyToggle from "../components/WalletCurrencyToggle";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import WithdrawFiscalPanel from "../components/WithdrawFiscalPanel";
import CreatorPayoutSetupPanel from "../components/CreatorPayoutSetupPanel";
import { useCreatorTaxProfile } from "@/lib/facturacion/creatorFiscal";
import { useKyc } from "@/lib/kyc/useKyc";
import { calcularRetiro } from "@/lib/tax/fiscalEngine";

/**
 * Códigos de rechazo de Didit → clave de traducción.
 *
 * Didit manda el motivo en crudo y en inglés. Sin este mapa, al creador se le
 * enseñaría "DOCUMENT_EXPIRED" tal cual; con él, sabe que su documento venció y
 * que puede reintentar. Varios códigos caen en el mismo mensaje a propósito: al
 * creador le importa QUÉ hacer, no el matiz interno del proveedor.
 */
const KYC_REASON_KEY: Record<string, string> = {
  POSSIBLE_DUPLICATED_USER: "kycReasonDuplicate",
  DUPLICATED_USER: "kycReasonDuplicate",
  DUPLICATED_FACE: "kycReasonDuplicate",
  DOCUMENT_EXPIRED: "kycReasonDocExpired",
  EXPIRED_DOCUMENT: "kycReasonDocExpired",
  DOCUMENT_TYPE_NOT_ALLOWED: "kycReasonDocUnsupported",
  DOCUMENT_NOT_SUPPORTED: "kycReasonDocUnsupported",
  UNSUPPORTED_DOCUMENT: "kycReasonDocUnsupported",
  FACE_NOT_MATCHING: "kycReasonFaceMismatch",
  FACE_MISMATCH: "kycReasonFaceMismatch",
  LIVENESS_FAILED: "kycReasonLiveness",
  NOT_LIVE: "kycReasonLiveness",
  SPOOFING_DETECTED: "kycReasonLiveness",
  DOCUMENT_MANIPULATED: "kycReasonManipulated",
  TAMPERED_DOCUMENT: "kycReasonManipulated",
  FRAUD: "kycReasonManipulated",
  UNDERAGE: "kycReasonUnderage",
  AGE_NOT_MET: "kycReasonUnderage",
  BAD_QUALITY: "kycReasonQuality",
  LOW_QUALITY: "kycReasonQuality",
  UNREADABLE_DOCUMENT: "kycReasonQuality",
};



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
   * ¿El creador puede retirar?
   *
   * Lo decide su perfil, no una bandera suelta: identidad verificada y cuenta de cobro dada
   * de alta, más el sello digital si es mexicano. Ver `useCreatorTaxProfile`.
   *
   * ⚠️ Mientras no complete el alta no pasa el gate, y eso es lo correcto: al llegar al
   * mínimo desaparece la barra y queda el aviso del alta, sin botón de retirar. Prometerle un
   * botón que lleva a un pago sin destino es peor que no enseñarlo.
   */
  const {
    payoutReady: puedeCobrar,
    esMexicano,
    csdReady: selloListo,
    /**
     * 💰 Su mínimo, no el de todos.
     *
     * 300 USD donde hay transferencia local y 500 donde solo llega el wire, que cuesta 25
     * USD fijos y a 300 se comería más del 8%. Mientras no tenga cuenta de cobro se le
     * enseña el estándar. Ver `docs/payout-tiers.md`.
     */
    minWithdrawalUsd: minimoRetiro,
    payoutCountryUnpayable: paisSinRutaDePago,
    /** El nivel visible, estimado o real. */
    terminosVisibles,
    /** ¿Tiene a dónde cobrar? Es un paso APARTE del KYC, y también obligatorio. */
    payoutAccountReady: cuentaDeCobroLista,
    /** Por dónde cobra. Decide qué alta le toca, si Stripe o Wallbit. */
    payoutRoute: rutaDeCobro,
    /** ¿Ya declaró su cuenta en el cuestionario de Didit? Es el paso 2 del alta. */
    payoutAccountDeclared: cuentaDeclarada,
  } = useCreatorTaxProfile(user?.uid);
  /**
   * El retiro se habilita al alcanzar el MÍNIMO, no en una fecha.
   *
   * Antes dependía del fin de mes y se anunciaba con «Disponible para retirar el X de Y».
   * Ahora el creador ve una barra que se llena y, al llegar, el botón. El motivo del mínimo
   * es el coste del retiro, que por debajo se come un porcentaje enorme.
   *
   * ⚠️ El mínimo es SUYO, no el de todos (2026-08-27). Sale del país de su cuenta de cobro.
   * `PAYOUT_MIN_USD` sigue siendo el estándar y es lo que se le enseña mientras no tiene
   * cuenta, pero ya no es la cifra que decide.
   */
  const canWithdrawNow = disponibleNeto >= minimoRetiro;
  /**
   * ¿Viene de vuelta del formulario de Stripe?
   *
   * El alta de la cuenta de cobro se hace fuera de Vibra y Stripe devuelve al creador con
   * `?alta=ok` (terminó) o `?alta=reintentar` (el enlace caducó, caduca a los 10 minutos).
   * En los dos casos se le vuelve a abrir el panel donde lo dejó, en vez de soltarlo en una
   * Finanzas idéntica a la que dejó y que no le dice nada de lo que acaba de hacer.
   *
   * Se lee una sola vez, al montar, y se limpia la URL para que recargar no lo repita.
   */
  const [retornoAlta] = useState<"ok" | "reintentar" | null>(() => {
    if (typeof window === "undefined") return null;
    const v = new URLSearchParams(window.location.search).get("alta");
    return v === "ok" || v === "reintentar" ? v : null;
  });
  const [setupPanelOpen, setSetupPanelOpen] = useState(retornoAlta != null);

  // Fuera el parámetro de la barra de direcciones: ya cumplió, y si se queda, recargar
  // volvería a disparar la relectura y a reabrir el panel.
  useEffect(() => {
    if (!retornoAlta || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("alta");
    window.history.replaceState(null, "", url.toString());
  }, [retornoAlta]);

  // ── Identidad (KYC) ───────────────────────────────────────────────────────
  const kyc = useKyc(user?.uid);

  const kycReasonText = tWallet(
    (kyc.reason && KYC_REASON_KEY[kyc.reason]) || "kycReasonGeneric"
  );

  // "in_review" = Didit lo está revisando a mano: no hay nada que pulsar.
  // "pending" = sesión abierta sin terminar → se puede continuar.
  const kycCtaLabel =
    kyc.status === "in_review"
      ? tWallet("kycPending")
      : kyc.status === "pending"
        ? tWallet("kycContinue")
        : kyc.status === "declined"
          ? tWallet("kycRejectedReason", { reason: kycReasonText })
          : tWallet("kycWithdrawCta");
  const kycCtaDisabled = kyc.status === "in_review" || kyc.starting || kyc.loading;

  async function handleKycClick() {
    if (kycCtaDisabled) return;
    try {
      await kyc.startKyc(locale);
    } catch {
      showWalletToast(tWallet("kycStartError"), "error");
    }
  }

  /**
   * Los datos fiscales solo se le piden al creador MEXICANO: es quien emite CFDI.
   * Y solo DESPUÉS de tener la identidad verificada — pedir el sello a alguien que
   * aún no sabemos quién es sería recoger datos fiscales de un desconocido.
   *
   * Ser mexicano ya no se pregunta, se deduce del país del documento del KYC y del país de
   * la cuenta de cobro. Ver `esMexicano` en `useCreatorTaxProfile`.
   */
  const mostrarAltaFiscal = kyc.approved && esMexicano && !selloListo;

  /**
   * ¿Le queda algo del alta de cobro?
   *
   * 🔴 EL KYC NO ES EL TRÁMITE ENTERO. Este botón se escondía con `kyc.approved` a secas, así
   * que en cuanto Didit aprobaba la identidad desaparecía la única puerta de entrada al panel
   * — con la cuenta de cobro todavía sin dar de alta. El creador se quedaba sin poder retirar
   * y sin nada que pulsar para arreglarlo.
   *
   * Los pasos que le tocan son uno, dos o tres según su caso: identidad y cuenta de cobro son
   * de todos, el sello solo del mexicano. El botón vive mientras falte alguno de los dos
   * primeros; el sello tiene el suyo propio, aquí abajo.
   */
  const faltaAltaDeCobro = !kyc.approved || !cuentaDeCobroLista;

  // Su comisión, que ya no es 25 para todos: en 27 países es 30.
  const comisionPct = Math.round(terminosVisibles.commissionRate * 100);

  /**
   * El botón nombra el paso que le toca AHORA, no el trámite completo.
   *
   * Decirle «haz tu registro KYC» a quien ya lo tiene aprobado lo manda a rehacer algo que ya
   * hizo, y le esconde lo que de verdad le falta.
   */
  /**
   * La frase morada. UNA sola, siempre.
   *
   * ⚠️ Antes eran dos —una para la cuenta de cobro y otra para los datos fiscales— y las dos
   * abrían EL MISMO panel. Parecían dos acciones distintas y no lo eran: el creador tenía que
   * adivinar cuál pulsar, cuando daba igual.
   *
   * Ahora nombra lo PRIMERO que le falta, en el orden del alta. Lo demás lo ve al abrir el
   * panel, que es donde están los cuatro pasos con su estado.
   *
   * Todas empiezan por «Da clic aquí para…» a propósito: un texto morado no se lee como botón
   * si no lo dice, y el creador no tiene por qué deducirlo del color.
   */
  const altaCtaLabel = !kyc.approved
    ? kycCtaLabel
    : !cuentaDeclarada
      ? tWallet(rutaDeCobro === "wallbit" ? "ctaWallbitAccount" : "ctaDeclareAccount")
      : !cuentaDeCobroLista && rutaDeCobro !== "wallbit"
        ? tWallet("ctaStripeAccount")
        : tWallet("ctaFiscalData");

  /**
   * Qué le llega al retirar.
   *
   * La wallet sigue enseñando su 75% íntegro; los descuentos viven SOLO aquí, en el momento
   * de pedir el dinero. Decisión de producto del 2026-08-26.
   */
  const desgloseRetiro = useMemo(() => {
    const r = calcularRetiro({
      saldo: disponibleNeto,
      isrPendiente: summary.retainedIsr,
      ivaPendiente: summary.retainedIva,
      ivaComisionPendiente: summary.commissionVat,
    });
    return {
      bruto: formatSettlement(r.bruto, { code: true }),
      isr: formatSettlement(r.isr, { code: true }),
      iva: formatSettlement(r.iva, { code: true }),
      ivaComision: formatSettlement(r.ivaComision, { code: true }),
      neto: formatSettlement(r.neto, { code: true }),
      hayRetenciones: r.isr > 0 || r.iva > 0 || r.ivaComision > 0,
    };
  }, [disponibleNeto, summary.retainedIsr, summary.retainedIva, summary.commissionVat, formatSettlement]);

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
  const faltaParaRetirar = Math.max(0, minimoRetiro - disponibleNeto);
  const progresoRetiro = Math.min(1, Math.max(0, disponibleNeto / minimoRetiro));

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

                {/* Por qué su mínimo es más alto que el de otros. Va pegado a la barra,
                    que es donde se le hace larga la espera y donde nace la pregunta.

                    Si el nivel viene de su IP y no de su cuenta, se dice que es aproximado:
                    prometerle un mínimo que luego cambie es peor que avisar. */}
                {terminosVisibles.tier === "expensive" && (
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", marginTop: 4, lineHeight: 1.45 }}>
                    {tWallet("payoutMinimumWhy")}
                  </div>
                )}

              </div>
            )}

            {/* 🔴 Vende pero no cobra.

                73 países donde Global Payouts no llega. Se le dice aquí, junto al saldo, y no
                al pulsar retirar: el creador tiene que poder decidir si le compensa seguir
                acumulando, y esa decisión no se toma el día que ya lo hizo. */}
            {!loadingAmounts && paisSinRutaDePago && (
              <div
                style={{
                  width: "100%",
                  maxWidth: 260,
                  marginTop: 12,
                  padding: "10px 12px",
                  borderRadius: 12,
                  background: "rgba(248,113,113,0.09)",
                  border: "1px solid rgba(248,113,113,0.28)",
                  color: "#fca5a5",
                  fontSize: 11.5,
                  lineHeight: 1.45,
                }}
              >
                {tWallet("payoutNoRouteWarning")}
              </div>
            )}

            {/* Mismo hueco que la barra: al alcanzar el mínimo, una desaparece y aparece el
                otro. Nunca los dos. Si el alta de Stripe no está hecha, no hay botón — queda
                a la vista el aviso morado del registro, que es lo que toca resolver primero. */}
            {!loadingAmounts && canWithdrawNow && puedeCobrar && (
              <div style={{ width: "100%", maxWidth: 260, marginTop: 12, animation: "vbPayoutIn 420ms cubic-bezier(0.2,0.8,0.2,1) both" }}>
                <TextButton tone="brand" size="sm" onClick={handleWithdrawClick} style={{ width: "100%" }}>
                  {tWallet("withdrawButton")}
                </TextButton>
              </div>
            )}
          </div>

          {/* TRES trámites posibles, repartidos en dos botones según quién los arregla.

              1. IDENTIDAD (KYC de Didit)      — de todos.
              2. CUENTA DE COBRO (Stripe)      — de todos.
              3. DATOS FISCALES (RFC y sello)  — solo del creador mexicano, y solo
                                                 con la identidad ya resuelta.

              Los dos primeros comparten botón porque son el mismo trámite en dos
              tramos: saber quién eres y a dónde te pagamos. El fiscal va aparte
              porque falla por otro motivo y se arregla en otro sitio; juntarlo
              obligaba a adivinar cuál de los dos era el que faltaba. */}

          {/* 1 y 2. Identidad y cuenta de cobro. Mientras Didit revisa a mano no hay
                 nada que pulsar, y si rechazó, el propio botón dice por qué. */}
          {kyc.loading ? null : faltaAltaDeCobro || mostrarAltaFiscal ? (
            <TextButton
              tone="brand"
              size="sm"
              // Abre el PANEL, no Didit. Desde ahí el creador ve todo lo que le
              // falta —identidad, cuenta de cobro y, si es mexicano, el sello— y
              // elige por dónde empezar. Saltar directo a Didit escondía los
              // otros pasos hasta que ya era tarde.
              onClick={() => setSetupPanelOpen(true)}
              disabled={kyc.loading}
              style={{
                width: "100%",
                marginTop: -14,
                lineHeight: 1.35,
                textAlign: "center",
                justifyContent: "center",
                // El rechazo se avisa en rojo: es lo único de este bloque que pide
                // una acción distinta a "sigue adelante".
                ...(kyc.status === "declined" ? { color: "#f87171" } : {}),
                opacity: kyc.starting ? 0.6 : 1,
              }}
            >
              {altaCtaLabel}
            </TextButton>
          ) : null}


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
            {/* Al creador de los 88 países no se le retiene nada: su ISR es cero —el
                servicio se presta fuera de México— y no hay IVA mexicano del que retener.
                Para él el neto ES lo que recibe, y decirle que «se descontarán impuestos»
                sería sembrarle una duda que no le aplica.

                Al mexicano sí, y además no siempre a la baja: vendiendo a otro mexicano
                recibe MÁS de su 75%, porque cobra 16 de IVA y solo se le retienen 8. Por eso
                la frase dice «verás tus retenciones» y no «se te descontará». */}
            {mode === "net"
              ? tWallet(esMexicano ? "financesCommissionNetMx" : "financesCommissionNet", {
                  pct: comisionPct,
                })
              : tWallet("financesCommissionGross", { pct: comisionPct })}
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

      <WalletTransactions
        uid={user?.uid}
        mode={mode}
        /**
         * 🧾 Lo que sus compradores pagaron de impuesto, para la pestaña de Retiros.
         *
         * NO es dinero suyo: va al fisco de cada país. Se enseña porque su precio fue 100 y
         * su comprador pagó 116, y sin esta línea la diferencia parece una comisión oculta.
         */
        impuestosRecaudados={
          summary.taxCollected > 0 ? formatSettlement(summary.taxCollected, { code: true }) : null
        }
        /**
         * 💸 Qué le llega si retira hoy.
         *
         * Se pasa siempre, aunque todavía no llegue al mínimo: saber cuánto le quedaría es
         * justamente lo que va a buscar a esa pestaña. El botón de retirar sí exige el
         * mínimo, pero eso lo decide Finanzas, no la vista.
         */
        desgloseRetiro={loadingAmounts ? null : desgloseRetiro}
      />

      {/* Panel fiscal del retiro (creador mexicano). 🔁 El creador EXTRANJERO pasará
          directo a pago sin este panel cuando se determine su país fiscal. */}
      {/* Alta de cobro. Desde aquí se llega al panel fiscal, que es donde vive la subida
          del sello: uno lleva al otro en vez de duplicar el formulario. */}
      <CreatorPayoutSetupPanel
        open={setupPanelOpen}
        onClose={() => setSetupPanelOpen(false)}
        onOpenSello={() => setWithdrawPanelOpen(true)}
        onIniciarKyc={handleKycClick}
        kycBloqueado={kycCtaDisabled}
        volviendoDeStripe={retornoAlta === "ok"}
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
        /**
         * El desglose solo cuando viene del botón de RETIRAR.
         *
         * Si llega desde el alta de cobro está completando su registro, no sacando dinero,
         * y un «recibes $X» encima del formulario del sello sobra. Antes vivía en una
         * pantalla intermedia que se eliminó por ser un clic que no decidía nada.
         */
        desglose={canWithdrawNow ? desgloseRetiro : null}
      />
    </WalletSectionShell>
  );
}
